-- Remember the swim that won each area, so anyone tapping it can see it.
-- Run after 003_profiles.sql. Safe to run more than once.

alter table public.territory add column if not exists swim_metres integer;

update public.territory t
  set swim_metres = c.swim_metres
  from public.challenges c
  where c.id = t.challenge_id and t.swim_metres is null;

-- Same as in 002_territory.sql, but also stores the swim distance.
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

  insert into public.territory (user_id, challenge_id, geom, claimed_at, swim_metres)
    values (c.user_id, c.id, shape, coalesce(c.completed_at, now()), c.swim_metres)
    on conflict (challenge_id) do nothing;
end;
$$;

revoke execute on function public.claim_territory(uuid) from public, anon, authenticated;
