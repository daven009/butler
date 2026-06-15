/**
 * Mock conversation seeding for a Tour.
 *
 * For every listing under the given tour we generate a short WhatsApp-style
 * thread between our AI assistant and the opposing co-agent. Roughly:
 *   - 50% are happy path → co-agent gives 1–2 specific slots
 *   - 25% are partial   → co-agent only gives 1 narrow slot (may not intersect
 *                         with buyer's window)
 *   - 15% are unreachable → co-agent never replies (or replies "let me check")
 *   - 10% are rejected   → unit already sold/rented
 *
 * The conversations are persisted into the same butler-web-store.json under
 * `conversations[tourId]`. We also prepare each listing with:
 *   - `availability`: extracted seller time windows (in scheduler-friendly format)
 *   - `agentReachable`: true / false (false = unavailable / no-reply)
 *   - `status`: 'contacting' when scheduling actually starts
 *
 * Import callers defer the status change so mock data is ready without
 * making a newly imported listing appear to have started coordination.
 *
 * NOTE: This is a *deterministic* mock — no LLM call required. The slot
 * extraction here uses fixed weekend dates (this Saturday / Sunday) so the
 * downstream scheduler test is reproducible.
 */

import {
  listListingsByTour,
  getTourDetail,
  updateListingInTour,
  appendConversationsForTour,
  listConversationsByTour,
  replaceConversationsForTour,
} from './plansRepository';
import type {
  ConversationMessage,
  Listing,
  SellerTimeWindow,
} from './plansRepository';
import { expandTourAvailability } from '../tourAvailability';
import { readStoredTourAvailability } from '../tourAvailability';
import { findSlotIntersections, windowDurationMinutes } from '../scheduling/timeUtils';

/* ─── Date helpers ─── */

function nextWeekendDates(reference = new Date()): { sat: string; sun: string; satLabel: string; sunLabel: string } {
  const ref = new Date(reference);
  const dow = ref.getDay(); // 0 sun .. 6 sat
  const daysUntilSat = (6 - dow + 7) % 7 || 7;
  const sat = new Date(ref);
  sat.setDate(ref.getDate() + daysUntilSat);
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const label = (d: Date) =>
    d.toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short' });
  return { sat: iso(sat), sun: iso(sun), satLabel: label(sat), sunLabel: label(sun) };
}

/* ─── Scenario templates ─── */

type ScenarioName = 'happy' | 'partial' | 'unreachable' | 'rejected';

interface Scenario {
  name: ScenarioName;
  agentReachable: boolean;
  /** Final co-agent response text (Singlish). */
  reply: string;
  /** Slot windows the co-agent is offering. May be empty. */
  slotsBuilder: (sat: string, sun: string) => SellerTimeWindow[];
}

const SCENARIOS: Scenario[] = [
  {
    name: 'happy',
    agentReachable: true,
    reply: 'Saturday morning works! I can do 9–12. Sunday afternoon also ok.',
    slotsBuilder: (sat, sun) => [
      { date: sat, startTime: '09:00', endTime: '12:00' },
      { date: sun, startTime: '14:00', endTime: '17:00' },
    ],
  },
  {
    name: 'happy',
    agentReachable: true,
    reply: 'Ya can. Sat afternoon 12–3pm, or Sun morning 10–12 also possible.',
    slotsBuilder: (sat, sun) => [
      { date: sat, startTime: '12:00', endTime: '15:00' },
      { date: sun, startTime: '10:00', endTime: '12:00' },
    ],
  },
  {
    name: 'happy',
    agentReachable: true,
    reply: 'This weekend best is Sat 10–12. Confirm with owner if needed.',
    slotsBuilder: (sat) => [{ date: sat, startTime: '10:00', endTime: '12:00' }],
  },
  {
    name: 'partial',
    agentReachable: true,
    reply: 'Only Sunday 7–9pm works for me, sorry.',
    slotsBuilder: (_sat, sun) => [{ date: sun, startTime: '19:00', endTime: '21:00' }],
  },
  {
    name: 'partial',
    agentReachable: true,
    reply: 'Need to check with owner first, but maybe Sat after 5pm.',
    slotsBuilder: (sat) => [{ date: sat, startTime: '17:00', endTime: '18:00' }],
  },
  {
    name: 'unreachable',
    agentReachable: false,
    reply: '(no reply after 24h follow-up)',
    slotsBuilder: () => [],
  },
  {
    name: 'rejected',
    agentReachable: false,
    reply: 'Sorry the unit is already sold last week.',
    slotsBuilder: () => [],
  },
];

/** Distribution: 3 happy / 2 partial / 1 unreachable / 1 rejected = 7 buckets. */
function pickScenario(idx: number): Scenario {
  return SCENARIOS[idx % SCENARIOS.length];
}

/* ─── Public API ─── */

export interface SeedResult {
  tourId: string;
  totalListings: number;
  conversationsCreated: number;
  byScenario: Record<ScenarioName, number>;
  buyerSlots: SellerTimeWindow[];
}

/**
 * Seed mock conversations + buyer slots for the given tour.
 *
 * **Idempotent at the listing level** (changed 2026-06-06): listings
 * for which the conversations table already has a per-listing thread
 * are skipped.
 * Only freshly-imported listings get a new mock conversation drafted.
 *
 * The buyer thread (under the `__buyer__` sentinel) is also seeded only
 * once per tour. This makes "Re-run AI scheduling" deterministic and
 * makes "Import another listing" the natural trigger for seeding.
 *
 * Pass `force: true` to bypass the cache and re-seed everything (used
 * by an internal admin path / debugging only). Import callers pass
 * `deferSchedulingState: true` to keep new listings in `imported`.
 */
export async function seedTourConversations(
  tourId: string,
  agentName: string = 'Dave Shen',
  options: { force?: boolean; deferSchedulingState?: boolean } = {},
): Promise<SeedResult> {
  const force = options.force === true;
  const deferSchedulingState = options.deferSchedulingState === true;
  const listings = await listListingsByTour(tourId);
  const tour = await getTourDetail(tourId);
  if (!listings.length) {
    return {
      tourId,
      totalListings: 0,
      conversationsCreated: 0,
      byScenario: { happy: 0, partial: 0, unreachable: 0, rejected: 0 },
      buyerSlots: [],
    };
  }

  // Conversation rows are the source of truth for whether a listing has
  // been seeded. Availability alone is insufficient: null DB values used
  // to be normalised to [] and caused fresh imports to be skipped.
  const existingMessages = force
    ? []
    : await listConversationsByTour(tourId);
  const seededListingIds = new Set<string>();
  if (!force) {
    for (const m of existingMessages) {
      if (m.listingId && m.listingId !== '__buyer__') seededListingIds.add(m.listingId);
    }
  }
  const buyerThreadAlreadyExists =
    !force && existingMessages.some((m) => m.listingId === '__buyer__');

  const buyerSlots = tour ? expandTourAvailability(tour.targetDate, tour.timeWindow) : [];
  const fallbackWeekend = nextWeekendDates();
  const buyerDates = [...new Set(buyerSlots.map((slot) => slot.date))].sort();
  const sat = buyerDates[0] || fallbackWeekend.sat;
  const nextDay = new Date(`${sat}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const sun = Number.isNaN(nextDay.getTime())
    ? fallbackWeekend.sun
    : nextDay.toISOString().slice(0, 10);
  const dateLabel = (value: string) => {
    const parsed = new Date(`${value}T00:00:00`);
    return Number.isNaN(parsed.getTime())
      ? value
      : parsed.toLocaleDateString('en-SG', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });
  };
  const satLabel = dateLabel(sat);
  const sunLabel = dateLabel(sun);
  const newMessages: ConversationMessage[] = [];
  const counters: Record<ScenarioName, number> = { happy: 0, partial: 0, unreachable: 0, rejected: 0 };

  // Buyer thread is conceptually NOT tied to any specific listing — it is the
  // PA <-> buyer channel used to gather availability for the whole tour.
  // We park it under a sentinel listingId so it never bleeds into any
  // individual listing's "Listing conversation" sidebar.
  const buyer = {
    slots: buyerSlots,
    message: buyerSlots.length
      ? `I'm available ${buyerSlots.map((slot) => `${slot.date} ${slot.startTime}–${slot.endTime}`).join(', ')}.`
      : 'I have not provided availability yet.',
  };
  const BUYER_THREAD_ID = '__buyer__';
  let msgSeq = Date.now() % 100000; // avoid id collisions across re-seed calls
  const ts = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  const newMsg = (
    listingId: string,
    sender: ConversationMessage['sender'],
    senderName: string,
    body: string,
    timestamp: string,
  ): ConversationMessage => ({
    id: `m-${tourId}-${msgSeq++}`,
    listingId,
    sender,
    senderName,
    body,
    timestamp,
  });

  // ─── Buyer-side conversation ───
  // Seeded only the FIRST time. On subsequent imports the buyer thread
  // is already there — skip to avoid duplicating it.
  if (!buyerThreadAlreadyExists) {
    newMessages.push(
      newMsg(BUYER_THREAD_ID, 'ai', 'AI PA',
        `Hi, before I start booking viewings for the ${listings.length} shortlisted units, what time slots work for you?`,
        ts(8, 30)),
      newMsg(BUYER_THREAD_ID, 'co-agent', 'Buyer', buyer.message, ts(8, 41)),
      newMsg(BUYER_THREAD_ID, 'ai', 'AI PA',
        `Got it. I'll use those availability windows and come back with a final route.`,
        ts(8, 43)),
    );
  }

  // Track which listings actually had their state mutated this call,
  // so we only persist updates for those rows (avoids needless writes
  // and keeps locked listings untouched).
  const mutatedListingIds = new Set<string>();
  let freshListingIndex = 0;

  // ─── Per-listing co-agent conversations ───
  listings.forEach((listing, idx) => {
    // Already-seeded listing: skip entirely so the conversation thread
    // stays exactly as it was first generated. (This is the whole point
    // of the 2026-06-06 change — debugging is hard when mock data
    // changes under you on every re-run.)
    if (seededListingIds.has(listing.id)) {
      if (!deferSchedulingState && listing.status === 'imported') {
        listing.status = listing.agentReachable === false ? 'needs-attention' : 'contacting';
        listing.statusLabel =
          listing.agentReachable === false ? 'Co-agent unavailable' : 'Contacting co-agent';
        listing.attentionReason =
          listing.agentReachable === false
            ? 'Co-agent is unavailable or did not respond. Review before scheduling.'
            : undefined;
        mutatedListingIds.add(listing.id);
      }
      return;
    }

    // Scenario distribution belongs to this seed batch, not to the
    // listing's absolute position in the Tour. Otherwise adding the 6th
    // and 7th listings always produced unreachable/rejected results.
    const scenario = pickScenario(freshListingIndex++);
    counters[scenario.name]++;
    const slots = scenario.slotsBuilder(sat, sun);
    const coAgentName = listing.coAgent?.name || `Co-agent ${idx + 1}`;
    const baseHour = 9 + (idx % 6);

    // 1) AI: confirm availability
    newMessages.push(
      newMsg(listing.id, 'ai', 'AI PA',
        `Hi ${coAgentName.split(' ')[0]}, I'm an AI assistant helping ${agentName}. Is your unit at ${listing.address || listing.title} still available for sale?`,
        ts(baseHour, 12)),
    );

    if (scenario.name === 'unreachable') {
      newMessages.push(
        newMsg(listing.id, 'system', 'Inbox',
          'No reply after 24h. Sent one follow-up. Still no reply — escalation will be required.',
          ts(baseHour + 1, 0)),
      );
    } else if (scenario.name === 'rejected') {
      newMessages.push(
        newMsg(listing.id, 'co-agent', coAgentName, scenario.reply, ts(baseHour, 18)),
        newMsg(listing.id, 'ai', 'AI PA',
          'Understood, will mark this listing as not available and move on. Thanks!',
          ts(baseHour, 20)),
      );
    } else {
      // co-agent confirms still available
      newMessages.push(
        newMsg(listing.id, 'co-agent', coAgentName, 'Yes still on the market!', ts(baseHour, 18)),
      );
      // AI introduces buyer + asks for slots
      newMessages.push(
        newMsg(listing.id, 'ai', 'AI PA',
          `Great. My client is keen to view. They are pre-approved on financing and looking to commit fast. Could you share which time slots work this weekend?\n1) ${satLabel} morning 9–12\n2) ${satLabel} afternoon 12–3\n3) ${sunLabel} daytime 10–5\n4) ${sunLabel} evening 7–9`,
          ts(baseHour, 22)),
      );
      // co-agent picks
      newMessages.push(
        newMsg(listing.id, 'co-agent', coAgentName, scenario.reply, ts(baseHour, 41)),
      );
      // AI acknowledges
      newMessages.push(
        newMsg(listing.id, 'ai', 'AI PA',
          slots.length
            ? `Noted. I'll lock in a 30-min slot inside that window once I cross-check with the other viewings nearby.`
            : `Hmm, that doesn't fit my client's availability. Let me come back if we can stretch the window.`,
          ts(baseHour, 44)),
      );
    }

    // Stamp the listing with availability + reachability + status
    listing.availability = slots;
    listing.agentReachable = scenario.agentReachable;
    if (!deferSchedulingState) {
      listing.status = scenario.name === 'rejected' || scenario.name === 'unreachable' ? 'needs-attention' : 'contacting';
      listing.statusLabel = scenario.name === 'rejected'
        ? 'Unit no longer available'
        : scenario.name === 'unreachable'
          ? 'Co-agent not responding'
          : 'Contacting co-agent';
      listing.attentionReason = scenario.name === 'rejected'
        ? 'Co-agent reports the unit is already sold. Confirm before notifying buyer.'
        : scenario.name === 'unreachable'
          ? 'Co-agent did not respond within 24h despite a follow-up. Decide: keep waiting / call yourself / drop.'
          : undefined;
    }
    mutatedListingIds.add(listing.id);
  });

  // Persist conversations — append-only for normal seed-on-import.
  // Force mode explicitly replaces the whole tour's mock history.
  if (force) {
    await replaceConversationsForTour(tourId, newMessages);
  } else {
    await appendConversationsForTour(tourId, newMessages);
  }

  // Persist per-listing availability/agentReachable/status updates —
  // ONLY for listings we actually mutated this call. Skipping locked
  // listings (M4) and already-seeded listings keeps their snapshots
  // exactly as first generated, which is what makes "Re-run AI
  // scheduling" deterministic.
  for (const l of listings) {
    if (!mutatedListingIds.has(l.id)) continue;
    await updateListingInTour(tourId, l.id, {
      availability: l.availability,
      agentReachable: l.agentReachable,
      ...(!deferSchedulingState
        ? {
            status: l.status,
            statusLabel: l.statusLabel,
            attentionReason: l.attentionReason,
          }
        : {}),
    });
  }

  return {
    tourId,
    totalListings: listings.length,
    conversationsCreated: newMessages.length,
    byScenario: counters,
    buyerSlots: buyer.slots,
  };
}

/** Parse the buyer's persisted availability from the Tour. */
export async function getBuyerSlotsForTour(
  tourId: string,
  candidateDates?: string[],
): Promise<SellerTimeWindow[]> {
  const tour = await getTourDetail(tourId);
  if (!tour) return [];
  return expandTourAvailability(tour.targetDate, tour.timeWindow, candidateDates);
}

function formatWindows(windows: SellerTimeWindow[]): string {
  return windows
    .map((slot) => `${slot.date} ${slot.startTime}–${slot.endTime}`)
    .join('、');
}

/**
 * Resolve hard availability mismatches immediately after seller availability
 * is seeded. These listings cannot be fixed by route preferences, so they
 * should not enter the scheduling-constraint conversation.
 */
export async function markAvailabilityMismatches(tourId: string): Promise<string[]> {
  const tour = await getTourDetail(tourId);
  if (!tour) return [];
  const listings = await listListingsByTour(tourId);
  const sellerDates = listings.flatMap((listing) =>
    (listing.availability || []).map((slot) => slot.date),
  );
  const buyerSlots = await getBuyerSlotsForTour(tourId, sellerDates);
  if (!buyerSlots.length) {
    console.warn(
      '[availability] skipped mismatch classification because buyer availability is invalid',
      { tourId, targetDate: tour.targetDate },
    );
    return [];
  }
  const buyerSummary =
    readStoredTourAvailability(tour.targetDate, tour.timeWindow)?.summary ||
    tour.timeWindow;
  const updatedIds: string[] = [];

  for (const listing of listings) {
    if (listing.status === 'confirmed') continue;
    const sellerSlots = listing.availability || [];
    if (!sellerSlots.length) {
      const reason =
        `卖家中介尚未提供 ${listing.title} 的任何可用看房时段，` +
        `因此无法与买家可看时间（${buyerSummary}）进行匹配。请先联系卖家中介确认可用时间。`;
      await updateListingInTour(tourId, listing.id, {
        status: 'needs-attention',
        statusLabel: '无法排期',
        suggestedTime: 'Pending',
        attentionReason: reason,
      });
      updatedIds.push(listing.id);
      continue;
    }
    const listingBuyerSlots = buyerSlots.filter((slot) =>
      sellerSlots.some((sellerSlot) => sellerSlot.date === slot.date),
    );
    const hasViewingWindow = findSlotIntersections(listingBuyerSlots, sellerSlots)
      .some((window) => windowDurationMinutes(window) >= 30);
    if (hasViewingWindow) {
      if (listing.status === 'needs-attention' && listing.statusLabel === '无法排期') {
        await updateListingInTour(tourId, listing.id, {
          status: 'imported',
          statusLabel: 'Imported',
          suggestedTime: 'Pending',
          attentionReason: null,
        });
        updatedIds.push(listing.id);
      }
      continue;
    }

    const reason =
      `买家可看时间（${buyerSummary}）与卖家中介可用时间（${formatWindows(sellerSlots)}）` +
      '没有至少 30 分钟重叠，当前无法排期。请调整买家时间，或联系卖家中介确认其他时段。';
    await updateListingInTour(tourId, listing.id, {
      status: 'needs-attention',
      statusLabel: '无法排期',
      suggestedTime: 'Pending',
      attentionReason: reason,
    });
    updatedIds.push(listing.id);
  }

  return updatedIds;
}
