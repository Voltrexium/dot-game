const State = {
  NULL: "NULL",
  PLAYER1: "PLAYER1",
  PLAYER2: "PLAYER2",
};

const BOARD_SIZE = 5;
const LABEL_OFFSET = 36;
const CELL_SIZE = (520 - LABEL_OFFSET) / BOARD_SIZE;
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
const statusEl = document.getElementById("status");
const restartBtn = document.getElementById("restart");

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
  let p1HasTiles = false;
  let p2HasTiles = false;

  for (let i = 0; i < BOARD_SIZE; i++) {
    for (let j = 0; j < BOARD_SIZE; j++) {
      if (board[i][j].state === State.PLAYER1) p1HasTiles = true;
      if (board[i][j].state === State.PLAYER2) p2HasTiles = true;
    }
  }

  if (!p1HasTiles) {
    setStatus("GAME OVER! Player 2 wins!", "win");
    gameOver = true;
    restartBtn.hidden = false;
  } else if (!p2HasTiles) {
    setStatus("GAME OVER! Player 1 wins!", "win");
    gameOver = true;
    restartBtn.hidden = false;
  }
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function cellCenter(r, c) {
  return {
    x: LABEL_OFFSET + c * CELL_SIZE + CELL_SIZE / 2,
    y: LABEL_OFFSET + r * CELL_SIZE + CELL_SIZE / 2,
  };
}

function dotRadius() {
  return Math.min(CELL_SIZE * 0.13, 10);
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
  const spread = CELL_SIZE * 0.28;
  const offsets = [];

  for (let i = 0; i < count; i++) {
    const [ox, oy] = layout[i % layout.length];
    const extra = Math.floor(i / layout.length);
    const jitter = extra * 3;
    offsets.push({ x: ox * spread + jitter, y: oy * spread });
  }

  return offsets;
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
  const capacity = getCriticalMass(r, c);
  if (board[r][c].val < capacity) return;

  const neighbors = validNeighbors(r, c);

  board[r][c].reset();
  drawBoard();

  await animateSplitOrbs(r, c, neighbors, turn, gen);
  if (gen !== animGeneration) return;

  for (const { nr, nc } of neighbors) {
    board[nr][nc].addValue(turn);
  }
  drawBoard();

  for (const { nr, nc } of neighbors) {
    await processExplosionAt(nr, nc, gen);
    if (gen !== animGeneration) return;
  }
}

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = kind;
}

function updateTurnStatus() {
  if (gameOver) return;
  const name = turn === State.PLAYER1 ? "Player 1" : "Player 2";
  setStatus(`${name}'s turn — click one of your tiles`);
}

function cellAtPixel(px, py) {
  if (px < LABEL_OFFSET || py < LABEL_OFFSET) return null;
  const c = Math.floor((px - LABEL_OFFSET) / CELL_SIZE);
  const r = Math.floor((py - LABEL_OFFSET) / CELL_SIZE);
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

  const x0 = LABEL_OFFSET + c * CELL_SIZE;
  const y0 = LABEL_OFFSET + r * CELL_SIZE;
  const cx = x0 + CELL_SIZE / 2;
  const cy = y0 + CELL_SIZE / 2;
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
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = COLORS.label;
  ctx.font = "13px Segoe UI, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let k = 0; k < BOARD_SIZE; k++) {
    const colX = LABEL_OFFSET + k * CELL_SIZE + CELL_SIZE / 2;
    const rowY = LABEL_OFFSET + k * CELL_SIZE + CELL_SIZE / 2;
    ctx.fillText(String(k + 1), colX, LABEL_OFFSET / 2);
    ctx.fillText(String(k + 1), LABEL_OFFSET / 2, rowY);
  }

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const x = LABEL_OFFSET + c * CELL_SIZE;
      const y = LABEL_OFFSET + r * CELL_SIZE;
      const tile = board[r][c];

      ctx.fillStyle = COLORS.empty;
      ctx.fillRect(x + 1, y + 1, CELL_SIZE - 2, CELL_SIZE - 2);

      if (tile.state === State.PLAYER1) {
        ctx.strokeStyle = COLORS.p1;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 3, y + 3, CELL_SIZE - 6, CELL_SIZE - 6);
      } else if (tile.state === State.PLAYER2) {
        ctx.strokeStyle = COLORS.p2;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 3, y + 3, CELL_SIZE - 6, CELL_SIZE - 6);
      }

      drawDotsInCell(r, c, tile);

      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, CELL_SIZE, CELL_SIZE);
    }
  }

  drawOverlay();

  if (gameOver) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(LABEL_OFFSET, LABEL_OFFSET, CELL_SIZE * BOARD_SIZE, CELL_SIZE * BOARD_SIZE);
  }

  canvas.style.cursor = animating ? "wait" : "pointer";
}

async function tryMove(r, c) {
  if (gameOver || animating) return;

  if (board[r][c].state !== turn) {
    setStatus("You must select a tile you already own!", "error");
    return;
  }

  const gen = ++animGeneration;
  animating = true;
  setStatus("Chain reaction…");

  board[r][c].addValue(turn);
  drawBoard();

  await processExplosionAt(r, c, gen);
  if (gen !== animGeneration) return;

  checkWinCondition();

  if (!gameOver) {
    turn = turn === State.PLAYER1 ? State.PLAYER2 : State.PLAYER1;
    updateTurnStatus();
  }

  animating = false;
  drawBoard();
}

canvas.addEventListener("click", (e) => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const px = (e.clientX - rect.left) * scaleX;
  const py = (e.clientY - rect.top) * scaleY;
  const cell = cellAtPixel(px, py);
  if (cell) tryMove(cell.r, cell.c);
});

restartBtn.addEventListener("click", () => {
  animGeneration++;
  animating = false;
  overlay = null;
  initializeBoard();
  restartBtn.hidden = true;
  updateTurnStatus();
  drawBoard();
});

initializeBoard();
updateTurnStatus();
drawBoard();
