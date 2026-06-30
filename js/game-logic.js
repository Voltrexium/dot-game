export const State = {
  NULL: "NULL",
  PLAYER1: "PLAYER1",
  PLAYER2: "PLAYER2",
};

export const BOARD_SIZE = 5;

const DIRECTIONS = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

export function emptyTile() {
  return { state: State.NULL, val: 0 };
}

export function createInitialBoard() {
  const board = Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, () => emptyTile())
  );

  board[0][0] = { state: State.PLAYER1, val: 1 };
  const last = BOARD_SIZE - 1;
  board[last][last] = { state: State.PLAYER2, val: 1 };

  return board;
}

export function cloneBoard(board) {
  return board.map((row) => row.map((tile) => ({ ...tile })));
}

export function getCriticalMass(r, c, boardSize = BOARD_SIZE) {
  const max = boardSize - 1;

  const isCorner =
    (r === 0 && c === 0) ||
    (r === 0 && c === max) ||
    (r === max && c === 0) ||
    (r === max && c === max);
  if (isCorner) return 2;

  const isEdge = r === 0 || c === 0 || r === max || c === max;
  if (isEdge) return 3;

  return 4;
}

function validNeighbors(r, c, boardSize = BOARD_SIZE) {
  const neighbors = [];

  for (const [dr, dc] of DIRECTIONS) {
    const nr = r + dr;
    const nc = c + dc;
    if (nr < 0 || nr >= boardSize || nc < 0 || nc >= boardSize) continue;
    neighbors.push({ nr, nc });
  }

  return neighbors;
}

function addValue(tile, owner) {
  return { state: owner, val: tile.val + 1 };
}

function resetTile() {
  return emptyTile();
}

function checkWinCondition(board) {
  let p1HasTiles = false;
  let p2HasTiles = false;

  for (let i = 0; i < BOARD_SIZE; i++) {
    for (let j = 0; j < BOARD_SIZE; j++) {
      if (board[i][j].state === State.PLAYER1) p1HasTiles = true;
      if (board[i][j].state === State.PLAYER2) p2HasTiles = true;
    }
  }

  if (!p1HasTiles) {
    return { gameOver: true, winner: State.PLAYER2 };
  }

  if (!p2HasTiles) {
    return { gameOver: true, winner: State.PLAYER1 };
  }

  return { gameOver: false, winner: null };
}

function processExplosionAt(board, r, c, currentTurn) {
  const capacity = getCriticalMass(r, c);
  if (board[r][c].val < capacity) return;

  const neighbors = validNeighbors(r, c);
  board[r][c] = resetTile();

  for (const { nr, nc } of neighbors) {
    board[nr][nc] = addValue(board[nr][nc], currentTurn);
  }

  const win = checkWinCondition(board);
  if (win.gameOver) return win;

  for (const { nr, nc } of neighbors) {
    const result = processExplosionAt(board, nr, nc, currentTurn);
    if (result?.gameOver) return result;
  }

  return null;
}

export function applyMove(board, r, c, currentTurn) {
  if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) {
    return { ok: false, error: "Cell out of bounds" };
  }

  if (board[r][c].state !== currentTurn) {
    return { ok: false, error: "You must select a tile you already own" };
  }

  const nextBoard = cloneBoard(board);
  nextBoard[r][c] = addValue(nextBoard[r][c], currentTurn);

  const explosionResult = processExplosionAt(nextBoard, r, c, currentTurn);
  const win = explosionResult ?? checkWinCondition(nextBoard);

  let nextTurn = currentTurn;
  if (!win.gameOver) {
    nextTurn =
      currentTurn === State.PLAYER1 ? State.PLAYER2 : State.PLAYER1;
  }

  return {
    ok: true,
    board: nextBoard,
    turn: nextTurn,
    gameOver: win.gameOver,
    winner: win.winner,
    lastMove: { r, c },
  };
}

export function playerForClientId(auth, clientId) {
  if (auth.p1_client_id === clientId) return State.PLAYER1;
  if (auth.p2_client_id === clientId) return State.PLAYER2;
  return null;
}
