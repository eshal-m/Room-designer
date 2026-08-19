// Room Designer server
//
// Holds the real API keys (in .env, never sent to the browser) and makes
// the actual calls to Gemini, Google Cloud Vision, and ElevenLabs. The
// client only ever talks to this server, never to those services directly.

import express from "express";
import cors from "cors";
import multer from "multer";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

// Must match the furniture ids/colors/sizes used in client/src/App.jsx
const CATALOG = [
  { id: "sofa", visionLabels: ["couch", "sofa"] },
  { id: "chair", visionLabels: ["chair", "armchair"] },
  { id: "table", visionLabels: ["table", "coffee table", "desk"] },
  { id: "bed", visionLabels: ["bed"] },
  { id: "shelf", visionLabels: ["shelf", "bookcase"] },
];

function randomPosition() {
  const half = 3.5;
  return {
    x: Math.round((Math.random() * 2 - 1) * half * 100) / 100,
    z: Math.round((Math.random() * 2 - 1) * half * 100) / 100,
  };
}

// ---------------------------------------------------------------------
// POST /api/generate-layout
// body: { prompt: string }
// Asks Gemini to turn a text description into a list of furniture items.
// ---------------------------------------------------------------------
app.post("/api/generate-layout", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Missing prompt" });

  const validIds = CATALOG.map((c) => c.id).join(", ");
  const systemPrompt = `You design furniture layouts for a small 8x8 room, centered at (0,0).
Respond with ONLY a JSON array, no prose, no markdown fences. Each item:
{"typeId": one of [${validIds}], "x": number between -3.5 and 3.5, "z": number between -3.5 and 3.5}
User's request: ${prompt}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: systemPrompt }] }],
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: "Gemini request failed", detail: errText });
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";

    // Gemini sometimes wraps JSON in ```json fences despite instructions --
    // strip those before parsing.
    const cleaned = rawText.replace(/```json|```/g, "").trim();
    let items;
    try {
      items = JSON.parse(cleaned);
    } catch {
      return res.status(502).json({ error: "Could not parse Gemini's response as JSON", raw: rawText });
    }

    const validItems = items
      .filter((it) => CATALOG.some((c) => c.id === it.typeId))
      .map((it, i) => ({ id: Date.now() + i, typeId: it.typeId, x: it.x ?? 0, z: it.z ?? 0 }));

    res.json({ items: validItems });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------
// POST /api/detect-furniture
// form-data field: "image"
// Sends the image to Cloud Vision's label detection, maps recognized
// labels onto our furniture catalog, places matches at random spots.
// ---------------------------------------------------------------------
app.post("/api/detect-furniture", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Missing image file" });

  const base64Image = req.file.buffer.toString("base64");

  try {
    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${process.env.GOOGLE_VISION_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [
            {
              image: { content: base64Image },
              features: [{ type: "LABEL_DETECTION", maxResults: 15 }],
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: "Cloud Vision request failed", detail: errText });
    }

    const data = await response.json();
    const labels = (data.responses?.[0]?.labelAnnotations ?? []).map((l) =>
      l.description.toLowerCase()
    );

    const matched = [];
    CATALOG.forEach((entry) => {
      const found = entry.visionLabels.some((label) => labels.includes(label));
      if (found) matched.push(entry.id);
    });

    const items = matched.map((typeId, i) => ({
      id: Date.now() + i,
      typeId,
      ...randomPosition(),
    }));

    res.json({ items, detectedLabels: labels });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------
// POST /api/transcribe
// form-data field: "audio"
// Sends audio to ElevenLabs speech-to-text, returns the transcript text
// so the client can feed it straight into /api/generate-layout.
// ---------------------------------------------------------------------
app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Missing audio file" });

  try {
    const form = new FormData();
    form.append(
      "file",
      new Blob([req.file.buffer], { type: req.file.mimetype }),
      req.file.originalname
    );
    form.append("model_id", "scribe_v1");

    const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY },
      body: form,
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({ error: "ElevenLabs request failed", detail: errText });
    }

    const data = await response.json();
    res.json({ text: data.text ?? "" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Room Designer server running on http://localhost:${PORT}`);
});
