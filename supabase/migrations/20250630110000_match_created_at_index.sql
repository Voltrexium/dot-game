-- Index for purging matches older than 24 hours.

create index if not exists critical_mass_matches_created_at_idx
  on public.critical_mass_matches (created_at);
