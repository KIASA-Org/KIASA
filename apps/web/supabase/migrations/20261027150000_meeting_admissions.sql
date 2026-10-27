-- Letting people in: a member who opens a meeting asks to join, and an admin
-- in it admits them (or not), as in Google Meet. The browsers in the meeting
-- connect only to admins and to people admitted here. Only the site's server
-- writes this, after checking who is asking. Run once, after the meetings
-- file. Running it again is safe.

create table if not exists public.meeting_admissions (
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  status text not null default 'waiting' check (status in ('waiting', 'admitted', 'denied')),
  asked_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  primary key (meeting_id, user_id)
);

alter table public.meeting_admissions enable row level security;
revoke all on public.meeting_admissions from anon;
revoke insert, update, delete on public.meeting_admissions from authenticated;

-- The people of a meeting's chat see who is waiting and who was let in.
drop policy if exists "meeting members see admissions" on public.meeting_admissions;
create policy "meeting members see admissions" on public.meeting_admissions
  for select to authenticated using (public.meeting_member(meeting_id));

-- Someone asking, admitted or turned away reaches the meeting at once.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'meeting_admissions') then
    alter publication supabase_realtime add table public.meeting_admissions;
  end if;
end $$;
