/**
 * Persistent geocode cache.
 *
 * Problem:
 *   Every scheduling run re-geocodes every listing's address via OneMap.
 *   7 listings × every Re-run AI scheduling = dozens of redundant Search
 *   API calls, plus latency in the critical path.
 *
 * Solution:
 *   Cache `address → { lat, lng, postalCode, geocodedAt }` keyed by a
 *   NORMALIZED address string so "319A Anchorvale Drive" and
 *   "319A  anchorvale drive" collapse to one lookup.
 *
 * The cache is two-layered:
 *   - in-memory Map  (hot path, no disk IO)
 *   - geocode-cache.json on disk (survives restarts)
 *
 * Entries are keyed by normalized address only — stable across listing
 * re-scrapes. Nothing here depends on a specific PG listingId.
 */

import { readJsonFile, writeJsonFile, clone } from '../store';
import { geocodeAddress, type GeocodedLocation } from './oneMapClient';

const FILENAME = 'geocode-cache.json';

interface CacheEntry {
  lat: number;
  lng: number;
  postalCode?: string;
  building?: string;
  /** Original address we fed to OneMap (for debugging). */
  sourceAddress: string;
  /** Canonical address OneMap returned. */
  resolvedAddress: string;
  /** ISO timestamp. */
  geocodedAt: string;
}

interface CacheFile {
  entries: Record<string, CacheEntry>;
}

const EMPTY: CacheFile = { entries: {} };

let _inMem: Record<string, CacheEntry> | null = null;

function load(): Record<string, CacheEntry> {
  if (_inMem) return _inMem;
  const raw = readJsonFile<CacheFile>(FILENAME, EMPTY);
  _inMem = { ...raw.entries };
  return _inMem;
}

function save(entries: Record<string, CacheEntry>) {
  _inMem = entries;
  writeJsonFile(FILENAME, { entries });
}

/**
 * Normalize an address to a stable cache key.
 * - lowercase
 * - collapse runs of whitespace to a single space
 * - strip leading/trailing whitespace and common trailing punctuation
 */
export function normalizeAddressKey(address: string): string {
  return String(address || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;]+$/g, '')
    .trim();
}

/**
 * Look up the cache for a geocoded location. Does NOT call OneMap.
 */
export function peekGeocode(address: string): GeocodedLocation | null {
  const key = normalizeAddressKey(address);
  if (!key) return null;
  const entries = load();
  const hit = entries[key];
  if (!hit) return null;
  return {
    address: hit.resolvedAddress || hit.sourceAddress,
    lat: hit.lat,
    lng: hit.lng,
    postalCode: hit.postalCode,
    building: hit.building,
  };
}

/**
 * Return geocode result from cache if present; otherwise call OneMap,
 * persist the result, and return it. Null on OneMap failure.
 *
 * Safe to call from many places — `addListingToTourWeb`, the import
 * endpoint, ad-hoc backfills — all funnel through the same cache.
 */
export async function getOrGeocode(address: string): Promise<GeocodedLocation | null> {
  const key = normalizeAddressKey(address);
  if (!key) return null;

  const entries = load();
  if (entries[key]) {
    return {
      address: entries[key].resolvedAddress || entries[key].sourceAddress,
      lat: entries[key].lat,
      lng: entries[key].lng,
      postalCode: entries[key].postalCode,
      building: entries[key].building,
    };
  }

  let result: GeocodedLocation | null = null;
  try {
    result = await geocodeAddress(address);
  } catch (e) {
    console.warn('[geoCache] geocodeAddress threw for', address, (e as Error).message);
    return null;
  }
  if (!result) return null;

  entries[key] = {
    lat: result.lat,
    lng: result.lng,
    postalCode: result.postalCode,
    building: result.building,
    sourceAddress: address,
    resolvedAddress: result.address,
    geocodedAt: new Date().toISOString(),
  };
  save(entries);
  return result;
}

/**
 * Batch variant. Preserves input order; missing entries are filled via
 * OneMap in parallel (capped to 5 concurrent, matching OneMap's batch
 * geocoder).
 *
 * Returns a Map keyed by the ORIGINAL (un-normalized) address so callers
 * can look results up without re-normalizing.
 */
export async function batchGetOrGeocode(addresses: string[]): Promise<Map<string, GeocodedLocation>> {
  const out = new Map<string, GeocodedLocation>();
  const seen = new Set<string>();
  const toFetch: string[] = [];

  // First pass: serve everything we already have cached.
  for (const raw of addresses) {
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    const cached = peekGeocode(raw);
    if (cached) {
      out.set(raw, cached);
    } else {
      toFetch.push(raw);
    }
  }

  if (toFetch.length === 0) return out;

  const BATCH = 5;
  for (let i = 0; i < toFetch.length; i += BATCH) {
    const chunk = toFetch.slice(i, i + BATCH);
    const results = await Promise.all(
      chunk.map(async (addr) => ({ addr, geo: await getOrGeocode(addr) })),
    );
    for (const r of results) {
      if (r.geo) out.set(r.addr, r.geo);
    }
    // Mild delay between batches to be polite to OneMap (same pattern as
    // oneMapClient.batchGeocode).
    if (i + BATCH < toFetch.length) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  return out;
}

/** Introspection helpers — handy for backfill endpoints / debugging. */
export function cacheSize(): number {
  return Object.keys(load()).length;
}

export function dumpCache(): CacheFile {
  return clone({ entries: load() });
}
