-- Defer match deletion until both players have seen the end screen.

alter table public.critical_mass_matches
  add column if not exists p1_end_ack boolean not null default false,
  add column if not exists p2_end_ack boolean not null default false;
