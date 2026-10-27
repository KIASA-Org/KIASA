-- KIASA accounts. Run this once in Supabase: SQL Editor → New query → paste → Run.
-- Running it again is safe.
--
-- Signing in (email and password) is Supabase Auth: every person here is also a
-- user in auth.users. These tables hold what the site adds: who asked for an
-- account and what KIASA decided, and who KIASA's admins are.

-- Everyone who has asked for an account.
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  name text not null,
  organization text,
  reason text not null,
  digest boolean not null default false,
  status text not null default 'waiting' check (status in ('waiting', 'approved', 'declined')),
  asked_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by text,
  last_sign_in_at timestamptz
);
create index if not exists profiles_asked_at on public.profiles (asked_at desc);

-- KIASA's admins, by email. Each signs in with a password set in Supabase
-- (Authentication → Users → Add user), never on the site.
create table if not exists public.admins (
  email text primary key,
  name text not null
);
insert into public.admins (email, name) values ('chrislim@kiasa.tech', 'Chris Lim') on conflict (email) do nothing;

-- No browser reads or writes these tables except as allowed here. Every write
-- goes through the site's server, which checks who is asking first.
alter table public.profiles enable row level security;
alter table public.admins enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated using (auth.uid() = id);

-- Admins read every request: the admin page listens for new ones with this.
drop policy if exists "admins read profiles" on public.profiles;
create policy "admins read profiles" on public.profiles
  for select to authenticated using (exists (select 1 from public.admins where admins.email = auth.jwt() ->> 'email'));

drop policy if exists "admins read themselves" on public.admins;
create policy "admins read themselves" on public.admins
  for select to authenticated using (email = auth.jwt() ->> 'email');

-- New requests and decisions reach the admin page the moment they happen.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles') then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;

-- Where to send a person's alerts: one row per browser in which they asked for
-- them ("Alert me on this computer"). Only the site's server reads or writes it.
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
