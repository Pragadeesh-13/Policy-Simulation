# Agentic Council — Project Documentation

**Short summary**
- Interactive demo that takes policy input, runs a multi‑state "council" deliberation using a local LLM (LM Studio), and streams real‑time UI updates (map + council cards) via Server‑Sent Events (SSE).

---

## Quick start ✅
1. Install & run:
   - npm install (if you add deps) — project is minimal; start with:
   - npm start
2. Open: http://localhost:3000 (or the port in `PORT` env).
3. Configure environment (recommended):
  - set `LMSTUDIO_URL` and `LMSTUDIO_API_KEY` if required by your LM Studio instance.
  - optional: `LM_MODEL`, `PANEL_SIZE`, `REBUTTAL_SIZE`, `COUNCIL_STATES`, `PORT`.
4. Quick test endpoints:
   - Manual trigger: GET /api/trigger?title=Test
   - Start next story: POST /api/next { query }
   - SSE stream: open /api/stream in browser (EventSource).

> ⚠️ Do not commit real API keys. Use environment variables for production.

---

## Architecture overview 🔧
- Front-end: `index.html`, `app.js`, `styles.css` — UI, Leaflet map, SSE client, replay/streaming UI.
- Back-end: `server.js` — static server + orchestration, policy summarizer (LM Studio), SSE push.
- Communication: Server‑Sent Events (`/api/stream`) for live updates; REST for control (`/api/next`, `/api/round/begin`, `/api/trigger`).
- LLM integration: calls to LM Studio (`callLmStudio` and streaming `callLmStudioStream`) to run agent prompts.

---

## File map (what each file does)
- `index.html` — single‑page UI; includes Leaflet and shpjs and loads `app.js`.
- `styles.css` — complete UI styling and responsive layout.
- `app.js` — all front-end logic:
  - loads India shapefile, renders states with Leaflet
  - UI: feed panel, deliberation panels, agent cards, round controls
  - connects to SSE `/api/stream`, reacts to events (agent, system, round_start, etc.)
  - provides controls: Begin Simulation (`/api/next`) and round begin (`/api/round/begin`).
- `server.js` — server + orchestration:
  - Policy summarization for user input using LM Studio
  - Council pipeline (`runCouncil`) implementing rounds 0–4
  - LLM prompt builders and streaming handlers
  - SSE endpoint `/api/stream` and REST endpoints
- `package.json` — start script (`node server.js`).

---

## Important server endpoints (quick reference)
- GET `/api/stream` — Server‑Sent Events; UI subscribes to it.
- POST `/api/next` — summarize user policy input and start council flow.
- POST `/api/round/begin` — user signals to begin a waiting round (used to step through rounds manually).
- GET `/api/trigger?title=...` — manual story trigger for testing.
- GET `/api/news` — returns the latest policy summary object.

---

## The council pipeline (how debates proceed) — numbered steps
1. Round 0 — Impact Declarations: every state agent gives a 1–2 sentence impact declaration.
2. Selection — Moderator chooses a panel of `PANEL_SIZE` states from declarations.
3. Round 1 — Opening statements: panel states make opening arguments.
4. Round 2 — Rebuttals: `REBUTTAL_SIZE` states selected to rebut.
5. Round 3 — Right of Reply: single state replies.
6. Round 4 — Verdict & Summary: a short summary and a JSON verdict (winner/loser).

- Implementation details:
  - Prompts are generated in `server.js` (functions: `buildImpactPrompt`, `buildOpeningPrompt`, `buildRebuttalPrompt`, etc.).
  - The server streams agent output via `agent_start` / `agent_delta` / `agent_end` SSE events.
  - Thought buffering: model output may include `<thought>` blocks — server buffers inner thoughts and only exposes public text until thought is closed.
  - Summaries and verdicts use dedicated summarization calls and fallback heuristics if LLM output cannot be parsed.
- New: An Impact Assessment Agent (runs at the end of the debate) returns `positive` and `negative` state lists. The UI highlights those states on the map and shows a short impact note instead of the old winner/loser labels.

---

## Front-end behaviors & events (ui highlights)
- Map: Leaflet renders India states from a remote shapefile; states are colored/animated depending on `positive` / `negative` impacts.
- SSE events handled by `connectLiveStream()` in `app.js` include: `topic`, `feed`, `council_start`, `system`, `round_start`, `panel_selected`, `agent_start`, `agent_delta`, `agent_end`, `council_end`, etc.
- UI controls:
  - `Begin Simulation` (triggers `/api/next`)
  - Round begin buttons (POST `/api/round/begin`) to step rounds manually — these now appear only after the system messages for that round finish streaming
  - Feed cards and clickable story links
  - Rounds no longer auto-navigate: the UI will mark the `current` round but the user must click the round tab or use the `Go to current round` control to view it.
- Visuals: agent cards (team colors), system notes (streaming text), and an interactive map that highlights the active state.
  - System-note loading spinners are cleared automatically once a streaming system message finishes to avoid indefinite spinners.
  - When a round starts the UI shows a 5‑second "Moderator is analysing..." hold before the round tab becomes visible. During that hold and while the system streams its messages:
  - the **Council Orchestrator** card shows "Waiting for system instructions..." with a loading state,
  - the `View round N • Current` tab appears only after the 5‑second hold,
  - the `Begin round N` control remains disabled (pointer forbidden) until all system messages finish streaming.
  - UI polish: the animated conic-gradient border is now suppressed on the `topic` pill when in compact mode, and it is disabled for the "Go to current round" button. The `current` round tab no longer shows the blue outline (keeps a subtle neutral border + animated rim).

---

## Configuration & important env vars
- LMSTUDIO_URL — base URL for LM Studio (default: `http://127.0.0.1:1234`)
- LMSTUDIO_API_KEY — optional API key for LM Studio
- LM_MODEL — model identifier used by LM Studio (default in code: `qwen/qwen3-8b`)
- LMSTUDIO_STREAM — set `false` to disable streaming responses
- PANEL_SIZE — number of panel states (default ≈ 5)
- REBUTTAL_SIZE — number of rebuttal participants (default ≈ 3)
- FIREBASE_PROJECT_ID — Firebase project ID (needed when not using ADC)
- FIREBASE_CLIENT_EMAIL — service account client email
- FIREBASE_PRIVATE_KEY — service account private key (use escaped `\\n` in `.env`)
- FIREBASE_SERVICE_ACCOUNT_JSON — full service-account JSON string (alternative to split vars)
- FIREBASE_SERVICE_ACCOUNT_PATH — absolute path to service-account JSON file (alternative to split vars)
- FIREBASE_WEB_API_KEY — Firebase Web API key used by backend login (`signInWithPassword`)
- FIREBASE_USERS_COLLECTION — Firestore collection for user profiles (default: `users`)

Set variables in your shell before `npm start`, e.g. (Windows PowerShell):

$env:LMSTUDIO_URL = "http://127.0.0.1:1234"; npm start

---

## How LLM calls are handled
- Two modes:
  - Non‑streaming: `callLmStudio` — single completion returned, server emits `agent` SSE event.
  - Streaming: `callLmStudioStream` — server reads stream, emits incremental `agent_delta` events; `agent_start` and `agent_end` mark boundaries.

- Summarizer agents tuned: the Round Summary Agent uses a refined prompt and a larger token budget (up to 220 tokens); the Council Summary Agent uses an expanded prompt and up to 300 tokens — this improves coherence and can include an optional actionable takeaway.

- The server expects model outputs occasionally wrapped with `<thought>`...</thought>; these blocks are suppressed from public streaming until closed.
- Prompts enforce JSON‑only replies for selection stages; server attempts to parse and falls back to heuristics if parsing fails.

---

## How to test locally
1. Ensure LM Studio (or compatible endpoint) is reachable and configured.
2. Ensure your LM Studio endpoint is running.
3. Start server: `npm start`.
4. Open UI, enter policy details, and press `Begin Simulation`.
5. Watch SSE events in browser DevTools Network or inspect console logs.

---

## Known limitations & suggested improvements 💡
- No auth on server endpoints — add simple auth for exposed deployments.
- Add input validation and size limits for user-provided policy text.
- Add unit/integration tests for prompt parsing and verdict fallback logic.
- Harden parsing of LLM JSON outputs (more robust sanitization and fallback).
- Provide Dockerfile or compose to spin up LM Studio + app for reproducible dev environment.

---

## Where to look in the code (quick pointers)
- Map & SVG glow: `app.js` → `addGlowFilter()` and Leaflet `stateLayer` usage.
- Event streaming & UI updates: `app.js` → `connectLiveStream()` and `upsertAgentStreamMessage()`.
- Council orchestration & prompts: `server.js` → `runCouncil()` and `build*Prompt()` functions.
- LLM streaming buffer & thought handling: `server.js` → `streamAgentMessage()`.

---

If you'd like, I can:
1. Add this as `DOCUMENTATION.md` in the repo (done). ✅
2. Create a short README with run / env examples. 🔧
3. Extract and document the prompt templates to separate files for easier editing. ✂️

Tell me which of the follow‑ups you want next.