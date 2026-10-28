-- KIASA, harder to break into. Run once, after the meeting people file.
-- Running it again is safe.
--
-- 1. An admin is an account, not an email: someone who made an account with
--    an admin's address (or changed theirs to it) is not an admin.
-- 2. A meeting's live channel: those waiting to be let in see who is there,
--    but only those in the meeting send on it.
-- 3. Chat files: a file is read only through a message one can see, so a
--    deleted message, a cleared history or a chat one joined later shows
--    none of its old files; a member's message carries only a file of its
--    own chat; and only kinds a browser shows safely are kept as they are.
-- 4. Tries counted, so no one guesses passwords or floods the requests.
-- 5. A job left and then "taken back" goes back to the admins to confirm.

-- ── 1. Admins by account ────────────────────────────────────────────────────
-- Add an admin AFTER their account exists (Authentication → Users → Add
-- user): the row takes the account with that email then. A row added for an
-- address with no account makes no one an admin, even once an account with
-- that address is made; link it then with
--   update public.admins a set user_id = u.id from auth.users u where lower(u.email) = a.email and a.user_id is null;
alter table public.admins add column if not exists user_id uuid unique references auth.users (id) on delete set null;
update public.admins a set user_id = u.id from auth.users u
  where a.user_id is null and lower(u.email) = lower(a.email);

create or replace function public.admin_linked() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.email := lower(new.email);
  if new.user_id is null then
    select u.id into new.user_id from auth.users u where lower(u.email) = new.email;
  end if;
  return new;
end $$;
revoke execute on function public.admin_linked() from public, anon, authenticated;
drop trigger if exists admin_linked on public.admins;
create trigger admin_linked before insert on public.admins for each row execute function public.admin_linked();

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;
create or replace function public.jobs_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;
create or replace function public.is_admin_user(person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = person);
$$;
create or replace function public.can_chat() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'approved')
      or exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;
create or replace function public.admin_users() returns table (id uuid, email text, name text)
language sql stable security definer set search_path = '' as $$
  select a.user_id, a.email, a.name from public.admins a where a.user_id is not null;
$$;
create or replace function public.chat_name_of(person uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select p.name from public.profiles p where p.id = person and p.status = 'approved'),
    (select a.name from public.admins a where a.user_id = person)
  );
$$;

drop policy if exists "admins read profiles" on public.profiles;
create policy "admins read profiles" on public.profiles
  for select to authenticated using ((select public.am_admin()));
drop policy if exists "admins read themselves" on public.admins;
create policy "admins read themselves" on public.admins
  for select to authenticated using (user_id = (select auth.uid()));

-- A person's profile, as before; an admin's own name is found by their account.
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
  update public.admins set name = new_name where user_id = me;
  update public.chat_members set name = new_name where user_id = me;
  insert into public.chat_profiles (user_id, username, bio) values (me, new_handle, coalesce(about, ''))
    on conflict (user_id) do update set username = excluded.username, bio = excluded.bio;
end $$;

-- ── 2. A meeting's live channel ─────────────────────────────────────────────
-- Read (who is there): everyone invited, the waiting too. Send (offers to
-- connect, presence, "ended"): only those in the meeting. The live server
-- asks when a browser joins the channel, so one let in joins it again.
drop policy if exists "meeting channels for members" on realtime.messages;
drop policy if exists "meeting channels read" on realtime.messages;
create policy "meeting channels read" on realtime.messages
  for select to authenticated
  using (realtime.topic() ~ '^meet:[0-9a-f-]{36}$' and public.meeting_member(substring(realtime.topic() from 6)::uuid));
drop policy if exists "meeting channels send" on realtime.messages;
create policy "meeting channels send" on realtime.messages
  for insert to authenticated
  with check (realtime.topic() ~ '^meet:[0-9a-f-]{36}$' and public.in_meeting(substring(realtime.topic() from 6)::uuid));

-- ── 3. Chat files ───────────────────────────────────────────────────────────
-- Read only through a message one can see (in its own chat, or forwarded).
create or replace function public.chat_file_readable(object_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.messages m
    where m.attachment ->> 'path' = object_name and m.deleted_at is null
      and public.can_see_message(m.chat_id, m.id, m.created_at));
$$;

-- A member's own message carries a file of its own chat only (forwarding,
-- done by the database itself, carries the file it forwards).
create or replace function public.message_attached() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user = 'authenticated' and new.attachment is not null
    and (jsonb_typeof(new.attachment) <> 'object' or new.attachment ? 'type'
      or split_part(coalesce(new.attachment ->> 'path', ''), '/', 1) <> new.chat_id::text) then
    raise exception 'A file sent in a chat is kept in that chat.';
  end if;
  return new;
end $$;
drop trigger if exists messages_attached on public.messages;
create trigger messages_attached before insert on public.messages for each row execute function public.message_attached();

-- Kept as sent: pictures, PDFs, text, sound and film, and office files.
-- Anything else (a web page, a drawing that could run a script) the browser
-- sends as plain bytes, which a browser only downloads.
update storage.buckets set allowed_mime_types = array[
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif',
  'application/pdf', 'text/plain', 'text/csv', 'audio/*', 'video/*',
  'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip', 'application/x-zip-compressed', 'application/octet-stream'
] where id = 'chat-files';

-- ── 4. Tries, counted ───────────────────────────────────────────────────────
-- Signing in, asking for an account, changing a password: the site's server
-- counts each try by where it came from, and refuses for a while past a limit.
create table if not exists public.attempts (
  kind text not null,
  key text not null,
  at timestamptz not null default now()
);
create index if not exists attempts_by_key on public.attempts (kind, key, at desc);
create index if not exists attempts_by_time on public.attempts (at);
alter table public.attempts enable row level security;
revoke all on public.attempts from anon, authenticated;

-- Whether there have been `most` or more tries of this kind, from this key,
-- in the last `within`.
create or replace function public.too_many(what text, who text, within interval, most int) returns boolean
language sql stable security definer set search_path = '' as $$
  select count(*) >= most from (
    select 1 from public.attempts a where a.kind = what and a.key = who and a.at > now() - within limit most
  ) recent;
$$;
-- A try, kept for a day.
create or replace function public.note_attempt(what text, who text) returns void
language sql security definer set search_path = '' as $$
  delete from public.attempts where at < now() - interval '1 day';
  insert into public.attempts (kind, key) values (left(what, 40), left(who, 300));
$$;
revoke execute on function public.too_many(text, text, interval, int) from public, anon, authenticated;
revoke execute on function public.note_attempt(text, text) from public, anon, authenticated;
grant execute on function public.too_many(text, text, interval, int) to service_role;
grant execute on function public.note_attempt(text, text) to service_role;

-- ── 5. A job "taken back" ───────────────────────────────────────────────────
-- Saying one has left a job needs no new OK; changing or clearing the day one
-- left, as any other change, goes back to the admins to confirm.
create or replace function public.report_written() returns trigger
language plpgsql set search_path = '' as $$
declare
  quiet text[] := array['status', 'decided_by', 'decided_at', 'ended_on', 'note'];
begin
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then raise exception 'A report stays with its member.'; end if;
  -- (Nested: a position has no position_id, and the check must not mention it there.)
  if tg_table_name = 'payments' then
    if new.position_id is not null and not exists (select 1 from public.positions s where s.id = new.position_id and s.user_id = new.user_id) then
      raise exception 'That job is not theirs.';
    end if;
  end if;
  -- Admins decide; so does the site's own server (its secret key), as an admin would.
  if public.jobs_admin() or current_user = 'service_role' then
    if tg_op = 'INSERT' or new.status is distinct from old.status then
      new.decided_by := case when new.status = 'pending' then null else auth.uid() end;
      new.decided_at := case when new.status = 'pending' then null else now() end;
    end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'pending'; new.decided_by := null; new.decided_at := null;
    return new;
  end if;
  if new.status is distinct from old.status or new.decided_by is distinct from old.decided_by or new.decided_at is distinct from old.decided_at then
    raise exception 'Only an admin confirms reports.';
  end if;
  if tg_table_name = 'positions' and to_jsonb(old) ->> 'ended_on' is not null then
    quiet := array_remove(quiet, 'ended_on');
  end if;
  if (to_jsonb(new) - quiet) <> (to_jsonb(old) - quiet) then
    new.status := 'pending'; new.decided_by := null; new.decided_at := null;
  end if;
  return new;
end $$;
