/**
 * Main scheduling engine — POST /api/schedule/plan
 *
 * Takes buyer/seller available time slots + listing locations,
 * produces an optimized viewing schedule following these priorities:
 *
 * 1. Same time block → cluster same-area listings together
 * 2. First confirmed listing in a block → pulls same-area listings into that block
 * 3. Cross-block ordering → geographic proximity order
 * 4. Walk ≤ 5 min → same cluster, no buffer
 * 5. Walk > 5 min → compute driving time, round up
 * 6. All times ceil to :00/:15/:30/:45
 */

import {
  type ListingGeo,
  type TravelEstimate,
  buildTravelMatrix,
  clusterListings,
  geocodeListings,
  getTravelEstimate,
  haversineDistanceKm,
} from './geoUtils';
import {
  type TimeWindow,
  ceilMinutesToQuarter,
  findSlotIntersections,
  fitViewing,
  getBlock,
  getDayLabel,
  minutesToTime,
  timeToMinutes,
  windowDurationMinutes,
} from './timeUtils';

// ── API Types ──

export interface BuyerLocation {
  address: string;
  lat?: number;
  lng?: number;
}

export interface ScheduleRequest {
  buyerLocation?: BuyerLocation;
  buyerSlots: TimeWindow[];
  listings: ListingInput[];
  config?: ScheduleConfig;
}

export interface ListingInput {
  listingId: string;
  address: string;
  lat?: number;
  lng?: number;
  district?: string;
  agentName: string;
  availableSlots: TimeWindow[];
}

export interface ScheduleConfig {
  viewingDurationMinutes?: number;   // default 30
  bufferMinutes?: number;            // minimum buffer if OneMap fails, default 15
  walkThresholdMinutes?: number;     // ≤ this → same cluster, default 5
  maxViewingsPerBlock?: number;      // default 4
  useOneMap?: boolean;               // default true (set false for testing without token)
}

export interface ScheduleResponse {
  schedule: ScheduledViewing[];
  unschedulable: UnschedulableListing[];
  meta: ScheduleMeta;
}

export interface ScheduledViewing {
  listingId: string;
  address: string;
  agentName: string;
  date: string;
  startTime: string;
  endTime: string;
  block: string;
  blockLabel: string;
  orderInBlock: number;
  travelFromBuyer?: {
    buyerAddress: string;
    mode: 'walk' | 'drive';
    durationMinutes: number;
    distanceKm: number;
  };
  travelFromPrev?: {
    mode: 'walk' | 'drive';
    durationMinutes: number;
    distanceKm: number;
  };
  cluster: string;
}

export interface UnschedulableListing {
  listingId: string;
  address: string;
  agentName: string;
  reason: string;
}

export interface ScheduleMeta {
  totalListings: number;
  scheduledCount: number;
  unschedulableCount: number;
  totalBlocks: number;
  estimatedTotalDuration: string;
}

// ── Defaults ──

const DEFAULT_VIEWING_DURATION = 30;
const DEFAULT_BUFFER = 15;
const DEFAULT_WALK_THRESHOLD = 5;
const DEFAULT_MAX_PER_BLOCK = 4;

// ── Main scheduling function ──

export async function planSchedule(request: ScheduleRequest): Promise<ScheduleResponse> {
  const config = request.config || {};
  const viewingDuration = config.viewingDurationMinutes || DEFAULT_VIEWING_DURATION;
  const fallbackBuffer = config.bufferMinutes || DEFAULT_BUFFER;
  const maxPerBlock = config.maxViewingsPerBlock || DEFAULT_MAX_PER_BLOCK;
  const useOneMap = config.useOneMap !== false;

  const unschedulable: UnschedulableListing[] = [];
  const schedulable: Array<{
    listing: ListingInput;
    validWindows: TimeWindow[];
  }> = [];

  // ─── Step 1: Compute buyer ∩ seller time intersections ───

  for (const listing of request.listings) {
    if (!listing.availableSlots.length) {
      unschedulable.push({
        listingId: listing.listingId,
        address: listing.address,
        agentName: listing.agentName,
        reason: 'No available time slots from agent',
      });
      continue;
    }

    const validWindows = findSlotIntersections(request.buyerSlots, listing.availableSlots);

    // Filter windows that can't fit a viewing
    const fittable = validWindows.filter(w => windowDurationMinutes(w) >= viewingDuration);

    if (!fittable.length) {
      unschedulable.push({
        listingId: listing.listingId,
        address: listing.address,
        agentName: listing.agentName,
        reason: 'No overlapping time slots between buyer and agent (or overlap too short for a viewing)',
      });
      continue;
    }

    schedulable.push({ listing, validWindows: fittable });
  }

  if (!schedulable.length) {
    return {
      schedule: [],
      unschedulable,
      meta: {
        totalListings: request.listings.length,
        scheduledCount: 0,
        unschedulableCount: unschedulable.length,
        totalBlocks: 0,
        estimatedTotalDuration: '0min',
      },
    };
  }

  // ─── Step 2: Geocode + Cluster listings ───

  const listingsForGeo = schedulable.map(s => ({
    listingId: s.listing.listingId,
    address: s.listing.address,
    lat: s.listing.lat,
    lng: s.listing.lng,
  }));

  let geoListings: ListingGeo[];
  let travelMatrix: Map<string, TravelEstimate>;

  try {
    geoListings = await geocodeListings(listingsForGeo);
    geoListings = await clusterListings(geoListings, useOneMap);
    travelMatrix = await buildTravelMatrix(geoListings, useOneMap);
  } catch (err) {
    console.warn(
      '[planSchedule] geocoding failed, falling back to zero-geo mode (no distance optimization):',
      (err as Error).message.split('\n')[0],
    );
    // True zero-geo fallback: skip geocoding entirely. Use whatever lat/lng
    // each listing already has (likely 0/0). All travel times treated as 0,
    // so the scheduler degrades to pure time-window matching. Less optimal
    // routing but never throws — the agent can still see scheduled slots.
    geoListings = listingsForGeo.map((l) => ({
      listingId: l.listingId,
      address: l.address,
      lat: l.lat ?? 0,
      lng: l.lng ?? 0,
    }));
    travelMatrix = new Map();
  }

  // Build lookup maps
  const geoMap = new Map<string, ListingGeo>();
  for (const g of geoListings) geoMap.set(g.listingId, g);

  // ─── Step 2b: Resolve buyer location (for travel-from-buyer) ───

  let buyerGeo: ListingGeo | null = null;
  if (request.buyerLocation) {
    const bl = request.buyerLocation;
    if (bl.lat && bl.lng) {
      buyerGeo = {
        listingId: '__buyer__',
        address: bl.address,
        lat: bl.lat,
        lng: bl.lng,
      };
    } else {
      // Geocode buyer address via OneMap
      try {
        const [geo] = await geocodeListings([{
          listingId: '__buyer__',
          address: bl.address,
        }]);
        buyerGeo = geo;
      } catch {
        console.warn('[planSchedule] Could not geocode buyer location:', bl.address);
      }
    }
  }

  // ─── Step 3: Assign listings to time blocks (greedy) ───

  // Group valid windows by date|block
  interface BlockCandidate {
    dateBlock: string; // "2026-05-03|morning"
    date: string;
    block: string;
    listings: Array<{ listing: ListingInput; window: TimeWindow }>;
  }

  const blockCandidates = new Map<string, BlockCandidate>();

  for (const { listing, validWindows } of schedulable) {
    for (const w of validWindows) {
      const b = getBlock(w.startTime);
      const blockName = b?.block || 'other';
      const key = `${w.date}|${blockName}`;

      if (!blockCandidates.has(key)) {
        blockCandidates.set(key, {
          dateBlock: key,
          date: w.date,
          block: blockName,
          listings: [],
        });
      }
      blockCandidates.get(key)!.listings.push({ listing, window: w });
    }
  }

  // Sort blocks chronologically
  const sortedBlocks = [...blockCandidates.values()].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    const blockOrder = { morning: 0, afternoon: 1, evening: 2, other: 3 };
    return (blockOrder[a.block as keyof typeof blockOrder] || 3) -
           (blockOrder[b.block as keyof typeof blockOrder] || 3);
  });

  // Greedy assignment: for each block, prefer clusters with most listings
  const scheduled: ScheduledViewing[] = [];
  const assignedListings = new Set<string>();

  for (const blockCandidate of sortedBlocks) {
    // Filter out already-assigned listings
    const available = blockCandidate.listings.filter(
      l => !assignedListings.has(l.listing.listingId)
    );
    if (!available.length) continue;
    if (scheduled.filter(s => s.date === blockCandidate.date && s.block === blockCandidate.block).length >= maxPerBlock) continue;

    // Priority 1 & 2: Group by cluster, sort by cluster size (most listings first)
    const clusterGroups = new Map<string, typeof available>();
    for (const item of available) {
      const geo = geoMap.get(item.listing.listingId);
      const cluster = geo?.cluster || `isolated-${item.listing.listingId}`;
      if (!clusterGroups.has(cluster)) clusterGroups.set(cluster, []);
      clusterGroups.get(cluster)!.push(item);
    }

    // Sort clusters: largest first (Priority 2: cluster with confirmed listings first)
    const sortedClusters = [...clusterGroups.entries()].sort((a, b) => {
      // Prefer clusters that already have a listing scheduled in a previous block (Priority 2)
      const aHasScheduled = a[1].some(l => assignedListings.has(l.listing.listingId));
      const bHasScheduled = b[1].some(l => assignedListings.has(l.listing.listingId));
      if (aHasScheduled !== bHasScheduled) return aHasScheduled ? -1 : 1;
      // Then prefer larger clusters (Priority 1)
      return b[1].length - a[1].length;
    });

    // Fill block with listings, cluster by cluster
    let blockViewings: ScheduledViewing[] = [];
    let lastScheduledInBlock: ScheduledViewing | null = null;

    for (const [clusterName, clusterListingItems] of sortedClusters) {
      if (blockViewings.length >= maxPerBlock) break;

      // Priority 3: Within a cluster, sort by distance from last scheduled listing
      const sorted = [...clusterListingItems].sort((a, b) => {
        if (!lastScheduledInBlock) return 0;
        const geoA = geoMap.get(a.listing.listingId);
        const geoB = geoMap.get(b.listing.listingId);
        const lastGeo = geoMap.get(lastScheduledInBlock.listingId);
        if (!geoA || !geoB || !lastGeo) return 0;
        const distA = haversineDistanceKm({ lat: lastGeo.lat, lng: lastGeo.lng }, { lat: geoA.lat, lng: geoA.lng });
        const distB = haversineDistanceKm({ lat: lastGeo.lat, lng: lastGeo.lng }, { lat: geoB.lat, lng: geoB.lng });
        return distA - distB;
      });

      for (const item of sorted) {
        if (assignedListings.has(item.listing.listingId)) continue;
        if (blockViewings.length >= maxPerBlock) break;

        // Calculate buffer from previous viewing
        let bufferMin = 0;
        let travelInfo: ScheduledViewing['travelFromPrev'] = undefined;

        if (lastScheduledInBlock) {
          const travelKey = `${lastScheduledInBlock.listingId}->${item.listing.listingId}`;
          const travel = travelMatrix.get(travelKey);

          if (travel) {
            bufferMin = travel.bufferMinutes;
            if (!travel.isSameCluster) {
              travelInfo = {
                mode: travel.driveMinutes != null ? 'drive' : 'walk',
                durationMinutes: ceilMinutesToQuarter(travel.driveMinutes ?? travel.walkMinutes ?? fallbackBuffer),
                distanceKm: Math.round(travel.distanceKm * 100) / 100,
              };
            }
          } else {
            // No travel data — use fallback buffer
            const lastGeo = geoMap.get(lastScheduledInBlock.listingId);
            const curGeo = geoMap.get(item.listing.listingId);
            if (lastGeo && curGeo && lastGeo.cluster === curGeo.cluster) {
              bufferMin = 0; // same cluster
            } else {
              bufferMin = fallbackBuffer;
              if (lastGeo && curGeo) {
                travelInfo = {
                  mode: 'drive',
                  durationMinutes: fallbackBuffer,
                  distanceKm: Math.round(haversineDistanceKm(
                    { lat: lastGeo.lat, lng: lastGeo.lng },
                    { lat: curGeo.lat, lng: curGeo.lng }
                  ) * 100) / 100,
                };
              }
            }
          }
        }

        // Calculate start time
        let earliestStart: number;
        if (lastScheduledInBlock) {
          earliestStart = timeToMinutes(lastScheduledInBlock.endTime) + bufferMin;
        } else {
          earliestStart = timeToMinutes(item.window.startTime);
        }

        const fit = fitViewing(item.window, viewingDuration, earliestStart);
        if (!fit) continue;

        // Calculate travel from buyer location for first viewing in block
        let travelFromBuyer: ScheduledViewing['travelFromBuyer'] = undefined;
        if (!lastScheduledInBlock && buyerGeo) {
          const curGeo = geoMap.get(item.listing.listingId);
          if (curGeo) {
            try {
              const estimate = await getTravelEstimate(buyerGeo, curGeo, useOneMap);
              const duration = estimate.driveMinutes ?? estimate.walkMinutes ?? fallbackBuffer;
              travelFromBuyer = {
                buyerAddress: buyerGeo.address,
                mode: (estimate.driveMinutes != null && estimate.walkMinutes != null && estimate.walkMinutes > 5) ? 'drive' : 'walk',
                durationMinutes: ceilMinutesToQuarter(duration),
                distanceKm: Math.round(estimate.distanceKm * 100) / 100,
              };
            } catch {
              // Fallback: Haversine estimate
              const dist = haversineDistanceKm(
                { lat: buyerGeo.lat, lng: buyerGeo.lng },
                { lat: curGeo.lat, lng: curGeo.lng }
              );
              travelFromBuyer = {
                buyerAddress: buyerGeo.address,
                mode: 'drive',
                durationMinutes: ceilMinutesToQuarter(dist / 0.5), // ~30km/h
                distanceKm: Math.round(dist * 100) / 100,
              };
            }
          }
        }

        const viewing: ScheduledViewing = {
          listingId: item.listing.listingId,
          address: item.listing.address,
          agentName: item.listing.agentName,
          date: item.window.date,
          startTime: fit.startTime,
          endTime: fit.endTime,
          block: blockCandidate.block,
          blockLabel: `${getDayLabel(item.window.date)} · ${getBlock(fit.startTime)?.label || blockCandidate.block}`,
          orderInBlock: blockViewings.length + 1,
          travelFromBuyer,
          travelFromPrev: travelInfo,
          cluster: clusterName,
        };

        blockViewings.push(viewing);
        scheduled.push(viewing);
        assignedListings.add(item.listing.listingId);
        lastScheduledInBlock = viewing;
      }
    }
  }

  // Any remaining unassigned listings → unschedulable
  for (const { listing } of schedulable) {
    if (!assignedListings.has(listing.listingId)) {
      unschedulable.push({
        listingId: listing.listingId,
        address: listing.address,
        agentName: listing.agentName,
        reason: 'Could not fit into any block due to travel buffer conflicts or block capacity limits',
      });
    }
  }

  // ─── Step 4: Sort final schedule ───

  scheduled.sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
  });

  // Re-number orderInBlock
  let currentBlockKey = '';
  let blockOrder = 0;
  for (const viewing of scheduled) {
    const key = `${viewing.date}|${viewing.block}`;
    if (key !== currentBlockKey) {
      currentBlockKey = key;
      blockOrder = 1;
    }
    viewing.orderInBlock = blockOrder++;
  }

  // ─── Calculate meta ───

  const blocks = new Set(scheduled.map(s => `${s.date}|${s.block}`));
  let totalMinutes = 0;
  if (scheduled.length > 0) {
    const firstStart = timeToMinutes(scheduled[0].startTime);
    const lastEnd = timeToMinutes(scheduled[scheduled.length - 1].endTime);
    // Simple estimate: from first viewing start to last viewing end
    totalMinutes = lastEnd - firstStart;
  }

  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  const durationStr = hours > 0 ? `${hours}h ${mins}min` : `${mins}min`;

  return {
    schedule: scheduled,
    unschedulable,
    meta: {
      totalListings: request.listings.length,
      scheduledCount: scheduled.length,
      unschedulableCount: unschedulable.length,
      totalBlocks: blocks.size,
      estimatedTotalDuration: durationStr,
    },
  };
}
