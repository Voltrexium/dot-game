-- Critical Mass online matches (server-authoritative state)

create table if not exists public.critical_mass_matches (
  id text primary key,
  p1_client_id text,
  p2_client_id text,
  turn text not null default 'PLAYER1',
  game_over boolean not null default false,
  winner text,
  move_index integer not null default 0,
  board jsonb not null,
  last_move jsonb,
  status text not null default 'waiting',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint critical_mass_matches_turn_check
    check (turn in ('PLAYER1', 'PLAYER2')),
  constraint critical_mass_matches_status_check
    check (status in ('waiting', 'active', 'abandoned', 'finished'))
);

create index if not exists critical_mass_matches_status_idx
  on public.critical_mass_matches (status);

alter table public.critical_mass_matches enable row level security;

create policy "critical_mass_matches_select"
  on public.critical_mass_matches
  for select
  to anon, authenticated
  using (true);

create policy "critical_mass_matches_no_client_writes"
  on public.critical_mass_matches
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter publication supabase_realtime add table public.critical_mass_matches;
