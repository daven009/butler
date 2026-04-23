# Technical Solution: Butler — Tour Planning Platform

## Purpose of This Document

This file is the technical handoff for future coding agents and planning agents.

It answers three questions:

1. What has already been built in this repo?
2. What is the real architecture and tech stack?
3. What should be built next, and in what order?

Maintenance rule: after any significant architectural, data-model, API, persistence, routing, or workflow change, update this file in the same turn.

Product spec reference: `功能规格_智能搜房与看房行程规划.md` (located in user's Downloads, not in repo). Design system reference: `BUTLER.md`.

---

## Current Product Direction

Butler is a tour-planning platform for independent property agents in Singapore. The core workflow:

1. Agent creates a Tour (plan) for a buyer/tenant client.
2. Agent searches for listings (conversational AI search with tag engine).
3. Buyer confirms interested listings + available time slots via a no-login link.
4. Agent reviews AI-suggested geographic groupings and triggers coordination.
5. AI contacts all opposing agents via WhatsApp (using the agent's own business number via Cloud API).
6. AI collects availability, performs global schedule optimization, negotiates precise times.
7. Exceptions surface as decision cards for human review.
8. Final itinerary is generated and shared to buyer via WhatsApp.

Current stage: **High-fidelity UI prototype complete + backend REST API complete through scheduling. WhatsApp and AI integration not yet started.**

---

## Architecture Overview

The project is a **two-service split**: a Vite React SPA (frontend) and a standalone Express TypeScript API (backend). This is NOT a Next.js monolith — the old `technical_solution.md` was wrong about that.

```
appointment_scheduler/
├── frontend/          # Vite + React 18 SPA (JSX, not TypeScript)
│   ├── src/
│   │   ├── App.jsx           # React Router v6, all routes
│   │   ├── screens/          # 14 page components
│   │   ├── components/       # Shared UI (iOS-style frame, nav, keyboard, etc.)
│   │   ├── context/          # ButlerContext — global state via React Context
│   │   ├── lib/              # api.js (HTTP client), adapters.js (data transforms)
│   │   ├── data.js           # Static demo data for search prototype
│   │   └── styles.css        # Global styles, inline styles in components
│   ├── index.html
│   └── package.json
├── backend/           # Express 4 + TypeScript API
│   ├── src/
│   │   ├── server.ts         # All route handlers (single file)
│   │   ├── lib/
│   │   │   ├── types.ts          # Domain model types
│   │   │   ├── mockData.ts       # Seed data
│   │   │   ├── store.ts          # JSON file read/write helpers
│   │   │   ├── http.ts           # Error response helpers
│   │   │   ├── butlerCatalog.ts  # Static listing catalog for search
│   │   │   ├── api/
│   │   │   │   └── validation.ts # Request validation
│   │   │   ├── repositories/
│   │   │   │   ├── toursRepository.ts
│   │   │   │   ├── butlerRepository.ts   # Threads, exceptions, inbox, itinerary, search
│   │   │   │   ├── clientsRepository.ts
│   │   │   │   └── settingsRepository.ts
│   │   │   └── scheduling/
│   │   │       └── scheduler.ts  # Deterministic greedy scheduler v1
│   │   └── data/
│   │       └── tours.json    # Seed data (bundled, not runtime)
│   ├── data/                 # Runtime JSON persistence (gitignored)
│   │   ├── tours.json
│   │   ├── butler.json
│   │   ├── clients.json
│   │   └── settings.json
│   └── package.json
├── frontend.backup-*/  # Old Next.js codebase (archived, do not use)
├── BUTLER.md           # Design system spec
├── README.md
└── technical_solution.md  # This file
```

---

## Runtime and Scripts

### Frontend

```json
{
  "name": "butler-tour-planner",
  "type": "module",
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.0",
    "vite": "^5.4.0"
  }
}
```

```bash
cd frontend && npm run dev    # Vite dev server on http://localhost:5173
cd frontend && npm run build  # Production build to frontend/dist/
```

### Backend

```json
{
  "name": "butler-backend",
  "type": "module",
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.21.2"
  },
  "devDependencies": {
    "tsx": "^4.20.6",
    "typescript": "^5.9.3"
  }
}
```

```bash
cd backend && npm run dev     # tsx watch on http://localhost:8787
cd backend && npm run build   # tsc to backend/dist/
```

### Running Together

```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd frontend && npm run dev
```

Frontend `api.js` sends all `/api/*` requests to `http://localhost:8787`.

---

## Frontend Routes (14 pages)

| Path | Component | Description |
|------|-----------|-------------|
| `/` | `Onboarding` | 3-step welcome + WhatsApp connect flow (first-time only) |
| `/home` | `Home` | Tours list — greeting, "Start a new tour" entry, tour cards with progress |
| `/schedule` | `Schedule` | Calendar month view + day detail for confirmed viewings |
| `/search` | `Search` | Conversational AI search — voice/typed/URL input, tag engine, listing results |
| `/tour` | `TourDetail` | Tour detail — listings grouped by area, scheduling preferences bottom sheet |
| `/chat` | `Chat` | Thread view — message bubbles, AI/human ownership toggle, take-over button |
| `/decision` | `DecisionCard` | Exception decision card — 3-choice resolution (squeeze in / repropose / drop) |
| `/itinerary` | `Itinerary` | Route map + timeline + WhatsApp share button |
| `/buyer` | `BuyerView` | Agent-side share flow — select client, share shortlist link via WhatsApp |
| `/client` | `Client` | Client book list with search |
| `/client/new` | `ClientDetail` | New client form |
| `/client/:clientId` | `ClientDetail` | Client detail/edit with linked tour card |
| `/notifications` | `Notifications` | Inbox — prioritized notifications and decision cards |
| `/settings` | `Settings` | AI tone, rhythm, automation toggles, WhatsApp status, profile |

All pages render inside a `PhoneFrame` component (iOS device simulator). UI uses iOS-style components: `IOSStatusBar`, `IOSNavBar`, `IOSKeyboard`, `IOSList`, `IOSGlassPill`.

Bottom navigation: `Tours | Schedule | [+] | Client | Inbox`

### Frontend State Management

`ButlerContext` (React Context + `useReducer`-style) is the single global store. It fetches all data on mount via `refreshApp()`:

- `tours` / `tourCards` — all tours with summary adapters
- `activeTour` / `activeTourId` — currently selected tour
- `clients` — client book
- `inboxItems` — inbox notifications
- `profile` / `settings` — user profile and AI settings
- `threadsByTour` / `activeThreadId` — chat threads per tour
- `exceptionsByTour` — exceptions per tour

### Frontend Data Layer

`lib/api.js` exports API clients:
- `toursApi` — CRUD tours, listings, buyer availability, opposing availability, coordination events, threads, exceptions, itinerary, schedule generation
- `clientsApi` — CRUD clients
- `inboxApi` — list inbox, mark read
- `settingsApi` — get/update profile and settings
- `searchApi` — parse input, import link, search results

`lib/adapters.js` transforms backend shapes into UI-friendly shapes (tour cards, threads, etc.).

---

## Backend API Endpoints

Base URL: `http://localhost:8787`

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |

### Tours

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tours` | List tour summaries |
| POST | `/api/tours` | Create tour |
| GET | `/api/tours/:id` | Get tour detail |
| PATCH | `/api/tours/:id` | Update tour basics |
| POST | `/api/tours/:id/generate-schedule` | Generate schedule (Scheduler v1) |

### Listings

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/tours/:id/listings` | Add listing to tour |
| PATCH | `/api/tours/:id/listings/:listingId` | Update listing |
| DELETE | `/api/tours/:id/listings/:listingId` | Remove listing |
| PATCH | `/api/tours/:id/listings/:listingId/status` | Update listing coordination status |

### Buyer Availability

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tours/:id/buyer-availability` | List buyer availability |
| POST | `/api/tours/:id/buyer-availability` | Add availability slot |
| PUT | `/api/tours/:id/buyer-availability` | Replace all availability |
| PATCH | `/api/tours/:id/buyer-availability/:availabilityId` | Update slot |
| DELETE | `/api/tours/:id/buyer-availability/:availabilityId` | Delete slot |

### Opposing Agent Availability

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tours/:id/listings/:listingId/opposing-availability` | List |
| POST | `/api/tours/:id/listings/:listingId/opposing-availability` | Add |
| PUT | `/api/tours/:id/listings/:listingId/opposing-availability` | Replace all (scoped to listing) |
| PATCH | `/api/tours/:id/listings/:listingId/opposing-availability/:availabilityId` | Update |
| DELETE | `/api/tours/:id/listings/:listingId/opposing-availability/:availabilityId` | Delete |

### Coordination Events

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tours/:id/listings/:listingId/coordination-events` | List events |
| POST | `/api/tours/:id/listings/:listingId/coordination-events` | Create event |
| PATCH | `/api/tours/:id/listings/:listingId/coordination-events/:eventId` | Update event |
| DELETE | `/api/tours/:id/listings/:listingId/coordination-events/:eventId` | Delete event |

### Threads (Chat)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tours/:id/threads` | List threads for tour |
| GET | `/api/tours/:id/threads/:threadId` | Get thread |
| GET | `/api/tours/:id/threads/:threadId/messages` | Get messages |
| POST | `/api/tours/:id/threads/:threadId/messages` | Send message |
| PATCH | `/api/tours/:id/threads/:threadId/ownership` | Toggle AI/HUMAN ownership |

### Exceptions (Decision Cards)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tours/:id/exceptions` | List exceptions |
| GET | `/api/tours/:id/exceptions/:exceptionId` | Get exception |
| POST | `/api/tours/:id/exceptions/:exceptionId/resolve` | Resolve (SQUEEZE_IN / REPROPOSE / DROP_LISTING) |

### Calendar

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/calendar?month=YYYY-MM` | Month view |
| GET | `/api/calendar/day?date=YYYY-MM-DD` | Day view |

### Itinerary

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tours/:id/itinerary` | Get itinerary |
| POST | `/api/tours/:id/itinerary/share` | Share via WhatsApp (stub) |
| POST | `/api/tours/:id/itinerary/export` | Export PDF (stub) |

### Search

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/search/parse` | Parse text input into tags (regex, not AI) |
| POST | `/api/search/import-link` | Import PropertyGuru link (stub) |
| POST | `/api/search/results` | Search listing catalog by tags |

### Clients

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/clients` | List clients |
| POST | `/api/clients` | Create client |
| GET | `/api/clients/:clientId` | Get client |
| PATCH | `/api/clients/:clientId` | Update client |
| DELETE | `/api/clients/:clientId` | Delete client |

### Settings & Profile

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/me` | Get profile |
| PATCH | `/api/me` | Update profile |
| GET | `/api/settings` | Get settings |
| PATCH | `/api/settings` | Update settings |

### Inbox

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/inbox` | List inbox items |
| PATCH | `/api/inbox/:itemId/read` | Mark read |

---

## Domain Model

Defined in `backend/src/lib/types.ts`.

### Core Types

- `Tour` — the top-level plan container. Owns listings, buyer availability, opposing availability, schedule items, exception cards, coordination events.
- `TourListing` — one property in a tour. Tracks opposing agent info, coordination status.
- `BuyerAvailability` — buyer's available time windows (date + start/end time + preference).
- `OpposingAgentAvailability` — opposing agent's available slots per listing.
- `CoordinationEvent` — audit log entry for each coordination step (messages, status changes, notes).
- `ScheduleItem` — proposed itinerary entry with start/end times.
- `ExceptionCard` — a listing that needs human decision.
- `Agent` — the agent using the platform.
- `ClientProfile` — buyer/tenant profile data.

### Tour Statuses

```ts
type TourStatus =
  | 'DRAFT'
  | 'PLANNING'
  | 'COORDINATING'
  | 'READY_TO_SCHEDULE'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'CANCELLED';
```

### Tour Listing Statuses

```ts
type TourListingStatus =
  | 'NOT_CONTACTED'
  | 'WAITING_REPLY'
  | 'AVAILABLE_SLOTS_RECEIVED'
  | 'UNAVAILABLE'
  | 'NEEDS_REVIEW'
  | 'SCHEDULED'
  | 'CANCELLED';
```

### Thread Ownership

```ts
type ThreadOwnership = 'AI' | 'HUMAN';
```

Each opposing-agent conversation thread has an `ownership` field. When `AI`, the system handles replies automatically. When `HUMAN`, the agent manages the conversation directly via dashboard. The agent can toggle ownership at any time.

---

## Persistence

**Local JSON file storage** via `backend/src/lib/store.ts`.

Runtime files in `backend/data/` (gitignored):

| File | Contents |
|------|----------|
| `tours.json` | All tours, listings, availability, schedule, exceptions, coordination events |
| `butler.json` | Thread state, inbox items, share records |
| `clients.json` | Client book |
| `settings.json` | User profile, AI settings |

`store.ts` provides `readJsonFile()` and `writeJsonFile()` with lazy initialization from seed data.

**Limitations:**
- Not safe for concurrent writes
- No transaction layer
- IDs generated with `crypto.randomUUID()` + short prefixes
- Must be replaced with Postgres before production

---

## Scheduling Module

`backend/src/lib/scheduling/scheduler.ts` — deterministic greedy Scheduler v1.

Behavior:
- Only `AVAILABLE_SLOTS_RECEIVED` listings are schedulable
- Candidate windows = overlap of buyer availability and opposing agent slots
- Start times rounded up to 15-minute increments
- Default viewing duration: 30 minutes
- Default travel buffer: 15 minutes (different address), 0 minutes (same address)
- First scheduled item per day gets 0 travel buffer
- Items sorted by start time → end time → title → id
- Once scheduled, a listing is not scheduled again
- Output items have status `PROPOSED`

Time handling: Singapore local time (`+08:00`). No external date library.

---

## What EXISTS But Is NOT Real

These features exist in the UI and/or data model but have NO actual implementation behind them:

| Feature | Current State | What's Missing |
|---------|--------------|----------------|
| WhatsApp messaging | Data model has `WHATSAPP` source enum, UI shows connect status | No WhatsApp Cloud API integration, no webhook, no token exchange |
| AI chat responses | Thread UI shows AI/HUMAN toggle, demo messages | No LLM integration, no response generation |
| Search AI parsing | Tags are generated by regex pattern matching | No LLM, no PropertyGuru API, no Google Maps |
| Voice transcription | Microphone icon in search UI | No Whisper/STT integration |
| Itinerary sharing | "Share via WhatsApp" button, share records | Only records the share event, doesn't actually send |
| PDF export | Export button | Returns stub response |
| AI settings (tone, disclosure, etc.) | Settings UI with toggles | Settings are stored but consumed by nothing |

---

## What Needs to Be Built — Development Roadmap

### Assumptions

- We can obtain the user's WhatsApp Business account OAuth token (via Embedded Signup or manual configuration — not our concern now).
- Given a valid token, we can call WhatsApp Cloud API to send/receive messages on the agent's behalf.
- LLM integration will use Claude or GPT via API.

### Phase 1: WhatsApp Message Pipeline (Foundation)

**Goal:** Given a WhatsApp Business OAuth token, the backend can send and receive WhatsApp messages.

```
1.1  WhatsApp service module
     - POST /send-message: send text or template message via Cloud API
     - Webhook handler: receive inbound messages, status updates
     - Token storage: store per-agent OAuth token (env var for now, DB later)
     - Message queuing: simple in-memory queue with retry

1.2  Wire WhatsApp to coordination events
     - When a coordination event is created with source=WHATSAPP,
       actually send the message via Cloud API
     - When a webhook delivers an inbound message,
       create a coordination event + update thread

1.3  Thread ↔ WhatsApp mapping
     - Each thread tracks the opposing agent's WhatsApp number
     - Inbound messages are routed to the correct thread by phone number
     - Thread messages page shows real WhatsApp messages (not just seed data)
```

Deliverable: You can start the backend, configure a WhatsApp Business token, and send/receive real WhatsApp messages that appear in the Chat UI.

### Phase 2: AI Coordination Agent (Core Product)

**Goal:** AI autonomously runs the multi-step coordination dialogue per the product spec.

```
2.1  LLM integration module
     - Wrapper around Claude/GPT API
     - Prompt templates for each coordination step
     - Structured output parsing (availability slots, yes/no, intent classification)

2.2  Coordination state machine (per listing)
     - States: NOT_CONTACTED → CONFIRMING_AVAILABILITY → INTRODUCING_PROFILE
       → COLLECTING_SLOTS → NEGOTIATING → CONFIRMED / NEEDS_REVIEW
     - Each state transition triggers the appropriate WhatsApp message
     - Inbound messages advance the state machine
     - Unrecognized replies → fallback to NEEDS_REVIEW + decision card

2.3  Reply parsing
     - LLM parses natural language replies ("can tmr 2pm", "saturday morning lah")
     - Extracts: availability slots, yes/no, questions, unclear intent
     - Low-confidence parses → ask for clarification or escalate

2.4  Timer-based follow-ups
     - 24h no reply → send follow-up message
     - 48h no reply → stop AI, create exception card
     - Configurable per-agent via settings

2.5  Human takeover
     - When agent toggles thread to HUMAN, AI stops sending
     - Agent sends messages via dashboard, they go out as WhatsApp
     - Agent can toggle back to AI
```

Deliverable: "Start AI Schedule" button on Tour Detail triggers real AI coordination. AI sends WhatsApp messages, parses replies, advances state, creates exceptions when stuck.

### Phase 3: Global Schedule Optimization

**Goal:** Once availability is collected, produce an optimized itinerary.

```
3.1  Scheduler v2
     - Input: buyer availability + all opposing agent slots + listing addresses
     - Geographic clustering (same-area groupings)
     - Global optimization: maximize listings-per-block, minimize travel
     - Travel time: Google Maps Distance Matrix API (real driving times)
     - Output: proposed schedule + unscheduled listings with reasons

3.2  Precise time confirmation
     - After optimization, AI sends precise time proposals to each opposing agent
     - Opposing agent confirms or counter-proposes
     - Counter-proposals within same block → auto-adjust
     - Counter-proposals crossing blocks → exception card

3.3  Buyer confirmation flow
     - After all opposing agents confirmed, generate buyer link
     - Buyer sees optimized itinerary overview, selects preferred option
     - Buyer confirmation locks the schedule
```

### Phase 4: Search & Discovery

**Goal:** Replace static search with real property data.

```
4.1  PropertyGuru integration
     - URL parsing: extract query params from PG URLs
     - API scraping: fetch listing data
     - Listing card enrichment with real property data

4.2  AI-powered search
     - LLM converts natural language → structured search params + semantic tags
     - Tag engine: structured tags (price, rooms, area) + semantic tags (pet-friendly, modern reno)
     - Two-layer pipeline: structured filter → AI semantic analysis

4.3  MOE school data
     - School coordinates database
     - 1km / 2km enrollment circle calculation

4.4  Google Maps enrichment
     - Commute time to specified workplace
     - Walking time to nearest MRT
```

### Phase 5: External-Facing Links (No-Login Pages)

**Goal:** Buyer and opposing agent can interact via shared links without accounts.

```
5.1  Buyer shortlist confirmation page
     - No-login H5 page
     - View shortlisted listings, mark interested ones
     - Select available time slots
     - Submit → data flows into tour

5.2  Opposing agent time selection page
     - No-login H5 page
     - View available time slots for the listing
     - Select multiple slots
     - Submit → updates opposing agent availability

5.3  Link lifecycle management
     - Links are active until agent triggers coordination
     - After coordination starts, links become read-only
     - Agent can re-open links by pausing coordination
```

### Phase 6: Production Readiness

```
6.1  Database migration: JSON → Postgres (Prisma or Drizzle)
6.2  Authentication: agent login
6.3  Multi-tenancy: data isolation per agent
6.4  WhatsApp Embedded Signup: let agents connect their own WA Business accounts
6.5  Deployment configuration
6.6  Error monitoring and logging
```

---

## Key Technical Decisions

### Why Vite + Express (not Next.js)?

The prototype was rebuilt from a Next.js pages-router app into Vite SPA + Express because:
- Cleaner separation between UI prototype and API
- Faster frontend dev iteration (Vite HMR)
- Backend can be deployed independently
- No SSR needed for a dashboard app

### Why JSX (not TypeScript) on Frontend?

The frontend is a rapid UI prototype. TypeScript will be added when the prototype stabilizes and real data flows are connected.

### Why JSON File Storage?

Fastest way to iterate on data model during prototyping. Will be replaced with Postgres before multi-user or production use.

---

## Instructions for Future Agents

1. **Read this document first** before making substantial changes.
2. **The architecture is Vite SPA + Express API.** Do not assume Next.js.
3. **Frontend is a high-fidelity prototype.** All 14 screens have polished UI, but many features are simulated with mock data.
4. **Backend API is real.** All endpoints listed above work and are tested.
5. **WhatsApp and AI are the critical path.** Phase 1 and Phase 2 are the highest priority.
6. **Do not add new UI screens** unless they directly support Phases 1-3.
7. **Keep business types explicit** — update `backend/src/lib/types.ts` first when changing domain concepts.
8. **Update this file** whenever you make significant implementation changes.
9. **The product spec** (`功能规格_智能搜房与看房行程规划.md`) defines the full product vision. This document defines what's built and what to build next.
10. **`frontend.backup-*` directories** are archived old code. Do not reference or modify them.
