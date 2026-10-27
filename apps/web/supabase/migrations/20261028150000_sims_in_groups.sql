-- Simulated members in groups: a team's manager (or the admin) may put them in
-- a group, as any of the team. They never write, and no one may open a
-- one-to-one chat with them. In a group, those who do not see simulated members
-- see neither them nor their number: not in its members, not in its count, not
-- in any notice. Run once, after the simulated members file. Running it again
-- is safe.

-- Their name in a chat again (for groups); a one-to-one chat with them stays impossible (below).
create or replace function public.chat_name_of(person uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select p.name from public.profiles p where p.id = person and p.status = 'approved'),
    (select a.name from public.admins a join auth.users u on lower(u.email) = a.email where u.id = person)
  );
$$;
revoke execute on function public.chat_name_of(uuid) from public, anon, authenticated;

-- No one talks with a simulated member one to one.
create or replace function public.may_talk(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not public.is_sim(a) and not public.is_sim(b) and (
    a = b
    or public.is_admin_user(a) or public.is_admin_user(b)
    or (public.team_of(a) is not null and public.team_of(a) = public.team_of(b) and not (public.is_top(a) and public.is_top(b)))
    or exists (select 1 from public.contact_requests r where r.status = 'approved'
      and ((r.from_user = a and r.to_user = b) or (r.from_user = b and r.to_user = a))));
$$;
revoke execute on function public.may_talk(uuid, uuid) from public, anon, authenticated;

create or replace function public.open_direct(other uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  my_name text := public.chat_name_of(auth.uid());
  their_name text := public.chat_name_of(other);
  found uuid;
begin
  if me is null or my_name is null or their_name is null or other = me or public.is_sim(other) or public.is_sim(me) then
    raise exception 'You cannot message that person.';
  end if;
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

-- A group's members, each seen only by those who may see them.
drop policy if exists "members read members" on public.chat_members;
create policy "members read members" on public.chat_members
  for select to authenticated using ((public.is_chat_member(chat_id) or public.admin_reads(chat_id)) and public.visible(user_id));

-- Every group by its size, counting only those the person asking may see.
create or replace function public.group_directory()
returns table (id uuid, title text, photo text, team_id uuid, members bigint)
language sql stable security definer set search_path = '' as $$
  select c.id, c.title, c.photo, c.team_id, count(m.user_id) filter (where public.visible(m.user_id))
  from public.chats c
  join public.chat_members m on m.chat_id = c.id
  where c.kind = 'group' and public.can_chat()
  group by c.id
  having count(m.user_id) filter (where public.visible(m.user_id)) > 0
  order by c.title;
$$;

-- A new group, and people added: the notice names only real people (a group
-- of simulated members alone says nothing of them).
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

create or replace function public.add_to_group(chat uuid, member_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  team uuid := (select c.team_id from public.chats c where c.id = chat);
  names text;
  added int;
begin
  if me is null or not public.is_chat_member(chat)
    or (select c.kind from public.chats c where c.id = chat) is distinct from 'group'
    or not (public.is_admin() or (team is not null and team = public.team_led_by(me))) then
    raise exception 'You can add people only to groups you run.';
  end if;
  if team is not null and exists (select 1 from unnest(member_ids) as picked(person) where public.team_of(picked.person) is distinct from team) then
    raise exception 'A team''s group is for its own people only.';
  end if;
  with put as (
    insert into public.chat_members (chat_id, user_id, name)
      select chat, picked.person, public.chat_name_of(picked.person) from unnest(member_ids) as picked(person)
      where public.chat_name_of(picked.person) is not null
      on conflict do nothing
      returning user_id, name
  ) select count(*), string_agg(put.name, ', ') filter (where not public.is_sim(put.user_id)) into added, names from put;
  if added = 0 then raise exception 'Please choose someone to add.'; end if;
  if names is not null then
    insert into public.messages (chat_id, kind, body) values (chat, 'notice', public.chat_name_of(me) || ' added ' || names || '.');
  end if;
end $$;
revoke execute on function public.add_to_group(uuid, uuid[]) from public, anon;
grant execute on function public.add_to_group(uuid, uuid[]) to authenticated;

-- Leaving a team leaves its groups; only a real person's leaving is told.
create or replace function public.team_member_moved() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.team_id = old.team_id then return new; end if;
  if not exists (select 1 from public.teams t where t.id = old.team_id) then return coalesce(new, old); end if;
  if not public.is_sim(old.user_id) then
    insert into public.messages (chat_id, kind, body)
      select m.chat_id, 'notice', m.name || ' is no longer in the team, and left the group.'
      from public.chat_members m join public.chats c on c.id = m.chat_id
      where c.team_id = old.team_id and m.user_id = old.user_id;
  end if;
  delete from public.chat_members m using public.chats c
    where c.id = m.chat_id and c.team_id = old.team_id and m.user_id = old.user_id;
  return coalesce(new, old);
end $$;
