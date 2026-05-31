/**
 * Geographic utilities for the scheduling engine.
 *
 * Provides:
 * 1. Haversine distance calculation (fallback when OneMap is unavailable)
 * 2. Travel time estimation between listings (walk vs drive)
 * 3. Geographic clustering — group nearby listings into clusters
 *
 * Key rule: walk ≤ 5 min → same cluster (no buffer needed)
 *           walk > 5 min → use driving time, round up to 15 min granularity
 */

import {
  batchGeocode,
  getDrivingMinutes,
  getWalkingMinutes,
  type GeocodedLocation,
} from './oneMapClient';

// ── Constants ──

const WALK_THRESHOLD_MINUTES = 5; // ≤ 5 min walk = same cluster
const EARTH_RADIUS_KM = 6371;
const WALK_SPEED_KM_PER_MIN = 0.08; // ~4.8 km/h
const DRIVE_SPEED_KM_PER_MIN = 0.5; // ~30 km/h city average

/**
 * Haversine pre-filter thresholds used by `getTravelEstimate`.
 *
 * WALK_MAX_KM  — even 1.4× road-network multiplier on 0.5 km at 4.8 km/h
 *                is ~8.75 min walking. Two points further than this can
 *                NEVER be in the same cluster (≤ 5 min walk), so we skip
 *                the OneMap walk API entirely and use the cheap Haversine
 *                estimate. We pick 0.5 km as a safe conservative bound —
 *                if anything it might over-consult OneMap for a few pairs
 *                near the threshold, but never under-consult.
 *
 * DRIVE_MAX_KM — at 15 km+ straight line, the Haversine drive estimate
 *                with a 1.3× road multiplier is within one 15-min bucket
 *                of the real routed time for Singapore city grids, so the
 *                scheduler's buffer (ceiled to 15-min increments) is
 *                unaffected. Skipping OneMap drive here keeps quota under
 *                control on long inter-region tours.
 */
const WALK_MAX_KM = 0.5;
const DRIVE_MAX_KM = 15;

// ── Types ──

export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface ListingGeo {
  listingId: string;
  address: string;
  lat: number;
  lng: number;
  cluster?: string;
}

export interface TravelEstimate {
  fromListingId: string;
  toListingId: string;
  walkMinutes: number | null;
  driveMinutes: number | null;
  distanceKm: number;
  isSameCluster: boolean;
  bufferMinutes: number; // 0 if same cluster, else ceil15(driveMinutes)
}

// ── Haversine (fallback) ──

/**
 * Calculate straight-line distance between two points using Haversine formula.
 * Returns distance in kilometers.
 */
export function haversineDistanceKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h = sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLng * sinDLng;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Estimate walking minutes from straight-line distance (Haversine fallback).
 * Adds a 1.4x multiplier for road network vs straight line.
 */
export function estimateWalkMinutes(distanceKm: number): number {
  return (distanceKm * 1.4) / WALK_SPEED_KM_PER_MIN;
}

/**
 * Estimate driving minutes from straight-line distance (Haversine fallback).
 * Adds a 1.3x multiplier for road network.
 */
export function estimateDriveMinutes(distanceKm: number): number {
  return (distanceKm * 1.3) / DRIVE_SPEED_KM_PER_MIN;
}

// ── Ceil to 15 min ──

/**
 * Round up minutes to nearest 15-minute boundary.
 */
export function ceilTo15(minutes: number): number {
  return Math.ceil(minutes / 15) * 15;
}

// ── Geocode listings ──

/**
 * Geocode an array of listings (address → lat/lng).
 * Uses OneMap API, falls back to null for failed lookups.
 */
export async function geocodeListings(
  listings: Array<{ listingId: string; address: string; lat?: number; lng?: number }>
): Promise<ListingGeo[]> {
  // Separate those that already have coords from those that need geocoding
  const needGeocode: string[] = [];
  const result: ListingGeo[] = [];

  for (const l of listings) {
    if (l.lat != null && l.lng != null && l.lat !== 0 && l.lng !== 0) {
      result.push({ listingId: l.listingId, address: l.address, lat: l.lat, lng: l.lng });
    } else {
      needGeocode.push(l.address);
    }
  }

  if (needGeocode.length > 0) {
    const geocoded = await batchGeocode(needGeocode);
    
    for (const l of listings) {
      if (l.lat != null && l.lng != null && l.lat !== 0 && l.lng !== 0) continue; // already added
      const geo = geocoded.get(l.address);
      if (geo) {
        result.push({ listingId: l.listingId, address: l.address, lat: geo.lat, lng: geo.lng });
      } else {
        console.warn(`[geoUtils] Failed to geocode: "${l.address}" — listing ${l.listingId} will be excluded from geo-clustering`);
      }
    }
  }

  return result;
}

// ── Travel time between two listings ──

/**
 * Calculate travel estimate between two geocoded listings.
 * Uses OneMap API for accurate walk/drive times.
 * Falls back to Haversine estimation if OneMap fails.
 *
 * Pre-filtering (see `WALK_MAX_KM` / `DRIVE_MAX_KM`): when the two points
 * are so far apart that even a generous road-network multiplier cannot
 * possibly flip the clustering decision, we skip the OneMap call and use
 * the Haversine estimate instead. This keeps OneMap quota focused on the
 * pairs where precision actually matters (candidates for same-cluster).
 */
export async function getTravelEstimate(
  from: ListingGeo,
  to: ListingGeo,
  useOneMap: boolean = true,
): Promise<TravelEstimate> {
  const distanceKm = haversineDistanceKm(
    { lat: from.lat, lng: from.lng },
    { lat: to.lat, lng: to.lng }
  );

  let walkMinutes: number | null = null;
  let driveMinutes: number | null = null;

  // ── walk branch ──
  // Only consult OneMap if the two points are close enough that "same
  // cluster" is even physically possible. Otherwise the Haversine
  // estimate is cheaper AND sufficient — it will confidently say "more
  // than 5 min" so the classifier lands in the drive branch.
  if (useOneMap && distanceKm <= WALK_MAX_KM) {
    walkMinutes = await getWalkingMinutes(from.lat, from.lng, to.lat, to.lng);
  }
  if (walkMinutes === null) {
    walkMinutes = estimateWalkMinutes(distanceKm);
  }

  // ── drive branch ──
  // Only needed if walk is already > threshold (otherwise same-cluster,
  // buffer is 0 and drive time doesn't matter). For very long-distance
  // pairs, skip OneMap drive too; the 15-min buffer granularity swallows
  // Haversine noise at this scale.
  if (walkMinutes > WALK_THRESHOLD_MINUTES) {
    if (useOneMap && distanceKm <= DRIVE_MAX_KM) {
      driveMinutes = await getDrivingMinutes(from.lat, from.lng, to.lat, to.lng);
    }
    if (driveMinutes === null) {
      driveMinutes = estimateDriveMinutes(distanceKm);
    }
  }

  const isSameCluster = walkMinutes <= WALK_THRESHOLD_MINUTES;
  const bufferMinutes = isSameCluster ? 0 : ceilTo15(driveMinutes ?? estimateDriveMinutes(distanceKm));

  return {
    fromListingId: from.listingId,
    toListingId: to.listingId,
    walkMinutes,
    driveMinutes,
    distanceKm,
    isSameCluster,
    bufferMinutes,
  };
}

// ── Geographic Clustering ──

/**
 * Cluster listings by geographic proximity.
 * Two listings are in the same cluster if walk time ≤ 5 minutes.
 * Uses Union-Find for efficient clustering.
 */
export async function clusterListings(
  listings: ListingGeo[],
  useOneMap: boolean = true,
): Promise<ListingGeo[]> {
  if (listings.length <= 1) {
    return listings.map((l, i) => ({ ...l, cluster: `cluster-${i}` }));
  }

  // Union-Find
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    if (!parent.has(id)) parent.set(id, id);
    if (parent.get(id) !== id) parent.set(id, find(parent.get(id)!));
    return parent.get(id)!;
  };
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  // Initialize
  for (const l of listings) {
    parent.set(l.listingId, l.listingId);
  }

  // Compare all pairs
  for (let i = 0; i < listings.length; i++) {
    for (let j = i + 1; j < listings.length; j++) {
      const a = listings[i], b = listings[j];
      
      // Quick Haversine pre-filter: skip if > 1km apart (definitely not walkable in 5 min)
      const dist = haversineDistanceKm({ lat: a.lat, lng: a.lng }, { lat: b.lat, lng: b.lng });
      if (dist > 1.0) continue;

      let walkMin: number;
      if (useOneMap) {
        const result = await getWalkingMinutes(a.lat, a.lng, b.lat, b.lng);
        walkMin = result ?? estimateWalkMinutes(dist);
      } else {
        walkMin = estimateWalkMinutes(dist);
      }

      if (walkMin <= WALK_THRESHOLD_MINUTES) {
        union(a.listingId, b.listingId);
      }
    }
  }

  // Assign cluster labels
  const clusterMap = new Map<string, string>();
  let clusterIdx = 0;
  
  return listings.map(l => {
    const root = find(l.listingId);
    if (!clusterMap.has(root)) {
      clusterMap.set(root, `cluster-${clusterIdx++}`);
    }
    return { ...l, cluster: clusterMap.get(root)! };
  });
}

// ── Build full travel matrix ──

/**
 * Build a travel time matrix between all listing pairs.
 * Returns a Map keyed by "fromId->toId" with TravelEstimate values.
 */
export async function buildTravelMatrix(
  listings: ListingGeo[],
  useOneMap: boolean = true,
): Promise<Map<string, TravelEstimate>> {
  const matrix = new Map<string, TravelEstimate>();

  for (let i = 0; i < listings.length; i++) {
    for (let j = i + 1; j < listings.length; j++) {
      const estimate = await getTravelEstimate(listings[i], listings[j], useOneMap);
      matrix.set(`${listings[i].listingId}->${listings[j].listingId}`, estimate);
      // Also store reverse direction (same distance/time for walk/drive in SG)
      matrix.set(`${listings[j].listingId}->${listings[i].listingId}`, {
        ...estimate,
        fromListingId: listings[j].listingId,
        toListingId: listings[i].listingId,
      });
    }
  }

  return matrix;
}
