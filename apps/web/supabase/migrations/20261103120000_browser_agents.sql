-- The KIASA Browser's link to KIASA: a member connects the browser on their PC
-- from the Auto apply page, and the browser then checks in every few seconds to
-- say how it is (working status only: no pictures of any page). The member sees
-- their own browsers and the admins see every one, live.
-- Run after 20261102090000_job_reads.sql. Running it again is safe.
--
-- The browser is no person and has no account. It holds a secret key, made here
-- and shown to the member once (only its hash is kept), and with it may only call
-- browser_agent_check_in. Disconnecting a browser (or giving it a new code) ends its key.

-- ── The browsers: one a computer.
create table if not exists public.browser_agents (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  owner_name text not null default '' check (char_length(owner_name) <= 120),
  name text not null check (char_length(name) between 1 and 60),
  computer text check (char_length(computer) <= 80),
  version text check (char_length(version) <= 40),
  -- What the browser says of itself: idle (open, nothing to do), working (applying),
  -- waiting (needs the member: a sign-in or a question), paused, error.
  state text not null default 'new' check (state in ('new', 'idle', 'working', 'waiting', 'paused', 'error')),
  detail text check (char_length(detail) <= 300),
  seen_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists browser_agents_owner on public.browser_agents (owner);

-- Their keys, apart: no one reads this table, the functions below only compare.
create table if not exists public.browser_agent_keys (
  agent_id uuid primary key references public.browser_agents (id) on delete cascade,
  key_hash bytea not null unique
);

-- ── Who may do what: a member sees, renames and disconnects their own browsers,
-- the admins see and disconnect every one. All other writing is by the functions.
alter table public.browser_agents enable row level security;
alter table public.browser_agent_keys enable row level security;
revoke all on public.browser_agents, public.browser_agent_keys from public, anon, authenticated;
grant select, delete on public.browser_agents to authenticated;
grant update (name) on public.browser_agents to authenticated;

drop policy if exists "see browsers" on public.browser_agents;
create policy "see browsers" on public.browser_agents for select to authenticated
  using (owner = (select auth.uid()) or (select public.jobs_admin()));
drop policy if exists "rename browsers" on public.browser_agents;
create policy "rename browsers" on public.browser_agents for update to authenticated
  using (owner = (select auth.uid()) or (select public.jobs_admin()))
  with check (owner = (select auth.uid()) or (select public.jobs_admin()));
drop policy if exists "remove browsers" on public.browser_agents;
create policy "remove browsers" on public.browser_agents for delete to authenticated
  using (owner = (select auth.uid()) or (select public.jobs_admin()));

-- ── A member (or admin) connects a computer: a new browser, or a new key for one
-- of theirs (its old key stops working). The key is returned this once.
create or replace function public.browser_agent_connect(agent_name text, existing uuid default null) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  key text := 'kapp_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  which uuid := existing;
begin
  if auth.uid() is null or not public.jobs_team() then
    raise exception 'Only an approved member connects a browser.' using errcode = '42501';
  end if;
  if which is null then
    if (select count(*) from public.browser_agents a where a.owner = auth.uid()) >= 10 then
      raise exception 'Ten browsers are connected already. Remove one first.' using errcode = '54000';
    end if;
    insert into public.browser_agents (owner, owner_name, name)
      values (auth.uid(), left(coalesce(public.chat_name_of(auth.uid()), ''), 120),
        left(coalesce(nullif(btrim(agent_name), ''), 'My browser'), 60))
      returning id into which;
  elsif not exists (select 1 from public.browser_agents a where a.id = which and a.owner = auth.uid()) then
    raise exception 'No such browser.' using errcode = 'P0002';
  end if;
  insert into public.browser_agent_keys (agent_id, key_hash) values (which, sha256(convert_to(key, 'UTF8')))
    on conflict (agent_id) do update set key_hash = excluded.key_hash;
  return key;
end $$;

-- The browser a key belongs to; anything else is refused.
create or replace function public.browser_agent_of(agent_key text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare found uuid;
begin
  if agent_key is not null and char_length(agent_key) between 40 and 200 then
    select k.agent_id into found from public.browser_agent_keys k where k.key_hash = sha256(convert_to(agent_key, 'UTF8'));
  end if;
  if found is null then
    raise exception 'This browser is not connected to KIASA (its code was replaced, or it was disconnected).' using errcode = '28000';
  end if;
  return found;
end $$;

-- ── The browser checks in every few seconds and says how it is. Seen is written
-- when something changed, or every 20 seconds, not on every call.
create or replace function public.browser_agent_check_in(agent_key text, info jsonb default '{}'::jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := public.browser_agent_of(agent_key);
  said_state text := case when info ->> 'state' in ('idle', 'working', 'waiting', 'paused', 'error') then info ->> 'state' end;
  said_detail text := left(nullif(btrim(info ->> 'detail'), ''), 300);
  said_computer text := left(nullif(btrim(info ->> 'computer'), ''), 80);
  said_version text := left(nullif(btrim(info ->> 'version'), ''), 40);
  agent public.browser_agents;
begin
  update public.browser_agents a set seen_at = now(), state = coalesce(said_state, a.state), detail = said_detail,
      computer = coalesce(said_computer, a.computer), version = coalesce(said_version, a.version)
    where a.id = me and (a.seen_at is null or a.seen_at < now() - interval '20 seconds'
      or a.state is distinct from coalesce(said_state, a.state) or a.detail is distinct from said_detail
      or a.computer is distinct from coalesce(said_computer, a.computer) or a.version is distinct from coalesce(said_version, a.version));
  select * into agent from public.browser_agents a where a.id = me;
  return jsonb_build_object('name', agent.name, 'owner', agent.owner_name);
end $$;

-- The browser's own functions are open to its key alone (it has no account);
-- connecting is for signed-in members; the key lookup is for the functions only.
revoke execute on function public.browser_agent_connect(text, uuid) from public, anon;
grant execute on function public.browser_agent_connect(text, uuid) to authenticated;
revoke execute on function public.browser_agent_of(text) from public, anon, authenticated;
revoke execute on function public.browser_agent_check_in(text, jsonb) from public;
grant execute on function public.browser_agent_check_in(text, jsonb) to anon, authenticated;

-- ── Live for the pages that watch them.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'browser_agents') then
    alter publication supabase_realtime add table public.browser_agents;
  end if;
end $$;
