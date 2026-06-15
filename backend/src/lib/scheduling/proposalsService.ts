/**
 * Schedule change proposal lifecycle.
 *
 * Two roles:
 *  1. **Proposal builders** — called by the propose_* tools (the LLM).
 *     They compute what *would* change without touching `listings`, write
 *     a `schedule_change_proposals` row, and return it. The chat UI then
 *     renders the change card with Apply/Discard.
 *  2. **Apply** — called by `POST /scheduling-proposals/:id/apply` after
 *     the user clicks Apply. Mutates `listings` according to the proposal,
 *     marks `applied_at`. The proposal stays in the table forever as an
 *     audit log.
 *
 * Two-stage replan strategy (PRD §8.6.3):
 *   - Stage 1 ("local"): the only listing changing is the requested one.
 *     If the new slot doesn't conflict with another scheduled listing's
 *     slot on the same date, we ship a single-entry change list. Done.
 *   - Stage 2 ("full"): constraint proposals re-run planSchedule and store
 *     the complete diff. Exact-time moves with multiple conflicts still
 *     produce a manual-review proposal with unknown cascade destinations.
 *
 * Time format: new schedules store "YYYY-MM-DD HH:MM – HH:MM".
 * Legacy single-day values without a date remain readable.
 */

import {
  type Listing,
  getTourDetail,
  listListingsByTour,
} from '../repositories/plansRepository';
import { getBuyerSlotsForTour } from '../repositories/conversationsMock';
import {
  type ScheduleChangeProposal,
  type ProposalChange,
  createProposal,
  getProposal,
  listReadyListingBriefs,
  markProposalApplied,
} from '../repositories/schedulingSessionsRepository';
import { supabaseForUser } from '../supabase';
import { getCurrentJwt } from '../userContext';
import { planSchedule } from './planSchedule';
import type { TimeWindow } from './timeUtils';

const DEFAULT_VIEWING_MINUTES = 30;

function db() {
  return supabaseForUser(getCurrentJwt());
}

// ─── Time helpers ───────────────────────────────────────────────────────

function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function fmtMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function makeSlot(
  startHHMM: string,
  date?: string,
  durationMin = DEFAULT_VIEWING_MINUTES,
): string | null {
  const start = parseHHMM(startHHMM);
  if (start == null) return null;
  return `${date ? `${date} ` : ''}${fmtMinutes(start)} – ${fmtMinutes(start + durationMin)}`;
}

/**
 * Parse `listing.suggestedTime` like "10:00 – 10:30" → {start, end} in minutes.
 * Returns null when the listing isn't currently scheduled.
 */
function parseSlot(
  slot: string | null | undefined,
): { date?: string; start: number; end: number } | null {
  if (!slot || slot === 'Pending') return null;
  // Accept en-dash, hyphen, or "to" as separator; tolerant.
  const match = /(\d{1,2}:\d{2})\s*[–\-to]+\s*(\d{1,2}:\d{2})/.exec(slot);
  if (!match) return null;
  const a = parseHHMM(match[1]);
  const b = parseHHMM(match[2]);
  if (a == null || b == null) return null;
  const date = /^(\d{4}-\d{2}-\d{2})\s+/.exec(slot)?.[1];
  return { date, start: a, end: b };
}

function findListing(listings: Listing[], idOrName: string): Listing | undefined {
  const byId = listings.find((l) => l.id === idOrName);
  if (byId) return byId;
  const lc = idOrName.toLowerCase();
  return listings.find(
    (l) => l.title.toLowerCase().includes(lc) || l.condo.toLowerCase().includes(lc),
  );
}

function inferScheduledDate(
  listing: Listing,
  slot: { date?: string; start: number; end: number },
): string | undefined {
  if (slot.date) return slot.date;
  return (listing.availability || []).find((window) => {
    const start = parseHHMM(window.startTime);
    const end = parseHHMM(window.endTime);
    return start != null && end != null && slot.start >= start && slot.end <= end;
  })?.date;
}

function subtractLockedViewings(
  buyerSlots: TimeWindow[],
  confirmedListings: Listing[],
  bufferMinutes: number,
): TimeWindow[] {
  return confirmedListings.reduce((slots, listing) => {
    const scheduled = parseSlot(listing.suggestedTime);
    if (!scheduled) return slots;
    const date = inferScheduledDate(listing, scheduled);
    if (!date) return slots;
    return slots.flatMap((slot) => {
      if (slot.date !== date) return [slot];
      return subtractWindow(
        slot,
        Math.max(0, scheduled.start - bufferMinutes),
        Math.min(24 * 60, scheduled.end + bufferMinutes),
      );
    });
  }, buyerSlots);
}

// ─── Conflict detection ─────────────────────────────────────────────────

/**
 * Would a new slot for `listingId` conflict with any other CURRENTLY
 * scheduled listing in the same tour? Returns the conflicting listing(s)
 * (excluding the one being moved, since it's about to leave its old slot).
 */
function findConflicts(
  listings: Listing[],
  excludeListingId: string,
  date: string | undefined,
  newStart: number,
  newEnd: number,
): Listing[] {
  return listings.filter((l) => {
    if (l.id === excludeListingId) return false;
    if (l.status !== 'confirmed') return false;
    const existing = parseSlot(l.suggestedTime);
    if (!existing) return false;
    if (date && existing.date && date !== existing.date) return false;
    // Overlap: not (newEnd <= existing.start || newStart >= existing.end)
    return newStart < existing.end && newEnd > existing.start;
  });
}

// ─── propose_reschedule ─────────────────────────────────────────────────

export interface ProposeRescheduleArgs {
  listing_id: string;
  new_start: string;
  date?: string;
}

export async function buildRescheduleProposal(
  args: ProposeRescheduleArgs,
  ctx: { tourId: string; sessionId: string },
): Promise<ScheduleChangeProposal | { error: string }> {
  const listings = await listListingsByTour(ctx.tourId);
  const listing = findListing(listings, args.listing_id);
  if (!listing) return { error: `Listing "${args.listing_id}" not found in this tour.` };

  const currentDate = parseSlot(listing.suggestedTime)?.date;
  const requestedDate = args.date || currentDate;
  const newSlot = makeSlot(args.new_start, requestedDate);
  if (!newSlot) {
    return { error: `Invalid time format "${args.new_start}". Use HH:MM (e.g. "11:00").` };
  }
  const newStart = parseHHMM(args.new_start)!;
  const newEnd = newStart + DEFAULT_VIEWING_MINUTES;

  const before = listing.suggestedTime ?? null;
  const conflicts = findConflicts(listings, listing.id, requestedDate, newStart, newEnd);
  const change: ProposalChange = {
    listingId: listing.id,
    listingLabel: listing.title,
    action: 'reschedule',
    from: before,
    to: newSlot,
  };

  if (conflicts.length === 0) {
    // Stage 1 — clean local move.
    return createProposal(ctx.sessionId, {
      intentSummary: `Move ${listing.title} to ${newSlot}`,
      mode: 'local',
      changes: [change],
      cascade: [],
    });
  }

  // Stage 1.5 — exactly one conflict and the listing being moved is also
  // currently scheduled → auto-promote to a SWAP. This is what the user
  // almost always wants when they say "move A to <B's time>": A and B
  // simply trade slots. We ship it as a single mode='local' proposal so
  // Apply works in one click.
  if (conflicts.length === 1 && listing.suggestedTime) {
    const other = conflicts[0];
    return createProposal(ctx.sessionId, {
      intentSummary: `Swap ${listing.title} and ${other.title}`,
      mode: 'local',
      changes: [
        change,
        {
          listingId: other.id,
          listingLabel: other.title,
          action: 'reschedule',
          from: other.suggestedTime ?? null,
          to: listing.suggestedTime,
        },
      ],
      cascade: [],
    });
  }

  // Exact-time hard constraints are not supported by planSchedule yet.
  // Keep this visible for manual review, but Apply rejects the intentionally
  // unknown cascade destinations.
  return createProposal(ctx.sessionId, {
    intentSummary:
      `Move ${listing.title} to ${newSlot} — but it conflicts with ${conflicts.map((c) => c.title).join(', ')}. Exact-time cascade planning is not available yet.`,
    mode: 'full',
    changes: [change],
    cascade: conflicts.map((c) => ({
      listingId: c.id,
      listingLabel: c.title,
      action: 'reschedule' as const,
      from: c.suggestedTime ?? null,
      to: null, // unknown — would be set by full replan
    })),
  });
}

// ─── propose_swap ───────────────────────────────────────────────────────

export interface ProposeSwapArgs {
  listing_id_a: string;
  listing_id_b: string;
}

export async function buildSwapProposal(
  args: ProposeSwapArgs,
  ctx: { tourId: string; sessionId: string },
): Promise<ScheduleChangeProposal | { error: string }> {
  const listings = await listListingsByTour(ctx.tourId);
  const a = findListing(listings, args.listing_id_a);
  const b = findListing(listings, args.listing_id_b);
  if (!a) return { error: `Listing "${args.listing_id_a}" not found.` };
  if (!b) return { error: `Listing "${args.listing_id_b}" not found.` };
  if (a.status !== 'confirmed' || !a.suggestedTime) {
    return { error: `${a.title} isn't currently scheduled, so there's nothing to swap.` };
  }
  if (b.status !== 'confirmed' || !b.suggestedTime) {
    return { error: `${b.title} isn't currently scheduled, so there's nothing to swap.` };
  }
  return createProposal(ctx.sessionId, {
    intentSummary: `Swap times for ${a.title} and ${b.title}`,
    mode: 'local',
    changes: [
      { listingId: a.id, listingLabel: a.title, action: 'reschedule', from: a.suggestedTime, to: b.suggestedTime },
      { listingId: b.id, listingLabel: b.title, action: 'reschedule', from: b.suggestedTime, to: a.suggestedTime },
    ],
    cascade: [],
  });
}

// ─── propose_drop ───────────────────────────────────────────────────────

export interface ProposeDropArgs {
  listing_id: string;
  reason?: string;
}

export async function buildDropProposal(
  args: ProposeDropArgs,
  ctx: { tourId: string; sessionId: string },
): Promise<ScheduleChangeProposal | { error: string }> {
  const listings = await listListingsByTour(ctx.tourId);
  const listing = findListing(listings, args.listing_id);
  if (!listing) return { error: `Listing "${args.listing_id}" not found.` };
  return createProposal(ctx.sessionId, {
    intentSummary:
      `Drop ${listing.title} from this tour${args.reason ? ` — ${args.reason}` : ''}`,
    mode: 'local',
    changes: [
      {
        listingId: listing.id,
        listingLabel: listing.title,
        action: 'drop',
        from: listing.suggestedTime ?? null,
        to: null,
      },
    ],
    cascade: [],
  });
}

// ─── propose_add_constraint ─────────────────────────────────────────────
// Constraints run planSchedule against narrowed buyer/listing availability,
// then store the complete before/after diff for user approval.

export interface SchedulingConstraint {
  type: 'include_listing' | 'preserve_confirmed' | 'before_time' | 'after_time' | 'exclude_time_window' | 'must_morning' | 'must_afternoon';
  scope?: 'listing' | 'tour';
  listing_id?: string;
  value?: string;
  end_value?: string;
}

export interface ProposeAddConstraintArgs extends Partial<SchedulingConstraint> {
  constraints?: SchedulingConstraint[];
}

export async function buildAddConstraintProposal(
  args: ProposeAddConstraintArgs,
  ctx: { tourId: string; sessionId: string; focusedListingId?: string },
): Promise<ScheduleChangeProposal | { error: string }> {
  const submittedConstraints = normalizeConstraints(args);
  let constraints = submittedConstraints;
  if (!constraints.length) {
    return { error: 'Invalid constraint specification.' };
  }
  const tour = await getTourDetail(ctx.tourId);
  if (!tour) return { error: 'Tour not found.' };
  const listings = await listListingsByTour(ctx.tourId);
  const focusedListingId =
    ctx.focusedListingId ||
    constraints.find((constraint) => constraint.listing_id)?.listing_id;
  const focusedListing = focusedListingId
    ? findListing(listings, focusedListingId)
    : undefined;
  if (focusedListingId && !focusedListing) {
    return { error: `Listing "${focusedListingId}" not found in this tour.` };
  }
  if (ctx.focusedListingId && focusedListing?.status !== 'confirmed') {
    const explicitListingIds = constraints
      .filter((constraint) =>
        ['include_listing', 'must_morning', 'must_afternoon'].includes(constraint.type),
      )
      .map((constraint) => constraint.listing_id)
      .filter((listingId): listingId is string => Boolean(listingId));
    const mismatchedListingId = explicitListingIds.find(
      (listingId) => listingId !== ctx.focusedListingId,
    );
    if (mismatchedListingId) {
      return {
        error:
          `The proposal targeted listing "${mismatchedListingId}", but the user is briefing ` +
          `"${ctx.focusedListingId}". No proposal was created.`,
      };
    }
    if (!explicitListingIds.includes(ctx.focusedListingId)) {
      constraints = [
        { type: 'include_listing', listing_id: ctx.focusedListingId },
        ...constraints,
      ];
    }
  }
  const readyBriefs = ctx.focusedListingId
    ? await listReadyListingBriefs(ctx.tourId)
    : [];
  if (readyBriefs.length) {
    constraints = readyBriefs.flatMap((brief) =>
      brief.constraints
        .filter(isSchedulingConstraint)
        .map((constraint) => {
          if (
            constraint.scope === 'tour' ||
            constraint.type === 'include_listing' ||
            constraint.type === 'preserve_confirmed'
          ) {
            return constraint;
          }
          return {
            ...constraint,
            scope: 'listing' as const,
            listing_id: constraint.listing_id ?? brief.listingId,
          };
        }),
    );
  }
  const summaries = constraints.map(describeConstraint);
  if (summaries.some((summary) => !summary)) {
    return { error: 'Invalid constraint specification.' };
  }
  const summary = summaries.join('; ');
  if (focusedListing && !(focusedListing.availability || []).length) {
    return {
      error:
        `${focusedListing.title} cannot be scheduled because the co-agent has not provided ` +
        'any available viewing time. Confirm seller availability before trying to add it to the tour.',
    };
  }
  const readyListingIds = new Set(
    readyBriefs.map((brief) => brief.listingId),
  );
  if (focusedListingId) readyListingIds.add(focusedListingId);
  const lockedConfirmed = listings.filter(
    (listing) => listing.status === 'confirmed' && Boolean(listing.suggestedTime),
  );
  const readyCandidates = listings.filter(
    (listing) =>
      readyListingIds.has(listing.id) &&
      listing.status !== 'confirmed' &&
      listing.agentReachable !== false &&
      (listing.availability || []).length > 0,
  );
  for (const constraint of constraints) {
    if (
      ['include_listing', 'must_morning', 'must_afternoon'].includes(constraint.type) &&
      !constraint.listing_id
    ) {
      return { error: `${constraint.type} requires listing_id.` };
    }
  }

  const sellerDates = [...lockedConfirmed, ...readyCandidates].flatMap((listing) =>
    (listing.availability || []).map((slot) => slot.date),
  );
  const allBuyerSlots = await getBuyerSlotsForTour(ctx.tourId, sellerDates);
  const constrainedBuyerSlots = constraints.reduce(
    (slots, constraint) => constrainBuyerSlots(slots, constraint),
    allBuyerSlots,
  );
  const buyerSlots = subtractLockedViewings(
    constrainedBuyerSlots,
    lockedConfirmed,
    15,
  );
  if (!buyerSlots.length) {
    return {
      error:
        'No buyer availability remains after applying the ready listing briefs and preserving confirmed viewings.',
    };
  }
  const result = await planSchedule({
    buyerSlots,
    listings: [...readyCandidates]
      .sort((a, b) => {
        const aPriority = readyBriefs.find((brief) => brief.listingId === a.id)?.priority ?? 'normal';
        const bPriority = readyBriefs.find((brief) => brief.listingId === b.id)?.priority ?? 'normal';
        const priorityRank = { high: 0, normal: 1, low: 2 };
        if (priorityRank[aPriority] !== priorityRank[bPriority]) {
          return priorityRank[aPriority] - priorityRank[bPriority];
        }
        if (!focusedListing) return 0;
        if (a.id === focusedListing.id) return -1;
        if (b.id === focusedListing.id) return 1;
        return 0;
      })
      .map((listing) => ({
      listingId: listing.id,
      address: listing.address || listing.title,
      lat: listing.lat,
      lng: listing.lng,
      agentName: listing.coAgent?.name || 'Unknown',
      availableSlots: constraints.reduce(
        (slots, constraint) => constrainListingSlots(
          slots,
          constraint,
          listing.id === constraint.listing_id,
        ),
        (listing.availability || []).map((slot) => ({ ...slot })),
      ),
      })),
    config: {
      useOneMap: false,
      viewingDurationMinutes: DEFAULT_VIEWING_MINUTES,
      bufferMinutes: 15,
    },
  });

  const scheduledById = new Map(
    result.schedule.map((item) => [
      item.listingId,
      `${item.date} ${item.startTime} – ${item.endTime}`,
    ]),
  );
  const lockedSchedule = lockedConfirmed.flatMap((listing) => {
    const slot = parseSlot(listing.suggestedTime);
    if (!slot) return [];
    const date = inferScheduledDate(listing, slot);
    return date
      ? [{
          listingId: listing.id,
          date,
          startTime: fmtMinutes(slot.start),
          endTime: fmtMinutes(slot.end),
        }]
      : [];
  });
  const scheduleConflict = findScheduleConflict([...lockedSchedule, ...result.schedule]);
  if (scheduleConflict) return { error: scheduleConflict };
  const unscheduledById = new Map(
    result.unschedulable.map((item) => [item.listingId, item.reason]),
  );
  if (
    focusedListing &&
    constraints.some((constraint) =>
      ['include_listing', 'must_morning', 'must_afternoon'].includes(constraint.type) &&
      constraint.listing_id === focusedListing.id
    ) &&
    !scheduledById.has(focusedListing.id)
  ) {
    const focusedAvailability = (focusedListing.availability || [])
      .map((slot) => `${slot.date} ${slot.startTime}–${slot.endTime}`)
      .join(', ');
    const buyerAvailability = allBuyerSlots
      .map((slot) => `${slot.date} ${slot.startTime}–${slot.endTime}`)
      .join(', ');
    return {
      error:
        `${focusedListing.title} cannot be scheduled on the buyer's available dates. ` +
        `Co-agent availability: ${focusedAvailability || 'none provided'}. ` +
        `Buyer availability: ${buyerAvailability || 'none'}. ` +
        `Scheduler reason: ${unscheduledById.get(focusedListing.id) ?? 'no feasible slot after applying the requested constraints'}.`,
    };
  }
  const diff: ProposalChange[] = [];

  for (const listing of readyCandidates) {
    const from = null;
    const to = scheduledById.get(listing.id) ?? null;
    if (to && to !== from) {
      diff.push({
        listingId: listing.id,
        listingLabel: listing.title,
        action: from ? 'reschedule' : 'add',
        from,
        to,
        resultStatus: 'confirmed',
      });
    }
  }

  const requestedChanges = focusedListing
    ? diff.filter((change) => change.listingId === focusedListing.id)
    : diff;
  const cascade = focusedListing
    ? diff.filter((change) => change.listingId !== focusedListing.id)
    : [];
  if (!diff.length) {
    return { error: 'The requested constraint does not change the current tour.' };
  }

  return createProposal(ctx.sessionId, {
    intentSummary:
      `Replan ${readyCandidates.length} ready listing${readyCandidates.length === 1 ? '' : 's'} ` +
      `while preserving ${lockedConfirmed.length} confirmed viewing${lockedConfirmed.length === 1 ? '' : 's'} — ${summary}`,
    mode: 'full',
    changes: requestedChanges,
    cascade,
  });
}

function isSchedulingConstraint(
  constraint: {
    type: string;
    scope?: 'listing' | 'tour';
    listing_id?: string;
    value?: string;
    end_value?: string;
  },
): constraint is SchedulingConstraint {
  return [
    'include_listing',
    'preserve_confirmed',
    'before_time',
    'after_time',
    'exclude_time_window',
    'must_morning',
    'must_afternoon',
  ].includes(constraint.type);
}

function constrainBuyerSlots(
  slots: TimeWindow[],
  args: SchedulingConstraint,
): TimeWindow[] {
  if (args.listing_id || args.scope === 'listing') return slots;
  if (args.type === 'exclude_time_window') {
    const blockedStart = args.value ? parseHHMM(args.value) : null;
    const blockedEnd = args.end_value ? parseHHMM(args.end_value) : null;
    if (blockedStart == null || blockedEnd == null || blockedStart >= blockedEnd) return [];
    return slots.flatMap((slot) => subtractWindow(slot, blockedStart, blockedEnd));
  }
  if (args.type !== 'before_time' && args.type !== 'after_time') return slots;
  const boundary = args.value ? parseHHMM(args.value) : null;
  if (boundary == null) return [];
  return slots
    .map((slot) => {
      const start = parseHHMM(slot.startTime)!;
      const end = parseHHMM(slot.endTime)!;
      if (args.type === 'before_time') {
        return { ...slot, startTime: fmtMinutes(Math.max(start, boundary)) };
      }
      return { ...slot, endTime: fmtMinutes(Math.min(end, boundary)) };
    })
    .filter((slot) => parseHHMM(slot.endTime)! > parseHHMM(slot.startTime)!);
}

function subtractWindow(
  slot: TimeWindow,
  blockedStart: number,
  blockedEnd: number,
): TimeWindow[] {
  const start = parseHHMM(slot.startTime)!;
  const end = parseHHMM(slot.endTime)!;
  if (blockedEnd <= start || blockedStart >= end) return [slot];

  const remaining: TimeWindow[] = [];
  if (blockedStart > start) {
    remaining.push({ ...slot, endTime: fmtMinutes(Math.min(blockedStart, end)) });
  }
  if (blockedEnd < end) {
    remaining.push({ ...slot, startTime: fmtMinutes(Math.max(blockedEnd, start)) });
  }
  return remaining.filter(
    (window) => parseHHMM(window.endTime)! > parseHHMM(window.startTime)!,
  );
}

function constrainListingSlots(
  slots: TimeWindow[],
  args: SchedulingConstraint,
  isFocusedListing: boolean,
): TimeWindow[] {
  if (!isFocusedListing) return slots;
  if (args.type === 'exclude_time_window') {
    const blockedStart = args.value ? parseHHMM(args.value) : null;
    const blockedEnd = args.end_value ? parseHHMM(args.end_value) : null;
    if (blockedStart == null || blockedEnd == null || blockedStart >= blockedEnd) return [];
    return slots.flatMap((slot) => subtractWindow(slot, blockedStart, blockedEnd));
  }
  if (args.type === 'before_time' || args.type === 'after_time') {
    const boundary = args.value ? parseHHMM(args.value) : null;
    if (boundary == null) return [];
    return slots
      .map((slot) => {
        const start = parseHHMM(slot.startTime)!;
        const end = parseHHMM(slot.endTime)!;
        return args.type === 'before_time'
          ? { ...slot, startTime: fmtMinutes(Math.max(start, boundary)) }
          : { ...slot, endTime: fmtMinutes(Math.min(end, boundary)) };
      })
      .filter((slot) => parseHHMM(slot.endTime)! > parseHHMM(slot.startTime)!);
  }
  const range =
    args.type === 'must_morning'
      ? { start: 9 * 60, end: 12 * 60 }
      : args.type === 'must_afternoon'
        ? { start: 12 * 60, end: 18 * 60 }
        : null;
  if (!range) return slots;
  return slots
    .map((slot) => ({
      ...slot,
      startTime: fmtMinutes(Math.max(parseHHMM(slot.startTime)!, range.start)),
      endTime: fmtMinutes(Math.min(parseHHMM(slot.endTime)!, range.end)),
    }))
    .filter((slot) => parseHHMM(slot.endTime)! > parseHHMM(slot.startTime)!);
}

function normalizeConstraints(args: ProposeAddConstraintArgs): SchedulingConstraint[] {
  if (Array.isArray(args.constraints)) return args.constraints;
  return args.type ? [args as SchedulingConstraint] : [];
}

function describeConstraint(args: SchedulingConstraint): string | null {
  switch (args.type) {
    case 'include_listing':
      return args.listing_id ? `prioritize ${args.listing_id} for this tour` : null;
    case 'preserve_confirmed':
      return 'preserve all confirmed listings';
    case 'before_time':
      return args.value ? `no viewings before ${args.value}` : null;
    case 'after_time':
      return args.value ? `no viewings after ${args.value}` : null;
    case 'exclude_time_window':
      return args.value && args.end_value
        ? `no viewings from ${args.value} to ${args.end_value}`
        : null;
    case 'must_morning':
      return args.listing_id ? `${args.listing_id} must be in the morning` : null;
    case 'must_afternoon':
      return args.listing_id ? `${args.listing_id} must be in the afternoon` : null;
    default:
      return null;
  }
}

function findScheduleConflict(
  schedule: Array<{ listingId: string; date: string; startTime: string; endTime: string }>,
): string | null {
  const ordered = [...schedule].sort((a, b) =>
    `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`),
  );
  for (let i = 1; i < ordered.length; i++) {
    const previous = ordered[i - 1];
    const current = ordered[i];
    if (
      previous.date === current.date &&
      parseHHMM(current.startTime)! < parseHHMM(previous.endTime)!
    ) {
      return `Invalid schedule: ${previous.listingId} and ${current.listingId} overlap on ${current.date}.`;
    }
  }
  return null;
}

function findStoredSlotConflict(changes: ProposalChange[]): string | null {
  const slots = changes
    .filter((change) => change.action === 'reschedule' || change.action === 'add')
    .map((change) => ({
      listingId: change.listingId,
      slot: parseSlot(change.to),
    }))
    .filter((item): item is {
      listingId: string;
      slot: { date?: string; start: number; end: number };
    } =>
      Boolean(item.slot),
    )
    .sort((a, b) =>
      `${a.slot.date || ''} ${a.slot.start}`.localeCompare(`${b.slot.date || ''} ${b.slot.start}`),
    );

  for (let i = 1; i < slots.length; i++) {
    const sameDate =
      !slots[i].slot.date ||
      !slots[i - 1].slot.date ||
      slots[i].slot.date === slots[i - 1].slot.date;
    if (sameDate && slots[i].slot.start < slots[i - 1].slot.end) {
      return `PROPOSAL_TIME_CONFLICT:${slots[i - 1].listingId}:${slots[i].listingId}`;
    }
  }
  return null;
}

// ─── Apply ──────────────────────────────────────────────────────────────

/**
 * Apply a proposal. Local and complete full-tour proposals are supported.
 * Historical/manual-review proposals with unknown cascade destinations fail.
 */
export async function applyProposal(proposalId: string): Promise<{ ok: true; appliedChanges: number }> {
  const proposal = await getProposal(proposalId);
  if (!proposal) throw new Error('PROPOSAL_NOT_FOUND');
  if (proposal.appliedAt) throw new Error('PROPOSAL_ALREADY_APPLIED');
  if (proposal.discardedAt) throw new Error('PROPOSAL_ALREADY_DISCARDED');

  const c = db();
  const proposedChanges = [...proposal.changes, ...proposal.cascade];
  const changes = proposedChanges.filter(
    (change, index) =>
      proposedChanges.findIndex((candidate) => candidate.listingId === change.listingId) === index,
  );
  if (!changes.length) throw new Error('PROPOSAL_HAS_NO_CHANGES');
  if (
    changes.some(
      (change) =>
        (change.action === 'reschedule' || change.action === 'add') &&
        !change.to,
    )
  ) {
    throw new Error('PROPOSAL_INCOMPLETE');
  }
  if (findStoredSlotConflict(changes)) {
    throw new Error('PROPOSAL_TIME_CONFLICT');
  }

  const listingIds = changes.map((change) => change.listingId);
  const { data: currentRows, error: currentErr } = await c
    .from('listings')
    .select('id, suggested_time, status, status_label, attention_reason')
    .in('id', listingIds);
  if (currentErr) throw currentErr;
  if (!currentRows || currentRows.length !== listingIds.length) {
    throw new Error('PROPOSAL_APPLY_NO_ROWS');
  }
  const beforeById = new Map(currentRows.map((row) => [row.id as string, row]));
  for (const change of changes) {
    const current = beforeById.get(change.listingId);
    const currentSlot = current?.status === 'confirmed' ? current.suggested_time : null;
    if ((currentSlot ?? null) !== (change.from ?? null)) {
      throw new Error('PROPOSAL_STALE');
    }
  }

  let n = 0;
  try {
    for (const change of changes) {
      let affected: { id: string }[] | null = null;
      if (change.action === 'reschedule' || change.action === 'add') {
        const { data, error } = await c
          .from('listings')
          .update({
            suggested_time: change.to,
            status: 'confirmed',
            status_label: 'Confirmed',
            attention_reason: null,
          })
          .eq('id', change.listingId)
          .select('id');
        if (error) throw error;
        affected = data as { id: string }[];
      } else if (change.action === 'drop') {
        const resultStatus = change.resultStatus ?? 'imported';
        const { data, error } = await c
          .from('listings')
          .update({
            status: resultStatus,
            status_label:
              resultStatus === 'needs-attention'
                ? 'No matching slot'
                : 'Removed from tour',
            suggested_time: resultStatus === 'needs-attention' ? 'Pending' : null,
            attention_reason:
              resultStatus === 'needs-attention'
                ? change.reason ?? 'No slot after re-planning'
                : 'Dropped via chat',
          })
          .eq('id', change.listingId)
          .select('id');
        if (error) throw error;
        affected = data as { id: string }[];
      }
      if (!affected || affected.length === 0) {
        console.error(
          '[applyProposal] update affected 0 rows',
          { proposalId, listingId: change.listingId, action: change.action, to: change.to },
        );
        throw new Error('PROPOSAL_APPLY_NO_ROWS');
      }
      n += affected.length;
    }
    await markProposalApplied(proposalId);
  } catch (error) {
    for (const row of currentRows) {
      const { data, error } = await c
        .from('listings')
        .update({
          suggested_time: row.suggested_time,
          status: row.status,
          status_label: row.status_label,
          attention_reason: row.attention_reason,
        })
        .eq('id', row.id)
        .select('id');
      if (error || !data?.length) {
        console.error('[applyProposal] rollback failed', { proposalId, listingId: row.id, error });
      }
    }
    throw error;
  }
  console.log('[applyProposal] applied', { proposalId, appliedChanges: n });
  return { ok: true, appliedChanges: n };
}
