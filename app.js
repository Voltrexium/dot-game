import {
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_ENABLED,
} from "./config.js";
import {
  State,
  BOARD_SIZE,
  createInitialBoard,
  cloneBoard,
  getCriticalMass,
} from "./js/game-logic.js";
import {
  getClientId,
  createMultiplayerClient,
  inviteUrl,
} from "./js/multiplayer.js";

const BASE_BOARD_SIZE = 520;
const MIN_BOARD_SIZE = 280;
const ORB_DURATION = 220;
const ORB_STAGGER = 40;
const EMERGE_FRACTION = 0.22;
const ERROR_REVERT_MS = 2200;

const DIRECTIONS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const boardWrap = document.querySelector(".board-wrap");
const statusEl = document.getElementById("status");
const statusTextEl = statusEl.querySelector(".turn-indicator__text");
const restartBtn = document.getElementById("restart");
const playLocalBtn = document.getElementById("play-local");
const lobbySection = document.getElementById("lobby");
const onlineDisabledEl = document.getElementById("online-disabled");
const createMatchBtn = document.getElementById("create-match");
const joinMatchBtn = document.getElementById("join-match");
const matchCodeInput = document.getElementById("match-code");
const matchInfoEl = document.getElementById("match-info");
const copyInviteBtn = document.getElementById("copy-invite");
const leaveMatchBtn = document.getElementById("leave-match");
const leaveConfirmDialog = document.getElementById("leave-confirm");
const leaveCancelBtn = document.getElementById("leave-cancel");
const leaveConfirmBtn = document.getElementById("leave-confirm-btn");
const legendP1El = document.getElementById("legend-p1");
const legendP2El = document.getElementById("legend-p2");
const INPUT_VERB = window.matchMedia("(pointer: coarse)").matches
  ? "tap"
  : "click";

const clientId = getClientId();
let mp = null;

if (SUPABASE_ENABLED) {
  const { createClient } = await import(
    "https://esm.sh/@supabase/supabase-js@2"
  );
  mp = createMultiplayerClient(
    createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  );
} else {
  lobbySection.hidden = true;
  onlineDisabledEl.hidden = false;
}

let onlineMode = false;
let localPlayer = null;
let matchId = null;
let matchChannel = null;
let multiplayerConnected = false;
let matchPaused = false;
let matchActive = false;
let moveIndex = 0;
let lastAppliedMoveIndex = 0;
let errorRevertTimer = null;
let applyServerQueue = Promise.resolve();

let boardPixelSize = BASE_BOARD_SIZE;
let labelOffset = 36;
let cellSize = (boardPixelSize - labelOffset) / BOARD_SIZE;

const COLORS = {
  bg: "#0f3460",
  grid: "#1a4a7a",
  empty: "#2a3f5f",
  p1: "#4ecdc4",
  p1Dark: "#2a9d96",
  p2: "#ff6b6b",
  p2Dark: "#c94444",
  text: "#ffffff",
  label: "#8899aa",
};

let board;
let turn;
let gameOver;
let animating = false;
let animGeneration = 0;
let overlay = null;
/** Stops sibling explosions during an animated chain without settling the UI. */
let chainGameOver = false;
/** Win detected mid-chain; applied when the move animation finishes. */
let pendingWin = null;
let animationWaiters = [];
/** While set, realtime echoes of this move are deferred until the HTTP response. */
let pendingOwnMove = null;
/** Latest match row held while our move HTTP request is in flight. */
let deferredMatchRow = null;

function normalizeMatchId(code) {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function playerName(player) {
  if (!onlineMode) return player === State.PLAYER1 ? "Player 1" : "Player 2";
  if (player === localPlayer) return "You";
  return "Opponent";
}

function updateMatchUrl() {
  const url = new URL(window.location.href);
  if (onlineMode && matchId) {
    url.searchParams.set("match", matchId);
    url.searchParams.set("role", localPlayer === State.PLAYER1 ? "p1" : "p2");
  } else {
    url.searchParams.delete("match");
    url.searchParams.delete("role");
  }
  window.history.replaceState({}, "", url);
}

function updateLegendLabels() {
  legendP1El.textContent = onlineMode
    ? localPlayer === State.PLAYER1
      ? "You"
      : "Opponent"
    : "Player 1";
  legendP2El.textContent = onlineMode
    ? localPlayer === State.PLAYER2
      ? "You"
      : "Opponent"
    : "Player 2";
}

function setMatchInfo(message, { connected = false, disconnected = false } = {}) {
  matchInfoEl.hidden = !message;
  matchInfoEl.classList.toggle("connected", connected);
  matchInfoEl.classList.toggle("disconnected", disconnected);
  matchInfoEl.textContent = message;
}

function setMatchInfoWithCode(code, suffix, options = {}) {
  matchInfoEl.hidden = false;
  matchInfoEl.classList.toggle("connected", options.connected ?? false);
  matchInfoEl.classList.toggle("disconnected", options.disconnected ?? false);
  matchInfoEl.replaceChildren();
  matchInfoEl.append("Match ");
  const strong = document.createElement("strong");
  strong.textContent = code;
  matchInfoEl.append(strong);
  if (suffix) matchInfoEl.append(suffix);
}

function setLobbyControls(inMatch) {
  createMatchBtn.hidden = inMatch;
  joinMatchBtn.hidden = inMatch;
  matchCodeInput.hidden = inMatch;
  leaveMatchBtn.hidden = !inMatch;
  copyInviteBtn.hidden = !inMatch || localPlayer !== State.PLAYER1;
}

function updateRestartButtonVisibility() {
  const show = gameOver && !matchPaused;
  restartBtn.hidden = !show;
  restartBtn.textContent = onlineMode ? "Play again" : "New game";
}

function normalizeServerRow(row) {
  return {
    id: row.id ?? row.matchId,
    board: row.board,
    turn: row.turn,
    move_index: row.move_index ?? row.moveIndex ?? 0,
    game_over: Boolean(row.game_over ?? row.gameOver),
    winner: row.winner ?? null,
    last_move: row.last_move ?? row.lastMove ?? null,
    status: row.status,
  };
}

function initializeBoard() {
  board = createInitialBoard();
  turn = State.PLAYER1;
  gameOver = false;
  chainGameOver = false;
  pendingWin = null;
  overlay = null;
  moveIndex = 0;
  lastAppliedMoveIndex = 0;
  pendingOwnMove = null;
  deferredMatchRow = null;
  matchActive = false;
}

function hydrateBoardFromServer(serverBoard) {
  board = cloneBoard(serverBoard);
}

function cancelAnimations() {
  animGeneration++;
  animating = false;
  chainGameOver = false;
  pendingWin = null;
  overlay = null;
  pendingOwnMove = null;
  deferredMatchRow = null;
  notifyAnimationEnd();
}

function waitForAnimationEnd() {
  if (!animating) return Promise.resolve();
  return new Promise((resolve) => animationWaiters.push(resolve));
}

function notifyAnimationEnd() {
  const waiters = animationWaiters;
  animationWaiters = [];
  for (const resolve of waiters) resolve();
}

function syncFromServerRow(row, { refreshStatus = true } = {}) {
  hydrateBoardFromServer(row.board);
  turn = row.turn;
  moveIndex = row.move_index;
  lastAppliedMoveIndex = row.move_index;
  gameOver = row.game_over;

  if (gameOver) {
    showWinFromServer(row.winner);
  } else if (refreshStatus && !matchPaused) {
    updateTurnStatus();
  }

  updateRestartButtonVisibility();
  drawBoard();
}

function moverForRow(row) {
  if (row.move_index <= 0) return null;
  return row.turn === State.PLAYER1 ? State.PLAYER2 : State.PLAYER1;
}

function winStatusFor(winner) {
  if (winner === State.PLAYER2) {
    const text = onlineMode
      ? localPlayer === State.PLAYER2
        ? "You win!"
        : "Opponent wins!"
      : "GAME OVER! Player 2 wins!";
    return { text, kind: "win-p2" };
  }

  const text = onlineMode
    ? localPlayer === State.PLAYER1
      ? "You win!"
      : "Opponent wins!"
    : "GAME OVER! Player 1 wins!";
  return { text, kind: "win-p1" };
}

function applyPendingWin() {
  if (!pendingWin) return;

  const { text, kind } = winStatusFor(pendingWin);
  setStatus(text, kind);
  gameOver = true;
  pendingWin = null;
  chainGameOver = false;
  updateRestartButtonVisibility();
}

function checkWinCondition() {
  if (gameOver || chainGameOver) return true;

  let p1HasTiles = false;
  let p2HasTiles = false;

  for (let i = 0; i < BOARD_SIZE; i++) {
    for (let j = 0; j < BOARD_SIZE; j++) {
      if (board[i][j].state === State.PLAYER1) p1HasTiles = true;
      if (board[i][j].state === State.PLAYER2) p2HasTiles = true;
    }
  }

  if (!p1HasTiles) {
    if (animating) {
      chainGameOver = true;
      pendingWin = State.PLAYER2;
      return true;
    }
    const { text, kind } = winStatusFor(State.PLAYER2);
    setStatus(text, kind);
    gameOver = true;
    updateRestartButtonVisibility();
    return true;
  }

  if (!p2HasTiles) {
    if (animating) {
      chainGameOver = true;
      pendingWin = State.PLAYER1;
      return true;
    }
    const { text, kind } = winStatusFor(State.PLAYER1);
    setStatus(text, kind);
    gameOver = true;
    updateRestartButtonVisibility();
    return true;
  }

  return false;
}

function applyServerMatchRow(row, { animate = false } = {}) {
  applyServerQueue = applyServerQueue.then(() =>
    _applyServerMatchRow(row, { animate })
  );
  return applyServerQueue;
}

async function _applyServerMatchRow(row, { animate = false } = {}) {
  row = normalizeServerRow(row);

  if (row.status) {
    matchActive = row.status === "active" || row.status === "finished";
  }

  const nextMoveIndex = row.move_index;

  if (nextMoveIndex === 0 && lastAppliedMoveIndex > 0) {
    cancelAnimations();
    syncFromServerRow(row);
    return;
  }

  if (nextMoveIndex < lastAppliedMoveIndex) {
    return;
  }

  if (nextMoveIndex <= lastAppliedMoveIndex) {
    if (animating) await waitForAnimationEnd();
    hydrateBoardFromServer(row.board);
    turn = row.turn;
    moveIndex = nextMoveIndex;
    if (row.game_over) {
      gameOver = true;
      showWinFromServer(row.winner);
    } else if (!matchPaused) {
      updateTurnStatus();
    }
    updateRestartButtonVisibility();
    drawBoard();
    return;
  }

  const lastMove = row.last_move;
  const mover = moverForRow(row);
  const shouldAnimate =
    animate &&
    lastMove &&
    nextMoveIndex === lastAppliedMoveIndex + 1 &&
    mover;

  if (shouldAnimate) {
    if (animating) await waitForAnimationEnd();
    await animateMove(lastMove.r, lastMove.c, mover);
  } else if (animating) {
    await waitForAnimationEnd();
  }

  syncFromServerRow(row);
}

function showWinFromServer(winner) {
  if (winner === State.PLAYER1 || winner === State.PLAYER2) {
    const { text, kind } = winStatusFor(winner);
    setStatus(text, kind);
  }
  updateRestartButtonVisibility();
}

async function teardownOnlineMatch() {
  if (matchChannel) {
    await mp.unsubscribe(matchChannel);
    matchChannel = null;
  }
}

async function leaveOnlineMatch() {
  if (onlineMode && matchId && mp) {
    try {
      await mp.leaveMatch(matchId, clientId);
    } catch {
      // Best-effort leave
    }
  }

  await teardownOnlineMatch();

  onlineMode = false;
  localPlayer = null;
  matchId = null;
  multiplayerConnected = false;
  matchPaused = false;
  matchActive = false;
  setLobbyControls(false);
  setMatchInfo("");
  updateMatchUrl();
  updateLegendLabels();

  cancelAnimations();
  initializeBoard();
  updateRestartButtonVisibility();
  playLocalBtn.hidden = true;
  updateTurnStatus();
  drawBoard();
}

function requestLeaveMatch() {
  leaveConfirmDialog.showModal();
}

async function confirmLeaveMatch() {
  leaveConfirmDialog.close();
  await leaveOnlineMatch();
}

function handleOpponentLeft() {
  matchPaused = true;
  multiplayerConnected = false;
  updateRestartButtonVisibility();
  playLocalBtn.hidden = false;
  setMatchInfoWithCode(matchId, "", { disconnected: true });
  setPausedStatus("Opponent left the match");
  drawBoard();
}

async function startLocalFromPaused() {
  matchPaused = false;
  playLocalBtn.hidden = true;
  onlineMode = false;
  localPlayer = null;
  matchId = null;
  setLobbyControls(false);
  setMatchInfo("");
  updateMatchUrl();
  updateLegendLabels();
  cancelAnimations();
  initializeBoard();
  updateRestartButtonVisibility();
  updateTurnStatus();
  drawBoard();
  await teardownOnlineMatch();
}

async function connectToMatch(row, role) {
  matchId = row.matchId ?? row.id;
  localPlayer = role;
  onlineMode = true;
  matchPaused = false;
  matchActive = row.status === "active";
  multiplayerConnected = false;

  setLobbyControls(true);
  updateLegendLabels();
  updateMatchUrl();

  cancelAnimations();
  updateRestartButtonVisibility();
  playLocalBtn.hidden = true;

  await applyServerMatchRow(row, { animate: false });

  if (matchChannel) await mp.unsubscribe(matchChannel);

  matchChannel = mp.subscribeToMatch(matchId, {
    onUpdate: (updatedRow) => {
      onMatchRowUpdated(updatedRow);
    },
    onDelete: () => {
      onMatchDeleted();
    },
  });

  multiplayerConnected = true;
  const waiting = row.status === "waiting";
  setMatchInfoWithCode(
    matchId,
    waiting
      ? " — waiting for opponent…"
      : ` — connected as ${playerName(localPlayer)}`,
    { connected: !waiting }
  );
}

async function onMatchRowUpdated(row) {
  if (!onlineMode || row.id !== matchId) return;

  if (row.status === "active" && matchPaused) {
    matchPaused = false;
    playLocalBtn.hidden = true;
    setMatchInfoWithCode(matchId, ` — connected as ${playerName(localPlayer)}`, {
      connected: true,
    });
  }

  if (
    row.status === "active" &&
    localPlayer === State.PLAYER1 &&
    !matchPaused &&
    matchInfoEl.textContent.includes("waiting")
  ) {
    setMatchInfoWithCode(matchId, ` — connected as ${playerName(localPlayer)}`, {
      connected: true,
    });
    updateTurnStatus();
  }

  if (isPendingOwnMoveEcho(row)) {
    return;
  }

  if (pendingOwnMove) {
    deferredMatchRow = row;
    return;
  }

  const isRemoteMove = row.move_index > lastAppliedMoveIndex;
  await applyServerMatchRow(row, { animate: isRemoteMove });
}

function onMatchDeleted() {
  if (!onlineMode || matchPaused || gameOver) return;
  handleOpponentLeft();
}

function isPendingOwnMoveEcho(row) {
  if (!pendingOwnMove) return false;
  const lastMove = row.last_move;
  return (
    row.move_index === pendingOwnMove.expectedIndex + 1 &&
    lastMove?.r === pendingOwnMove.r &&
    lastMove?.c === pendingOwnMove.c
  );
}

function opponentOf(player) {
  return player === State.PLAYER1 ? State.PLAYER2 : State.PLAYER1;
}

async function flushDeferredMatchRow() {
  if (!deferredMatchRow) return;
  const row = deferredMatchRow;
  deferredMatchRow = null;
  const isRemoteMove = row.move_index > lastAppliedMoveIndex;
  await applyServerMatchRow(row, { animate: isRemoteMove });
}

function matchRowFromResponse(data) {
  return normalizeServerRow({
    id: data.matchId,
    board: data.board,
    turn: data.turn,
    move_index: data.moveIndex,
    game_over: data.gameOver,
    winner: data.winner,
    last_move: data.lastMove,
    status: data.status,
  });
}

function isMoveConflictError(message) {
  return /stale move index|move already applied/i.test(message ?? "");
}

async function syncMatchFromServer({ animate = false } = {}) {
  if (!mp || !matchId) return false;
  const row = await mp.fetchMatchRow(matchId, clientId);
  await applyServerMatchRow(row, { animate });
  return true;
}

async function createMatch() {
  if (!mp) return;
  createMatchBtn.disabled = true;
  try {
    const data = await mp.createMatch(clientId);
    await connectToMatch(data, State.PLAYER1);
  } catch (err) {
    setMatchInfo(err.message || "Could not create match.");
  } finally {
    createMatchBtn.disabled = false;
  }
}

async function joinMatch(codeOverride) {
  if (!mp) return;
  const code = normalizeMatchId(codeOverride ?? matchCodeInput.value);
  if (!code) {
    setMatchInfo("Enter a match code to join.");
    return;
  }

  joinMatchBtn.disabled = true;
  try {
    const data = await mp.joinMatch(code, clientId);
    await connectToMatch(data, data.role);
  } catch (err) {
    setMatchInfo(err.message || "Could not join match.");
  } finally {
    joinMatchBtn.disabled = false;
  }
}

async function copyInviteLink() {
  if (!matchId) return;
  const url = inviteUrl(matchId);
  try {
    await navigator.clipboard.writeText(url);
    const prev = copyInviteBtn.textContent;
    copyInviteBtn.textContent = "Copied!";
    setTimeout(() => {
      copyInviteBtn.textContent = prev;
    }, 1600);
  } catch {
    setMatchInfo("Could not copy link — copy the match code manually.");
  }
}

function validNeighbors(r, c) {
  const neighbors = [];
  for (const [dr, dc] of DIRECTIONS) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
    neighbors.push({ nr, nc });
  }
  return neighbors;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function boardScale() {
  return boardPixelSize / BASE_BOARD_SIZE;
}

function cellCenter(r, c) {
  return {
    x: labelOffset + c * cellSize + cellSize / 2,
    y: labelOffset + r * cellSize + cellSize / 2,
  };
}

function dotRadius() {
  return Math.min(cellSize * 0.13, 10 * boardScale());
}

const DOT_LAYOUT = {
  1: [[0, 0]],
  2: [
    [-0.22, 0],
    [0.22, 0],
  ],
  3: [
    [0, -0.2],
    [-0.22, 0.18],
    [0.22, 0.18],
  ],
  4: [
    [-0.2, -0.2],
    [0.2, -0.2],
    [-0.2, 0.2],
    [0.2, 0.2],
  ],
};

function dotOffsets(count) {
  const layout = DOT_LAYOUT[Math.min(count, 4)] || DOT_LAYOUT[4];
  const spread = cellSize * 0.28;
  const offsets = [];
  for (let i = 0; i < count; i++) {
    const [ox, oy] = layout[i % layout.length];
    const extra = Math.floor(i / layout.length);
    const jitter = extra * 3 * boardScale();
    offsets.push({ x: ox * spread + jitter, y: oy * spread });
  }
  return offsets;
}

function resizeBoard() {
  const styles = getComputedStyle(boardWrap);
  const padX =
    parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
  const available = boardWrap.clientWidth - padX;
  const max = Math.min(BASE_BOARD_SIZE, available);

  boardPixelSize = Math.max(MIN_BOARD_SIZE, max);
  labelOffset = Math.round(36 * boardScale());
  cellSize = (boardPixelSize - labelOffset) / BOARD_SIZE;

  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${boardPixelSize}px`;
  canvas.style.height = `${boardPixelSize}px`;
  canvas.width = Math.round(boardPixelSize * dpr);
  canvas.height = Math.round(boardPixelSize * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (board) drawBoard();
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

function ownerColors(owner) {
  return owner === State.PLAYER1
    ? { color: COLORS.p1, dark: COLORS.p1Dark }
    : { color: COLORS.p2, dark: COLORS.p2Dark };
}

function waitFrames(duration, gen, onFrame) {
  return new Promise((resolve) => {
    const start = performance.now();

    function frame(now) {
      if (gen !== animGeneration) {
        resolve(false);
        return;
      }

      const t = Math.min(1, (now - start) / duration);
      onFrame(smoothstep(t), t);
      drawBoard();

      if (t < 1) {
        requestAnimationFrame(frame);
      } else {
        resolve(true);
      }
    }

    requestAnimationFrame(frame);
  });
}

async function animateSplitOrbs(fromR, fromC, neighbors, owner, gen) {
  if (neighbors.length === 0) return;

  const from = cellCenter(fromR, fromC);
  const targets = neighbors.map(({ nr, nc }) => cellCenter(nr, nc));
  const totalDuration = ORB_STAGGER * (neighbors.length - 1) + ORB_DURATION;

  await waitFrames(totalDuration, gen, (_, elapsedT) => {
    const elapsedMs = elapsedT * totalDuration;
    const orbs = neighbors.map((_, i) => {
      const localT = Math.min(
        1,
        Math.max(0, (elapsedMs - i * ORB_STAGGER) / ORB_DURATION)
      );
      const { posT, scale, alpha } = orbMotion(localT);
      const target = targets[i];
      return {
        x: from.x + (target.x - from.x) * posT,
        y: from.y + (target.y - from.y) * posT,
        owner,
        scale,
        alpha,
      };
    });
    overlay = { orbs };
  });

  overlay = null;
}

function orbMotion(localT) {
  if (localT <= 0) return { posT: 0, scale: 0, alpha: 0 };
  if (localT >= 1) return { posT: 1, scale: 1, alpha: 1 };

  if (localT < EMERGE_FRACTION) {
    const emergeT = localT / EMERGE_FRACTION;
    return { posT: 0, scale: easeOutBack(emergeT) * 0.95, alpha: emergeT };
  }

  const travelT = (localT - EMERGE_FRACTION) / (1 - EMERGE_FRACTION);
  return { posT: smoothstep(travelT), scale: 1, alpha: 1 };
}

async function processExplosionAt(r, c, gen, actingPlayer) {
  if (gen !== animGeneration) return;

  const capacity = getCriticalMass(r, c);
  if (board[r][c].val < capacity) return;

  const neighbors = validNeighbors(r, c);
  board[r][c] = { state: State.NULL, val: 0 };
  drawBoard();

  await animateSplitOrbs(r, c, neighbors, actingPlayer, gen);
  if (gen !== animGeneration) return;

  for (const { nr, nc } of neighbors) {
    const tile = board[nr][nc];
    board[nr][nc] = { state: actingPlayer, val: tile.val + 1 };
  }
  drawBoard();

  if (checkWinCondition()) return;

  for (const { nr, nc } of neighbors) {
    await processExplosionAt(nr, nc, gen, actingPlayer);
    if (gen !== animGeneration || chainGameOver) return;
  }
}

function animateMove(r, c, actingPlayer) {
  if (gameOver || animating) return Promise.resolve();

  const gen = ++animGeneration;
  animating = true;
  chainGameOver = false;
  pendingWin = null;
  setTurnStatus(actingPlayer, { busy: true, message: "Chain reaction…" });

  const tile = board[r][c];
  board[r][c] = { state: actingPlayer, val: tile.val + 1 };
  drawBoard();

  return processExplosionAt(r, c, gen, actingPlayer).then(() => {
    if (gen !== animGeneration) return;

    animating = false;
    applyPendingWin();
    drawBoard();
    notifyAnimationEnd();
  });
}

async function applyLocalMove(r, c) {
  const actingPlayer = turn;
  await animateMove(r, c, actingPlayer);

  if (gameOver) return;

  turn = opponentOf(turn);
  updateTurnStatus();
  drawBoard();
}

function setStatus(text, kind = "") {
  if (errorRevertTimer) {
    clearTimeout(errorRevertTimer);
    errorRevertTimer = null;
  }
  statusEl.className = kind;
  statusTextEl.textContent = text;
}

function setPausedStatus(message) {
  statusEl.className = "paused";
  statusTextEl.textContent = message;
}

function setTurnStatus(player, { busy = false, message } = {}) {
  if (errorRevertTimer) {
    clearTimeout(errorRevertTimer);
    errorRevertTimer = null;
  }

  const isP1 = player === State.PLAYER1;
  const name = playerName(player);
  const turnClass = isP1 ? "turn-p1" : "turn-p2";
  const busyClass = busy ? " busy" : "";
  statusEl.className = `${turnClass}${busyClass}`;

  if (message) {
    statusTextEl.textContent = message;
    return;
  }

  if (onlineMode && matchPaused) {
    statusTextEl.textContent = "Opponent left the match";
    return;
  }

  if (onlineMode && !multiplayerConnected) {
    statusTextEl.textContent = "Connecting to match…";
    return;
  }

  if (onlineMode && player !== localPlayer && !gameOver) {
    statusTextEl.textContent = "Opponent's turn — waiting…";
    return;
  }

  statusTextEl.replaceChildren();
  const playerSpan = document.createElement("span");
  playerSpan.className = "turn-indicator__player";
  playerSpan.textContent = name;
  statusTextEl.append(playerSpan, `'s turn — ${INPUT_VERB} one of your tiles`);
}

function showErrorStatus(message) {
  setStatus(message, "error");
  if (errorRevertTimer) clearTimeout(errorRevertTimer);
  errorRevertTimer = setTimeout(() => {
    errorRevertTimer = null;
    if (!gameOver && !matchPaused) updateTurnStatus();
  }, ERROR_REVERT_MS);
}

function updateTurnStatus({ busy = false } = {}) {
  if (gameOver || matchPaused) return;
  setTurnStatus(turn, { busy });
}

function cellAtPixel(px, py) {
  if (px < labelOffset || py < labelOffset) return null;
  const c = Math.floor((px - labelOffset) / cellSize);
  const r = Math.floor((py - labelOffset) / cellSize);
  if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return null;
  return { r, c };
}

function drawDot(cx, cy, radius, color, darkColor) {
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = darkColor;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx - radius * 0.15, cy - radius * 0.15, radius * 0.85, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function drawDotsInCell(r, c, tile) {
  const count = tile.val;
  if (count === 0) return;

  const x0 = labelOffset + c * cellSize;
  const y0 = labelOffset + r * cellSize;
  const cx = x0 + cellSize / 2;
  const cy = y0 + cellSize / 2;
  const { color, dark } = ownerColors(tile.state);
  const radius = dotRadius();

  for (const { x, y } of dotOffsets(count)) {
    drawDot(cx + x, cy + y, radius, color, dark);
  }
}

function drawOverlay() {
  if (!overlay?.orbs) return;

  const radius = dotRadius();
  for (const orb of overlay.orbs) {
    if (orb.alpha <= 0) continue;
    const { color, dark } = ownerColors(orb.owner);
    ctx.globalAlpha = orb.alpha;
    drawDot(orb.x, orb.y, radius * orb.scale, color, dark);
  }
  ctx.globalAlpha = 1;
}

function drawBoard() {
  const scale = boardScale();
  const inset = Math.max(1, scale);
  const borderInset = 3 * scale;

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, boardPixelSize, boardPixelSize);

  ctx.fillStyle = COLORS.label;
  ctx.font = `${Math.round(13 * scale)}px Segoe UI, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let k = 0; k < BOARD_SIZE; k++) {
    const colX = labelOffset + k * cellSize + cellSize / 2;
    const rowY = labelOffset + k * cellSize + cellSize / 2;
    ctx.fillText(String(k + 1), colX, labelOffset / 2);
    ctx.fillText(String(k + 1), labelOffset / 2, rowY);
  }

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const x = labelOffset + c * cellSize;
      const y = labelOffset + r * cellSize;
      const tile = board[r][c];

      ctx.fillStyle = COLORS.empty;
      ctx.fillRect(x + inset, y + inset, cellSize - inset * 2, cellSize - inset * 2);

      if (tile.state === State.PLAYER1) {
        ctx.strokeStyle = COLORS.p1;
        ctx.lineWidth = 2 * scale;
        ctx.strokeRect(
          x + borderInset,
          y + borderInset,
          cellSize - borderInset * 2,
          cellSize - borderInset * 2
        );
      } else if (tile.state === State.PLAYER2) {
        ctx.strokeStyle = COLORS.p2;
        ctx.lineWidth = 2 * scale;
        ctx.strokeRect(
          x + borderInset,
          y + borderInset,
          cellSize - borderInset * 2,
          cellSize - borderInset * 2
        );
      }

      drawDotsInCell(r, c, tile);

      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = scale;
      ctx.strokeRect(x, y, cellSize, cellSize);
    }
  }

  drawOverlay();

  const boardLeft = labelOffset;
  const boardTop = labelOffset;
  const boardW = cellSize * BOARD_SIZE;
  const boardH = cellSize * BOARD_SIZE;

  if (matchPaused) {
    const cx = boardLeft + boardW / 2;
    const cy = boardTop + boardH / 2;

    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(boardLeft, boardTop, boardW, boardH);

    ctx.fillStyle = "#ffc16b";
    ctx.font = `600 ${Math.round(20 * scale)}px Segoe UI, system-ui, sans-serif`;
    ctx.fillText("Opponent left", cx, cy - 12 * scale);

    ctx.fillStyle = "#e8d4b8";
    ctx.font = `${Math.round(14 * scale)}px Segoe UI, system-ui, sans-serif`;
    ctx.fillText("Match paused", cx, cy + 14 * scale);
  } else if (gameOver && !animating) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(boardLeft, boardTop, boardW, boardH);
  }

  canvas.style.cursor = animating
    ? "wait"
    : matchPaused
      ? "not-allowed"
      : "pointer";
}

async function tryMove(r, c) {
  if (gameOver || animating) return;
  if (onlineMode && matchPaused) return;
  if (onlineMode && !multiplayerConnected) return;
  if (onlineMode && !matchActive) {
    showErrorStatus("Waiting for your opponent to join…");
    return;
  }
  if (onlineMode && turn !== localPlayer) return;

  if (board[r][c].state !== turn) {
    showErrorStatus("You must select a tile you already own!");
    return;
  }

  if (onlineMode) {
    const expectedIndex = moveIndex;
    pendingOwnMove = { expectedIndex, r, c };
    const movePromise = mp.playMove(matchId, clientId, r, c, expectedIndex);

    try {
      await animateMove(r, c, localPlayer);
      if (!gameOver) {
        setTurnStatus(opponentOf(localPlayer));
      }
      const data = await movePromise;
      await applyServerMatchRow(matchRowFromResponse(data), { animate: false });
      pendingOwnMove = null;
      await flushDeferredMatchRow();
      if (gameOver) updateRestartButtonVisibility();
    } catch (err) {
      pendingOwnMove = null;
      deferredMatchRow = null;
      animating = false;
      chainGameOver = false;
      pendingWin = null;
      notifyAnimationEnd();

      const message = err.message || "Move rejected by server.";
      if (isMoveConflictError(message)) {
        try {
          await syncMatchFromServer();
        } catch {
          showErrorStatus(message);
        }
        return;
      }

      try {
        await syncMatchFromServer();
      } catch {
        // Keep the server error if we cannot resync.
      }
      showErrorStatus(message);
    }
    return;
  }

  await applyLocalMove(r, c);
}

function handleBoardPointer(e) {
  const rect = canvas.getBoundingClientRect();
  const px = (e.clientX - rect.left) * (boardPixelSize / rect.width);
  const py = (e.clientY - rect.top) * (boardPixelSize / rect.height);
  const cell = cellAtPixel(px, py);
  if (cell) tryMove(cell.r, cell.c);
}

canvas.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  handleBoardPointer(e);
});

restartBtn.addEventListener("click", async () => {
  if (onlineMode && mp && matchId) {
    restartBtn.disabled = true;
    try {
      const data = await mp.restartMatch(matchId, clientId);
      await applyServerMatchRow(matchRowFromResponse(data), { animate: false });
    } catch (err) {
      showErrorStatus(err.message || "Could not restart match.");
    } finally {
      restartBtn.disabled = false;
    }
    return;
  }

  cancelAnimations();
  initializeBoard();
  updateRestartButtonVisibility();
  updateTurnStatus();
  drawBoard();
});

createMatchBtn.addEventListener("click", createMatch);
joinMatchBtn.addEventListener("click", () => joinMatch());
copyInviteBtn.addEventListener("click", copyInviteLink);
leaveMatchBtn.addEventListener("click", requestLeaveMatch);
leaveCancelBtn.addEventListener("click", () => leaveConfirmDialog.close());
leaveConfirmBtn.addEventListener("click", confirmLeaveMatch);
playLocalBtn.addEventListener("click", startLocalFromPaused);
matchCodeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinMatch();
});

const urlParams = new URLSearchParams(window.location.search);
const urlMatch = urlParams.get("match");
const urlRole = urlParams.get("role");

initializeBoard();
resizeBoard();
updateTurnStatus();
window.addEventListener("resize", resizeBoard);

if (urlMatch && mp) {
  matchCodeInput.value = normalizeMatchId(urlMatch);
  if (urlRole === "p2") {
    joinMatch(urlMatch);
  } else if (urlRole === "p1") {
    mp.joinMatch(normalizeMatchId(urlMatch), clientId)
      .then((data) => connectToMatch(data, State.PLAYER1))
      .catch((err) => setMatchInfo(err.message || "Could not rejoin match."));
  } else {
    setMatchInfo("Use the invite link from the match host to join as Player 2.");
    matchCodeInput.value = normalizeMatchId(urlMatch);
  }
}
