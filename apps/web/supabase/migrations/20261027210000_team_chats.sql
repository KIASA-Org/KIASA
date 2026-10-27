-- KIASA Chat by team: who may message whom, groups for each team, a group's
-- name and photo, requests the admin approves, and the admin reading any chat
-- without it showing. Run once, after the teams file. Running it again is safe.
--
-- The rules, enforced here and not only on the page:
-- · KIASA's admins message anyone, and anyone may message them.
-- · People in the same team message each other freely, its manager included.
-- · Anyone else (another team's people, or one top manager and another) needs
--   a request the admin approves; then the two may talk.
-- · A team's manager makes groups for their own team, of its people only; they
--   and the admin rename a group and change its photo.
-- · The admin can read every group and one-to-one chat. They are not in it: no
--   name in its members, no read mark, no "typing…", nothing anyone else sees.

-- ── Who is who, asked without tripping the tables' own rules.
create or replace function public.is_admin_user(person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a join auth.users u on lower(u.email) = a.email where u.id = person);
$$;
create or replace function public.is_top(person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.top_managers t where t.user_id = person);
$$;
-- The team a person leads: a top manager's own team.
create or replace function public.team_led_by(person uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select tm.team_id from public.team_members tm join public.top_managers t on t.user_id = tm.user_id where tm.user_id = person;
$$;
revoke execute on function public.is_admin_user(uuid) from public, anon, authenticated;
revoke execute on function public.is_top(uuid) from public, anon, authenticated;
revoke execute on function public.team_led_by(uuid) from public, anon, authenticated;

-- Whether the person asking is one of KIASA's admins (for the rules below).
create or replace function public.am_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin();
$$;
revoke execute on function public.am_admin() from public, anon;
grant execute on function public.am_admin() to authenticated;

-- ── Requests to talk: one person asks to message another; the admin decides.
-- Only the site's server writes them, after checking who is asking.
create table if not exists public.contact_requests (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references auth.users (id) on delete cascade,
  to_user uuid not null references auth.users (id) on delete cascade,
  reason text not null default '' check (char_length(reason) <= 300),
  status text not null default 'waiting' check (status in ('waiting', 'approved', 'declined')),
  asked_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  check (from_user <> to_user)
);
-- One request waiting for any two people, whoever asked.
create unique index if not exists contact_requests_one_waiting on public.contact_requests
  (least(from_user, to_user), greatest(from_user, to_user)) where status = 'waiting';
create index if not exists contact_requests_from on public.contact_requests (from_user);
create index if not exists contact_requests_to on public.contact_requests (to_user);
alter table public.contact_requests enable row level security;
revoke all on public.contact_requests from anon;
revoke insert, update, delete on public.contact_requests from authenticated;
drop policy if exists "people see their own requests" on public.contact_requests;
create policy "people see their own requests" on public.contact_requests
  for select to authenticated using (from_user = auth.uid() or to_user = auth.uid() or public.am_admin());

-- The admins' chat where the requests arrive, one however many come at once.
create unique index if not exists chats_one_contact_chat on public.chats (title) where kind = 'notices' and title = 'Contact requests';

-- ── Whether two people may message each other directly.
create or replace function public.may_talk(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select a = b
    or public.is_admin_user(a) or public.is_admin_user(b)
    or (public.team_of(a) is not null and public.team_of(a) = public.team_of(b) and not (public.is_top(a) and public.is_top(b)))
    or exists (select 1 from public.contact_requests r where r.status = 'approved'
      and ((r.from_user = a and r.to_user = b) or (r.from_user = b and r.to_user = a)));
$$;
revoke execute on function public.may_talk(uuid, uuid) from public, anon, authenticated;

-- Whether the person asking may write in a chat: never in KIASA's notices; in
-- a one-to-one chat, only while the two may talk.
create or replace function public.may_write(chat uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case (select c.kind from public.chats c where c.id = chat)
    when 'notices' then false
    when 'direct' then not exists (select 1 from public.chat_members m
      where m.chat_id = chat and m.user_id <> auth.uid() and not public.may_talk(auth.uid(), m.user_id))
    when 'group' then true
    when 'saved' then true
    else false end;
$$;
revoke execute on function public.may_write(uuid) from public, anon;
grant execute on function public.may_write(uuid) to authenticated;

drop policy if exists "members send messages" on public.messages;
create policy "members send messages" on public.messages
  for insert to authenticated with check (
    sender_id = auth.uid() and kind = 'text' and public.can_chat() and public.is_chat_member(chat_id) and public.may_write(chat_id)
  );

-- ── A group's team and photo. A team's group is made by its manager, of its
-- people; its photo sits in the public "avatars" folder, as
-- "<chat id>/<random id>.<webp|jpg|png>".
alter table public.chats add column if not exists team_id uuid references public.teams (id) on delete set null;
alter table public.chats add column if not exists photo text check (photo ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg|png)$');

-- Who may rename a group and change its photo: KIASA's admins, and the
-- manager of the group's team.
create or replace function public.can_edit_group(chat uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.chats c where c.id = chat and c.kind = 'group'
    and (public.is_admin() or (c.team_id is not null and c.team_id = public.team_led_by(auth.uid()))));
$$;
revoke execute on function public.can_edit_group(uuid) from public, anon;
grant execute on function public.can_edit_group(uuid) to authenticated;

-- Whether this person runs a chat: its owner, one of KIASA's admins in it, or
-- the manager of its team in it.
create or replace function public.runs_chat(chat uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.chat_members m join public.chats c on c.id = m.chat_id
    where m.chat_id = chat and m.user_id = auth.uid()
      and (m.role = 'owner' or public.is_admin() or (c.team_id is not null and c.team_id = public.team_led_by(auth.uid()))));
$$;
revoke execute on function public.runs_chat(uuid) from public, anon, authenticated;

-- ── The admin reading a chat they are not in: a group or a one-to-one chat
-- (never anyone's Saved Messages, or their notices from KIASA).
create or replace function public.admin_reads(chat uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() and not public.is_chat_member(chat)
    and coalesce((select c.kind in ('group', 'direct') from public.chats c where c.id = chat), false);
$$;
revoke execute on function public.admin_reads(uuid) from public, anon;
grant execute on function public.admin_reads(uuid) to authenticated;

drop policy if exists "members read chats" on public.chats;
create policy "members read chats" on public.chats
  for select to authenticated using (public.is_chat_member(id) or public.admin_reads(id));
drop policy if exists "members read members" on public.chat_members;
create policy "members read members" on public.chat_members
  for select to authenticated using (public.is_chat_member(chat_id) or public.admin_reads(chat_id));
drop policy if exists "members read messages" on public.messages;
create policy "members read messages" on public.messages
  for select to authenticated using (public.can_see_message(chat_id, id, created_at) or public.admin_reads(chat_id));

-- Files and pictures in a chat the admin reads.
create or replace function public.admin_reads_file(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when split_part(object_name, '/', 1) ~ '^[0-9a-f-]{36}$'
    then public.admin_reads(split_part(object_name, '/', 1)::uuid) else false end;
$$;
revoke execute on function public.admin_reads_file(text) from public, anon;
grant execute on function public.admin_reads_file(text) to authenticated;
drop policy if exists "members read chat files" on storage.objects;
create policy "members read chat files" on storage.objects
  for select to authenticated using (bucket_id = 'chat-files' and (public.chat_file_readable(name) or public.admin_reads_file(name)));

-- A group's photo file, written by those who may change it.
create or replace function public.edits_group_folder(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when split_part(object_name, '/', 1) ~ '^[0-9a-f-]{36}$'
    then public.can_edit_group(split_part(object_name, '/', 1)::uuid) else false end;
$$;
revoke execute on function public.edits_group_folder(text) from public, anon;
grant execute on function public.edits_group_folder(text) to authenticated;
drop policy if exists "group editors add group photo files" on storage.objects;
create policy "group editors add group photo files" on storage.objects
  for insert to authenticated with check (bucket_id = 'avatars' and public.edits_group_folder(name));
drop policy if exists "group editors find group photo files" on storage.objects;
create policy "group editors find group photo files" on storage.objects
  for select to authenticated using (bucket_id = 'avatars' and public.edits_group_folder(name));
drop policy if exists "group editors remove group photo files" on storage.objects;
create policy "group editors remove group photo files" on storage.objects
  for delete to authenticated using (bucket_id = 'avatars' and public.edits_group_folder(name));

-- ── The chat list, now with each group's photo and team. It replaces inbox.
drop function if exists public.inbox();
create or replace function public.inbox()
returns table (id uuid, kind text, title text, last_message_at timestamptz, unread bigint,
  last_body text, last_sender uuid, last_kind text, last_file text, members jsonb,
  pinned_at timestamptz, muted boolean, archived boolean, marked_unread boolean, photo text, team_id uuid)
language sql stable security invoker set search_path = '' as $$
  select c.id, c.kind, c.title, coalesce(l.created_at, c.created_at),
    (select count(*) from public.messages m
      where m.chat_id = c.id and m.created_at > me.last_read_at and m.sender_id is distinct from auth.uid() and m.deleted_at is null),
    l.body, l.sender_id, l.kind,
    case when l.attachment ? 'path' then l.attachment ->> 'name' end,
    (select coalesce(jsonb_agg(jsonb_build_object('chat_id', cm.chat_id, 'user_id', cm.user_id, 'name', cm.name, 'role', cm.role, 'last_read_at', cm.last_read_at)), '[]'::jsonb)
      from public.chat_members cm where cm.chat_id = c.id),
    s.pinned_at, coalesce(s.muted, false), coalesce(s.archived, false), coalesce(s.marked_unread, false),
    c.photo, c.team_id
  from public.chat_members me
  join public.chats c on c.id = me.chat_id
  left join public.chat_settings s on s.chat_id = c.id and s.user_id = me.user_id
  left join lateral (
    select m.body, m.sender_id, m.kind, m.attachment, m.created_at from public.messages m
    where m.chat_id = c.id and m.deleted_at is null order by m.created_at desc limit 1
  ) l on true
  where me.user_id = auth.uid()
    and (s.hidden_at is null or coalesce(l.created_at, c.created_at) > s.hidden_at)
  order by s.pinned_at desc nulls last, coalesce(l.created_at, c.created_at) desc;
$$;
revoke execute on function public.inbox() from public, anon;
grant execute on function public.inbox() to authenticated;

-- Every chat the admin is not in, as the chat list gives chats: for the
-- admin's own "All chats" view. Nothing in it is marked read.
create or replace function public.all_chats()
returns table (id uuid, kind text, title text, last_message_at timestamptz, unread bigint,
  last_body text, last_sender uuid, last_kind text, last_file text, members jsonb,
  pinned_at timestamptz, muted boolean, archived boolean, marked_unread boolean, photo text, team_id uuid)
language sql stable security invoker set search_path = '' as $$
  select c.id, c.kind, c.title, coalesce(l.created_at, c.created_at), 0::bigint,
    l.body, l.sender_id, l.kind,
    case when l.attachment ? 'path' then l.attachment ->> 'name' end,
    (select coalesce(jsonb_agg(jsonb_build_object('chat_id', cm.chat_id, 'user_id', cm.user_id, 'name', cm.name, 'role', cm.role, 'last_read_at', cm.last_read_at)), '[]'::jsonb)
      from public.chat_members cm where cm.chat_id = c.id),
    null::timestamptz, false, false, false, c.photo, c.team_id
  from public.chats c
  left join lateral (
    select m.body, m.sender_id, m.kind, m.attachment, m.created_at from public.messages m
    where m.chat_id = c.id and m.deleted_at is null order by m.created_at desc limit 1
  ) l on true
  where public.admin_reads(c.id) and exists (select 1 from public.chat_members cm where cm.chat_id = c.id)
  order by coalesce(l.created_at, c.created_at) desc;
$$;
revoke execute on function public.all_chats() from public, anon;
grant execute on function public.all_chats() to authenticated;

-- ── A one-to-one chat: the one there is, or, while the two may talk, a new one.
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
  if found is not null then
    update public.chat_settings set hidden_at = null where chat_id = found and user_id = me and hidden_at is not null;
    return found;
  end if;
  if not public.may_talk(me, other) then
    raise exception using message = 'Messaging ' || their_name || ' needs the admin''s approval.', hint = 'ask';
  end if;
  insert into public.chats (kind, created_by) values ('direct', me) returning id into found;
  insert into public.chat_members (chat_id, user_id, name) values (found, me, my_name), (found, other, their_name);
  return found;
end $$;
revoke execute on function public.open_direct(uuid) from public, anon;
grant execute on function public.open_direct(uuid) to authenticated;

-- ── A new group: by an admin, with anyone who may chat; or by a team's
-- manager, for their team, with its people only.
create or replace function public.create_group(group_title text, member_ids uuid[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  my_name text := public.chat_name_of(auth.uid());
  group_name text := left(btrim(coalesce(group_title, '')), 80);
  team uuid := null;
  made uuid;
  added int;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  if not public.is_admin() then
    team := public.team_led_by(me);
    if team is null then raise exception 'Only KIASA''s admins and team managers can make groups.'; end if;
    if exists (select 1 from unnest(member_ids) as picked(person) where picked.person <> me and public.team_of(picked.person) is distinct from team) then
      raise exception 'A team''s group is for its own people only.';
    end if;
  end if;
  if group_name = '' then raise exception 'Please give the group a name.'; end if;
  insert into public.chats (kind, title, created_by, team_id) values ('group', group_name, me, team) returning id into made;
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

-- Adding people to a group one is in: an admin, anyone; the manager of a
-- team's group, its people.
create or replace function public.add_to_group(chat uuid, member_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  team uuid := (select c.team_id from public.chats c where c.id = chat);
  names text;
begin
  if me is null or not public.is_chat_member(chat)
    or (select c.kind from public.chats c where c.id = chat) is distinct from 'group'
    or not (public.is_admin() or (team is not null and team = public.team_led_by(me))) then
    raise exception 'You can add people only to groups you run.';
  end if;
  if team is not null and exists (select 1 from unnest(member_ids) as picked(person) where public.team_of(picked.person) is distinct from team) then
    raise exception 'A team''s group is for its own people only.';
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

-- Renaming a group and changing its photo. Its members are told, by name when
-- the one changing it is in the group; the admin, reading unseen, is not named.
-- Gives back the photo it had, so its file can go.
create or replace function public.edit_group(chat uuid, new_title text default null, new_photo text default null, change_photo boolean default false)
returns text
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  before record;
  named text;
  tidy text := left(btrim(regexp_replace(coalesce(new_title, ''), '\s+', ' ', 'g')), 80);
begin
  if me is null or not public.can_edit_group(chat) then raise exception 'Only the admin and the team''s manager can change this group.'; end if;
  select c.title, c.photo into before from public.chats c where c.id = chat for update;
  named := case when public.is_chat_member(chat) then public.chat_name_of(me) end;
  if new_title is not null and tidy = '' then raise exception 'Please give the group a name.'; end if;
  if new_title is not null and tidy is distinct from before.title then
    update public.chats set title = tidy where id = chat;
    insert into public.messages (chat_id, kind, body) values (chat, 'notice',
      coalesce(named || ' renamed the group to "' || tidy || '".', 'The group is now called "' || tidy || '".'));
  end if;
  if change_photo and new_photo is distinct from before.photo then
    if new_photo is not null and split_part(new_photo, '/', 1) <> chat::text then raise exception 'That photo is not this group''s.'; end if;
    update public.chats set photo = new_photo where id = chat;
    insert into public.messages (chat_id, kind, body) values (chat, 'notice', case
      when new_photo is null then coalesce(named || ' removed the group photo.', 'The group photo was removed.')
      else coalesce(named || ' changed the group photo.', 'The group has a new photo.') end);
    return before.photo;
  end if;
  return null;
end $$;
revoke execute on function public.edit_group(uuid, text, text, boolean) from public, anon;
grant execute on function public.edit_group(uuid, text, text, boolean) to authenticated;

-- Forwarding, now only into a chat one may write in.
create or replace function public.forward_messages(ids uuid[], target uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  sent integer;
begin
  if me is null or not public.can_chat() or not public.is_chat_member(target) or not public.may_write(target) then
    raise exception 'You cannot send messages there.';
  end if;
  insert into public.messages (chat_id, sender_id, kind, body, attachment, forwarded, created_at)
    select target, me, 'text', m.body, m.attachment,
      coalesce(m.forwarded, jsonb_build_object('name', coalesce(
        (select cm.name from public.chat_members cm where cm.chat_id = m.chat_id and cm.user_id = m.sender_id),
        public.chat_name_of(m.sender_id), 'KIASA'))),
      clock_timestamp()
    from public.messages m
    where m.id = any(ids) and m.kind = 'text' and m.deleted_at is null and public.can_see_message(m.chat_id, m.id, m.created_at)
    order by m.created_at;
  get diagnostics sent = row_count;
  return sent;
end $$;

-- ── Someone leaving a team leaves its groups, and its members are told.
-- (A team deleted leaves its groups as ordinary groups, everyone still in them.)
create or replace function public.team_member_moved() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.team_id = old.team_id then return new; end if;
  if not exists (select 1 from public.teams t where t.id = old.team_id) then return coalesce(new, old); end if;
  insert into public.messages (chat_id, kind, body)
    select m.chat_id, 'notice', m.name || ' is no longer in the team, and left the group.'
    from public.chat_members m join public.chats c on c.id = m.chat_id
    where c.team_id = old.team_id and m.user_id = old.user_id;
  delete from public.chat_members m using public.chats c
    where c.id = m.chat_id and c.team_id = old.team_id and m.user_id = old.user_id;
  return coalesce(new, old);
end $$;
drop trigger if exists team_members_moved on public.team_members;
create trigger team_members_moved after update or delete on public.team_members for each row execute function public.team_member_moved();

-- A request made or decided reaches both people, and the admins, at once.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'contact_requests') then
    alter publication supabase_realtime add table public.contact_requests;
  end if;
end $$;
