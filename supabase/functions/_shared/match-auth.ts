import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { playerForClientId, type PlayerState } from "./game.ts";
import { expireMatchIfNeeded } from "./match-expiry.ts";

export type MatchAuthRow = {
  match_id: string;
  p1_client_id: string;
  p2_client_id: string | null;
};

export type MatchRow = {
  id: string;
  turn: string;
  game_over: boolean;
  winner: string | null;
  move_index: number;
  board: unknown;
  last_move: { r: number; c: number } | null;
  status: string;
  p2_joined: boolean;
  p1_end_ack: boolean;
  p2_end_ack: boolean;
  created_at: string;
};

export async function loadMatch(
  supabase: SupabaseClient,
  matchId: string
): Promise<
  | { match: MatchRow; auth: MatchAuthRow; error: null }
  | { match: null; auth: null; error: string }
> {
  const { data: match, error: matchError } = await supabase
    .from("critical_mass_matches")
    .select()
    .eq("id", matchId)
    .maybeSingle();

  if (matchError) return { match: null, auth: null, error: matchError.message };
  if (!match) return { match: null, auth: null, error: "Match not found" };

  if (await expireMatchIfNeeded(supabase, match)) {
    return { match: null, auth: null, error: "Match not found" };
  }

  const { data: auth, error: authError } = await supabase
    .from("critical_mass_match_auth")
    .select()
    .eq("match_id", matchId)
    .maybeSingle();

  if (authError) return { match: null, auth: null, error: authError.message };
  if (!auth) return { match: null, auth: null, error: "Match auth not found" };

  return { match: match as MatchRow, auth: auth as MatchAuthRow, error: null };
}

export function roleForClient(
  auth: MatchAuthRow,
  clientId: string
): PlayerState | null {
  return playerForClientId(auth, clientId);
}
