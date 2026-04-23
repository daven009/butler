import type {
  GenerateScheduleInput,
  ScheduleGenerationResult,
  ScheduleItem,
  ScheduleWarning,
  Tour,
  TourListing,
  UnscheduledListing
} from '../types';

const SCHEDULABLE_STATUS = 'AVAILABLE_SLOTS_RECEIVED';
const DEFAULT_VIEWING_DURATION_MINUTES = 30;
const DEFAULT_TRAVEL_BUFFER_MINUTES = 15;
const TIME_GRANULARITY_MINUTES = 15;

interface SchedulerOptions {
  createScheduleItemId: () => string;
}

interface CandidateWindow {
  listing: TourListing;
  startMinute: number;
  endMinute: number;
}

interface ScheduleDraft {
  item: ScheduleItem;
  listing: TourListing;
  startMinute: number;
  endMinute: number;
}

interface SchedulerPlan {
  schedule: ScheduleItem[];
  unscheduled: UnscheduledListing[];
  warnings: ScheduleWarning[];
  summary: ScheduleGenerationResult['summary'];
}

function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function localDateTimeToMinute(date: string, time: string) {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return Date.UTC(year, month - 1, day, hours, minutes) / 60000;
}

function dateFromMinute(minute: number) {
  const date = new Date(minute * 60000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isoSingaporeFromMinute(minute: number) {
  const date = new Date(minute * 60000);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = String(date.getUTCHours()).padStart(2, '0');
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:00+08:00`;
}

function roundUpToGranularity(minute: number) {
  return Math.ceil(minute / TIME_GRANULARITY_MINUTES) * TIME_GRANULARITY_MINUTES;
}

function sortListings(a: TourListing, b: TourListing) {
  return a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
}

function unscheduled(listing: TourListing, reason: UnscheduledListing['reason'], message: string): UnscheduledListing {
  return {
    listingId: listing.id,
    reason,
    message
  };
}

function getBuyerWindows(tour: Tour) {
  return tour.buyerAvailability.map((window) => ({
    startMinute: localDateTimeToMinute(window.date, window.startTime),
    endMinute: localDateTimeToMinute(window.date, window.endTime)
  }));
}

function getOpposingSlots(tour: Tour, listingId: string) {
  return tour.opposingAgentAvailability
    .filter((availability) => availability.listingId === listingId)
    .flatMap((availability) => availability.slots.map((slot) => ({
      startMinute: localDateTimeToMinute(slot.date, slot.startTime),
      endMinute: localDateTimeToMinute(slot.date, slot.endTime)
    })));
}

function computeCandidateWindows(tour: Tour, listing: TourListing, viewingDurationMinutes: number) {
  const buyerWindows = getBuyerWindows(tour);
  const opposingSlots = getOpposingSlots(tour, listing.id);
  const windows: CandidateWindow[] = [];
  let hasAnyOverlap = false;
  let hasDurationOverlap = false;

  for (const buyerWindow of buyerWindows) {
    for (const opposingSlot of opposingSlots) {
      const startMinute = Math.max(buyerWindow.startMinute, opposingSlot.startMinute);
      const endMinute = Math.min(buyerWindow.endMinute, opposingSlot.endMinute);
      if (endMinute <= startMinute) continue;

      hasAnyOverlap = true;
      const roundedStartMinute = roundUpToGranularity(startMinute);
      if (roundedStartMinute + viewingDurationMinutes > endMinute) continue;

      hasDurationOverlap = true;
      windows.push({
        listing,
        startMinute: roundedStartMinute,
        endMinute
      });
    }
  }

  windows.sort((a, b) => (
    a.startMinute - b.startMinute ||
    sortListings(a.listing, b.listing)
  ));

  return {
    windows,
    hasAnyOverlap,
    hasDurationOverlap
  };
}

function findPreviousSameDay(drafts: ScheduleDraft[], startMinute: number) {
  const targetDate = dateFromMinute(startMinute);
  return drafts
    .filter((draft) => dateFromMinute(draft.startMinute) === targetDate && draft.startMinute <= startMinute)
    .sort((a, b) => b.endMinute - a.endMinute)[0];
}

function hasConflict(drafts: ScheduleDraft[], startMinute: number, endMinute: number) {
  return drafts.some((draft) => startMinute < draft.endMinute && endMinute > draft.startMinute);
}

function placeWindow(
  drafts: ScheduleDraft[],
  window: CandidateWindow,
  viewingDurationMinutes: number,
  defaultTravelBufferMinutes: number
) {
  let startMinute = window.startMinute;
  const previous = findPreviousSameDay(drafts, startMinute);
  let travelBufferMinutes = 0;

  if (previous) {
    travelBufferMinutes = previous.listing.address === window.listing.address ? 0 : defaultTravelBufferMinutes;
    startMinute = Math.max(startMinute, previous.endMinute + travelBufferMinutes);
    startMinute = roundUpToGranularity(startMinute);
  }

  const endMinute = startMinute + viewingDurationMinutes;
  if (endMinute > window.endMinute) return undefined;
  if (hasConflict(drafts, startMinute, endMinute)) return undefined;

  return {
    startMinute,
    endMinute,
    travelBufferMinutes
  };
}

export function generateSchedulePlan(
  tour: Tour,
  input: GenerateScheduleInput,
  options: SchedulerOptions
): SchedulerPlan {
  const viewingDurationMinutes = input.viewingDurationMinutes || DEFAULT_VIEWING_DURATION_MINUTES;
  const defaultTravelBufferMinutes = input.defaultTravelBufferMinutes ?? DEFAULT_TRAVEL_BUFFER_MINUTES;
  const warnings: ScheduleWarning[] = [];
  const unscheduledListings: UnscheduledListing[] = [];
  const drafts: ScheduleDraft[] = [];
  const candidateWindows: CandidateWindow[] = [];
  const scheduledListingIds = new Set<string>();
  const candidateListingIds = new Set<string>();

  if (tour.schedule.length > 0) {
    warnings.push({
      code: 'EXISTING_SCHEDULE_REPLACED',
      message: 'Existing proposed schedule was replaced by this generation.'
    });
  }

  for (const listing of [...tour.listings].sort(sortListings)) {
    if (listing.status !== SCHEDULABLE_STATUS) {
      unscheduledListings.push(unscheduled(
        listing,
        'LISTING_STATUS_NOT_SCHEDULABLE',
        `Listing status ${listing.status} is not schedulable in Scheduler v1.`
      ));
      continue;
    }

    candidateListingIds.add(listing.id);

    if (tour.buyerAvailability.length === 0) {
      unscheduledListings.push(unscheduled(
        listing,
        'NO_BUYER_AVAILABILITY',
        'No buyer availability has been recorded for this tour.'
      ));
      continue;
    }

    const opposingSlots = getOpposingSlots(tour, listing.id);
    if (opposingSlots.length === 0) {
      unscheduledListings.push(unscheduled(
        listing,
        'NO_OPPOSING_AVAILABILITY',
        'No opposing-agent availability has been recorded for this listing.'
      ));
      continue;
    }

    const computed = computeCandidateWindows(tour, listing, viewingDurationMinutes);
    if (!computed.hasAnyOverlap) {
      unscheduledListings.push(unscheduled(
        listing,
        'NO_OVERLAP',
        'No overlap between buyer availability and opposing-agent availability.'
      ));
      continue;
    }

    if (!computed.hasDurationOverlap) {
      unscheduledListings.push(unscheduled(
        listing,
        'INSUFFICIENT_WINDOW',
        'Overlapping availability exists, but no overlap is long enough for the viewing duration.'
      ));
      continue;
    }

    candidateWindows.push(...computed.windows);
  }

  candidateWindows.sort((a, b) => (
    a.startMinute - b.startMinute ||
    sortListings(a.listing, b.listing)
  ));

  for (const window of candidateWindows) {
    if (scheduledListingIds.has(window.listing.id)) continue;

    const placement = placeWindow(drafts, window, viewingDurationMinutes, defaultTravelBufferMinutes);
    if (!placement) continue;

    const item: ScheduleItem = {
      id: options.createScheduleItemId(),
      listingId: window.listing.id,
      startAt: isoSingaporeFromMinute(placement.startMinute),
      endAt: isoSingaporeFromMinute(placement.endMinute),
      travelBufferMinutes: placement.travelBufferMinutes,
      status: 'PROPOSED'
    };

    scheduledListingIds.add(window.listing.id);
    drafts.push({
      item,
      listing: window.listing,
      startMinute: placement.startMinute,
      endMinute: placement.endMinute
    });
    drafts.sort((a, b) => a.startMinute - b.startMinute || a.listing.id.localeCompare(b.listing.id));
  }

  for (const listingId of candidateListingIds) {
    if (scheduledListingIds.has(listingId)) continue;
    if (unscheduledListings.some((item) => item.listingId === listingId)) continue;

    unscheduledListings.push({
      listingId,
      reason: 'CONFLICT_WITH_EXISTING_SCHEDULE',
      message: 'Availability overlaps exist, but the listing could not be placed without conflicting with already proposed schedule items or required travel buffers.'
    });
  }

  const schedule = drafts
    .sort((a, b) => a.startMinute - b.startMinute || a.listing.id.localeCompare(b.listing.id))
    .map((draft) => draft.item);

  return {
    schedule,
    unscheduled: unscheduledListings,
    warnings,
    summary: {
      candidateListingCount: candidateListingIds.size,
      scheduledCount: schedule.length,
      unscheduledCount: unscheduledListings.length
    }
  };
}
