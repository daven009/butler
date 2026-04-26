/**
 * PG Listings Repository — persistent storage for PropertyGuru scraped listings.
 *
 * Listings are keyed by `listingId` (the numeric ID from the PG URL).
 * If a listing has no parseable listingId, the URL is used as a fallback key.
 *
 * Storage: backend/data/pg-listings.json
 */

import { readJsonFile, writeJsonFile, clone } from '../store';

/* ─── types ─── */

export interface StoredPgListing {
  /** PG numeric listing ID (primary key) */
  listingId: string;
  /** Full listing URL on PropertyGuru */
  url: string;
  /** ISO timestamp when first scraped */
  scrapedAt: string;
  /** ISO timestamp of most recent update */
  updatedAt: string;
  /** The raw listing object from the scraper */
  data: Record<string, unknown>;
}

interface PgListingsStore {
  listings: StoredPgListing[];
}

const FILENAME = 'pg-listings.json';
const SEED: PgListingsStore = { listings: [] };

/* ─── internal helpers ─── */

function load(): PgListingsStore {
  return readJsonFile<PgListingsStore>(FILENAME, SEED);
}

function save(store: PgListingsStore) {
  writeJsonFile(FILENAME, store);
}

function listingKey(listing: { listingId?: string; url: string }): string {
  return listing.listingId || listing.url;
}

/* ─── public API ─── */

/** Get all stored PG listings */
export function getAllPgListings(): StoredPgListing[] {
  return clone(load().listings);
}

/** Get a single stored listing by its listingId */
export function getPgListingById(id: string): StoredPgListing | undefined {
  return clone(load().listings.find((l) => l.listingId === id));
}

/** Get a set of stored listing IDs for quick lookup */
export function getStoredListingIds(): Set<string> {
  return new Set(load().listings.map((l) => l.listingId));
}

/**
 * Upsert listings into the store.
 * - New listings are inserted.
 * - Existing listings (by listingId) are updated with new data + updatedAt.
 *
 * Returns { inserted: number, updated: number, total: number }
 */
export function upsertPgListings(
  scraped: Array<{ listingId?: string; url: string; [key: string]: unknown }>,
  sourceUrl?: string,
): { inserted: number; updated: number; total: number } {
  const store = load();
  const now = new Date().toISOString();
  const existingMap = new Map(store.listings.map((l) => [l.listingId, l]));

  let inserted = 0;
  let updated = 0;

  for (const raw of scraped) {
    const key = listingKey(raw as { listingId?: string; url: string });
    if (!key) continue;

    const existing = existingMap.get(key);
    if (existing) {
      // Merge: keep original scrapedAt, update data + updatedAt
      existing.data = { ...raw, _sourceUrl: sourceUrl };
      existing.updatedAt = now;
      updated++;
    } else {
      const entry: StoredPgListing = {
        listingId: key,
        url: raw.url,
        scrapedAt: now,
        updatedAt: now,
        data: { ...raw, _sourceUrl: sourceUrl },
      };
      store.listings.push(entry);
      existingMap.set(key, entry);
      inserted++;
    }
  }

  save(store);
  return { inserted, updated, total: store.listings.length };
}

/**
 * Find which listing IDs from a given array are already stored.
 * Returns the set of known IDs.
 */
export function findExistingListingIds(ids: string[]): Set<string> {
  const stored = getStoredListingIds();
  return new Set(ids.filter((id) => stored.has(id)));
}

/**
 * Get stored listings by an array of listingIds.
 * Returns the full listing data for each found ID.
 */
export function getPgListingsByIds(ids: string[]): StoredPgListing[] {
  const store = load();
  const idSet = new Set(ids);
  return clone(store.listings.filter((l) => idSet.has(l.listingId)));
}
