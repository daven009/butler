/**
 * SchedulingChat — Phase 2B chat-with-Butler UI (PRD §8.6.3).
 *
 * Lives in the right-side dock when scheduling has finished. Two-pane:
 *   - Conversation (left): message stream + input bar
 *   - Schedule artifact (right): not in this file — kept in PlanWorkspace
 *     so it stays in sync with the listing list.
 *
 * Tool messages from the backend are rendered as **proposal cards** when
 * the result has a proposal shape; otherwise as small "Butler checked X"
 * gray pills (we don't dump raw tool JSON at the user).
 *
 * Apply/Discard:
 *   - Apply  → POST /scheduling-proposals/:id/apply, then refresh listings
 *              (parent passes `onProposalApplied` so the schedule artifact
 *              + listing dots can update without a full reload).
 *   - Discard → POST /scheduling-proposals/:id/discard, fades the card.
 *
 * State is kept local to the component; the parent only owns the active
 * session id and refreshes listings when notified.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Send, Loader2, Check, X } from 'lucide-react'
import * as api from '@/api'
import type { SellerTimeWindow } from '@/domain'

interface Props {
  sessionId: string
  focusedListingId?: string
  focusedListingName?: string
  focusedListingAvailability?: SellerTimeWindow[]
  /** Called after a successful Apply — parent refreshes listings + schedule. */
  onProposalApplied?: () => void
  /** Optional: called when session boots so parent can show "Butler is here" feedback. */
  onSessionReady?: (session: api.SchedulingSession) => void
}

interface ProposalCardEntry {
  proposal: api.ScheduleChangeProposal
  /** Local optimistic state so the card disappears immediately on click. */
  pendingAction?: 'apply' | 'discard'
  errorMsg?: string
}

/**
 * Try to parse a proposal-producing tool result. Returns null for read
 * tools and failed brief/proposal calls.
 */
function tryExtractProposal(msg: api.SessionMessage): api.ScheduleChangeProposal | null {
  if (msg.role !== 'tool') return null
  if (
    !msg.toolName?.startsWith('propose_') &&
    msg.toolName !== 'submit_listing_brief'
  ) return null
  const r = msg.toolResult as { id?: string; changes?: unknown } | undefined
  if (!r || typeof r !== 'object') return null
  // Proposals serialize with all the fields; we accept anything with an id
  // + changes array (defensive — schedulingTools.ts already returns
  // ScheduleChangeProposal directly).
  if (typeof r.id !== 'string' || !Array.isArray((r as { changes?: unknown[] }).changes)) {
    return null
  }
  return r as unknown as api.ScheduleChangeProposal
}

/** Pretty-print a proposal change for the diff card. */
function fmtChange(c: api.ProposalChange): string {
  const label = c.listingLabel || c.listingId.slice(0, 8)
  if (c.action === 'drop') return `${label}: Remove from tour`
  if (c.action === 'reschedule' || c.action === 'add') {
    if (c.from && c.to) return `${label}: ${c.from}  →  ${c.to}`
    if (c.to) return `${label}: Schedule at ${c.to}`
    if (c.from) return `${label}: Remove ${c.from}`
  }
  return `${label}: ${c.action}`
}

function formatToolError(error: string): string {
  const preservePrefix =
    'The requested constraints cannot preserve all confirmed listings: '
  if (error.startsWith(preservePrefix)) {
    const listings = error.slice(preservePrefix.length)
    return `当前要求会影响已确认的房源 ${listings}，因此没有生成变更方案。请调整时间限制，或明确允许移动该房源。`
  }
  return error
}

export function SchedulingChat({
  sessionId,
  focusedListingId,
  focusedListingName,
  focusedListingAvailability,
  onProposalApplied,
  onSessionReady,
}: Props) {
  const [messages, setMessages] = useState<api.SessionMessage[]>([])
  const [proposalsById, setProposalsById] = useState<Record<string, ProposalCardEntry>>({})
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const availabilityLabel = formatSellerAvailability(focusedListingAvailability)

  // ── Initial fetch — get session + history ──
  useEffect(() => {
    let cancelled = false
    setMessages([])
    setProposalsById({})
    setError(null)
    api
      .fetchSessionMessages(sessionId)
      .then(({ session, messages: msgs }) => {
        if (cancelled) return
        setMessages(msgs)
        onSessionReady?.(session)
      })
      .catch((e) => {
        if (!cancelled) setError(`Couldn't load conversation: ${(e as Error).message}`)
      })
    api
      .fetchSessionProposals(sessionId)
      .then((ps) => {
        if (cancelled) return
        const map: Record<string, ProposalCardEntry> = {}
        for (const p of ps) map[p.id] = { proposal: p }
        setProposalsById(map)
      })
      .catch(() => {/* non-fatal */})
    return () => {
      cancelled = true
    }
  }, [sessionId, onSessionReady])

  // ── Auto-scroll to bottom on new message ──
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages.length, sending])

  // ── Fold tool messages from history into proposalsById ──
  // (Catches cases where a past turn proposed something that hasn't been
  // resolved yet, since fetchSessionProposals + history are independent.)
  useEffect(() => {
    setProposalsById((prev) => {
      const next = { ...prev }
      for (const m of messages) {
        const p = tryExtractProposal(m)
        if (p && !next[p.id]) next[p.id] = { proposal: p }
      }
      return next
    })
  }, [messages])

  const handleSend = async () => {
    const text = draft.trim()
    if (!text || sending) return
    setSending(true)
    setError(null)
    setDraft('')
    // Optimistic local user bubble (will be replaced when backend returns
    // the canonical history).
    const optimistic: api.SessionMessage = {
      id: `tmp-${Date.now()}`,
      sessionId,
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimistic])
    try {
      const { messages: fresh } = await api.sendSchedulingMessage(
        sessionId,
        text,
        { listingId: focusedListingId },
      )
      setMessages(fresh)
    } catch (e) {
      setError((e as Error).message)
      // Roll back the optimistic user bubble
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
      setDraft(text)
    } finally {
      setSending(false)
    }
  }

  const handleApply = async (proposalId: string) => {
    setProposalsById((prev) => ({
      ...prev,
      [proposalId]: { ...prev[proposalId], pendingAction: 'apply' },
    }))
    try {
      await api.applyProposal(proposalId)
      setProposalsById((prev) => ({
        ...prev,
        [proposalId]: {
          ...prev[proposalId],
          pendingAction: undefined,
          proposal: { ...prev[proposalId].proposal, appliedAt: new Date().toISOString() },
        },
      }))
      onProposalApplied?.()
    } catch (e) {
      setProposalsById((prev) => ({
        ...prev,
        [proposalId]: {
          ...prev[proposalId],
          pendingAction: undefined,
          errorMsg: (e as Error).message,
        },
      }))
    }
  }

  const handleDiscard = async (proposalId: string) => {
    setProposalsById((prev) => ({
      ...prev,
      [proposalId]: { ...prev[proposalId], pendingAction: 'discard' },
    }))
    try {
      await api.discardProposal(proposalId)
      setProposalsById((prev) => ({
        ...prev,
        [proposalId]: {
          ...prev[proposalId],
          pendingAction: undefined,
          proposal: { ...prev[proposalId].proposal, discardedAt: new Date().toISOString() },
        },
      }))
    } catch (e) {
      setProposalsById((prev) => ({
        ...prev,
        [proposalId]: {
          ...prev[proposalId],
          pendingAction: undefined,
          errorMsg: (e as Error).message,
        },
      }))
    }
  }

  // ── Render ──
  // We collapse the message stream so non-content messages (assistant
  // turns that *only* issued tool_calls, tool messages without proposals)
  // become small inline indicators rather than full bubbles. Proposal
  // tool messages render as cards, in-line where they appeared.

  type RenderItem =
    | { kind: 'user'; key: string; text: string }
    | { kind: 'assistant'; key: string; text: string }
    | { kind: 'tool-trace'; key: string; toolName: string; error?: string }
    | { kind: 'proposal-card'; key: string; proposalId: string }

  const renderItems: RenderItem[] = useMemo(() => {
    const out: RenderItem[] = []
    const proposalErrorsInTurn = new Set<string>()
    let proposalFailedInTurn = false
    for (const m of messages) {
      if (m.role === 'user' && m.content) {
        proposalErrorsInTurn.clear()
        proposalFailedInTurn = false
        out.push({ kind: 'user', key: m.id, text: m.content })
      } else if (m.role === 'assistant' && m.content) {
        out.push({ kind: 'assistant', key: m.id, text: m.content })
      } else if (m.role === 'tool') {
        const skipped =
          m.toolResult &&
          typeof m.toolResult === 'object' &&
          'skipped' in m.toolResult &&
          m.toolResult.skipped === true
        if (skipped) continue
        const p = tryExtractProposal(m)
        if (p) {
          // A failed proposal ends this user turn. Older sessions may still
          // contain a contradictory fallback proposal generated afterwards.
          if (!proposalFailedInTurn) {
            out.push({ kind: 'proposal-card', key: m.id, proposalId: p.id })
          }
        } else if (m.toolName) {
          // Read tools — show a tiny "Butler checked X" trace pill.
          const toolError =
            m.toolResult &&
            typeof m.toolResult === 'object' &&
            'error' in m.toolResult &&
            typeof m.toolResult.error === 'string'
              ? m.toolResult.error
              : undefined
          if (
            toolError &&
            (m.toolName.startsWith('propose_') || m.toolName === 'submit_listing_brief')
          ) {
            proposalFailedInTurn = true
            const errorKey = `${m.toolName}:${toolError}`
            if (proposalErrorsInTurn.has(errorKey)) continue
            proposalErrorsInTurn.add(errorKey)
          }
          out.push({ kind: 'tool-trace', key: m.id, toolName: m.toolName, error: toolError })
        }
      }
      // assistant turns with only tool_calls (no content) → silently skipped;
      // the user sees the resulting tool trace + the next assistant
      // content message.
    }
    return out
  }, [messages])

  return (
    <div className="flex h-full min-h-0 flex-col bg-white">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[#ebebeb] px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#fff0f3]">
          <Bot className="size-4 text-[#ff385c]" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[#222222]">Butler</div>
          <div className="text-xs text-[#717171]">
            {focusedListingName
              ? `正在调整 ${focusedListingName} 和整条线路`
              : 'Ask me to refine this schedule.'}
          </div>
          {focusedListingName && (
            <div className="mt-1 text-xs font-medium text-[#555555]">
              卖家中介可用时间：{availabilityLabel}
            </div>
          )}
        </div>
      </div>

      {/* Message stream */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3">
        {!messages.length && !error && (
          <div className="mx-auto max-w-sm pt-4 text-center text-xs text-[#717171]">
            Try: <span className="font-medium text-[#222222]">
              {focusedListingName
                ? `"这套尽量安排在上午，不要影响已经确认的房源"`
                : '"Why isn\'t Newton Suites scheduled?"'}
            </span>
            <br />
            Or: <span className="font-medium text-[#222222]">"Move Scotts Square to 11am"</span>
          </div>
        )}

        <ul className="flex flex-col gap-2.5">
          {renderItems.map((it) => {
            if (it.kind === 'user') {
              return (
                <li key={it.key} className="flex justify-end">
                  <div className="max-w-[85%] rounded-[6px] rounded-br-md bg-[#222222] px-3.5 py-2 text-sm text-white">
                    {it.text}
                  </div>
                </li>
              )
            }
            if (it.kind === 'assistant') {
              return (
                <li key={it.key} className="flex justify-start">
                  <div className="max-w-[85%] whitespace-pre-wrap rounded-[6px] rounded-bl-md border border-[#ebebeb] bg-white px-3.5 py-2 text-sm text-[#222222]">
                    {it.text}
                  </div>
                </li>
              )
            }
            if (it.kind === 'tool-trace') {
              return (
                <li key={it.key} className="flex flex-col items-center gap-1">
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-wide ${
                    it.error ? 'bg-[#fff5f7] text-[#c13515]' : 'bg-[#f7f7f7] text-[#717171]'
                  }`}>
                    {it.error ? 'Butler could not apply' : 'Butler checked'} · {it.toolName.replace(/^get_/, '').replace(/_/g, ' ')}
                  </span>
                  {it.error && (
                    <span className="max-w-[85%] rounded-[6px] border border-[#ffd5de] bg-[#fff5f7] px-3 py-2 text-xs leading-5 text-[#c13515]">
                      {formatToolError(it.error)}
                    </span>
                  )}
                </li>
              )
            }
            // proposal card
            const entry = proposalsById[it.proposalId]
            if (!entry) return null
            return (
              <li key={it.key} className="flex justify-start">
                <ProposalCard
                  entry={entry}
                  onApply={() => handleApply(it.proposalId)}
                  onDiscard={() => handleDiscard(it.proposalId)}
                />
              </li>
            )
          })}

          {sending && (
            <li className="flex items-center gap-2 px-1 text-xs text-[#717171]">
              <Loader2 className="size-3 animate-spin" /> Butler is thinking…
            </li>
          )}
          {error && (
            <li className="rounded-[6px] border border-[#ffd5de] bg-[#fff5f7] px-3 py-2 text-xs text-[#c13515]">
              {error}
            </li>
          )}
        </ul>
      </div>

      {/* Input */}
      <div className="border-t border-[#ebebeb] p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void handleSend()
              }
            }}
            placeholder={
              focusedListingName
                ? `告诉 Butler 如何安排 ${focusedListingName}…`
                : 'Ask Butler to adjust the schedule…'
            }
            rows={1}
            className="min-h-[40px] flex-1 resize-none rounded-[6px] border border-[#dddddd] bg-white px-3 py-2 text-sm text-[#222222] outline-none focus:border-[#222222]"
          />
          <button
            type="button"
            disabled={sending || !draft.trim()}
            onClick={() => void handleSend()}
            className={`flex h-10 w-10 flex-none items-center justify-center rounded-[6px] text-white transition-colors ${
              sending || !draft.trim() ? 'cursor-not-allowed bg-[#dddddd]' : 'bg-[#ff385c] hover:bg-[#e00b41]'
            }`}
          >
            <Send className="size-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

function formatSellerAvailability(windows?: SellerTimeWindow[]): string {
  if (!windows?.length) return '尚未提供'
  return windows
    .map((window) => {
      const date = new Date(`${window.date}T00:00:00`)
      const dateLabel = Number.isNaN(date.getTime())
        ? window.date
        : date.toLocaleDateString('zh-SG', {
            month: 'numeric',
            day: 'numeric',
            weekday: 'short',
          })
      return `${dateLabel} ${window.startTime}–${window.endTime}`
    })
    .join('；')
}

// ─── Proposal card ──────────────────────────────────────────────────────

function ProposalCard({
  entry,
  onApply,
  onDiscard,
}: {
  entry: ProposalCardEntry
  onApply: () => void
  onDiscard: () => void
}) {
  const { proposal, pendingAction, errorMsg } = entry
  const applied = !!proposal.appliedAt
  const discarded = !!proposal.discardedAt
  const settled = applied || discarded
  const isFull = proposal.mode === 'full'
  const proposedChanges = [...proposal.changes, ...proposal.cascade]
  const hasCompleteDestinations = proposedChanges.every(
    (change) => change.action === 'drop' || Boolean(change.to),
  )
  const hasTimeConflict = proposalHasTimeConflict(proposedChanges)
  const canApply = hasCompleteDestinations && !hasTimeConflict

  return (
    <div
      className={`max-w-[90%] rounded-[6px] border p-3 text-sm ${
        applied
          ? 'border-[#d7f4df] bg-[#f3fbf5]'
          : discarded
          ? 'border-[#ebebeb] bg-[#f7f7f7] text-[#9ca3af] line-through'
          : isFull
          ? 'border-[#fde68a] bg-[#fef3c7]'
          : 'border-[#d8efff] bg-[#f1f9ff]'
      }`}
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-[#717171]">
        {applied ? 'Applied' : discarded ? 'Discarded' : isFull ? 'Full tour proposal' : 'Proposed change'}
      </div>
      {proposal.intentSummary && (
        <div className="mt-1 text-[#222222]">{proposal.intentSummary}</div>
      )}
      {proposal.changes.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 font-mono text-xs text-[#222222]">
          {proposal.changes.map((c, i) => (
            <li key={i} className="rounded-[6px] bg-white/60 px-2 py-1">
              {fmtChange(c)}
            </li>
          ))}
        </ul>
      )}
      {proposal.cascade.length > 0 && (
        <>
          <div className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-[#9a3412]">
            Also affects
          </div>
          <ul className="mt-1 flex flex-col gap-1 font-mono text-xs text-[#9a3412]">
            {proposal.cascade.map((c, i) => (
              <li key={i} className="rounded-[6px] bg-white/60 px-2 py-1">
                {fmtChange(c)}
              </li>
            ))}
          </ul>
        </>
      )}
      {errorMsg && !settled && (
        <div className="mt-2 text-xs text-[#c13515]">{errorMsg}</div>
      )}
      {!settled && !canApply && (
        <div className="mt-2 text-xs text-[#9a3412]">
          {hasTimeConflict
            ? 'This proposal contains overlapping viewing times and cannot be applied.'
            : 'This conflict needs an exact-time re-plan before it can be applied.'}
        </div>
      )}
      {!settled && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={!!pendingAction || !canApply}
            onClick={onApply}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-[6px] bg-[#222222] px-3 py-1.5 text-xs font-semibold text-white ${
              pendingAction || !canApply ? 'opacity-60' : 'hover:bg-[#000000]'
            }`}
          >
            {pendingAction === 'apply' ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
            Apply
          </button>
          <button
            type="button"
            disabled={!!pendingAction}
            onClick={onDiscard}
            className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-[6px] border border-[#dddddd] px-3 py-1.5 text-xs font-semibold text-[#222222] ${
              pendingAction ? 'opacity-60' : 'hover:bg-[#f7f7f7]'
            }`}
          >
            {pendingAction === 'discard' ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
            Discard
          </button>
        </div>
      )}
      {!settled && isFull && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={!!pendingAction}
            onClick={onDiscard}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[6px] border border-[#dddddd] bg-white px-3 py-1.5 text-xs font-semibold text-[#222222] hover:bg-[#f7f7f7]"
          >
            <X className="size-3" /> Dismiss
          </button>
        </div>
      )}
    </div>
  )
}

function proposalHasTimeConflict(changes: api.ProposalChange[]): boolean {
  const slots = changes
    .filter((change) => change.action === 'reschedule' || change.action === 'add')
    .map((change) => {
      const match = change.to?.match(/(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/)
      if (!match) return null
      return {
        date: change.to?.match(/^(\d{4}-\d{2}-\d{2})\s+/)?.[1],
        start: Number(match[1]) * 60 + Number(match[2]),
        end: Number(match[3]) * 60 + Number(match[4]),
      }
    })
    .filter((slot): slot is { date: string | undefined; start: number; end: number } => Boolean(slot))
    .sort((a, b) =>
      `${a.date || ""} ${a.start}`.localeCompare(`${b.date || ""} ${b.start}`),
    )

  return slots.some((slot, index) =>
    index > 0 &&
    (!slot.date || !slots[index - 1].date || slot.date === slots[index - 1].date) &&
    slot.start < slots[index - 1].end,
  )
}
