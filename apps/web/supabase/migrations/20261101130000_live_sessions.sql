-- Live scripts on the Interview page, as KIASA's admins see them.
--
-- While a member has their live script on, a row here says so, and KIASA's
-- admins can read that script. The words themselves are never stored: they go
-- over a private channel, live-script:<their id>, which only that member and
-- KIASA's admins can use. The member's page shows them that an admin can read
-- it, for as long as it is on.
--
-- A row is kept fresh by the member's own page: once that page has closed, the
-- row goes stale and admins can no longer see it or the channel (90 seconds).

create table if not exists public.live_sessions (
  user_id uuid primary key references auth.users (id) on delete cascade,
  started_at timestamptz not null default now(),
  seen_at timestamptz not null default now()
);
alter table public.live_sessions enable row level security;

-- The database's own clock, so no one's wrong clock can matter.
create or replace function public.live_sessions_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.seen_at := now();
  if tg_op = 'INSERT' then new.started_at := now(); else new.started_at := old.started_at; end if;
  return new;
end $$;
drop trigger if exists live_sessions_stamp on public.live_sessions;
create trigger live_sessions_stamp before insert or update on public.live_sessions
  for each row execute function public.live_sessions_stamp();

-- A member says their own script is on; no one else can say it for them.
drop policy if exists "members say their script is on" on public.live_sessions;
create policy "members say their script is on" on public.live_sessions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select public.jobs_team()));

drop policy if exists "admins see live scripts" on public.live_sessions;
create policy "admins see live scripts" on public.live_sessions
  for select to authenticated
  using ((select public.am_admin()) and seen_at > now() - interval '90 seconds');

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'live_sessions') then
    alter publication supabase_realtime add table public.live_sessions;
  end if;
end $$;

-- May this person use the channel of this member's script? The member, or an
-- admin while that member's script is on.
create or replace function public.live_script_allowed(topic text) returns boolean
language sql stable security definer set search_path = '' as $$
  select topic ~ '^live-script:[0-9a-f-]{36}$' and (
    substring(topic from 13)::uuid = auth.uid()
    or (public.is_admin() and exists (
      select 1 from public.live_sessions s
      where s.user_id = substring(topic from 13)::uuid and s.seen_at > now() - interval '90 seconds'))
  );
$$;
revoke execute on function public.live_script_allowed(text) from public, anon;
grant execute on function public.live_script_allowed(text) to authenticated;

drop policy if exists "live script channel read" on realtime.messages;
create policy "live script channel read" on realtime.messages
  for select to authenticated using (public.live_script_allowed(realtime.topic()));
drop policy if exists "live script channel send" on realtime.messages;
create policy "live script channel send" on realtime.messages
  for insert to authenticated with check (public.live_script_allowed(realtime.topic()));
