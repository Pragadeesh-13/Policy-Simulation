# LLM Council

LLM Council is a multi-agent policy simulation platform where Indian state representatives debate a user-provided policy in structured rounds. Each state is modeled as an AI council member with its own political context, priorities, and debate stance. The system then produces a final synthesis of the debate, including a verdict and state-level impact assessment.

## What this project does

The application accepts a policy description from the user and runs an orchestrated council session.

During a session:

- A moderator frames the policy topic.
- State agents produce position statements based on predefined profiles.
- The moderator narrows the panel to the most affected states.
- Selected states debate, rebut, and defend positions.
- The system emits round summaries and a final council outcome.
- A map view highlights state-level positive or negative impact.

This creates an interactive "federal policy stress test" where one policy is evaluated from multiple regional perspectives.

## Simulation model

The council follows a staged pipeline managed on the server:

1. **Round 0: Impact Declarations**
   - All configured states declare how the policy affects them.
2. **Panel Selection**
   - The moderator chooses the most strongly affected states (`PANEL_SIZE`).
3. **Round 1: Opening Statements**
   - Selected panel states deliver structured arguments.
4. **Rebuttal Selection**
   - The moderator picks high-conflict participants (`REBUTTAL_SIZE`).
5. **Rebuttal Round**
   - Chosen states challenge opposing arguments.
6. **Summary and Verdict**
   - The system generates a concise council summary and a final outcome.
   - Impact assessment marks states as positive/negative beneficiaries.

Round progression can be user-gated through explicit "begin round" actions, so the UI can control pacing.

## Agent design

Each state agent is defined with:

- Political alignment / party context
- Ideological orientation
- Primary economic or governance focus
- Debate stance constraints

These profiles are used in prompt construction to produce consistent, state-specific behavior across rounds.

A moderator role is also modeled to:

- Select panel participants
- Choose rebuttal participants
- Summarize rounds
- Produce final verdict JSON (with fallback logic if model output is malformed)

## Real-time interaction model

The frontend subscribes to a server-sent event stream (`/api/stream`) and renders the simulation live.

Streamed events include:

- Topic and feed updates
- Round lifecycle signals
- Incremental agent message chunks
- Round summaries
- Panel/rebuttal selection decisions
- Final council end payload (summary + impacts)

This design keeps the interface responsive while long-form model responses are generated.

## LLM routing strategy

The backend supports two model providers through one orchestration layer:

- **LM Studio-compatible OpenAI endpoint**
- **Ollama**

The provider is selected by configuration (`LM_PROVIDER`). Message generation supports both standard responses and streaming token output.

Additional output handling includes:

- Sanitization of model artifacts
- JSON extraction from mixed model output
- Thought-tag buffering behavior during streams
- Safe fallbacks when a model response fails validation

## Product surface

The project includes three primary user surfaces:

- **Authentication pages** (`login.html`, `signup.html`)
  - Email/password sign-up and login
  - Optional Google sign-in via Firebase Web SDK
- **Main council dashboard** (`index.html`)
  - Policy input panel
  - Live deliberation feed
  - Round controls and moderator/system notes
  - India map visualization with state impact highlighting
- **Server API** (`server.js`)
  - Session orchestration, auth endpoints, SSE feed, and static file serving

## Data and identity model

User identity is handled through Firebase:

- Firebase Authentication for account management and login verification
- Firestore for user profile metadata (username/email lookups, profile records)

The backend keeps local in-memory caches for profile lookups to reduce repetitive reads and provide fallback behavior if a database operation fails.

## API contract (project behavior)

Core endpoints exposed by the server:

- `GET /api/stream` — live event stream for council simulation
- `POST /api/next` — start a new simulation from a user policy query
- `POST /api/round/begin` — mark a specific round as ready to continue
- `GET /api/policy` — return the latest policy currently in context
- `POST /api/auth/signup` — create user account and profile
- `POST /api/auth/login` — authenticate user and return profile payload

A manual trigger endpoint is also available for direct council execution (`/api/trigger`).

## Technical profile

- Runtime: Node.js HTTP server (no Express)
- Frontend: Vanilla JavaScript, HTML, CSS
- Mapping: Leaflet + shapefile parsing (`shpjs` in browser)
- Realtime: Server-Sent Events
- AI orchestration: Prompt-driven multi-agent sequencing in `server.js`

## Project intent

LLM Council is built as a simulation engine rather than a chatbot. Its core value is structured conflict, comparative reasoning, and transparent round-based progression across multiple AI personas representing different regional priorities.
