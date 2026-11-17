-- KIASA: live capture (the Interview page's live script) for admins only.
-- Run once, after every earlier file. Running it again is safe.
--
-- Members no longer turn a live script on: only an admin's own page may say a
-- script is on (live_sessions) or send on a live-script channel. Admins still
-- read any live script on the Live scripts page. To give members live capture
-- back, run 20261101130000_live_sessions.sql again.

drop policy if exists "members say their script is on" on public.live_sessions;
create policy "members say their script is on" on public.live_sessions
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select public.is_admin()));

-- The channel: its owner (an admin), or another admin while that script is on.
create or replace function public.live_script_allowed(topic text) returns boolean
language sql stable security definer set search_path = '' as $$
  select topic ~ '^live-script:[0-9a-f-]{36}$' and public.is_admin() and (
    substring(topic from 13)::uuid = auth.uid()
    or exists (
      select 1 from public.live_sessions s
      where s.user_id = substring(topic from 13)::uuid and s.seen_at > now() - interval '90 seconds'));
$$;
revoke execute on function public.live_script_allowed(text) from public, anon;
grant execute on function public.live_script_allowed(text) to authenticated;

-- Members' scripts that were on stop showing at once.
delete from public.live_sessions s where not exists (select 1 from public.admins a where a.user_id = s.user_id);
