import { useEffect, useRef, useState } from "react";
import { getSocket } from "../lib/socket";

type Player = {
  id: string;
  name: string;
};

type Winner = {
  id: string;
  name: string;
} | null;

type GameState = "lobby" | "question" | "voting" | "result" | "finished";

export default function TestSocket() {
  const socket = getSocket();

  const [name, setName] = useState("");
  const [roomId, setRoomId] = useState("");

  const [connected, setConnected] = useState(false);

  const [players, setPlayers] = useState<Player[]>([]);
  const [questions, setQuestions] = useState<string[]>([]);
  const [newQuestion, setNewQuestion] = useState("");

  const [question, setQuestion] = useState("");
  const [winner, setWinner] = useState<Winner>(null);

  const [hostId, setHostId] = useState("");
  const [socketId, setSocketId] = useState("");

  const [gameState, setGameState] = useState<GameState>("lobby");

  const [joined, setJoined] = useState(false);
  const [inRoom, setInRoom] = useState(false);

  const [voting, setVoting] = useState(false);
  const [hasVoted, setHasVoted] = useState(false);
  const [votedFor, setVotedFor] = useState<string | null>(null);

  const [timer, setTimer] = useState(0);

  // Single source of truth for the countdown interval so we can never have
  // more than one running at once.
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isHost = hostId === socketId;

  const clearTimerInterval = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  };

  useEffect(() => {
    socket.on("connect", () => {
      setConnected(true);
      setSocketId(socket.id ?? "");
    });

    socket.on("joined_room", (data) => {
      setRoomId(data.roomId);
      setHostId(data.hostId);
      setGameState(data.gameState || "lobby");
      setJoined(true);
      setInRoom(true);
    });

    socket.on("join_error", (data) => {
      alert(data.message || "Could not join room");
      setJoined(false);
      setInRoom(false);
    });

    socket.on("room_updated", (data) => {
      setPlayers(data.players || []);
      setHostId(data.hostId || "");
      setGameState(data.gameState || "lobby");
      if (data.questions) setQuestions(data.questions);
    });

    socket.on("questions_updated", (data) => {
      setQuestions(data.questions || []);
    });

    socket.on("new_question", (data) => {
      setQuestion(data.question);
      setWinner(null);
      setVoting(false);
      clearTimerInterval();
      setTimer(0);
      setHasVoted(false);
      setVotedFor(null);
      setGameState("question");
    });

    socket.on("vote_received", () => {
      setHasVoted(true);
    });

    socket.on("start_voting", (data) => {
      setGameState("voting");
      setVoting(true);
      setHasVoted(Boolean(data.hasVoted));

      clearTimerInterval();

      let remaining = data.duration || 10;
      setTimer(remaining);

      timerIntervalRef.current = setInterval(() => {
        remaining -= 1;
        setTimer(Math.max(remaining, 0));

        if (remaining <= 0) {
          clearTimerInterval();
          setVoting(false);
        }
      }, 1000);
    });

    socket.on("round_result", (data) => {
      setGameState("result");
      setWinner(data.winner);
      setVoting(false);
      clearTimerInterval();
      setTimer(0);
    });

    socket.on("game_finished", () => {
      setGameState("finished");
      setVoting(false);
      clearTimerInterval();
      setTimer(0);
    });

    return () => {
      clearTimerInterval();
      socket.removeAllListeners();
    };
  }, []);

  const createRoom = () => {
    const newRoom = Math.random().toString(36).substring(2, 7);
    socket.emit("create_room", newRoom);
    setRoomId(newRoom);
    setInRoom(true);
  };

  const joinRoom = () => {
    if (!roomId || !name || joined) return;

    socket.emit("join_room", {
      roomId,
      name,
    });
  };

  const addQuestion = () => {
    if (!newQuestion.trim()) return;

    socket.emit("add_question", {
      roomId,
      question: newQuestion,
    });

    setNewQuestion("");
  };

  const startGame = () => {
    socket.emit("start_game", roomId);
  };

  const vote = (targetId: string) => {
    // Client-side guard mirrors server-side guard — even if this fires
    // twice due to a fast double-click, the server enforces one vote
    // per player, so `hasVoted` is the real lock here.
    if (hasVoted) return;

    setVotedFor(targetId);
    // Optimistically lock the UI immediately; 'vote_received' confirms it.
    setHasVoted(true);

    socket.emit("submit_vote", {
      roomId,
      targetId,
    });
  };

  return (
    <div
      style={{
        ...styles.page,
        background: inRoom
          ? "linear-gradient(135deg,#052e16,#111827)"
          : styles.page.background,
        transition: "0.5s",
      }}
    >
      <div style={styles.container}>
        <h1 style={styles.title}>🎮 Party Chaos</h1>

        <p style={styles.status}>
          {connected ? "🟢 Online" : "🔴 Offline"} • Room: {roomId || "None"}
        </p>

        {inRoom && (
          <div style={styles.roomBanner}>🎮 Joined Room: {roomId}</div>
        )}

        {gameState === "lobby" && (
          <div style={styles.card}>
            <h2>Join Game</h2>

            <input
              style={styles.input}
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            <input
              style={styles.input}
              placeholder="Room ID"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            />

            <div style={styles.row}>
              <button
                style={{
                  ...styles.button,
                  background: inRoom ? "#16a34a" : "#3b82f6",
                }}
                onClick={createRoom}
              >
                {inRoom ? "✓ Created" : "Create Room"}
              </button>

              <button
                style={{
                  ...styles.buttonAlt,
                  background: joined ? "#16a34a" : "#10b981",
                }}
                onClick={joinRoom}
                disabled={joined}
              >
                {joined ? "✓ Joined" : "Join"}
              </button>
            </div>
          </div>
        )}

        {isHost && gameState === "lobby" && (
          <div style={styles.cardHost}>
            <h2>👑 Host Panel</h2>

            <input
              style={styles.input}
              placeholder="Add funny question..."
              value={newQuestion}
              onChange={(e) => setNewQuestion(e.target.value)}
            />

            <button style={styles.button} onClick={addQuestion}>
              Add Question
            </button>

            <div>
              <h4>Question Queue</h4>

              {questions.length === 0 && (
                <div style={styles.questionItem}>No questions added yet.</div>
              )}

              {questions.map((q, index) => (
                <div key={index} style={styles.questionItem}>
                  ❓ {q}
                </div>
              ))}
            </div>

            <button
              style={{
                ...styles.startButton,
                opacity: questions.length === 0 ? 0.5 : 1,
                cursor: questions.length === 0 ? "not-allowed" : "pointer",
              }}
              onClick={startGame}
              disabled={questions.length === 0}
            >
              🚀 START GAME
            </button>
          </div>
        )}

        {gameState !== "lobby" && (
          <div style={styles.gameArea}>
            {question && gameState !== "voting" && (
              <div style={styles.questionCard}>
                <h2>❓ {question}</h2>
              </div>
            )}

            {/* Player list (no vote buttons here anymore — voting only
                happens in the full-screen overlay) */}
            <div style={styles.playersGrid}>
              {players.map((player) => (
                <div key={player.id} style={styles.playerCard}>
                  <div>
                    {player.name}
                    {player.id === hostId ? " 👑" : ""}
                  </div>
                </div>
              ))}
            </div>

            {winner && gameState === "result" && (
              <div style={styles.result}>🏆 Winner: {winner.name}</div>
            )}

            {gameState === "finished" && (
              <div style={styles.finished}>🎉 Game Finished!</div>
            )}
          </div>
        )}
      </div>

      {/* FULL-SCREEN VOTING OVERLAY */}
      {gameState === "voting" && (
        <div style={styles.overlay}>
          <h1 style={styles.overlayTitle}>🗳️ VOTE NOW</h1>

          {question && <p style={styles.overlayQuestion}>{question}</p>}

          <div style={styles.overlayTimer}>{timer}</div>

          {hasVoted ? (
            <div style={styles.votedBanner}>
              ✅ Vote submitted. Waiting for others...
            </div>
          ) : (
            <div style={styles.overlayPlayersGrid}>
              {players.map((player) => (
                <button
                  key={player.id}
                  style={styles.overlayPlayerButton}
                  onClick={() => vote(player.id)}
                  disabled={hasVoted}
                >
                  {player.name}
                  {player.id === hostId ? " 👑" : ""}
                </button>
              ))}
            </div>
          )}

          {votedFor && (
            <p style={styles.votedForText}>
              You voted for{" "}
              {players.find((p) => p.id === votedFor)?.name || "..."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const styles: any = {
  page: {
    minHeight: "100vh",
    background: "linear-gradient(135deg, #0f172a, #1e293b)",
    color: "white",
    fontFamily: "Arial",
    padding: 20,
  },

  container: {
    maxWidth: 900,
    margin: "0 auto",
  },

  title: {
    textAlign: "center",
    fontSize: 40,
    marginBottom: 5,
  },

  status: {
    textAlign: "center",
    opacity: 0.7,
    marginBottom: 20,
  },

  roomBanner: {
    background: "#15803d",
    padding: 12,
    borderRadius: 10,
    marginBottom: 15,
    textAlign: "center",
    fontWeight: "bold",
    fontSize: 18,
  },

  card: {
    background: "#111827",
    padding: 20,
    borderRadius: 12,
    marginBottom: 20,
  },

  cardHost: {
    background: "#1f2937",
    padding: 20,
    borderRadius: 12,
    marginBottom: 20,
    border: "2px solid #f59e0b",
  },

  input: {
    width: "100%",
    padding: 10,
    marginBottom: 10,
    borderRadius: 8,
    border: "none",
  },

  row: {
    display: "flex",
    gap: 10,
  },

  button: {
    padding: "10px 15px",
    background: "#3b82f6",
    border: "none",
    borderRadius: 8,
    color: "white",
    cursor: "pointer",
    flex: 1,
  },

  buttonAlt: {
    padding: "10px 15px",
    background: "#10b981",
    border: "none",
    borderRadius: 8,
    color: "white",
    cursor: "pointer",
    flex: 1,
  },

  startButton: {
    marginTop: 10,
    width: "100%",
    padding: 15,
    background: "#f59e0b",
    border: "none",
    borderRadius: 10,
    fontSize: 18,
    fontWeight: "bold",
  },

  gameArea: {
    marginTop: 20,
  },

  questionCard: {
    background: "#0ea5e9",
    padding: 20,
    borderRadius: 12,
    marginBottom: 10,
    textAlign: "center",
  },

  playersGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: 10,
  },

  playerCard: {
    background: "#111827",
    padding: 15,
    borderRadius: 10,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },

  questionItem: {
    padding: 8,
    background: "#374151",
    marginTop: 5,
    borderRadius: 6,
  },

  result: {
    marginTop: 20,
    padding: 15,
    background: "#16a34a",
    borderRadius: 10,
    textAlign: "center",
    fontSize: 20,
  },

  finished: {
    marginTop: 20,
    padding: 20,
    background: "#dc2626",
    borderRadius: 10,
    textAlign: "center",
    fontSize: 22,
  },

  // Voting overlay
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.92)",
    display: "flex",
    flexDirection: "column",
    justifyContent: "flex-start",
    alignItems: "center",
    padding: "40px 20px",
    zIndex: 999,
    overflowY: "auto",
  },

  overlayTitle: {
    fontSize: 44,
    marginBottom: 10,
  },

  overlayQuestion: {
    fontSize: 20,
    opacity: 0.85,
    marginBottom: 10,
    textAlign: "center",
    maxWidth: 600,
  },

  overlayTimer: {
    fontSize: 90,
    fontWeight: "bold",
    color: "#facc15",
    marginBottom: 20,
    lineHeight: 1,
  },

  overlayPlayersGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: 14,
    width: "100%",
    maxWidth: 700,
  },

  overlayPlayerButton: {
    padding: "20px 10px",
    background: "#ef4444",
    border: "none",
    borderRadius: 12,
    color: "white",
    fontSize: 18,
    fontWeight: "bold",
    cursor: "pointer",
  },

  votedBanner: {
    marginTop: 10,
    padding: "16px 24px",
    background: "#16a34a",
    borderRadius: 12,
    fontSize: 20,
    fontWeight: "bold",
    textAlign: "center",
  },

  votedForText: {
    marginTop: 16,
    fontSize: 16,
    opacity: 0.8,
  },
};
