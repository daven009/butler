import type { Listing } from '../repositories/plansRepository';

function isPendingTime(value?: string | null): boolean {
  return !value || value.toLowerCase() === 'pending';
}

export function sortListingsForScheduleView(listings: Listing[]): Listing[] {
  return listings
    .map((listing, index) => ({ listing, index }))
    .sort((a, b) => {
      const aScheduled = a.listing.status === 'confirmed' && !isPendingTime(a.listing.suggestedTime);
      const bScheduled = b.listing.status === 'confirmed' && !isPendingTime(b.listing.suggestedTime);
      if (aScheduled && bScheduled) {
        const byTime = (a.listing.suggestedTime ?? '').localeCompare(b.listing.suggestedTime ?? '');
        if (byTime !== 0) return byTime;
      }
      if (aScheduled !== bScheduled) return aScheduled ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ listing }) => listing);
}

export function listingNumberById(listings: Listing[]): Map<string, number> {
  const sorted = sortListingsForScheduleView(listings);
  return new Map(sorted.map((listing, index) => [listing.id, index + 1]));
}

export function listingRef(listing: Listing, listings: Listing[]): string {
  return `#${listingNumberById(listings).get(listing.id) ?? '?'}`;
}

function parseVisibleListingNumber(value: string): number | undefined {
  const trimmed = value.trim();
  const direct = /^#\s*(\d+)$/.exec(trimmed);
  if (direct) return Number(direct[1]);
  const prefixed = /^(?:listing|房源|第)\s*#?\s*(\d+)\s*(?:号|号房源)?$/i.exec(trimmed);
  if (prefixed) return Number(prefixed[1]);
  const suffixed = /^#?\s*(\d+)\s*(?:号房源|号)$/i.exec(trimmed);
  if (suffixed) return Number(suffixed[1]);
  return undefined;
}

export function findListingByReference(listings: Listing[], needle: string): Listing | undefined {
  const byId = listings.find((l) => l.id === needle);
  if (byId) return byId;

  const visibleNumber = parseVisibleListingNumber(needle);
  if (visibleNumber && visibleNumber > 0) {
    return sortListingsForScheduleView(listings)[visibleNumber - 1];
  }

  const lc = needle.toLowerCase();
  return listings.find(
    (l) => l.title.toLowerCase().includes(lc) || l.condo.toLowerCase().includes(lc),
  );
}
