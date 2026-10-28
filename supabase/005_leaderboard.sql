-- Sharked leaderboard: each swimmer's territory as it stands now. Because the
-- newest claim cuts into older areas, a swimmer's total drops as soon as
-- someone takes part of their land. Run after 004_area_details.sql. Safe to
-- run more than once.

create or replace view public.leaderboard
with (security_invoker = true) as
  select
    t.user_id,
    coalesce(p.nickname, 'Unknown swimmer') as nickname,
    coalesce(p.colour, '#7F8C8D') as colour,
    count(*)::integer as areas,
    round(sum(extensions.st_perimeter(t.geom::extensions.geography)))::integer as perimeter_metres,
    round(sum(extensions.st_area(t.geom::extensions.geography)))::bigint as area_m2
  from public.territory t
  left join public.profiles p on p.user_id = t.user_id
  group by t.user_id, p.nickname, p.colour;

revoke all on public.leaderboard from anon;
grant select on public.leaderboard to authenticated;
