import type { TimeWindow } from './scheduling/timeUtils';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const VIEWING_DURATION_MINUTES = 30;

export interface FixedAvailabilityRule {
  type: 'date';
  date: string;
  startTime: string;
  endTime: string;
}

export interface WeeklyAvailabilityRule {
  type: 'weekly';
  weekdays: number[];
  startTime: string;
  endTime: string;
}

export type AvailabilityRule = FixedAvailabilityRule | WeeklyAvailabilityRule;

export interface StoredTourAvailability {
  version: 1;
  sourceText: string;
  summary: string;
  rules: AvailabilityRule[];
}

function isValidDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function parseTime(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function normalizeTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const minutes = parseTime(value);
  if (minutes == null) return null;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

export function normalizeAvailabilityRules(input: unknown): AvailabilityRule[] {
  const items = Array.isArray(input) ? input : input && typeof input === 'object' ? [input] : [];
  if (!items.length) return [];
  const rules: AvailabilityRule[] = [];

  for (const raw of items) {
    if (!raw || typeof raw !== 'object') return [];
    const candidate = raw as Record<string, unknown>;
    const startTime = normalizeTime(candidate.startTime);
    let endTime = normalizeTime(candidate.endTime);
    if (!startTime) return [];
    if (!endTime) {
      const start = parseTime(startTime)!;
      endTime = normalizeTime(`${Math.floor((start + VIEWING_DURATION_MINUTES) / 60)}:${(start + VIEWING_DURATION_MINUTES) % 60}`);
    }
    if (!endTime || parseTime(endTime)! - parseTime(startTime)! < VIEWING_DURATION_MINUTES) {
      return [];
    }

    if (candidate.type === 'date') {
      if (typeof candidate.date !== 'string' || !isValidDate(candidate.date)) return [];
      rules.push({ type: 'date', date: candidate.date, startTime, endTime });
      continue;
    }

    if (candidate.type === 'weekly') {
      if (!Array.isArray(candidate.weekdays)) return [];
      const weekdays = [...new Set(candidate.weekdays)]
        .filter((value): value is number => Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 6)
        .sort((a, b) => a - b);
      if (!weekdays.length || weekdays.length !== candidate.weekdays.length) return [];
      rules.push({ type: 'weekly', weekdays, startTime, endTime });
      continue;
    }

    return [];
  }

  return rules;
}

export function serializeTourAvailability(input: {
  sourceText: string;
  summary: string;
  rules: AvailabilityRule[];
}): string {
  return JSON.stringify({
    version: 1,
    sourceText: input.sourceText.trim(),
    summary: input.summary.trim(),
    rules: input.rules,
  } satisfies StoredTourAvailability);
}

export function readStoredTourAvailability(
  targetDate: string,
  timeWindow: string,
): StoredTourAvailability | null {
  try {
    const parsed = JSON.parse(timeWindow) as Partial<StoredTourAvailability>;
    if (parsed.version !== 1 || typeof parsed.sourceText !== 'string' || typeof parsed.summary !== 'string') {
      return null;
    }
    const rules = normalizeAvailabilityRules(parsed.rules);
    if (!rules.length) return null;
    return { version: 1, sourceText: parsed.sourceText, summary: parsed.summary, rules };
  } catch {
    const slots = parseLegacyAvailability(targetDate, timeWindow);
    if (!slots.length) return null;
    return {
      version: 1,
      sourceText: timeWindow,
      summary: slots.map((slot) => `${slot.date} ${slot.startTime}-${slot.endTime}`).join(', '),
      rules: slots.map((slot) => ({ type: 'date', ...slot })),
    };
  }
}

function parseLegacyAvailability(targetDate: string, timeWindow: string): TimeWindow[] {
  const parts = timeWindow.split(/[\n,;]+/).map((part) => part.trim()).filter(Boolean);
  const slots: TimeWindow[] = [];

  for (const part of parts) {
    const dated = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/.exec(part);
    const legacy = /^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/.exec(part);
    const date = dated?.[1] ?? targetDate;
    const startTime = normalizeTime(dated?.[2] ?? legacy?.[1]);
    const endTime = normalizeTime(dated?.[3] ?? legacy?.[2]);
    if (!startTime || !endTime || !isValidDate(date)) return [];
    if (parseTime(endTime)! - parseTime(startTime)! < VIEWING_DURATION_MINUTES) return [];
    slots.push({ date, startTime, endTime });
  }

  return slots;
}

function nextMatchingDates(referenceDate: string, weekdays: number[], count = 2): string[] {
  const start = isValidDate(referenceDate) ? new Date(`${referenceDate}T00:00:00Z`) : new Date();
  const dates: string[] = [];
  for (let offset = 0; offset < 366 && dates.length < count; offset++) {
    const current = new Date(start);
    current.setUTCDate(start.getUTCDate() + offset);
    if (weekdays.includes(current.getUTCDay())) dates.push(current.toISOString().slice(0, 10));
  }
  return dates;
}

export function expandTourAvailability(
  targetDate: string,
  timeWindow: string,
  candidateDates?: string[],
): TimeWindow[] {
  const stored = readStoredTourAvailability(targetDate, timeWindow);
  if (!stored) return [];
  const validCandidateDates = [...new Set(candidateDates ?? [])].filter(isValidDate).sort();
  const slots: TimeWindow[] = [];

  for (const rule of stored.rules) {
    if (rule.type === 'date') {
      if (!validCandidateDates.length || validCandidateDates.includes(rule.date)) {
        slots.push({ date: rule.date, startTime: rule.startTime, endTime: rule.endTime });
      }
      continue;
    }
    const dates = validCandidateDates.length
      ? validCandidateDates.filter((date) => rule.weekdays.includes(new Date(`${date}T00:00:00Z`).getUTCDay()))
      : nextMatchingDates(targetDate, rule.weekdays);
    for (const date of dates) {
      slots.push({ date, startTime: rule.startTime, endTime: rule.endTime });
    }
  }

  return slots.sort((a, b) => `${a.date} ${a.startTime}`.localeCompare(`${b.date} ${b.startTime}`));
}

export function parseTourAvailability(targetDate: string, timeWindow: string): TimeWindow[] {
  return expandTourAvailability(targetDate, timeWindow);
}

export function isValidTourAvailability(targetDate: unknown, timeWindow: unknown): boolean {
  return typeof targetDate === 'string' &&
    isValidDate(targetDate) &&
    typeof timeWindow === 'string' &&
    Boolean(readStoredTourAvailability(targetDate, timeWindow));
}
