-- A meeting's own chat, beside the call: everyone in the meeting reads and
-- writes it, and it stays with the meeting, so anyone who comes in later reads
-- what was said. Run once, after the manager view file. Running it again is safe.

create table if not exists public.meeting_messages (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  sender_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- How they appear, set by the database from their account (never by the browser).
  name text not null default '',
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists meeting_messages_meeting on public.meeting_messages (meeting_id, created_at);

-- In the meeting: one of its chat's members, and an admin or someone let in.
create or replace function public.in_meeting(meeting uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.meeting_member(meeting) and (
    public.is_admin()
    or exists (select 1 from public.meeting_admissions a where a.meeting_id = meeting and a.user_id = auth.uid() and a.status = 'admitted')
  );
$$;
revoke execute on function public.in_meeting(uuid) from public, anon;
grant execute on function public.in_meeting(uuid) to authenticated;

-- The writer's name, and the time, are the database's.
create or replace function public.meeting_message_written() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.sender_id := auth.uid();
  new.name := coalesce(public.chat_name_of(auth.uid()), 'Someone');
  new.body := btrim(new.body);
  new.created_at := now();
  return new;
end $$;
drop trigger if exists meeting_message_written on public.meeting_messages;
create trigger meeting_message_written before insert on public.meeting_messages
  for each row execute function public.meeting_message_written();

alter table public.meeting_messages enable row level security;
revoke all on public.meeting_messages from anon;
revoke insert, update, delete on public.meeting_messages from authenticated;
grant insert (meeting_id, body) on public.meeting_messages to authenticated;
drop policy if exists "those in a meeting read its chat" on public.meeting_messages;
create policy "those in a meeting read its chat" on public.meeting_messages
  for select to authenticated using (public.in_meeting(meeting_id));
drop policy if exists "those in a meeting write in its chat" on public.meeting_messages;
create policy "those in a meeting write in its chat" on public.meeting_messages
  for insert to authenticated with check (public.in_meeting(meeting_id));

-- A message reaches everyone in the meeting the moment it is sent.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'meeting_messages') then
    alter publication supabase_realtime add table public.meeting_messages;
  end if;
end $$;
