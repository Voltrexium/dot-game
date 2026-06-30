import { normalizeMatchId, playerForClientId } from "../_shared/game.ts";
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
  const { data: match, error } = await supabase
    .from("critical_mass_matches")
    .select()
    .eq("id", matchId)
    .maybeSingle();

  if (error) return errorResponse(error.message, 500);
  if (!match) return jsonResponse({ ok: true, deleted: true });

  const role = playerForClientId(match, clientId);
  if (!role) return errorResponse("You are not in this match", 403);
  if (!match.game_over) {
    return errorResponse("Match is not finished yet", 409);
  }

  const nextP1Ack = match.p1_client_id === clientId
    ? true
    : Boolean(match.p1_end_ack);
  const nextP2Ack = match.p2_client_id === clientId
    ? true
    : Boolean(match.p2_end_ack);

  const bothAcked = nextP1Ack && (!match.p2_client_id || nextP2Ack);

  if (bothAcked) {
    const { error: deleteError } = await supabase
      .from("critical_mass_matches")
      .delete()
      .eq("id", matchId);

    if (deleteError) return errorResponse(deleteError.message, 500);
    return jsonResponse({ ok: true, deleted: true });
  }

  const { error: updateError } = await supabase
    .from("critical_mass_matches")
    .update({
      p1_end_ack: nextP1Ack,
      p2_end_ack: nextP2Ack,
      updated_at: new Date().toISOString(),
    })
    .eq("id", matchId);

  if (updateError) return errorResponse(updateError.message, 500);

  return jsonResponse({ ok: true, deleted: false });
});
