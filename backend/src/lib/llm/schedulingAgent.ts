/**
 * Scheduling agent loop.
 *
 * One call to `runAgentTurn(sessionId, userMessage)`:
 *   1. Persist the user message.
 *   2. Materialize OpenAI message array from session history (with system
 *      prompt rebuilt fresh against current schedule).
 *   3. Call gpt-4o-mini with our tool catalogue.
 *   4. If the response has tool_calls → execute each tool, persist tool
 *      messages, loop back to (3) until the model produces plain text.
 *   5. Persist the final assistant message and return it.
 *
 * Bounded by SESSION_LIMITS (PRD §8.6.4). On hitting any limit we emit a
 * synthetic assistant message explaining the budget cap; we do not call
 * the LLM again in that session.
 */

import {
  type SchedulingSession,
  type SessionMessage,
  appendMessage,
  getSession,
  listMessagesForSession,
  recordTurnUsage,
} from '../repositories/schedulingSessionsRepository';
import { getTourDetail, listListingsByTour } from '../repositories/plansRepository';
import {
  DEFAULT_BUTLER_PERSONA,
  getMyPreferences,
} from '../repositories/userPreferencesRepository';
import {
  SCHEDULING_AGENT_MODEL,
  SESSION_LIMITS,
  openai,
  readUsage,
} from './openaiClient';
import {
  SCHEDULING_TOOL_NAMES,
  SCHEDULING_TOOLS,
  type SchedulingToolName,
  buildSystemPrompt,
} from './schedulingToolDefs';
import { runTool } from './schedulingTools';
import type {
  ChatCompletionMessageParam,
  ChatCompletionAssistantMessageParam,
} from 'openai/resources/chat/completions';

/**
 * Hard cap on tool-call rounds within a single user turn — protects against
 * a model that loops between get_schedule and get_listing_detail forever.
 * Real conversations almost always settle in 1–2 rounds.
 */
const MAX_TOOL_ROUNDS_PER_TURN = 5;

/** Best-effort scheduler-friendly snippet for the system prompt. */
async function buildPromptContext(tourId: string) {
  const tour = await getTourDetail(tourId);
  const listings = await listListingsByTour(tourId);
  const scheduled = listings.filter((l) => l.status === 'confirmed' && l.suggestedTime);
  const unscheduled = listings.filter(
    (l) => l.status !== 'confirmed' && l.status !== 'imported',
  );
  // Sort scheduled by start time (HH:MM)
  scheduled.sort((a, b) => (a.suggestedTime || '').localeCompare(b.suggestedTime || ''));

  const scheduleTable = scheduled
    .map((l) => `  ${l.suggestedTime}  ${l.title} (${l.area}) — ${l.coAgent.name}`)
    .join('\n');
  const unscheduledList = unscheduled
    .map((l) => `  - ${l.title} (${l.area}): ${l.attentionReason || 'no slot'}`)
    .join('\n');

  return {
    buyerName: tour?.title?.replace(/'s tour.*$/i, '') || 'the buyer',
    targetDate: tour?.targetDate || 'today',
    totalListings: listings.length,
    scheduledCount: scheduled.length,
    unscheduledCount: unscheduled.length,
    scheduleTable,
    unscheduledList,
  };
}

/**
 * Convert the persisted session history into the OpenAI message array.
 * The system prompt is *not* persisted — we rebuild it fresh on every
 * turn because the schedule may have changed since the last user turn.
 */
function toOpenAIMessages(history: SessionMessage[]): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [];
  for (const m of history) {
    if (m.role === 'system') continue; // we always rebuild this
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content || '' });
    } else if (m.role === 'assistant') {
      // An assistant message is either plain text OR a tool-call request.
      const msg: ChatCompletionAssistantMessageParam = {
        role: 'assistant',
        content: m.content || null,
      };
      if (m.toolCalls?.length) msg.tool_calls = m.toolCalls;
      out.push(msg);
    } else if (m.role === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: m.toolCallId || '',
        content:
          typeof m.toolResult === 'string'
            ? m.toolResult
            : JSON.stringify(m.toolResult ?? null),
      });
    }
  }
  return out;
}

/** Did this session blow through the §8.6.4 budget? */
function isOverBudget(session: SchedulingSession): boolean {
  return (
    session.promptTokens >= SESSION_LIMITS.maxPromptTokens ||
    session.totalTurns >= SESSION_LIMITS.maxTotalTurns
  );
}

const BUDGET_EXHAUSTED_REPLY =
  "I've reached this conversation's compute budget. Please confirm the current schedule, or start a fresh scheduling run if you need bigger changes.";

/**
 * Run one user → assistant turn. Returns the final assistant message that
 * was appended to the session.
 */
export async function runAgentTurn(
  sessionId: string,
  userText: string,
): Promise<SessionMessage> {
  const session = await getSession(sessionId);
  if (!session) throw new Error('SESSION_NOT_FOUND');

  // 1. Persist the user message immediately.
  await appendMessage(sessionId, { role: 'user', content: userText });

  // 2. Budget check — before spending any tokens.
  if (isOverBudget(session)) {
    return appendMessage(sessionId, {
      role: 'assistant',
      content: BUDGET_EXHAUSTED_REPLY,
    });
  }

  // 3. Build fresh OpenAI message array.
  const ctx = await buildPromptContext(session.tourId);
  // Pull user-customized persona; fall back to the default Butler voice.
  const prefs = await getMyPreferences().catch(() => ({ butlerPersona: null }));
  const persona =
    (prefs.butlerPersona && prefs.butlerPersona.trim()) || DEFAULT_BUTLER_PERSONA;
  const systemPrompt = buildSystemPrompt({ ...ctx, persona });
  const history = await listMessagesForSession(sessionId);
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...toOpenAIMessages(history),
  ];

  // 4. Loop: keep calling the LLM as long as it asks for tool calls.
  let toolRound = 0;
  let cumulativePromptTokens = 0;
  let cumulativeCompletionTokens = 0;
  let finalAssistantText = '';

  while (true) {
    if (toolRound >= MAX_TOOL_ROUNDS_PER_TURN) {
      // Defensive — extremely rare. Force a final assistant turn.
      console.warn('[agent] tool-round cap hit on session', sessionId);
      finalAssistantText =
        "I'm having trouble settling on an answer. Please rephrase or ask a more specific question.";
      break;
    }

    const completion = await openai.chat.completions.create({
      model: SCHEDULING_AGENT_MODEL,
      messages,
      tools: SCHEDULING_TOOLS,
      temperature: 0.3,
      max_tokens: 800,
    });

    const usage = readUsage(completion.usage);
    cumulativePromptTokens += usage.promptTokens;
    cumulativeCompletionTokens += usage.completionTokens;

    const choice = completion.choices[0];
    const aMsg = choice.message;

    // Append the assistant turn — even when it's only tool_calls (content
    // null is allowed). We persist + add to in-memory `messages` so the
    // next round sees the chain correctly.
    //
    // Note: OpenAI's SDK union types now split tool_calls into "function"
    // and "custom" variants. We only ever issue function tools (no
    // custom-tool registrations), so we narrow to function calls and
    // ignore anything else (defensive — should never appear).
    const fnToolCalls = (aMsg.tool_calls ?? []).filter(
      (tc): tc is Extract<typeof tc, { type: 'function' }> => tc.type === 'function',
    );
    await appendMessage(sessionId, {
      role: 'assistant',
      content: aMsg.content || undefined,
      toolCalls: fnToolCalls.length
        ? fnToolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          }))
        : undefined,
    });
    messages.push({
      role: 'assistant',
      content: aMsg.content,
      tool_calls: aMsg.tool_calls,
    } as ChatCompletionAssistantMessageParam);

    // No tool calls → this is the final answer. Done.
    if (!fnToolCalls.length) {
      finalAssistantText = aMsg.content || '';
      break;
    }

    // Execute each tool call, persist + add tool messages.
    for (const tc of fnToolCalls) {
      const name = tc.function.name as SchedulingToolName;
      const isKnown = SCHEDULING_TOOL_NAMES.includes(name);
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(tc.function.arguments || '{}');
      } catch {
        parsedArgs = {};
      }

      let result: unknown;
      if (!isKnown) {
        result = { error: `Unknown tool: ${name}` };
      } else {
        try {
          result = await runTool(name, parsedArgs, {
            tourId: session.tourId,
            sessionId,
          });
        } catch (err) {
          result = { error: (err as Error).message };
        }
      }

      await appendMessage(sessionId, {
        role: 'tool',
        toolCallId: tc.id,
        toolName: name,
        toolResult: result,
      });
      messages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: JSON.stringify(result),
      });
    }
    toolRound++;
  }

  // 5. Bookkeeping.
  await recordTurnUsage(sessionId, cumulativePromptTokens, cumulativeCompletionTokens);

  // We already persisted the final assistant message inside the loop, but
  // the caller wants the SessionMessage object back; re-fetch the latest one.
  const allHistory = await listMessagesForSession(sessionId);
  const final = allHistory[allHistory.length - 1];
  // Should be assistant; if not (very rare), synthesize.
  if (final.role === 'assistant') return final;
  return appendMessage(sessionId, {
    role: 'assistant',
    content: finalAssistantText || '(no reply)',
  });
}
