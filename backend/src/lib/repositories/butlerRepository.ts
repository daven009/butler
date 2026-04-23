import { randomUUID } from 'node:crypto';
import type { CoordinationEvent, Tour } from '../types';
import { catalogListings, type CatalogListing } from '../butlerCatalog';
import { clone, readJsonFile, writeJsonFile } from '../store';
import {
  addCoordinationEvent,
  deleteListing,
  getTourById,
  listTours,
  replaceSchedule,
  updateListingStatus,
  updateTourBasics
} from './toursRepository';

export interface ThreadRecord {
  id: string;
  tourId: string;
  listingId: string;
  ownership: 'AI' | 'HUMAN';
}

export interface InboxItem {
  id: string;
  icon: string;
  tone: 'red' | 'green' | 'amber' | 'default';
  title: string;
  sub: string;
  target?: string;
  read: boolean;
  createdAt: string;
}

export interface ItineraryShareRecord {
  id: string;
  tourId: string;
  sentAt: string;
  channel: string;
}

interface ButlerState {
  threads: ThreadRecord[];
  inbox: InboxItem[];
  shares: ItineraryShareRecord[];
}

const DEFAULT_STATE: ButlerState = {
  threads: [
    { id: 'thread-1001', tourId: 'tour-1001', listingId: 'listing-101', ownership: 'AI' },
    { id: 'thread-1002', tourId: 'tour-1001', listingId: 'listing-102', ownership: 'AI' },
    { id: 'thread-2001', tourId: 'tour-1002', listingId: 'listing-201', ownership: 'AI' }
  ],
  inbox: [],
  shares: []
};

function readState() {
  return readJsonFile<ButlerState>('butler.json', DEFAULT_STATE);
}

function writeState(state: ButlerState) {
  writeJsonFile('butler.json', state);
}

function nextId(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function ensureThread(tourId: string, listingId: string) {
  const state = readState();
  let thread = state.threads.find((item) => item.tourId === tourId && item.listingId === listingId);
  if (!thread) {
    thread = { id: nextId('thread'), tourId, listingId, ownership: 'AI' };
    state.threads.push(thread);
    writeState(state);
  }
  return thread;
}

function listThreadStateForTour(tourId: string) {
  return readState().threads.filter((thread) => thread.tourId === tourId);
}

function getListing(tour: Tour, listingId: string) {
  return tour.listings.find((listing) => listing.id === listingId);
}

function humanTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('en-SG', {
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric'
  });
}

function threadStatus(tour: Tour, listingId: string) {
  const exception = tour.exceptions.find((item) => item.listingId === listingId && !item.resolved);
  if (exception) return 'exception';
  const scheduleItem = tour.schedule.find((item) => item.listingId === listingId);
  if (scheduleItem) return 'confirmed';
  return 'pending';
}

function scheduledTime(tour: Tour, listingId: string) {
  const scheduleItem = tour.schedule.find((item) => item.listingId === listingId);
  if (!scheduleItem) return '';
  const date = new Date(scheduleItem.startAt);
  return date.toLocaleString('en-SG', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

function convertMessage(event: CoordinationEvent, ownership: 'AI' | 'HUMAN') {
  let from = 'system';
  if (event.senderRole === 'OPPOSING_AGENT') from = 'them';
  if (event.senderRole === 'BUYER_AGENT') from = ownership === 'AI' ? 'ai' : 'you';
  return {
    id: event.id,
    from,
    text: event.body || event.summary || 'Update recorded',
    ts: humanTime(event.occurredAt)
  };
}

export function listThreads(tourId: string) {
  const tour = getTourById(tourId);
  if (!tour) return undefined;

  return tour.listings.map((listing) => {
    const thread = ensureThread(tourId, listing.id);
    const events = tour.coordinationEvents
      .filter((event) => event.listingId === listing.id)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
    const lastEvent = events[events.length - 1];
    return {
      id: thread.id,
      listingId: listing.id,
      agentName: listing.opposingAgentName,
      agentPhone: listing.opposingAgentPhone,
      listingTitle: listing.title,
      status: threadStatus(tour, listing.id),
      ownership: thread.ownership,
      lastMessage: lastEvent?.body || lastEvent?.summary || `Awaiting update for ${listing.title}`,
      lastMessageAt: lastEvent?.occurredAt || tour.updatedAt,
      scheduledTime: scheduledTime(tour, listing.id)
    };
  });
}

export function getThread(tourId: string, threadId: string) {
  const threads = listThreads(tourId);
  return threads?.find((thread) => thread.id === threadId);
}

export function listThreadMessages(tourId: string, threadId: string) {
  const thread = getThread(tourId, threadId);
  const tour = getTourById(tourId);
  if (!thread || !tour) return undefined;

  const listing = getListing(tour, thread.listingId);
  const events = tour.coordinationEvents
    .filter((event) => event.listingId === thread.listingId)
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));

  if (events.length === 0 && listing) {
    return [
      {
        id: `${thread.id}-seed-1`,
        from: 'ai',
        text: `Hi ${listing.opposingAgentName}, Butler is helping coordinate a viewing for ${listing.title}. Is the unit still available?`,
        ts: humanTime(tour.updatedAt)
      }
    ];
  }

  return events.map((event) => convertMessage(event, thread.ownership));
}

export function postThreadMessage(tourId: string, threadId: string, text: string) {
  const thread = getThread(tourId, threadId);
  if (!thread) return undefined;
  addCoordinationEvent(tourId, thread.listingId, {
    kind: 'MESSAGE',
    senderRole: 'BUYER_AGENT',
    source: 'MANUAL',
    body: text,
    summary: text
  });
  return listThreadMessages(tourId, threadId);
}

export function updateThreadOwnership(tourId: string, threadId: string, ownership: 'AI' | 'HUMAN') {
  const state = readState();
  const thread = state.threads.find((item) => item.id === threadId && item.tourId === tourId);
  if (!thread) return undefined;
  thread.ownership = ownership;
  writeState(state);
  return getThread(tourId, threadId);
}

export function listExceptions(tourId: string) {
  const tour = getTourById(tourId);
  if (!tour) return undefined;
  return clone(tour.exceptions);
}

export function getExceptionById(tourId: string, exceptionId: string) {
  return listExceptions(tourId)?.find((item) => item.id === exceptionId);
}

export function resolveException(tourId: string, exceptionId: string, action: 'SQUEEZE_IN' | 'REPROPOSE' | 'DROP_LISTING') {
  const tour = getTourById(tourId);
  if (!tour) return undefined;
  const exception = tour.exceptions.find((item) => item.id === exceptionId);
  if (!exception) return undefined;

  let resultTour = tour;

  if (action === 'DROP_LISTING' && exception.listingId) {
    const deleted = deleteListing(tourId, exception.listingId);
    if (deleted) resultTour = deleted.tour;
  }

  if (action === 'REPROPOSE' && exception.listingId) {
    addCoordinationEvent(tourId, exception.listingId, {
      kind: 'HANDOFF',
      senderRole: 'BUYER_AGENT',
      source: 'SYSTEM',
      summary: 'Butler will repropose new times to the opposing agent.'
    });
  }

  if (action === 'SQUEEZE_IN' && exception.listingId) {
    const refreshed = getTourById(tourId);
    const schedule = clone(refreshed?.schedule || []);
    const listingSchedule = schedule.find((item) => item.listingId === exception.listingId);
    if (!listingSchedule) {
      const targetDate = refreshed?.targetDate || new Date().toISOString().slice(0, 10);
      schedule.push({
        id: nextId('schedule'),
        listingId: exception.listingId,
        startAt: `${targetDate}T14:00:00+08:00`,
        endAt: `${targetDate}T14:30:00+08:00`,
        travelBufferMinutes: 15,
        status: 'PROPOSED'
      });
      replaceSchedule(tourId, schedule);
    }
    updateListingStatus(tourId, exception.listingId, { status: 'SCHEDULED' });
  }

  const afterAction = getTourById(tourId);
  if (!afterAction) return undefined;

  const nextExceptions = afterAction.exceptions.map((item) => (
    item.id === exceptionId ? { ...item, resolved: true } : item
  ));
  updateTourBasics(tourId, {});
  const latest = getTourById(tourId);
  if (!latest) return undefined;
  latest.exceptions = nextExceptions;
  writeJsonFile('tours.json', { tours: listTours().map((tourItem) => (
    tourItem.id === latest.id ? { ...latest, exceptions: nextExceptions } : tourItem
  )) });

  return {
    action,
    exception: nextExceptions.find((item) => item.id === exceptionId),
    tour: getTourById(tourId)
  };
}

export function buildCalendar(month: string) {
  const tours = listTours();
  const items = tours.flatMap((tour) => tour.schedule.map((scheduleItem) => {
    const listing = getListing(tour, scheduleItem.listingId);
    return {
      id: scheduleItem.id,
      date: scheduleItem.startAt.slice(0, 10),
      time: new Date(scheduleItem.startAt).toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit' }),
      buyer: tour.buyerName,
      title: listing?.title || 'Viewing',
      detail: `${listing?.address || ''} · ${listing?.opposingAgentName || ''}`.replace(/^ · | · $/g, ''),
      tone: scheduleItem.status === 'LOCKED' ? 'confirmed' : 'pending',
      tourId: tour.id
    };
  }));

  return {
    month,
    items: items.filter((item) => item.date.startsWith(month))
  };
}

export function buildCalendarDay(date: string) {
  return {
    date,
    items: buildCalendar(date.slice(0, 7)).items.filter((item) => item.date === date)
  };
}

export function getItinerary(tourId: string) {
  const tour = getTourById(tourId);
  if (!tour) return undefined;

  const stops = tour.schedule
    .slice()
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .map((item, index, list) => {
      const listing = getListing(tour, item.listingId);
      const next = list[index + 1];
      return {
        id: item.id,
        startAt: item.startAt,
        endAt: item.endAt,
        time: new Date(item.startAt).toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit' }),
        ampm: new Date(item.startAt).toLocaleTimeString('en-SG', { hour: 'numeric', hour12: true }).includes('PM') ? 'PM' : 'AM',
        address: listing?.title || 'Viewing',
        unit: listing?.address || '',
        agent: listing?.opposingAgentName || '',
        tags: [listing?.district, listing?.status].filter(Boolean),
        transit: next ? `${next.travelBufferMinutes || item.travelBufferMinutes} min buffer` : ''
      };
    });

  return {
    tourId,
    buyerName: tour.buyerName,
    subtitle: `${tour.listings.length} viewings · ${tour.neighborhoods.length} neighbourhoods`,
    stops
  };
}

export function recordItineraryShare(tourId: string, channel = 'WHATSAPP') {
  const state = readState();
  const share = {
    id: nextId('share'),
    tourId,
    sentAt: new Date().toISOString(),
    channel
  };
  state.shares.unshift(share);
  writeState(state);
  return share;
}

export function buildExportStub(tourId: string) {
  return {
    tourId,
    downloadUrl: `/exports/${tourId}.pdf`,
    status: 'stub'
  };
}

export function buildInbox() {
  const state = readState();
  const tours = listTours();
  const items: InboxItem[] = [];

  tours.forEach((tour) => {
    tour.exceptions.filter((exception) => !exception.resolved).forEach((exception) => {
      items.push({
        id: exception.id,
        icon: '⚠️',
        tone: 'red',
        title: `${exception.title}`,
        sub: `${tour.buyerName} · ${exception.detail}`,
        target: 'decision',
        read: false,
        createdAt: tour.updatedAt
      });
    });

    tour.schedule.forEach((item) => {
      const listing = getListing(tour, item.listingId);
      items.push({
        id: `${item.id}-confirmed`,
        icon: '✓',
        tone: 'green',
        title: `${listing?.opposingAgentName || 'Agent'} confirmed ${new Date(item.startAt).toLocaleTimeString('en-SG', { hour: 'numeric', minute: '2-digit' })}`,
        sub: `${listing?.title || 'Viewing'} · ${tour.buyerName}`,
        read: false,
        createdAt: item.startAt
      });
    });
  });

  listTours().forEach((tour) => {
    listThreadStateForTour(tour.id).forEach((thread) => {
      if (thread.ownership === 'HUMAN') {
        const listing = getListing(tour, thread.listingId);
        items.push({
          id: `${thread.id}-handoff`,
          icon: '💬',
          tone: 'amber',
          title: `${listing?.opposingAgentName || 'Agent'} needs manual follow-up`,
          sub: `${listing?.title || 'Listing'} · handoff to you`,
          target: 'chat',
          read: false,
          createdAt: tour.updatedAt
        });
      }
    });
  });

  const merged = [...items, ...state.inbox]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 20);

  return clone(merged);
}

export function markInboxItemRead(itemId: string) {
  const state = readState();
  const current = buildInbox();
  const next = current.map((item) => item.id === itemId ? { ...item, read: true } : item);
  state.inbox = next;
  writeState(state);
  return next.find((item) => item.id === itemId);
}

function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function createTag(partial: Record<string, unknown>) {
  return {
    id: makeId('tag'),
    ...partial
  };
}

const LOCATION_CATALOG = ['Bishan', 'Tampines', 'Bedok', 'Queenstown', 'one-north'];
const SCHOOL_CATALOG = ['Nanyang Primary 1km', 'Angsana Primary 1km'];

export function parseSearchInput(rawText: string, source: 'voice' | 'text' | 'url' = 'text') {
  const text = rawText.trim();
  const lower = text.toLowerCase();
  let tags: any[] = [];

  if (/\bhdb\b/i.test(text)) tags.push(createTag({ label: 'HDB', groupKey: 'propertyType', groupLabel: 'Property type', mergeStrategy: 'union', kind: 'propertyType', value: 'hdb', source }));
  if (/\bcondo\b|\bcondominium\b/i.test(text)) tags.push(createTag({ label: 'Condo', groupKey: 'propertyType', groupLabel: 'Property type', mergeStrategy: 'union', kind: 'propertyType', value: 'condo', source }));
  if (/\blanded\b/i.test(text)) tags.push(createTag({ label: 'Landed', groupKey: 'propertyType', groupLabel: 'Property type', mergeStrategy: 'union', kind: 'propertyType', value: 'landed', source }));

  const bedroomMatch = text.match(/(\d)\s*(?:-|\s)?(?:bed(?:room)?s?|br|rooms?)/i);
  if (bedroomMatch) tags.push(createTag({ label: `${bedroomMatch[1]} Rooms`, groupKey: 'bedroom', groupLabel: 'Bedrooms', mergeStrategy: 'replace', kind: 'bedroom', value: Number(bedroomMatch[1]), source }));

  const budgetMatch = text.match(/(?:budget(?:\s+around|\s+under|\s+below)?|under|below|around|max)?\s*(?:s\$|\$)\s*([\d,]{4,6})/i);
  if (budgetMatch) {
    const amount = Number(budgetMatch[1].replace(/,/g, ''));
    tags.push(createTag({ label: `$${amount.toLocaleString('en-SG')}/mo`, groupKey: 'budget', groupLabel: 'Budget', mergeStrategy: 'replace', kind: 'budgetMax', value: amount, source }));
  }

  SCHOOL_CATALOG.forEach((school) => {
    const base = school.replace(' 1km', '').toLowerCase();
    if (lower.includes(base)) tags.push(createTag({ label: school, groupKey: 'school', groupLabel: 'School zone', mergeStrategy: 'union', kind: 'school', value: school.toLowerCase(), source }));
  });

  LOCATION_CATALOG.forEach((location) => {
    const normalized = location.toLowerCase();
    if (!lower.includes(normalized) || normalized === 'one-north') return;
    const nearMrt = lower.includes(`near ${normalized} mrt`) || lower.includes(`${normalized} mrt`);
    tags.push(createTag({ label: nearMrt ? `Near ${location} MRT` : location, groupKey: 'location', groupLabel: 'Location', mergeStrategy: 'union', kind: 'location', value: normalized, source }));
  });

  if (/pet[-\s]?friendly|pets?\s+(?:ok|okay)|small dog|dog friendly|dog ok/i.test(text)) {
    tags.push(createTag({ label: 'Pet Friendly', groupKey: 'petFriendly', groupLabel: 'Pets', mergeStrategy: 'replace', kind: 'boolean', field: 'petFriendly', value: true, source }));
  }

  const commuteMatch = text.match(/within\s+(\d{1,2})\s*min(?:ute)?s?\s*(?:drive|travel)?\s*(?:to|from)\s+([a-z0-9-\s]+)/i);
  if (commuteMatch) {
    const target = commuteMatch[2].trim().replace(/\.$/, '').toLowerCase().replace(/\s+/g, ' ');
    tags.push(createTag({ label: `${commuteMatch[1]} min drive to ${target}`, groupKey: 'commuteTime', groupLabel: 'Commute', mergeStrategy: 'replace', kind: 'commuteMax', value: Number(commuteMatch[1]), source, target }));
  }

  return clone(tags);
}

export function importPropertyLink(url: string) {
  const normalized = decodeURIComponent(url).toLowerCase();
  const listing = catalogListings.find((candidate) => (
    normalized.includes(candidate.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')) ||
    normalized.includes(candidate.area.toLowerCase()) ||
    normalized.includes(candidate.mrtStation.toLowerCase())
  )) || catalogListings[0];

  return {
    kind: normalized.includes('?') || normalized.includes('property-for-rent') ? 'search' : 'listing',
    listing,
    tags: parseSearchInput(normalized.replace(/[?&=_-]/g, ' '), 'url')
  };
}

function tagMatchesListing(tag: any, listing: CatalogListing) {
  switch (tag.kind) {
    case 'propertyType': return listing.propertyType.toLowerCase() === tag.value;
    case 'bedroom': return listing.bedrooms === tag.value;
    case 'budgetMax': return listing.priceValue <= tag.value;
    case 'location': return listing.area.toLowerCase() === tag.value || listing.mrtStation.toLowerCase() === tag.value;
    case 'school': return listing.schoolZones.some((zone) => zone.toLowerCase() === tag.value);
    case 'boolean': return Boolean((listing as any)[tag.field]) === tag.value;
    case 'commuteMax': return (listing.commuteDrive?.[tag.target] ?? Number.POSITIVE_INFINITY) <= tag.value;
    default: return true;
  }
}

export function searchCatalog(tags: any[], pinnedIds: string[] = []) {
  const pinned = new Set(pinnedIds);
  const groupedTags = tags.reduce((acc: Record<string, any[]>, tag: any) => {
    acc[tag.groupKey] = acc[tag.groupKey] || [];
    acc[tag.groupKey].push(tag);
    return acc;
  }, {});

  return catalogListings.map((listing) => {
    const matchedLabels: string[] = [];
    let passes = true;
    Object.values(groupedTags).forEach((group: any) => {
      if (!passes) return;
      if (group[0].mergeStrategy === 'union') {
        const hits = group.filter((tag: any) => tagMatchesListing(tag, listing));
        if (!hits.length) {
          passes = false;
          return;
        }
        matchedLabels.push(hits[0].label);
        return;
      }

      if (!tagMatchesListing(group[0], listing)) {
        passes = false;
        return;
      }
      matchedLabels.push(group[0].label);
    });

    if (!passes && !pinned.has(listing.id)) return null;
    const baseScore = tags.length ? Math.round((matchedLabels.length / tags.length) * 100) : 72;
    return {
      ...listing,
      pinned: pinned.has(listing.id),
      score: Math.min(99, baseScore + (pinned.has(listing.id) ? 8 : 0)),
      matchedLabels,
      reason: matchedLabels.slice(0, 2).join(' · ') || 'Added directly from link'
    };
  }).filter(Boolean).sort((a: any, b: any) => b.score - a.score || a.priceValue - b.priceValue);
}
