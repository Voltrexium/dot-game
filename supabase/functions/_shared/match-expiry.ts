import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const MATCH_TTL_MS = 24 * 60 * 60 * 1000;

export function isMatchExpired(createdAt: string): boolean {
  const createdMs = new Date(createdAt).getTime();
  if (Number.isNaN(createdMs)) return false;
  return Date.now() - createdMs >= MATCH_TTL_MS;
}

export async function deleteMatchById(
  supabase: SupabaseClient,
  matchId: string
) {
  return supabase.from("critical_mass_matches").delete().eq("id", matchId);
}

export async function expireMatchIfNeeded(
  supabase: SupabaseClient,
  match: { id: string; created_at: string }
): Promise<boolean> {
  if (!isMatchExpired(match.created_at)) return false;
  await deleteMatchById(supabase, match.id);
  return true;
}

export async function cleanupExpiredMatches(supabase: SupabaseClient) {
  const cutoff = new Date(Date.now() - MATCH_TTL_MS).toISOString();
  await supabase.from("critical_mass_matches").delete().lt("created_at", cutoff);
}
