const BASE_URL = "http://localhost:3001";

export async function generateLayout(prompt) {
  const res = await fetch(`${BASE_URL}/api/generate-layout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) throw new Error((await res.json()).error || "Request failed");
  return (await res.json()).items;
}

export async function detectFurniture(file) {
  const form = new FormData();
  form.append("image", file);
  const res = await fetch(`${BASE_URL}/api/detect-furniture`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error((await res.json()).error || "Request failed");
  return (await res.json()).items;
}

export async function transcribeAudio(file) {
  const form = new FormData();
  form.append("audio", file);
  const res = await fetch(`${BASE_URL}/api/transcribe`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) throw new Error((await res.json()).error || "Request failed");
  return (await res.json()).text;
}
