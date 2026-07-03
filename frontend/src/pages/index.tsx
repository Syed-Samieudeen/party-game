import { useRouter } from "next/router";

export default function Home() {
  const router = useRouter();

  return (
    <div style={{ padding: 20 }}>
      <h1>🎮 Party Game</h1>

      <button onClick={() => router.push("/test-socket")}>
        Go to Lobby
      </button>
    </div>
  );
}
