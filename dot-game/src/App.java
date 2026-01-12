import java.util.*;

public class App {

    public enum State {
        NULL,
        PLAYER1,
        PLAYER2
    }

    public static class Tile {
        private State state;
        private int val;

        Tile(State state, int val) {
            this.state = state;
            this.val = (state == State.NULL) ? 0 : val;
        }

        public void addValue(State newOwner) {
            this.state = newOwner;
            this.val++;
        }
        
        public void reset() {
            this.state = State.NULL;
            this.val = 0;
        }

        public int getVal() { return this.val; }
        public State getState() { return this.state; }

        @Override
        public String toString() {
            if (this.state == State.NULL) return "{ }";
            String icon = String.valueOf(this.val);
            if (this.state == State.PLAYER1) return "[" + icon + "]";
            return "(" + icon + ")";
        }
    }

    static boolean gameOver = false;
    static Tile[][] board = new Tile[5][5];
    static State turn = State.PLAYER1;
    public static void initializeBoard() {
        for (int i = 0; i < board.length; i++) {
            for (int j = 0; j < board[i].length; j++) {
                board[i][j] = new Tile(State.NULL, 0);
            }
        }
        
        board[0][0] = new Tile(State.PLAYER1, 3);

        int lastRow = board.length - 1;
        int lastCol = board[0].length - 1;
        board[lastRow][lastCol] = new Tile(State.PLAYER2, 3);
    }

    public static void printBoard() {
        System.out.print("     ");
        
        for (int k = 0; k < board[0].length; k++) {
            System.out.print("{" + (k+1) + "}");
        }
        System.out.println();
        System.out.println(); 

        for (int i = 0; i < board.length; i++) {
            System.out.print("{" + (i+1) + "}  ");
            
            for (int j = 0; j < board[i].length; j++) {
                System.out.print(board[i][j]);
            }
            System.out.println();
        }
        System.out.println();
    }
    
    public static void checkWinCondition() {
        boolean p1HasTiles = false;
        boolean p2HasTiles = false;

        for (int i = 0; i < board.length; i++) {
            for (int j = 0; j < board[i].length; j++) {
                if (board[i][j].getState() == State.PLAYER1) p1HasTiles = true;
                if (board[i][j].getState() == State.PLAYER2) p2HasTiles = true;
            }
        }

        if (!p1HasTiles) {
            printBoard(); 
            System.out.println("\n***********************************");
            System.out.println("       GAME OVER! PLAYER 2 WINS!   ");
            System.out.println("***********************************");
            gameOver = true;
        } else if (!p2HasTiles) {
            printBoard(); 
            System.out.println("\n***********************************");
            System.out.println("       GAME OVER! PLAYER 1 WINS!   ");
            System.out.println("***********************************");
            gameOver = true;
        }
    }
    
    public static void checkExplosion(int r, int c) throws InterruptedException {
        if (board[r][c].getVal() < 4) return;

        System.out.println(">>> BOOM! Explosion at " + (r+1) + ", " + (c+1));
        printBoard(); 
        Thread.sleep(1000); 

        board[r][c].reset();

        int[][] directions = {{-1, 0}, {1, 0}, {0, -1}, {0, 1}};

        for (int[] dir : directions) {
            int nr = r + dir[0];
            int nc = c + dir[1];

            if (nr >= 0 && nr < board.length && nc >= 0 && nc < board[0].length) {
                board[nr][nc].addValue(turn);
                checkExplosion(nr, nc); 
            }
        }
    }

    public static void main(String[] args) throws Exception {
        initializeBoard();
        Scanner scanner = new Scanner(System.in);

        System.out.println("INSTRUCTIONS:");
        System.out.println("1. Select your own tile to increment its value.");
        System.out.println("2. When a tile hits 4, it EXPLODES.");
        System.out.println("3. Eliminate all opponent tiles to WIN!");
        System.out.println("[X] - Player 1 | (X) - Player 2");

        while (!gameOver) {
            System.out.println("\n\n--------------------------------");
            printBoard();

            System.out.println(turn + "'s turn. Enter row, col:");
            
            String inp = scanner.nextLine();
            String[] parts = inp.replaceAll("[^0-9]+", " ").trim().split("\\s+");

            if (parts.length >= 2 && !parts[0].isEmpty()) {
                int x = Integer.parseInt(parts[0]) - 1; 
                int y = Integer.parseInt(parts[1]) - 1;

                if (x >= 0 && x < board.length && y >= 0 && y < board[0].length) {                    
                    if (board[x][y].getState() == turn) {
                        System.out.println(">> Move accepted!");
                        board[x][y].addValue(turn);
                        
                        checkExplosion(x, y); 
                        checkWinCondition(); 

                        if (!gameOver) {
                            turn = (turn == State.PLAYER1) ? State.PLAYER2 : State.PLAYER1;
                        }
                    } else {
                        System.out.println(">> Error: You must select a tile you already own!");
                    }

                } else {
                    System.out.println(">> Error: Coordinates out of bounds.");
                }
            } else {
                System.out.println(">> Error: Please enter 'row, col'");
            }
        }
        scanner.close();
    }
}