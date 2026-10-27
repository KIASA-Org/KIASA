-- Simulated members at work: every five minutes, each one at work now goes
-- through its daily plan, at its pace for the day, spread over its working
-- hours, applying to the day's real job links. Only real links: on a day with
-- no links (or too few), it applies to what there is, and nothing more is
-- counted. Interviews and offers are never made up. Run once, after the
-- simulated members file. Running it again is safe.

-- Its plan for a day: the applications of its latest daily plan from then on
-- (set on the Plans page, or for many at once on the Simulated page), or the
-- team's daily goal, as the Jobs pages count it.
create or replace function public.sim_plan(person uuid, on_day date) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((select p.applications from public.plans p
    where p.user_id = person and p.period = 'day' and p.starts_on <= on_day and p.applications is not null
    order by p.starts_on desc limit 1), 100);
$$;

-- Its target for a day: its plan, at a pace for that day somewhere in its range
-- (the same all day long, different from one day to the next).
create or replace function public.sim_target(person uuid, on_day date) returns integer
language sql stable security definer set search_path = '' as $$
  select round(public.sim_plan(person, on_day)
    * (s.pace_min + (s.pace_max - s.pace_min) * ((abs(hashtext(person::text || on_day::text)) % 1000) / 1000.0)))::integer
  from public.sim_members s where s.user_id = person;
$$;
revoke execute on function public.sim_plan(uuid, date) from public, anon, authenticated;
revoke execute on function public.sim_target(uuid, date) from public, anon, authenticated;

-- One round of work, for everyone at work now. Gives back how many applications were made.
create or replace function public.sims_work() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  tz text := public.jobs_zone();
  here timestamp := now() at time zone tz;
  today date := (now() at time zone tz)::date;
  day_start timestamptz := (today::timestamp at time zone tz);
  day_end timestamptz := ((today + 1)::timestamp at time zone tz);
  s record;
  target integer;
  span numeric;
  gone numeric;
  due integer;
  done integer;
  added integer;
  total integer := 0;
begin
  for s in
    select m.user_id, m.active_from, m.active_to from public.sim_members m join public.profiles p on p.id = m.user_id
    where p.status = 'approved' and not m.paused and extract(isodow from here)::smallint = any(m.days)
      and here::time >= m.active_from and here::time < m.active_to
  loop
    target := public.sim_target(s.user_id, today);
    if coalesce(target, 0) <= 0 then continue; end if;
    -- How far through its hours it is, one round ahead, so the last round finishes the day.
    span := extract(epoch from (s.active_to - s.active_from));
    gone := least(span, extract(epoch from (here::time - s.active_from)) + 300);
    -- As people work: a little ahead or behind, by the quarter hour.
    due := least(target, greatest(0, floor(target * gone / span)::integer
      + (abs(hashtext(s.user_id::text || floor(extract(epoch from now()) / 900)::text)) % 3) - 1));
    select count(*) into done from public.applications a
      where a.user_id = s.user_id and a.applied_at >= day_start and a.applied_at < day_end;
    if due <= done then continue; end if;
    -- The day's real links it has not applied to yet, in an order of its own.
    insert into public.applications (job_id, user_id, status)
      select j.id, s.user_id, 'applied' from public.jobs j
      where j.posted_at >= day_start and j.posted_at < day_end
        and not exists (select 1 from public.applications x where x.job_id = j.id and x.user_id = s.user_id)
      order by hashtext(s.user_id::text || j.id::text)
      limit due - done;
    get diagnostics added = row_count;
    total := total + added;
  end loop;
  return total;
end $$;
revoke execute on function public.sims_work() from public, anon, authenticated;

-- Each one's day so far, for the admin's page: its target, and what it has done.
create or replace function public.sims_today()
returns table (user_id uuid, target integer, done bigint, links bigint)
language sql stable security definer set search_path = '' as $$
  with z as (select public.jobs_zone() as tz),
  d as (select (now() at time zone z.tz)::date as today, z.tz from z),
  e as (select today, (today::timestamp at time zone tz) as day_start, ((today + 1)::timestamp at time zone tz) as day_end from d)
  select s.user_id, public.sim_target(s.user_id, e.today),
    (select count(*) from public.applications a where a.user_id = s.user_id and a.applied_at >= e.day_start and a.applied_at < e.day_end),
    (select count(*) from public.jobs j where j.posted_at >= e.day_start and j.posted_at < e.day_end)
  from public.sim_members s cross join e
  where public.is_admin();
$$;
revoke execute on function public.sims_today() from public, anon;
grant execute on function public.sims_today() to authenticated;

-- Every five minutes, a round of work. (pg_cron is Supabase's own scheduler.)
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('kiasa-sims-work', '*/5 * * * *', 'select public.sims_work()');
