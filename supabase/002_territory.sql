-- Sharked territory: who holds which piece of the map.
-- The newest claim always wins: claiming an area cuts that shape out of every
-- older area it overlaps, whoever held it. Run after 001_challenges.sql.
-- Safe to run more than once.

create extension if not exists postgis with schema extensions;

create table if not exists public.territory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  challenge_id uuid not null unique references public.challenges (id) on delete cascade,
  geom extensions.geometry(MultiPolygon, 4326) not null,
  -- The same shape as GeoJSON, which is what the app reads.
  boundary jsonb generated always as (extensions.st_asgeojson(geom)::jsonb) stored,
  claimed_at timestamptz not null default now()
);

create index if not exists territory_geom_idx on public.territory using gist (geom);

alter table public.territory enable row level security;

-- Everyone can see the map. Nobody writes to it directly: only claim_territory does.
drop policy if exists "Everyone can see territory" on public.territory;
create policy "Everyone can see territory" on public.territory
  for select to authenticated using (true);

create or replace function public.claim_territory(p_challenge_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.challenges;
  shape extensions.geometry;
begin
  select * into c from public.challenges where id = p_challenge_id and status = 'completed';
  if not found then
    raise exception 'Challenge % is not completed', p_challenge_id;
  end if;

  shape := extensions.st_multi(extensions.st_collectionextract(extensions.st_makevalid(
    extensions.st_setsrid(extensions.st_geomfromgeojson(c.boundary::text), 4326)), 3));

  -- Cut the new shape out of every older area it overlaps.
  update public.territory t
    set geom = extensions.st_multi(extensions.st_collectionextract(
      extensions.st_difference(t.geom, shape), 3))
    where extensions.st_intersects(t.geom, shape);

  -- Drop areas that were taken completely (or down to a sliver).
  delete from public.territory t
    where extensions.st_isempty(t.geom)
       or extensions.st_area(t.geom::extensions.geography) < 1;

  insert into public.territory (user_id, challenge_id, geom, claimed_at)
    values (c.user_id, c.id, shape, coalesce(c.completed_at, now()))
    on conflict (challenge_id) do nothing;
end;
$$;

-- The pretend swim used for testing. Once Strava is connected, a verified
-- swim will complete challenges on the server instead.
create or replace function public.complete_challenge_test(p_challenge_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.challenges
    set status = 'completed', completed_at = now()
    where id = p_challenge_id
      and user_id = (select auth.uid())
      and status = 'pending';
  if not found then
    raise exception 'No pending challenge to complete';
  end if;
  perform public.claim_territory(p_challenge_id);
end;
$$;

revoke execute on function public.claim_territory(uuid) from public, anon, authenticated;
revoke execute on function public.complete_challenge_test(uuid) from public, anon;
grant execute on function public.complete_challenge_test(uuid) to authenticated;

-- Swimmers can now only cancel their pending challenge directly; completing
-- goes through the function above so territory always follows.
drop policy if exists "Update own challenges" on public.challenges;
create policy "Update own challenges" on public.challenges
  for update to authenticated
  using (user_id = (select auth.uid()) and status = 'pending')
  with check (user_id = (select auth.uid()) and status = 'cancelled');

-- Claim territory for challenges completed before this existed, oldest first.
do $$
declare
  r record;
begin
  for r in
    select c.id from public.challenges c
    where c.status = 'completed'
      and not exists (select 1 from public.territory t where t.challenge_id = c.id)
    order by c.completed_at
  loop
    perform public.claim_territory(r.id);
  end loop;
end;
$$;
