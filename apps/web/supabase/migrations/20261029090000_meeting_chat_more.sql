-- A meeting's chat, as KIASA Chat: a reply to a message, emoji reactions (one
-- each per message, the same again takes it back), and deleting one's own
-- message (an admin, anyone's). Only those in the meeting do any of it. Run
-- once, after the meeting chat file. Running it again is safe.

alter table public.meeting_messages add column if not exists reply_to uuid references public.meeting_messages (id) on delete set null;
alter table public.meeting_messages add column if not exists reactions jsonb not null default '{}'::jsonb;
alter table public.meeting_messages add column if not exists deleted_at timestamptz;
-- A deleted message keeps no words: only one still there must have some.
alter table public.meeting_messages drop constraint if exists meeting_messages_body_check;
alter table public.meeting_messages add constraint meeting_messages_body_check check (deleted_at is not null or char_length(btrim(body)) between 1 and 2000);

-- A reply may point only at a message of the same meeting.
create or replace function public.meeting_message_written() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.sender_id := auth.uid();
  new.name := coalesce(public.chat_name_of(auth.uid()), 'Someone');
  new.body := btrim(new.body);
  new.created_at := now();
  new.reactions := '{}'::jsonb;
  new.deleted_at := null;
  if new.reply_to is not null and not exists (select 1 from public.meeting_messages m where m.id = new.reply_to and m.meeting_id = new.meeting_id) then
    new.reply_to := null;
  end if;
  return new;
end $$;

grant insert (meeting_id, body, reply_to) on public.meeting_messages to authenticated;

-- Reacting: one reaction each per message, from a short list; the same again takes it back.
create or replace function public.react_meeting_message(message uuid, emoji text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  me text := auth.uid()::text;
  target record;
  had boolean;
  kept jsonb;
begin
  select m.id, m.meeting_id, m.deleted_at, m.reactions into target from public.meeting_messages m where m.id = message for update;
  if me is null or target.id is null or target.deleted_at is not null or not public.in_meeting(target.meeting_id) then
    raise exception 'You cannot react to that message.';
  end if;
  if not (emoji = any (array['👍', '❤️', '😂', '😮', '👏', '🎉', '🙏', '🔥'])) then raise exception 'That reaction is not available.'; end if;
  had := coalesce((target.reactions -> emoji) ? me, false);
  select coalesce(jsonb_object_agg(entry.key, entry.people), '{}'::jsonb) into kept
    from (select key, (select jsonb_agg(person) from jsonb_array_elements(value) person where person <> to_jsonb(me)) as people
          from jsonb_each(coalesce(target.reactions, '{}'::jsonb))) entry
    where entry.people is not null;
  if not had then kept := jsonb_set(kept, array[emoji], coalesce(kept -> emoji, '[]'::jsonb) || to_jsonb(me)); end if;
  update public.meeting_messages set reactions = kept where id = message;
end $$;

-- Deleting: one's own message, or for an admin anyone's; it stays only as "deleted".
create or replace function public.delete_meeting_message(message uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  target record;
begin
  select m.id, m.meeting_id, m.sender_id into target from public.meeting_messages m where m.id = message;
  if auth.uid() is null or target.id is null or not public.in_meeting(target.meeting_id)
    or (target.sender_id <> auth.uid() and not public.is_admin()) then
    raise exception 'You can delete only your own messages.';
  end if;
  update public.meeting_messages set deleted_at = now(), body = '', reactions = '{}'::jsonb where id = message and deleted_at is null;
end $$;

do $$
declare fn text;
begin
  foreach fn in array array['react_meeting_message(uuid, text)', 'delete_meeting_message(uuid)'] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
    execute format('grant execute on function public.%s to authenticated', fn);
  end loop;
end $$;
