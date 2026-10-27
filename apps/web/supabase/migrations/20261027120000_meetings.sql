-- KIASA meetings: voice and video calls inside KIASA, for the people of a chat.
-- Only KIASA's admins start or schedule one (the site's server makes it, after
-- checking); the chat's members join it. Calls go straight between browsers;
-- this file keeps only the meetings themselves and who may join their private
-- live channel ("meet:<id>"), on which the browsers find each other. Run once,
-- after the chat files. Running it again is safe.

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  -- When it is planned for; for a meeting started at once, when it started.
  starts_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists meetings_chat on public.meetings (chat_id, starts_at desc);

alter table public.meetings enable row level security;
revoke all on public.meetings from anon;
revoke insert, update, delete on public.meetings from authenticated;

-- A chat's members see its meetings; nobody writes them but the site's server.
drop policy if exists "members see their meetings" on public.meetings;
create policy "members see their meetings" on public.meetings
  for select to authenticated using (public.is_chat_member(chat_id));

-- Whether the person asking may be in this meeting: a member of its chat.
create or replace function public.meeting_member(meeting uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.meetings m join public.chat_members c on c.chat_id = m.chat_id
    where m.id = meeting and c.user_id = auth.uid()
  );
$$;
revoke execute on function public.meeting_member(uuid) from public, anon;
grant execute on function public.meeting_member(uuid) to authenticated;

-- The meeting's live channel: who is in it, and the browsers' offers to connect.
drop policy if exists "meeting channels for members" on realtime.messages;
create policy "meeting channels for members" on realtime.messages
  for all to authenticated
  using (realtime.topic() ~ '^meet:[0-9a-f-]{36}$' and public.meeting_member(substring(realtime.topic() from 6)::uuid))
  with check (realtime.topic() ~ '^meet:[0-9a-f-]{36}$' and public.meeting_member(substring(realtime.topic() from 6)::uuid));

-- A meeting started, ended or moved reaches its chat's open pages at once.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'meetings') then
    alter publication supabase_realtime add table public.meetings;
  end if;
end $$;
