const BASE_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

export async function createRoom(name: string) {
  const res = await fetch(`${BASE_URL}/room/create`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name }),
  });

  return res.json();
}
