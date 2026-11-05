-- KIASA User Live Desk: what an admin types, shown in real time to a chosen user.
--
-- Channel: notify:<user_id>  (user_id is a UUID, so the channel name is 43 chars: 7 + 36)
--   * Heard only by the user whose id matches the channel suffix, or any admin.
--   * Only an admin may send on it.
-- Nothing is stored. Run once; running again is safe.

drop policy if exists "notify channel is heard by the user" on realtime.messages;
create policy "notify channel is heard by the user" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() ~ '^notify:[0-9a-f-]{36}$'
    and (auth.uid()::text = substring(realtime.topic() from 8) or public.am_admin())
  );

drop policy if exists "notify channel is sent by admins" on realtime.messages;
create policy "notify channel is sent by admins" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() ~ '^notify:[0-9a-f-]{36}$'
    and public.am_admin()
  );
