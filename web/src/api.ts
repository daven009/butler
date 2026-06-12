/**
 * API Client — connects butler-web frontend to the backend.
 *
 * All functions mirror the apiContracts in domain.ts.
 * Falls back to mock data if backend is unreachable.
 */

import {
  type ViewingPlan,
  type ViewingTour,
  type Listing,
  type ConversationMessage,
  type AgentRoute,
} from './domain'
import { getStoredToken, signOut } from './auth'

const API_BASE = import.meta.env.VITE_API_BASE || '/api'

export class UnauthorizedError extends Error {
  constructor(msg = 'Not signed in') {
    super(msg)
    this.name = 'UnauthorizedError'
  }
}

/* ─── Generic fetch helper ─── */

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`
  const method = options?.method || 'GET'
  const token = getStoredToken()
  console.log(`[api] → ${method} ${url}`)
  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options?.headers,
      },
      ...options,
    })
  } catch (e) {
    console.error(`[api] ✗ network error ${method} ${url}:`, e)
    throw e
  }
  console.log(`[api] ← ${method} ${url} status=${res.status}`)
  if (res.status === 401) {
    // Token missing / unrecognized — bounce back to sign-in.
    console.warn('[api] 401 — clearing session and reloading to sign-in.')
    await signOut()
    // Reload so the App boot path lands on <SignIn />. Avoid infinite loops
    // by checking we actually had a token; otherwise just throw.
    if (token) window.location.reload()
    throw new UnauthorizedError()
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }))
    console.error(`[api] ✗ ${method} ${url} body:`, err)
    throw new Error(err?.error?.message || `API Error ${res.status}`)
  }
  if (res.status === 204) {
    console.log(`[api] ✓ ${method} ${url} no content`)
    return undefined as T
  }
  const text = await res.text()
  if (!text) {
    console.log(`[api] ✓ ${method} ${url} empty body`)
    return undefined as T
  }
  const json = JSON.parse(text)
  console.log(`[api] ✓ ${method} ${url} json keys:`, Object.keys(json || {}))
  return json
}

/* ─── Plans ─── */

export async function fetchPlans(): Promise<ViewingPlan[]> {
  const data = await apiFetch<{ plans: ViewingPlan[] }>('/plans')
  return data.plans
}

export async function createPlan(input: Omit<ViewingPlan, 'id'>): Promise<ViewingPlan> {
  const data = await apiFetch<{ plan: ViewingPlan }>('/plans', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return data.plan
}

export async function updatePlan(planId: string, input: Omit<ViewingPlan, 'id'>): Promise<ViewingPlan> {
  const data = await apiFetch<{ plan: ViewingPlan }>(`/plans/${planId}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
  return data.plan
}

export async function deletePlan(planId: string): Promise<void> {
  await apiFetch(`/plans/${planId}`, { method: 'DELETE' })
}

/* ─── Tours ─── */

export async function fetchToursByPlan(planId: string): Promise<ViewingTour[]> {
  const data = await apiFetch<{ tours: ViewingTour[] }>(`/plans/${planId}/tours`)
  return data.tours
}

export async function createTour(
  planId: string,
  input: Omit<ViewingTour, 'id' | 'planId'>
): Promise<ViewingTour> {
  const data = await apiFetch<{ tour: ViewingTour }>(`/plans/${planId}/tours`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return data.tour
}

export async function deleteTour(tourId: string): Promise<void> {
  await apiFetch(`/tours/${tourId}`, { method: 'DELETE' })
}

/* ─── Listings ─── */

export async function fetchListings(tourId: string): Promise<Listing[]> {
  const data = await apiFetch<{ listings: Listing[] }>(`/tours/${tourId}/listings`)
  return data.listings
}

export async function deleteListing(tourId: string, listingId: string): Promise<void> {
  await apiFetch(`/tours/${tourId}/web-listings/${listingId}`, { method: 'DELETE' })
}

/* ─── Scheduling ─── */

export interface SeedResult {
  tourId: string
  totalListings: number
  conversationsCreated: number
  byScenario: Record<'happy' | 'partial' | 'unreachable' | 'rejected', number>
  buyerSlots: Array<{ date: string; startTime: string; endTime: string }>
}

export async function seedTourConversations(tourId: string, agentName?: string): Promise<SeedResult> {
  return apiFetch<SeedResult>(`/tours/${tourId}/conversations/seed`, {
    method: 'POST',
    body: JSON.stringify({ agentName }),
  })
}

export interface SchedulingStepDef {
  key: string
  label: string
}

export type SchedulingStepStatus = 'pending' | 'running' | 'done' | 'failed'

export interface SchedulingRun {
  id: string
  tourId: string
  status: 'running' | 'completed' | 'failed'
  progress: number
  startedAt: string
  completedAt?: string
  result?: { scheduledCount: number; attentionCount: number }
  /** Phase 1 (2026-06-03) — current named step the orchestrator was on. */
  currentStep?: string
  /** Phase 1 — full per-step status map. Order matches /api/scheduling-steps. */
  stepState?: Record<string, SchedulingStepStatus>
}

export async function startSchedulingRun(tourId: string): Promise<SchedulingRun> {
  const data = await apiFetch<{ run: SchedulingRun }>(`/tours/${tourId}/scheduling-runs`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
  return data.run
}

export async function getSchedulingRun(runId: string): Promise<SchedulingRun> {
  const data = await apiFetch<{ run: SchedulingRun }>(`/scheduling-runs/${runId}`)
  return data.run
}

/**
 * Retry a failed scheduling run from its first non-'done' step. Steps that
 * already completed are NOT re-run (the backend persists step_artifacts).
 *
 * Returns the run row with status flipped back to 'running'; poll
 * getSchedulingRun() afterwards just like a fresh run.
 */
export async function retrySchedulingRun(runId: string): Promise<SchedulingRun> {
  const data = await apiFetch<{ run: SchedulingRun }>(`/scheduling-runs/${runId}/retry`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
  return data.run
}

/**
 * Fetch the static step catalogue used by the progress UI. Cached on first
 * call — these never change at runtime.
 */
let _stepDefsCache: SchedulingStepDef[] | null = null
export async function fetchSchedulingSteps(): Promise<SchedulingStepDef[]> {
  if (_stepDefsCache) return _stepDefsCache
  const data = await apiFetch<{ steps: SchedulingStepDef[] }>(`/scheduling-steps`)
  _stepDefsCache = data.steps
  return data.steps
}

/* ─── Scheduling chat session (Phase 2B / §8.6.3) ─── */

export interface SchedulingSession {
  id: string
  tourId: string
  userId: string
  runId?: string
  status: 'open' | 'finalized' | 'archived'
  finalizedAt?: string
  promptTokens: number
  completionTokens: number
  totalTurns: number
  createdAt: string
  updatedAt: string
}

export type SessionMessageRole = 'system' | 'user' | 'assistant' | 'tool'

export interface SessionMessage {
  id: string
  sessionId: string
  role: SessionMessageRole
  content?: string
  toolCalls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  toolCallId?: string
  toolName?: string
  toolResult?: unknown
  createdAt: string
}

export type ProposalChangeAction = 'reschedule' | 'swap' | 'drop' | 'add'

export interface ProposalChange {
  listingId: string
  action: ProposalChangeAction
  from: string | null
  to: string | null
}

export interface ScheduleChangeProposal {
  id: string
  sessionId: string
  messageId?: string
  intentSummary?: string
  mode: 'local' | 'full'
  changes: ProposalChange[]
  cascade: ProposalChange[]
  appliedAt?: string
  discardedAt?: string
  createdAt: string
}

/** Open or fetch the existing open session for this tour. */
export async function openSchedulingSession(
  tourId: string,
  runId?: string,
): Promise<SchedulingSession> {
  const data = await apiFetch<{ session: SchedulingSession }>(
    `/tours/${tourId}/scheduling-sessions`,
    {
      method: 'POST',
      body: JSON.stringify({ runId: runId ?? null }),
    },
  )
  return data.session
}

export async function fetchSessionMessages(
  sessionId: string,
): Promise<{ session: SchedulingSession; messages: SessionMessage[] }> {
  return apiFetch(`/scheduling-sessions/${sessionId}/messages`)
}

/**
 * Send a user message; the backend runs one full agent turn (1–4s typical)
 * and returns the updated history. We ignore `assistant` field — caller can
 * just look at the last message in `messages`.
 */
export async function sendSchedulingMessage(
  sessionId: string,
  text: string,
): Promise<{ session: SchedulingSession; messages: SessionMessage[]; assistant: SessionMessage }> {
  return apiFetch(`/scheduling-sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

export async function fetchSessionProposals(
  sessionId: string,
): Promise<ScheduleChangeProposal[]> {
  const data = await apiFetch<{ proposals: ScheduleChangeProposal[] }>(
    `/scheduling-sessions/${sessionId}/proposals`,
  )
  return data.proposals
}

export async function applyProposal(
  proposalId: string,
): Promise<{ ok: true; appliedChanges: number }> {
  return apiFetch(`/scheduling-proposals/${proposalId}/apply`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function discardProposal(proposalId: string): Promise<void> {
  await apiFetch(`/scheduling-proposals/${proposalId}/discard`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

/* ─── Conversations ─── */

export interface Conversation {
  id: string
  listingId: string
  coAgentName: string
  listingTitle: string
  messages: ConversationMessage[]
  lastMessage: ConversationMessage
}

export async function fetchConversations(tourId: string): Promise<Conversation[]> {
  const data = await apiFetch<{ conversations: Conversation[] }>(`/tours/${tourId}/conversations`)
  return data.conversations
}

export async function fetchConversationMessages(conversationId: string): Promise<ConversationMessage[]> {
  const data = await apiFetch<{ messages: ConversationMessage[] }>(
    `/conversations/${conversationId}/messages`
  )
  return data.messages
}

export async function sendMessage(
  conversationId: string,
  body: string,
  sender?: string,
  senderName?: string
): Promise<ConversationMessage> {
  const data = await apiFetch<{ message: ConversationMessage }>(
    `/conversations/${conversationId}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({ body, sender: sender || 'agent', senderName: senderName || 'Dave Shen' }),
    }
  )
  return data.message
}

/* ─── Import ─── */

/* ─── One-shot tour import (scrape → archive → upsert into tour) ─── */

export interface TourImportResult {
  /** Latest business Listings for the tour (post-merge). */
  listings: Listing[]
  stats: {
    scraped: number
    added: number
    merged: number
    pgArchive: { inserted: number; updated: number; total: number; versionsAppended: number }
  }
}

export async function importListingsForTour(tourId: string, url: string, options?: { limit?: number; headless?: boolean }): Promise<TourImportResult> {
  console.log('[api] importListingsForTour', { tourId, url, options })
  const result = await apiFetch<TourImportResult>(`/tours/${tourId}/import`, {
    method: 'POST',
    body: JSON.stringify({ url, limit: options?.limit || 20, headless: options?.headless ?? false }),
  })
  console.log('[api] importListingsForTour result:', result.stats, 'listings=', result.listings?.length)
  return result
}

/* ─── Routes ─── */

export async function generateRoute(tourId: string): Promise<AgentRoute> {
  const data = await apiFetch<{ route: AgentRoute }>(`/tours/${tourId}/routes/generate`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
  return data.route
}

export async function shareRoute(routeId: string): Promise<{ shareToken: string; shareUrl: string }> {
  return apiFetch(`/routes/${routeId}/share`, { method: 'POST', body: JSON.stringify({}) })
}
