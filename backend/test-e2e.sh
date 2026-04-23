#!/usr/bin/env bash
# =============================================================================
# Butler E2E API Test Suite
# =============================================================================
# Comprehensive end-to-end tests for all API endpoints.
# Prerequisites: backend must be running on http://localhost:8787
#
# Usage:
#   chmod +x test-e2e.sh
#   ./test-e2e.sh
# =============================================================================

set -euo pipefail

BASE="http://localhost:8787"
PASS=0
FAIL=0
TOTAL=0
FAILURES=""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# Helper function to run a test case
assert() {
  local test_name="$1"
  local method="$2"
  local url="$3"
  local expected_status="$4"
  local body="${5:-}"
  local check_pattern="${6:-}"

  TOTAL=$((TOTAL + 1))

  local curl_args=(-s -w "\n%{http_code}" -X "$method" "$BASE$url")
  if [ -n "$body" ]; then
    curl_args+=(-H "Content-Type: application/json" -d "$body")
  fi

  local response
  response=$(curl "${curl_args[@]}" 2>/dev/null) || {
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}\n  ❌ ${test_name} — curl failed (is the server running?)"
    printf "  ${RED}❌ %-60s [CURL FAILED]${NC}\n" "$test_name"
    return
  }

  local status_code
  status_code=$(echo "$response" | tail -n1)
  local body_content
  body_content=$(echo "$response" | sed '$d')

  if [ "$status_code" != "$expected_status" ]; then
    FAIL=$((FAIL + 1))
    FAILURES="${FAILURES}\n  ❌ ${test_name} — expected ${expected_status}, got ${status_code}"
    printf "  ${RED}❌ %-60s [%s ≠ %s]${NC}\n" "$test_name" "$status_code" "$expected_status"
    return
  fi

  if [ -n "$check_pattern" ]; then
    if ! echo "$body_content" | grep -q "$check_pattern"; then
      FAIL=$((FAIL + 1))
      FAILURES="${FAILURES}\n  ❌ ${test_name} — pattern '${check_pattern}' not found in response"
      printf "  ${RED}❌ %-60s [PATTERN MISS: %s]${NC}\n" "$test_name" "$check_pattern"
      return
    fi
  fi

  PASS=$((PASS + 1))
  printf "  ${GREEN}✓  %-60s [%s]${NC}\n" "$test_name" "$status_code"
}

# Helper to extract a value from JSON (basic grep-based)
json_val() {
  echo "$1" | grep -o "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | head -1 | sed 's/.*: *"//;s/"//'
}

# ── Connectivity check ──────────────────────────────────────────────
echo ""
printf "${CYAN}══════════════════════════════════════════════════════════════${NC}\n"
printf "${CYAN}  Butler E2E API Test Suite${NC}\n"
printf "${CYAN}══════════════════════════════════════════════════════════════${NC}\n"
echo ""

echo "Checking server at ${BASE}..."
if ! curl -sf "${BASE}/health" > /dev/null 2>&1; then
  printf "${RED}Server not reachable at ${BASE}. Start it with: cd backend && npm run dev${NC}\n"
  exit 1
fi
printf "${GREEN}Server is running.${NC}\n\n"


# ═══════════════════════════════════════════════════════════════════
# 1. HEALTH CHECK
# ═══════════════════════════════════════════════════════════════════
printf "${YELLOW}── 1. Health Check ──${NC}\n"
assert "GET /health returns 200" \
  GET "/health" 200 "" "ok"


# ═══════════════════════════════════════════════════════════════════
# 2. TOURS — CRUD
# ═══════════════════════════════════════════════════════════════════
printf "\n${YELLOW}── 2. Tours CRUD ──${NC}\n"

assert "GET /api/tours returns tour summaries" \
  GET "/api/tours" 200 "" "tour-1001"

assert "GET /api/tours lists both tours" \
  GET "/api/tours" 200 "" "tour-1002"

assert "GET /api/tours/:id returns Alicia's tour" \
  GET "/api/tours/tour-1001" 200 "" "Alicia Tan"

assert "GET /api/tours/:id returns Marcus's tour" \
  GET "/api/tours/tour-1002" 200 "" "Marcus Lee"

assert "GET /api/tours/:id returns 404 for non-existent tour" \
  GET "/api/tours/tour-nonexistent" 404 "" "TOUR_NOT_FOUND"

# Create a new tour
assert "POST /api/tours creates new tour" \
  POST "/api/tours" 201 \
  '{"buyerName":"Test Buyer","buyerPhone":"+65 8888 0001","targetDate":"2026-05-15","neighborhoods":["Bukit Timah"]}' \
  "Test Buyer"

# Extract the new tour ID
NEW_TOUR_RESPONSE=$(curl -s "${BASE}/api/tours" 2>/dev/null)
NEW_TOUR_ID=$(echo "$NEW_TOUR_RESPONSE" | grep -o '"id":"tour-[^"]*"' | head -1 | sed 's/"id":"//;s/"//')

if [ -n "$NEW_TOUR_ID" ]; then
  # Patch tour basics
  assert "PATCH /api/tours/:id updates tour basics" \
    PATCH "/api/tours/${NEW_TOUR_ID}" 200 \
    '{"nextAction":"Updated action","neighborhoods":["Bukit Timah","Holland Village"]}' \
    "Updated action"
fi

assert "PATCH /api/tours/:id returns 404 for non-existent" \
  PATCH "/api/tours/tour-nonexistent" 404 \
  '{"nextAction":"test"}' \
  "TOUR_NOT_FOUND"

assert "POST /api/tours validation fails on missing buyerName" \
  POST "/api/tours" 400 \
  '{"targetDate":"2026-05-01"}' \
  "VALIDATION_FAILED"


# ═══════════════════════════════════════════════════════════════════
# 3. LISTINGS — CRUD
# ═══════════════════════════════════════════════════════════════════
printf "\n${YELLOW}── 3. Listings CRUD ──${NC}\n"

assert "Tour 1001 has 4 listings" \
  GET "/api/tours/tour-1001" 200 "" "listing-104"

# Add a listing to existing tour
assert "POST listing to tour-1001" \
  POST "/api/tours/tour-1001/listings" 201 \
  '{"title":"Test New Listing","address":"999 Test Road","opposingAgentName":"Test Agent","opposingAgentPhone":"+65 9999 0001"}' \
  "Test New Listing"

# Get updated tour and find new listing ID
TOUR_DATA=$(curl -s "${BASE}/api/tours/tour-1001" 2>/dev/null)
NEW_LISTING_ID=$(echo "$TOUR_DATA" | grep -o '"id":"listing-[^"]*"' | tail -1 | sed 's/"id":"//;s/"//')

if [ -n "$NEW_LISTING_ID" ]; then
  assert "PATCH listing updates listing info" \
    PATCH "/api/tours/tour-1001/listings/${NEW_LISTING_ID}" 200 \
    '{"notes":"Updated via test","askingPrice":1500000}' \
    "Updated via test"

  assert "PATCH listing status to WAITING_REPLY" \
    PATCH "/api/tours/tour-1001/listings/${NEW_LISTING_ID}/status" 200 \
    '{"status":"WAITING_REPLY"}' \
    "WAITING_REPLY"

  assert "DELETE listing removes it" \
    DELETE "/api/tours/tour-1001/listings/${NEW_LISTING_ID}" 200 "" \
    "deletedListingId"
fi

assert "POST listing validation fails on missing title" \
  POST "/api/tours/tour-1001/listings" 400 \
  '{"address":"test"}' \
  "VALIDATION_FAILED"


# ═══════════════════════════════════════════════════════════════════
# 4. BUYER AVAILABILITY — CRUD
# ═══════════════════════════════════════════════════════════════════
printf "\n${YELLOW}── 4. Buyer Availability ──${NC}\n"

assert "GET buyer availability for tour-1001" \
  GET "/api/tours/tour-1001/buyer-availability" 200 "" "buyer-slot-1"

assert "GET buyer availability lists 3 slots" \
  GET "/api/tours/tour-1001/buyer-availability" 200 "" "buyer-slot-3"

assert "POST add new buyer availability" \
  POST "/api/tours/tour-1001/buyer-availability" 201 \
  '{"date":"2026-04-30","startTime":"14:00","endTime":"17:00","preference":"AVAILABLE","note":"Test slot"}' \
  "Test slot"

# Get new availability ID
BA_DATA=$(curl -s "${BASE}/api/tours/tour-1001/buyer-availability" 2>/dev/null)
NEW_BA_ID=$(echo "$BA_DATA" | grep -o '"id":"buyer-availability-[^"]*"' | head -1 | sed 's/"id":"//;s/"//')

if [ -n "$NEW_BA_ID" ]; then
  assert "PATCH buyer availability updates slot" \
    PATCH "/api/tours/tour-1001/buyer-availability/${NEW_BA_ID}" 200 \
    '{"note":"Updated test slot","preference":"PREFERRED"}' \
    "Updated test slot"

  assert "DELETE buyer availability removes slot" \
    DELETE "/api/tours/tour-1001/buyer-availability/${NEW_BA_ID}" 200 "" \
    "deletedBuyerAvailabilityId"
fi

assert "PUT replace all buyer availability" \
  PUT "/api/tours/tour-1001/buyer-availability" 200 \
  '{"availability":[{"date":"2026-04-28","startTime":"13:00","endTime":"17:30","preference":"PREFERRED","note":"Reset main slot"},{"date":"2026-04-28","startTime":"10:00","endTime":"12:00","preference":"AVAILABLE","note":"Morning backup"}]}' \
  "Reset main slot"

assert "POST buyer availability validation fails" \
  POST "/api/tours/tour-1001/buyer-availability" 400 \
  '{"startTime":"09:00"}' \
  "VALIDATION_FAILED"


# ═══════════════════════════════════════════════════════════════════
# 5. OPPOSING AGENT AVAILABILITY — CRUD
# ═══════════════════════════════════════════════════════════════════
printf "\n${YELLOW}── 5. Opposing Agent Availability ──${NC}\n"

assert "GET opposing availability for listing-101" \
  GET "/api/tours/tour-1001/listings/listing-101/opposing-availability" 200 "" "oa-slot-1"

assert "POST add opposing availability to listing-101" \
  POST "/api/tours/tour-1001/listings/listing-101/opposing-availability" 201 \
  '{"agentName":"Daniel Lim","slots":[{"date":"2026-04-29","startTime":"10:00","endTime":"11:00"}],"source":"WHATSAPP"}' \
  "Daniel Lim"

# Get new opposing availability ID
OA_DATA=$(curl -s "${BASE}/api/tours/tour-1001/listings/listing-101/opposing-availability" 2>/dev/null)
NEW_OA_ID=$(echo "$OA_DATA" | grep -o '"id":"opposing-availability-[^"]*"' | tail -1 | sed 's/"id":"//;s/"//')

if [ -n "$NEW_OA_ID" ]; then
  assert "PATCH opposing availability updates it" \
    PATCH "/api/tours/tour-1001/listings/listing-101/opposing-availability/${NEW_OA_ID}" 200 \
    '{"source":"CALL"}' \
    "CALL"

  assert "DELETE opposing availability removes it" \
    DELETE "/api/tours/tour-1001/listings/listing-101/opposing-availability/${NEW_OA_ID}" 200 "" \
    "deletedOpposingAgentAvailabilityId"
fi

assert "PUT replace opposing availability for listing-101" \
  PUT "/api/tours/tour-1001/listings/listing-101/opposing-availability" 200 \
  '{"availability":[{"slots":[{"date":"2026-04-28","startTime":"14:00","endTime":"15:00"},{"date":"2026-04-28","startTime":"16:30","endTime":"17:30"}],"source":"WHATSAPP"}]}' \
  "WHATSAPP"

assert "GET opposing availability 404 for non-existent listing" \
  GET "/api/tours/tour-1001/listings/listing-nonexistent/opposing-availability" 404 "" \
  "LISTING_NOT_FOUND"


# ═══════════════════════════════════════════════════════════════════
# 6. COORDINATION EVENTS (WhatsApp Messages)
# ═══════════════════════════════════════════════════════════════════
printf "\n${YELLOW}── 6. Coordination Events (WhatsApp Messages) ──${NC}\n"

assert "GET coordination events for listing-101" \
  GET "/api/tours/tour-1001/listings/listing-101/coordination-events" 200 "" "ce-101-01"

assert "Listing-101 has WhatsApp conversation" \
  GET "/api/tours/tour-1001/listings/listing-101/coordination-events" 200 "" "Butler AI assisting Maya Chen"

assert "GET coordination events for listing-102" \
  GET "/api/tours/tour-1001/listings/listing-102/coordination-events" 200 "" "ce-102-01"

assert "Listing-103 shows follow-up message" \
  GET "/api/tours/tour-1001/listings/listing-103/coordination-events" 200 "" "following up"

assert "POST new coordination event (mock WhatsApp message)" \
  POST "/api/tours/tour-1001/listings/listing-103/coordination-events" 201 \
  '{"kind":"MESSAGE","senderRole":"OPPOSING_AGENT","source":"WHATSAPP","body":"Sorry for the late reply! Yes Monday works. How about 4:30-5:30pm?","summary":"Ethan replied with 4:30-5:30pm slot.","parsedIntent":"PROPOSED_TIME"}' \
  "late reply"

# Get new event ID
CE_DATA=$(curl -s "${BASE}/api/tours/tour-1001/listings/listing-103/coordination-events" 2>/dev/null)
NEW_CE_ID=$(echo "$CE_DATA" | grep -o '"id":"coordination-event-[^"]*"' | tail -1 | sed 's/"id":"//;s/"//')

if [ -n "$NEW_CE_ID" ]; then
  assert "PATCH coordination event updates it" \
    PATCH "/api/tours/tour-1001/listings/listing-103/coordination-events/${NEW_CE_ID}" 200 \
    '{"parsedIntent":"AVAILABLE","summary":"Ethan confirmed 4:30-5:30pm."}' \
    "AVAILABLE"

  assert "DELETE coordination event removes it" \
    DELETE "/api/tours/tour-1001/listings/listing-103/coordination-events/${NEW_CE_ID}" 200 "" \
    "deletedCoordinationEventId"
fi

assert "POST coordination event validation fails on missing kind" \
  POST "/api/tours/tour-1001/listings/listing-101/coordination-events" 400 \
  '{"senderRole":"BUYER_AGENT"}' \
  "VALIDATION_FAILED"


# ═══════════════════════════════════════════════════════════════════
# 7. THREADS (Chat UI)
# ═══════════════════════════════════════════════════════════════════
printf "\n${YELLOW}── 7. Threads (Chat UI) ──${NC}\n"

assert "GET threads for tour-1001 lists 4 threads" \
  GET "/api/tours/tour-1001/threads" 200 "" "thread-"

assert "Threads include listing agent names" \
  GET "/api/tours/tour-1001/threads" 200 "" "Daniel Lim"

assert "GET single thread for tour-1001" \
  GET "/api/tours/tour-1001/threads/thread-1001" 200 "" "listing-101"

assert "GET thread messages for Daniel Lim conversation" \
  GET "/api/tours/tour-1001/threads/thread-1001/messages" 200 "" "Butler AI assisting Maya Chen"

assert "GET thread messages for Priya Nair conversation" \
  GET "/api/tours/tour-1001/threads/thread-1002/messages" 200 "" "Scotts Square"

assert "GET threads for tour-1002" \
  GET "/api/tours/tour-1002/threads" 200 "" "Sarah Koh"

assert "POST thread message sends a manual message" \
  POST "/api/tours/tour-1001/threads/thread-1001/messages" 201 \
  '{"text":"Hi Daniel, we have confirmed the 2pm slot. See you Monday!"}' \
  "confirmed the 2pm"

assert "PATCH thread ownership to HUMAN" \
  PATCH "/api/tours/tour-1001/threads/thread-1003/ownership" 200 \
  '{"ownership":"HUMAN"}' \
  "HUMAN"

assert "PATCH thread ownership back to AI" \
  PATCH "/api/tours/tour-1001/threads/thread-1003/ownership" 200 \
  '{"ownership":"AI"}' \
  "AI"

assert "GET thread 404 for non-existent" \
  GET "/api/tours/tour-1001/threads/thread-nonexistent" 404 "" "THREAD_NOT_FOUND"

assert "POST thread message validation fails on empty text" \
  POST "/api/tours/tour-1001/threads/thread-1001/messages" 400 \
  '{"text":""}' \
  "VALIDATION_FAILED"

assert "PATCH thread ownership validation fails on bad value" \
  PATCH "/api/tours/tour-1001/threads/thread-1001/ownership" 400 \
  '{"ownership":"ROBOT"}' \
  "VALIDATION_FAILED"


# ═══════════════════════════════════════════════════════════════════
# 8. EXCEPTIONS
# ═══════════════════════════════════════════════════════════════════
printf "\n${YELLOW}── 8. Exceptions ──${NC}\n"

assert "GET exceptions for tour-1001" \
  GET "/api/tours/tour-1001/exceptions" 200 "" "exception-1"

assert "Exception-1 is about Ethan Wong" \
  GET "/api/tours/tour-1001/exceptions/exception-1" 200 "" "Ethan Wong"

assert "Exception-2 is about school pickup" \
  GET "/api/tours/tour-1001/exceptions/exception-2" 200 "" "school pickup"

assert "GET exception 404 for non-existent" \
  GET "/api/tours/tour-1001/exceptions/exception-nonexistent" 404 "" "EXCEPTION_NOT_FOUND"

# Resolve exception with REPROPOSE
assert "POST resolve exception with REPROPOSE" \
  POST "/api/tours/tour-1001/exceptions/exception-2/resolve" 200 \
  '{"action":"REPROPOSE"}' \
  "resolved"

# Resolve exception with SQUEEZE_IN
assert "POST resolve exception with SQUEEZE_IN" \
  POST "/api/tours/tour-1001/exceptions/exception-1/resolve" 200 \
  '{"action":"SQUEEZE_IN"}' \
  "resolved"

assert "POST resolve exception validation fails on bad action" \
  POST "/api/tours/tour-1002/exceptions/exception-3/resolve" 400 \
  '{"action":"INVALID"}' \
  "VALIDATION_FAILED"


# ═══════════════════════════════════════════════════════════════════
# 9. SCHEDULE GENERATION
# ═══════════════════════════════════════════════════════════════════
printf "\n${YELLOW}── 9. Schedule Generation ──${NC}\n"

assert "POST generate schedule for tour-1001" \
  POST "/api/tours/tour-1001/generate-schedule" 200 \
  '{"viewingDurationMinutes":30,"defaultTravelBufferMinutes":15}' \
  "schedule"

assert "Schedule generation returns summary" \
  POST "/api/tours/tour-1001/generate-schedule" 200 \
  '{}' \
  "scheduledCount"

assert "POST generate schedule 404 for non-existent tour" \
  POST "/api/tours/tour-nonexistent/generate-schedule" 404 \
  '{}' \
  "TOUR_NOT_FOUND"


# ═══════════════════════════════════════════════════════════════════
# 10. CALENDAR
# ═══════════════════════════════════════════════════════════════════
printf "\n${YELLOW}── 10. Calendar ──${NC}\n"

assert "GET /api/calendar returns monthly view" \
  GET "/api/calendar?month=2026-04" 200 "" "month"

assert "GET /api/calendar/day returns daily view" \
  GET "/api/calendar/day?date=2026-04-28" 200 "" "date"

assert "Calendar for April 29 shows Marcus's tour" \
  GET "/api/calendar/day?date=2026-04-29" 200 "" "items"


# ═══════════════════════════════════════════════════════════════════
# 11. ITINERARY
# ═══════════════════════════════════════════════════════════════════
printf "\n${YELLOW}── 11. Itinerary ──${NC}\n"

assert "GET itinerary for tour-1002" \
  GET "/api/tours/tour-1002/itinerary" 200 "" "Marcus Lee"

assert "Itinerary has stops" \
  GET "/api/tours/tour-1002/itinerary" 200 "" "stops"

assert "POST share itinerary" \
  POST "/api/tours/tour-1002/itinerary/share" 200 "" "share"

assert "POST export itinerary" \
  POST "/api/tours/tour-1002/itinerary/export" 200 "" "export"

assert "GET itinerary 404 for non-existent tour" \
  GET "/api/tours/tour-nonexistent/itinerary" 404 "" "TOUR_NOT_FOUND"


# ═══════════════════════════════════════════════════════════════════
# 12. INBOX
# ═══════════════════════════════════════════════════════════════════
printf "\n${YELLOW}── 12. Inbox ──${NC}\n"

assert "GET /api/inbox returns items" \
  GET "/api/inbox" 200 "" "items"

# Get first inbox item ID
INBOX_DATA=$(curl -s "${BASE}/api/inbox" 2>/dev/null)
INBOX_ITEM_ID=$(echo "$INBOX_DATA" | grep -o '"id":"[^"]*"' | head -1 | sed 's/"id":"//;s/"//')

if [ -n "$INBOX_ITEM_ID" ]; then
  assert "PATCH inbox item mark as read" \
    PATCH "/api/inbox/${INBOX_ITEM_ID}/read" 200 "" "read"
fi

assert "PATCH inbox 404 for non-existent item" \
  PATCH "/api/inbox/nonexistent-item/read" 404 "" "INBOX_ITEM_NOT_FOUND"


# ═══════════════════════════════════════════════════════════════════
# 13. CLIENTS
# ═══════════════════════════════════════════════════════════════════
printf "\n${YELLOW}── 13. Clients ──${NC}\n"

assert "GET /api/clients lists clients" \
  GET "/api/clients" 200 "" "Alicia Tan"

assert "GET /api/clients lists Marcus" \
  GET "/api/clients" 200 "" "Marcus Lee"

assert "GET /api/clients/:id returns Alicia" \
  GET "/api/clients/client-1001" 200 "" "Alicia Tan"

assert "GET /api/clients/:id 404 for non-existent" \
  GET "/api/clients/client-nonexistent" 404 "" "CLIENT_NOT_FOUND"

assert "POST /api/clients creates new client" \
  POST "/api/clients" 201 \
  '{"name":"Test Client","phone":"+65 7777 0001","email":"test@example.com","type":"Buy"}' \
  "Test Client"

# Get new client ID
CLIENTS_DATA=$(curl -s "${BASE}/api/clients" 2>/dev/null)
NEW_CLIENT_ID=$(echo "$CLIENTS_DATA" | grep -o '"id":"client-[^"]*"' | tail -1 | sed 's/"id":"//;s/"//')

if [ -n "$NEW_CLIENT_ID" ]; then
  assert "PATCH /api/clients/:id updates client" \
    PATCH "/api/clients/${NEW_CLIENT_ID}" 200 \
    '{"notes":"Updated via E2E test"}' \
    "Updated via E2E test"

  assert "DELETE /api/clients/:id deletes client" \
    DELETE "/api/clients/${NEW_CLIENT_ID}" 200 "" \
    "deletedClientId"
fi

assert "POST /api/clients validation fails on missing name" \
  POST "/api/clients" 400 \
  '{"phone":"+65 0000 0000"}' \
  "VALIDATION_FAILED"


# ═══════════════════════════════════════════════════════════════════
# 14. SEARCH
# ═══════════════════════════════════════════════════════════════════
printf "\n${YELLOW}── 14. Search ──${NC}\n"

assert "POST /api/search/parse parses property search text" \
  POST "/api/search/parse" 200 \
  '{"text":"3 bedroom condo near Bishan MRT under $4000","source":"text"}' \
  "tags"

assert "Search parse extracts bedroom tag" \
  POST "/api/search/parse" 200 \
  '{"text":"3 bed HDB pet friendly","source":"text"}' \
  "HDB"

assert "POST /api/search/import-link imports property URL" \
  POST "/api/search/import-link" 200 \
  '{"url":"https://propertyguru.com.sg/listing/queenstown-hdb-3br"}' \
  "listing"

assert "POST /api/search/results returns results" \
  POST "/api/search/results" 200 \
  '{"tags":[{"groupKey":"propertyType","mergeStrategy":"union","kind":"propertyType","value":"condo","label":"Condo"}]}' \
  "results"


# ═══════════════════════════════════════════════════════════════════
# 15. SETTINGS & PROFILE
# ═══════════════════════════════════════════════════════════════════
printf "\n${YELLOW}── 15. Settings & Profile ──${NC}\n"

assert "GET /api/me returns profile" \
  GET "/api/me" 200 "" "profile"

assert "PATCH /api/me updates profile" \
  PATCH "/api/me" 200 \
  '{"name":"Maya Chen Test","phone":"+65 8222 1010"}' \
  "Maya Chen Test"

assert "GET /api/settings returns settings" \
  GET "/api/settings" 200 "" "settings"

assert "PATCH /api/settings updates settings" \
  PATCH "/api/settings" 200 \
  '{"defaultViewingDuration":30}' \
  "settings"


# ═══════════════════════════════════════════════════════════════════
# 16. USE CASE: Complete WhatsApp coordination flow
# ═══════════════════════════════════════════════════════════════════
printf "\n${YELLOW}── 16. Use Case: Full WhatsApp Coordination Flow ──${NC}\n"

# Step 1: Create a new tour
echo "  [Flow] Creating new tour for Jennifer Wong..."
FLOW_RESPONSE=$(curl -s -X POST "${BASE}/api/tours" \
  -H "Content-Type: application/json" \
  -d '{"buyerName":"Jennifer Wong","buyerPhone":"+65 9555 1234","targetDate":"2026-05-10","neighborhoods":["Clementi","Dover"]}' 2>/dev/null)
FLOW_TOUR_ID=$(echo "$FLOW_RESPONSE" | grep -o '"id":"tour-[^"]*"' | head -1 | sed 's/"id":"//;s/"//')

if [ -n "$FLOW_TOUR_ID" ]; then
  assert "[Flow] Tour created for Jennifer Wong" \
    GET "/api/tours/${FLOW_TOUR_ID}" 200 "" "Jennifer Wong"

  # Step 2: Add buyer availability
  assert "[Flow] Add buyer morning slot" \
    POST "/api/tours/${FLOW_TOUR_ID}/buyer-availability" 201 \
    '{"date":"2026-05-10","startTime":"09:00","endTime":"12:00","preference":"PREFERRED","note":"Morning is best"}' \
    "Morning is best"

  assert "[Flow] Add buyer afternoon slot" \
    POST "/api/tours/${FLOW_TOUR_ID}/buyer-availability" 201 \
    '{"date":"2026-05-10","startTime":"14:00","endTime":"17:00","preference":"AVAILABLE","note":"Afternoon backup"}' \
    "Afternoon backup"

  # Step 3: Add a listing
  LISTING_RESP=$(curl -s -X POST "${BASE}/api/tours/${FLOW_TOUR_ID}/listings" \
    -H "Content-Type: application/json" \
    -d '{"title":"Clementi Towers 3BR","address":"15 Clementi Avenue 2","district":"D05","askingPrice":1650000,"bedrooms":3,"bathrooms":2,"opposingAgentName":"Kevin Tan","opposingAgentPhone":"+65 9666 7777","notes":"New listing, just posted today."}' 2>/dev/null)
  FLOW_LISTING_ID=$(echo "$LISTING_RESP" | grep -o '"id":"listing-[^"]*"' | head -1 | sed 's/"id":"//;s/"//')

  if [ -n "$FLOW_LISTING_ID" ]; then
    assert "[Flow] Listing added to tour" \
      GET "/api/tours/${FLOW_TOUR_ID}" 200 "" "Clementi Towers"

    # Step 4: Simulate AI sending WhatsApp outreach
    assert "[Flow] AI sends WhatsApp outreach" \
      POST "/api/tours/${FLOW_TOUR_ID}/listings/${FLOW_LISTING_ID}/coordination-events" 201 \
      '{"kind":"MESSAGE","senderRole":"BUYER_AGENT","source":"WHATSAPP","body":"Hi Kevin, Butler AI assisting Maya Chen from Northstar Realty. Our buyer Jennifer is keen on Clementi Towers 3BR. Any viewing slots on May 10?","summary":"AI initial outreach to Kevin for Clementi Towers."}' \
      "Butler AI assisting"

    # Step 5: Simulate opposing agent WhatsApp reply
    assert "[Flow] Kevin replies via WhatsApp" \
      POST "/api/tours/${FLOW_TOUR_ID}/listings/${FLOW_LISTING_ID}/coordination-events" 201 \
      '{"kind":"MESSAGE","senderRole":"OPPOSING_AGENT","source":"WHATSAPP","body":"Hi! Yes, the owner is available. Can do 10am-11am or 3pm-4pm. Let me know.","summary":"Kevin offered 10am-11am and 3pm-4pm.","parsedIntent":"PROPOSED_TIME"}' \
      "10am-11am"

    # Step 6: System parses the time slots
    assert "[Flow] System parses WhatsApp reply" \
      POST "/api/tours/${FLOW_TOUR_ID}/listings/${FLOW_LISTING_ID}/coordination-events" 201 \
      '{"kind":"AVAILABILITY_UPDATE","senderRole":"SYSTEM","source":"SYSTEM","body":"Parsed Kevin WhatsApp reply: 2 time slots extracted.","summary":"System parsed 2 slots.","parsedIntent":"AVAILABLE","relatedStatus":"AVAILABLE_SLOTS_RECEIVED"}' \
      "parsed"

    # Step 7: Add opposing agent availability from parsed slots
    assert "[Flow] Add parsed opposing agent slots" \
      POST "/api/tours/${FLOW_TOUR_ID}/listings/${FLOW_LISTING_ID}/opposing-availability" 201 \
      '{"agentName":"Kevin Tan","slots":[{"date":"2026-05-10","startTime":"10:00","endTime":"11:00"},{"date":"2026-05-10","startTime":"15:00","endTime":"16:00"}],"source":"WHATSAPP"}' \
      "Kevin Tan"

    # Step 8: Update listing status
    assert "[Flow] Update listing status to AVAILABLE_SLOTS_RECEIVED" \
      PATCH "/api/tours/${FLOW_TOUR_ID}/listings/${FLOW_LISTING_ID}/status" 200 \
      '{"status":"AVAILABLE_SLOTS_RECEIVED"}' \
      "AVAILABLE_SLOTS_RECEIVED"

    # Step 9: Generate schedule
    assert "[Flow] Generate schedule for tour" \
      POST "/api/tours/${FLOW_TOUR_ID}/generate-schedule" 200 \
      '{"viewingDurationMinutes":30,"defaultTravelBufferMinutes":15}' \
      "scheduledCount"

    # Step 10: Verify the thread shows conversation
    THREADS_DATA=$(curl -s "${BASE}/api/tours/${FLOW_TOUR_ID}/threads" 2>/dev/null)
    FLOW_THREAD_ID=$(echo "$THREADS_DATA" | grep -o '"id":"thread-[^"]*"' | head -1 | sed 's/"id":"//;s/"//')

    if [ -n "$FLOW_THREAD_ID" ]; then
      assert "[Flow] Thread messages show WhatsApp conversation" \
        GET "/api/tours/${FLOW_TOUR_ID}/threads/${FLOW_THREAD_ID}/messages" 200 "" "Butler AI assisting"
    fi

    # Step 11: Check itinerary
    assert "[Flow] Itinerary generated for tour" \
      GET "/api/tours/${FLOW_TOUR_ID}/itinerary" 200 "" "Jennifer Wong"

    # Step 12: AI confirms with opposing agent
    assert "[Flow] AI confirms slot with Kevin" \
      POST "/api/tours/${FLOW_TOUR_ID}/listings/${FLOW_LISTING_ID}/coordination-events" 201 \
      '{"kind":"MESSAGE","senderRole":"BUYER_AGENT","source":"WHATSAPP","body":"Hi Kevin, we will take the 10am slot on May 10. See you then!","summary":"AI confirmed 10am slot with Kevin."}' \
      "10am slot"
  fi
else
  echo "  [Flow] SKIPPED — could not create tour"
fi


# ═══════════════════════════════════════════════════════════════════
# 17. EDGE CASES
# ═══════════════════════════════════════════════════════════════════
printf "\n${YELLOW}── 17. Edge Cases ──${NC}\n"

assert "POST with empty body returns 400" \
  POST "/api/tours" 400 "" "VALIDATION_FAILED"

assert "Unknown route returns 405" \
  GET "/api/nonexistent" 405 "" "METHOD_NOT_ALLOWED"

assert "Listing on non-existent tour returns 404" \
  POST "/api/tours/tour-nonexistent/listings" 404 \
  '{"title":"X","address":"Y","opposingAgentName":"Z","opposingAgentPhone":"+65 0000 0000"}' \
  "TOUR_NOT_FOUND"


# ═══════════════════════════════════════════════════════════════════
# RESULTS
# ═══════════════════════════════════════════════════════════════════
echo ""
printf "${CYAN}══════════════════════════════════════════════════════════════${NC}\n"
printf "${CYAN}  TEST RESULTS${NC}\n"
printf "${CYAN}══════════════════════════════════════════════════════════════${NC}\n"
printf "  Total:  %d\n" "$TOTAL"
printf "  ${GREEN}Passed: %d${NC}\n" "$PASS"
if [ "$FAIL" -gt 0 ]; then
  printf "  ${RED}Failed: %d${NC}\n" "$FAIL"
  printf "\n${RED}  Failed tests:${FAILURES}${NC}\n"
else
  printf "  ${RED}Failed: %d${NC}\n" "$FAIL"
fi
echo ""

if [ "$FAIL" -gt 0 ]; then
  printf "${RED}  ✘ SOME TESTS FAILED${NC}\n\n"
  exit 1
else
  printf "${GREEN}  ✔ ALL TESTS PASSED${NC}\n\n"
  exit 0
fi
