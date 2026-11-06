-- Support sessions: a member shares their Windows screen and sound with one manager.
--
-- The member's KIASA Sound Desk app captures and sends; the manager watches and talks in
-- the website (/support/<id>). Media goes straight between the two (or through the
-- relay) and is never stored. This file keeps only who, when and what was agreed:
--
--   support_sessions  one row per session: member, manager, state, the member's consent.
--   support_events    append-only history: requested, invited, consent, joined, paused,
--                     muted, ended... Nobody can change or delete a row, admins included.
--
-- Who may do what is decided here, never by a page or the app:
--   * A manager is an admin, or the top manager of the member's own team.
--   * Only the member can give consent (support_accept / support_request), and only
--     for a manager who may manage them.
--   * Either side can end a session; ending is final and idempotent.
--   * The live channel support:<id> is open to the member and the assigned manager
--     while the session is live, the member's app is still beating, and the manager
--     is still allowed. Realtime checks this when a channel is joined, so both sides
--     also re-check the row every few seconds and stop when it says ended.
--   * A session whose app stopped beating for 2 minutes ends by itself ("lapsed").
--
-- Run once, after the earlier files. Running it again is safe.

create table if not exists public.support_sessions (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references auth.users (id) on delete cascade,
  manager_id uuid not null references auth.users (id) on delete cascade,
  opened_by uuid not null references auth.users (id) on delete cascade,
  status text not null check (status in ('invited', 'live', 'ended')),
  created_at timestamptz not null default now(),
  invite_expires_at timestamptz,
  accepted_at timestamptz,
  consent jsonb,
  seat uuid,
  member_seen_at timestamptz,
  manager_seen_at timestamptz,
  ended_at timestamptz,
  ended_by uuid,
  end_reason text check (char_length(end_reason) <= 40),
  check (member_id <> manager_id)
);
-- One open session per member at a time.
create unique index if not exists support_sessions_one_open on public.support_sessions (member_id) where status <> 'ended';
create index if not exists support_sessions_manager on public.support_sessions (manager_id, created_at desc);
create index if not exists support_sessions_member on public.support_sessions (member_id, created_at desc);
alter table public.support_sessions enable row level security;
revoke insert, update, delete on public.support_sessions from anon, authenticated;

create table if not exists public.support_events (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.support_sessions (id) on delete cascade,
  at timestamptz not null default now(),
  actor uuid,
  kind text not null check (kind ~ '^[a-z_]{2,32}$'),
  detail jsonb not null default '{}'::jsonb check (pg_column_size(detail) <= 2048)
);
create index if not exists support_events_session on public.support_events (session_id, id);
alter table public.support_events enable row level security;
revoke insert, update, delete, truncate on public.support_events from anon, authenticated, public;

-- Whether `manager` may run support for `member`: an admin, or the top manager of the member's team.
create or replace function public.support_manager_ok(manager uuid, member uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select manager <> member
    and exists (select 1 from public.profiles p where p.id = member and p.status = 'approved')
    and (public.is_admin_user(manager)
      or (public.team_led_by(manager) is not null and public.team_led_by(manager) = public.team_of(member)));
$$;
revoke execute on function public.support_manager_ok(uuid, uuid) from public, anon, authenticated;

-- The person asking is the manager in this call (an admin's device lock applies).
create or replace function public.support_i_manage(member uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.support_manager_ok(auth.uid(), member)
    and (not public.is_admin_user(auth.uid()) or public.admin_session_ok() or public.team_led_by(auth.uid()) = public.team_of(member));
$$;
revoke execute on function public.support_i_manage(uuid) from public, anon, authenticated;

create or replace function public.support_note_raw(session uuid, what text, detail jsonb default '{}'::jsonb) returns void
language sql volatile security definer set search_path = '' as $$
  insert into public.support_events (session_id, actor, kind, detail) values (session, auth.uid(), what, coalesce(detail, '{}'::jsonb));
$$;
revoke execute on function public.support_note_raw(uuid, text, jsonb) from public, anon, authenticated;

-- Sessions whose app went quiet, or invitations not answered in time, end by themselves.
create or replace function public.support_lapse() returns void
language plpgsql volatile security definer set search_path = '' as $$
declare r record;
begin
  for r in update public.support_sessions s
      set status = 'ended', ended_at = now(), end_reason = case when s.status = 'invited' then 'invite_expired' else 'lapsed' end
    where (s.status = 'live' and s.member_seen_at < now() - interval '2 minutes')
       or (s.status = 'invited' and s.invite_expires_at < now())
    returning s.id, s.end_reason
  loop
    insert into public.support_events (session_id, actor, kind, detail) values (r.id, null, 'ended', jsonb_build_object('reason', r.end_reason));
  end loop;
end $$;
revoke execute on function public.support_lapse() from public, anon, authenticated;

-- Participants (and admins) read the session and its history.
drop policy if exists "support sessions read" on public.support_sessions;
create policy "support sessions read" on public.support_sessions
  for select to authenticated
  using (member_id = (select auth.uid()) or manager_id = (select auth.uid()) or (select public.am_admin()));
drop policy if exists "support events read" on public.support_events;
create policy "support events read" on public.support_events
  for select to authenticated
  using (exists (select 1 from public.support_sessions s where s.id = session_id
    and (s.member_id = (select auth.uid()) or s.manager_id = (select auth.uid()) or (select public.am_admin()))));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'support_sessions') then
    alter publication supabase_realtime add table public.support_sessions;
  end if;
end $$;

-- The managers a member may ask for help: admins, and their own team's top manager.
create or replace function public.support_managers()
returns table (id uuid, name text, role text)
language sql stable security definer set search_path = '' as $$
  select a.user_id, a.name, 'Admin'::text from public.admins a
    where a.user_id is not null and public.support_manager_ok(a.user_id, auth.uid())
  union
  select t.user_id, coalesce(p.name, 'Team manager'), 'Team manager'::text from public.top_managers t
    left join public.profiles p on p.id = t.user_id
    where not exists (select 1 from public.admins a where a.user_id = t.user_id)
      and public.support_manager_ok(t.user_id, auth.uid());
$$;
revoke execute on function public.support_managers() from public, anon;
grant execute on function public.support_managers() to authenticated;

-- The members a manager may support (for the website's Invite list).
create or replace function public.support_members()
returns table (id uuid, name text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.name from public.profiles p
    where p.status = 'approved' and p.id <> auth.uid() and public.support_i_manage(p.id)
    order by p.name;
$$;
revoke execute on function public.support_members() from public, anon;
grant execute on function public.support_members() to authenticated;

-- Display name of anyone in a session, for the other side.
create or replace function public.support_name(person uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce((select a.name from public.admins a where a.user_id = person),
                  (select p.name from public.profiles p where p.id = person), 'KIASA');
$$;
revoke execute on function public.support_name(uuid) from public, anon, authenticated;

-- What a participant sees of a session (one shape for the app and the website).
create or replace function public.support_view(s public.support_sessions) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', s.id, 'status', s.status, 'member_id', s.member_id, 'manager_id', s.manager_id,
    'member_name', public.support_name(s.member_id), 'manager_name', public.support_name(s.manager_id),
    'manager_role', case when public.is_admin_user(s.manager_id) then 'Admin' else 'Team manager' end,
    'opened_by', s.opened_by, 'created_at', s.created_at, 'invite_expires_at', s.invite_expires_at,
    'accepted_at', s.accepted_at, 'consent', s.consent, 'seat', case when s.manager_id = auth.uid() or s.member_id = auth.uid() then s.seat end,
    'member_seen_at', s.member_seen_at, 'manager_seen_at', s.manager_seen_at,
    'ended_at', s.ended_at, 'end_reason', s.end_reason,
    'manager_ok', public.support_manager_ok(s.manager_id, s.member_id));
$$;
revoke execute on function public.support_view(public.support_sessions) from public, anon, authenticated;

-- Consent, checked: which screen, and whether system sound and the microphone are shared.
create or replace function public.support_consent_ok(consent jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_typeof(consent) = 'object'
    and pg_column_size(consent) <= 1024
    and consent ? 'screen' and jsonb_typeof(consent -> 'screen') = 'string'
    and coalesce(jsonb_typeof(consent -> 'system_audio'), 'boolean') = 'boolean'
    and coalesce(jsonb_typeof(consent -> 'mic'), 'boolean') = 'boolean';
$$;

-- A member asks a manager for help, and consents at the same time (they chose the
-- manager, the screen and the sounds in the app first). The session is live at once.
create or replace function public.support_request(manager uuid, consent jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare me uuid := auth.uid(); s public.support_sessions;
begin
  perform public.support_lapse();
  if me is null or not public.support_manager_ok(manager, me) then raise exception 'not allowed' using errcode = '42501'; end if;
  if not public.support_consent_ok(consent) then raise exception 'bad consent' using errcode = '22023'; end if;
  if exists (select 1 from public.support_sessions x where x.member_id = me and x.status <> 'ended') then
    raise exception 'already open' using errcode = '23505';
  end if;
  insert into public.support_sessions (member_id, manager_id, opened_by, status, accepted_at, consent, member_seen_at)
    values (me, manager, me, 'live', now(), consent, now()) returning * into s;
  perform public.support_note_raw(s.id, 'requested', jsonb_build_object('manager', manager));
  perform public.support_note_raw(s.id, 'consent', consent);
  return public.support_view(s);
end $$;
revoke execute on function public.support_request(uuid, jsonb) from public, anon;
grant execute on function public.support_request(uuid, jsonb) to authenticated;

-- A manager invites a member. Nothing is shared until the member accepts in the app.
create or replace function public.support_invite(member uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare s public.support_sessions;
begin
  perform public.support_lapse();
  if auth.uid() is null or not public.support_i_manage(member) then raise exception 'not allowed' using errcode = '42501'; end if;
  if exists (select 1 from public.support_sessions x where x.member_id = member and x.status <> 'ended') then
    raise exception 'already open' using errcode = '23505';
  end if;
  insert into public.support_sessions (member_id, manager_id, opened_by, status, invite_expires_at)
    values (member, auth.uid(), auth.uid(), 'invited', now() + interval '10 minutes') returning * into s;
  perform public.support_note_raw(s.id, 'invited', '{}'::jsonb);
  return public.support_view(s);
end $$;
revoke execute on function public.support_invite(uuid) from public, anon;
grant execute on function public.support_invite(uuid) to authenticated;

-- Only the member themself can accept an invitation, while it is open and the manager still allowed.
create or replace function public.support_accept(session uuid, consent jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare s public.support_sessions;
begin
  perform public.support_lapse();
  select * into s from public.support_sessions x where x.id = session for update;
  if not found or s.member_id is distinct from auth.uid() then raise exception 'not allowed' using errcode = '42501'; end if;
  if s.status <> 'invited' then raise exception 'not open' using errcode = '55000'; end if;
  if not public.support_manager_ok(s.manager_id, s.member_id) then raise exception 'manager not allowed' using errcode = '42501'; end if;
  if not public.support_consent_ok(consent) then raise exception 'bad consent' using errcode = '22023'; end if;
  update public.support_sessions set status = 'live', accepted_at = now(), consent = support_accept.consent, member_seen_at = now()
    where id = s.id returning * into s;
  perform public.support_note_raw(s.id, 'consent', consent);
  return public.support_view(s);
end $$;
revoke execute on function public.support_accept(uuid, jsonb) from public, anon;
grant execute on function public.support_accept(uuid, jsonb) to authenticated;

-- The member says no to an invitation.
create or replace function public.support_decline(session uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  update public.support_sessions set status = 'ended', ended_at = now(), ended_by = auth.uid(), end_reason = 'declined'
    where id = session and member_id = auth.uid() and status = 'invited';
  if found then perform public.support_note_raw(session, 'declined', '{}'::jsonb); end if;
end $$;
revoke execute on function public.support_decline(uuid) from public, anon;
grant execute on function public.support_decline(uuid) to authenticated;

-- The manager opens the live session in the website. Each opening gets a new seat:
-- the app sends only to the newest seat, so an older tab or a replayed join gets nothing.
create or replace function public.support_join(session uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare s public.support_sessions;
begin
  perform public.support_lapse();
  select * into s from public.support_sessions x where x.id = session for update;
  if not found or s.manager_id is distinct from auth.uid() or not public.support_i_manage(s.member_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if s.status <> 'live' then raise exception 'not live' using errcode = '55000'; end if;
  update public.support_sessions set seat = gen_random_uuid(), manager_seen_at = now() where id = s.id returning * into s;
  perform public.support_note_raw(s.id, 'manager_joined', jsonb_build_object('seat', s.seat));
  return public.support_view(s);
end $$;
revoke execute on function public.support_join(uuid) from public, anon;
grant execute on function public.support_join(uuid) to authenticated;

-- Both sides beat every few seconds: proof of life, and the session's state back.
-- A manager no longer allowed ends the session here ("revoked").
create or replace function public.support_beat(session uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare s public.support_sessions; me uuid := auth.uid();
begin
  perform public.support_lapse();
  select * into s from public.support_sessions x where x.id = session for update;
  if not found or (s.member_id is distinct from me and s.manager_id is distinct from me) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if s.status <> 'ended' and not public.support_manager_ok(s.manager_id, s.member_id) then
    update public.support_sessions set status = 'ended', ended_at = now(), end_reason = 'revoked' where id = s.id returning * into s;
    perform public.support_note_raw(s.id, 'ended', jsonb_build_object('reason', 'revoked'));
  elsif s.status = 'live' and me = s.member_id then
    update public.support_sessions set member_seen_at = now() where id = s.id returning * into s;
  elsif s.status = 'live' and me = s.manager_id then
    update public.support_sessions set manager_seen_at = now() where id = s.id returning * into s;
  end if;
  return public.support_view(s);
end $$;
revoke execute on function public.support_beat(uuid) from public, anon;
grant execute on function public.support_beat(uuid) to authenticated;

-- Things that happened, noted by a participant (pause, mute, reconnect, diagnostics).
create or replace function public.support_note(session uuid, what text, detail jsonb default '{}'::jsonb) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if what not in ('connected', 'reconnecting', 'degraded', 'recovered', 'paused', 'resumed', 'screen_changed',
                  'display_lost', 'system_audio_on', 'system_audio_off', 'mic_on', 'mic_off', 'manager_mic_on',
                  'manager_mic_off', 'manager_left', 'diagnostics', 'capture_failed') then
    raise exception 'unknown event' using errcode = '22023';
  end if;
  if not exists (select 1 from public.support_sessions s where s.id = session and s.status = 'live'
                 and (s.member_id = auth.uid() or s.manager_id = auth.uid())) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if (select count(*) from public.support_events e where e.session_id = session and e.at > now() - interval '1 minute') > 60 then
    raise exception 'too many' using errcode = '54000';
  end if;
  perform public.support_note_raw(session, what, coalesce(detail, '{}'::jsonb));
end $$;
revoke execute on function public.support_note(uuid, text, jsonb) from public, anon;
grant execute on function public.support_note(uuid, text, jsonb) to authenticated;

-- Either side ends it. Final, and safe to call again.
create or replace function public.support_end(session uuid, reason text default 'stopped') returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare s public.support_sessions;
begin
  select * into s from public.support_sessions x where x.id = session for update;
  if not found or (s.member_id is distinct from auth.uid() and s.manager_id is distinct from auth.uid() and not public.am_admin()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if s.status <> 'ended' then
    update public.support_sessions set status = 'ended', ended_at = now(), ended_by = auth.uid(),
      end_reason = left(coalesce(nullif(reason, ''), 'stopped'), 40)
      where id = s.id returning * into s;
    perform public.support_note_raw(s.id, 'ended', jsonb_build_object('reason', s.end_reason));
  end if;
  return public.support_view(s);
end $$;
revoke execute on function public.support_end(uuid, text) from public, anon;
grant execute on function public.support_end(uuid, text) to authenticated;

-- The member's own open session and invitations, for the app.
create or replace function public.support_mine() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
begin
  perform public.support_lapse();
  return coalesce((select jsonb_agg(public.support_view(s) order by s.created_at desc) from public.support_sessions s
    where s.member_id = auth.uid() and s.status <> 'ended'), '[]'::jsonb);
end $$;
revoke execute on function public.support_mine() from public, anon;
grant execute on function public.support_mine() to authenticated;

-- Whether the relay may be handed to this person for this session (the website and app ask before ICE).
create or replace function public.support_relay_ok(session uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.support_sessions s where s.id = session and s.status = 'live'
    and ((s.member_id = auth.uid()) or (s.manager_id = auth.uid() and public.support_i_manage(s.member_id))));
$$;
revoke execute on function public.support_relay_ok(uuid) from public, anon;
grant execute on function public.support_relay_ok(uuid) to authenticated;

-- The live channel support:<id>: the member while live; the manager while live, the
-- member's app beating, and the manager still allowed.
create or replace function public.support_allowed(topic text) returns boolean
language sql stable security definer set search_path = '' as $$
  select case when topic ~ '^support:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    exists (select 1 from public.support_sessions s
      where s.id = substring(topic from 9)::uuid and s.status = 'live'
        and ((s.member_id = auth.uid())
          or (s.manager_id = auth.uid() and s.member_seen_at > now() - interval '2 minutes' and public.support_i_manage(s.member_id))))
  else false end;
$$;
revoke execute on function public.support_allowed(text) from public, anon;
grant execute on function public.support_allowed(text) to authenticated;

drop policy if exists "support channel read" on realtime.messages;
create policy "support channel read" on realtime.messages
  for select to authenticated
  using (realtime.messages.extension = 'broadcast' and public.support_allowed(realtime.topic()));
drop policy if exists "support channel send" on realtime.messages;
create policy "support channel send" on realtime.messages
  for insert to authenticated
  with check (realtime.messages.extension = 'broadcast' and public.support_allowed(realtime.topic()));
