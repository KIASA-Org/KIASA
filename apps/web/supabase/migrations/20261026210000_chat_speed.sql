-- KIASA Chat, faster: the chat list with who is in each chat in one answer,
-- the latest messages of the newest chats in one answer, and making a chat or a
-- group in one trip to the database instead of several. Run once, after the
-- chat file. Running it again is safe.

-- How a person appears in chats: their approved request's name, or their name
-- as one of KIASA's admins. Null for anyone who may not chat. Used only by the
-- functions below.
create or replace function public.chat_name_of(person uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select p.name from public.profiles p where p.id = person and p.status = 'approved'),
    (select a.name from public.admins a join auth.users u on lower(u.email) = a.email where u.id = person)
  );
$$;
revoke execute on function public.chat_name_of(uuid) from public, anon, authenticated;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.email = auth.jwt() ->> 'email');
$$;
revoke execute on function public.is_admin() from public, anon, authenticated;

-- The chat list in one answer: each of my chats, its last message, how many I
-- have not read, and who is in it. It replaces my_chats.
create or replace function public.chat_list()
returns table (id uuid, kind text, title text, last_message_at timestamptz, unread bigint,
  last_body text, last_sender uuid, last_kind text, last_deleted boolean, last_file text, members jsonb)
language sql stable security invoker set search_path = '' as $$
  select c.id, c.kind, c.title, c.last_message_at,
    (select count(*) from public.messages m
      where m.chat_id = c.id and m.created_at > me.last_read_at and m.sender_id is distinct from auth.uid() and m.deleted_at is null),
    l.body, l.sender_id, l.kind, l.deleted_at is not null,
    -- A file's name; a notice's details are not a file.
    case when l.attachment ? 'path' then l.attachment ->> 'name' end,
    (select coalesce(jsonb_agg(jsonb_build_object('chat_id', cm.chat_id, 'user_id', cm.user_id, 'name', cm.name, 'role', cm.role, 'last_read_at', cm.last_read_at)), '[]'::jsonb)
      from public.chat_members cm where cm.chat_id = c.id)
  from public.chat_members me
  join public.chats c on c.id = me.chat_id
  left join lateral (
    select m.body, m.sender_id, m.kind, m.deleted_at, m.attachment from public.messages m
    where m.chat_id = c.id order by m.created_at desc limit 1
  ) l on true
  where me.user_id = auth.uid()
  order by c.last_message_at desc;
$$;
revoke execute on function public.chat_list() from public, anon;
grant execute on function public.chat_list() to authenticated;
drop function if exists public.my_chats();

-- The latest messages of several chats (up to 20) in one answer, so they open
-- at once. The messages' own rules decide which can be read.
create or replace function public.recent_messages(chat_ids uuid[], per_chat int default 30)
returns setof public.messages
language sql stable security invoker set search_path = '' as $$
  select m.* from unnest(chat_ids[1:20]) as asked(id)
  cross join lateral (
    select * from public.messages x where x.chat_id = asked.id
    order by x.created_at desc limit least(greatest(per_chat, 1), 100)
  ) m;
$$;
revoke execute on function public.recent_messages(uuid[], int) from public, anon;
grant execute on function public.recent_messages(uuid[], int) to authenticated;

-- A one-to-one chat with someone who may chat: the one there is, or a new one.
create or replace function public.open_direct(other uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  my_name text := public.chat_name_of(auth.uid());
  their_name text := public.chat_name_of(other);
  found uuid;
begin
  if me is null or my_name is null or their_name is null or other = me then
    raise exception 'You cannot message that person.';
  end if;
  -- Two people opening the same chat at once still get one chat.
  perform pg_advisory_xact_lock(hashtext(least(me::text, other::text) || greatest(me::text, other::text)));
  select c.id into found from public.chats c
    join public.chat_members a on a.chat_id = c.id and a.user_id = me
    join public.chat_members b on b.chat_id = c.id and b.user_id = other
    where c.kind = 'direct' limit 1;
  if found is not null then return found; end if;
  insert into public.chats (kind, created_by) values ('direct', me) returning id into found;
  insert into public.chat_members (chat_id, user_id, name) values (found, me, my_name), (found, other, their_name);
  return found;
end $$;
revoke execute on function public.open_direct(uuid) from public, anon;
grant execute on function public.open_direct(uuid) to authenticated;

-- A new group, made by an admin, with the people who may chat among those chosen.
create or replace function public.create_group(group_title text, member_ids uuid[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  my_name text := public.chat_name_of(auth.uid());
  group_name text := left(btrim(coalesce(group_title, '')), 80);
  made uuid;
  added int;
begin
  if me is null or not public.is_admin() then raise exception 'Only KIASA''s admins can make groups.'; end if;
  if group_name = '' then raise exception 'Please give the group a name.'; end if;
  insert into public.chats (kind, title, created_by) values ('group', group_name, me) returning id into made;
  insert into public.chat_members (chat_id, user_id, name, role) values (made, me, my_name, 'owner');
  insert into public.chat_members (chat_id, user_id, name)
    select made, picked.person, public.chat_name_of(picked.person) from unnest(member_ids) as picked(person)
    where picked.person <> me and public.chat_name_of(picked.person) is not null
    on conflict do nothing;
  get diagnostics added = row_count;
  if added = 0 then raise exception 'Please add at least one person.'; end if;
  insert into public.messages (chat_id, kind, body) values (made, 'notice', my_name || ' made the group "' || group_name || '".');
  return made;
end $$;
revoke execute on function public.create_group(text, uuid[]) from public, anon;
grant execute on function public.create_group(text, uuid[]) to authenticated;

-- Adding people to a group: by an admin who is in it.
create or replace function public.add_to_group(chat uuid, member_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  names text;
begin
  if me is null or not public.is_admin() or not public.is_chat_member(chat)
    or (select c.kind from public.chats c where c.id = chat) is distinct from 'group' then
    raise exception 'You can add people only to groups you are in.';
  end if;
  with added as (
    insert into public.chat_members (chat_id, user_id, name)
      select chat, picked.person, public.chat_name_of(picked.person) from unnest(member_ids) as picked(person)
      where public.chat_name_of(picked.person) is not null
      on conflict do nothing
      returning name
  ) select string_agg(added.name, ', ') into names from added;
  if names is null then raise exception 'Please choose someone to add.'; end if;
  insert into public.messages (chat_id, kind, body) values (chat, 'notice', public.chat_name_of(me) || ' added ' || names || '.');
end $$;
revoke execute on function public.add_to_group(uuid, uuid[]) from public, anon;
grant execute on function public.add_to_group(uuid, uuid[]) to authenticated;
