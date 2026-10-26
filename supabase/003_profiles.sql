-- Sharked swimmer profiles: a nickname and a map colour. No real names,
-- emails or anything personal. Run after 002_territory.sql. Safe to run more
-- than once.

create table if not exists public.profiles (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  nickname text not null
    check (char_length(nickname) between 2 and 20 and nickname ~ '^[A-Za-z0-9 _-]+$'),
  colour text not null check (colour ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now()
);

-- Nicknames are unique, ignoring capitals: "Jaws" and "jaws" can't both exist.
create unique index if not exists profiles_nickname_unique on public.profiles (lower(nickname));

alter table public.profiles enable row level security;

-- Everyone can see nicknames and colours, so they can be shown on the map.
drop policy if exists "Everyone can see nicknames" on public.profiles;
create policy "Everyone can see nicknames" on public.profiles
  for select to authenticated using (true);

drop policy if exists "Create own profile" on public.profiles;
create policy "Create own profile" on public.profiles
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "Update own profile" on public.profiles;
create policy "Update own profile" on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
