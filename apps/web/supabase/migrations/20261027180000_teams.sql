-- KIASA's teams: the admin makes each team (its name and colour, which make its
-- shield badge), gives it to a top manager to lead, and puts each approved
-- member in one. Everyone in a team wears its shield on their photo; its
-- manager wears it with a gold rim. Only the site's server writes these, after
-- checking an admin. Run once, after the top managers file. Running it again is safe.

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 40),
  color text not null check (color ~ '^#[0-9a-f]{6}$'),
  created_at timestamptz not null default now()
);

-- Each person is in one team at most; a top manager in their team leads it.
create table if not exists public.team_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by text
);
create index if not exists team_members_team on public.team_members (team_id);

alter table public.teams enable row level security;
alter table public.team_members enable row level security;
revoke all on public.teams, public.team_members from anon;
revoke insert, update, delete on public.teams, public.team_members from authenticated;

-- Everyone who may chat sees the teams and who is in which: the badges show everywhere.
drop policy if exists "people who chat see teams" on public.teams;
create policy "people who chat see teams" on public.teams
  for select to authenticated using (public.can_chat());
drop policy if exists "people who chat see who is in which team" on public.team_members;
create policy "people who chat see who is in which team" on public.team_members
  for select to authenticated using (public.can_chat());

-- A person's team, asked without tripping the rules (for the chat's own rules to come).
create or replace function public.team_of(person uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select team_id from public.team_members where user_id = person;
$$;
revoke execute on function public.team_of(uuid) from public, anon;
grant execute on function public.team_of(uuid) to authenticated;

-- A team made, renamed or recoloured, and anyone moved, reach every open page at once.
do $$
declare t text;
begin
  foreach t in array array['teams', 'team_members'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
