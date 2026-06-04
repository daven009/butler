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
 *   - Stage 2 ("full"): would conflict locally, so we'd have to re-run
 *     planSchedule with a hard constraint. M2 phase-2 detects this case
 *     but does NOT yet run the full replanner — it returns a proposal
 *     marked mode='full' with a single change + a note in `intent_summary`
 *     telling the user "would conflict; manual review needed". M2 phase-3
 *     wires this to the real planSchedule re-run.
 *
 * Time format: we store HH:MM directly in `listings.suggested_time` as
 * "HH:MM – HH:MM" (en-dash). Default viewing duration: 30 min.
 */

import {
  type Listing,
  listListingsByTour,
} from '../repositories/plansRepository';
import {
  type ScheduleChangeProposal,
  type ProposalChange,
  createProposal,
  getProposal,
  markProposalApplied,
} from '../repositories/schedulingSessionsRepository';
import { supabaseForUser } from '../supabase';
import { getCurrentJwt } from '../userContext';

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

function makeSlot(startHHMM: string, durationMin = DEFAULT_VIEWING_MINUTES): string | null {
  const start = parseHHMM(startHHMM);
  if (start == null) return null;
  return `${fmtMinutes(start)} – ${fmtMinutes(start + durationMin)}`;
}

/**
 * Parse `listing.suggestedTime` like "10:00 – 10:30" → {start, end} in minutes.
 * Returns null when the listing isn't currently scheduled.
 */
function parseSlot(slot: string | null | undefined): { start: number; end: number } | null {
  if (!slot || slot === 'Pending') return null;
  // Accept en-dash, hyphen, or "to" as separator; tolerant.
  const match = /(\d{1,2}:\d{2})\s*[–\-to]+\s*(\d{1,2}:\d{2})/.exec(slot);
  if (!match) return null;
  const a = parseHHMM(match[1]);
  const b = parseHHMM(match[2]);
  if (a == null || b == null) return null;
  return { start: a, end: b };
}

function findListing(listings: Listing[], idOrName: string): Listing | undefined {
  const byId = listings.find((l) => l.id === idOrName);
  if (byId) return byId;
  const lc = idOrName.toLowerCase();
  return listings.find(
    (l) => l.title.toLowerCase().includes(lc) || l.condo.toLowerCase().includes(lc),
  );
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
  newStart: number,
  newEnd: number,
): Listing[] {
  return listings.filter((l) => {
    if (l.id === excludeListingId) return false;
    if (l.status !== 'confirmed') return false;
    const existing = parseSlot(l.suggestedTime);
    if (!existing) return false;
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

  const newSlot = makeSlot(args.new_start);
  if (!newSlot) {
    return { error: `Invalid time format "${args.new_start}". Use HH:MM (e.g. "11:00").` };
  }
  const newStart = parseHHMM(args.new_start)!;
  const newEnd = newStart + DEFAULT_VIEWING_MINUTES;

  const before = listing.suggestedTime ?? null;
  const conflicts = findConflicts(listings, listing.id, newStart, newEnd);
  const change: ProposalChange = {
    listingId: listing.id,
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

  // Stage 2 — would conflict. M2 phase-2 ships the proposal with mode='full'
  // and surfaces conflicting listings as cascade entries. The actual replan
  // (re-running planSchedule with a hard constraint) lands in phase-3.
  // For now Apply on a 'full' proposal is rejected; the UI shows the
  // conflict and offers to swap or drop manually.
  return createProposal(ctx.sessionId, {
    intentSummary:
      `Move ${listing.title} to ${newSlot} — but it conflicts with ${conflicts.map((c) => c.title).join(', ')}. Resolve manually for now (full re-plan support coming next).`,
    mode: 'full',
    changes: [change],
    cascade: conflicts.map((c) => ({
      listingId: c.id,
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
      { listingId: a.id, action: 'reschedule', from: a.suggestedTime, to: b.suggestedTime },
      { listingId: b.id, action: 'reschedule', from: b.suggestedTime, to: a.suggestedTime },
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
        action: 'drop',
        from: listing.suggestedTime ?? null,
        to: null,
      },
    ],
    cascade: [],
  });
}

// ─── propose_add_constraint ─────────────────────────────────────────────
// Constraints require a full re-plan to honor. M2 phase-2 records the
// proposal with mode='full' but does not run planSchedule yet — Apply on
// such a proposal returns a "not yet implemented" error. The UI hint:
// the user re-runs scheduling manually for now. Phase-3 wires this up.

export interface ProposeAddConstraintArgs {
  type: 'before_time' | 'after_time' | 'must_morning' | 'must_afternoon' | 'date';
  listing_id?: string;
  value?: string;
}

export async function buildAddConstraintProposal(
  args: ProposeAddConstraintArgs,
  ctx: { tourId: string; sessionId: string },
): Promise<ScheduleChangeProposal | { error: string }> {
  const summary = describeConstraint(args);
  if (!summary) return { error: 'Invalid constraint specification.' };
  return createProposal(ctx.sessionId, {
    intentSummary: `Add constraint — ${summary} (will require a full re-plan)`,
    mode: 'full',
    changes: [],
    cascade: [],
  });
}

function describeConstraint(args: ProposeAddConstraintArgs): string | null {
  switch (args.type) {
    case 'before_time':
      return args.value ? `no viewings before ${args.value}` : null;
    case 'after_time':
      return args.value ? `no viewings after ${args.value}` : null;
    case 'must_morning':
      return args.listing_id ? `${args.listing_id} must be in the morning` : null;
    case 'must_afternoon':
      return args.listing_id ? `${args.listing_id} must be in the afternoon` : null;
    case 'date':
      return args.value ? `move tour to ${args.value}` : null;
    default:
      return null;
  }
}

// ─── Apply ──────────────────────────────────────────────────────────────

/**
 * Apply a proposal. Mutates `listings` per the proposal's changes[],
 * marks proposal applied. We only support `mode='local'` proposals here;
 * `mode='full'` (constraint-driven re-plans) will be wired to a real
 * planSchedule re-run in M2 phase-3.
 */
export async function applyProposal(proposalId: string): Promise<{ ok: true; appliedChanges: number }> {
  const proposal = await getProposal(proposalId);
  if (!proposal) throw new Error('PROPOSAL_NOT_FOUND');
  if (proposal.appliedAt) throw new Error('PROPOSAL_ALREADY_APPLIED');
  if (proposal.discardedAt) throw new Error('PROPOSAL_ALREADY_DISCARDED');
  if (proposal.mode !== 'local') {
    throw new Error('PROPOSAL_REQUIRES_FULL_REPLAN');
  }

  const c = db();
  let n = 0;
  for (const change of proposal.changes) {
    if (change.action === 'reschedule') {
      const { error } = await c
        .from('listings')
        .update({
          suggested_time: change.to,
          status: 'confirmed',
          status_label: 'Confirmed',
          attention_reason: null,
        })
        .eq('id', change.listingId);
      if (error) throw error;
      n++;
    } else if (change.action === 'drop') {
      const { error } = await c
        .from('listings')
        .update({
          status: 'imported',
          status_label: 'Removed from tour',
          suggested_time: null,
          attention_reason: 'Dropped via chat',
        })
        .eq('id', change.listingId);
      if (error) throw error;
      n++;
    } else if (change.action === 'add') {
      // Listings already exist — 'add' here means "schedule a previously
      // unscheduled listing". We just set its slot like reschedule.
      const { error } = await c
        .from('listings')
        .update({
          suggested_time: change.to,
          status: 'confirmed',
          status_label: 'Confirmed',
          attention_reason: null,
        })
        .eq('id', change.listingId);
      if (error) throw error;
      n++;
    }
  }
  await markProposalApplied(proposalId);
  return { ok: true, appliedChanges: n };
}
