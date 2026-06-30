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
  if (!match) return jsonResponse({ ok: true });

  const role = playerForClientId(match, clientId);
  if (!role) return jsonResponse({ ok: true });

  const { error: deleteError } = await supabase
    .from("critical_mass_matches")
    .delete()
    .eq("id", matchId);

  if (deleteError) return errorResponse(deleteError.message, 500);

  return jsonResponse({ ok: true, deleted: true });
});
