import {
  createInitialBoard,
  normalizeMatchId,
  State,
} from "../_shared/game.ts";
import { loadMatch, roleForClient } from "../_shared/match-auth.ts";
import { handleOptions, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient, matchPayload } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  let body: { matchId?: string; clientId?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const matchId = normalizeMatchId(body.matchId ?? "");
  const clientId = body.clientId?.trim();

  if (!matchId) return errorResponse("matchId is required");
  if (!clientId) return errorResponse("clientId is required");

  const supabase = createServiceClient();
  const loaded = await loadMatch(supabase, matchId);

  if (loaded.error === "Match not found") {
    return errorResponse("Match not found", 404);
  }
  if (loaded.error) return errorResponse(loaded.error, 500);

  const { match, auth } = loaded;

  const player = roleForClient(auth, clientId);
  if (!player) return errorResponse("You are not in this match", 403);
  if (!match.game_over) {
    return errorResponse("Cannot restart — the game is still in progress", 409);
  }

  const board = createInitialBoard();
  const status = match.p2_joined ? "active" : "waiting";

  const { data: updated, error: updateError } = await supabase
    .from("critical_mass_matches")
    .update({
      board,
      last_move: null,
      turn: State.PLAYER1,
      move_index: 0,
      game_over: false,
      winner: null,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", matchId)
    .select()
    .single();

  if (updateError) return errorResponse(updateError.message, 500);

  return jsonResponse({
    ...matchPayload(updated),
    restartedBy: player,
  });
});
