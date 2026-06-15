/**
 * SchedulingProgress — Phase 1 of §8.6 (PRD).
 *
 * Renders the named-step progress UI for a scheduling run. Shows a
 * compact bar by default; expands to show every step's state on click.
 *
 * Three render modes (driven by `run.status` + step_state):
 *  - running:   spinner on current step, ✓ on done, ○ on pending
 *  - completed: all ✓; collapses to a "Done — N scheduled, M attention"
 *               summary line. Auto-hides after a short delay (handled by
 *               the parent — this component is presentational).
 *  - failed:    ✗ on the failed step + a "Retry" button.
 *
 * The component is presentational: it reports clicks via `onRetry`/`onCancel`
 * callbacks but doesn't touch the network itself.
 */

import { useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  X,
} from 'lucide-react'
import type {
  SchedulingRun,
  SchedulingStepDef,
  SchedulingStepStatus,
} from '@/api'

interface Props {
  run: SchedulingRun | null
  steps: SchedulingStepDef[]
  /** Called when user clicks "Retry from failed step". */
  onRetry?: () => void
  /** Whether the parent supports retry (we keep the button disabled until
   *  it does, so retry-failed UI doesn't appear before the API exists). */
  canRetry?: boolean
}

/** Map a step status → cell visual. */
function StepIcon({ status }: { status: SchedulingStepStatus }) {
  if (status === 'done') {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#00a699] text-white">
        <Check className="size-3" strokeWidth={3} />
      </span>
    )
  }
  if (status === 'running') {
    return (
      <span className="flex h-5 w-5 items-center justify-center">
        <Loader2 className="size-4 animate-spin text-[#ff385c]" />
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#ff385c] text-white">
        <X className="size-3" strokeWidth={3} />
      </span>
    )
  }
  // pending
  return (
    <span className="flex h-5 w-5 items-center justify-center rounded-full border border-[#dddddd] bg-white">
      <span className="block size-1.5 rounded-full bg-[#b0b0b0]" />
    </span>
  )
}

export function SchedulingProgress({ run, steps, onRetry, canRetry = true }: Props) {
  const [expanded, setExpanded] = useState(true)
  if (!run) return null

  // Defensive: if backend is older / step_state is missing, fall back to
  // synthesizing an "all pending until done" view from `progress` only.
  const stepState: Record<string, SchedulingStepStatus> =
    run.stepState ?? Object.fromEntries(steps.map((s) => [s.key, run.status === 'completed' ? 'done' : 'pending']))

  const currentStepKey = run.currentStep
  const currentStep = steps.find((s) => s.key === currentStepKey)
  const failedStepKey =
    run.status === 'failed'
      ? steps.find((s) => stepState[s.key] === 'failed')?.key ?? currentStepKey
      : undefined
  const failedStepLabel = steps.find((s) => s.key === failedStepKey)?.label

  // Header text
  let headline = 'Butler 正在排期…'
  let sub = '正在启动任务…'
  if (run.status === 'completed') {
    headline = '排期完成'
    const r = run.result
    sub = r
      ? `${r.scheduledCount} 个已安排 · ${r.attentionCount} 个需处理`
      : '所有步骤已完成。'
  } else if (run.status === 'failed') {
    headline = '排期已停止'
    sub = failedStepLabel
      ? `未能完成“${failedStepLabel}”。`
      : '出现异常。'
  } else if (currentStep) {
    sub = `${currentStep.label}…`
  }

  const progress = Math.max(0, Math.min(100, run.progress || 0))

  return (
    <div
      className={`w-full rounded-2xl border bg-white shadow-[0_2px_12px_rgba(0,0,0,0.04)] transition-colors ${
        run.status === 'failed'
          ? 'border-[#ffd5de] bg-[#fff5f7]'
          : run.status === 'completed'
          ? 'border-[#d7f4df] bg-[#f3fbf5]'
          : 'border-[#ebebeb]'
      }`}
    >
      {/* Header — always visible */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="flex-none">
          {run.status === 'failed' ? (
            <AlertTriangle className="size-5 text-[#ff385c]" />
          ) : run.status === 'completed' ? (
            <Check className="size-5 text-[#00a699]" strokeWidth={2.5} />
          ) : (
            <Loader2 className="size-5 animate-spin text-[#ff385c]" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-[#222222]">
            {headline}
            {run.status === 'running' && (
              <span className="ml-2 text-xs font-normal text-[#717171]">{progress}%</span>
            )}
          </span>
          <span className="block truncate text-xs text-[#717171]">{sub}</span>
        </span>
        <span className="flex-none text-[#717171]">
          {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        </span>
      </button>

      {/* Progress bar — visible when running, hidden when done/failed */}
      {run.status === 'running' && (
        <div className="px-4 pb-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#ebebeb]">
            <div
              className="h-full rounded-full bg-[#ff385c] transition-[width] duration-300 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {/* Expanded step list */}
      {expanded && (
        <div className="border-t border-[#ebebeb] px-4 py-3">
          <ul className="flex flex-col gap-2.5">
            {steps.map((s) => {
              const status = stepState[s.key] ?? 'pending'
              const isCurrent = s.key === currentStepKey && run.status === 'running'
              return (
                <li key={s.key} className="flex items-center gap-3">
                  <StepIcon status={status} />
                  <span
                    className={`text-sm ${
                      status === 'done'
                        ? 'text-[#717171]'
                        : status === 'failed'
                        ? 'font-semibold text-[#ff385c]'
                        : isCurrent
                        ? 'font-semibold text-[#222222]'
                        : 'text-[#717171]'
                    }`}
                  >
                    {s.label}
                  </span>
                </li>
              )
            })}
          </ul>

          {run.status === 'failed' && canRetry && onRetry && (
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex cursor-pointer items-center gap-2 rounded-[6px] bg-[#222222] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#000000]"
              >
                从失败步骤重试
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
