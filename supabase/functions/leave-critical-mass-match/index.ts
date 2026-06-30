import { normalizeMatchId, playerForClientId } from "../_shared/game.ts";
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
  if (!match) return jsonResponse({ ok: true });

  const role = playerForClientId(match, clientId);
  if (!role) return jsonResponse({ ok: true });

  const updates: Record<string, unknown> = {
    status: "abandoned",
    updated_at: new Date().toISOString(),
  };

  if (match.p1_client_id === clientId) updates.p1_client_id = null;
  if (match.p2_client_id === clientId) updates.p2_client_id = null;

  const { data: updated, error: updateError } = await supabase
    .from("critical_mass_matches")
    .update(updates)
    .eq("id", matchId)
    .select()
    .single();

  if (updateError) return errorResponse(updateError.message, 500);

  return jsonResponse({ ok: true, match: matchPayload(updated) });
});
