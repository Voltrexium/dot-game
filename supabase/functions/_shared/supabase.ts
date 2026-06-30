import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function createServiceClient() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !key) {
    throw new Error("Missing Supabase service credentials");
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

import type { MatchRow } from "./match-auth.ts";

export function matchPayload(match: MatchRow) {
  return {
    matchId: match.id,
    board: match.board,
    turn: match.turn,
    moveIndex: match.move_index,
    gameOver: match.game_over,
    winner: match.winner,
    status: match.status,
    lastMove: match.last_move,
    p1Connected: true,
    p2Connected: Boolean(match.p2_joined),
  };
}
