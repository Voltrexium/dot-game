import { normalizeMatchId } from "../_shared/game.ts";
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

  const role = roleForClient(loaded.auth, clientId);
  if (!role) return errorResponse("You are not in this match", 403);

  return jsonResponse(matchPayload(loaded.match));
});
