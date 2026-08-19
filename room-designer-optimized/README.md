# Room Designer

A 3D interior design tool: place furniture in a 3D room by hand, generate a
layout from a text description (Gemini), detect furniture from a photo
(Google Cloud Vision), or describe a room out loud (ElevenLabs speech-to-text).

## How it's structured, and why

This is two separate programs, not one:

- **`client/`** — the React + Three.js app that runs in your browser. It
  never talks to Gemini/Vision/ElevenLabs directly.
- **`server/`** — a small Express server that holds your API keys and makes
  the actual calls to those services, then hands the result back to the client.

**Why not call the AI APIs straight from the browser?** Any key placed in
frontend code is visible to anyone who opens the browser's dev tools —
they could copy it and rack up charges on your account. Keeping keys in
`server/.env`, on a server only you control, is the standard, correct way
to handle this.

## Setup

### 1. Get your API keys
- **Gemini**: https://aistudio.google.com/app/apikey (free tier available)
- **Google Cloud Vision**: https://console.cloud.google.com/apis/library/vision.googleapis.com
  — enable the API, then create an API key under "Credentials"
- **ElevenLabs**: https://elevenlabs.io/app/settings/api-keys

### 2. Configure the server
```bash
cd server
cp .env.example .env
# open .env and paste in your three keys
npm install
npm run dev
```
Server runs on http://localhost:3001

### 3. Run the client
```bash
cd client
npm install
npm run dev
```
Opens on http://localhost:5173

## What each endpoint does

| Endpoint | Calls | Input | Output |
|---|---|---|---|
| `POST /api/generate-layout` | Gemini | `{ prompt: "a cozy reading corner" }` | array of furniture items with positions |
| `POST /api/detect-furniture` | Cloud Vision | an uploaded image | furniture items placed based on detected labels |
| `POST /api/transcribe` | ElevenLabs | an uploaded audio file | `{ text: "..." }` transcript, feed into generate-layout |

## Costs
All three services have a free tier for light testing, but this is not
free at scale — check each provider's current pricing before heavy use.

## AI + algorithmic layout optimization

The room designer now uses a hybrid approach: AI proposes a semantic furniture arrangement, while a local constraint-based optimizer validates and improves the geometry.

The optimizer considers:
- room boundaries and furniture footprints
- furniture-furniture collisions
- doorway clearance
- spacing between objects
- wall proximity

It uses randomized hill climbing with multiple candidate moves to improve a layout score. This keeps the AI responsible for understanding the user's intent while deterministic code handles spatial correctness.

### Why this architecture?

Instead of trusting an LLM to output perfect coordinates, the LLM provides a useful starting point and the application enforces hard spatial constraints. This makes the system more reliable and gives the project a real algorithms component.
