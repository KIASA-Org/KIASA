-- KIASA: live sounds work again for admins. Run once, after every earlier file
-- (it uses admin_account() from 20261117160000_live_scripts_fix.sql, and makes
-- it again if that has not been run). Running it again is safe.
--
-- As live scripts did, live sounds asked is_admin() (and jobs_admin(), through
-- jobs_team()), which also ask that this very sign-in be one the site approved
-- on an admin's device. A sign-in it does not count so could neither see who
-- shares, nor listen, nor share its own sound. Which sign-ins may act as an admin
-- at all is the access token hook's to decide; here, an admin's account is enough.

create or replace function public.admin_account() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;
revoke execute on function public.admin_account() from public, anon;
grant execute on function public.admin_account() to authenticated;

-- A member (or an admin) says their own sound is shared.
drop policy if exists "members say their sound is shared" on public.sound_shares;
create policy "members say their sound is shared" on public.sound_shares
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and ((select public.jobs_member()) or (select public.admin_account())));

-- Admins see who shares.
drop policy if exists "admins see who shares sound" on public.sound_shares;
create policy "admins see who shares sound" on public.sound_shares
  for select to authenticated
  using ((select public.admin_account()) and seen_at > now() - interval '90 seconds');

-- The channel: the one sharing, or an admin while they share.
create or replace function public.sound_allowed(topic text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when topic ~ '^sound:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    (substring(topic from 7)::uuid = auth.uid() and (public.jobs_member() or public.admin_account()))
    or (public.admin_account() and exists (
      select 1 from public.sound_shares s
      where s.user_id = substring(topic from 7)::uuid and s.seen_at > now() - interval '90 seconds'))
  else false end;
$$;
revoke execute on function public.sound_allowed(text) from public, anon;
grant execute on function public.sound_allowed(text) to authenticated;
