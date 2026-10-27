-- Simulated members online or offline, as the admin sets each one: online,
-- offline, or auto (the default), where each comes and goes as a person does:
-- mostly online through its working hours, with short breaks (never offline
-- more than two hours of them at a stretch), and now and then for a few
-- minutes outside them. The pages work out "auto" from each one's hours, the
-- same way for everyone who sees them. One set offline does no work. Run once,
-- after the group signals file. Running it again is safe.

alter table public.sim_members add column if not exists presence text not null default 'auto';
alter table public.sim_members drop constraint if exists sim_members_presence_check;
alter table public.sim_members add constraint sim_members_presence_check check (presence in ('auto', 'online', 'offline'));

-- A round of work, now leaving out those set offline.
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
    where p.status = 'approved' and not m.paused and m.presence <> 'offline' and extract(isodow from here)::smallint = any(m.days)
      and here::time >= m.active_from and here::time < m.active_to
  loop
    target := public.sim_target(s.user_id, today);
    if coalesce(target, 0) <= 0 then continue; end if;
    span := extract(epoch from (s.active_to - s.active_from));
    gone := least(span, extract(epoch from (here::time - s.active_from)) + 300);
    due := least(target, greatest(0, floor(target * gone / span)::integer
      + (abs(hashtext(s.user_id::text || floor(extract(epoch from now()) / 900)::text)) % 3) - 1));
    select count(*) into done from public.applications a
      where a.user_id = s.user_id and a.applied_at >= day_start and a.applied_at < day_end;
    if due <= done then continue; end if;
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
