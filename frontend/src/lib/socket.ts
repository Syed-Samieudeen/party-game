import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export const getSocket = () => {
  if (!socket) {
    console.log("🔌 Connecting socket...");

    socket = io("http://localhost:3000", {
      transports: ["websocket"],
    });

    socket.on("connect", () => {
      console.log("✅ SOCKET CONNECTED:", socket.id);
    });

    socket.on("connect_error", (err) => {
      console.log("❌ SOCKET ERROR:", err.message);
    });
  }

  return socket;
};
