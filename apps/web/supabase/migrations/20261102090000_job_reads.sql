-- Links sent to the Jobright bot: an admin presses Send on the Jobs bot, each
-- link waits here, and the bot's own browser opens it and reads it with the Job
-- Intelligence extension. What it reads (the job description, company, title and
-- place) is written on the job. A link only pasted is saved and never comes here.
-- Run after 20261030090000_resume_tailor.sql. Running it again is safe.

-- ── One row a job: its latest asking. Reads wait for a free bot, ten at a time.
create table if not exists public.job_reads (
  job_id uuid primary key references public.jobs (id) on delete cascade,
  state text not null default 'waiting' check (state in ('waiting', 'reading', 'done', 'failed')),
  -- Typed by the admin with the link ("Title | Company | link"): the bot leaves it.
  keep_title boolean not null default false,
  keep_company boolean not null default false,
  asked_by uuid default auth.uid() references auth.users (id) on delete set null,
  asked_at timestamptz not null default now(),
  bot_id uuid references public.job_bots (id) on delete set null,
  taken_at timestamptz,
  ended_at timestamptz,
  tries smallint not null default 0,
  found text check (char_length(found) <= 300),
  message text check (char_length(message) <= 300)
);
create index if not exists job_reads_open on public.job_reads (asked_at) where state in ('waiting', 'reading');

-- Admins watch them; the functions below do all the writing.
alter table public.job_reads enable row level security;
revoke all on public.job_reads from public, anon, authenticated;
grant select on public.job_reads to authenticated;
drop policy if exists "admins see reads" on public.job_reads;
create policy "admins see reads" on public.job_reads for select to authenticated using ((select public.jobs_admin()));

-- ── An admin sends links: each one not yet on the list is saved (like a paste)
-- and every one is asked for. Sending a link again reads it afresh. The answer
-- names each job and which of them are new, so a mistake can be taken back.
create or replace function public.jobs_ask_bot(links jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  given jsonb;
  fresh jsonb;
  answer jsonb;
begin
  if not public.jobs_admin() then raise exception 'Only an admin sends links to the bot.' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(picked)), '[]'::jsonb) into given from (
    select distinct on (cleaned.url) cleaned.url, cleaned.title, cleaned.company, cleaned.keep_company
    from (
      select btrim(item.value ->> 'url') as url,
        left(nullif(btrim(item.value ->> 'title'), ''), 200) as title,
        left(nullif(btrim(item.value ->> 'company'), ''), 120) as company,
        coalesce(item.value ->> 'keep_company' = 'true', false) as keep_company
      from jsonb_array_elements(case when jsonb_typeof(links) = 'array' then links else '[]'::jsonb end) as item
      limit 500
    ) cleaned
    where cleaned.url ~* '^https?://[^\s]+$' and char_length(cleaned.url) <= 2000
    order by cleaned.url
  ) picked;

  with made as (
    insert into public.jobs (url, title, company)
      select g.url, g.title, g.company
      from jsonb_to_recordset(given) as g(url text, title text, company text, keep_company boolean)
      on conflict (url) do nothing
      returning id
  ) select coalesce(jsonb_agg(made.id), '[]'::jsonb) into fresh from made;

  insert into public.job_reads as r (job_id, keep_title, keep_company)
    select j.id, g.title is not null, g.keep_company
    from jsonb_to_recordset(given) as g(url text, title text, company text, keep_company boolean)
    join public.jobs j on j.url = g.url
    on conflict (job_id) do update set state = 'waiting', keep_title = excluded.keep_title, keep_company = excluded.keep_company,
        asked_by = auth.uid(), asked_at = now(), bot_id = null, taken_at = null, ended_at = null, tries = 0, found = null, message = null
      where r.state <> 'reading';

  select jsonb_agg(jsonb_build_object('id', j.id, 'url', j.url, 'fresh', fresh @> to_jsonb(j.id))) into answer
    from jsonb_to_recordset(given) as g(url text) join public.jobs j on j.url = g.url;
  return coalesce(answer, '[]'::jsonb);
end $$;
revoke execute on function public.jobs_ask_bot(jsonb) from public, anon;
grant execute on function public.jobs_ask_bot(jsonb) to authenticated;

-- ── The bot checks in (as before), and one able to read links (it says
-- can_read) is handed the next ten when it is free and no run waits for it.
-- Reads it took and let go (the app restarted, or Stop) go back in the queue;
-- the third time they count as failed. Reading uses no Jobright card, so it
-- does not count towards the day's limit.
create or replace function public.job_bot_check_in(bot_key text, info jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := public.job_bot_of(bot_key);
  bot public.job_bots;
  tz text := public.jobs_zone();
  here timestamp := now() at time zone tz;
  day_start timestamptz := (here::date)::timestamp at time zone tz;
  said_state text := case when info ->> 'state' in ('ready', 'busy', 'sign_in', 'setup', 'error') then info ->> 'state' end;
  said_detail text := left(nullif(btrim(info ->> 'detail'), ''), 300);
  said_computer text := left(nullif(btrim(info ->> 'computer'), ''), 80);
  said_version text := left(nullif(btrim(info ->> 'version'), ''), 40);
  running uuid := case when info ->> 'running' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (info ->> 'running')::uuid end;
  can_read boolean := coalesce(info ->> 'can_read' = 'true', false);
  handed public.bot_runs;
  reads jsonb;
  done_today integer;
  left_today integer;
begin
  -- Seen: written when something changed, or every 20 seconds, not on every call.
  update public.job_bots b set seen_at = now(), state = coalesce(said_state, b.state), detail = said_detail,
      computer = coalesce(said_computer, b.computer), version = coalesce(said_version, b.version)
    where b.id = me and (b.seen_at is null or b.seen_at < now() - interval '20 seconds'
      or b.state is distinct from coalesce(said_state, b.state) or b.detail is distinct from said_detail
      or b.computer is distinct from coalesce(said_computer, b.computer) or b.version is distinct from coalesce(said_version, b.version));
  select * into bot from public.job_bots b where b.id = me;

  -- A run the bot is not working on (the app or the computer restarted in it).
  if said_state is distinct from 'busy' or running is not null then
    update public.bot_runs r set state = 'failed', ended_at = now(),
        message = 'The bot stopped in the middle of this run (the app or the computer restarted).'
      where r.bot_id = me and r.state = 'running' and r.id is distinct from running;
  end if;

  -- Today's scheduled run, once its time has come (and if the schedule was set before it).
  if bot.schedule_at is not null and extract(isodow from here)::smallint = any (bot.schedule_days)
      and here::time >= bot.schedule_at
      and bot.schedule_saved_at <= ((here::date + bot.schedule_at) at time zone tz)
      and not exists (select 1 from public.bot_runs r where r.bot_id = me and r.origin = 'schedule' and r.asked_at >= day_start) then
    insert into public.bot_runs (bot_id, cards, origin, asked_by) values (me, bot.schedule_cards, 'schedule', null)
      on conflict (bot_id) where state in ('waiting', 'running') do nothing;
  end if;

  -- A waiting run, for a bot free to take it.
  if said_state is distinct from 'busy' and running is null then
    select * into handed from public.bot_runs r where r.bot_id = me and r.state = 'waiting' order by r.asked_at limit 1;
    if handed.id is not null then
      select coalesce(sum(r.processed), 0) into done_today from public.bot_runs r where r.bot_id = me and r.started_at >= day_start;
      left_today := bot.daily_cap - done_today;
      if left_today <= 0 then
        update public.bot_runs r set state = 'missed', ended_at = now(),
            message = format('Not run: today''s limit of %s cards was already reached.', bot.daily_cap)
          where r.id = handed.id;
        handed := null;
      elsif handed.cards > left_today then
        update public.bot_runs r set cards = left_today,
            message = format('%s cards asked; %s left within today''s limit of %s.', handed.cards, left_today, bot.daily_cap)
          where r.id = handed.id returning * into handed;
      end if;
    end if;
  end if;

  -- Links to read: those let go go back, then the next ten for a free bot.
  if can_read then
    update public.job_reads r set state = case when r.tries >= 2 then 'failed' else 'waiting' end, tries = r.tries + 1,
        bot_id = null, taken_at = null, ended_at = case when r.tries >= 2 then now() end,
        message = case when r.tries >= 2 then 'The bot tried three times and could not finish reading this link.' end
      where r.state = 'reading' and (r.taken_at < now() - interval '30 minutes' or (r.bot_id = me and said_state is distinct from 'busy'));
    if said_state is distinct from 'busy' and said_state is distinct from 'setup' and running is null and handed.id is null then
      update public.job_reads r set state = 'reading', bot_id = me, taken_at = now()
        where r.job_id in (select w.job_id from public.job_reads w where w.state = 'waiting' order by w.asked_at, w.job_id limit 10 for update skip locked);
      select jsonb_agg(jsonb_build_object('job', j.id, 'url', j.url) order by j.url) into reads
        from public.job_reads r join public.jobs j on j.id = r.job_id where r.bot_id = me and r.state = 'reading';
    end if;
  end if;

  return jsonb_build_object('name', bot.name,
    'run', case when handed.id is null then null else jsonb_build_object('id', handed.id, 'cards', handed.cards, 'origin', handed.origin) end,
    'reads', coalesce(reads, '[]'::jsonb));
end $$;

-- ── What the bot read, a link at a time, up to fifty a call: written on the job
-- (a read that found only part still gives that part). A blank leaves what the
-- job has; what the admin typed with the link stays. A read that came late, after
-- going back in the queue, still counts.
create or replace function public.job_bot_read_done(bot_key text, reads jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := public.job_bot_of(bot_key);
  item jsonb;
  job uuid;
  this public.job_reads;
  new_title text;
  new_company text;
  new_place text;
  new_about text;
  worked boolean;
  done integer := 0;
  failed integer := 0;
begin
  for item in select value from jsonb_array_elements(case when jsonb_typeof(reads) = 'array' then reads else '[]'::jsonb end) limit 50 loop
    if coalesce(item ->> 'job', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then continue; end if;
    job := (item ->> 'job')::uuid;
    this := null;
    select * into this from public.job_reads r where r.job_id = job for update;
    -- Gone (the job was taken back), already ended, or now another bot's: left alone.
    if this.job_id is null or this.state not in ('waiting', 'reading') or (this.state = 'reading' and this.bot_id is distinct from me) then continue; end if;
    new_title := case when this.keep_title then null else left(nullif(btrim(item ->> 'title'), ''), 200) end;
    new_company := case when this.keep_company then null else left(nullif(btrim(item ->> 'company'), ''), 120) end;
    new_place := left(nullif(btrim(item ->> 'location'), ''), 120);
    new_about := left(nullif(btrim(item ->> 'description'), ''), 30000);
    worked := coalesce(item ->> 'ok' = 'true', false);
    if coalesce(new_title, new_company, new_place, new_about) is not null then
      update public.jobs j set title = coalesce(new_title, j.title), company = coalesce(new_company, j.company),
          location = coalesce(new_place, j.location), description = coalesce(new_about, j.description)
        where j.id = job;
    end if;
    update public.job_reads r set state = case when worked then 'done' else 'failed' end, bot_id = me, ended_at = now(),
        found = (select left(nullif(concat_ws(' · ', j.title, j.company, j.location), ''), 300) from public.jobs j where j.id = job),
        message = left(nullif(btrim(item ->> 'message'), ''), 300)
      where r.job_id = job;
    if worked then done := done + 1; else failed := failed + 1; end if;
  end loop;
  -- A month on, what was read needs no record.
  delete from public.job_reads r where r.state in ('done', 'failed') and r.ended_at < now() - interval '30 days';
  return jsonb_build_object('done', done, 'failed', failed);
end $$;
revoke execute on function public.job_bot_read_done(text, jsonb) from public;
grant execute on function public.job_bot_read_done(text, jsonb) to anon, authenticated;

-- ── Live: the Jobs bot shows each read as it ends.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'job_reads') then
    alter publication supabase_realtime add table public.job_reads;
  end if;
end $$;
