-- Simulated members: accounts the admin makes to fill KIASA while it is being
-- built and tested. Each asks for an account like anyone else; the admin
-- approves it, puts it in a team, and sets the hours it works and how hard (its
-- pace, 120–150% of its plan). They never chat with anyone.
--
-- Who sees them: KIASA's admins, and the testers an admin names. To everyone
-- else they do not exist: not in any list, badge, count, total or leaderboard.
-- Only the site's server writes these tables, after checking an admin.
-- Run once, after the group directory file. Running it again is safe.

create table if not exists public.sim_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- The hours it works, in the team's time zone (job_settings), on these days (1 Monday … 7 Sunday).
  active_from time not null default '09:00',
  active_to time not null default '17:00',
  days smallint[] not null default '{1,2,3,4,5}',
  -- How far past its plan it goes, as a share: 1.2 to 1.5 is 120–150%.
  pace_min numeric(3, 2) not null default 1.20 check (pace_min between 1 and 2),
  pace_max numeric(3, 2) not null default 1.50 check (pace_max between 1 and 2 and pace_max >= pace_min),
  paused boolean not null default false,
  created_at timestamptz not null default now(),
  created_by text,
  check (active_to > active_from),
  check (days <@ '{1,2,3,4,5,6,7}' and cardinality(days) between 1 and 7)
);

-- People who see the simulated members, as an admin does (to test what a manager or member sees).
create table if not exists public.testers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now(),
  added_by text
);

-- Whether a person is simulated; whether the person asking sees the simulated
-- members; and so whether the person asking may see someone.
create or replace function public.is_sim(person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sim_members s where s.user_id = person);
$$;
revoke execute on function public.is_sim(uuid) from public, anon, authenticated;
create or replace function public.sees_sims() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or exists (select 1 from public.testers t where t.user_id = auth.uid()) or public.is_sim(auth.uid());
$$;
create or replace function public.visible(person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not public.is_sim(person) or public.sees_sims();
$$;
revoke execute on function public.sees_sims() from public, anon;
grant execute on function public.sees_sims() to authenticated;
revoke execute on function public.visible(uuid) from public, anon;
grant execute on function public.visible(uuid) to authenticated;

alter table public.sim_members enable row level security;
alter table public.testers enable row level security;
revoke all on public.sim_members, public.testers from anon;
revoke insert, update, delete on public.sim_members, public.testers from authenticated;
drop policy if exists "those who see simulated members read their hours" on public.sim_members;
create policy "those who see simulated members read their hours" on public.sim_members
  for select to authenticated using (public.sees_sims());
drop policy if exists "testers and admins read the testers" on public.testers;
create policy "testers and admins read the testers" on public.testers
  for select to authenticated using (user_id = auth.uid() or public.am_admin());

-- ── Simulated members never chat: they have no name in any chat, so no one
-- can open a chat with them or put them in a group.
create or replace function public.chat_name_of(person uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case when public.is_sim(person) then null else coalesce(
    (select p.name from public.profiles p where p.id = person and p.status = 'approved'),
    (select a.name from public.admins a join auth.users u on lower(u.email) = a.email where u.id = person)
  ) end;
$$;
revoke execute on function public.chat_name_of(uuid) from public, anon, authenticated;

-- ── Hidden from those who do not see them: their team, badge, photo, profile and last seen.
drop policy if exists "people who chat see who is in which team" on public.team_members;
create policy "people who chat see who is in which team" on public.team_members
  for select to authenticated using (public.can_chat() and public.visible(user_id));
drop policy if exists "people who chat see top managers" on public.top_managers;
create policy "people who chat see top managers" on public.top_managers
  for select to authenticated using (public.can_chat() and public.visible(user_id));
drop policy if exists "people who chat see photos" on public.avatars;
create policy "people who chat see photos" on public.avatars
  for select to authenticated using (public.can_chat() and public.visible(user_id));
drop policy if exists "people who chat see when others were here" on public.seen;
create policy "people who chat see when others were here" on public.seen
  for select to authenticated using (public.can_chat() and public.visible(user_id));
drop policy if exists "people who chat see each other's profiles" on public.chat_profiles;
create policy "people who chat see each other's profiles" on public.chat_profiles
  for select to authenticated using (public.can_chat() and public.visible(user_id));

-- ── Jobs: a link's count of applications, and the leaderboard, count only
-- those the person asking may see.
create or replace function public.jobs_on(on_day date)
returns table (id uuid, url text, title text, company text, location text, note text, posted_at timestamptz, posted_by uuid,
  status text, applied_at timestamptz, resume_id uuid, my_note text, applied bigint)
language sql stable security definer set search_path = '' as $$
  select j.id, j.url, j.title, j.company, j.location, j.note, j.posted_at, j.posted_by,
    a.status, a.applied_at, a.resume_id, a.note,
    (select count(*) from public.applications x where x.job_id = j.id and x.applied_at is not null and public.visible(x.user_id))
  from public.jobs j
  cross join (select public.jobs_zone() as tz) z
  left join public.applications a on a.job_id = j.id and a.user_id = (select auth.uid())
  where (select public.jobs_team())
    and j.posted_at >= (on_day::timestamp at time zone z.tz) and j.posted_at < ((on_day + 1)::timestamp at time zone z.tz)
  order by j.posted_at desc, j.id;
$$;

create or replace function public.team_board()
returns table (user_id uuid, name text,
  apps_day bigint, apps_week bigint, apps_month bigint,
  interviews_day bigint, interviews_week bigint, interviews_month bigint,
  offers_day bigint, offers_week bigint, offers_month bigint,
  jobs_held bigint, monthly_salary numeric, paid_month numeric, paid_total numeric, last_applied_at timestamptz)
language sql stable security definer set search_path = '' as $$
  with zone as (select public.jobs_zone() as tz),
  local as (select tz, (now() at time zone tz)::date as d from zone),
  edges as (
    select d,
      (d::timestamp at time zone tz) as day_start,
      ((d + 1)::timestamp at time zone tz) as day_end,
      (date_trunc('week', d::timestamp) at time zone tz) as week_start,
      ((date_trunc('week', d::timestamp) + interval '7 days') at time zone tz) as week_end,
      (date_trunc('month', d::timestamp) at time zone tz) as month_start,
      ((date_trunc('month', d::timestamp) + interval '1 month') at time zone tz) as month_end,
      date_trunc('month', d::timestamp)::date as month_first
    from local
  )
  select p.id, p.name,
    (select count(*) from public.applications a where a.user_id = p.id and a.applied_at >= e.day_start and a.applied_at < e.day_end),
    (select count(*) from public.applications a where a.user_id = p.id and a.applied_at >= e.week_start and a.applied_at < e.week_end),
    (select count(*) from public.applications a where a.user_id = p.id and a.applied_at >= e.month_start and a.applied_at < e.month_end),
    (select count(*) from public.interviews i where i.user_id = p.id and i.outcome <> 'cancelled' and i.starts_at >= e.day_start and i.starts_at < e.day_end),
    (select count(*) from public.interviews i where i.user_id = p.id and i.outcome <> 'cancelled' and i.starts_at >= e.week_start and i.starts_at < e.week_end),
    (select count(*) from public.interviews i where i.user_id = p.id and i.outcome <> 'cancelled' and i.starts_at >= e.month_start and i.starts_at < e.month_end),
    (select count(*) from public.applications a where a.user_id = p.id and a.offered_at >= e.day_start and a.offered_at < e.day_end),
    (select count(*) from public.applications a where a.user_id = p.id and a.offered_at >= e.week_start and a.offered_at < e.week_end),
    (select count(*) from public.applications a where a.user_id = p.id and a.offered_at >= e.month_start and a.offered_at < e.month_end),
    (select count(*) from public.positions s where s.user_id = p.id and s.status = 'confirmed' and (s.ended_on is null or s.ended_on >= e.d)),
    (select coalesce(sum(s.monthly_salary), 0) from public.positions s where s.user_id = p.id and s.status = 'confirmed' and (s.ended_on is null or s.ended_on >= e.d)),
    (select coalesce(sum(y.amount), 0) from public.payments y where y.user_id = p.id and y.status = 'confirmed' and y.paid_on >= e.month_first),
    (select coalesce(sum(y.amount), 0) from public.payments y where y.user_id = p.id and y.status = 'confirmed'),
    (select max(a.applied_at) from public.applications a where a.user_id = p.id)
  from public.profiles p cross join edges e
  where p.status = 'approved' and (select public.jobs_team()) and public.visible(p.id)
  order by p.name;
$$;

-- A simulated member's hours changed, or one added or taken away, reaches the admin's pages at once.
do $$
declare t text;
begin
  foreach t in array array['sim_members', 'testers'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
