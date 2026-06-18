/**
 * Plans Repository — Supabase-backed.
 *
 * Source of truth: PostgreSQL via Supabase. All reads/writes go through a
 * per-request client whose JWT is the user's; Postgres RLS enforces
 * per-user isolation.
 *
 * The PG → business Listing mapper (`pgToBusinessListing`) and PG rawText
 * parsers stay pure functions at the bottom of this file — they don't touch
 * the database.
 */

import { getCurrentUserId, getCurrentJwt, runWithUser } from '../userContext';
import { supabaseForUser, supabaseAdmin } from '../supabase';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  extractPrimaryPgListingText,
  normalizePgEvidenceText,
  textContainsCandidate,
} from '../propertyGuruText';

/* ─── Domain Types (matching frontend domain.ts) ─── */

export type ListingStatus =
  | 'imported'
  | 'contacting'
  | 'confirmed'
  | 'needs-attention'
  | 'not-fitting';

export type MessageSender = 'ai' | 'agent' | 'co-agent' | 'system';

export interface ViewingPlan {
  id: string;
  title: string;
  clientName: string;
  clientWhatsapp?: string;
  brief: string;
}

export interface ViewingTour {
  id: string;
  planId: string;
  title: string;
  targetDate: string;
  timeWindow: string;
  command: string;
}

export interface CoAgent {
  name: string;
  phone: string;
  agency: string;
}

export interface Listing {
  id: string;
  title: string;
  address: string;
  area: string;
  condo: string;
  price: string;
  beds: number;
  baths: number;
  sqft: number;
  psf: string;
  imageUrl: string;
  status: ListingStatus;
  statusLabel: string;
  suggestedTime?: string;
  unitNo: string;
  coAgent: CoAgent;
  googleMapsUrl: string;
  propertyGuruUrl: string;
  summary: string;
  attentionReason?: string;
  /** Mock co-agent availability (filled by /conversations/seed). */
  availability?: SellerTimeWindow[];
  /** Geocoded coordinates. */
  lat?: number;
  lng?: number;
  /** Co-agent reachability. */
  agentReachable?: boolean;
}

export interface SellerTimeWindow {
  date: string;
  startTime: string;
  endTime: string;
}

export interface ConversationMessage {
  id: string;
  listingId: string;
  sender: MessageSender;
  senderName: string;
  body: string;
  timestamp: string;
}

export interface RouteStop {
  id: string;
  listingId: string;
  time: string;
  title: string;
  address: string;
  area: string;
  condo: string;
  unitNo: string;
  coAgentName: string;
  coAgentPhone: string;
  googleMapsUrl: string;
  notes: string;
}

export interface ClientRouteStop {
  id: string;
  time: string;
  title: string;
  address: string;
  area: string;
  condo: string;
  googleMapsUrl: string;
}

export interface AgentRoute {
  id: string;
  planId: string;
  tourId: string;
  title: string;
  date: string;
  stops: RouteStop[];
}

export interface ClientRoute {
  shareToken: string;
  title: string;
  date: string;
  stops: ClientRouteStop[];
  privacyNotice: string;
}

export interface SchedulingRun {
  id: string;
  tourId: string;
  status: 'running' | 'completed' | 'failed';
  progress: number;
  startedAt: string;
  completedAt?: string;
  result?: {
    scheduledCount: number;
    attentionCount: number;
  };
  // Phase 1 (2026-06-03) — per-step UX. See schedulerSteps.ts for canonical
  // step list. `currentStep` is the step name the orchestrator was last
  // working on (whether it's now done, running, or failed). `stepState`
  // gives the frontend the full per-step status map so the progress UI can
  // render checkmarks / spinners / red X marks per row.
  currentStep?: string;
  stepState?: Record<string, 'pending' | 'running' | 'done' | 'failed'>;
}

export interface AttentionItem {
  id: string;
  tourId: string;
  listingId: string;
  reason: string;
  resolved: boolean;
  resolution?: string;
}

/* ─── Internal helpers ───────────────────────────────────────────────────── */

function db(): SupabaseClient {
  // Per-request, RLS-aware Supabase client. Caller must be inside runWithUser.
  return supabaseForUser(getCurrentJwt());
}

const BUYER_LISTING_KEY = '__buyer__';

const mapsUrl = (address: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

/* ─── Row → Domain mappers ───────────────────────────────────────────────── */

interface PlanRow {
  id: string;
  user_id: string;
  title: string;
  client_name: string;
  client_whatsapp: string | null;
  brief: string;
}

interface TourRow {
  id: string;
  plan_id: string;
  user_id: string;
  title: string;
  target_date: string;
  time_window: string;
  command: string;
}

interface ListingRow {
  id: string;
  tour_id: string;
  user_id: string;
  pg_listing_id: string | null;
  title: string;
  address: string;
  area: string;
  condo: string;
  price: string;
  beds: number;
  baths: number;
  sqft: number;
  psf: string;
  image_url: string;
  status: ListingStatus;
  status_label: string;
  suggested_time: string | null;
  unit_no: string;
  co_agent_name: string;
  co_agent_phone: string;
  co_agent_agency: string;
  google_maps_url: string;
  property_guru_url: string;
  summary: string;
  attention_reason: string | null;
  availability: SellerTimeWindow[] | null;
  lat: number | null;
  lng: number | null;
  agent_reachable: boolean | null;
}

interface ConversationRow {
  id: string;
  tour_id: string;
  user_id: string;
  listing_key: string;
  sender: MessageSender;
  sender_name: string;
  body: string;
  ts_label: string;
}

interface RouteRow {
  id: string;
  tour_id: string;
  user_id: string;
  title: string;
  date: string;
  stops: RouteStop[];
}

interface SchedulingRunRow {
  id: string;
  tour_id: string;
  user_id: string;
  status: 'running' | 'completed' | 'failed';
  progress: number;
  scheduled_count: number;
  attention_count: number;
  started_at: string;
  completed_at: string | null;
  // Phase 1 (2026-06-03) — see schedulerSteps.ts
  current_step: string | null;
  step_state: Record<string, string> | null;
  step_log: unknown[] | null;
  step_artifacts: Record<string, unknown> | null;
}

interface AttentionItemRow {
  id: string;
  tour_id: string;
  user_id: string;
  listing_id: string | null;
  reason: string;
  resolved: boolean;
  resolution: string | null;
}

function rowToPlan(r: PlanRow): ViewingPlan {
  return {
    id: r.id,
    title: r.title,
    clientName: r.client_name,
    clientWhatsapp: r.client_whatsapp ?? undefined,
    brief: r.brief,
  };
}

function rowToTour(r: TourRow): ViewingTour {
  return {
    id: r.id,
    planId: r.plan_id,
    title: r.title,
    targetDate: r.target_date,
    timeWindow: r.time_window,
    command: r.command,
  };
}

function rowToListing(r: ListingRow): Listing {
  return {
    id: r.id,
    title: r.title,
    address: r.address,
    area: r.area,
    condo: r.condo,
    price: r.price,
    beds: r.beds,
    baths: r.baths,
    sqft: r.sqft,
    psf: r.psf,
    imageUrl: r.image_url,
    status: r.status,
    statusLabel: r.status_label,
    suggestedTime: r.suggested_time ?? undefined,
    unitNo: r.unit_no,
    coAgent: { name: r.co_agent_name, phone: r.co_agent_phone, agency: r.co_agent_agency },
    googleMapsUrl: r.google_maps_url,
    propertyGuruUrl: r.property_guru_url,
    summary: r.summary,
    attentionReason: r.attention_reason ?? undefined,
    availability: r.availability ?? undefined,
    lat: r.lat ?? undefined,
    lng: r.lng ?? undefined,
    agentReachable: r.agent_reachable ?? undefined,
  };
}

function listingToRow(l: Listing, tourId: string, userId: string): Omit<ListingRow, 'id'> & { id?: string } {
  return {
    id: isUuid(l.id) ? l.id : undefined,
    tour_id: tourId,
    user_id: userId,
    pg_listing_id: extractPgListingId(l.id, l.propertyGuruUrl),
    title: l.title,
    address: l.address,
    area: l.area,
    condo: l.condo,
    price: l.price,
    beds: l.beds,
    baths: l.baths,
    sqft: l.sqft,
    psf: l.psf,
    image_url: l.imageUrl,
    status: l.status,
    status_label: l.statusLabel,
    suggested_time: l.suggestedTime ?? null,
    unit_no: l.unitNo,
    co_agent_name: l.coAgent.name,
    co_agent_phone: l.coAgent.phone,
    co_agent_agency: l.coAgent.agency,
    google_maps_url: l.googleMapsUrl,
    property_guru_url: l.propertyGuruUrl,
    summary: l.summary,
    attention_reason: l.attentionReason ?? null,
    availability: l.availability ?? [],
    lat: l.lat ?? null,
    lng: l.lng ?? null,
    agent_reachable: l.agentReachable ?? null,
  };
}

function rowToConversation(r: ConversationRow): ConversationMessage {
  return {
    id: r.id,
    listingId: r.listing_key,
    sender: r.sender,
    senderName: r.sender_name,
    body: r.body,
    timestamp: r.ts_label,
  };
}

function rowToRoute(r: RouteRow, planId: string): AgentRoute {
  return {
    id: r.id,
    planId,
    tourId: r.tour_id,
    title: r.title,
    date: r.date,
    stops: r.stops || [],
  };
}

function rowToSchedulingRun(r: SchedulingRunRow): SchedulingRun {
  return {
    id: r.id,
    tourId: r.tour_id,
    status: r.status,
    progress: r.progress,
    startedAt: r.started_at,
    completedAt: r.completed_at ?? undefined,
    result:
      r.status === 'completed'
        ? { scheduledCount: r.scheduled_count, attentionCount: r.attention_count }
        : undefined,
    currentStep: r.current_step ?? undefined,
    stepState:
      (r.step_state as Record<
        string,
        'pending' | 'running' | 'done' | 'failed'
      >) ?? undefined,
  };
}

function rowToAttentionItem(r: AttentionItemRow): AttentionItem {
  return {
    id: r.id,
    tourId: r.tour_id,
    listingId: r.listing_id ?? '',
    reason: r.reason,
    resolved: r.resolved,
    resolution: r.resolution ?? undefined,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s: string | undefined | null): boolean {
  return !!s && UUID_RE.test(s);
}

/** Extract the PropertyGuru numeric listingId from a synthetic id like "pg-60244724" or from a URL. */
function extractPgListingId(syntheticId: string, url: string): string | null {
  if (syntheticId?.startsWith('pg-')) return syntheticId.slice(3);
  const m = /-(\d{6,})(?:[/?#]|$)/.exec(url || '');
  return m ? m[1] : null;
}

/* ─── Plans CRUD ─────────────────────────────────────────────────────────── */

export async function listPlans(): Promise<ViewingPlan[]> {
  const { data, error } = await db()
    .from('plans')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as PlanRow[]).map(rowToPlan);
}

export async function getPlanById(planId: string): Promise<ViewingPlan | undefined> {
  if (!isUuid(planId)) return undefined;
  const { data, error } = await db()
    .from('plans')
    .select('*')
    .eq('id', planId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToPlan(data as PlanRow) : undefined;
}

export async function createPlan(input: Omit<ViewingPlan, 'id'>): Promise<ViewingPlan> {
  const userId = getCurrentUserId();
  const { data, error } = await db()
    .from('plans')
    .insert({
      user_id: userId,
      title: input.title,
      client_name: input.clientName,
      client_whatsapp: input.clientWhatsapp ?? null,
      brief: input.brief ?? '',
    })
    .select()
    .single();
  if (error) throw error;
  return rowToPlan(data as PlanRow);
}

export async function updatePlan(planId: string, input: Omit<ViewingPlan, 'id'>): Promise<ViewingPlan | undefined> {
  if (!isUuid(planId)) return undefined;
  const { data, error } = await db()
    .from('plans')
    .update({
      title: input.title,
      client_name: input.clientName,
      client_whatsapp: input.clientWhatsapp ?? null,
      brief: input.brief ?? '',
      updated_at: new Date().toISOString(),
    })
    .eq('id', planId)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data ? rowToPlan(data as PlanRow) : undefined;
}

export async function removePlan(planId: string): Promise<boolean> {
  if (!isUuid(planId)) return false;
  const { data, error } = await db()
    .from('plans')
    .delete()
    .eq('id', planId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/* ─── Tours CRUD ─────────────────────────────────────────────────────────── */

export async function listToursByPlan(planId: string): Promise<ViewingTour[]> {
  if (!isUuid(planId)) return [];
  const { data, error } = await db()
    .from('tours')
    .select('*')
    .eq('plan_id', planId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as TourRow[]).map(rowToTour);
}

export async function getTourDetail(tourId: string): Promise<ViewingTour | undefined> {
  if (!isUuid(tourId)) return undefined;
  const { data, error } = await db()
    .from('tours')
    .select('*')
    .eq('id', tourId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToTour(data as TourRow) : undefined;
}

export async function createTourForPlan(
  planId: string,
  input: Omit<ViewingTour, 'id' | 'planId'>,
): Promise<ViewingTour> {
  const userId = getCurrentUserId();
  const { data, error } = await db()
    .from('tours')
    .insert({
      plan_id: planId,
      user_id: userId,
      title: input.title,
      target_date: input.targetDate,
      time_window: input.timeWindow,
      command: input.command ?? '',
    })
    .select()
    .single();
  if (error) throw error;
  return rowToTour(data as TourRow);
}

export async function updateTour(
  tourId: string,
  input: Omit<ViewingTour, 'id' | 'planId'>,
): Promise<ViewingTour | undefined> {
  if (!isUuid(tourId)) return undefined;
  const { data, error } = await db()
    .from('tours')
    .update({
      title: input.title,
      target_date: input.targetDate,
      time_window: input.timeWindow,
      command: input.command ?? '',
      updated_at: new Date().toISOString(),
    })
    .eq('id', tourId)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data ? rowToTour(data as TourRow) : undefined;
}

export async function removeTour(tourId: string): Promise<boolean> {
  if (!isUuid(tourId)) return false;
  const { error, count } = await db()
    .from('tours')
    .delete({ count: 'exact' })
    .eq('id', tourId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

/* ─── Listings CRUD (under Tour) ─────────────────────────────────────────── */

export async function listListingsByTour(tourId: string): Promise<Listing[]> {
  if (!isUuid(tourId)) return [];
  const { data, error } = await db()
    .from('listings')
    .select('*')
    .eq('tour_id', tourId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as ListingRow[]).map(rowToListing);
}

/**
 * Idempotent upsert of a PG-derived listing into the given tour.
 *
 * Match key: `pg_listing_id` (when the incoming Listing has a "pg-XXXXXX" id).
 * - If a row already exists in this tour with that pg_listing_id → MERGE
 *   (PG-derived fields overwrite, business fields kept).
 * - Else → INSERT a fresh row (Postgres assigns a uuid).
 *
 * Returns the row as it now exists in the DB.
 */
export async function addListingToTourWeb(tourId: string, listing: Listing): Promise<Listing> {
  const userId = getCurrentUserId();
  const pgId = extractPgListingId(listing.id, listing.propertyGuruUrl);

  // Try to find an existing row in this tour with the same pg_listing_id.
  if (pgId) {
    const { data: existing, error: findErr } = await db()
      .from('listings')
      .select('*')
      .eq('tour_id', tourId)
      .eq('pg_listing_id', pgId)
      .maybeSingle();
    if (findErr) throw findErr;

    if (existing) {
      const old = rowToListing(existing as ListingRow);
      const merged: Listing = {
        ...old,
        // PG-derived fields → overwrite from new
        title: listing.title,
        address: listing.address,
        area: listing.area,
        condo: listing.condo,
        price: listing.price,
        beds: listing.beds,
        baths: listing.baths,
        sqft: listing.sqft,
        psf: listing.psf,
        imageUrl: listing.imageUrl || old.imageUrl,
        googleMapsUrl: listing.googleMapsUrl || old.googleMapsUrl,
        propertyGuruUrl: listing.propertyGuruUrl || old.propertyGuruUrl,
        lat: listing.lat != null && listing.lat !== 0 ? listing.lat : old.lat,
        lng: listing.lng != null && listing.lng !== 0 ? listing.lng : old.lng,
        coAgent:
          listing.coAgent && listing.coAgent.name && listing.coAgent.name !== 'Unknown'
            ? listing.coAgent
            : old.coAgent,
        id: old.id, // keep DB uuid
      };

      const { data: updated, error: upErr } = await db()
        .from('listings')
        .update(listingToRow(merged, tourId, userId))
        .eq('id', old.id)
        .select()
        .single();
      if (upErr) throw upErr;
      return rowToListing(updated as ListingRow);
    }
  }

  // No existing row — insert fresh. Don't pass synthetic "pg-XXX" as the id;
  // let Postgres assign a uuid.
  const row = listingToRow(listing, tourId, userId);
  delete row.id;
  const { data, error } = await db().from('listings').insert(row).select().single();
  if (error) throw error;
  return rowToListing(data as ListingRow);
}

export async function updateListingInTour(
  tourId: string,
  listingId: string,
  updates: Omit<Partial<Listing>, 'attentionReason' | 'suggestedTime'> & {
    attentionReason?: string | null;
    suggestedTime?: string | null;
  },
): Promise<Listing | undefined> {
  if (!isUuid(listingId)) return undefined;
  const patch: Record<string, unknown> = {};
  if (updates.title !== undefined) patch.title = updates.title;
  if (updates.status !== undefined) patch.status = updates.status;
  if (updates.statusLabel !== undefined) patch.status_label = updates.statusLabel;
  if (updates.suggestedTime !== undefined) patch.suggested_time = updates.suggestedTime;
  if (updates.attentionReason !== undefined) patch.attention_reason = updates.attentionReason;
  if (updates.availability !== undefined) patch.availability = updates.availability;
  if (updates.agentReachable !== undefined) patch.agent_reachable = updates.agentReachable;
  if (updates.coAgent !== undefined) {
    patch.co_agent_name = updates.coAgent.name;
    patch.co_agent_phone = updates.coAgent.phone;
    patch.co_agent_agency = updates.coAgent.agency;
  }

  const { data, error } = await db()
    .from('listings')
    .update(patch)
    .eq('id', listingId)
    .eq('tour_id', tourId)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data ? rowToListing(data as ListingRow) : undefined;
}

export async function removeListingFromTour(tourId: string, listingId: string): Promise<boolean> {
  if (!isUuid(listingId)) return false;
  const { error, count } = await db()
    .from('listings')
    .delete({ count: 'exact' })
    .eq('id', listingId)
    .eq('tour_id', tourId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

/* ─── Conversations ──────────────────────────────────────────────────────── */

export async function listConversationsByTour(tourId: string): Promise<ConversationMessage[]> {
  if (!isUuid(tourId)) return [];
  const { data, error } = await db()
    .from('conversations')
    .select('*')
    .eq('tour_id', tourId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as ConversationRow[]).map(rowToConversation);
}

export async function getConversationsByListing(
  tourId: string,
  listingKey: string,
): Promise<ConversationMessage[]> {
  if (!isUuid(tourId)) return [];
  const { data, error } = await db()
    .from('conversations')
    .select('*')
    .eq('tour_id', tourId)
    .eq('listing_key', listingKey)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as ConversationRow[]).map(rowToConversation);
}

export async function addConversationMessage(
  tourId: string,
  msg: ConversationMessage,
): Promise<ConversationMessage> {
  const userId = getCurrentUserId();
  const { data, error } = await db()
    .from('conversations')
    .insert({
      tour_id: tourId,
      user_id: userId,
      listing_key: msg.listingId || BUYER_LISTING_KEY,
      sender: msg.sender,
      sender_name: msg.senderName,
      body: msg.body,
      ts_label: msg.timestamp,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToConversation(data as ConversationRow);
}

/**
 * Bulk-replace all conversations for a tour. Used by /conversations/seed
 * which always wipes & regenerates the mock thread.
 */
export async function replaceConversationsForTour(
  tourId: string,
  messages: ConversationMessage[],
): Promise<void> {
  const userId = getCurrentUserId();
  const c = db();
  const { error: delErr } = await c.from('conversations').delete().eq('tour_id', tourId);
  if (delErr) throw delErr;
  if (!messages.length) return;
  const rows = messages.map((m) => ({
    tour_id: tourId,
    user_id: userId,
    listing_key: m.listingId || BUYER_LISTING_KEY,
    sender: m.sender,
    sender_name: m.senderName,
    body: m.body,
    ts_label: m.timestamp,
  }));
  const { error } = await c.from('conversations').insert(rows);
  if (error) throw error;
}

/**
 * Append messages to a tour's conversation log without wiping existing
 * rows. Used by the new "seed-on-import" flow so importing additional
 * listings into an already-seeded tour adds their mock threads without
 * destroying the buyer thread or other listings' history.
 */
export async function appendConversationsForTour(
  tourId: string,
  messages: ConversationMessage[],
): Promise<void> {
  if (!messages.length) return;
  const userId = getCurrentUserId();
  const c = db();
  const rows = messages.map((m) => ({
    tour_id: tourId,
    user_id: userId,
    listing_key: m.listingId || BUYER_LISTING_KEY,
    sender: m.sender,
    sender_name: m.senderName,
    body: m.body,
    ts_label: m.timestamp,
  }));
  const { error } = await c.from('conversations').insert(rows);
  if (error) throw error;
}

/* ─── Scheduling ─────────────────────────────────────────────────────────── */

import { planSchedule, type ScheduleRequest, type ScheduleResponse } from '../scheduling/planSchedule';
import {
  type ListingGeo,
  type TravelEstimate,
  buildTravelMatrix,
  clusterListings,
  geocodeListings,
} from '../scheduling/geoUtils';
import { getOneMapToken } from '../scheduling/oneMapClient';
import {
  getBuyerSlotsForTour,
  markAvailabilityMismatches,
} from './conversationsMock';
import {
  STEP_KEYS,
  type StepKey,
  type StepStatus,
  type StepArtifacts,
  type StepLogEntry,
  blankStepState,
  nextStepToRun,
  patchRun,
  markStepRunning,
  markStepDone,
  markStepFailed,
  logEntry,
} from '../scheduling/schedulerSteps';

export async function startSchedulingRun(tourId: string): Promise<SchedulingRun> {
  const userId = getCurrentUserId();
  const jwt = getCurrentJwt();
  const { data, error } = await db()
    .from('scheduling_runs')
    .insert({
      tour_id: tourId,
      user_id: userId,
      status: 'running',
      progress: 0,
      step_state: blankStepState(),
      step_log: [],
      step_artifacts: {},
    })
    .select()
    .single();
  if (error) throw error;
  const run = rowToSchedulingRun(data as SchedulingRunRow);

  // Kick off the real scheduler asynchronously.
  void runScheduler(run.id, tourId, userId, jwt).catch((error) => {
    console.error('[scheduler] background run failed:', error);
  });

  return run;
}

export async function getLatestSchedulingRunForTour(
  tourId: string,
): Promise<SchedulingRun | undefined> {
  const { data, error } = await db()
    .from('scheduling_runs')
    .select('*')
    .eq('tour_id', tourId)
    .in('status', ['running', 'completed'])
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToSchedulingRun(data as SchedulingRunRow) : undefined;
}

/**
 * Retry a failed scheduling run from its first non-'done' step.
 * Returns the run state immediately (status flipped back to 'running'),
 * the orchestrator continues in the background.
 *
 * Throws when:
 *   - run not found (caller should 404)
 *   - run is not in 'failed' state (caller should 409)
 */
export async function retrySchedulingRun(runId: string): Promise<SchedulingRun> {
  if (!isUuid(runId)) throw new Error('RUN_NOT_FOUND');
  const userId = getCurrentUserId();
  const jwt = getCurrentJwt();
  const c = db();
  const { data: existing, error: fetchErr } = await c
    .from('scheduling_runs')
    .select('*')
    .eq('id', runId)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  if (!existing) throw new Error('RUN_NOT_FOUND');
  const row = existing as SchedulingRunRow;
  if (row.status !== 'failed') throw new Error('RUN_NOT_FAILED');

  // Flip status back to running but KEEP step_state and step_artifacts —
  // the orchestrator reads them to skip already-done steps.
  const log = (row.step_log as StepLogEntry[]) ?? [];
  log.push(logEntry('gather', 'info', `Retry triggered at ${new Date().toISOString()}`));
  await c
    .from('scheduling_runs')
    .update({
      status: 'running',
      completed_at: null,
      step_log: log,
    })
    .eq('id', runId);

  const refreshed = await c
    .from('scheduling_runs')
    .select('*')
    .eq('id', runId)
    .single();
  const refreshedRun = rowToSchedulingRun(refreshed.data as SchedulingRunRow);

  // Resume in background.
  void runScheduler(runId, row.tour_id, userId, jwt).catch((error) => {
    console.error('[scheduler] background retry failed:', error);
  });

  return refreshedRun;
}

async function probeOneMap(): Promise<boolean> {
  try {
    const t = await getOneMapToken();
    return Boolean(t && t.length > 10);
  } catch (e) {
    console.warn(
      '[scheduler] OneMap token unavailable → falling back to Haversine:',
      (e as Error).message.split('\n')[0],
    );
    return false;
  }
}

/**
 * Orchestrator. Reads current step_state from DB, runs each non-'done' step
 * in order, persists artifacts after every step, marks failure-and-stop on
 * exception. Resumable: a fresh start has every step pending; a retry call
 * has some steps 'done' and we skip them.
 *
 * The 6 step bodies are inlined below as `runStep_xxx`. They share the same
 * shape:
 *   (artifacts, ctx) → Promise<Partial<StepArtifacts>>
 * On throw → orchestrator sets that step to 'failed' and stops the run.
 */
async function runScheduler(
  runId: string,
  tourId: string,
  userId: string,
  jwt: string,
): Promise<void> {
  return runWithUser({ userId, jwt }, async () => {
    const c = db();

    // 1) Load current run state (could be a fresh start or a retry).
    const { data: rowData, error: rowErr } = await c
      .from('scheduling_runs')
      .select('*')
      .eq('id', runId)
      .maybeSingle();
    if (rowErr || !rowData) {
      console.error('[scheduler] cannot load run', runId, rowErr);
      return;
    }
    const row = rowData as SchedulingRunRow;
    let stepState = (row.step_state as Record<StepKey, StepStatus>) || blankStepState();
    let artifacts: StepArtifacts = (row.step_artifacts as StepArtifacts) || {};
    let stepLog = (row.step_log as StepLogEntry[]) || [];

    const append = (entry: StepLogEntry) => {
      stepLog = [...stepLog, entry];
    };

    // 2) Run each step in order, skipping 'done' ones.
    while (true) {
      const next = nextStepToRun(stepState);
      if (!next) break;

      try {
        stepState = await markStepRunning(c, runId, stepState, next);
        append(logEntry(next, 'info', 'started'));

        const t0 = Date.now();
        let patch: Partial<StepArtifacts> = {};
        switch (next) {
          case 'gather':
            patch = await runStep_gather(tourId, append);
            break;
          case 'geocode':
            patch = await runStep_geocode(artifacts, append);
            break;
          case 'cluster':
            patch = await runStep_cluster(artifacts, append);
            break;
          case 'travel':
            patch = await runStep_travel(artifacts, append);
            break;
          case 'optimize':
            patch = await runStep_optimize(artifacts, append);
            break;
          case 'persist':
            patch = await runStep_persist(c, runId, tourId, userId, artifacts, append);
            break;
        }

        const dur = Date.now() - t0;
        append(logEntry(next, 'info', `done in ${dur}ms`));

        const updated = await markStepDone(c, runId, stepState, next, patch, artifacts);
        stepState = updated.state;
        artifacts = updated.artifacts;
        // Persist the running log periodically (every step end).
        await patchRun(c, runId, { step_log: stepLog });
      } catch (err) {
        console.error('[scheduler] step', next, 'failed:', err);
        await markStepFailed(c, runId, stepState, stepLog, next, err);
        return;
      }
    }

    // 3) All 6 steps done → finalize run row.
    await patchRun(c, runId, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      progress: 100,
      step_log: stepLog,
    });
    await markAvailabilityMismatches(tourId);
    console.log('[scheduler] ✓ run', runId, 'completed');
  });
}

// ─── Step implementations ───────────────────────────────────────────────

async function runStep_gather(
  tourId: string,
  log: (e: StepLogEntry) => void,
): Promise<Partial<StepArtifacts>> {
  const listings = await listListingsByTour(tourId);
  const reachable: Listing[] = [];
  const blocked: Listing[] = [];
  for (const l of listings) {
    if (l.agentReachable === false || !(l.availability || []).length) blocked.push(l);
    else reachable.push(l);
  }
  const sellerDates = reachable.flatMap((listing) =>
    (listing.availability || []).map((slot) => slot.date),
  );
  const buyerSlots = await getBuyerSlotsForTour(tourId, sellerDates);
  if (!buyerSlots.length) {
    throw new Error(
      'Buyer availability is missing or invalid. Edit the Tour and confirm a concrete date/time before scheduling.',
    );
  }
  const useOneMap = await probeOneMap();

  const scheduleRequest: ScheduleRequest = {
    buyerSlots: buyerSlots.map((w) => ({ ...w })),
    listings: reachable.map((l) => ({
      listingId: l.id,
      address: l.address || l.title,
      lat: l.lat,
      lng: l.lng,
      agentName: l.coAgent?.name || 'Unknown',
      availableSlots: (l.availability || []).map((w) => ({ ...w })),
    })),
    config: { useOneMap, viewingDurationMinutes: 30, bufferMinutes: 15 },
  };

  log(
    logEntry(
      'gather',
      'info',
      `reachable=${reachable.length} blocked=${blocked.length} buyerSlots=${buyerSlots.length} useOneMap=${useOneMap}`,
    ),
  );

  return {
    gather: {
      reachableIds: reachable.map((l) => l.id),
      blockedIds: blocked.map((l) => l.id),
      buyerSlots,
      useOneMap,
      scheduleRequest,
    },
  };
}

async function runStep_geocode(
  artifacts: StepArtifacts,
  log: (e: StepLogEntry) => void,
): Promise<Partial<StepArtifacts>> {
  const gather = artifacts.gather;
  if (!gather) throw new Error('gather artifacts missing — cannot geocode');
  const listingsForGeo = gather.scheduleRequest.listings.map((l) => ({
    listingId: l.listingId,
    address: l.address,
    lat: l.lat,
    lng: l.lng,
  }));
  let geoListings: ListingGeo[];
  try {
    geoListings = await geocodeListings(listingsForGeo);
  } catch (err) {
    // Mirror planSchedule's tolerance: fall back to zero-geo so the run
    // still completes (just with no distance optimization). We log a
    // warning so the agent can see it in step_log if they look.
    log(
      logEntry(
        'geocode',
        'warn',
        `geocoding failed, falling back to zero-geo: ${(err as Error).message.split('\n')[0]}`,
      ),
    );
    geoListings = listingsForGeo.map((l) => ({
      listingId: l.listingId,
      address: l.address,
      lat: l.lat ?? 0,
      lng: l.lng ?? 0,
    }));
  }
  return { geocode: { geoListings } };
}

async function runStep_cluster(
  artifacts: StepArtifacts,
  log: (e: StepLogEntry) => void,
): Promise<Partial<StepArtifacts>> {
  const useOneMap = artifacts.gather?.useOneMap ?? false;
  const geo = artifacts.geocode?.geoListings ?? [];
  if (!geo.length) {
    log(logEntry('cluster', 'info', 'no listings to cluster'));
    return { cluster: { geoListings: geo } };
  }
  let clustered: ListingGeo[];
  try {
    clustered = await clusterListings(geo, useOneMap);
  } catch (err) {
    log(
      logEntry(
        'cluster',
        'warn',
        `clustering failed, using ungrouped: ${(err as Error).message.split('\n')[0]}`,
      ),
    );
    clustered = geo;
  }
  return { cluster: { geoListings: clustered } };
}

async function runStep_travel(
  artifacts: StepArtifacts,
  log: (e: StepLogEntry) => void,
): Promise<Partial<StepArtifacts>> {
  const useOneMap = artifacts.gather?.useOneMap ?? false;
  const clustered = artifacts.cluster?.geoListings ?? [];
  if (clustered.length < 2) {
    log(logEntry('travel', 'info', 'fewer than 2 listings, skipping travel matrix'));
    return { travel: { travelMatrix: {} } };
  }
  let matrix: Map<string, TravelEstimate>;
  try {
    matrix = await buildTravelMatrix(clustered, useOneMap);
  } catch (err) {
    log(
      logEntry(
        'travel',
        'warn',
        `travel matrix failed, using zero distances: ${(err as Error).message.split('\n')[0]}`,
      ),
    );
    matrix = new Map();
  }
  // Map → Record for jsonb storage
  const obj: Record<string, TravelEstimate> = {};
  for (const [k, v] of matrix.entries()) obj[k] = v;
  return { travel: { travelMatrix: obj } };
}

async function runStep_optimize(
  artifacts: StepArtifacts,
  log: (e: StepLogEntry) => void,
): Promise<Partial<StepArtifacts>> {
  const gather = artifacts.gather;
  if (!gather) throw new Error('gather artifacts missing — cannot optimize');
  const t0 = Date.now();
  // For now we re-run planSchedule end-to-end — it does its own geocoding/
  // clustering/travel matrix. The earlier steps' artifacts are mainly there
  // for visibility (and for Phase 2B, where re-runs can leverage them).
  // TODO(phase2b): pass pre-computed geo/cluster/travel from artifacts to
  // planSchedule so this step is a pure greedy assignment.
  const result = await planSchedule(gather.scheduleRequest);
  log(
    logEntry(
      'optimize',
      'info',
      `planSchedule done in ${Date.now() - t0}ms, scheduled=${result.schedule.length}, unschedulable=${result.unschedulable.length}`,
    ),
  );
  return {
    optimize: {
      schedule: result.schedule,
      unschedulable: result.unschedulable,
    },
  };
}

async function runStep_persist(
  c: SupabaseClient,
  runId: string,
  tourId: string,
  userId: string,
  artifacts: StepArtifacts,
  log: (e: StepLogEntry) => void,
): Promise<Partial<StepArtifacts>> {
  const opt = artifacts.optimize;
  if (!opt) throw new Error('optimize artifacts missing — cannot persist');

  const scheduledById = new Map(opt.schedule.map((sv) => [sv.listingId, sv]));
  const unschedById = new Map(opt.unschedulable.map((u) => [u.listingId, u]));

  let scheduledCount = 0;
  let attentionCount = 0;

  const liveListings = await listListingsByTour(tourId);
  for (const l of liveListings) {
    if (l.agentReachable === false) {
      attentionCount++;
      await ensureAttentionItem(c, tourId, userId, l.id, l.attentionReason || 'Co-agent unreachable');
      continue;
    }
    const sched = scheduledById.get(l.id);
    if (sched) {
      await c
        .from('listings')
        .update({
          status: 'confirmed',
          status_label: 'Confirmed',
          suggested_time: `${sched.date} ${sched.startTime} – ${sched.endTime}`,
          attention_reason: null,
        })
        .eq('id', l.id);
      scheduledCount++;
      continue;
    }
    const un = unschedById.get(l.id);
    if (un) {
      await c
        .from('listings')
        .update({
          status: 'needs-attention',
          status_label: 'No matching slot',
          suggested_time: 'Pending',
          attention_reason: un.reason,
        })
        .eq('id', l.id);
      attentionCount++;
      await ensureAttentionItem(c, tourId, userId, l.id, un.reason);
    }
  }

  log(
    logEntry(
      'persist',
      'info',
      `wrote scheduled=${scheduledCount} attention=${attentionCount}`,
    ),
  );

  // Persist counts directly on the run row so the API response carries them.
  await c
    .from('scheduling_runs')
    .update({
      scheduled_count: scheduledCount,
      attention_count: attentionCount,
    })
    .eq('id', runId);

  return {};
}

async function ensureAttentionItem(
  c: SupabaseClient,
  tourId: string,
  userId: string,
  listingId: string,
  reason: string,
): Promise<void> {
  const { data: existing } = await c
    .from('attention_items')
    .select('id')
    .eq('tour_id', tourId)
    .eq('listing_id', listingId)
    .eq('resolved', false)
    .maybeSingle();
  if (existing) return;
  await c.from('attention_items').insert({
    tour_id: tourId,
    user_id: userId,
    listing_id: listingId,
    reason,
    resolved: false,
  });
}

export async function getSchedulingRun(runId: string): Promise<SchedulingRun | undefined> {
  if (!isUuid(runId)) return undefined;
  const { data, error } = await db()
    .from('scheduling_runs')
    .select('*')
    .eq('id', runId)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToSchedulingRun(data as SchedulingRunRow) : undefined;
}

/* ─── Attention Items ────────────────────────────────────────────────────── */

export async function listAttentionItems(tourId: string): Promise<AttentionItem[]> {
  if (!isUuid(tourId)) return [];
  const { data, error } = await db()
    .from('attention_items')
    .select('*')
    .eq('tour_id', tourId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as AttentionItemRow[]).map(rowToAttentionItem);
}

export async function resolveAttentionItem(
  itemId: string,
  resolution: string,
): Promise<AttentionItem | undefined> {
  if (!isUuid(itemId)) return undefined;
  const { data, error } = await db()
    .from('attention_items')
    .update({ resolved: true, resolution })
    .eq('id', itemId)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data ? rowToAttentionItem(data as AttentionItemRow) : undefined;
}

/* ─── Routes ─────────────────────────────────────────────────────────────── */

export async function generateRoute(tourId: string): Promise<AgentRoute> {
  const userId = getCurrentUserId();
  const tour = await getTourDetail(tourId);
  const listings = await listListingsByTour(tourId);

  const slotKey = (s: string | undefined): string => {
    if (!s) return '\uffff';
    const dated = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})/.exec(s);
    if (dated) return `${dated[1]} ${dated[2].padStart(5, '0')}`;
    const time = /(\d{1,2}):(\d{2})/.exec(s);
    return time ? `${tour?.targetDate || '9999-12-31'} ${time[1].padStart(2, '0')}:${time[2]}` : '\uffff';
  };
  const confirmedListings = listings
    .filter((l) => l.status === 'confirmed')
    .sort((a, b) => slotKey(a.suggestedTime).localeCompare(slotKey(b.suggestedTime)));

  const stops: RouteStop[] = confirmedListings.map((listing) => ({
    id: `stop-${listing.id}`,
    listingId: listing.id,
    time: listing.suggestedTime || 'Pending',
    title: listing.title,
    address: listing.address,
    area: listing.area,
    condo: listing.condo,
    unitNo: listing.unitNo,
    coAgentName: listing.coAgent.name,
    coAgentPhone: listing.coAgent.phone,
    googleMapsUrl: listing.googleMapsUrl,
    notes: listing.summary,
  }));

  const c = db();
  // Replace any existing route(s) for the tour
  const { error: delErr } = await c.from('routes').delete().eq('tour_id', tourId);
  if (delErr) throw delErr;

  const { data, error } = await c
    .from('routes')
    .insert({
      tour_id: tourId,
      user_id: userId,
      title: tour?.title || 'Viewing Route',
      date: [...new Set(confirmedListings.map((listing) => {
        const match = /^(\d{4}-\d{2}-\d{2})\s+/.exec(listing.suggestedTime || '');
        return match?.[1] || tour?.targetDate;
      }).filter(Boolean))].join(', ') || 'Today',
      stops,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToRoute(data as RouteRow, tour?.planId || '');
}

export async function getRouteById(routeId: string): Promise<AgentRoute | undefined> {
  if (!isUuid(routeId)) return undefined;
  const { data, error } = await db()
    .from('routes')
    .select('*, tours(plan_id)')
    .eq('id', routeId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return undefined;
  const planId = (data as RouteRow & { tours?: { plan_id: string } }).tours?.plan_id || '';
  return rowToRoute(data as RouteRow, planId);
}

/**
 * Generate a share token for a route. Anyone holding the token can read
 * the (sanitized) client-facing route via /api/share/routes/:token.
 */
export async function shareRoute(
  routeId: string,
): Promise<{ shareToken: string; shareUrl: string }> {
  if (!isUuid(routeId)) throw new Error('Route not found');
  const userId = getCurrentUserId();
  const token = `share_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  const { error } = await db()
    .from('share_tokens')
    .insert({ token, route_id: routeId, user_id: userId });
  if (error) throw error;
  return { shareToken: token, shareUrl: `/share/routes/${token}` };
}

/**
 * Public share lookup. Implemented via a SECURITY DEFINER RPC on the DB
 * (`get_route_by_share_token`) so it works without a user JWT and so RLS
 * policies don't get in the way. Called from the unauthenticated route in
 * server.ts using `supabaseAdmin`.
 */
export async function getRouteByShareToken(token: string): Promise<ClientRoute | undefined> {
  const { data, error } = await supabaseAdmin.rpc('get_route_by_share_token', {
    p_token: token,
  });
  if (error) throw error;
  return (data as ClientRoute) ?? undefined;
}

/* ─── PG → business Listing mapper (pure) ───────────────────────────────── */

/**
 * Map a freshly-scraped PropertyGuru row (PropertyGuruListing shape) into the
 * business `Listing` shape used by butler-web-store + frontend + scheduler.
 *
 * Note: the returned listing's `id` is a synthetic "pg-XXXXXX" string. When
 * inserted via addListingToTourWeb(), this is converted into:
 *   - `pg_listing_id` column = "XXXXXX"  (used to dedupe within a tour)
 *   - `id` column = a freshly assigned uuid (actual primary key)
 */
export function pgToBusinessListing(
  pg: Record<string, unknown>,
  fallbackUrl: string,
): Listing {
  const pickStr = (...keys: string[]): string => {
    for (const k of keys) {
      const v = pg[k];
      if (v == null) continue;
      if (typeof v === 'string' && v.trim()) return v;
      if (typeof v === 'number' && Number.isFinite(v)) return String(v);
    }
    return '';
  };
  const pickNum = (...keys: string[]): number => {
    for (const k of keys) {
      const v = pg[k];
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v))) return Number(v);
    }
    return 0;
  };

  const listingId = pickStr('listingId') || '';
  const id = listingId
    ? `pg-${listingId}`
    : `import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rawAddress = pickStr('address');
  const priceLabel = pickStr('priceLabel', 'price');
  const psfLabel = pickStr('psfLabel', 'psf');
  const beds = pickNum('bedrooms', 'beds');
  const baths = pickNum('bathrooms', 'baths');
  const sqft = pickNum('areaSqft', 'sqft');
  const imageUrl = pickStr('imageUrl', 'image', 'thumbnail');
  const propertyGuruUrlVal = pickStr('propertyGuruUrl', 'url') || fallbackUrl;
  const rawText = pickStr('rawText');
  const sourceTitle = pickStr('title');
  const detail = (pg as { detail?: { description?: unknown } }).detail;
  const detailDescription =
    typeof detail?.description === 'string' ? detail.description.trim() : '';
  const primaryListingText = [
    sourceTitle,
    extractPrimaryPgListingText(rawText),
    detailDescription,
  ].filter(Boolean).join('\n');

  const llm = (pg as { _llm?: Partial<{ condo: string; address: string; area: string; coAgentName: string; coAgentAgency: string }> })._llm;
  const fallback = parsePgRawText(extractPrimaryPgListingText(rawText), rawAddress);
  const address = (llm?.address && llm.address.trim()) || fallback.cleanAddress || rawAddress;

  const groundedProjectName = (
    value: string | undefined,
    evidence: string,
  ): string => {
    const candidate = value?.trim() || '';
    if (!candidate) return '';
    if (normalizePgEvidenceText(candidate) === normalizePgEvidenceText(address)) return '';
    return textContainsCandidate(evidence, candidate) ? candidate : '';
  };

  const condo =
    groundedProjectName(llm?.condo, primaryListingText) ||
    groundedProjectName(fallback.condo, sourceTitle);
  const area = (llm?.area && llm.area.trim()) || fallback.area || deriveAreaFromAddress(address);
  const coAgentName =
    (llm?.coAgentName && llm.coAgentName.trim()) || fallback.agentName || pickStr('title') || 'Unknown';
  const coAgentAgency =
    (llm?.coAgentAgency && llm.coAgentAgency.trim()) || pickStr('agent') || '';

  const pgCoAgent = (pg as { coAgent?: { phone?: string; whatsapp?: string; agency?: string } }).coAgent;
  const coAgentPhone = (pgCoAgent?.phone || pgCoAgent?.whatsapp || '').trim();
  const coAgentAgencyFinal = (pgCoAgent?.agency && pgCoAgent.agency.trim()) || coAgentAgency;

  const displayTitle = condo
    ? `${condo}${beds ? ` · ${beds} bed` : ''}`
    : address || pickStr('title') || 'Untitled Listing';

  return {
    id,
    title: displayTitle,
    address,
    area: area || 'Unknown',
    condo,
    price: priceLabel || '$0',
    beds,
    baths,
    sqft,
    psf: psfLabel || '0',
    imageUrl,
    status: 'imported',
    statusLabel: 'Imported',
    suggestedTime: 'Pending',
    unitNo: '',
    coAgent: { name: coAgentName, phone: coAgentPhone, agency: coAgentAgencyFinal },
    googleMapsUrl: address ? mapsUrl(address) : '',
    propertyGuruUrl: propertyGuruUrlVal,
    summary: 'Imported from PropertyGuru. AI PA has not contacted the co-agent yet.',
  };
}

function parsePgRawText(
  rawText: string,
  rawAddress: string,
): { condo: string; agentName: string; area: string; cleanAddress: string } {
  const fallbackArea = deriveAreaFromAddress(rawAddress);
  if (!rawText) return { condo: '', agentName: '', area: fallbackArea, cleanAddress: '' };

  const lines = rawText.split('\n').map((s) => s.trim()).filter(Boolean);

  const psfIdx = lines.findIndex((l) => /\bpsf\b/i.test(l));
  let condo = '';
  let cleanAddress = '';

  const looksLikeAddress = (line: string): boolean => {
    if (!line) return false;
    if (!/^\d+[A-Za-z]?\s+\S/.test(line)) return false;
    if (/\bsqft\b/i.test(line) || /S\$/.test(line)) return false;
    return true;
  };

  const looksLikeProjectName = (line: string): boolean => {
    if (!line) return false;
    if (looksLikeAddress(line)) return false;
    if (/\bsqft\b/i.test(line) || /S\$/.test(line)) return false;
    if (/^\d+$/.test(line)) return false;
    if (/[!/]/.test(line) && line.length > 25) return false;
    if (line.length > 60) return false;
    return true;
  };

  if (psfIdx >= 0) {
    const next1 = lines[psfIdx + 1] || '';
    const next2 = lines[psfIdx + 2] || '';
    if (looksLikeAddress(next1)) {
      cleanAddress = next1;
    } else if (looksLikeProjectName(next1) && looksLikeAddress(next2)) {
      condo = next1;
      cleanAddress = next2;
    } else if (looksLikeProjectName(next1)) {
      condo = next1;
    }
  }

  if (!cleanAddress) {
    if (rawAddress && !/[!/]/.test(rawAddress) && rawAddress.length < 60) {
      cleanAddress = rawAddress;
    }
  }

  const PROMO_BANNERS = new Set(['Explore around', 'Listing with similar price range', 'PROMOTED', 'Contact']);
  let agentName = '';
  for (const line of lines.slice(0, 6)) {
    if (PROMO_BANNERS.has(line)) continue;
    if (/^\d+(\.\d+)?$/.test(line)) continue;
    if (/^\(\d+\)$/.test(line)) continue;
    if (/PTE\.?\s*LTD/i.test(line)) continue;
    if (/REALTY|NETWORK|PROPNEX|ORANGETEE|ERA\b/i.test(line)) continue;
    agentName = line;
    break;
  }

  const area = deriveAreaFromAddress(cleanAddress) || fallbackArea;
  return { condo, agentName, area, cleanAddress };
}

function deriveAreaFromAddress(address: string): string {
  if (!address) return '';
  const withoutNumber = address.replace(/^\s*\d+[A-Za-z]?\s+/, '').trim();
  if (!withoutNumber) return '';
  const ROAD_TYPES = /\s+(Walk|Avenue|Avenue \d+|Road|Street|Lane|Crescent|Drive|Way|Ave|St|Rd|Dr)\s*\d*$/i;
  const cleaned = withoutNumber.replace(ROAD_TYPES, '').trim();
  return cleaned || withoutNumber;
}
