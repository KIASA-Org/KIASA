-- A member's computer sound, shared with KIASA's admins.
--
-- A member clicks Share sound, any time. While it is on, a row here says so, and
-- KIASA's admins can listen. The member's page says so on every page, for as long
-- as it is on. The sound itself goes straight between the two browsers and is never
-- stored. They find each other over a private channel, sound:<member's id>, which
-- only that member and KIASA's admins can use: another member cannot join it, so
-- cannot ask for the sound.
--
-- A row is kept fresh by the member's own page: once that page has closed, the row
-- goes stale and admins can no longer see it or the channel (90 seconds).
-- Run once, after the live script file. Running it again is safe.

create table if not exists public.sound_shares (
  user_id uuid primary key references auth.users (id) on delete cascade,
  started_at timestamptz not null default now(),
  seen_at timestamptz not null default now()
);
alter table public.sound_shares enable row level security;

-- The database's own clock, as for live scripts.
drop trigger if exists sound_shares_stamp on public.sound_shares;
create trigger sound_shares_stamp before insert or update on public.sound_shares
  for each row execute function public.live_sessions_stamp();

-- A member says their own sound is shared; no one else can say it for them.
drop policy if exists "members say their sound is shared" on public.sound_shares;
create policy "members say their sound is shared" on public.sound_shares
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select public.jobs_team()));

drop policy if exists "admins see who shares sound" on public.sound_shares;
create policy "admins see who shares sound" on public.sound_shares
  for select to authenticated
  using ((select public.am_admin()) and seen_at > now() - interval '90 seconds');

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sound_shares') then
    alter publication supabase_realtime add table public.sound_shares;
  end if;
end $$;

-- May this person use the channel of this member's sound? The member, or an admin
-- while that member is sharing. No one else. (`case`, so that any other channel's
-- name is never taken for an id.)
create or replace function public.sound_allowed(topic text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when topic ~ '^sound:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    (substring(topic from 7)::uuid = auth.uid() and public.jobs_team())
    or (public.is_admin() and exists (
      select 1 from public.sound_shares s
      where s.user_id = substring(topic from 7)::uuid and s.seen_at > now() - interval '90 seconds'))
  else false end;
$$;
revoke execute on function public.sound_allowed(text) from public, anon;
grant execute on function public.sound_allowed(text) to authenticated;

drop policy if exists "sound channel read" on realtime.messages;
create policy "sound channel read" on realtime.messages
  for select to authenticated
  using (realtime.messages.extension = 'broadcast' and public.sound_allowed(realtime.topic()));
drop policy if exists "sound channel send" on realtime.messages;
create policy "sound channel send" on realtime.messages
  for insert to authenticated
  with check (realtime.messages.extension = 'broadcast' and public.sound_allowed(realtime.topic()));
