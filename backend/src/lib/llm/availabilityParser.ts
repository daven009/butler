import { openai, SCHEDULING_AGENT_MODEL } from './openaiClient';
import {
  normalizeAvailabilityRules,
  serializeTourAvailability,
  type AvailabilityRule,
} from '../tourAvailability';

export type AvailabilityParseStatus = 'valid' | 'needs_clarification' | 'invalid';

export interface AvailabilityParseResult {
  status: AvailabilityParseStatus;
  rules: AvailabilityRule[];
  summary: string;
  message: string;
  serialized?: string;
  targetDate?: string;
}

export interface AvailabilityConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

function dateInSingapore(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function isValidReferenceDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function nextRuleDate(referenceDate: string, rules: AvailabilityRule[]): string {
  const fixedDates = rules
    .filter((rule): rule is Extract<AvailabilityRule, { type: 'date' }> => rule.type === 'date')
    .map((rule) => rule.date);
  if (fixedDates.length) return fixedDates.sort()[0];

  const weekdays = rules
    .filter((rule): rule is Extract<AvailabilityRule, { type: 'weekly' }> => rule.type === 'weekly')
    .flatMap((rule) => rule.weekdays);
  const start = new Date(`${referenceDate}T00:00:00Z`);
  for (let offset = 0; offset < 8; offset++) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + offset);
    if (weekdays.includes(date.getUTCDay())) return date.toISOString().slice(0, 10);
  }
  return referenceDate;
}

function upcomingWeekdayDates(referenceDate: string): string {
  const labels = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const start = new Date(`${referenceDate}T00:00:00Z`);
  const dates: string[] = [];
  for (let offset = 0; offset < 7; offset++) {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + offset);
    dates.push(`${labels[date.getUTCDay()]}=${date.toISOString().slice(0, 10)}`);
  }
  return dates.join(', ');
}

function to24Hour(hourText: string, minuteText: string | undefined, period: string | undefined): string | null {
  let hour = Number(hourText);
  const minute = Number(minuteText || '0');
  if (hour > 23 || minute > 59) return null;
  const normalizedPeriod = period?.toLowerCase();
  if (normalizedPeriod === 'pm' || normalizedPeriod === '下午' || normalizedPeriod === '晚上') {
    if (hour < 12) hour += 12;
  } else if (normalizedPeriod === 'am' || normalizedPeriod === '上午') {
    if (hour === 12) hour = 0;
  } else if (normalizedPeriod === '中午' && hour < 11) {
    hour += 12;
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function nearestWeekdayDate(referenceDate: string, weekday: number): string {
  const start = new Date(`${referenceDate}T00:00:00Z`);
  const offset = (weekday - start.getUTCDay() + 7) % 7;
  start.setUTCDate(start.getUTCDate() + offset);
  return start.toISOString().slice(0, 10);
}

export function parseExplicitWeekdayAvailability(
  sourceText: string,
  referenceDate: string,
): AvailabilityParseResult | null {
  const weekdayMatches: Array<[RegExp, number]> = [
    [/(?:周|星期|礼拜)[日天]/i, 0],
    [/(?:周|星期|礼拜)一/i, 1],
    [/(?:周|星期|礼拜)二/i, 2],
    [/(?:周|星期|礼拜)三/i, 3],
    [/(?:周|星期|礼拜)四/i, 4],
    [/(?:周|星期|礼拜)五/i, 5],
    [/(?:周|星期|礼拜)六/i, 6],
    [/\bsunday\b/i, 0],
    [/\bmonday\b/i, 1],
    [/\btuesday\b/i, 2],
    [/\bwednesday\b/i, 3],
    [/\bthursday\b/i, 4],
    [/\bfriday\b/i, 5],
    [/\bsaturday\b/i, 6],
  ];
  const weekdayMatch = weekdayMatches.find(([pattern]) => pattern.test(sourceText));
  if (!weekdayMatch) return null;
  const [weekdayPattern, weekday] = weekdayMatch;

  const normalized = sourceText
    .replace(weekdayPattern, ' ')
    .replace(/(\d{1,2})点半/g, '$1:30')
    .replace(/(\d{1,2})点/g, '$1:00');
  const timePattern = /(?:(AM|PM|上午|下午|晚上|中午)\s*)?(\d{1,2})(?::(\d{2}))?\s*(AM|PM|上午|下午|晚上|中午)?/gi;
  const matches = [...normalized.matchAll(timePattern)];
  if (matches.length < 2) return null;
  const startTime = to24Hour(matches[0][2], matches[0][3], matches[0][1] || matches[0][4]);
  const endTime = to24Hour(matches[1][2], matches[1][3], matches[1][1] || matches[1][4]);
  if (!startTime || !endTime) return null;

  const rules = normalizeAvailabilityRules(
    /每周|每个星期|每星期|\bevery\b|\beach\b/i.test(sourceText)
      ? [{ type: 'weekly', weekdays: [weekday], startTime, endTime }]
      : [{
          type: 'date',
          date: nearestWeekdayDate(referenceDate, weekday),
          startTime,
          endTime,
        }],
  );
  if (!rules.length) return null;
  const summary = sourceText.trim();
  return {
    status: 'valid',
    rules,
    summary,
    message: '已识别买家的可看时间。',
    serialized: serializeTourAvailability({ sourceText, summary, rules }),
    targetDate: nextRuleDate(referenceDate, rules),
  };
}

export async function parseNaturalLanguageAvailability(
  text: string,
  referenceDate = dateInSingapore(),
  history: AvailabilityConversationMessage[] = [],
): Promise<AvailabilityParseResult> {
  const safeHistory = history
    .filter((message) =>
      (message.role === 'user' || message.role === 'assistant') &&
      typeof message.content === 'string' &&
      message.content.trim(),
    )
    .slice(-12)
    .map((message) => ({ role: message.role, content: message.content.trim() }));
  const sourceText = [...safeHistory.filter((message) => message.role === 'user'), {
    role: 'user' as const,
    content: text.trim(),
  }]
    .map((message) => message.content)
    .join('\n');
  const safeReferenceDate = isValidReferenceDate(referenceDate)
    ? referenceDate
    : dateInSingapore();
  if (!sourceText) {
    return {
      status: 'invalid',
      rules: [],
      summary: '',
      message: '请填写买家可以看房的日期和时间。',
    };
  }

  const response = await openai.chat.completions.create({
    model: SCHEDULING_AGENT_MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: [
          'Extract a Singapore property buyer viewing availability from natural language.',
          'Return JSON only with: status, rules, summary, message. rules must always be an array, including when there is only one rule.',
          'status must be valid, needs_clarification, or invalid.',
          'Rules are either {"type":"date","date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM"} or {"type":"weekly","weekdays":[0-6],"startTime":"HH:MM","endTime":"HH:MM"}. Sunday=0, Saturday=6.',
          'Recurring inputs such as 每周六下午2点 / every Saturday at 2pm are VALID weekly rules.',
          'A weekday without a recurrence word means the nearest upcoming occurrence and is a VALID date rule. Example: 周六 10:00 AM-4:30 PM means the next Saturday 10:00-16:30. Do not ask for a date.',
          'Only phrases that explicitly mean every/each/每周/每个星期 are weekly rules.',
          'For a single time point, use a 30-minute window. Example: 2pm means 14:00-14:30.',
          'Resolve 今天/today, 明天/tomorrow and dated weekday references using the supplied reference date.',
          'Broad named periods may use: morning 09:00-12:00, afternoon 12:00-18:00, evening 18:00-21:00.',
          'If the user gives a day or recurrence but no usable time, return needs_clarification and ask for the time.',
          'Use the full conversation. A short latest reply such as "10点到4点半" may complete a weekday supplied earlier.',
          'When status is needs_clarification, message must be one concise, specific question for the missing information.',
          'If there is no availability information, return invalid.',
          'Do not invent a weekday, date, or time not implied by the user.',
          'summary and message should use the same language as the user.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          'Timezone: Asia/Singapore',
          `Reference date: ${safeReferenceDate}`,
          `Upcoming weekday dates: ${upcomingWeekdayDates(safeReferenceDate)}`,
          'Conversation:',
          ...safeHistory.map((message) => `${message.role}: ${message.content}`),
          `user: ${text.trim()}`,
        ].join('\n'),
      },
    ],
  });

  const content = response.choices[0]?.message?.content || '{}';
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content) as Record<string, unknown>;
  } catch {
    return {
      status: 'invalid',
      rules: [],
      summary: '',
      message: 'AI 暂时无法理解这个时间，请换一种说法并明确日期和时间。',
    };
  }

  const status = parsed.status;
  const rules = normalizeAvailabilityRules(parsed.rules);
  const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
  const message = typeof parsed.message === 'string' ? parsed.message.trim() : '';
  if (status !== 'valid' || !rules.length || !summary) {
    const explicitWeekday = parseExplicitWeekdayAvailability(sourceText, safeReferenceDate);
    if (explicitWeekday) return explicitWeekday;
    return {
      status: status === 'needs_clarification' ? 'needs_clarification' : 'invalid',
      rules: [],
      summary: '',
      message: message || '请明确填写买家可以看房的日期和时间。',
    };
  }

  return {
    status: 'valid',
    rules,
    summary,
    message: message || '已识别买家的可看时间。',
    serialized: serializeTourAvailability({ sourceText, summary, rules }),
    targetDate: nextRuleDate(safeReferenceDate, rules),
  };
}
