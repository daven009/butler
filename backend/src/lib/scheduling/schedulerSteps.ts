/**
 * Scheduler step framework — Phase 1 of §8.6.
 *
 * Wraps the existing `planSchedule()` engine into 6 named, resumable steps
 * so the frontend can render a progress bar with natural-language labels
 * ("Locating properties on the map…") instead of an opaque spinner.
 *
 * Why this lives in its own file (and not inline in plansRepository):
 *   - The 6 steps are individually unit-testable (no Supabase mock needed
 *     once you stub the IO ports).
 *   - A failed step needs to be retryable WITHOUT redoing the steps that
 *     already finished — the artifact map below is what makes that possible.
 *   - The step registry is the single source of truth for both backend
 *     execution AND the frontend progress UI labels (we expose
 *     STEP_DEFS via the API so the UI never gets out of sync).
 *
 * Decision recap (PRD §8.6, locked 2026-06-03):
 *   - 6 steps, in fixed order
 *   - Labels are natural-language English (no "geocode" jargon)
 *   - On step failure: status='failed', that step → 'failed', subsequent
 *     steps stay 'pending'. Resume picks up at the first non-'done' step.
 *   - Intermediate per-step output stored in scheduling_runs.step_artifacts
 *     (jsonb). Never returned to the frontend.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type ScheduleRequest,
  type ScheduleResponse,
  planSchedule,
} from './planSchedule';
import {
  type ListingGeo,
  type TravelEstimate,
  buildTravelMatrix,
  clusterListings,
  geocodeListings,
} from './geoUtils';

// ─── Step registry ───────────────────────────────────────────────────────

export type StepKey =
  | 'gather'
  | 'geocode'
  | 'cluster'
  | 'travel'
  | 'optimize'
  | 'persist';

export type StepStatus = 'pending' | 'running' | 'done' | 'failed';

/**
 * Ordered step definitions. The frontend reads `label` for the progress UI.
 *
 * KEEP labels in plain English — they're rendered verbatim. PRD decision:
 * no jargon ("Locating properties on the map" not "Geocoding listings").
 */
export const STEP_DEFS: ReadonlyArray<{ key: StepKey; label: string }> = [
  { key: 'gather',   label: 'Gathering listings & availability' },
  { key: 'geocode',  label: 'Locating properties on the map' },
  { key: 'cluster',  label: 'Clustering nearby listings' },
  { key: 'travel',   label: 'Computing travel times' },
  { key: 'optimize', label: 'Optimizing schedule' },
  { key: 'persist',  label: 'Saving results' },
] as const;

export const STEP_KEYS: readonly StepKey[] = STEP_DEFS.map((s) => s.key);

/** Empty state: every step starts pending. */
export function blankStepState(): Record<StepKey, StepStatus> {
  return Object.fromEntries(STEP_KEYS.map((k) => [k, 'pending'])) as Record<
    StepKey,
    StepStatus
  >;
}

/**
 * Compute progress (0..100) from step_state. We weight every step equally
 * (six steps → 16.67% each, rounded down). Frontend shows the integer.
 */
export function progressFromState(state: Record<StepKey, StepStatus>): number {
  const total = STEP_KEYS.length;
  const done = STEP_KEYS.filter((k) => state[k] === 'done').length;
  return Math.floor((done / total) * 100);
}

/**
 * Find which step to start from on resume. Returns null when every step is
 * already 'done' (nothing to do — caller should treat as already completed).
 */
export function nextStepToRun(
  state: Record<StepKey, StepStatus>,
): StepKey | null {
  for (const k of STEP_KEYS) {
    if (state[k] !== 'done') return k;
  }
  return null;
}

// ─── Per-step IO contracts ──────────────────────────────────────────────

/**
 * The artifact map carries intermediate results between steps. Each step
 * writes its output here; the next step reads its input from here. Stored
 * in `scheduling_runs.step_artifacts` (jsonb) so a retry can pick up where
 * a previous run left off without re-doing expensive work (e.g. OneMap
 * travel matrix calls cost real time/quota).
 */
export interface StepArtifacts {
  gather?: {
    reachableIds: string[];
    blockedIds: string[];
    buyerSlots: Array<{ date: string; startTime: string; endTime: string }>;
    useOneMap: boolean;
    /** Snapshot of the request body about to be passed downstream. */
    scheduleRequest: ScheduleRequest;
  };
  geocode?: {
    geoListings: ListingGeo[];
  };
  cluster?: {
    geoListings: ListingGeo[]; // post-cluster (with cluster id assigned)
  };
  travel?: {
    /** Map<"a→b", TravelEstimate> serialised as plain object. */
    travelMatrix: Record<string, TravelEstimate>;
  };
  optimize?: {
    schedule: ScheduleResponse['schedule'];
    unschedulable: ScheduleResponse['unschedulable'];
  };
  // 'persist' has no artifacts — it writes back into listings/attention_items.
}

// ─── Logging helper ─────────────────────────────────────────────────────

export interface StepLogEntry {
  ts: string;
  step: StepKey;
  level: 'info' | 'warn' | 'error';
  msg: string;
}

export function logEntry(
  step: StepKey,
  level: StepLogEntry['level'],
  msg: string,
): StepLogEntry {
  return { ts: new Date().toISOString(), step, level, msg };
}

// ─── Step persistence helper ────────────────────────────────────────────

/**
 * Read+merge+write the run row atomically-ish. Supabase doesn't expose a
 * true CAS, but every step is its own UPDATE that only touches a small set
 * of fields, and steps don't run concurrently for the same run, so this
 * is fine in practice.
 */
export async function patchRun(
  c: SupabaseClient,
  runId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await c
    .from('scheduling_runs')
    .update(patch)
    .eq('id', runId);
  if (error) throw error;
}

/**
 * Mark a step as `running` (and record currentStep) before calling its body.
 */
export async function markStepRunning(
  c: SupabaseClient,
  runId: string,
  prevState: Record<StepKey, StepStatus>,
  step: StepKey,
): Promise<Record<StepKey, StepStatus>> {
  const next = { ...prevState, [step]: 'running' as const };
  await patchRun(c, runId, {
    current_step: step,
    step_state: next,
    progress: progressFromState(next),
  });
  return next;
}

export async function markStepDone(
  c: SupabaseClient,
  runId: string,
  prevState: Record<StepKey, StepStatus>,
  step: StepKey,
  artifactsPatch: Partial<StepArtifacts>,
  prevArtifacts: StepArtifacts,
): Promise<{ state: Record<StepKey, StepStatus>; artifacts: StepArtifacts }> {
  const nextState = { ...prevState, [step]: 'done' as const };
  const nextArtifacts = { ...prevArtifacts, ...artifactsPatch };
  await patchRun(c, runId, {
    current_step: step,
    step_state: nextState,
    step_artifacts: nextArtifacts,
    progress: progressFromState(nextState),
  });
  return { state: nextState, artifacts: nextArtifacts };
}

export async function markStepFailed(
  c: SupabaseClient,
  runId: string,
  prevState: Record<StepKey, StepStatus>,
  prevLog: StepLogEntry[],
  step: StepKey,
  err: unknown,
): Promise<void> {
  const errMsg = err instanceof Error ? err.message : String(err);
  const nextState = { ...prevState, [step]: 'failed' as const };
  const nextLog = [...prevLog, logEntry(step, 'error', errMsg)];
  await patchRun(c, runId, {
    status: 'failed',
    current_step: step,
    step_state: nextState,
    step_log: nextLog,
    completed_at: new Date().toISOString(),
  });
}

// ─── Re-export the step body functions ──────────────────────────────────
// (Step bodies live in plansRepository.ts because they need access to
// listings/attention_items repository functions; keeping them there avoids
// a circular import. The framework above is the reusable bit.)
//
// Each step body takes:
//   (artifacts: StepArtifacts, ctx: { tourId, userId, runId })
// and returns:
//   Promise<Partial<StepArtifacts>>
//
// On throw → the orchestrator marks the step failed and stops.

export { buildTravelMatrix, clusterListings, geocodeListings, planSchedule };
