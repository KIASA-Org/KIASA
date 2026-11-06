-- KIASA Say: what an admin types, shown at once to the people of a meeting.
--
-- The text travels on a private live channel of its own, "say:<meeting id>".
--   * It is heard only by people invited to that meeting (the same rule as the meeting's own
--     channel: invited, and not waiting for an admin's OK). Anyone else cannot join the channel.
--   * Only an admin on an approved device (am_admin) may send on it.
-- Nothing is stored: the words are not written to any table. Run once, after the meeting files.
-- Running it again is safe.

drop policy if exists "say channel is heard by the meeting" on realtime.messages;
create policy "say channel is heard by the meeting" on realtime.messages
  for select to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() ~ '^say:[0-9a-f-]{36}$'
    and (public.meeting_member(substring(realtime.topic() from 5)::uuid) or public.am_admin())
  );

drop policy if exists "say channel is sent by admins" on realtime.messages;
create policy "say channel is sent by admins" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() ~ '^say:[0-9a-f-]{36}$'
    and public.am_admin()
  );
