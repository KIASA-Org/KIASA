-- KIASA Chat, more of Telegram: deleting messages for yourself or for everyone,
-- clearing a chat's history, deleting or leaving chats, reactions, pinned
-- messages, chats pinned, muted, archived or marked unread, forwarding, Saved
-- Messages, last seen, and a profile (username and bio). Run once, after the
-- photos file. Running it again is safe.

-- ── Each person's own view of a chat: theirs alone, never shown to the others.
create table if not exists public.chat_settings (
  chat_id uuid not null,
  user_id uuid not null,
  pinned_at timestamptz,
  muted boolean not null default false,
  archived boolean not null default false,
  marked_unread boolean not null default false,
  -- Messages sent before this are gone for them ("clear history").
  cleared_at timestamptz,
  -- Out of their list until a newer message arrives ("delete chat").
  hidden_at timestamptz,
  primary key (chat_id, user_id),
  foreign key (chat_id, user_id) references public.chat_members (chat_id, user_id) on delete cascade
);
alter table public.chat_settings enable row level security;
revoke all on public.chat_settings from anon, authenticated;
grant select on public.chat_settings to authenticated;
drop policy if exists "people read their own view of chats" on public.chat_settings;
create policy "people read their own view of chats" on public.chat_settings
  for select to authenticated using (user_id = auth.uid());

-- ── Messages deleted for one person only.
create table if not exists public.message_hides (
  user_id uuid not null references auth.users (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  primary key (user_id, message_id)
);
alter table public.message_hides enable row level security;
revoke all on public.message_hides from anon, authenticated;

-- ── Reactions, pins and forwarding live on the message, so each change to them
-- reaches everyone with it, live. Only the functions below write them.
alter table public.messages add column if not exists reactions jsonb not null default '{}'::jsonb;
alter table public.messages add column if not exists pinned_at timestamptz;
alter table public.messages add column if not exists forwarded jsonb;
create index if not exists messages_attachment_path on public.messages ((attachment ->> 'path'));

-- ── Saved Messages: a chat of one.
alter table public.chats drop constraint if exists chats_kind_check;
alter table public.chats add constraint chats_kind_check check (kind in ('group', 'direct', 'notices', 'saved'));
create unique index if not exists chats_one_saved on public.chats (created_by) where kind = 'saved';

-- ── When each person was last here, and how they present themselves.
create table if not exists public.seen (
  user_id uuid primary key references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create table if not exists public.chat_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text unique check (username ~ '^[a-z0-9_]{5,32}$'),
  bio text not null default '' check (char_length(bio) <= 140)
);
alter table public.seen enable row level security;
alter table public.chat_profiles enable row level security;
revoke all on public.seen, public.chat_profiles from anon, authenticated;
grant select on public.seen, public.chat_profiles to authenticated;
drop policy if exists "people who chat see when others were here" on public.seen;
create policy "people who chat see when others were here" on public.seen
  for select to authenticated using (public.can_chat());
drop policy if exists "people who chat see each other's profiles" on public.chat_profiles;
create policy "people who chat see each other's profiles" on public.chat_profiles
  for select to authenticated using (public.can_chat());

-- ── Who sees a message: the people in its chat, unless they cleared the
-- history past it or deleted it for themselves.
create or replace function public.can_see_message(chat uuid, message uuid, sent timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_chat_member(chat)
    and not exists (select 1 from public.chat_settings s
      where s.chat_id = chat and s.user_id = auth.uid() and s.cleared_at is not null and sent <= s.cleared_at)
    and not exists (select 1 from public.message_hides h where h.user_id = auth.uid() and h.message_id = message);
$$;
revoke execute on function public.can_see_message(uuid, uuid, timestamptz) from public, anon;
grant execute on function public.can_see_message(uuid, uuid, timestamptz) to authenticated;
drop policy if exists "members read messages" on public.messages;
create policy "members read messages" on public.messages
  for select to authenticated using (public.can_see_message(chat_id, id, created_at));

-- A file can be read in its own chat, and wherever it was forwarded to.
create or replace function public.chat_file_readable(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.chat_file_member(object_name)
    or exists (select 1 from public.messages m
      where m.attachment ->> 'path' = object_name and m.deleted_at is null and public.can_see_message(m.chat_id, m.id, m.created_at));
$$;
drop policy if exists "members read chat files" on storage.objects;
create policy "members read chat files" on storage.objects
  for select to authenticated using (bucket_id = 'chat-files' and public.chat_file_readable(name));

-- A message deleted for everyone keeps only that it was deleted.
create or replace function public.message_changed() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    new.deleted_at := now();
    new.body := '';
    new.attachment := null;
    new.reactions := '{}'::jsonb;
    new.pinned_at := null;
  elsif old.deleted_at is not null then
    return old;
  elsif new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end $$;

-- Whether this person runs a chat: its owner, or one of KIASA's admins in it.
create or replace function public.runs_chat(chat uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.chat_members m
    where m.chat_id = chat and m.user_id = auth.uid() and (m.role = 'owner' or public.is_admin()));
$$;
revoke execute on function public.runs_chat(uuid) from public, anon, authenticated;

-- ── The chat list, as this person sees it: each chat with its last message,
-- unread count, members and their own view of it; pinned chats first. A chat
-- deleted for them stays out of it until a newer message. It replaces chat_list.
create or replace function public.inbox()
returns table (id uuid, kind text, title text, last_message_at timestamptz, unread bigint,
  last_body text, last_sender uuid, last_kind text, last_file text, members jsonb,
  pinned_at timestamptz, muted boolean, archived boolean, marked_unread boolean)
language sql stable security invoker set search_path = '' as $$
  select c.id, c.kind, c.title, coalesce(l.created_at, c.created_at),
    (select count(*) from public.messages m
      where m.chat_id = c.id and m.created_at > me.last_read_at and m.sender_id is distinct from auth.uid() and m.deleted_at is null),
    l.body, l.sender_id, l.kind,
    case when l.attachment ? 'path' then l.attachment ->> 'name' end,
    (select coalesce(jsonb_agg(jsonb_build_object('chat_id', cm.chat_id, 'user_id', cm.user_id, 'name', cm.name, 'role', cm.role, 'last_read_at', cm.last_read_at)), '[]'::jsonb)
      from public.chat_members cm where cm.chat_id = c.id),
    s.pinned_at, coalesce(s.muted, false), coalesce(s.archived, false), coalesce(s.marked_unread, false)
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

-- Opening a chat reads it, and takes away an "unread" mark put on it by hand.
create or replace function public.mark_chat_read(chat uuid) returns void
language sql security definer set search_path = '' as $$
  update public.chat_members set last_read_at = now() where chat_id = chat and user_id = auth.uid();
  update public.chat_settings set marked_unread = false where chat_id = chat and user_id = auth.uid() and marked_unread;
$$;

-- A chat pinned to the top, muted, archived or marked unread: for this person only.
create or replace function public.set_chat(chat uuid, pin boolean default null, mute boolean default null,
  archive boolean default null, unread boolean default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_chat_member(chat) then raise exception 'That chat is not yours.'; end if;
  insert into public.chat_settings (chat_id, user_id) values (chat, auth.uid()) on conflict do nothing;
  update public.chat_settings set
    pinned_at = case when pin is null then pinned_at when pin then coalesce(pinned_at, now()) end,
    muted = coalesce(mute, muted),
    archived = coalesce(archive, archived),
    marked_unread = coalesce(unread, marked_unread)
  where chat_id = chat and user_id = auth.uid();
end $$;

-- ── Deleting messages: for everyone, one's own anywhere, anyone's in a
-- one-to-one chat (as in Telegram), and anyone's in a group one runs; for
-- oneself, any message. What cannot go for everyone goes for oneself.
create or replace function public.delete_messages(ids uuid[], everyone boolean default false) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  gone integer := 0;
  hidden integer := 0;
begin
  if me is null then raise exception 'Please sign in again.'; end if;
  if everyone then
    update public.messages m set deleted_at = now()
      from public.chats c
      where m.id = any(ids) and c.id = m.chat_id and m.deleted_at is null
        and public.can_see_message(m.chat_id, m.id, m.created_at)
        and (m.sender_id = me or c.kind in ('direct', 'saved') or (c.kind = 'group' and public.runs_chat(m.chat_id)));
    get diagnostics gone = row_count;
  end if;
  insert into public.message_hides (user_id, message_id)
    select me, m.id from public.messages m
    where m.id = any(ids) and m.deleted_at is null and public.can_see_message(m.chat_id, m.id, m.created_at)
    on conflict do nothing;
  get diagnostics hidden = row_count;
  return gone + hidden;
end $$;

-- Clearing a chat's history: for oneself; or, in a one-to-one chat or a group
-- one runs, for everyone in it. The messages are then out of everyone's sight.
create or replace function public.clear_history(chat uuid, everyone boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare
  chat_kind text := (select c.kind from public.chats c where c.id = chat);
begin
  if auth.uid() is null or not public.is_chat_member(chat) then raise exception 'That chat is not yours.'; end if;
  if everyone and not (chat_kind in ('direct', 'saved') or (chat_kind = 'group' and public.runs_chat(chat))) then
    raise exception 'Only the people who run this chat can clear it for everyone.';
  end if;
  insert into public.chat_settings (chat_id, user_id)
    select m.chat_id, m.user_id from public.chat_members m where m.chat_id = chat and (everyone or m.user_id = auth.uid())
    on conflict do nothing;
  update public.chat_settings set cleared_at = now(), marked_unread = false
    where chat_id = chat and (everyone or user_id = auth.uid());
end $$;

-- Deleting a chat: a one-to-one chat (or KIASA's notices, or Saved Messages)
-- leaves one's list, its history cleared, until a newer message; in a
-- one-to-one chat, for both people if asked. A group is left, the others told;
-- or, by someone who runs it, deleted for everyone.
create or replace function public.delete_chat(chat uuid, everyone boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  chat_kind text := (select c.kind from public.chats c where c.id = chat);
  my_name text;
begin
  if me is null or not public.is_chat_member(chat) then raise exception 'That chat is not yours.'; end if;
  if chat_kind = 'group' then
    if everyone then
      if not public.runs_chat(chat) then raise exception 'Only the people who run this group can delete it.'; end if;
      delete from public.chat_members where chat_id = chat;
      return;
    end if;
    select m.name into my_name from public.chat_members m where m.chat_id = chat and m.user_id = me;
    delete from public.chat_members where chat_id = chat and user_id = me;
    insert into public.messages (chat_id, kind, body) values (chat, 'notice', my_name || ' left the group.');
    return;
  end if;
  if everyone and chat_kind <> 'direct' then raise exception 'This chat can only be deleted for you.'; end if;
  insert into public.chat_settings (chat_id, user_id)
    select m.chat_id, m.user_id from public.chat_members m where m.chat_id = chat and (everyone or m.user_id = me)
    on conflict do nothing;
  update public.chat_settings set cleared_at = now(), hidden_at = now(), pinned_at = null, marked_unread = false
    where chat_id = chat and (everyone or user_id = me);
end $$;

-- ── Reacting: one reaction each per message, from a short list; the same one
-- again takes it back.
create or replace function public.react(message uuid, emoji text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me text := auth.uid()::text;
  target record;
  had boolean;
  kept jsonb;
begin
  select m.id, m.chat_id, m.created_at, m.deleted_at, m.reactions into target
    from public.messages m where m.id = message for update;
  if me is null or target.id is null or target.deleted_at is not null
    or not public.can_see_message(target.chat_id, target.id, target.created_at) then
    raise exception 'You cannot react to that message.';
  end if;
  if not (emoji = any (array['❤️', '👍', '👎', '🔥', '🥰', '👏', '😁', '🎉', '🤔', '😢', '🙏', '👌'])) then
    raise exception 'That reaction is not available.';
  end if;
  had := coalesce((target.reactions -> emoji) ? me, false);
  select coalesce(jsonb_object_agg(entry.key, entry.people), '{}'::jsonb) into kept
    from (select key, (select jsonb_agg(person) from jsonb_array_elements(value) person where person <> to_jsonb(me)) as people
          from jsonb_each(coalesce(target.reactions, '{}'::jsonb))) entry
    where entry.people is not null;
  if not had then kept := jsonb_set(kept, array[emoji], coalesce(kept -> emoji, '[]'::jsonb) || to_jsonb(me)); end if;
  update public.messages set reactions = kept where id = message;
end $$;

-- Pinning a message to the top of its chat: in a one-to-one chat or Saved
-- Messages by either person; in a group, by the people who run it.
create or replace function public.pin_message(message uuid, pin boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
declare
  target record;
begin
  select m.id, m.chat_id, m.created_at, m.deleted_at, c.kind into target
    from public.messages m join public.chats c on c.id = m.chat_id where m.id = message;
  if auth.uid() is null or target.id is null or target.deleted_at is not null
    or not public.can_see_message(target.chat_id, target.id, target.created_at) then
    raise exception 'You cannot pin that message.';
  end if;
  if target.kind = 'notices' or (target.kind = 'group' and not public.runs_chat(target.chat_id)) then
    raise exception 'Only the people who run this chat can pin messages.';
  end if;
  update public.messages set pinned_at = case when pin then now() end where id = message;
end $$;

-- Forwarding: copies of messages one can read, into a chat one may write in,
-- each saying whose it first was. A file is shared, not copied: it can be read
-- wherever it was forwarded to (chat_file_readable).
create or replace function public.forward_messages(ids uuid[], target uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  sent integer;
begin
  if me is null or not public.can_chat() or not public.is_chat_member(target)
    or (select c.kind from public.chats c where c.id = target) = 'notices' then
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

-- Saved Messages: one's own chat with oneself, made on first use.
create or replace function public.saved_chat() returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  my_name text := public.chat_name_of(auth.uid());
  found uuid;
begin
  if me is null or my_name is null then raise exception 'Please sign in again.'; end if;
  select c.id into found from public.chats c where c.kind = 'saved' and c.created_by = me;
  if found is null then
    insert into public.chats (kind, created_by) values ('saved', me) on conflict do nothing returning id into found;
    if found is null then select c.id into found from public.chats c where c.kind = 'saved' and c.created_by = me; end if;
  end if;
  insert into public.chat_members (chat_id, user_id, name, role) values (found, me, my_name, 'owner') on conflict do nothing;
  update public.chat_settings set hidden_at = null where chat_id = found and user_id = me;
  return found;
end $$;

-- Here now: the time "last seen" goes by.
create or replace function public.touch_seen() returns void
language sql security definer set search_path = '' as $$
  insert into public.seen (user_id, at) select auth.uid(), now() where auth.uid() is not null and public.can_chat()
  on conflict (user_id) do update set at = excluded.at;
$$;

-- A person's profile: their name (in their account and every chat they are
-- in), a username others can find them by, and a short bio.
create or replace function public.update_profile(full_name text, about text default '', handle text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  new_name text := left(regexp_replace(btrim(coalesce(full_name, '')), '\s+', ' ', 'g'), 80);
  new_handle text := nullif(lower(btrim(coalesce(handle, ''), ' @')), '');
begin
  if me is null or not public.can_chat() then raise exception 'Please sign in again.'; end if;
  if new_name = '' then raise exception 'Please give your name.'; end if;
  if char_length(coalesce(about, '')) > 140 then raise exception 'Your bio can be up to 140 characters.'; end if;
  if new_handle is not null and new_handle !~ '^[a-z0-9_]{5,32}$' then
    raise exception 'A username uses a–z, 0–9 and underscores, at least 5 of them.';
  end if;
  if new_handle is not null and exists (select 1 from public.chat_profiles p where p.username = new_handle and p.user_id <> me) then
    raise exception 'That username is taken. Please choose another.';
  end if;
  update public.profiles set name = new_name where id = me;
  update public.admins set name = new_name where email = auth.jwt() ->> 'email';
  update public.chat_members set name = new_name where user_id = me;
  insert into public.chat_profiles (user_id, username, bio) values (me, new_handle, coalesce(about, ''))
    on conflict (user_id) do update set username = excluded.username, bio = excluded.bio;
end $$;

do $$
declare fn text;
begin
  foreach fn in array array['set_chat(uuid, boolean, boolean, boolean, boolean)', 'delete_messages(uuid[], boolean)',
    'clear_history(uuid, boolean)', 'delete_chat(uuid, boolean)', 'react(uuid, text)', 'pin_message(uuid, boolean)',
    'forward_messages(uuid[], uuid)', 'saved_chat()', 'touch_seen()', 'update_profile(text, text, text)'] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- Each person's own view of their chats reaches their other windows live.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'chat_settings') then
    alter publication supabase_realtime add table public.chat_settings;
  end if;
end $$;
