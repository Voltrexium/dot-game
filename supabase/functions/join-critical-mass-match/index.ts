import { normalizeMatchId, State } from "../_shared/game.ts";
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
  const existingRole = roleForClient(auth, clientId);
  if (existingRole) {
    return jsonResponse({
      ...matchPayload(match),
      role: existingRole,
      clientId,
      reconnected: true,
    });
  }

  if (auth.p2_client_id && auth.p2_client_id !== clientId) {
    return errorResponse("Match is full", 409);
  }

  const { data: updatedAuth, error: authUpdateError } = await supabase
    .from("critical_mass_match_auth")
    .update({ p2_client_id: clientId })
    .eq("match_id", matchId)
    .is("p2_client_id", null)
    .select()
    .maybeSingle();

  if (authUpdateError) return errorResponse(authUpdateError.message, 500);

  if (!updatedAuth) {
    const refreshed = await loadMatch(supabase, matchId);
    if (refreshed.error) return errorResponse(refreshed.error, 500);

    const role = roleForClient(refreshed.auth, clientId);
    if (!role) return errorResponse("Match is full", 409);

    return jsonResponse({
      ...matchPayload(refreshed.match),
      role,
      clientId,
      reconnected: role === State.PLAYER2,
    });
  }

  const matchUpdates: Record<string, unknown> = {
    p2_joined: true,
    updated_at: new Date().toISOString(),
  };

  if (match.status === "waiting") {
    matchUpdates.status = "active";
  }

  const { data: updatedMatch, error: matchUpdateError } = await supabase
    .from("critical_mass_matches")
    .update(matchUpdates)
    .eq("id", matchId)
    .select()
    .single();

  if (matchUpdateError) return errorResponse(matchUpdateError.message, 500);

  return jsonResponse({
    ...matchPayload(updatedMatch),
    role: State.PLAYER2,
    clientId,
    reconnected: false,
  });
});
