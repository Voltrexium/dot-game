import {
  applyMove,
  normalizeMatchId,
  playerForClientId,
  State,
  type Tile,
} from "../_shared/game.ts";
import { handleOptions, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient, matchPayload } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  let body: {
    matchId?: string;
    clientId?: string;
    r?: number;
    c?: number;
    expectedMoveIndex?: number;
  };

  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const matchId = normalizeMatchId(body.matchId ?? "");
  const clientId = body.clientId?.trim();
  const r = body.r;
  const c = body.c;
  const expectedMoveIndex = body.expectedMoveIndex;

  if (!matchId) return errorResponse("matchId is required");
  if (!clientId) return errorResponse("clientId is required");
  if (!Number.isInteger(r) || !Number.isInteger(c)) {
    return errorResponse("r and c must be integers");
  }

  const supabase = createServiceClient();
  const { data: match, error } = await supabase
    .from("critical_mass_matches")
    .select()
    .eq("id", matchId)
    .maybeSingle();

  if (error) return errorResponse(error.message, 500);
  if (!match) return errorResponse("Match not found", 404);
  if (match.status === "abandoned") {
    return errorResponse("This match has ended", 410);
  }
  if (match.game_over) return errorResponse("Game is already over", 409);

  const player = playerForClientId(match, clientId);
  if (!player) return errorResponse("You are not in this match", 403);
  if (match.turn !== player) return errorResponse("Not your turn", 409);

  if (
    expectedMoveIndex !== undefined &&
    expectedMoveIndex !== match.move_index
  ) {
    return errorResponse("Stale move index", 409);
  }

  const board = match.board as Tile[][];
  const result = applyMove(board, r!, c!, match.turn as typeof State.PLAYER1);

  if (!result.ok) {
    return errorResponse(result.error, 400);
  }

  const nextMoveIndex = match.move_index + 1;
  const status = result.gameOver ? "finished" : match.status;

  const { data: updated, error: updateError } = await supabase
    .from("critical_mass_matches")
    .update({
      board: result.board,
      last_move: result.lastMove,
      turn: result.turn,
      move_index: nextMoveIndex,
      game_over: result.gameOver,
      winner: result.winner,
      status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", matchId)
    .eq("move_index", match.move_index)
    .select()
    .single();

  if (updateError) {
    if (updateError.code === "PGRST116") {
      return errorResponse("Move already applied", 409);
    }
    return errorResponse(updateError.message, 500);
  }

  return jsonResponse({
    ...matchPayload(updated),
    lastMove: result.lastMove,
    appliedMoveIndex: nextMoveIndex,
  });
});
