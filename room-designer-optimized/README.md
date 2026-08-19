# Room Designer

A 3D interior design tool: place furniture in a 3D room by hand, generate a
layout from a text description (Gemini), detect furniture from a photo
(Google Cloud Vision), or describe a room out loud (ElevenLabs speech-to-text).


This is two separate programs, not one:

- **`client/`** — the React + Three.js app that runs in your browser. It
  never talks to Gemini/Vision/ElevenLabs directly.
- **`server/`** — a small Express server that holds your API keys and makes
  the actual calls to those services, then hands the result back to the client.


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

