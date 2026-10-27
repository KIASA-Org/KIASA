-- A team's manager sees their team's work on the Job desk, as the admin sees
-- everyone's: each member's applications a day and hour by hour, and their
-- plans. Only their own team's members (and simulated members only for a
-- tester), nothing of anyone else's. Run once, after the simulated members'
-- presence file. Running it again is safe.

-- Whether the person asking leads the team someone is in (themselves aside).
create or replace function public.leads(person uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select person <> auth.uid() and public.team_led_by(auth.uid()) is not null
    and public.team_of(person) = public.team_led_by(auth.uid()) and public.visible(person);
$$;
revoke execute on function public.leads(uuid) from public, anon;
grant execute on function public.leads(uuid) to authenticated;

-- Applications a day over the last days, and today hour by hour: an admin
-- sees everyone's, a manager their team's, a member their own.
create or replace function public.team_trend(days integer default 30)
returns table (user_id uuid, day date, applications bigint)
language sql stable security definer set search_path = '' as $$
  select a.user_id, (a.applied_at at time zone z.tz)::date, count(*)
  from public.applications a
  cross join (select public.jobs_zone() as tz) z
  where a.applied_at >= (((now() at time zone z.tz)::date - (least(greatest(days, 1), 120) - 1))::timestamp at time zone z.tz)
    and ((select public.jobs_admin()) or a.user_id = (select auth.uid()) or public.leads(a.user_id))
  group by 1, 2;
$$;

create or replace function public.team_hours()
returns table (user_id uuid, hour integer, applications bigint)
language sql stable security definer set search_path = '' as $$
  select a.user_id, extract(hour from a.applied_at at time zone z.tz)::integer, count(*)
  from public.applications a
  cross join (select public.jobs_zone() as tz) z
  where a.applied_at >= ((now() at time zone z.tz)::date::timestamp at time zone z.tz)
    and ((select public.jobs_admin()) or a.user_id = (select auth.uid()) or public.leads(a.user_id))
  group by 1, 2;
$$;

-- Plans: a manager reads their team's (an admin still sets them).
drop policy if exists "members and admins read plans" on public.plans;
create policy "members and admins read plans" on public.plans
  for select to authenticated using (user_id = (select auth.uid()) or (select public.jobs_admin()) or public.leads(user_id));
