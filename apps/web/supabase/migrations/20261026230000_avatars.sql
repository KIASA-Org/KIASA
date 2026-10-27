-- Profile photos: each person sets their own, from their picture at the top of
-- the chat, account or admin page, and it shows wherever they appear, changing
-- live. Run once, after the chat files. Running it again is safe.

create table if not exists public.avatars (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- In the public "avatars" folder: "<user id>/<random id>.<webp|jpg|png>". A
  -- new photo gets a new name, so a browser may keep each one for good.
  path text not null check (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg|png)$')
);
alter table public.avatars enable row level security;
revoke all on public.avatars from anon;

-- Everyone who may chat sees everyone's photo, as they see their names.
drop policy if exists "people who chat see photos" on public.avatars;
create policy "people who chat see photos" on public.avatars
  for select to authenticated using (public.can_chat());
-- Each person sets, changes and removes only their own, from their own folder.
drop policy if exists "people set their own photo" on public.avatars;
create policy "people set their own photo" on public.avatars
  for insert to authenticated
  with check (user_id = auth.uid() and public.can_chat() and split_part(path, '/', 1) = auth.uid()::text);
drop policy if exists "people change their own photo" on public.avatars;
create policy "people change their own photo" on public.avatars
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.can_chat() and split_part(path, '/', 1) = auth.uid()::text);
drop policy if exists "people remove their own photo" on public.avatars;
create policy "people remove their own photo" on public.avatars
  for delete to authenticated using (user_id = auth.uid());

-- A new photo reaches everyone's open chat the moment it is set.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'avatars') then
    alter publication supabase_realtime add table public.avatars;
  end if;
end $$;

-- The photos themselves: small squares made in the browser, readable by their
-- address (public, so they load at once and are kept), written only by their owner.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = true, file_size_limit = 1048576, allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png'];

drop policy if exists "people add their own photo file" on storage.objects;
create policy "people add their own photo file" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and public.can_chat() and (storage.foldername(name))[1] = auth.uid()::text);
-- Removing a file needs it to be found first.
drop policy if exists "people find their own photo files" on storage.objects;
create policy "people find their own photo files" on storage.objects
  for select to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "people remove their own photo files" on storage.objects;
create policy "people remove their own photo files" on storage.objects
  for delete to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
