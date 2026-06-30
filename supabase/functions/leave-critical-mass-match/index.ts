import { normalizeMatchId } from "../_shared/game.ts";
import { loadMatch, roleForClient } from "../_shared/match-auth.ts";
import { handleOptions, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient } from "../_shared/supabase.ts";

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
    return jsonResponse({ ok: true });
  }
  if (loaded.error) return errorResponse(loaded.error, 500);

  const role = roleForClient(loaded.auth, clientId);
  if (!role) return jsonResponse({ ok: true });

  const { error: deleteError } = await supabase
    .from("critical_mass_matches")
    .delete()
    .eq("id", matchId);

  if (deleteError) return errorResponse(deleteError.message, 500);

  return jsonResponse({ ok: true, deleted: true });
});
