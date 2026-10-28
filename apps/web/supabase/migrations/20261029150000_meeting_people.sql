-- Who is in a meeting: the people chosen for it, not everyone in a chat. An
-- admin (or a team's manager, for their team) picks them, from a chat or from
-- anyone, and adds or takes people out later. A manager's meeting with anyone
-- outside their team (another team, no team, or an admin) waits for an
-- admin's OK: until then no one but the manager sees it. Only the site's
-- server writes any of this, after checking who is asking. Run once, after the
-- meeting chat files. Running it again is safe.

-- A meeting needs no chat now (one called for chosen people, from anywhere).
alter table public.meetings alter column chat_id drop not null;
-- A manager's meeting with people outside their team: 'waiting' for an
-- admin's OK, then 'allowed' or 'refused'. Null: it needed no OK.
alter table public.meetings add column if not exists approval text check (approval in ('waiting', 'allowed', 'refused'));

create table if not exists public.meeting_people (
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  -- 'in': invited. 'asked': a manager asked for them; waiting for an admin's OK.
  status text not null default 'in' check (status in ('in', 'asked')),
  added_at timestamptz not null default now(),
  primary key (meeting_id, user_id)
);
create index if not exists meeting_people_user on public.meeting_people (user_id);

-- The meetings there were before: everyone in their chat is in them (once:
-- a meeting someone was taken out of keeps its people when this runs again).
insert into public.meeting_people (meeting_id, user_id, name)
  select m.id, c.user_id, c.name from public.meetings m join public.chat_members c on c.chat_id = m.chat_id
  where not exists (select 1 from public.meeting_people p where p.meeting_id = m.id)
  on conflict do nothing;

-- Whether the person asking may be in this meeting: invited to it, and the
-- meeting is not waiting for (or refused) an admin's OK, unless it is theirs.
create or replace function public.meeting_member(meeting uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.meetings m join public.meeting_people p on p.meeting_id = m.id
    where m.id = meeting and p.user_id = auth.uid() and p.status = 'in'
      and (m.approval is null or m.approval = 'allowed' or m.created_by = auth.uid())
  );
$$;
revoke execute on function public.meeting_member(uuid) from public, anon;
grant execute on function public.meeting_member(uuid) to authenticated;

-- In the meeting: invited, and an admin, the one who called it, or someone let in.
create or replace function public.in_meeting(meeting uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.meeting_member(meeting) and (
    public.is_admin()
    or exists (select 1 from public.meetings m where m.id = meeting and m.created_by = auth.uid())
    or exists (select 1 from public.meeting_admissions a where a.meeting_id = meeting and a.user_id = auth.uid() and a.status = 'admitted')
  );
$$;
revoke execute on function public.in_meeting(uuid) from public, anon;
grant execute on function public.in_meeting(uuid) to authenticated;

-- Those invited see the meeting and who else is in it; KIASA's admins see every one.
drop policy if exists "members see their meetings" on public.meetings;
create policy "members see their meetings" on public.meetings
  for select to authenticated using (public.meeting_member(id) or public.am_admin());

alter table public.meeting_people enable row level security;
revoke all on public.meeting_people from anon;
revoke insert, update, delete on public.meeting_people from authenticated;
drop policy if exists "meeting members see who is in it" on public.meeting_people;
create policy "meeting members see who is in it" on public.meeting_people
  for select to authenticated using (public.meeting_member(meeting_id) or public.am_admin());

-- Whoever asked to join sees their own answer, even once taken out of the
-- meeting (their open meeting window learns it so, and leaves the call).
drop policy if exists "meeting members see admissions" on public.meeting_admissions;
create policy "meeting members see admissions" on public.meeting_admissions
  for select to authenticated using (public.meeting_member(meeting_id) or user_id = auth.uid());

-- Someone added or taken out reaches the open meeting at once.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'meeting_people') then
    alter publication supabase_realtime add table public.meeting_people;
  end if;
end $$;
