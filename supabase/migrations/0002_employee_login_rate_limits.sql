-- Phone-only employee sign-in is intentional. Rate limits are shared by every
-- server instance; only the trusted server can consume the counters.
begin;

create table if not exists public.schedule_employee_login_limits (
  bucket_key text primary key check (bucket_key ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null,
  attempts integer not null check (attempts >= 1 and attempts <= 31)
);
create index if not exists schedule_employee_login_limits_window_start
  on public.schedule_employee_login_limits (window_start);
alter table public.schedule_employee_login_limits enable row level security;
revoke all privileges on table public.schedule_employee_login_limits from public, anon, authenticated;
grant select, insert, update, delete on table public.schedule_employee_login_limits to service_role;

create or replace function public.consume_employee_login_rate_limits(p_ip_hash text, p_phone_hash text)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  checked_at timestamptz := clock_timestamp();
  bucket_count integer;
  bucket_start timestamptz;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' or
     p_phone_hash is null or p_phone_hash !~ '^[0-9a-f]{64}$' or p_ip_hash = p_phone_hash then
    raise exception 'Invalid rate-limit bucket';
  end if;

  -- All callers lock the IP bucket before the phone bucket. Once this IP has
  -- hit its limit, new guessed phone numbers do not create additional rows.
  insert into public.schedule_employee_login_limits as limits (bucket_key, window_start, attempts)
  values (p_ip_hash, checked_at, 1)
  on conflict (bucket_key) do update set
    window_start = case when limits.window_start <= checked_at - interval '15 minutes' then checked_at else limits.window_start end,
    attempts = case when limits.window_start <= checked_at - interval '15 minutes' then 1 else least(limits.attempts + 1, 31) end
  returning attempts, window_start into bucket_count, bucket_start;
  if bucket_count > 30 then
    return greatest(1, least(900, ceil(extract(epoch from bucket_start + interval '15 minutes' - checked_at))::integer));
  end if;

  insert into public.schedule_employee_login_limits as limits (bucket_key, window_start, attempts)
  values (p_phone_hash, checked_at, 1)
  on conflict (bucket_key) do update set
    window_start = case when limits.window_start <= checked_at - interval '15 minutes' then checked_at else limits.window_start end,
    attempts = case when limits.window_start <= checked_at - interval '15 minutes' then 1 else least(limits.attempts + 1, 11) end
  returning attempts, window_start into bucket_count, bucket_start;
  if bucket_count > 10 then
    return greatest(1, least(900, ceil(extract(epoch from bucket_start + interval '15 minutes' - checked_at))::integer));
  end if;

  -- Prune only after acquiring both login buckets. Taking unrelated cleanup
  -- locks before those buckets can deadlock with another concurrent login.
  -- Bound the work and skip rows another transaction currently holds.
  delete from public.schedule_employee_login_limits
  where bucket_key in (
    select bucket_key from public.schedule_employee_login_limits
    where window_start < checked_at - interval '1 day'
    order by window_start limit 100 for update skip locked
  );
  return 0;
end;
$$;

revoke all privileges on function public.consume_employee_login_rate_limits(text, text) from public, anon, authenticated;
grant execute on function public.consume_employee_login_rate_limits(text, text) to service_role;

commit;
