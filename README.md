# Tour Planner

Tour Planner is a buyer-agent viewing appointment planning system. It helps buyer-side property agents coordinate multiple property viewings across buyer availability, opposing-agent availability, listing constraints, draft itinerary order, and exception handling.

The current milestone is Scheduler v1: a conservative backend scheduler that generates a proposed viewing itinerary from buyer availability, opposing-agent availability, and listing status. The app is still intentionally simple: one Next.js app under `frontend/`, using the `pages/` router and Next.js API routes.

This repository intentionally does not include WhatsApp Embedded Signup, PropertyGuru, Google Maps, AI planning, authentication, or real message sending.

## Current Scope

- Next.js single-app structure for frontend pages and backend API routes.
- Dashboard first screen at `/`.
- Tour list page at `/tours`.
- Tour detail page at `/tours/[id]`.
- Business type definitions in `frontend/lib/types.ts`.
- Seed mock data in `frontend/lib/mockData.ts`.
- Repository layer in `frontend/lib/repositories/toursRepository.ts`.
- Local JSON persistence for dev data at `frontend/data/tours.json`.
- API routes for creating/updating tours, adding/updating/deleting listings, managing buyer availability windows, recording opposing-agent availability, updating listing coordination status, storing listing-level coordination events, and generating proposed schedules.

## Install

```bash
npm install
```

## Development

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Build

```bash
npm run build
```

## API Contract

All validation errors use this shape:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Tour input is invalid",
    "fields": {
      "buyerName": "buyerName is required"
    }
  }
}
```

Common errors:

- `400 VALIDATION_FAILED`
- `404 TOUR_NOT_FOUND`
- `404 LISTING_NOT_FOUND`
- `404 BUYER_AVAILABILITY_NOT_FOUND`
- `404 OPPOSING_AGENT_AVAILABILITY_NOT_FOUND`
- `404 COORDINATION_EVENT_NOT_FOUND`
- `405 METHOD_NOT_ALLOWED`

### `GET /api/tours`

Returns all tour summaries.

Success:

```json
{ "tours": [] }
```

### `POST /api/tours`

Creates a tour.

Request body:

```json
{
  "buyerName": "Alicia Tan",
  "buyerPhone": "+65 9123 4455",
  "targetDate": "2026-05-01",
  "neighborhoods": ["Orchard", "Newton"],
  "nextAction": "Add shortlisted listings"
}
```

Required fields:

- `buyerName`
- `targetDate`

Success:

```json
{ "tour": {} }
```

Example:

```bash
curl -s -X POST http://localhost:3000/api/tours \
  -H 'Content-Type: application/json' \
  -d '{"buyerName":"Alicia Tan","buyerPhone":"+65 9123 4455","targetDate":"2026-05-01","neighborhoods":["Orchard","Newton"]}'
```

### `GET /api/tours/:id`

Returns one tour by id.

Success:

```json
{ "tour": {} }
```

### `PATCH /api/tours/:id`

Updates tour basics.

Request body:

```json
{
  "buyerName": "Alicia Tan",
  "buyerPhone": "+65 9123 4455",
  "targetDate": "2026-05-02",
  "neighborhoods": ["River Valley"],
  "nextAction": "Confirm buyer availability"
}
```

All fields are optional, but supplied string fields cannot be blank.

Success:

```json
{ "tour": {} }
```

Example:

```bash
curl -s -X PATCH http://localhost:3000/api/tours/tour-1001 \
  -H 'Content-Type: application/json' \
  -d '{"nextAction":"Confirm buyer availability","neighborhoods":["River Valley","Orchard"]}'
```

### `POST /api/tours/:id/listings`

Adds a listing to a tour.

Request body:

```json
{
  "title": "Example Condo 2BR",
  "address": "1 Example Road",
  "district": "D09",
  "askingPrice": 2500000,
  "bedrooms": 2,
  "bathrooms": 2,
  "opposingAgentName": "Daniel Lim",
  "opposingAgentPhone": "+65 9000 1111",
  "notes": "Prefers afternoon viewings",
  "status": "NOT_CONTACTED"
}
```

Required fields:

- `title`
- `address`
- `opposingAgentName`
- `opposingAgentPhone`

Optional numeric fields:

- `askingPrice`
- `bedrooms`
- `bathrooms`

Invalid numeric input returns `400 VALIDATION_FAILED`.

Success:

```json
{ "tour": {}, "listing": {} }
```

Example:

```bash
curl -s -X POST http://localhost:3000/api/tours/tour-1001/listings \
  -H 'Content-Type: application/json' \
  -d '{"title":"Example Condo 2BR","address":"1 Example Road","district":"D09","askingPrice":2500000,"bedrooms":2,"bathrooms":2,"opposingAgentName":"Daniel Lim","opposingAgentPhone":"+65 9000 1111"}'
```

### `PATCH /api/tours/:id/listings/:listingId`

Updates a listing.

Request body accepts the same fields as listing creation. All fields are optional, but supplied required string fields cannot be blank.

Success:

```json
{ "tour": {}, "listing": {} }
```

Example:

```bash
curl -s -X PATCH http://localhost:3000/api/tours/tour-1001/listings/listing-101 \
  -H 'Content-Type: application/json' \
  -d '{"status":"WAITING_REPLY","notes":"Called agent, waiting for Friday slots"}'
```

### `DELETE /api/tours/:id/listings/:listingId`

Deletes a listing from a tour.

Deleting a listing also removes related opposing-agent availability, schedule items, and exception cards tied to that listing id.

Success:

```json
{ "tour": {}, "deletedListingId": "listing-101" }
```

Example:

```bash
curl -s -X DELETE http://localhost:3000/api/tours/tour-1001/listings/listing-101
```

### Buyer Availability Fixed Blocks

Buyer availability APIs accept either explicit `startTime` / `endTime` or a fixed `block`.

Supported blocks:

- `MORNING`: `09:00`-`12:00`
- `AFTERNOON`: `12:00`-`15:00`
- `EVENING`: `15:00`-`18:00`
- `NIGHT`: `19:00`-`21:00`

The API stores exact `startTime` and `endTime`; it does not store the original block value.

Allowed `preference` values:

- `PREFERRED`
- `AVAILABLE`
- `LAST_RESORT`

Default preference on create is `AVAILABLE`.

### `GET /api/tours/:id/buyer-availability`

Lists buyer availability windows for a tour.

Success:

```json
{ "buyerAvailability": [] }
```

Example:

```bash
curl -s http://localhost:3000/api/tours/tour-1001/buyer-availability
```

### `POST /api/tours/:id/buyer-availability`

Adds one buyer availability window to a tour.

Request body with explicit times:

```json
{
  "date": "2026-05-01",
  "startTime": "13:00",
  "endTime": "15:30",
  "preference": "PREFERRED",
  "note": "Buyer prefers central area first"
}
```

Request body with fixed block:

```json
{
  "date": "2026-05-01",
  "block": "AFTERNOON",
  "preference": "AVAILABLE"
}
```

Success:

```json
{ "tour": {}, "buyerAvailability": {} }
```

Examples:

```bash
curl -s -X POST http://localhost:3000/api/tours/tour-1001/buyer-availability \
  -H 'Content-Type: application/json' \
  -d '{"date":"2026-05-01","startTime":"13:00","endTime":"15:30","preference":"PREFERRED","note":"Buyer prefers central area first"}'

curl -s -X POST http://localhost:3000/api/tours/tour-1001/buyer-availability \
  -H 'Content-Type: application/json' \
  -d '{"date":"2026-05-02","block":"MORNING"}'
```

### `PUT /api/tours/:id/buyer-availability`

Replaces all buyer availability windows for a tour.

Request body:

```json
{
  "availability": [
    {
      "date": "2026-05-03",
      "block": "MORNING",
      "preference": "PREFERRED"
    },
    {
      "date": "2026-05-03",
      "startTime": "19:00",
      "endTime": "21:00",
      "preference": "LAST_RESORT"
    }
  ]
}
```

Success:

```json
{ "tour": {}, "buyerAvailability": [] }
```

Example:

```bash
curl -s -X PUT http://localhost:3000/api/tours/tour-1001/buyer-availability \
  -H 'Content-Type: application/json' \
  -d '{"availability":[{"date":"2026-05-03","block":"MORNING","preference":"PREFERRED"},{"date":"2026-05-03","startTime":"19:00","endTime":"21:00","preference":"LAST_RESORT"}]}'
```

### `PATCH /api/tours/:id/buyer-availability/:availabilityId`

Updates one buyer availability window.

Request body accepts:

```json
{
  "date": "2026-05-04",
  "startTime": "14:00",
  "endTime": "16:00",
  "block": "EVENING",
  "preference": "AVAILABLE",
  "note": "Updated note"
}
```

When `block` is supplied, it derives `startTime` and `endTime` server-side.

Success:

```json
{ "tour": {}, "buyerAvailability": {} }
```

Example:

```bash
curl -s -X PATCH http://localhost:3000/api/tours/tour-1001/buyer-availability/buyer-availability-id \
  -H 'Content-Type: application/json' \
  -d '{"block":"EVENING","preference":"AVAILABLE","note":"Buyer can do evening instead"}'
```

### `DELETE /api/tours/:id/buyer-availability/:availabilityId`

Deletes one buyer availability window.

Success:

```json
{ "tour": {}, "deletedBuyerAvailabilityId": "buyer-availability-id" }
```

Example:

```bash
curl -s -X DELETE http://localhost:3000/api/tours/tour-1001/buyer-availability/buyer-availability-id
```

### Opposing-Agent Availability

Opposing-agent availability is scoped to one listing inside one tour.

Each availability record stores:

```json
{
  "id": "opposing-availability-id",
  "listingId": "listing-101",
  "agentName": "Daniel Lim",
  "slots": [
    {
      "date": "2026-05-01",
      "startTime": "10:00",
      "endTime": "11:30"
    }
  ],
  "lastUpdatedAt": "2026-04-21T12:00:00.000Z",
  "source": "MANUAL"
}
```

Allowed `source` values:

- `CALL`
- `SMS`
- `WHATSAPP`
- `EMAIL`
- `MANUAL`

Default source on create is `MANUAL`. If `agentName` is omitted, the API uses the listing's `opposingAgentName`.

When availability is added or replaced with records for a listing whose status is `NOT_CONTACTED` or `WAITING_REPLY`, the listing status is automatically moved to `AVAILABLE_SLOTS_RECEIVED`.

### `GET /api/tours/:id/listings/:listingId/opposing-availability`

Lists opposing-agent availability records for one listing.

Success:

```json
{ "opposingAgentAvailability": [] }
```

Example:

```bash
curl -s http://localhost:3000/api/tours/tour-1001/listings/listing-101/opposing-availability
```

### `POST /api/tours/:id/listings/:listingId/opposing-availability`

Adds one opposing-agent availability record for one listing.

Request body:

```json
{
  "agentName": "Daniel Lim",
  "source": "CALL",
  "slots": [
    {
      "date": "2026-05-01",
      "startTime": "10:00",
      "endTime": "11:30"
    }
  ]
}
```

Required fields:

- `slots`, a non-empty array
- each slot requires `date`, `startTime`, and `endTime`

Success:

```json
{ "tour": {}, "opposingAgentAvailability": {} }
```

Example:

```bash
curl -s -X POST http://localhost:3000/api/tours/tour-1001/listings/listing-101/opposing-availability \
  -H 'Content-Type: application/json' \
  -d '{"source":"CALL","slots":[{"date":"2026-05-01","startTime":"10:00","endTime":"11:30"}]}'
```

### `PUT /api/tours/:id/listings/:listingId/opposing-availability`

Replaces all opposing-agent availability records for one listing only. Availability records for other listings in the same tour are preserved.

Request body:

```json
{
  "availability": [
    {
      "source": "EMAIL",
      "slots": [
        {
          "date": "2026-05-02",
          "startTime": "14:00",
          "endTime": "15:00"
        }
      ]
    }
  ]
}
```

Success:

```json
{ "tour": {}, "opposingAgentAvailability": [] }
```

Example:

```bash
curl -s -X PUT http://localhost:3000/api/tours/tour-1001/listings/listing-101/opposing-availability \
  -H 'Content-Type: application/json' \
  -d '{"availability":[{"source":"EMAIL","slots":[{"date":"2026-05-02","startTime":"14:00","endTime":"15:00"}]}]}'
```

### `PATCH /api/tours/:id/listings/:listingId/opposing-availability/:availabilityId`

Updates one opposing-agent availability record.

Request body accepts:

```json
{
  "agentName": "Daniel Lim",
  "source": "SMS",
  "slots": [
    {
      "date": "2026-05-03",
      "startTime": "16:00",
      "endTime": "17:00"
    }
  ]
}
```

All fields are optional, but supplied `agentName` cannot be blank. If `slots` is supplied, it must be a non-empty valid array.

Success:

```json
{ "tour": {}, "opposingAgentAvailability": {} }
```

Example:

```bash
curl -s -X PATCH http://localhost:3000/api/tours/tour-1001/listings/listing-101/opposing-availability/opposing-availability-id \
  -H 'Content-Type: application/json' \
  -d '{"source":"SMS","slots":[{"date":"2026-05-03","startTime":"16:00","endTime":"17:00"}]}'
```

### `DELETE /api/tours/:id/listings/:listingId/opposing-availability/:availabilityId`

Deletes one opposing-agent availability record.

Success:

```json
{ "tour": {}, "deletedOpposingAgentAvailabilityId": "opposing-availability-id" }
```

Example:

```bash
curl -s -X DELETE http://localhost:3000/api/tours/tour-1001/listings/listing-101/opposing-availability/opposing-availability-id
```

### `PATCH /api/tours/:id/listings/:listingId/status`

Updates only a listing's coordination status and optional notes.

Request body:

```json
{
  "status": "WAITING_REPLY",
  "notes": "Called opposing agent, waiting for Friday slots"
}
```

Allowed statuses are the existing `TourListingStatus` values:

- `NOT_CONTACTED`
- `WAITING_REPLY`
- `AVAILABLE_SLOTS_RECEIVED`
- `UNAVAILABLE`
- `NEEDS_REVIEW`
- `SCHEDULED`
- `CANCELLED`

Success:

```json
{ "tour": {}, "listing": {} }
```

Example:

```bash
curl -s -X PATCH http://localhost:3000/api/tours/tour-1001/listings/listing-101/status \
  -H 'Content-Type: application/json' \
  -d '{"status":"WAITING_REPLY","notes":"Called opposing agent, waiting for Friday slots"}'
```

### Coordination Events

Coordination events are an audit trail scoped to one listing inside one tour. They are for manual history, future messaging ingestion, and future parser output. They do not send messages or parse natural language in this milestone.

Each event stores:

```json
{
  "id": "coordination-event-id",
  "tourId": "tour-1001",
  "listingId": "listing-101",
  "kind": "MESSAGE",
  "senderRole": "OPPOSING_AGENT",
  "source": "WHATSAPP",
  "body": "Friday 2pm works.",
  "summary": "Opposing agent offered Friday 2pm",
  "parsedIntent": "PROPOSED_TIME",
  "relatedAvailabilityId": "opposing-availability-id",
  "relatedStatus": "AVAILABLE_SLOTS_RECEIVED",
  "occurredAt": "2026-05-01T02:00:00.000Z",
  "createdAt": "2026-04-21T12:00:00.000Z",
  "updatedAt": "2026-04-21T12:00:00.000Z"
}
```

Allowed `kind` values:

- `MESSAGE`
- `STATUS_CHANGE`
- `AVAILABILITY_UPDATE`
- `NOTE`
- `HANDOFF`
- `SYSTEM`

Allowed `senderRole` values:

- `BUYER_AGENT`
- `OPPOSING_AGENT`
- `BUYER`
- `SYSTEM`

Allowed `source` values:

- `MANUAL`
- `WHATSAPP`
- `CALL`
- `SMS`
- `EMAIL`
- `SYSTEM`

Allowed `parsedIntent` placeholder values:

- `AVAILABLE`
- `UNAVAILABLE`
- `PROPOSED_TIME`
- `WAITING`
- `QUESTION`
- `UNCLEAR`
- `NEEDS_REVIEW`

Default source on create is `MANUAL`. If `occurredAt` is omitted, the server uses the current time. `MESSAGE`, `NOTE`, and `HANDOFF` require nonblank `body`.

### `GET /api/tours/:id/listings/:listingId/coordination-events`

Lists coordination events for one listing.

Success:

```json
{ "coordinationEvents": [] }
```

Example:

```bash
curl -s http://localhost:3000/api/tours/tour-1001/listings/listing-101/coordination-events
```

### `POST /api/tours/:id/listings/:listingId/coordination-events`

Appends one coordination event to a listing.

Inbound WhatsApp-like manual message request:

```json
{
  "kind": "MESSAGE",
  "senderRole": "OPPOSING_AGENT",
  "source": "WHATSAPP",
  "body": "Friday 2pm works for viewing.",
  "summary": "Opposing agent proposed Friday 2pm",
  "parsedIntent": "PROPOSED_TIME",
  "occurredAt": "2026-05-01T02:00:00.000Z"
}
```

Status-change event request:

```json
{
  "kind": "STATUS_CHANGE",
  "senderRole": "BUYER_AGENT",
  "source": "MANUAL",
  "summary": "Moved listing to waiting reply after call",
  "relatedStatus": "WAITING_REPLY"
}
```

Success:

```json
{ "tour": {}, "coordinationEvent": {} }
```

Examples:

```bash
curl -s -X POST http://localhost:3000/api/tours/tour-1001/listings/listing-101/coordination-events \
  -H 'Content-Type: application/json' \
  -d '{"kind":"MESSAGE","senderRole":"OPPOSING_AGENT","source":"WHATSAPP","body":"Friday 2pm works for viewing.","summary":"Opposing agent proposed Friday 2pm","parsedIntent":"PROPOSED_TIME","occurredAt":"2026-05-01T02:00:00.000Z"}'

curl -s -X POST http://localhost:3000/api/tours/tour-1001/listings/listing-101/coordination-events \
  -H 'Content-Type: application/json' \
  -d '{"kind":"STATUS_CHANGE","senderRole":"BUYER_AGENT","source":"MANUAL","summary":"Moved listing to waiting reply after call","relatedStatus":"WAITING_REPLY"}'
```

### `PATCH /api/tours/:id/listings/:listingId/coordination-events/:eventId`

Updates one coordination event.

Request body accepts:

```json
{
  "summary": "Opposing agent offered Friday 2pm",
  "parsedIntent": "PROPOSED_TIME"
}
```

Success:

```json
{ "tour": {}, "coordinationEvent": {} }
```

Example:

```bash
curl -s -X PATCH http://localhost:3000/api/tours/tour-1001/listings/listing-101/coordination-events/coordination-event-id \
  -H 'Content-Type: application/json' \
  -d '{"summary":"Opposing agent offered Friday 2pm","parsedIntent":"PROPOSED_TIME"}'
```

### `DELETE /api/tours/:id/listings/:listingId/coordination-events/:eventId`

Physically deletes one coordination event from local JSON storage.

Success:

```json
{ "tour": {}, "deletedCoordinationEventId": "coordination-event-id" }
```

Example:

```bash
curl -s -X DELETE http://localhost:3000/api/tours/tour-1001/listings/listing-101/coordination-events/coordination-event-id
```

### Scheduler v1

Scheduler v1 generates and saves a proposed schedule for one tour. It is deterministic and conservative, not globally optimal.

Rules:

- Only listings with status `AVAILABLE_SLOTS_RECEIVED` are schedulable.
- Other listing statuses are returned as unscheduled with `LISTING_STATUS_NOT_SCHEDULABLE`.
- Default viewing duration is 30 minutes.
- Candidate starts are rounded up to 15-minute increments.
- First item in a day gets 0 travel buffer.
- Same-address travel buffer is 0 minutes.
- Different-address travel buffer defaults to 15 minutes.
- Existing `tour.schedule` is replaced on each generation.
- Saved schedule items use status `PROPOSED`.
- Unscheduled listings and warnings are returned in the API response but are not persisted.
- No exception cards are created automatically.

Generated schedule item times are emitted as Singapore local-compatible ISO strings with explicit `+08:00`, for example `2026-05-01T10:00:00+08:00`.

Unscheduled reason codes:

- `NO_BUYER_AVAILABILITY`
- `NO_OPPOSING_AVAILABILITY`
- `NO_OVERLAP`
- `LISTING_STATUS_NOT_SCHEDULABLE`
- `INSUFFICIENT_WINDOW`
- `CONFLICT_WITH_EXISTING_SCHEDULE`

### `POST /api/tours/:id/generate-schedule`

Generates and saves a proposed schedule for one tour.

Request body may be omitted or empty:

```json
{}
```

Request body with explicit options:

```json
{
  "viewingDurationMinutes": 30,
  "defaultTravelBufferMinutes": 15,
  "replaceExistingSchedule": true
}
```

Validation:

- `viewingDurationMinutes`, if supplied, must be a positive integer.
- `defaultTravelBufferMinutes`, if supplied, must be a nonnegative integer.
- `replaceExistingSchedule`, if supplied, must be boolean.
- Scheduler v1 only supports `replaceExistingSchedule: true`; explicit `false` returns `400 VALIDATION_FAILED`.

Success:

```json
{
  "tour": {},
  "schedule": [],
  "unscheduled": [
    {
      "listingId": "listing-123",
      "reason": "NO_OVERLAP",
      "message": "No overlap between buyer availability and opposing-agent availability."
    }
  ],
  "warnings": [],
  "summary": {
    "candidateListingCount": 4,
    "scheduledCount": 3,
    "unscheduledCount": 1
  }
}
```

Examples:

```bash
curl -s -X POST http://localhost:3000/api/tours/tour-1001/generate-schedule \
  -H 'Content-Type: application/json' \
  -d '{}'

curl -s -X POST http://localhost:3000/api/tours/tour-1001/generate-schedule \
  -H 'Content-Type: application/json' \
  -d '{"viewingDurationMinutes":30,"defaultTravelBufferMinutes":15,"replaceExistingSchedule":true}'

curl -s -X POST http://localhost:3000/api/tours/tour-1001/generate-schedule \
  -H 'Content-Type: application/json' \
  -d '{"replaceExistingSchedule":false}'

curl -s -X POST http://localhost:3000/api/tours/tour-1001/generate-schedule \
  -H 'Content-Type: application/json' \
  -d '{"viewingDurationMinutes":0}'
```

## Available Pages

- `/`
- `/tours`
- `/tours/tour-1001`
- `/tours/tour-1002`

## Not Implemented Yet

- Authentication and agent/team accounts
- Prisma/Postgres storage
- Real frontend create/edit/delete forms
- Buyer availability editor
- Opposing-agent availability editor
- Listing coordination status UI
- Coordination event UI
- Scheduling UI
- Real listing import from portals
- Google Maps routing and travel time estimates
- AI schedule optimization
- WhatsApp or SMS messaging
- Calendar sync
- Production deployment configuration

## Suggested Next Steps

1. Wire custom frontend CRUD screens to the documented API routes.
2. Add a repository interface that can swap local JSON for Prisma/Postgres.
3. Add reply parsing foundation for simulated messages.
4. Add exception-card actions and audit history.
5. Add itinerary proposal editing before integrating route optimization.
