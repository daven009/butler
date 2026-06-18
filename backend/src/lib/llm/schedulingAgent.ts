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
import { getBuyerSlotsForTour } from '../repositories/conversationsMock';
import { listingNumberById, sortListingsForScheduleView } from './listingIndex';
import {
  SCHEDULING_AGENT_MODEL,
  SESSION_LIMITS,
  openai,
  readUsage,
} from './openaiClient';
import {
  SCHEDULING_TOOL_NAMES,
  type SchedulingToolName,
  buildSystemPrompt,
  getSchedulingTools,
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
async function buildPromptContext(tourId: string, focusedListingId?: string) {
  const tour = await getTourDetail(tourId);
  const listings = await listListingsByTour(tourId);
  const sellerDates = listings.flatMap((listing) =>
    (listing.availability || []).map((slot) => slot.date),
  );
  const buyerSlots = await getBuyerSlotsForTour(tourId, sellerDates);
  const sortedListings = sortListingsForScheduleView(listings);
  const listingNumbers = listingNumberById(listings);
  const scheduled = sortedListings.filter((l) => l.status === 'confirmed' && l.suggestedTime);
  const unscheduled = sortedListings.filter((l) => l.status !== 'confirmed');

  const scheduleTable = scheduled
    .map((l) => `  #${listingNumbers.get(l.id)}  ${l.suggestedTime}  ${l.title} (${l.area}) — id=${l.id} — ${l.coAgent.name}`)
    .join('\n');
  const unscheduledList = unscheduled
    .map((l) => `  #${listingNumbers.get(l.id)}  ${l.title} (${l.area}) — id=${l.id}: ${l.attentionReason || 'not scheduled yet'}`)
    .join('\n');
  const focused = focusedListingId
    ? listings.find((listing) => listing.id === focusedListingId)
    : undefined;

  return {
    buyerName: tour?.title?.replace(/'s tour.*$/i, '') || 'the buyer',
    targetDate: buyerSlots.length
      ? buyerSlots.map((slot) => `${slot.date} ${slot.startTime}-${slot.endTime}`).join(', ')
      : tour?.targetDate || 'not provided',
    totalListings: listings.length,
    scheduledCount: scheduled.length,
    unscheduledCount: unscheduled.length,
    scheduleTable,
    unscheduledList,
    focusedListing: focused
      ? [
          `#${listingNumbers.get(focused.id)} ${focused.title} (${focused.id})`,
          `area=${focused.area}`,
          `status=${focused.status}`,
          `currentTime=${focused.suggestedTime ?? 'not scheduled'}`,
          `coAgentAvailability=${JSON.stringify(focused.availability ?? [])}`,
          `attentionReason=${focused.attentionReason ?? 'none'}`,
        ].join('; ')
      : undefined,
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

const PROPOSAL_TOOL_NAMES = new Set<SchedulingToolName>([
  'propose_reschedule',
  'propose_swap',
  'propose_drop',
  'propose_add_constraint',
  'submit_listing_brief',
]);

function readToolError(result: unknown): string | undefined {
  if (!result || typeof result !== 'object' || !('error' in result)) return undefined;
  const error = (result as { error?: unknown }).error;
  return typeof error === 'string' ? error : undefined;
}

function didInitializeTour(result: unknown): boolean {
  return Boolean(
    result &&
    typeof result === 'object' &&
    'tourInitialized' in result &&
    (result as { tourInitialized?: unknown }).tourInitialized === true,
  );
}

function proposalFailureReply(error: string, userText: string): string {
  const preservePrefix =
    'The requested constraints cannot preserve all confirmed listings: ';
  if (error.startsWith(preservePrefix)) {
    const listings = error.slice(preservePrefix.length);
    if (/[\u3400-\u9fff]/u.test(userText)) {
      return `当前要求无法同时满足：加入这套房源会影响已确认的 ${listings}。由于你要求保留全部已确认房源，我没有生成删除方案；请调整时间限制或明确允许移动该房源。`;
    }
    return `These constraints would affect the confirmed listing ${listings}, so I did not create a drop proposal. Adjust the time constraint or explicitly allow that listing to move.`;
  }
  if (/[\u3400-\u9fff]/u.test(userText)) {
    return `当前约束无法生成可行方案：${error}`;
  }
  return `I couldn't create a valid proposal: ${error}`;
}

/**
 * Run one user → assistant turn. Returns the final assistant message that
 * was appended to the session.
 */
export async function runAgentTurn(
  sessionId: string,
  userText: string,
  focusedListingId?: string,
): Promise<SessionMessage> {
  const session = await getSession(sessionId);
  if (!session) throw new Error('SESSION_NOT_FOUND');
  const sessionListingId = session.listingId ?? focusedListingId;
  if (
    session.listingId &&
    focusedListingId &&
    session.listingId !== focusedListingId
  ) {
    throw new Error('SESSION_LISTING_MISMATCH');
  }

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
  const ctx = await buildPromptContext(session.tourId, sessionListingId);
  const listingScoped = Boolean(session.listingId);
  const systemPrompt = buildSystemPrompt({ ...ctx, listingScoped });
  const tools = getSchedulingTools(listingScoped);
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
  let proposalError: string | undefined;
  let tourInitialized = false;

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
      tools,
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
      } else if (
        session.listingId &&
        PROPOSAL_TOOL_NAMES.has(name) &&
        name !== 'submit_listing_brief'
      ) {
        result = {
          error:
            'Listing-scoped sessions must finalize requirements through submit_listing_brief.',
        };
      } else if (proposalError && PROPOSAL_TOOL_NAMES.has(name)) {
        result = {
          skipped: true,
          reason: 'Skipped because an earlier proposal failed in this turn.',
        };
      } else {
        try {
          result = await runTool(name, parsedArgs, {
            tourId: session.tourId,
            sessionId,
            focusedListingId: sessionListingId,
          });
        } catch (err) {
          result = { error: (err as Error).message };
        }
      }
      if (!proposalError && PROPOSAL_TOOL_NAMES.has(name)) {
        proposalError = readToolError(result);
      }
      if (name === 'submit_listing_brief' && didInitializeTour(result)) {
        tourInitialized = true;
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
    if (proposalError) {
      finalAssistantText = proposalFailureReply(proposalError, userText);
      await appendMessage(sessionId, {
        role: 'assistant',
        content: finalAssistantText,
      });
      break;
    }
    if (tourInitialized) {
      finalAssistantText = /[\u3400-\u9fff]/u.test(userText)
        ? 'Tour scheduling 已建立，这套房源已作为第一个有效房源加入初始排期方案，请确认方案。'
        : 'Tour scheduling is now established, and this is the first valid listing in the initial proposal. Please review it.';
      await appendMessage(sessionId, {
        role: 'assistant',
        content: finalAssistantText,
      });
      break;
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
