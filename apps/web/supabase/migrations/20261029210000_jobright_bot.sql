-- The Jobright bot: Job Saving Bot, the app on a KIASA computer that works down
-- Jobright's Recommended list. Each job it saves is posted to KIASA Jobs, and
-- the admins start it, stop it, watch it and set it to run each day from the
-- job desk. Run after 20261029180000_security.sql. Running it again is safe.
--
-- The bot is no person and has no account. It holds a secret key, made here and
-- shown to the admin once (only its hash is kept), and with it may only call the
-- job_bot_* functions below: check in (and be handed a run), report how a run
-- goes, and post the jobs it saved. Admins see all of it, live; no one else sees
-- any of it. Disconnecting a bot (or giving it a new code) ends its key.

-- ── The bots: one a computer.
create table if not exists public.job_bots (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  computer text check (char_length(computer) <= 80),
  version text check (char_length(version) <= 40),
  -- What the bot says of itself: ready, busy (a run), sign_in (Jobright wants
  -- signing in on the computer), setup (the extension needs a hand), error.
  state text not null default 'new' check (state in ('new', 'ready', 'busy', 'sign_in', 'setup', 'error')),
  detail text check (char_length(detail) <= 300),
  seen_at timestamptz,
  -- At most this many cards a day (the team's day), runs on a schedule included.
  daily_cap integer not null default 150 check (daily_cap between 1 and 1000),
  -- A run each chosen day (1 = Monday) at this time of the team's day; none when null.
  schedule_at time,
  schedule_cards integer not null default 30 check (schedule_cards between 1 and 500),
  schedule_days smallint[] not null default '{1,2,3,4,5}' check (schedule_days <@ '{1,2,3,4,5,6,7}'::smallint[]),
  schedule_saved_at timestamptz not null default now(),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Their keys, apart: no one reads this table, the functions below only compare.
create table if not exists public.job_bot_keys (
  bot_id uuid primary key references public.job_bots (id) on delete cascade,
  key_hash bytea not null unique
);

-- ── Runs: asked for by an admin, by the schedule, or started on the computer.
create table if not exists public.bot_runs (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.job_bots (id) on delete cascade,
  cards integer not null check (cards between 1 and 999),
  origin text not null default 'admin' check (origin in ('admin', 'schedule', 'computer')),
  asked_by uuid default auth.uid() references auth.users (id) on delete set null,
  asked_at timestamptz not null default now(),
  state text not null default 'waiting' check (state in ('waiting', 'running', 'done', 'stopped', 'failed', 'missed')),
  stop_asked boolean not null default false,
  saved integer not null default 0 check (saved >= 0),
  removed integer not null default 0 check (removed >= 0),
  skipped integer not null default 0 check (skipped >= 0),
  failed integer not null default 0 check (failed >= 0),
  processed integer not null default 0 check (processed >= 0),
  message text check (char_length(message) <= 300),
  started_at timestamptz,
  ended_at timestamptz
);
-- One run at a time, a bot.
create unique index if not exists bot_runs_one_open on public.bot_runs (bot_id) where state in ('waiting', 'running');
create index if not exists bot_runs_bot_asked on public.bot_runs (bot_id, asked_at desc);

-- What a run did, line by line, as the admins watch it.
create table if not exists public.bot_steps (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.bot_runs (id) on delete cascade,
  at timestamptz not null default now(),
  level text not null default 'info' check (level in ('info', 'step', 'ok', 'warn', 'error')),
  text text not null check (char_length(text) between 1 and 300),
  job_id uuid references public.jobs (id) on delete set null
);
create index if not exists bot_steps_run on public.bot_steps (run_id, id);
create index if not exists bot_steps_job on public.bot_steps (job_id);

-- ── An admin's changes: a new schedule counts from now (a time already past
-- today waits for tomorrow); stopping a run no bot is working on ends it.
create or replace function public.job_bot_written() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.schedule_at is distinct from old.schedule_at or new.schedule_days is distinct from old.schedule_days then
    new.schedule_saved_at := now();
  end if;
  new.name := btrim(new.name);
  return new;
end $$;
drop trigger if exists job_bot_written on public.job_bots;
create trigger job_bot_written before update on public.job_bots
  for each row execute function public.job_bot_written();

create or replace function public.bot_run_written() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.stop_asked and not old.stop_asked and old.state in ('waiting', 'running') then
    if old.state = 'waiting' then
      new.state := 'stopped'; new.ended_at := now(); new.message := 'Called off before it began.';
    elsif not exists (select 1 from public.job_bots b where b.id = old.bot_id and b.seen_at > now() - interval '90 seconds') then
      new.state := 'stopped'; new.ended_at := now(); new.message := 'Stopped. The bot was offline, so it may have stopped earlier.';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists bot_run_written on public.bot_runs;
create trigger bot_run_written before update on public.bot_runs
  for each row execute function public.bot_run_written();

-- ── Who may do what: admins see it all, change a bot's name, limit and
-- schedule, ask for a run and stop one; the bots go through the functions.
alter table public.job_bots enable row level security;
alter table public.job_bot_keys enable row level security;
alter table public.bot_runs enable row level security;
alter table public.bot_steps enable row level security;
revoke all on public.job_bots, public.job_bot_keys, public.bot_runs, public.bot_steps from public, anon, authenticated;
grant select, delete on public.job_bots to authenticated;
grant update (name, daily_cap, schedule_at, schedule_cards, schedule_days) on public.job_bots to authenticated;
grant select on public.bot_runs, public.bot_steps to authenticated;
grant insert (bot_id, cards) on public.bot_runs to authenticated;
grant update (stop_asked) on public.bot_runs to authenticated;

drop policy if exists "admins see bots" on public.job_bots;
create policy "admins see bots" on public.job_bots for select to authenticated using ((select public.jobs_admin()));
drop policy if exists "admins change bots" on public.job_bots;
create policy "admins change bots" on public.job_bots for update to authenticated using ((select public.jobs_admin())) with check ((select public.jobs_admin()));
drop policy if exists "admins remove bots" on public.job_bots;
create policy "admins remove bots" on public.job_bots for delete to authenticated using ((select public.jobs_admin()));
drop policy if exists "admins see runs" on public.bot_runs;
create policy "admins see runs" on public.bot_runs for select to authenticated using ((select public.jobs_admin()));
drop policy if exists "admins ask for runs" on public.bot_runs;
create policy "admins ask for runs" on public.bot_runs for insert to authenticated
  with check ((select public.jobs_admin()) and asked_by = (select auth.uid()) and origin = 'admin' and state = 'waiting' and not stop_asked);
drop policy if exists "admins stop runs" on public.bot_runs;
create policy "admins stop runs" on public.bot_runs for update to authenticated using ((select public.jobs_admin())) with check ((select public.jobs_admin()));
drop policy if exists "admins see steps" on public.bot_steps;
create policy "admins see steps" on public.bot_steps for select to authenticated using ((select public.jobs_admin()));

-- ── An admin connects a computer: a new bot, or a new key for one (its old
-- key stops working). The key is returned this once.
create or replace function public.job_bot_connect(bot_name text, existing uuid default null) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  key text := 'kbot_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  which uuid := existing;
begin
  if not public.jobs_admin() then raise exception 'Only an admin connects a bot.' using errcode = '42501'; end if;
  if which is null then
    insert into public.job_bots (name) values (left(coalesce(nullif(btrim(bot_name), ''), 'Jobright bot'), 60)) returning id into which;
  elsif not exists (select 1 from public.job_bots b where b.id = which) then
    raise exception 'No such bot.' using errcode = 'P0002';
  end if;
  insert into public.job_bot_keys (bot_id, key_hash) values (which, sha256(convert_to(key, 'UTF8')))
    on conflict (bot_id) do update set key_hash = excluded.key_hash;
  return key;
end $$;

-- The bot a key belongs to; anything else is refused.
create or replace function public.job_bot_of(bot_key text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare found uuid;
begin
  if bot_key is not null and char_length(bot_key) between 40 and 200 then
    select k.bot_id into found from public.job_bot_keys k where k.key_hash = sha256(convert_to(bot_key, 'UTF8'));
  end if;
  if found is null then
    raise exception 'This bot is not connected to KIASA (its code was replaced, or the bot was disconnected).' using errcode = '28000';
  end if;
  return found;
end $$;

-- ── The bot checks in every few seconds: it says how it is, any run of its
-- that it no longer works on is closed, the day's scheduled run is asked for
-- when its time has come, and a run waiting for it is handed over (within the
-- day's limit). The run is the bot's once it reports it running.
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
  handed public.bot_runs;
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

  return jsonb_build_object('name', bot.name,
    'run', case when handed.id is null then null else jsonb_build_object('id', handed.id, 'cards', handed.cards, 'origin', handed.origin) end);
end $$;

-- ── The bot reports a run: begun (state running), how it is going (counts and
-- lines), and how it ended. A run started on the computer itself (no run) is
-- made here. The answer says whether the admins have asked it to stop.
create or replace function public.job_bot_report(bot_key text, run uuid, report jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := public.job_bot_of(bot_key);
  this public.bot_runs;
  wanted text := case when report ->> 'state' in ('running', 'done', 'stopped', 'failed') then report ->> 'state' end;
  stats jsonb := case when jsonb_typeof(report -> 'stats') = 'object' then report -> 'stats' else '{}'::jsonb end;
  count_of jsonb;
  line jsonb;
begin
  if run is null then
    -- Started on the computer: it takes the place of any run waiting for it.
    update public.bot_runs r set state = 'missed', ended_at = now(), message = 'A run was started on the computer instead.'
      where r.bot_id = me and r.state = 'waiting';
    update public.bot_runs r set state = 'failed', ended_at = now(),
        message = 'The bot stopped in the middle of this run (the app or the computer restarted).'
      where r.bot_id = me and r.state = 'running';
    insert into public.bot_runs (bot_id, cards, origin, asked_by, state, started_at)
      values (me, greatest(1, least(999, coalesce(case when report ->> 'cards' ~ '^\d{1,4}$' then (report ->> 'cards')::integer end, 1))),
        'computer', null, 'running', now())
      returning * into this;
  else
    select * into this from public.bot_runs r where r.id = run and r.bot_id = me for update;
    if this.id is null then raise exception 'No such run.' using errcode = 'P0002'; end if;
  end if;
  if this.state not in ('waiting', 'running') then
    return jsonb_build_object('run', this.id, 'stop', true, 'state', this.state);
  end if;

  count_of := jsonb_build_object(
    'saved', case when stats ->> 'saved' ~ '^\d{1,6}$' then (stats ->> 'saved')::integer end,
    'removed', case when stats ->> 'removed' ~ '^\d{1,6}$' then (stats ->> 'removed')::integer end,
    'skipped', case when stats ->> 'skipped' ~ '^\d{1,6}$' then (stats ->> 'skipped')::integer end,
    'failed', case when stats ->> 'failed' ~ '^\d{1,6}$' then (stats ->> 'failed')::integer end,
    'processed', case when stats ->> 'processed' ~ '^\d{1,6}$' then (stats ->> 'processed')::integer end);
  update public.bot_runs r set
      state = coalesce(wanted, r.state),
      started_at = coalesce(r.started_at, now()),
      ended_at = case when wanted in ('done', 'stopped', 'failed') then now() else r.ended_at end,
      saved = coalesce((count_of ->> 'saved')::integer, r.saved),
      removed = coalesce((count_of ->> 'removed')::integer, r.removed),
      skipped = coalesce((count_of ->> 'skipped')::integer, r.skipped),
      failed = coalesce((count_of ->> 'failed')::integer, r.failed),
      processed = coalesce((count_of ->> 'processed')::integer, r.processed),
      message = coalesce(left(nullif(btrim(report ->> 'message'), ''), 300), r.message)
    where r.id = this.id returning * into this;

  for line in select value from jsonb_array_elements(case when jsonb_typeof(report -> 'steps') = 'array' then report -> 'steps' else '[]'::jsonb end) limit 50 loop
    if nullif(btrim(line ->> 'text'), '') is not null then
      insert into public.bot_steps (run_id, level, text)
        values (this.id, case when line ->> 'level' in ('info', 'step', 'ok', 'warn', 'error') then line ->> 'level' else 'info' end, left(btrim(line ->> 'text'), 300));
    end if;
  end loop;

  -- Old runs' lines go after a month; the runs themselves after half a year.
  if wanted in ('done', 'stopped', 'failed') then
    delete from public.bot_steps s using public.bot_runs r
      where s.run_id = r.id and r.bot_id = me and r.ended_at < now() - interval '30 days';
    delete from public.bot_runs r where r.bot_id = me and r.ended_at < now() - interval '180 days';
  end if;

  return jsonb_build_object('run', this.id, 'stop', this.stop_asked, 'state', this.state);
end $$;

-- ── The jobs the bot saved, posted to the day's list like pasted links (each
-- link once), and told in their run's lines. Up to fifty a call.
create or replace function public.job_bot_add_jobs(bot_key text, jobs jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := public.job_bot_of(bot_key);
  item jsonb;
  link text;
  job uuid;
  fresh boolean;
  its_run uuid;
  title text;
  company text;
  place text;
  added integer := 0;
  known integer := 0;
begin
  for item in select value from jsonb_array_elements(case when jsonb_typeof(jobs) = 'array' then jobs else '[]'::jsonb end) limit 50 loop
    link := btrim(item ->> 'url');
    if link is null or link !~* '^https?://[^\s]+$' or char_length(link) > 2000 then continue; end if;
    title := left(nullif(btrim(item ->> 'title'), ''), 200);
    company := left(nullif(btrim(item ->> 'company'), ''), 120);
    place := left(nullif(btrim(item ->> 'location'), ''), 120);
    job := null;
    insert into public.jobs (url, title, company, location, posted_by) values (link, title, company, place, null)
      on conflict (url) do nothing returning id into job;
    fresh := job is not null;
    if fresh then
      added := added + 1;
    else
      known := known + 1;
      select j.id into job from public.jobs j where j.url = link;
    end if;
    its_run := null;
    if item ->> 'run' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select r.id into its_run from public.bot_runs r where r.id = (item ->> 'run')::uuid and r.bot_id = me;
    end if;
    if its_run is not null then
      insert into public.bot_steps (run_id, level, text, job_id) values (its_run, case when fresh then 'ok' else 'info' end,
        left((case when fresh then 'Posted: ' else 'Already on the list: ' end)
          || coalesce(nullif(concat_ws(' · ', title, company, place), ''), link), 300), job);
    end if;
  end loop;
  return jsonb_build_object('added', added, 'known', known);
end $$;

-- The bots call these with their key and no account; admins call connect.
do $$
declare fn text;
begin
  foreach fn in array array['job_bot_check_in(text, jsonb)', 'job_bot_report(text, uuid, jsonb)', 'job_bot_add_jobs(text, jsonb)'] loop
    execute format('revoke execute on function public.%s from public', fn);
    execute format('grant execute on function public.%s to anon, authenticated', fn);
  end loop;
  revoke execute on function public.job_bot_connect(text, uuid) from public, anon;
  grant execute on function public.job_bot_connect(text, uuid) to authenticated;
  revoke execute on function public.job_bot_of(text) from public, anon, authenticated;
end $$;

-- ── Live: the admins' job desk hears every change to the bots, runs and lines.
do $$
declare t text;
begin
  foreach t in array array['job_bots', 'bot_runs', 'bot_steps'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
