import {
  createInitialBoard,
  randomMatchId,
} from "../_shared/game.ts";
import { handleOptions, errorResponse, jsonResponse } from "../_shared/cors.ts";
import { createServiceClient, matchPayload } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  const options = handleOptions(req);
  if (options) return options;

  if (req.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  let body: { clientId?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body");
  }

  const clientId = body.clientId?.trim();
  if (!clientId) {
    return errorResponse("clientId is required");
  }

  const supabase = createServiceClient();
  const board = createInitialBoard();

  for (let attempt = 0; attempt < 8; attempt++) {
    const id = randomMatchId();
    const { data, error } = await supabase
      .from("critical_mass_matches")
      .insert({
        id,
        p1_client_id: clientId,
        board,
        status: "waiting",
      })
      .select()
      .single();

    if (!error && data) {
      return jsonResponse({
        ...matchPayload(data),
        role: "PLAYER1",
        clientId,
      });
    }

    if (error?.code !== "23505") {
      return errorResponse(error?.message ?? "Failed to create match", 500);
    }
  }

  return errorResponse("Could not allocate a unique match code", 500);
});
