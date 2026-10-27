-- KIASA Chat, phase 1: chats, their members, messages, files, and the live
-- channels for "typing…" and who is online. Run once, after the accounts file.
-- Running it again is safe.
--
-- Everything turns on membership: a person reads and writes only in the chats
-- they belong to. Chats themselves are made by the site's server, which first
-- checks who may chat at all: approved people and KIASA's admins.

-- Who may chat: an approved person, or one of KIASA's admins.
create or replace function public.can_chat() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'approved')
      or exists (select 1 from public.admins a where a.email = auth.jwt() ->> 'email');
$$;

create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('group', 'direct', 'notices')),
  title text check (char_length(title) <= 80),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists public.chat_members (
  chat_id uuid not null references public.chats (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  -- How they appear in this chat, copied from their account when they join.
  name text not null,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (chat_id, user_id)
);
create index if not exists chat_members_user on public.chat_members (user_id);
-- One "Account requests" chat for the admins, however many requests arrive at once.
create unique index if not exists chats_one_requests_chat on public.chats (title) where kind = 'notices' and title = 'Account requests';

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  -- Null for KIASA's own notices.
  sender_id uuid references auth.users (id) on delete set null,
  kind text not null default 'text' check (kind in ('text', 'notice')),
  body text not null default '' check (char_length(body) <= 4000),
  reply_to uuid references public.messages (id) on delete set null,
  -- A file or picture { path, name, type, size }, or a notice's details.
  attachment jsonb,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);
create index if not exists messages_chat_time on public.messages (chat_id, created_at desc);

-- Membership, asked without tripping the members table's own rules.
create or replace function public.is_chat_member(chat uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.chat_members m where m.chat_id = chat and m.user_id = auth.uid());
$$;

alter table public.chats enable row level security;
alter table public.chat_members enable row level security;
alter table public.messages enable row level security;

drop policy if exists "members read chats" on public.chats;
create policy "members read chats" on public.chats
  for select to authenticated using (public.is_chat_member(id));

drop policy if exists "members read members" on public.chat_members;
create policy "members read members" on public.chat_members
  for select to authenticated using (public.is_chat_member(chat_id));
-- Membership is changed only by the site's server; a person can only mark what
-- they have read, by the database's clock (mark_chat_read below).
drop policy if exists "members mark read" on public.chat_members;
revoke insert, update, delete on public.chat_members from anon, authenticated;

create or replace function public.mark_chat_read(chat uuid) returns void
language sql security definer set search_path = '' as $$
  update public.chat_members set last_read_at = now() where chat_id = chat and user_id = auth.uid();
$$;
revoke execute on function public.mark_chat_read(uuid) from public, anon;
grant execute on function public.mark_chat_read(uuid) to authenticated;

drop policy if exists "members read messages" on public.messages;
create policy "members read messages" on public.messages
  for select to authenticated using (public.is_chat_member(chat_id));
-- Members write as themselves, in their own chats; notices come only from KIASA.
drop policy if exists "members send messages" on public.messages;
create policy "members send messages" on public.messages
  for insert to authenticated with check (
    sender_id = auth.uid() and kind = 'text' and public.can_chat() and public.is_chat_member(chat_id)
    and (select c.kind from public.chats c where c.id = chat_id) <> 'notices'
  );
-- A sender may edit or delete their own messages.
drop policy if exists "senders change their messages" on public.messages;
create policy "senders change their messages" on public.messages
  for update to authenticated using (sender_id = auth.uid()) with check (sender_id = auth.uid());
revoke insert, update, delete on public.messages from anon, authenticated;
grant insert (id, chat_id, sender_id, body, reply_to, attachment) on public.messages to authenticated;
grant update (body, deleted_at) on public.messages to authenticated;

-- The database keeps the times, not the browser: an edit is stamped, and a
-- deleted message keeps only that it was deleted.
create or replace function public.message_changed() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    new.deleted_at := now();
    new.body := '';
    new.attachment := null;
  elsif old.deleted_at is not null then
    return old;
  elsif new.body is distinct from old.body then
    new.edited_at := now();
  end if;
  return new;
end $$;
drop trigger if exists messages_changed on public.messages;
create trigger messages_changed before update on public.messages for each row execute function public.message_changed();

-- Each new message moves its chat to the top of everyone's list.
create or replace function public.message_sent() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.chats set last_message_at = new.created_at where id = new.chat_id;
  return new;
end $$;
drop trigger if exists messages_sent on public.messages;
create trigger messages_sent after insert on public.messages for each row execute function public.message_sent();

-- The chat list in one ask: each of my chats, its last message and how many I have not read.
create or replace function public.my_chats()
returns table (id uuid, kind text, title text, last_message_at timestamptz, unread bigint,
  last_body text, last_sender uuid, last_kind text, last_deleted boolean, last_file text)
language sql stable security invoker set search_path = '' as $$
  select c.id, c.kind, c.title, c.last_message_at,
    (select count(*) from public.messages m
      where m.chat_id = c.id and m.created_at > me.last_read_at and m.sender_id is distinct from auth.uid() and m.deleted_at is null),
    l.body, l.sender_id, l.kind, l.deleted_at is not null,
    -- A file's name; a notice's details are not a file.
    case when l.attachment ? 'path' then l.attachment ->> 'name' end
  from public.chat_members me
  join public.chats c on c.id = me.chat_id
  left join lateral (
    select m.body, m.sender_id, m.kind, m.deleted_at, m.attachment from public.messages m
    where m.chat_id = c.id order by m.created_at desc limit 1
  ) l on true
  where me.user_id = auth.uid()
  order by c.last_message_at desc;
$$;

-- KIASA's admins as people who can chat (for the site's server only).
create or replace function public.admin_users() returns table (id uuid, email text, name text)
language sql stable security definer set search_path = '' as $$
  select u.id, a.email, a.name from public.admins a join auth.users u on lower(u.email) = a.email;
$$;
revoke execute on function public.admin_users() from public, anon, authenticated;
grant execute on function public.admin_users() to service_role;

-- New messages, read marks and new chats reach everyone concerned the moment they happen.
do $$
declare t text;
begin
  foreach t in array array['messages', 'chat_members', 'chats'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- "Typing…" and who is online travel on private live channels: a chat's
-- channel ("chat:<id>") only for its members, the online list only for people
-- who may chat.
drop policy if exists "chat channels for members" on realtime.messages;
create policy "chat channels for members" on realtime.messages
  for all to authenticated
  using (
    (realtime.topic() ~ '^chat:[0-9a-f-]{36}$' and public.is_chat_member(substring(realtime.topic() from 6)::uuid))
    or (realtime.topic() = 'kiasa:online' and public.can_chat())
  )
  with check (
    (realtime.topic() ~ '^chat:[0-9a-f-]{36}$' and public.is_chat_member(substring(realtime.topic() from 6)::uuid))
    or (realtime.topic() = 'kiasa:online' and public.can_chat())
  );

-- Files and pictures: a private bucket, one folder per chat, open only to its members.
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-files', 'chat-files', false, 20971520)
on conflict (id) do update set public = false, file_size_limit = 20971520;

create or replace function public.chat_file_member(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when split_part(object_name, '/', 1) ~ '^[0-9a-f-]{36}$'
    then public.is_chat_member(split_part(object_name, '/', 1)::uuid) else false end;
$$;

drop policy if exists "members add chat files" on storage.objects;
create policy "members add chat files" on storage.objects
  for insert to authenticated with check (bucket_id = 'chat-files' and public.can_chat() and public.chat_file_member(name));
drop policy if exists "members read chat files" on storage.objects;
create policy "members read chat files" on storage.objects
  for select to authenticated using (bucket_id = 'chat-files' and public.chat_file_member(name));
