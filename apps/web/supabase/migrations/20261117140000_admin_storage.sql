-- KIASA: how much room the database and its files take, for the admins'
-- Storage page (/admin/storage). Run once, after every earlier file. Running it
-- again is safe. Only sizes and counts: no row or file is read.

create or replace function public.admin_storage_usage() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  result jsonb;
begin
  if auth.uid() is null or not public.jobs_admin() then
    raise exception 'Only an admin can see this.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'at', now(),
    'database', pg_database_size(current_database()),
    'files', (select coalesce(sum((o.metadata ->> 'size')::bigint), 0) from storage.objects o),
    'file_count', (select count(*) from storage.objects),
    -- Rows deleted or changed whose room the database has not yet taken back
    -- (it does, by itself, as it cleans up).
    'freeable', (
      select coalesce(sum(case when s.n_live_tup + s.n_dead_tup > 0
        then pg_total_relation_size(s.relid)::numeric * s.n_dead_tup / (s.n_live_tup + s.n_dead_tup) end), 0)::bigint
      from pg_stat_user_tables s),
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object('name', t.name, 'bytes', t.bytes, 'rows', t.rows_est) order by t.bytes desc)
      from (
        select n.nspname || '.' || c.relname as name, pg_total_relation_size(c.oid) as bytes, greatest(c.reltuples, 0)::bigint as rows_est
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where c.relkind in ('r', 'm', 'p') and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
        order by pg_total_relation_size(c.oid) desc
        limit 12
      ) t), '[]'::jsonb),
    'buckets', coalesce((
      select jsonb_agg(jsonb_build_object('name', b.name, 'bytes', b.bytes, 'files', b.files) order by b.bytes desc)
      from (
        select o.bucket_id as name, coalesce(sum((o.metadata ->> 'size')::bigint), 0) as bytes, count(*) as files
        from storage.objects o group by o.bucket_id
      ) b), '[]'::jsonb)
  ) into result;
  return result;
end $$;
revoke execute on function public.admin_storage_usage() from public, anon;
grant execute on function public.admin_storage_usage() to authenticated;
