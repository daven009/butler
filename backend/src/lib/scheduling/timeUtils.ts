/**
 * Time utilities for the scheduling engine.
 *
 * Provides:
 * 1. Time window intersection (buyer ∩ seller available slots)
 * 2. 15-minute rounding (all times ceil to :00/:15/:30/:45)
 * 3. Block classification (morning/afternoon/evening)
 * 4. Slot fitting — check if a viewing duration fits in a time window
 */

// ── Types ──

export interface TimeWindow {
  date: string;       // ISO date "2026-05-03"
  startTime: string;  // "09:00"
  endTime: string;    // "12:00"
}

export interface BlockDefinition {
  block: 'morning' | 'afternoon' | 'evening';
  label: string;
  startTime: string;
  endTime: string;
}

// ── Constants ──

const TIME_GRANULARITY = 15; // minutes

export const BLOCKS: BlockDefinition[] = [
  { block: 'morning', label: 'Morning 9am–12pm', startTime: '09:00', endTime: '12:00' },
  { block: 'afternoon', label: 'Afternoon 12pm–3pm', startTime: '12:00', endTime: '15:00' },
  { block: 'evening', label: 'Evening 3pm–6pm', startTime: '15:00', endTime: '18:00' },
];

// ── Time Conversion ──

/**
 * Convert "HH:MM" to minutes since midnight.
 */
export function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Convert minutes since midnight to "HH:MM".
 */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Round UP to nearest 15-minute boundary.
 * e.g. "09:07" → "09:15", "09:00" → "09:00", "09:46" → "10:00"
 */
export function ceilTimeToQuarter(time: string): string {
  const min = timeToMinutes(time);
  const ceiled = Math.ceil(min / TIME_GRANULARITY) * TIME_GRANULARITY;
  return minutesToTime(ceiled);
}

/**
 * Round UP minutes to nearest 15-minute boundary.
 */
export function ceilMinutesToQuarter(minutes: number): number {
  return Math.ceil(minutes / TIME_GRANULARITY) * TIME_GRANULARITY;
}

// ── Time Window Operations ──

/**
 * Compute the intersection of two time windows on the SAME date.
 * Returns null if no overlap or different dates.
 */
export function intersectWindows(a: TimeWindow, b: TimeWindow): TimeWindow | null {
  if (a.date !== b.date) return null;

  const startA = timeToMinutes(a.startTime);
  const endA = timeToMinutes(a.endTime);
  const startB = timeToMinutes(b.startTime);
  const endB = timeToMinutes(b.endTime);

  const overlapStart = Math.max(startA, startB);
  const overlapEnd = Math.min(endA, endB);

  if (overlapEnd <= overlapStart) return null;

  return {
    date: a.date,
    startTime: minutesToTime(overlapStart),
    endTime: minutesToTime(overlapEnd),
  };
}

/**
 * Find all intersections between buyer slots and seller slots.
 * Returns an array of valid time windows where both are available.
 */
export function findSlotIntersections(
  buyerSlots: TimeWindow[],
  sellerSlots: TimeWindow[],
): TimeWindow[] {
  const intersections: TimeWindow[] = [];

  for (const b of buyerSlots) {
    for (const s of sellerSlots) {
      const inter = intersectWindows(b, s);
      if (inter) {
        intersections.push(inter);
      }
    }
  }

  // Sort by date then start time
  return intersections.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
  });
}

/**
 * Check if a viewing of given duration fits within a time window,
 * starting at or after a given offset (minutes from midnight).
 * Returns the fitted start time (ceiled to 15 min) or null.
 */
export function fitViewing(
  window: TimeWindow,
  durationMinutes: number,
  earliestStartMinutes?: number,
): { startTime: string; endTime: string } | null {
  let startMin = timeToMinutes(window.startTime);
  
  if (earliestStartMinutes != null && earliestStartMinutes > startMin) {
    startMin = earliestStartMinutes;
  }

  // Ceil to 15 min
  startMin = ceilMinutesToQuarter(startMin);

  const endMin = startMin + durationMinutes;
  const windowEndMin = timeToMinutes(window.endTime);

  if (endMin > windowEndMin) return null;

  return {
    startTime: minutesToTime(startMin),
    endTime: minutesToTime(endMin),
  };
}

// ── Block Classification ──

/**
 * Determine which block a time falls into.
 */
export function getBlock(time: string): BlockDefinition | null {
  const min = timeToMinutes(time);
  for (const b of BLOCKS) {
    if (min >= timeToMinutes(b.startTime) && min < timeToMinutes(b.endTime)) {
      return b;
    }
  }
  return null;
}

/**
 * Get the block label for a date + time combination.
 * E.g. "2026-05-03" + "10:30" → "Saturday May 3 · Morning"
 */
export function getBlockLabel(date: string, time: string): string {
  const d = new Date(date + 'T00:00:00');
  const dayName = d.toLocaleDateString('en-SG', { weekday: 'long' });
  const monthDay = d.toLocaleDateString('en-SG', { month: 'short', day: 'numeric' });
  const block = getBlock(time);
  return `${dayName} ${monthDay} · ${block?.label || time}`;
}

/**
 * Group time windows by date + block.
 * Returns a map keyed by "date|block" → TimeWindow[]
 */
export function groupByDateBlock(windows: TimeWindow[]): Map<string, TimeWindow[]> {
  const groups = new Map<string, TimeWindow[]>();

  for (const w of windows) {
    const block = getBlock(w.startTime);
    const key = `${w.date}|${block?.block || 'other'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(w);
  }

  return groups;
}

// ── Duration Helpers ──

/**
 * Calculate the duration of a time window in minutes.
 */
export function windowDurationMinutes(window: TimeWindow): number {
  return timeToMinutes(window.endTime) - timeToMinutes(window.startTime);
}

/**
 * Calculate how many viewings (of given duration + buffer) can fit in a window.
 */
export function maxViewingsInWindow(window: TimeWindow, viewingDuration: number, buffer: number = 0): number {
  const totalMin = windowDurationMinutes(window);
  if (totalMin < viewingDuration) return 0;
  // First viewing has no buffer
  return 1 + Math.floor((totalMin - viewingDuration) / (viewingDuration + buffer));
}

// ── Date helpers ──

/**
 * Get day of week label for a date string.
 */
export function getDayLabel(date: string): string {
  const d = new Date(date + 'T00:00:00');
  return d.toLocaleDateString('en-SG', { weekday: 'long', month: 'short', day: 'numeric' });
}

/**
 * Sort dates chronologically.
 */
export function sortDates(dates: string[]): string[] {
  return [...dates].sort((a, b) => a.localeCompare(b));
}
