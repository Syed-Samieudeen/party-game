import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

export const getSocket = () => {
  if (!socket) {
    const url = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3000";

    console.log("🔌 Connecting socket to:", url);

    const newSocket = io(url, {
      transports: ["websocket"],
    });

    newSocket.on("connect", () => {
      console.log("✅ SOCKET CONNECTED:", newSocket.id);
    });

    newSocket.on("connect_error", (err) => {
      console.log("❌ SOCKET ERROR:", err.message);
    });

    socket = newSocket;
  }

  return socket;
};
