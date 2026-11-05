-- Gmail for the agent: when a form emails a verification code to finish applying, the member's
-- KIASA Browser reads it from their own Gmail, read-only. The member asks to connect here; the
-- browser does the Google "Allow" on their PC and reports back which address is connected. KIASA
-- keeps only that: the address and whether it is connected, never any mail.
-- Run after 20261104090000_auto_apply.sql. Running it again is safe.

create table if not exists public.apply_gmail (
  user_id uuid primary key references auth.users (id) on delete cascade,
  -- The connected address, or null when not connected. No mail is ever kept.
  email text check (char_length(email) <= 200),
  connected_at timestamptz,
  -- What the member has asked for; the browser clears these when it has done them.
  want_connect boolean not null default false,
  want_disconnect boolean not null default false,
  updated_at timestamptz not null default now()
);

create or replace function public.apply_gmail_written() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then raise exception 'This stays with its member.'; end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists apply_gmail_written on public.apply_gmail;
create trigger apply_gmail_written before insert or update on public.apply_gmail for each row execute function public.apply_gmail_written();

alter table public.apply_gmail enable row level security;
revoke all on public.apply_gmail from public, anon, authenticated;
grant select on public.apply_gmail to authenticated;
-- A member sees their own; an admin sees who has connected (the address, nothing more).
drop policy if exists "see gmail state" on public.apply_gmail;
create policy "see gmail state" on public.apply_gmail for select to authenticated
  using (user_id = (select auth.uid()) or (select public.jobs_admin()));

-- ── The member asks to connect or disconnect. The browser does the rest.
create or replace function public.apply_gmail_request(connect boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.jobs_team() then
    raise exception 'Only an approved member can do this.' using errcode = '42501';
  end if;
  insert into public.apply_gmail (user_id, want_connect, want_disconnect)
    values (auth.uid(), connect, not connect)
    on conflict (user_id) do update set want_connect = connect, want_disconnect = not connect, updated_at = now();
end $$;

-- ── What the browser needs: whether its member wants Gmail connected or disconnected, and the
-- address already connected (as a sign-in hint).
create or replace function public.browser_agent_gmail(agent_key text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  who uuid := public.browser_agent_owner(agent_key);
  state public.apply_gmail;
begin
  select * into state from public.apply_gmail g where g.user_id = who;
  return jsonb_build_object(
    'want_connect', coalesce(state.want_connect, false),
    'want_disconnect', coalesce(state.want_disconnect, false),
    'email', coalesce(state.email, ''));
end $$;

-- The browser reports the outcome: connected (with the address) or disconnected. This also clears
-- the member's request, so it is not done again.
create or replace function public.browser_agent_gmail_report(agent_key text, email text, connected boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare who uuid := public.browser_agent_owner(agent_key);
begin
  insert into public.apply_gmail (user_id, email, connected_at, want_connect, want_disconnect)
    values (who, case when connected then left(btrim(email), 200) end, case when connected then now() end, false, false)
    on conflict (user_id) do update set
      email = case when connected then left(btrim(browser_agent_gmail_report.email), 200) end,
      connected_at = case when connected then now() end,
      want_connect = false, want_disconnect = false, updated_at = now();
end $$;

revoke execute on function public.apply_gmail_request(boolean) from public, anon;
grant execute on function public.apply_gmail_request(boolean) to authenticated;
revoke execute on function public.browser_agent_gmail(text) from public;
revoke execute on function public.browser_agent_gmail_report(text, text, boolean) from public;
grant execute on function public.browser_agent_gmail(text) to anon, authenticated;
grant execute on function public.browser_agent_gmail_report(text, text, boolean) to anon, authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'apply_gmail') then
    alter publication supabase_realtime add table public.apply_gmail;
  end if;
end $$;
