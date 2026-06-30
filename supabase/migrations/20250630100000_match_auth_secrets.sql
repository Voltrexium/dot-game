-- Keep client IDs out of the publicly readable match row (Realtime + anon SELECT).

create table if not exists public.critical_mass_match_auth (
  match_id text primary key references public.critical_mass_matches(id) on delete cascade,
  p1_client_id text not null,
  p2_client_id text
);

alter table public.critical_mass_match_auth enable row level security;

create policy "critical_mass_match_auth_no_client_access"
  on public.critical_mass_match_auth
  for all
  to anon, authenticated
  using (false)
  with check (false);

insert into public.critical_mass_match_auth (match_id, p1_client_id, p2_client_id)
select id, p1_client_id, coalesce(p2_client_id, null)
from public.critical_mass_matches
where p1_client_id is not null
on conflict (match_id) do nothing;

alter table public.critical_mass_matches
  add column if not exists p2_joined boolean not null default false;

update public.critical_mass_matches
set p2_joined = true
where p2_client_id is not null;

alter table public.critical_mass_matches
  drop column if exists p1_client_id,
  drop column if exists p2_client_id;
