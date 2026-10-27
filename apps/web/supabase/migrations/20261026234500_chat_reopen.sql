-- KIASA Chat: a one-to-one chat deleted from one's list comes back into it as
-- soon as one opens it again (from search, New message, Contacts or a person's
-- info), as in Telegram; what was cleared stays cleared. Before this, it stayed
-- out of the list until the next message. Run once, after chat_more.sql.
-- Running it again is safe.

-- A one-to-one chat with someone who may chat: the one there is (back in one's
-- list, if it was deleted from it), or a new one.
create or replace function public.open_direct(other uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  my_name text := public.chat_name_of(auth.uid());
  their_name text := public.chat_name_of(other);
  found uuid;
begin
  if me is null or my_name is null or their_name is null or other = me then
    raise exception 'You cannot message that person.';
  end if;
  -- Two people opening the same chat at once still get one chat.
  perform pg_advisory_xact_lock(hashtext(least(me::text, other::text) || greatest(me::text, other::text)));
  select c.id into found from public.chats c
    join public.chat_members a on a.chat_id = c.id and a.user_id = me
    join public.chat_members b on b.chat_id = c.id and b.user_id = other
    where c.kind = 'direct' limit 1;
  if found is not null then
    update public.chat_settings set hidden_at = null where chat_id = found and user_id = me and hidden_at is not null;
    return found;
  end if;
  insert into public.chats (kind, created_by) values ('direct', me) returning id into found;
  insert into public.chat_members (chat_id, user_id, name) values (found, me, my_name), (found, other, their_name);
  return found;
end $$;
revoke execute on function public.open_direct(uuid) from public, anon;
grant execute on function public.open_direct(uuid) to authenticated;
