import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { tours as seededTours, summarizeTour } from '../mockData';
import type {
  BuyerAvailability,
  CreateBuyerAvailabilityInput,
  CreateCoordinationEventInput,
  CreateListingInput,
  CreateOpposingAgentAvailabilityInput,
  CreateTourInput,
  CoordinationEvent,
  GenerateScheduleInput,
  OpposingAgentAvailability,
  ReplaceOpposingAgentAvailabilityInput,
  ScheduleGenerationResult,
  ScheduleItem,
  Tour,
  TourListing,
  TourSummary,
  UpdateBuyerAvailabilityInput,
  UpdateCoordinationEventInput,
  UpdateListingInput,
  UpdateListingStatusInput,
  UpdateOpposingAgentAvailabilityInput,
  UpdateTourInput
} from '../types';
import { generateSchedulePlan } from '../scheduling/scheduler';

interface ToursState {
  tours: Tour[];
}

interface ListingMutationResult {
  tour: Tour;
  listing: TourListing;
}

interface ListingDeleteResult {
  tour: Tour;
  deletedListingId: string;
}

interface BuyerAvailabilityMutationResult {
  tour: Tour;
  buyerAvailability: BuyerAvailability;
}

interface BuyerAvailabilityReplaceResult {
  tour: Tour;
  buyerAvailability: BuyerAvailability[];
}

interface BuyerAvailabilityDeleteResult {
  tour: Tour;
  deletedBuyerAvailabilityId: string;
}

interface OpposingAvailabilityMutationResult {
  tour: Tour;
  opposingAgentAvailability: OpposingAgentAvailability;
}

interface OpposingAvailabilityReplaceResult {
  tour: Tour;
  opposingAgentAvailability: OpposingAgentAvailability[];
}

interface OpposingAvailabilityDeleteResult {
  tour: Tour;
  deletedOpposingAgentAvailabilityId: string;
}

interface CoordinationEventMutationResult {
  tour: Tour;
  coordinationEvent: CoordinationEvent;
}

interface CoordinationEventDeleteResult {
  tour: Tour;
  deletedCoordinationEventId: string;
}

interface ScheduleReplaceResult {
  tour: Tour;
  schedule: ScheduleItem[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFilePath = path.resolve(__dirname, '../../../data/tours.json');

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value));
}

function ensureDataFile() {
  if (fs.existsSync(dataFilePath)) return;
  fs.mkdirSync(path.dirname(dataFilePath), { recursive: true });
  writeState({ tours: clone(seededTours) });
}

function readState(): ToursState {
  ensureDataFile();
  const raw = fs.readFileSync(dataFilePath, 'utf8');
  const parsed = JSON.parse(raw) as ToursState;
  return {
    tours: parsed.tours.map(normalizeTour)
  };
}

function writeState(state: ToursState) {
  fs.mkdirSync(path.dirname(dataFilePath), { recursive: true });
  fs.writeFileSync(dataFilePath, `${JSON.stringify(state, null, 2)}\n`);
}

function saveWithTour(state: ToursState, tour: Tour): Tour {
  const index = state.tours.findIndex((candidate) => candidate.id === tour.id);
  if (index === -1) {
    state.tours.unshift(tour);
  } else {
    state.tours[index] = tour;
  }

  writeState(state);
  return clone(tour);
}

function nextId(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function defaultAgent() {
  return clone(seededTours[0].agent);
}

function normalizeTour(tour: Tour): Tour {
  return {
    ...tour,
    listings: tour.listings || [],
    buyerAvailability: tour.buyerAvailability || [],
    opposingAgentAvailability: tour.opposingAgentAvailability || [],
    coordinationEvents: tour.coordinationEvents || [],
    schedule: tour.schedule || [],
    exceptions: tour.exceptions || []
  };
}

export function resetToursRepositoryForDevelopment(): Tour[] {
  const state = { tours: clone(seededTours) };
  writeState(state);
  return clone(state.tours);
}

export function listTourSummaries(): TourSummary[] {
  return readState().tours.map(summarizeTour);
}

export function listTours(): Tour[] {
  return clone(readState().tours);
}

export function getTourById(id: string): Tour | undefined {
  return clone(readState().tours.find((tour) => tour.id === id));
}

function findTourInState(state: ToursState, tourId: string) {
  return state.tours.find((candidate) => candidate.id === tourId);
}

function findListingInTour(tour: Tour, listingId: string) {
  return tour.listings.find((candidate) => candidate.id === listingId);
}

export function createTour(input: CreateTourInput): Tour {
  const state = readState();
  const now = new Date().toISOString();
  const tour: Tour = {
    id: nextId('tour'),
    buyerName: input.buyerName,
    buyerPhone: input.buyerPhone || '',
    agent: defaultAgent(),
    status: 'DRAFT',
    targetDate: input.targetDate,
    neighborhoods: input.neighborhoods || [],
    nextAction: input.nextAction || 'Add buyer availability and shortlisted listings',
    listings: [],
    buyerAvailability: [],
    opposingAgentAvailability: [],
    coordinationEvents: [],
    schedule: [],
    exceptions: [],
    createdAt: now,
    updatedAt: now
  };

  state.tours.unshift(tour);
  writeState(state);
  return clone(tour);
}

export function updateTourBasics(id: string, input: UpdateTourInput): Tour | undefined {
  const state = readState();
  const existing = state.tours.find((tour) => tour.id === id);
  if (!existing) return undefined;

  const next: Tour = {
    ...existing,
    ...input,
    updatedAt: new Date().toISOString()
  };

  return saveWithTour(state, next);
}

export function addListingToTour(tourId: string, input: CreateListingInput): ListingMutationResult | undefined {
  const state = readState();
  const tour = findTourInState(state, tourId);
  if (!tour) return undefined;

  const listing: TourListing = {
    id: nextId('listing'),
    title: input.title,
    address: input.address,
    district: input.district || '',
    askingPrice: input.askingPrice,
    bedrooms: input.bedrooms,
    bathrooms: input.bathrooms,
    status: input.status || 'NOT_CONTACTED',
    opposingAgentName: input.opposingAgentName,
    opposingAgentPhone: input.opposingAgentPhone,
    notes: input.notes
  };

  const updatedTour: Tour = {
    ...tour,
    listings: [...tour.listings, listing],
    updatedAt: new Date().toISOString()
  };

  const savedTour = saveWithTour(state, updatedTour);
  return {
    tour: savedTour,
    listing: clone(listing)
  };
}

export function updateListing(
  tourId: string,
  listingId: string,
  input: UpdateListingInput
): ListingMutationResult | undefined {
  const state = readState();
  const tour = findTourInState(state, tourId);
  if (!tour) return undefined;

  const listing = tour.listings.find((candidate) => candidate.id === listingId);
  if (!listing) return undefined;

  const updatedListing: TourListing = {
    ...listing,
    ...input
  };

  const updatedTour: Tour = {
    ...tour,
    listings: tour.listings.map((candidate) => (
      candidate.id === listingId ? updatedListing : candidate
    )),
    updatedAt: new Date().toISOString()
  };

  const savedTour = saveWithTour(state, updatedTour);
  return {
    tour: savedTour,
    listing: clone(updatedListing)
  };
}

export function deleteListing(tourId: string, listingId: string): ListingDeleteResult | undefined {
  const state = readState();
  const tour = findTourInState(state, tourId);
  if (!tour) return undefined;

  const listingExists = tour.listings.some((candidate) => candidate.id === listingId);
  if (!listingExists) return undefined;

  const updatedTour: Tour = {
    ...tour,
    listings: tour.listings.filter((candidate) => candidate.id !== listingId),
    opposingAgentAvailability: tour.opposingAgentAvailability.filter((item) => item.listingId !== listingId),
    coordinationEvents: tour.coordinationEvents.filter((item) => item.listingId !== listingId),
    schedule: tour.schedule.filter((item) => item.listingId !== listingId),
    exceptions: tour.exceptions.filter((item) => item.listingId !== listingId),
    updatedAt: new Date().toISOString()
  };

  const savedTour = saveWithTour(state, updatedTour);
  return {
    tour: savedTour,
    deletedListingId: listingId
  };
}

export function tourExists(id: string): boolean {
  return Boolean(readState().tours.some((tour) => tour.id === id));
}

function toBuyerAvailability(input: CreateBuyerAvailabilityInput): BuyerAvailability {
  return {
    id: nextId('buyer-availability'),
    date: input.date,
    startTime: input.startTime,
    endTime: input.endTime,
    preference: input.preference || 'AVAILABLE',
    note: input.note
  };
}

export function listBuyerAvailability(tourId: string): BuyerAvailability[] | undefined {
  const tour = getTourById(tourId);
  if (!tour) return undefined;
  return clone(tour.buyerAvailability);
}

export function addBuyerAvailability(
  tourId: string,
  input: CreateBuyerAvailabilityInput
): BuyerAvailabilityMutationResult | undefined {
  const state = readState();
  const tour = findTourInState(state, tourId);
  if (!tour) return undefined;

  const buyerAvailability = toBuyerAvailability(input);
  const updatedTour: Tour = {
    ...tour,
    buyerAvailability: [...tour.buyerAvailability, buyerAvailability],
    updatedAt: new Date().toISOString()
  };

  const savedTour = saveWithTour(state, updatedTour);
  return {
    tour: savedTour,
    buyerAvailability: clone(buyerAvailability)
  };
}

export function updateBuyerAvailability(
  tourId: string,
  availabilityId: string,
  input: UpdateBuyerAvailabilityInput
): BuyerAvailabilityMutationResult | undefined {
  const state = readState();
  const tour = findTourInState(state, tourId);
  if (!tour) return undefined;

  const existing = tour.buyerAvailability.find((item) => item.id === availabilityId);
  if (!existing) return undefined;

  const updatedBuyerAvailability: BuyerAvailability = {
    ...existing,
    ...input
  };

  const updatedTour: Tour = {
    ...tour,
    buyerAvailability: tour.buyerAvailability.map((item) => (
      item.id === availabilityId ? updatedBuyerAvailability : item
    )),
    updatedAt: new Date().toISOString()
  };

  const savedTour = saveWithTour(state, updatedTour);
  return {
    tour: savedTour,
    buyerAvailability: clone(updatedBuyerAvailability)
  };
}

export function deleteBuyerAvailability(
  tourId: string,
  availabilityId: string
): BuyerAvailabilityDeleteResult | undefined {
  const state = readState();
  const tour = findTourInState(state, tourId);
  if (!tour) return undefined;

  const exists = tour.buyerAvailability.some((item) => item.id === availabilityId);
  if (!exists) return undefined;

  const updatedTour: Tour = {
    ...tour,
    buyerAvailability: tour.buyerAvailability.filter((item) => item.id !== availabilityId),
    updatedAt: new Date().toISOString()
  };

  const savedTour = saveWithTour(state, updatedTour);
  return {
    tour: savedTour,
    deletedBuyerAvailabilityId: availabilityId
  };
}

export function replaceBuyerAvailability(
  tourId: string,
  inputs: CreateBuyerAvailabilityInput[]
): BuyerAvailabilityReplaceResult | undefined {
  const state = readState();
  const tour = findTourInState(state, tourId);
  if (!tour) return undefined;

  const buyerAvailability = inputs.map(toBuyerAvailability);
  const updatedTour: Tour = {
    ...tour,
    buyerAvailability,
    updatedAt: new Date().toISOString()
  };

  const savedTour = saveWithTour(state, updatedTour);
  return {
    tour: savedTour,
    buyerAvailability: clone(buyerAvailability)
  };
}

function toOpposingAgentAvailability(
  listing: TourListing,
  input: CreateOpposingAgentAvailabilityInput
): OpposingAgentAvailability {
  return {
    id: nextId('opposing-availability'),
    listingId: listing.id,
    agentName: input.agentName || listing.opposingAgentName,
    slots: clone(input.slots),
    lastUpdatedAt: new Date().toISOString(),
    source: input.source || 'MANUAL'
  };
}

function maybeMarkSlotsReceived(listing: TourListing): TourListing {
  if (listing.status !== 'NOT_CONTACTED' && listing.status !== 'WAITING_REPLY') return listing;
  return {
    ...listing,
    status: 'AVAILABLE_SLOTS_RECEIVED'
  };
}

export function listOpposingAgentAvailability(
  tourId: string,
  listingId: string
): OpposingAgentAvailability[] | undefined {
  const tour = getTourById(tourId);
  if (!tour) return undefined;
  if (!findListingInTour(tour, listingId)) return undefined;

  return clone(tour.opposingAgentAvailability.filter((item) => item.listingId === listingId));
}

export function addOpposingAgentAvailability(
  tourId: string,
  listingId: string,
  input: CreateOpposingAgentAvailabilityInput
): OpposingAvailabilityMutationResult | undefined {
  const state = readState();
  const tour = findTourInState(state, tourId);
  if (!tour) return undefined;

  const listing = findListingInTour(tour, listingId);
  if (!listing) return undefined;

  const opposingAgentAvailability = toOpposingAgentAvailability(listing, input);
  const updatedListing = maybeMarkSlotsReceived(listing);
  const updatedTour: Tour = {
    ...tour,
    listings: tour.listings.map((candidate) => (
      candidate.id === listingId ? updatedListing : candidate
    )),
    opposingAgentAvailability: [...tour.opposingAgentAvailability, opposingAgentAvailability],
    updatedAt: new Date().toISOString()
  };

  const savedTour = saveWithTour(state, updatedTour);
  return {
    tour: savedTour,
    opposingAgentAvailability: clone(opposingAgentAvailability)
  };
}

export function updateOpposingAgentAvailability(
  tourId: string,
  listingId: string,
  availabilityId: string,
  input: UpdateOpposingAgentAvailabilityInput
): OpposingAvailabilityMutationResult | undefined {
  const state = readState();
  const tour = findTourInState(state, tourId);
  if (!tour) return undefined;

  if (!findListingInTour(tour, listingId)) return undefined;

  const existing = tour.opposingAgentAvailability.find((item) => (
    item.id === availabilityId && item.listingId === listingId
  ));
  if (!existing) return undefined;

  const opposingAgentAvailability: OpposingAgentAvailability = {
    ...existing,
    ...input,
    lastUpdatedAt: new Date().toISOString()
  };

  const updatedTour: Tour = {
    ...tour,
    opposingAgentAvailability: tour.opposingAgentAvailability.map((item) => (
      item.id === availabilityId && item.listingId === listingId ? opposingAgentAvailability : item
    )),
    updatedAt: new Date().toISOString()
  };

  const savedTour = saveWithTour(state, updatedTour);
  return {
    tour: savedTour,
    opposingAgentAvailability: clone(opposingAgentAvailability)
  };
}

export function deleteOpposingAgentAvailability(
  tourId: string,
  listingId: string,
  availabilityId: string
): OpposingAvailabilityDeleteResult | undefined {
  const state = readState();
  const tour = findTourInState(state, tourId);
  if (!tour) return undefined;

  if (!findListingInTour(tour, listingId)) return undefined;

  const exists = tour.opposingAgentAvailability.some((item) => (
    item.id === availabilityId && item.listingId === listingId
  ));
  if (!exists) return undefined;

  const updatedTour: Tour = {
    ...tour,
    opposingAgentAvailability: tour.opposingAgentAvailability.filter((item) => (
      item.id !== availabilityId || item.listingId !== listingId
    )),
    updatedAt: new Date().toISOString()
  };

  const savedTour = saveWithTour(state, updatedTour);
  return {
    tour: savedTour,
    deletedOpposingAgentAvailabilityId: availabilityId
  };
}

export function replaceOpposingAgentAvailability(
  tourId: string,
  listingId: string,
  inputs: ReplaceOpposingAgentAvailabilityInput['availability']
): OpposingAvailabilityReplaceResult | undefined {
  const state = readState();
  const tour = findTourInState(state, tourId);
  if (!tour) return undefined;

  const listing = findListingInTour(tour, listingId);
  if (!listing) return undefined;

  const opposingAgentAvailability = inputs.map((input) => toOpposingAgentAvailability(listing, input));
  const updatedListing = opposingAgentAvailability.length > 0 ? maybeMarkSlotsReceived(listing) : listing;
  const updatedTour: Tour = {
    ...tour,
    listings: tour.listings.map((candidate) => (
      candidate.id === listingId ? updatedListing : candidate
    )),
    opposingAgentAvailability: [
      ...tour.opposingAgentAvailability.filter((item) => item.listingId !== listingId),
      ...opposingAgentAvailability
    ],
    updatedAt: new Date().toISOString()
  };

  const savedTour = saveWithTour(state, updatedTour);
  return {
    tour: savedTour,
    opposingAgentAvailability: clone(opposingAgentAvailability)
  };
}

export function updateListingStatus(
  tourId: string,
  listingId: string,
  input: UpdateListingStatusInput
): ListingMutationResult | undefined {
  const state = readState();
  const tour = findTourInState(state, tourId);
  if (!tour) return undefined;

  const listing = findListingInTour(tour, listingId);
  if (!listing) return undefined;

  const updatedListing: TourListing = {
    ...listing,
    status: input.status,
    ...(input.notes !== undefined ? { notes: input.notes } : {})
  };

  const updatedTour: Tour = {
    ...tour,
    listings: tour.listings.map((candidate) => (
      candidate.id === listingId ? updatedListing : candidate
    )),
    updatedAt: new Date().toISOString()
  };

  const savedTour = saveWithTour(state, updatedTour);
  return {
    tour: savedTour,
    listing: clone(updatedListing)
  };
}

function toCoordinationEvent(
  tourId: string,
  listingId: string,
  input: CreateCoordinationEventInput
): CoordinationEvent {
  const now = new Date().toISOString();
  return {
    id: nextId('coordination-event'),
    tourId,
    listingId,
    kind: input.kind,
    senderRole: input.senderRole,
    source: input.source || 'MANUAL',
    body: input.body,
    summary: input.summary,
    parsedIntent: input.parsedIntent,
    relatedAvailabilityId: input.relatedAvailabilityId,
    relatedStatus: input.relatedStatus,
    occurredAt: input.occurredAt || now,
    createdAt: now,
    updatedAt: now
  };
}

export function listCoordinationEvents(
  tourId: string,
  listingId: string
): CoordinationEvent[] | undefined {
  const tour = getTourById(tourId);
  if (!tour) return undefined;
  if (!findListingInTour(tour, listingId)) return undefined;

  return clone(
    tour.coordinationEvents
      .filter((event) => event.listingId === listingId)
      .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
  );
}

export function addCoordinationEvent(
  tourId: string,
  listingId: string,
  input: CreateCoordinationEventInput
): CoordinationEventMutationResult | undefined {
  const state = readState();
  const tour = findTourInState(state, tourId);
  if (!tour) return undefined;
  if (!findListingInTour(tour, listingId)) return undefined;

  const coordinationEvent = toCoordinationEvent(tourId, listingId, input);
  const updatedTour: Tour = {
    ...tour,
    coordinationEvents: [...tour.coordinationEvents, coordinationEvent],
    updatedAt: new Date().toISOString()
  };

  const savedTour = saveWithTour(state, updatedTour);
  return {
    tour: savedTour,
    coordinationEvent: clone(coordinationEvent)
  };
}

export function updateCoordinationEvent(
  tourId: string,
  listingId: string,
  eventId: string,
  input: UpdateCoordinationEventInput
): CoordinationEventMutationResult | undefined {
  const state = readState();
  const tour = findTourInState(state, tourId);
  if (!tour) return undefined;
  if (!findListingInTour(tour, listingId)) return undefined;

  const existing = tour.coordinationEvents.find((event) => (
    event.id === eventId && event.listingId === listingId
  ));
  if (!existing) return undefined;

  const coordinationEvent: CoordinationEvent = {
    ...existing,
    ...input,
    updatedAt: new Date().toISOString()
  };

  const updatedTour: Tour = {
    ...tour,
    coordinationEvents: tour.coordinationEvents.map((event) => (
      event.id === eventId && event.listingId === listingId ? coordinationEvent : event
    )),
    updatedAt: new Date().toISOString()
  };

  const savedTour = saveWithTour(state, updatedTour);
  return {
    tour: savedTour,
    coordinationEvent: clone(coordinationEvent)
  };
}

export function deleteCoordinationEvent(
  tourId: string,
  listingId: string,
  eventId: string
): CoordinationEventDeleteResult | undefined {
  const state = readState();
  const tour = findTourInState(state, tourId);
  if (!tour) return undefined;
  if (!findListingInTour(tour, listingId)) return undefined;

  const exists = tour.coordinationEvents.some((event) => (
    event.id === eventId && event.listingId === listingId
  ));
  if (!exists) return undefined;

  const updatedTour: Tour = {
    ...tour,
    coordinationEvents: tour.coordinationEvents.filter((event) => (
      event.id !== eventId || event.listingId !== listingId
    )),
    updatedAt: new Date().toISOString()
  };

  const savedTour = saveWithTour(state, updatedTour);
  return {
    tour: savedTour,
    deletedCoordinationEventId: eventId
  };
}

export function replaceSchedule(tourId: string, scheduleItems: ScheduleItem[]): ScheduleReplaceResult | undefined {
  const state = readState();
  const tour = findTourInState(state, tourId);
  if (!tour) return undefined;

  const updatedTour: Tour = {
    ...tour,
    schedule: clone(scheduleItems),
    updatedAt: new Date().toISOString()
  };

  const savedTour = saveWithTour(state, updatedTour);
  return {
    tour: savedTour,
    schedule: clone(savedTour.schedule)
  };
}

export function generateAndSaveSchedule(
  tourId: string,
  input: GenerateScheduleInput
): ScheduleGenerationResult | undefined {
  const state = readState();
  const tour = findTourInState(state, tourId);
  if (!tour) return undefined;

  const plan = generateSchedulePlan(tour, input, {
    createScheduleItemId: () => nextId('schedule')
  });

  const updatedTour: Tour = {
    ...tour,
    schedule: clone(plan.schedule),
    updatedAt: new Date().toISOString()
  };

  const savedTour = saveWithTour(state, updatedTour);
  return {
    tour: savedTour,
    schedule: clone(plan.schedule),
    unscheduled: clone(plan.unscheduled),
    warnings: clone(plan.warnings),
    summary: clone(plan.summary)
  };
}
