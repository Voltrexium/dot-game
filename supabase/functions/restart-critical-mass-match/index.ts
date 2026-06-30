import {
  createInitialBoard,
  normalizeMatchId,
  playerForClientId,
  State,
} from "../_shared/game.ts";
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
  const { data: match, error } = await supabase
    .from("critical_mass_matches")
    .select()
    .eq("id", matchId)
    .maybeSingle();

  if (error) return errorResponse(error.message, 500);
  if (!match) return errorResponse("Match not found", 404);

  const player = playerForClientId(match, clientId);
  if (!player) return errorResponse("You are not in this match", 403);
  if (match.game_over) {
    return errorResponse("Match has ended — create a new match to play again", 410);
  }

  const board = createInitialBoard();
  const bothConnected = Boolean(match.p1_client_id && match.p2_client_id);
  const status = bothConnected ? "active" : "waiting";

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
