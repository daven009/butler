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
 * `conversations[tourId]`. We also stamp each listing with:
 *   - `availability`: extracted seller time windows (in scheduler-friendly format)
 *   - `agentReachable`: true / false (false = unavailable / no-reply)
 *   - `status`: 'contacting' (so the UI can move it out of 'imported')
 *
 * NOTE: This is a *deterministic* mock — no LLM call required. The slot
 * extraction here uses fixed weekend dates (this Saturday / Sunday) so the
 * downstream scheduler test is reproducible.
 */

import { clone } from '../store';
import {
  listListingsByTour,
  updateListingInTour,
  replaceConversationsForTour,
} from './plansRepository';
import type {
  ConversationMessage,
  Listing,
  SellerTimeWindow,
} from './plansRepository';

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

export interface BuyerSeed {
  /** Sat + Sun broad availability windows. */
  slots: SellerTimeWindow[];
  message: string;
}

/** Default buyer availability — wide enough to overlap with most happy/partial sellers. */
function buildBuyerSeed(): BuyerSeed {
  const { sat, sun } = nextWeekendDates();
  return {
    slots: [
      { date: sat, startTime: '09:00', endTime: '13:00' },
      { date: sat, startTime: '14:00', endTime: '18:00' },
      { date: sun, startTime: '10:00', endTime: '17:00' },
    ],
    message:
      "I'm free Sat 9am–1pm and 2–6pm, also Sun 10am–5pm. Prefer to bunch the viewings together.",
  };
}

/**
 * Seed mock conversations + buyer slots for the given tour.
 * Idempotent: clears any existing conversations[tourId] first.
 */
export async function seedTourConversations(tourId: string, agentName: string = 'Dave Shen'): Promise<SeedResult> {
  const listings = await listListingsByTour(tourId);
  if (!listings.length) {
    return {
      tourId,
      totalListings: 0,
      conversationsCreated: 0,
      byScenario: { happy: 0, partial: 0, unreachable: 0, rejected: 0 },
      buyerSlots: [],
    };
  }

  const { sat, sun, satLabel, sunLabel } = nextWeekendDates();
  const messages: ConversationMessage[] = [];
  const counters: Record<ScenarioName, number> = { happy: 0, partial: 0, unreachable: 0, rejected: 0 };

  // Buyer thread is conceptually NOT tied to any specific listing — it is the
  // PA <-> buyer channel used to gather availability for the whole tour.
  // We park it under a sentinel listingId so it never bleeds into any
  // individual listing's "Listing conversation" sidebar.
  const buyer = buildBuyerSeed();
  const BUYER_THREAD_ID = '__buyer__';
  let msgSeq = 1;
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
  // Sender 'buyer' for the buyer's own message so the UI can render correctly
  // (the legacy MessageSender union may not include 'buyer'; we keep 'co-agent'
  // for type compatibility but use senderName='Buyer'.)
  messages.push(
    newMsg(BUYER_THREAD_ID, 'ai', 'AI PA',
      `Hi, before I start booking viewings for the ${listings.length} shortlisted units, what time slots work for you this weekend?`,
      ts(8, 30)),
    newMsg(BUYER_THREAD_ID, 'co-agent', 'Buyer', buyer.message, ts(8, 41)),
    newMsg(BUYER_THREAD_ID, 'ai', 'AI PA',
      `Got it. I'll target ${satLabel} morning/afternoon and ${sunLabel} daytime, then come back with a final route.`,
      ts(8, 43)),
  );

  // ─── Per-listing co-agent conversations ───
  listings.forEach((listing, idx) => {
    const scenario = pickScenario(idx);
    counters[scenario.name]++;
    const slots = scenario.slotsBuilder(sat, sun);
    const coAgentName = listing.coAgent?.name || `Co-agent ${idx + 1}`;
    const baseHour = 9 + (idx % 6);

    // 1) AI: confirm availability
    messages.push(
      newMsg(listing.id, 'ai', 'AI PA',
        `Hi ${coAgentName.split(' ')[0]}, I'm an AI assistant helping ${agentName}. Is your unit at ${listing.address || listing.title} still available for sale?`,
        ts(baseHour, 12)),
    );

    if (scenario.name === 'unreachable') {
      messages.push(
        newMsg(listing.id, 'system', 'Inbox',
          'No reply after 24h. Sent one follow-up. Still no reply — escalation will be required.',
          ts(baseHour + 1, 0)),
      );
    } else if (scenario.name === 'rejected') {
      messages.push(
        newMsg(listing.id, 'co-agent', coAgentName, scenario.reply, ts(baseHour, 18)),
        newMsg(listing.id, 'ai', 'AI PA',
          'Understood, will mark this listing as not available and move on. Thanks!',
          ts(baseHour, 20)),
      );
    } else {
      // co-agent confirms still available
      messages.push(
        newMsg(listing.id, 'co-agent', coAgentName, 'Yes still on the market!', ts(baseHour, 18)),
      );
      // AI introduces buyer + asks for slots
      messages.push(
        newMsg(listing.id, 'ai', 'AI PA',
          `Great. My client is keen to view. They are pre-approved on financing and looking to commit fast. Could you share which time slots work this weekend?\n1) ${satLabel} morning 9–12\n2) ${satLabel} afternoon 12–3\n3) ${sunLabel} daytime 10–5\n4) ${sunLabel} evening 7–9`,
          ts(baseHour, 22)),
      );
      // co-agent picks
      messages.push(
        newMsg(listing.id, 'co-agent', coAgentName, scenario.reply, ts(baseHour, 41)),
      );
      // AI acknowledges
      messages.push(
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
  });

  // Persist conversations (replace all for this tour)
  await replaceConversationsForTour(tourId, messages);

  // Persist per-listing availability/agentReachable/status updates
  for (const l of listings) {
    await updateListingInTour(tourId, l.id, {
      availability: l.availability,
      agentReachable: l.agentReachable,
      status: l.status,
      statusLabel: l.statusLabel,
      attentionReason: l.attentionReason,
    });
  }

  return {
    tourId,
    totalListings: listings.length,
    conversationsCreated: messages.length,
    byScenario: counters,
    buyerSlots: buyer.slots,
  };
}

/** Get the buyer's mock slots for this tour (currently shared across tours). */
export function getBuyerSlotsForTour(_tourId: string): SellerTimeWindow[] {
  return clone(buildBuyerSeed().slots);
}
