/**
 * OpenAI client wrapper.
 *
 * Single instance of the official SDK plus a small helper for "chat with
 * tools" calls so the rest of the codebase doesn't have to know the SDK
 * shape.
 *
 * KEY HANDLING:
 *   - Read from process.env.OPENAI_API_KEY at startup.
 *   - Never log the key. Never include it in any error response surfaced
 *     to a user.
 *   - Throw a clear error at module load if missing — better to fail fast
 *     than to surprise the agent loop later.
 *
 * MODEL CHOICE: gpt-4o-mini (PRD §8.6.4 lock-in).
 *   - Cheap enough that a single agent loop is well under $0.01.
 *   - Tool-calling support is robust.
 *   - 128K context — we are nowhere near that for one schedule.
 */

import OpenAI from 'openai';

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  throw new Error(
    '[openai] Missing OPENAI_API_KEY env var. Set it in backend/.env (locally) or /opt/appointment-scheduler/.env (prod).',
  );
}

export const openai = new OpenAI({ apiKey });

export const SCHEDULING_AGENT_MODEL = 'gpt-4o-mini';

/**
 * Per-session safety caps. The agent loop checks against these before
 * dispatching another LLM call. Hitting any one of them ends the session
 * with a polite "out of budget" assistant turn.
 *
 * Numbers come from PRD §8.6.4. Tuned to keep a single tour's chat well
 * under $0.02 even with chatty users.
 */
export const SESSION_LIMITS = {
  maxPromptTokens: 100_000,    // ~$0.015 worth of input tokens at gpt-4o-mini
  maxTotalTurns: 30,           // One "turn" = one assistant response
} as const;

/**
 * Centralized cost shape so callers don't reinvent it. The OpenAI SDK
 * returns a `usage` object on chat completions; we widen the type a bit
 * because some non-streaming responses return undefined fields.
 */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export function readUsage(usage: OpenAI.CompletionUsage | undefined): TokenUsage {
  return {
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
  };
}
