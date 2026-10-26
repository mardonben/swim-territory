-- Sharked database setup, part 1. Paste into Supabase → SQL Editor → Run,
-- then do the same with 002_territory.sql.
-- Safe to run more than once.

create table if not exists public.challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'cancelled')),
  -- The territory shape, as a GeoJSON Polygon.
  boundary jsonb not null,
  boundary_metres integer not null check (boundary_metres > 0),
  swim_metres integer not null check (swim_metres > 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- One pending challenge per swimmer at a time.
create unique index if not exists challenges_one_pending_per_swimmer
  on public.challenges (user_id) where status = 'pending';

alter table public.challenges enable row level security;

-- Swimmers can only see and change their own challenges.
drop policy if exists "Read own challenges" on public.challenges;
create policy "Read own challenges" on public.challenges
  for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists "Create own challenges" on public.challenges;
create policy "Create own challenges" on public.challenges
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "Update own challenges" on public.challenges;
create policy "Update own challenges" on public.challenges
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
