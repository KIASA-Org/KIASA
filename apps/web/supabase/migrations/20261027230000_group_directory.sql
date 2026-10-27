-- KIASA Chat: every group, by name, photo and how many are in it, for
-- everyone who may chat, as Discord shows a server's channels. What is said in
-- a group stays with its members (and the admin, reading unseen): this gives
-- no message and no member's name. Run once, after the team chats file.
-- Running it again is safe.

create or replace function public.group_directory()
returns table (id uuid, title text, photo text, team_id uuid, members bigint)
language sql stable security definer set search_path = '' as $$
  select c.id, c.title, c.photo, c.team_id, count(m.user_id)
  from public.chats c
  join public.chat_members m on m.chat_id = c.id
  where c.kind = 'group' and public.can_chat()
  group by c.id
  order by c.title;
$$;
revoke execute on function public.group_directory() from public, anon;
grant execute on function public.group_directory() to authenticated;
