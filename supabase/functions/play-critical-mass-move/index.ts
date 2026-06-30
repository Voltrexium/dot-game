import { applyMove, normalizeMatchId, State, type Tile } from "../_shared/game.ts";
import { loadMatch, roleForClient } from "../_shared/match-auth.ts";
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
  if (
    expectedMoveIndex !== undefined &&
    (!Number.isInteger(expectedMoveIndex) || expectedMoveIndex < 0)
  ) {
    return errorResponse("expectedMoveIndex must be a non-negative integer");
  }

  const supabase = createServiceClient();
  const loaded = await loadMatch(supabase, matchId);

  if (loaded.error === "Match not found") {
    return errorResponse("Match not found", 404);
  }
  if (loaded.error) return errorResponse(loaded.error, 500);

  const { match, auth } = loaded;

  if (match.game_over) return errorResponse("Game is already over", 409);
  if (match.status !== "active") {
    return errorResponse("Waiting for opponent to join", 409);
  }
  if (
    expectedMoveIndex !== undefined &&
    expectedMoveIndex !== match.move_index
  ) {
    return errorResponse("Stale move index", 409);
  }

  const player = roleForClient(auth, clientId);
  if (!player) return errorResponse("You are not in this match", 403);
  if (match.turn !== player) return errorResponse("Not your turn", 409);

  const board = match.board as Tile[][];
  const result = applyMove(board, r!, c!, match.turn as typeof State.PLAYER1);

  if (!result.ok) {
    return errorResponse(result.error, 400);
  }

  const nextMoveIndex = match.move_index + 1;
  const status = result.gameOver ? "finished" : match.status;

  const updatePayload: Record<string, unknown> = {
    board: result.board,
    last_move: result.lastMove,
    turn: result.turn,
    move_index: nextMoveIndex,
    game_over: result.gameOver,
    winner: result.winner,
    status,
    updated_at: new Date().toISOString(),
  };

  const { data: updated, error: updateError } = await supabase
    .from("critical_mass_matches")
    .update(updatePayload)
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
