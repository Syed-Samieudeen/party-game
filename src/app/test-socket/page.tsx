"use client";

import { useEffect, useState } from "react";
import { getSocket } from "@/lib/socket";

export default function TestSocketPage() {
  const [messages, setMessages] = useState<string[]>([]);

  useEffect(() => {
    const socket = getSocket();

    socket.on("connect", () => {
      setMessages((prev) => [...prev, "Connected to server"]);
    });

    socket.on("playerJoined", (data) => {
      setMessages((prev) => [
        ...prev,
        `Player joined: ${data.playerName}`,
      ]);
    });

    return () => {
      socket.off("connect");
      socket.off("playerJoined");
    };
  }, []);

  const joinRoom = () => {
    const socket = getSocket();

    socket.emit("joinRoom", {
      roomCode: "ABC123",
      playerName: "Alice",
    });
  };

  return (
    <div className="p-6 text-white">
      <h1 className="text-2xl font-bold">Socket Test</h1>

      <button
        onClick={joinRoom}
        className="mt-4 px-4 py-2 bg-blue-600 rounded"
      >
        Join Room
      </button>

      <div className="mt-6 space-y-2">
        {messages.map((msg, i) => (
          <div key={i} className="p-2 bg-gray-800 rounded">
            {msg}
          </div>
        ))}
      </div>
    </div>
  );
}
