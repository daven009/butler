/**
 * Scheduling agent tool implementations — read-only subset.
 *
 * This file ships only the 4 GET tools so the end-to-end OpenAI loop can
 * be exercised first. The propose_* (write) tools land next, once we've
 * confirmed the agent → tool → reply round-trip works.
 *
 * Each function corresponds to one tool defined in `schedulingToolDefs.ts`.
 * The dispatcher at the bottom takes a tool name + parsed JSON args and
 * returns a serializable result that we'll send back to the LLM as a
 * `role: 'tool'` message.
 */

import {
  type Listing,
  listListingsByTour,
  getTourDetail,
} from '../repositories/plansRepository';
import type { SchedulingToolName } from './schedulingToolDefs';

// ─── Helpers ────────────────────────────────────────────────────────────

function findListingByIdOrTitle(listings: Listing[], needle: string): Listing | undefined {
  // Exact id first (common case — the LLM gets ids from get_schedule).
  const byId = listings.find((l) => l.id === needle);
  if (byId) return byId;
  // Fuzzy fallback — sometimes the agent invents an id-shaped string for
  // a listing it knows by name.
  const lc = needle.toLowerCase();
  return listings.find(
    (l) => l.title.toLowerCase().includes(lc) || l.condo.toLowerCase().includes(lc),
  );
}

// ─── Read tools ─────────────────────────────────────────────────────────

async function tool_get_schedule(_args: Record<string, unknown>, tourId: string) {
  const tour = await getTourDetail(tourId);
  const listings = await listListingsByTour(tourId);
  return {
    tourTitle: tour?.title,
    targetDate: tour?.targetDate,
    totalListings: listings.length,
    scheduled: listings
      .filter((l) => l.status === 'confirmed' && l.suggestedTime)
      .map((l) => ({
        listingId: l.id,
        title: l.title,
        area: l.area,
        time: l.suggestedTime,
        agentName: l.coAgent.name,
      })),
    unscheduled: listings
      .filter((l) => l.status === 'needs-attention' || l.status === 'imported')
      .map((l) => ({
        listingId: l.id,
        title: l.title,
        area: l.area,
        reason: l.attentionReason ?? 'Not scheduled yet',
      })),
  };
}

async function tool_get_listing_detail(args: { listing_id: string }, tourId: string) {
  const listings = await listListingsByTour(tourId);
  const l = findListingByIdOrTitle(listings, args.listing_id);
  if (!l) return { error: `Listing "${args.listing_id}" not found in this tour.` };
  return {
    listingId: l.id,
    title: l.title,
    address: l.address,
    area: l.area,
    condo: l.condo,
    unitNo: l.unitNo,
    beds: l.beds,
    baths: l.baths,
    sqft: l.sqft,
    price: l.price,
    status: l.status,
    statusLabel: l.statusLabel,
    suggestedTime: l.suggestedTime ?? null,
    coAgent: l.coAgent,
    availability: l.availability ?? [],
    attentionReason: l.attentionReason ?? null,
  };
}

async function tool_get_unscheduled_reason(args: { listing_id: string }, tourId: string) {
  const listings = await listListingsByTour(tourId);
  const l = findListingByIdOrTitle(listings, args.listing_id);
  if (!l) return { error: `Listing "${args.listing_id}" not found.` };
  if (l.status === 'confirmed') {
    return {
      listingId: l.id,
      title: l.title,
      onSchedule: true,
      message: `${l.title} is scheduled at ${l.suggestedTime}.`,
    };
  }
  if (l.agentReachable === false) {
    return {
      listingId: l.id,
      title: l.title,
      onSchedule: false,
      reason: 'AGENT_UNREACHABLE',
      message: `Co-agent ${l.coAgent.name} did not respond to availability requests.`,
    };
  }
  return {
    listingId: l.id,
    title: l.title,
    onSchedule: false,
    reason: 'NO_OVERLAP',
    message:
      l.attentionReason ||
      `No overlap between buyer's availability and ${l.coAgent.name}'s offered slots.`,
    agentSlots: l.availability ?? [],
  };
}

async function tool_get_travel_time(args: { from: string; to: string }, tourId: string) {
  // We don't yet have a stored travel matrix surfaced for this; we use a
  // Haversine fallback (same one planSchedule falls back to when OneMap is
  // unavailable). Good enough for "is it 5 min or 50 min" questions.
  // TODO(M2 polish): pull real travel matrix from scheduling_runs.step_artifacts.
  const listings = await listListingsByTour(tourId);
  const resolve = (token: string) => {
    if (token === 'buyer') return null; // buyer geo not persisted yet
    const l = findListingByIdOrTitle(listings, token);
    if (!l || !l.lat || !l.lng) return null;
    return { lat: l.lat, lng: l.lng, label: l.title };
  };
  const a = resolve(args.from);
  const b = resolve(args.to);
  if (!a || !b) {
    return {
      error:
        'Could not resolve coordinates for one of the points. Travel time is unavailable until the schedule has been computed at least once.',
    };
  }
  const R = 6371;
  const toRad = (n: number) => (n * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  const distKm = 2 * R * Math.asin(Math.sqrt(h));
  return {
    fromLabel: a.label,
    toLabel: b.label,
    distanceKm: Math.round(distKm * 10) / 10,
    estimatedDriveMinutes: Math.ceil((distKm / 25) * 60), // assume 25 km/h urban
    estimatedWalkMinutes: Math.ceil((distKm / 5) * 60),
    note: 'Estimate based on straight-line distance; OneMap-based travel time would be more accurate.',
  };
}

// ─── Dispatcher ─────────────────────────────────────────────────────────

/**
 * Run a tool by name. Returns an arbitrary JSON-serializable result that
 * gets sent back to the LLM in the next assistant turn.
 *
 * Throws on:
 *   - unknown tool name (treat as agent bug; we return a synthetic error)
 *   - invalid argument shape (we let the underlying impl signal via
 *     `{error: '...'}`, since failing hard would force us to retry the
 *     whole turn for a typo).
 *
 * `propose_*` tools land in M2 phase 2; for now we throw a known marker
 * the agent loop catches and surfaces nicely.
 */
export async function runTool(
  name: SchedulingToolName,
  args: Record<string, unknown>,
  ctx: { tourId: string; sessionId: string },
): Promise<unknown> {
  switch (name) {
    case 'get_schedule':
      return tool_get_schedule(args, ctx.tourId);
    case 'get_listing_detail':
      return tool_get_listing_detail(args as { listing_id: string }, ctx.tourId);
    case 'get_unscheduled_reason':
      return tool_get_unscheduled_reason(args as { listing_id: string }, ctx.tourId);
    case 'get_travel_time':
      return tool_get_travel_time(args as { from: string; to: string }, ctx.tourId);

    // Write tools — implemented in the next M2 step. For now the LLM is
    // told these exist but calling them returns a polite placeholder so
    // the agent can apologize and ask the user to wait.
    case 'propose_reschedule':
    case 'propose_swap':
    case 'propose_drop':
    case 'propose_add_constraint':
      return {
        error:
          'PROPOSE_TOOLS_NOT_YET_IMPLEMENTED — the user can ask for changes, but applying them is being shipped in the next update. For now, only describe the proposed change in plain English; do not claim it was applied.',
      };

    default: {
      // exhaustive-check — TS will complain if we add a tool name and
      // forget to handle it here.
      const _exhaustive: never = name;
      void _exhaustive;
      return { error: `Unknown tool: ${name}` };
    }
  }
}
