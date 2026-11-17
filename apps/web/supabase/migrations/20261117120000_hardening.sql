-- KIASA, harder to break into (2): from the security review of 17 Nov 2026.
-- Run once, after every earlier file. Running it again is safe.
--
-- 1. An admin row never takes an account by its email. Anyone can make an
--    account with any address (the request form does not prove the address is
--    theirs), so "the account with that email" could be a stranger's, made
--    before the admin was added. A row now names its account (user_id), and that
--    account must have been marked as an admin's by someone with the database's
--    own powers (app_metadata, which no one can set for themselves):
--      update auth.users set raw_app_meta_data = raw_app_meta_data || '{"kiasa_admin": true}'
--        where id = '<the account''s id, from Authentication → Users>';
--      insert into public.admins (email, name, user_id) values ('<email>', '<name>', '<the same id>');
-- 2. The admin device check fails closed: an error while checking an admin's
--    sign-in gives that sign-in no powers, rather than all of them.
-- 3. Tries counted and checked in one step, so a burst of sign-ins at once
--    cannot all pass before any is counted.
-- 4. The Jobright bot posts only https links to named sites: never an address
--    on the computer itself or its network, nor one carrying a password.
-- 5. No one but an admin takes an admin's name (as they appear in chats).

-- ── 1. Admins by an account marked as an admin's ────────────────────────────
create or replace function public.admin_linked() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.email := lower(btrim(new.email));
  if new.user_id is null then
    raise exception 'An admin row needs its account''s user_id: admins are never found by email.';
  end if;
  if tg_op = 'UPDATE' and new.user_id is not distinct from old.user_id and new.email = old.email then
    return new;
  end if;
  if not exists (
    select 1 from auth.users u
    where u.id = new.user_id
      and lower(u.email) = new.email
      and coalesce(u.raw_app_meta_data ->> 'kiasa_admin', '') = 'true'
  ) then
    raise exception 'That account is not marked as an admin''s (app_metadata kiasa_admin), or its email is not %.', new.email;
  end if;
  return new;
end $$;
revoke execute on function public.admin_linked() from public, anon, authenticated;
drop trigger if exists admin_linked on public.admins;
create trigger admin_linked before insert or update of user_id, email on public.admins
  for each row execute function public.admin_linked();

-- The admins there already keep their accounts: they are marked now, so a later
-- change to their row passes the check above.
update auth.users u set raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || '{"kiasa_admin": true}'::jsonb
  where u.id in (select a.user_id from public.admins a where a.user_id is not null)
    and coalesce(u.raw_app_meta_data ->> 'kiasa_admin', '') <> 'true';

-- ── 2. The device check fails closed for admins ─────────────────────────────
create or replace function public.custom_access_token_hook(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  person uuid;
  session uuid;
begin
  if not coalesce((select s.admin_devices from public.security_settings s where s.id = 1), true) then return event; end if;
  person := case when event ->> 'user_id' ~ '^[0-9a-f-]{36}$' then (event ->> 'user_id')::uuid end;
  if person is null or not exists (select 1 from public.admins a where a.user_id = person) then return event; end if;
  session := case when event -> 'claims' ->> 'session_id' ~ '^[0-9a-f-]{36}$' then (event -> 'claims' ->> 'session_id')::uuid end;
  if session is not null and exists (select 1 from public.admin_sessions x where x.session_id = session and x.user_id = person) then
    return event;
  end if;
  return jsonb_set(event, '{claims,role}', '"anon"');
exception when others then
  -- Something failed while checking: an admin's sign-in gets no powers (they
  -- sign in again); anyone else's is as it was.
  begin
    if event ->> 'user_id' ~ '^[0-9a-f-]{36}$'
      and exists (select 1 from public.admins a where a.user_id = (event ->> 'user_id')::uuid) then
      return jsonb_set(event, '{claims,role}', '"anon"');
    end if;
  exception when others then
    return jsonb_set(event, '{claims,role}', '"anon"');
  end;
  return event;
end $$;
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;

-- ── 3. A try counted and checked at once ────────────────────────────────────
-- Whether there were already `most` tries of a kind from `who` in `within`; the
-- try is counted either way. Tries for the same key wait on one another.
create or replace function public.take_attempt(what text, who text, within interval, most int) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  seen int;
begin
  perform pg_advisory_xact_lock(hashtextextended(left(what, 40) || '|' || left(who, 300), 0));
  select count(*) into seen from (
    select 1 from public.attempts a where a.kind = left(what, 40) and a.key = left(who, 300) and a.at > now() - within limit most
  ) recent;
  insert into public.attempts (kind, key) values (left(what, 40), left(who, 300));
  if random() < 0.02 then delete from public.attempts where at < now() - interval '1 day'; end if;
  return seen >= most;
end $$;
revoke execute on function public.take_attempt(text, text, interval, int) from public, anon, authenticated;
grant execute on function public.take_attempt(text, text, interval, int) to service_role;

-- ── 4. The Jobright bot's links: https, to a named site ─────────────────────
create or replace function public.job_link_safe(link text) returns boolean
language sql immutable set search_path = '' as $$
  select link ~* '^https://[^\s/?#@]+(/[^\s]*)?$'
    and char_length(link) <= 2000
    -- The host: a name with a dot, not a bare address, not this computer or its network.
    and lower(substring(link from '^https://([^/?#:]+)')) ~ '^([a-z0-9-]+\.)+[a-z][a-z0-9-]+$'
    and lower(substring(link from '^https://([^/?#:]+)')) !~ '(^|\.)(localhost|local|internal|lan|home|corp|intranet)$';
$$;

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
    if link is null or not public.job_link_safe(link) then continue; end if;
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

-- ── 5. An admin's name is theirs ────────────────────────────────────────────
create or replace function public.update_profile(full_name text, about text default '', handle text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  new_name text := left(regexp_replace(btrim(coalesce(full_name, '')), '\s+', ' ', 'g'), 80);
  new_handle text := nullif(lower(btrim(coalesce(handle, ''), ' @')), '');
begin
  if me is null or not public.can_chat() then raise exception 'Please sign in again.'; end if;
  if new_name = '' then raise exception 'Please give your name.'; end if;
  if char_length(coalesce(about, '')) > 140 then raise exception 'Your bio can be up to 140 characters.'; end if;
  if new_handle is not null and new_handle !~ '^[a-z0-9_]{5,32}$' then
    raise exception 'A username uses a–z, 0–9 and underscores, at least 5 of them.';
  end if;
  if new_handle is not null and exists (select 1 from public.chat_profiles p where p.username = new_handle and p.user_id <> me) then
    raise exception 'That username is taken. Please choose another.';
  end if;
  if not exists (select 1 from public.admins a where a.user_id = me)
    and exists (select 1 from public.admins a where lower(a.name) = lower(new_name))
    and not exists (select 1 from public.profiles p where p.id = me and lower(p.name) = lower(new_name)) then
    raise exception 'That name is an admin''s. Please give your own.';
  end if;
  update public.profiles set name = new_name where id = me;
  update public.admins set name = new_name where user_id = me;
  update public.chat_members set name = new_name where user_id = me;
  insert into public.chat_profiles (user_id, username, bio) values (me, new_handle, coalesce(about, ''))
    on conflict (user_id) do update set username = excluded.username, bio = excluded.bio;
end $$;
