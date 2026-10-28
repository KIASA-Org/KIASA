-- A new name reaches every open page at once: whoever changes their name is
-- written here (by the database itself, when their profile's name changes),
-- and pages listen. Only people who may chat read it, and a simulated member's
-- new name only those who see the simulated members. Photos travel the same
-- way already, through public.avatars. Run once; running it again is safe.

create table if not exists public.names (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  name text not null,
  changed_at timestamptz not null default now()
);
alter table public.names enable row level security;
revoke all on public.names from anon;
revoke insert, update, delete on public.names from authenticated;

drop policy if exists "people who chat see new names" on public.names;
create policy "people who chat see new names" on public.names
  for select to authenticated using (public.can_chat() and public.visible(user_id));

create or replace function public.profile_renamed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.names (user_id, name, changed_at) values (new.id, new.name, now())
    on conflict (user_id) do update set name = excluded.name, changed_at = excluded.changed_at;
  return new;
end $$;
revoke execute on function public.profile_renamed() from public, anon, authenticated;

drop trigger if exists profile_renamed on public.profiles;
create trigger profile_renamed after update of name on public.profiles
  for each row when (old.name is distinct from new.name) execute function public.profile_renamed();

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'names') then
    alter publication supabase_realtime add table public.names;
  end if;
end $$;
