-- Auto apply: what a member's KIASA Browser needs to apply for jobs for them. The member
-- enters their details on the Auto apply page. The browser takes the next job that has a
-- résumé made for it, and reports what became of it. Admins see each job's result, never
-- the member's details. The model server says where it can be reached.
-- Run after 20261103120000_browser_agents.sql. Running it again is safe.

-- ── What a member entered for applying: how to reach them, what only they can say
-- about themselves, and their answers to questions forms have asked. Theirs alone.
create table if not exists public.apply_details (
  user_id uuid primary key references auth.users (id) on delete cascade,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 60000),
  updated_at timestamptz not null default now()
);

create or replace function public.apply_details_written() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then raise exception 'Details stay with their member.'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists apply_details_written on public.apply_details;
create trigger apply_details_written before insert or update on public.apply_details for each row execute function public.apply_details_written();

alter table public.apply_details enable row level security;
revoke all on public.apply_details from public, anon, authenticated;
grant select, insert, update, delete on public.apply_details to authenticated;
drop policy if exists "members keep their details" on public.apply_details;
create policy "members keep their details" on public.apply_details for all to authenticated
  using (user_id = (select auth.uid()) and (select public.jobs_team()))
  with check (user_id = (select auth.uid()) and (select public.jobs_team()));

-- ── Whether a member's browser is to work: off, fill forms without sending them (used
-- to check it on real forms), or apply. A member sets their own; an admin can set anyone's.
create table if not exists public.apply_control (
  user_id uuid primary key references auth.users (id) on delete cascade,
  mode text not null default 'off' check (mode in ('off', 'fill', 'apply')),
  changed_by uuid references auth.users (id) on delete set null,
  changed_at timestamptz not null default now()
);

create or replace function public.apply_control_written() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then raise exception 'This stays with its member.'; end if;
  new.changed_by := auth.uid();
  new.changed_at := now();
  return new;
end $$;
drop trigger if exists apply_control_written on public.apply_control;
create trigger apply_control_written before insert or update on public.apply_control for each row execute function public.apply_control_written();

alter table public.apply_control enable row level security;
revoke all on public.apply_control from public, anon, authenticated;
grant select, insert, update on public.apply_control to authenticated;
drop policy if exists "see the switch" on public.apply_control;
create policy "see the switch" on public.apply_control for select to authenticated
  using (user_id = (select auth.uid()) or (select public.jobs_admin()));
drop policy if exists "turn on the switch" on public.apply_control;
create policy "turn on the switch" on public.apply_control for insert to authenticated
  with check ((user_id = (select auth.uid()) and (select public.jobs_team())) or (select public.jobs_admin()));
drop policy if exists "change the switch" on public.apply_control;
create policy "change the switch" on public.apply_control for update to authenticated
  using ((user_id = (select auth.uid()) and (select public.jobs_team())) or (select public.jobs_admin()))
  with check ((user_id = (select auth.uid()) and (select public.jobs_team())) or (select public.jobs_admin()));

-- ── What became of each job the browser took. Only short notes: no page, no answer.
-- The asks are the questions only the member can answer, in the form's own words.
create table if not exists public.apply_results (
  job_id uuid not null references public.jobs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  outcome text not null check (outcome in ('working', 'filled', 'applied', 'failed', 'skipped', 'waiting')),
  reason text check (char_length(reason) <= 300),
  asks jsonb not null default '[]'::jsonb check (jsonb_typeof(asks) = 'array' and pg_column_size(asks) <= 60000),
  tries integer not null default 0,
  agent_id uuid references public.browser_agents (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (job_id, user_id)
);
create index if not exists apply_results_user on public.apply_results (user_id, updated_at desc);

alter table public.apply_results enable row level security;
revoke all on public.apply_results from public, anon, authenticated;
grant select on public.apply_results to authenticated;
drop policy if exists "see results" on public.apply_results;
create policy "see results" on public.apply_results for select to authenticated
  using (user_id = (select auth.uid()) or (select public.jobs_admin()));

-- ── Where the model server is. Its address changes when its tunnel restarts, so it says
-- so itself, with a key of its own. No one reads these tables: the functions do.
create table if not exists public.model_server (
  id boolean primary key default true check (id),
  address text not null check (char_length(address) <= 200),
  seen_at timestamptz not null default now()
);
-- How many requests it has in hand. (A separate step, for a table made by an earlier run.)
alter table public.model_server add column if not exists waiting integer not null default 0;
-- How the model is, and which members' browsers have reached it lately, for the admins.
alter table public.model_server add column if not exists health jsonb not null default '{}'::jsonb;
alter table public.model_server add column if not exists connected jsonb not null default '[]'::jsonb;
create table if not exists public.model_server_keys (
  key_hash bytea primary key
);
alter table public.model_server enable row level security;
alter table public.model_server_keys enable row level security;
revoke all on public.model_server, public.model_server_keys from public, anon, authenticated;

-- ── The member a browser works for, while they are still on the team.
create or replace function public.browser_agent_owner(agent_key text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare who uuid;
begin
  select a.owner into who from public.browser_agents a where a.id = public.browser_agent_of(agent_key);
  if who is null or not (exists (select 1 from public.profiles p where p.id = who and p.status = 'approved') or public.is_admin_user(who)) then
    raise exception 'This browser is not connected to KIASA (its member is no longer on the team).' using errcode = '28000';
  end if;
  return who;
end $$;

-- The model server asks who a browser's key belongs to. A browser learns nothing new: it
-- is only ever told its own member.
create or replace function public.browser_agent_who(agent_key text) returns text
language sql stable security definer set search_path = '' as $$
  select public.browser_agent_owner(agent_key)::text;
$$;

-- The next job for this browser, newest first, from everything the member has ready: on
-- Greenhouse for now, not yet done, and with a résumé made for it (a job waits until it has
-- one). It also says why there is none when there is none. The member's limit is the team's
-- daily goal.
create or replace function public.browser_agent_next_job(agent_key text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  who uuid := public.browser_agent_owner(agent_key);
  me uuid := public.browser_agent_of(agent_key);
  how text;
  zone text;
  day_start timestamptz;
  done_today integer;
  details_row public.apply_details;
  picked public.jobs;
  resume jsonb;
  no_resume integer;
  server public.model_server;
  site constant text := '^https?://([^/]+\.)?greenhouse\.io(/|$)|[?&]gh_jid=';
  shared jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('browser_agent_next_job:' || who::text));
  select c.mode into how from public.apply_control c where c.user_id = who;
  how := coalesce(how, 'off');
  select * into server from public.model_server s where s.id and s.seen_at > now() - interval '3 minutes';
  shared := jsonb_build_object('mode', how, 'model_server', server.address);
  if how = 'off' then return shared; end if;

  select coalesce(s.timezone, 'UTC') into zone from public.job_settings s where s.id = 1;
  zone := coalesce(zone, 'UTC');
  day_start := date_trunc('day', now() at time zone zone) at time zone zone;
  select count(*) into done_today from public.applications a where a.user_id = who and a.applied_at >= day_start;
  shared := shared || jsonb_build_object('applied_today', done_today);
  if done_today >= 100 then return shared || jsonb_build_object('stop', 'limit'); end if;

  select * into details_row from public.apply_details d where d.user_id = who;
  if details_row.user_id is null then return shared || jsonb_build_object('stop', 'no_details'); end if;
  -- No job is taken while there is no one to answer its questions.
  if server.address is null then return shared || jsonb_build_object('stop', 'model_server_off'); end if;

  select j.* into picked
    from public.jobs j
    join public.tailored_resumes t on t.job_id = j.id and t.user_id = who
    left join public.applications a on a.job_id = j.id and a.user_id = who
    left join public.apply_results r on r.job_id = j.id and r.user_id = who
    where a.job_id is null
      and j.url ~* site
      and (r.job_id is null
        or (r.outcome = 'working' and r.updated_at < now() - interval '15 minutes')
        or (r.outcome = 'failed' and r.tries < 3 and r.updated_at < now() - interval '30 minutes')
        -- The member has changed their answers since this job asked them something.
        or (r.outcome = 'waiting' and details_row.updated_at > r.updated_at)
        or (r.outcome = 'filled' and how = 'apply'))
    order by j.posted_at desc
    limit 1;

  if picked.id is null then
    select count(*) into no_resume
      from public.jobs j
      left join public.tailored_resumes t on t.job_id = j.id and t.user_id = who
      left join public.applications a on a.job_id = j.id and a.user_id = who
      where a.job_id is null and t.job_id is null and j.posted_at > now() - interval '7 days' and j.url ~* site;
    return shared || jsonb_build_object('stop', case when no_resume > 0 then 'waiting_for_resumes' else 'no_jobs' end, 'waiting_for_resumes', no_resume);
  end if;

  select t.profile into resume from public.tailored_resumes t where t.job_id = picked.id and t.user_id = who;
  insert into public.apply_results (job_id, user_id, outcome, reason, asks, tries, agent_id, updated_at)
    values (picked.id, who, 'working', null, '[]'::jsonb, 1, me, now())
    on conflict (job_id, user_id) do update set outcome = 'working', reason = null, asks = '[]'::jsonb,
      tries = public.apply_results.tries + 1, agent_id = me, updated_at = now();
  return shared || jsonb_build_object(
    'job', jsonb_build_object('id', picked.id, 'url', picked.url, 'title', picked.title, 'company', picked.company, 'location', picked.location, 'description', picked.description),
    'resume', resume,
    'details', details_row.details);
end $$;

-- What became of a job. Only a job this browser's member was working on can be reported,
-- and "applied" only while they have it set to apply. It then counts as any application.
-- "released" gives a job back untouched, for a reason that says nothing about the job: the
-- browser was closed, or the model server went off.
create or replace function public.browser_agent_report(agent_key text, job uuid, outcome text, reason text default null, asks jsonb default '[]'::jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  who uuid := public.browser_agent_owner(agent_key);
  how text;
begin
  if outcome not in ('filled', 'applied', 'failed', 'skipped', 'waiting', 'released') then
    raise exception 'That is not a result.' using errcode = '22023';
  end if;
  if asks is null or jsonb_typeof(asks) <> 'array' or pg_column_size(asks) > 60000 then
    raise exception 'Those questions cannot be kept.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.apply_results r where r.job_id = job and r.user_id = who and r.outcome = 'working') then
    raise exception 'This browser is not working on that job.' using errcode = 'P0002';
  end if;
  if outcome = 'released' then
    delete from public.apply_results r where r.job_id = job and r.user_id = who;
    return;
  end if;
  if outcome = 'applied' then
    select c.mode into how from public.apply_control c where c.user_id = who;
    if how is distinct from 'apply' then
      raise exception 'This member has not set their browser to apply.' using errcode = '42501';
    end if;
    insert into public.applications (job_id, user_id, status, note)
      values (job, who, 'applied', 'Sent by the KIASA Browser.')
      on conflict (job_id, user_id) do nothing;
  end if;
  update public.apply_results r set outcome = browser_agent_report.outcome, reason = left(nullif(btrim(browser_agent_report.reason), ''), 300),
      asks = browser_agent_report.asks, updated_at = now()
    where r.job_id = job and r.user_id = who;
end $$;

-- The résumé made for a job, for the site to print for the browser, which has no sign-in.
create or replace function public.browser_agent_resume(agent_key text, job uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select t.profile from public.tailored_resumes t where t.job_id = job and t.user_id = public.browser_agent_owner(agent_key);
$$;

-- The model server says where it is. Only a tunnel address is accepted, because browsers
-- will send résumés there. (This PC's own address is for trying it locally: KIASA Browsers
-- themselves refuse that one, except for the local test build.)
drop function if exists public.model_server_report(text, text);
drop function if exists public.model_server_report(text, text, integer);
create or replace function public.model_server_report(server_key text, address text, waiting integer default 0, health jsonb default '{}'::jsonb, connected jsonb default '[]'::jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if server_key is null or not exists (select 1 from public.model_server_keys k where k.key_hash = sha256(convert_to(server_key, 'UTF8'))) then
    raise exception 'This is not the model server.' using errcode = '28000';
  end if;
  if address !~ '^https://[a-z0-9-]+\.trycloudflare\.com$' and address !~ '^http://127\.0\.0\.1:[0-9]{2,5}$' then
    raise exception 'That address cannot be used.' using errcode = '22023';
  end if;
  if jsonb_typeof(model_server_report.health) is distinct from 'object' or jsonb_typeof(model_server_report.connected) is distinct from 'array'
    or pg_column_size(model_server_report.health) > 8000 or pg_column_size(model_server_report.connected) > 60000 then
    raise exception 'That report cannot be kept.' using errcode = '22023';
  end if;
  insert into public.model_server (id, address, seen_at, waiting, health, connected)
    values (true, model_server_report.address, now(), greatest(coalesce(model_server_report.waiting, 0), 0), model_server_report.health, model_server_report.connected)
    on conflict (id) do update set address = excluded.address, seen_at = now(), waiting = excluded.waiting, health = excluded.health, connected = excluded.connected;
end $$;

-- How the model is and whose browsers are connected to it, by name, for the admins' Model
-- server tab. A line that names no real member is left out.
create or replace function public.model_server_admin_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  server public.model_server;
  live boolean;
  people jsonb;
begin
  if auth.uid() is null or not public.jobs_admin() then
    raise exception 'Only an admin can see this.' using errcode = '42501';
  end if;
  select * into server from public.model_server s where s.id;
  live := coalesce(server.seen_at > now() - interval '3 minutes', false);
  if live then
    select coalesce(jsonb_agg(jsonb_build_object(
        'member', p.id, 'name', coalesce(public.chat_name_of(p.id), 'A member'),
        'seconds_ago', coalesce((item ->> 'seconds_ago')::numeric, 0) + extract(epoch from now() - server.seen_at),
        'requests', coalesce((item ->> 'requests')::integer, 0))
        order by coalesce(public.chat_name_of(p.id), '')), '[]'::jsonb) into people
      from jsonb_array_elements(server.connected) item
      join public.profiles p on item ->> 'member' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and p.id = (item ->> 'member')::uuid;
  end if;
  return jsonb_build_object('on', live, 'seen_at', server.seen_at, 'waiting', coalesce(server.waiting, 0),
    'health', coalesce(server.health, '{}'::jsonb), 'people', coalesce(people, '[]'::jsonb));
end $$;

-- Whether the model server is on, for the Auto apply page. Not its address: only browsers
-- need that.
create or replace function public.model_server_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare server public.model_server;
begin
  if auth.uid() is null or not public.jobs_team() then
    raise exception 'Only the team can see this.' using errcode = '42501';
  end if;
  select * into server from public.model_server s where s.id;
  return jsonb_build_object('on', coalesce(server.seen_at > now() - interval '3 minutes', false), 'seen_at', server.seen_at, 'waiting', coalesce(server.waiting, 0));
end $$;

-- These are open to a key alone: a browser and the model server have no account. The
-- helper that finds a browser's member is for the functions only.
revoke execute on function public.browser_agent_owner(text) from public, anon, authenticated;
revoke execute on function public.browser_agent_who(text) from public;
revoke execute on function public.browser_agent_next_job(text) from public;
revoke execute on function public.browser_agent_report(text, uuid, text, text, jsonb) from public;
revoke execute on function public.browser_agent_resume(text, uuid) from public;
revoke execute on function public.model_server_report(text, text, integer, jsonb, jsonb) from public;
revoke execute on function public.model_server_admin_status() from public, anon;
revoke execute on function public.model_server_status() from public, anon;
grant execute on function public.browser_agent_who(text) to anon, authenticated;
grant execute on function public.browser_agent_next_job(text) to anon, authenticated;
grant execute on function public.browser_agent_report(text, uuid, text, text, jsonb) to anon, authenticated;
grant execute on function public.browser_agent_resume(text, uuid) to anon, authenticated;
grant execute on function public.model_server_report(text, text, integer, jsonb, jsonb) to anon, authenticated;
grant execute on function public.model_server_admin_status() to authenticated;
grant execute on function public.model_server_status() to authenticated;
revoke execute on function public.apply_details_written() from public, anon, authenticated;
revoke execute on function public.apply_control_written() from public, anon, authenticated;

-- ── Live for the pages that watch them.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'apply_results') then
    alter publication supabase_realtime add table public.apply_results;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'apply_control') then
    alter publication supabase_realtime add table public.apply_control;
  end if;
  -- A job turns ready for a member the moment its résumé is made.
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tailored_resumes') then
    alter publication supabase_realtime add table public.tailored_resumes;
  end if;
end $$;
