-- Tailored résumés: each member keeps one base résumé (typed, imported from
-- their PDF, or generated with the init prompt), and for any job of the day
-- copies the tailoring prompt with the job's description and their résumé,
-- pastes the chat's answer back, and gets a résumé made for that job (a PDF on
-- demand). Each job keeps its description for it. Run after
-- 20261029230000_admin_devices.sql. Running it again is safe.

-- ── Each job's description: from the Jobright bot (what the extension read),
-- or read off the posting's page for a pasted link; admins can change it.
alter table public.jobs add column if not exists description text check (char_length(description) <= 30000);

-- ── A member's base résumé: the profile every tailoring starts from.
create table if not exists public.resume_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  profile jsonb not null check (jsonb_typeof(profile) = 'object' and pg_column_size(profile) <= 200000),
  -- How it was made: typed in the form, imported from their PDF, or generated with the init prompt.
  status text not null default 'typed' check (status in ('typed', 'imported', 'generated')),
  updated_at timestamptz not null default now()
);

-- ── The résumé made for one job: the base with the chat's changes applied,
-- and what was applied (the report). Edited by hand afterwards, it says so.
create table if not exists public.tailored_resumes (
  job_id uuid not null references public.jobs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  profile jsonb not null check (jsonb_typeof(profile) = 'object' and pg_column_size(profile) <= 200000),
  report jsonb not null default '{}'::jsonb check (jsonb_typeof(report) = 'object' and pg_column_size(report) <= 100000),
  edited boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (job_id, user_id)
);
create index if not exists tailored_resumes_user on public.tailored_resumes (user_id, updated_at desc);

create or replace function public.resume_written() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then raise exception 'A résumé stays with its member.'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists resume_profiles_written on public.resume_profiles;
create trigger resume_profiles_written before insert or update on public.resume_profiles for each row execute function public.resume_written();
drop trigger if exists tailored_resumes_written on public.tailored_resumes;
create trigger tailored_resumes_written before insert or update on public.tailored_resumes for each row execute function public.resume_written();

-- Members keep their own; admins read everyone's (to see what was sent).
alter table public.resume_profiles enable row level security;
alter table public.tailored_resumes enable row level security;
revoke all on public.resume_profiles, public.tailored_resumes from public, anon;
grant select, insert, update, delete on public.resume_profiles, public.tailored_resumes to authenticated;

drop policy if exists "members keep their base resume" on public.resume_profiles;
create policy "members keep their base resume" on public.resume_profiles for all to authenticated
  using (user_id = (select auth.uid()) and (select public.jobs_member()))
  with check (user_id = (select auth.uid()) and (select public.jobs_member()));
drop policy if exists "admins read base resumes" on public.resume_profiles;
create policy "admins read base resumes" on public.resume_profiles for select to authenticated using ((select public.jobs_admin()));

drop policy if exists "members keep their tailored resumes" on public.tailored_resumes;
create policy "members keep their tailored resumes" on public.tailored_resumes for all to authenticated
  using (user_id = (select auth.uid()) and (select public.jobs_member()))
  with check (user_id = (select auth.uid()) and (select public.jobs_member()));
drop policy if exists "admins read tailored resumes" on public.tailored_resumes;
create policy "admins read tailored resumes" on public.tailored_resumes for select to authenticated using ((select public.jobs_admin()));

-- ── The Jobright bot posts each job with its description (as before, and the
-- description too; a job already on the list gets one if it had none).
create or replace function public.job_bot_add_jobs(bot_key text, jobs jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  me uuid := public.job_bot_of(bot_key);
  item jsonb;
  link text;
  job uuid;
  fresh boolean;
  its_run uuid;
  title text;
  company text;
  place text;
  about text;
  added integer := 0;
  known integer := 0;
begin
  for item in select value from jsonb_array_elements(case when jsonb_typeof(jobs) = 'array' then jobs else '[]'::jsonb end) limit 50 loop
    link := btrim(item ->> 'url');
    if link is null or link !~* '^https?://[^\s]+$' or char_length(link) > 2000 then continue; end if;
    title := left(nullif(btrim(item ->> 'title'), ''), 200);
    company := left(nullif(btrim(item ->> 'company'), ''), 120);
    place := left(nullif(btrim(item ->> 'location'), ''), 120);
    about := left(nullif(btrim(item ->> 'description'), ''), 30000);
    job := null;
    insert into public.jobs (url, title, company, location, description, posted_by) values (link, title, company, place, about, null)
      on conflict (url) do nothing returning id into job;
    fresh := job is not null;
    if fresh then
      added := added + 1;
    else
      known := known + 1;
      select j.id into job from public.jobs j where j.url = link;
      if about is not null then
        update public.jobs j set description = about where j.id = job and j.description is null;
      end if;
    end if;
    its_run := null;
    if item ->> 'run' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select r.id into its_run from public.bot_runs r where r.id = (item ->> 'run')::uuid and r.bot_id = me;
    end if;
    if its_run is not null then
      insert into public.bot_steps (run_id, level, text, job_id) values (its_run, case when fresh then 'ok' else 'info' end,
        left((case when fresh then 'Posted: ' else 'Already on the list: ' end)
          || coalesce(nullif(concat_ws(' · ', title, company, place), ''), link), 300), job);
    end if;
  end loop;
  return jsonb_build_object('added', added, 'known', known);
end $$;
revoke execute on function public.job_bot_add_jobs(text, jsonb) from public;
grant execute on function public.job_bot_add_jobs(text, jsonb) to anon, authenticated;
