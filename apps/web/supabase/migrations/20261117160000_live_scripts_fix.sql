-- KIASA: live scripts work again for admins. Run once, after every earlier file.
-- Running it again is safe.
--
-- The live script's rules asked is_admin(), which also asks that this very
-- sign-in be one the site approved on an admin's device (admin_session_ok). A
-- sign-in the site does not count so (another address, as the test copy on
-- this computer, or one from before the device lock) could then neither say its
-- script is on, nor see the list, nor send or read the words: "Live now (0)"
-- with the script on. Which sign-ins may act as an admin at all is the access
-- token hook's to decide (an admin's sign-in on a device not approved gets no
-- signed-in access); here, being an admin's account is enough.

create or replace function public.admin_account() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;
revoke execute on function public.admin_account() from public, anon;
grant execute on function public.admin_account() to authenticated;

-- An admin says their own script is on.
drop policy if exists "members say their script is on" on public.live_sessions;
create policy "members say their script is on" on public.live_sessions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select public.admin_account()));

-- Admins see whose script is on.
drop policy if exists "admins see live scripts" on public.live_sessions;
create policy "admins see live scripts" on public.live_sessions
  for select to authenticated
  using ((select public.admin_account()) and seen_at > now() - interval '90 seconds');

-- The channel: its owner (an admin), or another admin while that script is on.
create or replace function public.live_script_allowed(topic text) returns boolean
language sql stable security definer set search_path = '' as $$
  select topic ~ '^live-script:[0-9a-f-]{36}$' and public.admin_account() and (
    substring(topic from 13)::uuid = auth.uid()
    or exists (
      select 1 from public.live_sessions s
      where s.user_id = substring(topic from 13)::uuid and s.seen_at > now() - interval '90 seconds'));
$$;
revoke execute on function public.live_script_allowed(text) from public, anon;
grant execute on function public.live_script_allowed(text) to authenticated;
