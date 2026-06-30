const CLIENT_ID_KEY = "critical-mass-client-id";

export function getClientId() {
  let id = sessionStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
}

async function invokeErrorMessage(error, functionName) {
  if (error?.context && typeof error.context.json === "function") {
    try {
      const body = await error.context.json();
      if (body?.error) return body.error;
    } catch {
      // Response body was not JSON.
    }
  }

  return error?.message || `Failed to call ${functionName}`;
}

export function createMultiplayerClient(supabase) {
  async function invoke(functionName, body) {
    const { data, error } = await supabase.functions.invoke(functionName, {
      body,
    });

    if (error) {
      throw new Error(await invokeErrorMessage(error, functionName));
    }

    if (data?.error) {
      throw new Error(data.error);
    }

    return data;
  }

  return {
    createMatch(clientId) {
      return invoke("create-critical-mass-match", { clientId });
    },

    joinMatch(matchId, clientId) {
      return invoke("join-critical-mass-match", { matchId, clientId });
    },

    playMove(matchId, clientId, r, c, expectedMoveIndex) {
      return invoke("play-critical-mass-move", {
        matchId,
        clientId,
        r,
        c,
        expectedMoveIndex,
      });
    },

    leaveMatch(matchId, clientId) {
      return invoke("leave-critical-mass-match", { matchId, clientId });
    },

    restartMatch(matchId, clientId) {
      return invoke("restart-critical-mass-match", { matchId, clientId });
    },

    async fetchMatchRow(matchId) {
      const { data, error } = await supabase
        .from("critical_mass_matches")
        .select()
        .eq("id", matchId)
        .single();

      if (error) throw new Error(error.message || "Could not load match state");
      return data;
    },

    subscribeToMatch(matchId, onUpdate) {
      const channel = supabase
        .channel(`match_state_${matchId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "critical_mass_matches",
            filter: `id=eq.${matchId}`,
          },
          (payload) => {
            onUpdate(payload.new);
          }
        )
        .subscribe();

      return channel;
    },

    unsubscribe(channel) {
      if (channel) return supabase.removeChannel(channel);
      return Promise.resolve();
    },
  };
}

export function inviteUrl(matchId) {
  const url = new URL(window.location.href);
  url.searchParams.set("match", matchId);
  url.searchParams.set("role", "p2");
  return url.toString();
}
