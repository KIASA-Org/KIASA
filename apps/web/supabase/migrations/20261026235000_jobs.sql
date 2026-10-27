-- KIASA Jobs: the job links KIASA's admins post each day, every member's
-- application to each (with the résumé used, and its status), interviews on a
-- calendar, the jobs members win and the pay they receive, each member's plan,
-- and the team's leaderboard. Run once, after the chat files. Running it again
-- is safe.
--
-- Admins post the links; every approved person (a member) applies to them and
-- keeps their own status for each. Members write only their own rows; admins
-- read everything, confirm what members report, and set plans. The figures
-- everyone sees about everyone (the leaderboard) come from functions that give
-- totals only. Times are the database's.

-- ── Who is who. (Names of their own, so no function of the same name made
-- elsewhere is ever replaced.)
create or replace function public.jobs_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.email = auth.jwt() ->> 'email');
$$;
create or replace function public.jobs_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'approved');
$$;
-- On the team: a member, or an admin.
create or replace function public.jobs_team() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.jobs_member() or public.jobs_admin();
$$;

-- ── The team's own settings: the time zone its days follow, and its currency.
create table if not exists public.job_settings (
  id integer primary key default 1 check (id = 1),
  timezone text check (char_length(timezone) <= 64),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  updated_at timestamptz not null default now()
);
insert into public.job_settings (id) values (1) on conflict (id) do nothing;

create or replace function public.job_settings_written() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- An unknown time zone fails here, not later in every day's sums.
  if new.timezone is not null then perform now() at time zone new.timezone; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists job_settings_written on public.job_settings;
create trigger job_settings_written before insert or update on public.job_settings
  for each row execute function public.job_settings_written();

create or replace function public.jobs_zone() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.timezone from public.job_settings s where s.id = 1), 'UTC');
$$;

-- The rules below ask these as the person signed in, so they may; no one else.
do $$
declare fn text;
begin
  foreach fn in array array['jobs_admin()', 'jobs_member()', 'jobs_team()', 'jobs_zone()'] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- ── The job links, each once.
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  url text not null check (url ~* '^https?://' and char_length(url) <= 2000),
  title text check (char_length(title) <= 200),
  company text check (char_length(company) <= 120),
  location text check (char_length(location) <= 120),
  note text check (char_length(note) <= 500),
  posted_by uuid default auth.uid() references auth.users (id) on delete set null,
  posted_at timestamptz not null default now()
);
create unique index if not exists jobs_url on public.jobs (url);
create index if not exists jobs_posted_at on public.jobs (posted_at desc);

-- ── Résumés: each member's versions, the files in a private store.
create table if not exists public.resumes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  path text not null unique check (split_part(path, '/', 1) = user_id::text),
  file_name text not null check (char_length(file_name) <= 200),
  mime text not null,
  size integer not null check (size > 0 and size <= 10485760),
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists resumes_user on public.resumes (user_id);
create unique index if not exists resumes_one_default on public.resumes (user_id) where is_default;

-- ── Applications: one per member and job, with its status. "Skipped" means
-- not applied (not a fit); no row means not yet looked at.
create table if not exists public.applications (
  job_id uuid not null references public.jobs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'applied' check (status in ('applied', 'interview', 'offer', 'hired', 'rejected', 'skipped')),
  resume_id uuid references public.resumes (id) on delete set null,
  note text check (char_length(note) <= 500),
  applied_at timestamptz,
  offered_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (job_id, user_id)
);
create index if not exists applications_user_applied on public.applications (user_id, applied_at desc);
create index if not exists applications_applied on public.applications (applied_at desc);
create index if not exists applications_resume on public.applications (resume_id);

create or replace function public.application_written() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.job_id <> old.job_id or new.user_id <> old.user_id) then
    raise exception 'An application stays with its job and member.';
  end if;
  if new.resume_id is not null and not exists (select 1 from public.resumes r where r.id = new.resume_id and r.user_id = new.user_id) then
    raise exception 'That résumé is not theirs.';
  end if;
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.applied_at := case when new.status = 'skipped' then null else now() end;
    new.offered_at := case when new.status in ('offer', 'hired') then now() end;
  else
    new.applied_at := case when new.status = 'skipped' then null else coalesce(old.applied_at, now()) end;
    new.offered_at := case when new.status in ('offer', 'hired') then coalesce(old.offered_at, now()) else old.offered_at end;
  end if;
  return new;
end $$;
drop trigger if exists application_written on public.applications;
create trigger application_written before insert or update on public.applications
  for each row execute function public.application_written();

-- ── Interviews: on a job from the list (an application), or one from elsewhere.
create table if not exists public.interviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete cascade,
  company text check (char_length(company) <= 120),
  title text check (char_length(title) <= 200),
  starts_at timestamptz not null,
  minutes integer not null default 60 check (minutes between 5 and 600),
  kind text not null default 'video' check (kind in ('phone', 'video', 'onsite', 'technical', 'other')),
  stage text check (char_length(stage) <= 80),
  place text check (char_length(place) <= 500),
  note text check (char_length(note) <= 1000),
  outcome text not null default 'scheduled' check (outcome in ('scheduled', 'done', 'passed', 'failed', 'cancelled')),
  created_at timestamptz not null default now(),
  foreign key (job_id, user_id) references public.applications (job_id, user_id) on delete cascade
);
create index if not exists interviews_time on public.interviews (starts_at);
create index if not exists interviews_user_time on public.interviews (user_id, starts_at);

-- ── The jobs members win, and the pay they receive: reported by the member,
-- counted once an admin confirms. Changing what a report says asks again.
create table if not exists public.positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  job_id uuid references public.jobs (id) on delete set null,
  company text not null check (char_length(company) between 1 and 120),
  title text not null check (char_length(title) between 1 and 200),
  monthly_salary numeric(12, 2) not null check (monthly_salary >= 0 and monthly_salary < 10000000),
  started_on date,
  ended_on date,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'declined')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists positions_user on public.positions (user_id);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  position_id uuid references public.positions (id) on delete set null,
  amount numeric(12, 2) not null check (amount > 0 and amount < 10000000),
  paid_on date not null,
  note text check (char_length(note) <= 300),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'declined')),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists payments_user on public.payments (user_id, paid_on desc);

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
  if (to_jsonb(new) - quiet) <> (to_jsonb(old) - quiet) then
    new.status := 'pending'; new.decided_by := null; new.decided_at := null;
  end if;
  return new;
end $$;
drop trigger if exists position_written on public.positions;
create trigger position_written before insert or update on public.positions
  for each row execute function public.report_written();
drop trigger if exists payment_written on public.payments;
create trigger payment_written before insert or update on public.payments
  for each row execute function public.report_written();

-- ── Plans: each member's targets for a day, week (from Monday) or month (from
-- the 1st), set by an admin, with a note. Targets carry on to later periods
-- until changed; a note is for its own period.
create table if not exists public.plans (
  user_id uuid not null references auth.users (id) on delete cascade,
  period text not null check (period in ('day', 'week', 'month')),
  starts_on date not null,
  applications integer check (applications between 0 and 10000),
  interviews integer check (interviews between 0 and 1000),
  offers integer check (offers between 0 and 1000),
  note text check (char_length(note) <= 1000),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (user_id, period, starts_on)
);

-- ── Who may read and write what.
alter table public.job_settings enable row level security;
alter table public.jobs enable row level security;
alter table public.resumes enable row level security;
alter table public.applications enable row level security;
alter table public.interviews enable row level security;
alter table public.positions enable row level security;
alter table public.payments enable row level security;
alter table public.plans enable row level security;
revoke all on public.job_settings, public.jobs, public.resumes, public.applications, public.interviews, public.positions, public.payments, public.plans from anon;

drop policy if exists "the team reads job settings" on public.job_settings;
create policy "the team reads job settings" on public.job_settings for select to authenticated using ((select public.jobs_team()));
drop policy if exists "admins change job settings" on public.job_settings;
create policy "admins change job settings" on public.job_settings for update to authenticated using ((select public.jobs_admin())) with check ((select public.jobs_admin()));

drop policy if exists "the team reads jobs" on public.jobs;
create policy "the team reads jobs" on public.jobs for select to authenticated using ((select public.jobs_team()));
drop policy if exists "admins post jobs" on public.jobs;
create policy "admins post jobs" on public.jobs for insert to authenticated with check ((select public.jobs_admin()) and posted_by = (select auth.uid()));
drop policy if exists "admins change jobs" on public.jobs;
create policy "admins change jobs" on public.jobs for update to authenticated using ((select public.jobs_admin())) with check ((select public.jobs_admin()));
drop policy if exists "admins remove jobs" on public.jobs;
create policy "admins remove jobs" on public.jobs for delete to authenticated using ((select public.jobs_admin()));

drop policy if exists "members and admins read resumes" on public.resumes;
create policy "members and admins read resumes" on public.resumes for select to authenticated using (user_id = (select auth.uid()) or (select public.jobs_admin()));
drop policy if exists "members add resumes" on public.resumes;
create policy "members add resumes" on public.resumes for insert to authenticated with check (user_id = (select auth.uid()) and (select public.jobs_member()));
drop policy if exists "members change their resumes" on public.resumes;
create policy "members change their resumes" on public.resumes for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "members remove their resumes" on public.resumes;
create policy "members remove their resumes" on public.resumes for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "members and admins read applications" on public.applications;
create policy "members and admins read applications" on public.applications for select to authenticated using (user_id = (select auth.uid()) or (select public.jobs_admin()));
drop policy if exists "members apply" on public.applications;
create policy "members apply" on public.applications for insert to authenticated with check (user_id = (select auth.uid()) and (select public.jobs_member()));
drop policy if exists "members change their applications" on public.applications;
create policy "members change their applications" on public.applications for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "members take back applications" on public.applications;
create policy "members take back applications" on public.applications for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "members and admins read interviews" on public.interviews;
create policy "members and admins read interviews" on public.interviews for select to authenticated using (user_id = (select auth.uid()) or (select public.jobs_admin()));
drop policy if exists "members add interviews" on public.interviews;
create policy "members add interviews" on public.interviews for insert to authenticated with check (user_id = (select auth.uid()) and (select public.jobs_member()));
drop policy if exists "members and admins change interviews" on public.interviews;
create policy "members and admins change interviews" on public.interviews for update to authenticated
  using (user_id = (select auth.uid()) or (select public.jobs_admin())) with check (user_id = (select auth.uid()) or (select public.jobs_admin()));
drop policy if exists "members and admins remove interviews" on public.interviews;
create policy "members and admins remove interviews" on public.interviews for delete to authenticated using (user_id = (select auth.uid()) or (select public.jobs_admin()));

drop policy if exists "members and admins read positions" on public.positions;
create policy "members and admins read positions" on public.positions for select to authenticated using (user_id = (select auth.uid()) or (select public.jobs_admin()));
drop policy if exists "members and admins add positions" on public.positions;
create policy "members and admins add positions" on public.positions for insert to authenticated
  with check ((user_id = (select auth.uid()) and (select public.jobs_member())) or (select public.jobs_admin()));
drop policy if exists "members and admins change positions" on public.positions;
create policy "members and admins change positions" on public.positions for update to authenticated
  using (user_id = (select auth.uid()) or (select public.jobs_admin())) with check (user_id = (select auth.uid()) or (select public.jobs_admin()));
drop policy if exists "members and admins remove positions" on public.positions;
create policy "members and admins remove positions" on public.positions for delete to authenticated
  using ((user_id = (select auth.uid()) and status <> 'confirmed') or (select public.jobs_admin()));

drop policy if exists "members and admins read payments" on public.payments;
create policy "members and admins read payments" on public.payments for select to authenticated using (user_id = (select auth.uid()) or (select public.jobs_admin()));
drop policy if exists "members and admins add payments" on public.payments;
create policy "members and admins add payments" on public.payments for insert to authenticated
  with check ((user_id = (select auth.uid()) and (select public.jobs_member())) or (select public.jobs_admin()));
drop policy if exists "members and admins change payments" on public.payments;
create policy "members and admins change payments" on public.payments for update to authenticated
  using (user_id = (select auth.uid()) or (select public.jobs_admin())) with check (user_id = (select auth.uid()) or (select public.jobs_admin()));
drop policy if exists "members and admins remove payments" on public.payments;
create policy "members and admins remove payments" on public.payments for delete to authenticated
  using ((user_id = (select auth.uid()) and status <> 'confirmed') or (select public.jobs_admin()));

drop policy if exists "members and admins read plans" on public.plans;
create policy "members and admins read plans" on public.plans for select to authenticated using (user_id = (select auth.uid()) or (select public.jobs_admin()));
drop policy if exists "admins set plans" on public.plans;
create policy "admins set plans" on public.plans for all to authenticated using ((select public.jobs_admin())) with check ((select public.jobs_admin()));

-- ── Résumé files: one folder per member; the member and admins read it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resumes', 'resumes', false, 10485760, array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "members add their resume files" on storage.objects;
create policy "members add their resume files" on storage.objects for insert to authenticated
  with check (bucket_id = 'resumes' and (select public.jobs_member()) and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "members and admins read resume files" on storage.objects;
create policy "members and admins read resume files" on storage.objects for select to authenticated
  using (bucket_id = 'resumes' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.jobs_admin())));
drop policy if exists "members remove their resume files" on storage.objects;
create policy "members remove their resume files" on storage.objects for delete to authenticated
  using (bucket_id = 'resumes' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ── A day's jobs (in the team's time zone), each with this person's own
-- status and how many on the team have applied to it.
create or replace function public.jobs_on(on_day date)
returns table (id uuid, url text, title text, company text, location text, note text, posted_at timestamptz, posted_by uuid,
  status text, applied_at timestamptz, resume_id uuid, my_note text, applied bigint)
language sql stable security definer set search_path = '' as $$
  select j.id, j.url, j.title, j.company, j.location, j.note, j.posted_at, j.posted_by,
    a.status, a.applied_at, a.resume_id, a.note,
    (select count(*) from public.applications x where x.job_id = j.id and x.applied_at is not null)
  from public.jobs j
  cross join (select public.jobs_zone() as tz) z
  left join public.applications a on a.job_id = j.id and a.user_id = (select auth.uid())
  where (select public.jobs_team())
    and j.posted_at >= (on_day::timestamp at time zone z.tz) and j.posted_at < ((on_day + 1)::timestamp at time zone z.tz)
  order by j.posted_at desc, j.id;
$$;

-- ── The leaderboard and everyone's progress against their plans: totals only,
-- for everyone on the team. Today, this week (from Monday) and this month, in
-- the team's time zone; jobs held and pay count once confirmed.
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
  where p.status = 'approved' and (select public.jobs_team())
  order by p.name;
$$;

-- ── Trends: applications per member and day over the last days (an admin
-- sees everyone's; a member, their own), and per hour today.
create or replace function public.team_trend(days integer default 30)
returns table (user_id uuid, day date, applications bigint)
language sql stable security definer set search_path = '' as $$
  select a.user_id, (a.applied_at at time zone z.tz)::date, count(*)
  from public.applications a
  cross join (select public.jobs_zone() as tz) z
  where a.applied_at >= (((now() at time zone z.tz)::date - (least(greatest(days, 1), 120) - 1))::timestamp at time zone z.tz)
    and ((select public.jobs_admin()) or a.user_id = (select auth.uid()))
  group by 1, 2;
$$;

create or replace function public.team_hours()
returns table (user_id uuid, hour integer, applications bigint)
language sql stable security definer set search_path = '' as $$
  select a.user_id, extract(hour from a.applied_at at time zone z.tz)::integer, count(*)
  from public.applications a
  cross join (select public.jobs_zone() as tz) z
  where a.applied_at >= ((now() at time zone z.tz)::date::timestamp at time zone z.tz)
    and ((select public.jobs_admin()) or a.user_id = (select auth.uid()))
  group by 1, 2;
$$;

-- ── Résumés: one is the default, and how each has done.
create or replace function public.set_default_resume(resume uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.resumes r where r.id = resume and r.user_id = auth.uid()) then
    raise exception 'That résumé is not yours.';
  end if;
  update public.resumes set is_default = false where user_id = auth.uid() and is_default and id <> resume;
  update public.resumes set is_default = true where id = resume;
end $$;

create or replace function public.resume_stats()
returns table (resume_id uuid, applications bigint, interviews bigint, offers bigint)
language sql stable security definer set search_path = '' as $$
  select r.id,
    count(a.job_id) filter (where a.applied_at is not null),
    count(a.job_id) filter (where a.status in ('interview', 'offer', 'hired')
      or exists (select 1 from public.interviews i where i.job_id = a.job_id and i.user_id = a.user_id)),
    count(a.job_id) filter (where a.offered_at is not null)
  from public.resumes r
  left join public.applications a on a.resume_id = r.id
  where r.user_id = (select auth.uid()) or (select public.jobs_admin())
  group by r.id;
$$;

do $$
declare fn text;
begin
  foreach fn in array array['jobs_on(date)', 'team_board()', 'team_trend(integer)', 'team_hours()', 'set_default_resume(uuid)', 'resume_stats()'] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;

-- ── Live: every change reaches the pages it concerns the moment it happens,
-- as far as each person may read it; and a word on the team's private channel
-- ("jobs:team") tells every page to fetch the leaderboard's totals again.
do $$
declare t text;
begin
  foreach t in array array['jobs', 'applications', 'interviews', 'positions', 'payments', 'plans', 'resumes', 'job_settings'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

create or replace function public.job_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform realtime.send(jsonb_build_object('table', tg_table_name), 'activity', 'jobs:team', true);
  exception when others then null; -- a missed word never stops a write
  end;
  return null;
end $$;
do $$
declare t text;
begin
  foreach t in array array['applications', 'interviews', 'positions', 'payments'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_activity', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each statement execute function public.job_activity()', t || '_activity', t);
  end loop;
end $$;

drop policy if exists "the team hears job activity" on realtime.messages;
create policy "the team hears job activity" on realtime.messages
  for select to authenticated using (realtime.topic() = 'jobs:team' and public.jobs_team());
