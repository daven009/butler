/**
 * Scheduling sessions repository.
 *
 * Backs the §8.6.3 chat-with-Butler refinement UX. A session is opened
 * after a scheduling_run completes; the user converses with the agent;
 * the agent proposes mutations; user clicks Apply to commit.
 *
 * RLS does the per-user isolation — every read/write goes through the
 * user-scoped Supabase client (`db()` from userContext).
 */

import { getCurrentUserId, getCurrentJwt } from '../userContext';
import { supabaseForUser } from '../supabase';
import type { SupabaseClient } from '@supabase/supabase-js';

function db(): SupabaseClient {
  return supabaseForUser(getCurrentJwt());
}

function isUniqueViolation(error: unknown): boolean {
  const err = error as { code?: string; message?: string } | null;
  return (
    err?.code === '23505' ||
    Boolean(err?.message?.includes('duplicate key value violates unique constraint'))
  );
}

// ─── Types ──────────────────────────────────────────────────────────────

export interface SchedulingSession {
  id: string;
  tourId: string;
  listingId?: string;
  userId: string;
  runId?: string;
  status: 'open' | 'finalized' | 'archived';
  finalizedAt?: string;
  promptTokens: number;
  completionTokens: number;
  totalTurns: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListingSchedulingBrief {
  id: string;
  tourId: string;
  listingId: string;
  userId: string;
  sessionId: string;
  status: 'clarifying' | 'ready';
  priority: 'low' | 'normal' | 'high';
  constraints: Array<{
    type: string;
    scope?: 'listing' | 'tour';
    listing_id?: string;
    value?: string;
    end_value?: string;
  }>;
  flexibility: Record<string, unknown>;
  summary?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type SessionMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface SessionMessage {
  id: string;
  sessionId: string;
  role: SessionMessageRole;
  content?: string;
  /** When role='assistant' and a tool call was issued */
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
  /** When role='tool' */
  toolCallId?: string;
  toolName?: string;
  toolResult?: unknown;
  createdAt: string;
}

export type ProposalChangeAction = 'reschedule' | 'swap' | 'drop' | 'add';

export interface ProposalChange {
  listingId: string;
  listingLabel?: string;
  action: ProposalChangeAction;
  /** Pre-change state, e.g. "14:00 – 14:30" */
  from: string | null;
  /** Post-change state */
  to: string | null;
  /** Final listing state when a full re-plan makes a listing unschedulable. */
  resultStatus?: 'imported' | 'confirmed' | 'needs-attention';
  reason?: string | null;
}

export interface ScheduleChangeProposal {
  id: string;
  sessionId: string;
  messageId?: string;
  intentSummary?: string;
  mode: 'local' | 'full';
  changes: ProposalChange[];
  cascade: ProposalChange[];
  appliedAt?: string;
  discardedAt?: string;
  createdAt: string;
}

// ─── Row shapes (snake_case from Postgres) ──────────────────────────────

interface SessionRow {
  id: string;
  tour_id: string;
  listing_id: string | null;
  user_id: string;
  run_id: string | null;
  status: 'open' | 'finalized' | 'archived';
  finalized_at: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  total_turns: number;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  session_id: string;
  user_id: string;
  role: SessionMessageRole;
  content: string | null;
  tool_calls: SessionMessage['toolCalls'] | null;
  tool_call_id: string | null;
  tool_name: string | null;
  tool_result: unknown;
  created_at: string;
}

interface ProposalRow {
  id: string;
  session_id: string;
  user_id: string;
  message_id: string | null;
  intent_summary: string | null;
  mode: 'local' | 'full';
  changes: ProposalChange[];
  cascade: ProposalChange[];
  applied_at: string | null;
  discarded_at: string | null;
  created_at: string;
}

interface BriefRow {
  id: string;
  tour_id: string;
  listing_id: string;
  user_id: string;
  session_id: string;
  status: 'clarifying' | 'ready';
  priority: 'low' | 'normal' | 'high';
  constraints: ListingSchedulingBrief['constraints'];
  flexibility: Record<string, unknown>;
  summary: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

function rowToSession(r: SessionRow): SchedulingSession {
  return {
    id: r.id,
    tourId: r.tour_id,
    listingId: r.listing_id ?? undefined,
    userId: r.user_id,
    runId: r.run_id ?? undefined,
    status: r.status,
    finalizedAt: r.finalized_at ?? undefined,
    promptTokens: r.prompt_tokens,
    completionTokens: r.completion_tokens,
    totalTurns: r.total_turns,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToBrief(r: BriefRow): ListingSchedulingBrief {
  return {
    id: r.id,
    tourId: r.tour_id,
    listingId: r.listing_id,
    userId: r.user_id,
    sessionId: r.session_id,
    status: r.status,
    priority: r.priority,
    constraints: r.constraints ?? [],
    flexibility: r.flexibility ?? {},
    summary: r.summary ?? undefined,
    version: r.version,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToMessage(r: MessageRow): SessionMessage {
  return {
    id: r.id,
    sessionId: r.session_id,
    role: r.role,
    content: r.content ?? undefined,
    toolCalls: r.tool_calls ?? undefined,
    toolCallId: r.tool_call_id ?? undefined,
    toolName: r.tool_name ?? undefined,
    toolResult: r.tool_result ?? undefined,
    createdAt: r.created_at,
  };
}

function rowToProposal(r: ProposalRow): ScheduleChangeProposal {
  return {
    id: r.id,
    sessionId: r.session_id,
    messageId: r.message_id ?? undefined,
    intentSummary: r.intent_summary ?? undefined,
    mode: r.mode,
    changes: r.changes ?? [],
    cascade: r.cascade ?? [],
    appliedAt: r.applied_at ?? undefined,
    discardedAt: r.discarded_at ?? undefined,
    createdAt: r.created_at,
  };
}

// ─── Sessions ───────────────────────────────────────────────────────────

/**
 * Get-or-create an open session. Listing conversations are unique per
 * (tour, listing, user); listingId=null is the legacy/global Tour thread.
 */
export async function getOrOpenSession(
  tourId: string,
  runId?: string,
  listingId?: string,
): Promise<SchedulingSession> {
  const userId = getCurrentUserId();
  const c = db();

  const findOpenSession = async (): Promise<SchedulingSession | undefined> => {
    let query = c
      .from('scheduling_sessions')
      .select('*')
      .eq('tour_id', tourId)
      .eq('user_id', userId)
      .eq('status', 'open');
    query = listingId ? query.eq('listing_id', listingId) : query.is('listing_id', null);
    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? rowToSession(data as SessionRow) : undefined;
  };

  const existing = await findOpenSession();
  if (existing) return existing;

  const { data, error } = await c
    .from('scheduling_sessions')
    .insert({
      tour_id: tourId,
      listing_id: listingId ?? null,
      user_id: userId,
      run_id: runId ?? null,
      status: 'open',
    })
    .select()
    .single();
  if (error) {
    if (isUniqueViolation(error)) {
      const session = await findOpenSession();
      if (session) return session;
    }
    throw error;
  }
  return rowToSession(data as SessionRow);
}

export async function upsertListingBrief(input: {
  tourId: string;
  listingId: string;
  sessionId: string;
  status: 'clarifying' | 'ready';
  priority?: 'low' | 'normal' | 'high';
  constraints: ListingSchedulingBrief['constraints'];
  flexibility?: Record<string, unknown>;
  summary?: string;
}): Promise<ListingSchedulingBrief> {
  const userId = getCurrentUserId();
  const c = db();
  const { data: existing, error: readError } = await c
    .from('listing_scheduling_briefs')
    .select('version')
    .eq('tour_id', input.tourId)
    .eq('listing_id', input.listingId)
    .eq('user_id', userId)
    .maybeSingle();
  if (readError) throw readError;
  const { data, error } = await c
    .from('listing_scheduling_briefs')
    .upsert(
      {
        tour_id: input.tourId,
        listing_id: input.listingId,
        user_id: userId,
        session_id: input.sessionId,
        status: input.status,
        priority: input.priority ?? 'normal',
        constraints: input.constraints,
        flexibility: input.flexibility ?? {},
        summary: input.summary ?? null,
        version: ((existing as { version?: number } | null)?.version ?? 0) + 1,
      },
      { onConflict: 'tour_id,listing_id,user_id' },
    )
    .select()
    .single();
  if (error) throw error;
  return rowToBrief(data as BriefRow);
}

export async function getListingBrief(
  tourId: string,
  listingId: string,
): Promise<ListingSchedulingBrief | undefined> {
  const { data, error } = await db()
    .from('listing_scheduling_briefs')
    .select('*')
    .eq('tour_id', tourId)
    .eq('listing_id', listingId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToBrief(data as BriefRow) : undefined;
}

export async function listReadyListingBriefs(
  tourId: string,
): Promise<ListingSchedulingBrief[]> {
  const { data, error } = await db()
    .from('listing_scheduling_briefs')
    .select('*')
    .eq('tour_id', tourId)
    .eq('status', 'ready')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as BriefRow[]).map(rowToBrief);
}

export async function getSession(sessionId: string): Promise<SchedulingSession | undefined> {
  const { data, error } = await db()
    .from('scheduling_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToSession(data as SessionRow) : undefined;
}

export async function listMessagesForSession(sessionId: string): Promise<SessionMessage[]> {
  const { data, error } = await db()
    .from('scheduling_session_messages')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as MessageRow[]).map(rowToMessage);
}

export async function appendMessage(
  sessionId: string,
  msg: Omit<SessionMessage, 'id' | 'sessionId' | 'createdAt'>,
): Promise<SessionMessage> {
  const userId = getCurrentUserId();
  const { data, error } = await db()
    .from('scheduling_session_messages')
    .insert({
      session_id: sessionId,
      user_id: userId,
      role: msg.role,
      content: msg.content ?? null,
      tool_calls: msg.toolCalls ?? null,
      tool_call_id: msg.toolCallId ?? null,
      tool_name: msg.toolName ?? null,
      tool_result: msg.toolResult ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToMessage(data as MessageRow);
}

/** Bump session usage counters after a successful LLM call. */
export async function recordTurnUsage(
  sessionId: string,
  promptTokens: number,
  completionTokens: number,
): Promise<void> {
  // Read-modify-write because supabase-js doesn't expose atomic increments
  // through the type-safe path. Fine here because (a) sessions are
  // per-user, (b) LLM turns are sequential (we await each round), so no
  // contention.
  const { data: row, error: readErr } = await db()
    .from('scheduling_sessions')
    .select('prompt_tokens, completion_tokens, total_turns')
    .eq('id', sessionId)
    .maybeSingle();
  if (readErr) throw readErr;
  if (!row) return;
  const r = row as { prompt_tokens: number; completion_tokens: number; total_turns: number };
  const { error: updErr } = await db()
    .from('scheduling_sessions')
    .update({
      prompt_tokens: r.prompt_tokens + promptTokens,
      completion_tokens: r.completion_tokens + completionTokens,
      total_turns: r.total_turns + 1,
    })
    .eq('id', sessionId);
  if (updErr) throw updErr;
}

// ─── Proposals ──────────────────────────────────────────────────────────

export async function createProposal(
  sessionId: string,
  proposal: Omit<ScheduleChangeProposal, 'id' | 'sessionId' | 'createdAt' | 'appliedAt' | 'discardedAt'>,
): Promise<ScheduleChangeProposal> {
  const userId = getCurrentUserId();
  const { data, error } = await db()
    .from('schedule_change_proposals')
    .insert({
      session_id: sessionId,
      user_id: userId,
      message_id: proposal.messageId ?? null,
      intent_summary: proposal.intentSummary ?? null,
      mode: proposal.mode,
      changes: proposal.changes,
      cascade: proposal.cascade,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToProposal(data as ProposalRow);
}

export async function listProposalsForSession(
  sessionId: string,
): Promise<ScheduleChangeProposal[]> {
  const { data, error } = await db()
    .from('schedule_change_proposals')
    .select('*')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as ProposalRow[]).map(rowToProposal);
}

export async function getProposal(
  proposalId: string,
): Promise<ScheduleChangeProposal | undefined> {
  const { data, error } = await db()
    .from('schedule_change_proposals')
    .select('*')
    .eq('id', proposalId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToProposal(data as ProposalRow) : undefined;
}

export async function markProposalApplied(proposalId: string): Promise<void> {
  const { error } = await db()
    .from('schedule_change_proposals')
    .update({ applied_at: new Date().toISOString() })
    .eq('id', proposalId);
  if (error) throw error;
}

export async function markProposalDiscarded(proposalId: string): Promise<void> {
  const { error } = await db()
    .from('schedule_change_proposals')
    .update({ discarded_at: new Date().toISOString() })
    .eq('id', proposalId);
  if (error) throw error;
}
