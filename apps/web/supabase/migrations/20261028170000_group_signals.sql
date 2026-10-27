-- Groups, live: when a group is made, renamed, given a photo, or someone joins
-- or leaves one, a word on a private channel ("kiasa:groups", for everyone who
-- may chat) tells every open chat page to ask for the list of groups again
-- (names and sizes only; group_directory). The word itself says nothing of
-- which group. Run once, after the simulated members in groups file. Running
-- it again is safe.

create or replace function public.groups_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform realtime.send(jsonb_build_object('table', tg_table_name), 'changed', 'kiasa:groups', true);
  exception when others then null; -- a missed word never stops a write
  end;
  return null;
end $$;
revoke execute on function public.groups_changed() from public, anon, authenticated;

drop trigger if exists chat_members_groups on public.chat_members;
create trigger chat_members_groups after insert or delete on public.chat_members
  for each statement execute function public.groups_changed();
-- Only a new name or photo (a message moves a chat's time, which says nothing new about the group).
drop trigger if exists chats_groups on public.chats;
create trigger chats_groups after update of title, photo or delete on public.chats
  for each statement execute function public.groups_changed();

drop policy if exists "people who chat hear of groups" on realtime.messages;
create policy "people who chat hear of groups" on realtime.messages
  for select to authenticated using (realtime.topic() = 'kiasa:groups' and public.can_chat());
