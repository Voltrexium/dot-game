import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./config.js";

const State = {
  NULL: "NULL",
  PLAYER1: "PLAYER1",
  PLAYER2: "PLAYER2",
};

const BOARD_SIZE = 5;
const BASE_BOARD_SIZE = 520;
const MIN_BOARD_SIZE = 280;
const ORB_DURATION = 220;
const ORB_STAGGER = 40;
const EMERGE_FRACTION = 0.22;

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
const restartBtn = document.getElementById("restart");
const createMatchBtn = document.getElementById("create-match");
const joinMatchBtn = document.getElementById("join-match");
const matchCodeInput = document.getElementById("match-code");
const matchInfoEl = document.getElementById("match-info");
const leaveMatchBtn = document.getElementById("leave-match");
const leaveConfirmDialog = document.getElementById("leave-confirm");
const leaveCancelBtn = document.getElementById("leave-cancel");
const leaveConfirmBtn = document.getElementById("leave-confirm-btn");
const legendP1El = document.getElementById("legend-p1");
const legendP2El = document.getElementById("legend-p2");
const INPUT_VERB = window.matchMedia("(pointer: coarse)").matches ? "tap" : "click";

const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
const clientId = crypto.randomUUID();

let onlineMode = false;
let localPlayer = null;
let matchId = null;
let gameChannel = null;
let multiplayerConnected = false;
let matchPaused = false;

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

class Tile {
  constructor(state, val) {
    this.state = state;
    this.val = state === State.NULL ? 0 : val;
  }

  addValue(newOwner) {
    this.state = newOwner;
    this.val++;
  }

  reset() {
    this.state = State.NULL;
    this.val = 0;
  }
}

let board;
let turn;
let gameOver;
let animating = false;
let animGeneration = 0;
let overlay = null;

function playerName(player) {
  if (!onlineMode) return player === State.PLAYER1 ? "Player 1" : "Player 2";
  if (player === localPlayer) return "You";
  return "Opponent";
}

function normalizeMatchId(code) {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function randomMatchId() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(
    { length: 6 },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

function channelName(id) {
  return `match_room_${normalizeMatchId(id).toLowerCase()}`;
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

function setMatchInfo(text, { connected = false, disconnected = false } = {}) {
  matchInfoEl.hidden = !text;
  matchInfoEl.classList.toggle("connected", connected);
  matchInfoEl.classList.toggle("disconnected", disconnected);
  matchInfoEl.innerHTML = text;
}

function setLobbyControls(inMatch) {
  createMatchBtn.hidden = inMatch;
  joinMatchBtn.hidden = inMatch;
  matchCodeInput.hidden = inMatch;
  leaveMatchBtn.hidden = !inMatch;
}

async function leaveOnlineMatch() {
  if (gameChannel) {
    await supabase.removeChannel(gameChannel);
    gameChannel = null;
  }

  onlineMode = false;
  localPlayer = null;
  matchId = null;
  multiplayerConnected = false;
  matchPaused = false;
  setLobbyControls(false);
  setMatchInfo("");
  updateMatchUrl();
  updateLegendLabels();

  animGeneration++;
  animating = false;
  overlay = null;
  initializeBoard();
  restartBtn.hidden = true;
  updateTurnStatus();
  drawBoard();
}

function requestLeaveMatch() {
  leaveConfirmDialog.showModal();
}

async function confirmLeaveMatch() {
  leaveConfirmDialog.close();

  if (onlineMode && gameChannel) {
    await gameChannel.send({
      type: "broadcast",
      event: "player-left",
      payload: { clientId },
    });
  }

  await leaveOnlineMatch();
}

function setPausedStatus(message) {
  statusEl.className = "paused";
  statusEl.innerHTML = `
    <span class="turn-indicator__dot" aria-hidden="true"></span>
    <span class="turn-indicator__text">${message}</span>
  `;
}

function handleOpponentLeft() {
  matchPaused = true;
  multiplayerConnected = false;
  restartBtn.hidden = true;
  setMatchInfo(`Match <strong>${matchId}</strong>`, { disconnected: true });
  setPausedStatus("Opponent left the match");
  drawBoard();
}

function applyMoveToLocalState(actionData) {
  const { r, c } = actionData;
  if (gameOver || animating) return;
  if (board[r][c].state !== turn) return;

  const gen = ++animGeneration;
  animating = true;
  setTurnStatus(turn, { busy: true, message: "Chain reaction…" });

  board[r][c].addValue(turn);
  drawBoard();

  processExplosionAt(r, c, gen).then(() => {
    if (gen !== animGeneration) return;

    checkWinCondition();

    if (!gameOver) {
      turn = turn === State.PLAYER1 ? State.PLAYER2 : State.PLAYER1;
      updateTurnStatus();
    }

    animating = false;
    drawBoard();
  });
}

function handlePlayerAction(actionData) {
  applyMoveToLocalState(actionData);

  if (onlineMode && gameChannel) {
    gameChannel.send({
      type: "broadcast",
      event: "game-move",
      payload: actionData,
    });
  }
}

async function subscribeToMatch(id, role) {
  const normalizedId = normalizeMatchId(id);
  if (!normalizedId) return;

  if (gameChannel) {
    await supabase.removeChannel(gameChannel);
    gameChannel = null;
  }

  onlineMode = true;
  matchId = normalizedId;
  localPlayer = role;
  multiplayerConnected = false;
  matchPaused = false;

  setLobbyControls(true);
  updateLegendLabels();
  updateMatchUrl();
  setMatchInfo(
    `Match <strong>${matchId}</strong> — connecting as ${playerName(localPlayer)}…`
  );

  animGeneration++;
  animating = false;
  overlay = null;
  initializeBoard();
  restartBtn.hidden = true;
  updateTurnStatus();
  drawBoard();

  gameChannel = supabase.channel(channelName(matchId));

  gameChannel
    .on("broadcast", { event: "game-move" }, ({ payload }) => {
      if (!payload || payload.clientId === clientId) return;
      applyMoveToLocalState(payload);
    })
    .on("broadcast", { event: "game-restart" }, ({ payload }) => {
      if (!payload || payload.clientId === clientId) return;
      animGeneration++;
      animating = false;
      overlay = null;
      initializeBoard();
      restartBtn.hidden = true;
      updateTurnStatus();
      drawBoard();
    })
    .on("broadcast", { event: "player-left" }, ({ payload }) => {
      if (!payload || payload.clientId === clientId) return;
      handleOpponentLeft();
    })
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        multiplayerConnected = true;
        setMatchInfo(
          `Match <strong>${matchId}</strong> — connected as ${playerName(localPlayer)}`,
          { connected: true }
        );
        updateTurnStatus();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        multiplayerConnected = false;
        setMatchInfo(
          `Match <strong>${matchId}</strong> — connection lost. Try leaving and rejoining.`
        );
      }
    });
}

function createMatch() {
  subscribeToMatch(randomMatchId(), State.PLAYER1);
}

function joinMatch() {
  const code = normalizeMatchId(matchCodeInput.value);
  if (!code) {
    setMatchInfo("Enter a match code to join.");
    return;
  }
  subscribeToMatch(code, State.PLAYER2);
}

function initializeBoard() {
  board = Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => new Tile(State.NULL, 0))
  );

  board[0][0] = new Tile(State.PLAYER1, 1);

  const last = BOARD_SIZE - 1;
  board[last][last] = new Tile(State.PLAYER2, 1);

  turn = State.PLAYER1;
  gameOver = false;
  overlay = null;
}

function getCriticalMass(r, c) {
  const maxRows = BOARD_SIZE - 1;
  const maxCols = BOARD_SIZE - 1;

  const isCorner =
    (r === 0 && c === 0) ||
    (r === 0 && c === maxCols) ||
    (r === maxRows && c === 0) ||
    (r === maxRows && c === maxCols);
  if (isCorner) return 2;

  const isEdge = r === 0 || c === 0 || r === maxRows || c === maxCols;
  if (isEdge) return 3;

  return 4;
}

function checkWinCondition() {
  if (gameOver) return true;

  let p1HasTiles = false;
  let p2HasTiles = false;

  for (let i = 0; i < BOARD_SIZE; i++) {
    for (let j = 0; j < BOARD_SIZE; j++) {
      if (board[i][j].state === State.PLAYER1) p1HasTiles = true;
      if (board[i][j].state === State.PLAYER2) p2HasTiles = true;
    }
  }

  if (!p1HasTiles) {
    const text = onlineMode
      ? localPlayer === State.PLAYER2
        ? "You win!"
        : "Opponent wins!"
      : "GAME OVER! Player 2 wins!";
    setStatus(text, "win-p2");
    gameOver = true;
    restartBtn.hidden = false;
    return true;
  }

  if (!p2HasTiles) {
    const text = onlineMode
      ? localPlayer === State.PLAYER1
        ? "You win!"
        : "Opponent wins!"
      : "GAME OVER! Player 1 wins!";
    setStatus(text, "win-p1");
    gameOver = true;
    restartBtn.hidden = false;
    return true;
  }

  return false;
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

function validNeighbors(r, c) {
  const neighbors = [];

  for (const [dr, dc] of DIRECTIONS) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr < 0 || nr >= BOARD_SIZE || nc < 0 || nc >= BOARD_SIZE) continue;
    neighbors.push({ nr, nc, dr, dc });
  }

  return neighbors;
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
      const localT = Math.min(1, Math.max(0, (elapsedMs - i * ORB_STAGGER) / ORB_DURATION));
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
  const eased = smoothstep(travelT);
  return { posT: eased, scale: 1, alpha: 1 };
}

async function processExplosionAt(r, c, gen) {
  if (gameOver || gen !== animGeneration) return;

  const capacity = getCriticalMass(r, c);
  if (board[r][c].val < capacity) return;

  const neighbors = validNeighbors(r, c);

  board[r][c].reset();
  drawBoard();

  await animateSplitOrbs(r, c, neighbors, turn, gen);
  if (gen !== animGeneration || gameOver) return;

  for (const { nr, nc } of neighbors) {
    board[nr][nc].addValue(turn);
  }
  drawBoard();

  if (checkWinCondition()) return;

  for (const { nr, nc } of neighbors) {
    await processExplosionAt(nr, nc, gen);
    if (gen !== animGeneration || gameOver) return;
  }
}

function setStatus(text, kind = "") {
  statusEl.className = kind;
  statusEl.innerHTML = `<span class="turn-indicator__text">${text}</span>`;
}

function setTurnStatus(player, { busy = false, message } = {}) {
  const isP1 = player === State.PLAYER1;
  const name = playerName(player);
  const turnClass = isP1 ? "turn-p1" : "turn-p2";
  const busyClass = busy ? " busy" : "";
  let text = message;

  if (!text && onlineMode && matchPaused) {
    text = "Opponent left the match";
  } else if (!text && onlineMode && !multiplayerConnected) {
    text = "Connecting to match…";
  } else if (!text && onlineMode && player !== localPlayer && !gameOver) {
    text = "Opponent's turn — waiting…";
  } else if (!text) {
    text = `<span class="turn-indicator__player">${name}</span>'s turn — ${INPUT_VERB} one of your tiles`;
  }

  statusEl.className = `${turnClass}${busyClass}`;
  statusEl.innerHTML = `
    <span class="turn-indicator__dot" aria-hidden="true"></span>
    <span class="turn-indicator__text">${text}</span>
  `;
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
  } else if (gameOver) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(boardLeft, boardTop, boardW, boardH);
  }

  canvas.style.cursor = animating ? "wait" : matchPaused ? "not-allowed" : "pointer";
}

async function tryMove(r, c) {
  if (gameOver || animating) return;
  if (onlineMode && matchPaused) return;
  if (onlineMode && !multiplayerConnected) return;
  if (onlineMode && turn !== localPlayer) return;

  if (board[r][c].state !== turn) {
    setStatus("You must select a tile you already own!", "error");
    return;
  }

  const actionData = { r, c, clientId };

  if (onlineMode) {
    handlePlayerAction(actionData);
  } else {
    applyMoveToLocalState(actionData);
  }
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
  animGeneration++;
  animating = false;
  overlay = null;
  initializeBoard();
  restartBtn.hidden = true;
  updateTurnStatus();
  drawBoard();

  if (onlineMode && gameChannel) {
    await gameChannel.send({
      type: "broadcast",
      event: "game-restart",
      payload: { clientId },
    });
  }
});

createMatchBtn.addEventListener("click", createMatch);
joinMatchBtn.addEventListener("click", joinMatch);
leaveMatchBtn.addEventListener("click", requestLeaveMatch);
leaveCancelBtn.addEventListener("click", () => leaveConfirmDialog.close());
leaveConfirmBtn.addEventListener("click", confirmLeaveMatch);
matchCodeInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") joinMatch();
});

const urlParams = new URLSearchParams(window.location.search);
const urlMatch = urlParams.get("match");
const urlRole = urlParams.get("role");
if (urlMatch) {
  matchCodeInput.value = normalizeMatchId(urlMatch);
  subscribeToMatch(
    urlMatch,
    urlRole === "p2" ? State.PLAYER2 : State.PLAYER1
  );
}

initializeBoard();
resizeBoard();
updateTurnStatus();
window.addEventListener("resize", resizeBoard);
