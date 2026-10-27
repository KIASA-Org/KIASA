-- Top managers: people an admin names on the admin page ("Role"). Each wears
-- KIASA's leaf on their photo wherever it appears, and Jobs' Live view leaves
-- them out, as they do not apply for jobs. Run once, after the chat and photo
-- files. Running it again is safe.

create table if not exists public.top_managers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by text
);
alter table public.top_managers enable row level security;
revoke all on public.top_managers from anon;

-- Everyone who may chat sees who the top managers are, as they see photos.
-- Only the site's server names or removes one, after checking it is an admin.
drop policy if exists "people who chat see top managers" on public.top_managers;
create policy "people who chat see top managers" on public.top_managers
  for select to authenticated using (public.can_chat());

-- A badge given or taken away reaches every open page the moment it happens.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'top_managers') then
    alter publication supabase_realtime add table public.top_managers;
  end if;
end $$;
