-- Admins on their own devices only. An admin's account works only in a browser
-- the admin has approved: a sign-in anywhere else, even with the right
-- password, is refused and waits for approval from an approved device. Run
-- after 20261029210000_jobright_bot.sql. Running it again is safe.
--
-- Two layers:
-- 1. Admin powers (is_admin, jobs_admin, can_chat for admins, and the site's
--    server) hold only in a sign-in the site approved, which it does when the
--    browser shows an approved device's secret (a cookie only the server reads).
-- 2. With Supabase's access token hook switched on (Authentication > Hooks >
--    Customize Access Token > public.custom_access_token_hook), any other
--    sign-in to an admin's account gets no signed-in access at all: its token
--    says "anon", so it cannot even read the admin's chats.
--
-- The first device: an admin with no approved device has the next browser they
-- sign in with approved. Locked out (the browser's data cleared, the computer
-- gone)? In the SQL Editor:
--   delete from public.admin_devices where user_id = (select user_id from public.admins where email = 'chrislim@kiasa.tech');
-- and the next sign-in is the first device again.

-- ── The switch: on, unless a database (a local test copy) turns it off.
create table if not exists public.security_settings (
  id integer primary key default 1 check (id = 1),
  admin_devices boolean not null default true
);
insert into public.security_settings (id) values (1) on conflict (id) do nothing;

-- ── An admin's devices: approved, or asking (approved_at null). Only the hash
-- of each device's secret is kept.
create table if not exists public.admin_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  name text not null check (char_length(name) between 1 and 120),
  address text check (char_length(address) <= 64),
  asked_at timestamptz not null default now(),
  approved_at timestamptz,
  last_used_at timestamptz
);
create index if not exists admin_devices_user on public.admin_devices (user_id);

-- The sign-ins (Supabase sessions) the site approved, each on its device; one
-- ends with its session, or when its device is removed.
create table if not exists public.admin_sessions (
  session_id uuid primary key references auth.sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id uuid not null references public.admin_devices (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists admin_sessions_device on public.admin_sessions (device_id);

-- The site's server alone reads and writes these (with its secret key).
alter table public.security_settings enable row level security;
alter table public.admin_devices enable row level security;
alter table public.admin_sessions enable row level security;
revoke all on public.security_settings, public.admin_devices, public.admin_sessions from public, anon, authenticated;

-- ── This sign-in may use admin powers: the lock is off, or the site approved it.
create or replace function public.admin_session_ok() returns boolean
language sql stable security definer set search_path = '' as $$
  select not coalesce((select s.admin_devices from public.security_settings s where s.id = 1), true)
    or exists (select 1 from public.admin_sessions x
      where x.user_id = auth.uid()
        and x.session_id = case when auth.jwt() ->> 'session_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (auth.jwt() ->> 'session_id')::uuid end);
$$;

-- Admins' powers, as before, in an approved sign-in only.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid()) and public.admin_session_ok();
$$;
create or replace function public.jobs_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid()) and public.admin_session_ok();
$$;
create or replace function public.can_chat() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'approved')
      or (exists (select 1 from public.admins a where a.user_id = auth.uid()) and public.admin_session_ok());
$$;

revoke execute on function public.admin_session_ok() from public, anon;
grant execute on function public.admin_session_ok() to authenticated;

-- ── Removing a device signs it out: its sessions end, and its approval.
create or replace function public.admin_device_forget(device uuid) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  delete from auth.sessions s where s.id in (select x.session_id from public.admin_sessions x where x.device_id = device);
  delete from public.admin_devices d where d.id = device;
end $$;
revoke execute on function public.admin_device_forget(uuid) from public, anon, authenticated;
grant execute on function public.admin_device_forget(uuid) to service_role;

-- ── Supabase's access token hook: a sign-in to an admin's account that the
-- site has not approved gets a token for no one ("anon"). Everyone else's
-- tokens are left as they are. Never in the way of a sign-in: on any surprise
-- the token is left as it is (layer 1 still holds).
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
  return event;
end $$;
revoke execute on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
