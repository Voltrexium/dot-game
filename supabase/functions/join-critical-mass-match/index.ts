import {
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

  const existingRole = playerForClientId(match, clientId);
  if (existingRole) {
    return jsonResponse({
      ...matchPayload(match),
      role: existingRole,
      clientId,
      reconnected: true,
    });
  }

  if (match.p2_client_id && match.p2_client_id !== clientId) {
    return errorResponse("Match is full", 409);
  }

  if (match.p1_client_id === clientId) {
    return jsonResponse({
      ...matchPayload(match),
      role: State.PLAYER1,
      clientId,
      reconnected: true,
    });
  }

  const updates: Record<string, unknown> = {
    p2_client_id: clientId,
    updated_at: new Date().toISOString(),
  };

  if (match.status === "waiting") {
    updates.status = "active";
  }

  const { data: updated, error: updateError } = await supabase
    .from("critical_mass_matches")
    .update(updates)
    .eq("id", matchId)
    .is("p2_client_id", null)
    .select()
    .maybeSingle();

  if (updateError) return errorResponse(updateError.message, 500);

  if (!updated) {
    const { data: refreshed } = await supabase
      .from("critical_mass_matches")
      .select()
      .eq("id", matchId)
      .single();

    const role = playerForClientId(refreshed!, clientId);
    if (!role) return errorResponse("Match is full", 409);

    return jsonResponse({
      ...matchPayload(refreshed!),
      role,
      clientId,
      reconnected: role === State.PLAYER2,
    });
  }

  return jsonResponse({
    ...matchPayload(updated),
    role: State.PLAYER2,
    clientId,
    reconnected: false,
  });
});
