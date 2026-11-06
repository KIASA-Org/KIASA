-- KIASA User Live Desk presence: who has the app open right now.
--
-- The 'desk' channel carries a small heartbeat ({ id, name }) every few seconds from each open
-- user desk. The admin listens and shows only those heard recently as "Members". Nothing is stored.
--   * Approved members and admins may join and beat.
-- Run once; running again is safe.

drop policy if exists "desk channel is shared by the team" on realtime.messages;
create policy "desk channel is shared by the team" on realtime.messages
  for select to authenticated
  using (
    realtime.topic() = 'desk'
    and realtime.messages.extension = 'broadcast'
    and (public.am_admin() or exists (select 1 from public.profiles where id = auth.uid() and status = 'approved'))
  );

drop policy if exists "desk channel is beaten by the team" on realtime.messages;
create policy "desk channel is beaten by the team" on realtime.messages
  for insert to authenticated
  with check (
    realtime.topic() = 'desk'
    and realtime.messages.extension = 'broadcast'
    and (public.am_admin() or exists (select 1 from public.profiles where id = auth.uid() and status = 'approved'))
  );
