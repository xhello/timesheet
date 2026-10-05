-- Apply in the Supabase SQL editor or with Supabase migrations before setup.
-- This migration creates storage only; the verified admin initializes the app.
begin;

create table public.schedule_workspace (
  id text primary key,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  version integer not null default 0 check (version >= 0)
);

alter table public.schedule_workspace enable row level security;

-- Scheduling authorization runs in the server API. Browser clients must never
-- read the complete payload or bypass that API with direct database writes.
revoke all privileges on table public.schedule_workspace from public, anon, authenticated;
grant select, insert, update on table public.schedule_workspace to service_role;

commit;
