import cors from 'cors';
import express from 'express';
import {
  addBuyerAvailability,
  addCoordinationEvent,
  addListingToTour,
  addOpposingAgentAvailability,
  createTour,
  deleteBuyerAvailability,
  deleteCoordinationEvent,
  deleteListing,
  deleteOpposingAgentAvailability,
  generateAndSaveSchedule,
  getTourById,
  listBuyerAvailability,
  listCoordinationEvents,
  listOpposingAgentAvailability,
  listTourSummaries,
  listTours,
  replaceBuyerAvailability,
  replaceOpposingAgentAvailability,
  updateBuyerAvailability,
  updateCoordinationEvent,
  updateListing,
  updateListingStatus,
  updateOpposingAgentAvailability,
  updateTourBasics
} from './lib/repositories/toursRepository';
import {
  buildCalendar,
  buildCalendarDay,
  buildExportStub,
  buildInbox,
  getExceptionById,
  getItinerary,
  getThread,
  importPropertyLink,
  listExceptions,
  listThreadMessages,
  listThreads,
  markInboxItemRead,
  parseSearchInput,
  postThreadMessage,
  recordItineraryShare,
  resolveException,
  searchCatalog,
  updateThreadOwnership
} from './lib/repositories/butlerRepository';
import {
  createClient,
  deleteClient,
  getClientById,
  listClients,
  updateClient
} from './lib/repositories/clientsRepository';
import {
  getProfile,
  getSettings,
  updateProfile,
  updateSettings
} from './lib/repositories/settingsRepository';
import {
  validateCreateBuyerAvailabilityInput,
  validateCreateCoordinationEventInput,
  validateCreateListingInput,
  validateCreateOpposingAgentAvailabilityInput,
  validateCreateTourInput,
  validateGenerateScheduleInput,
  validateReplaceBuyerAvailabilityInput,
  validateReplaceOpposingAgentAvailabilityInput,
  validateUpdateBuyerAvailabilityInput,
  validateUpdateCoordinationEventInput,
  validateUpdateListingInput,
  validateUpdateListingStatusInput,
  validateUpdateOpposingAgentAvailabilityInput,
  validateUpdateTourInput
} from './lib/api/validation';
import { methodNotAllowed, notFound, sendError } from './lib/http';

const app = express();
const port = Number(process.env.PORT || 8787);

app.use(cors());
app.use(express.json());

function requireJsonObject(req: express.Request, res: express.Response) {
  if (req.body && typeof req.body === 'object') return true;
  sendError(res, 400, 'VALIDATION_FAILED', 'JSON object body is required', { body: 'JSON object body is required' });
  return false;
}

function parseClientPayload(body: any) {
  const fields: Record<string, string> = {};
  if (!body || typeof body !== 'object') {
    return { ok: false, fields: { body: 'JSON object body is required' } };
  }
  if (!String(body.name || '').trim()) fields.name = 'name is required';
  if (Object.keys(fields).length) return { ok: false, fields };
  return { ok: true, value: body };
}

function requireTour(req: express.Request, res: express.Response) {
  const tour = getTourById(String(req.params.id || ''));
  if (!tour) {
    notFound(res, 'TOUR_NOT_FOUND', 'Tour not found');
    return undefined;
  }
  return tour;
}

function requireListing(req: express.Request, res: express.Response) {
  const tour = requireTour(req, res);
  if (!tour) return undefined;
  const listing = tour.listings.find((item) => item.id === String(req.params.listingId || ''));
  if (!listing) {
    notFound(res, 'LISTING_NOT_FOUND', 'Listing not found');
    return undefined;
  }
  return { tour, listing };
}

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.get('/api/tours', (_req, res) => {
  res.status(200).json({ tours: listTourSummaries() });
});

app.post('/api/tours', (req, res) => {
  const validation = validateCreateTourInput(req.body);
  if (!validation.ok || !validation.value) {
    return sendError(res, 400, 'VALIDATION_FAILED', 'Tour input is invalid', validation.fields);
  }
  return res.status(201).json({ tour: createTour(validation.value) });
});

app.get('/api/tours/:id', (req, res) => {
  const tour = getTourById(req.params.id);
  if (!tour) return notFound(res, 'TOUR_NOT_FOUND', 'Tour not found');
  return res.status(200).json({ tour });
});

app.patch('/api/tours/:id', (req, res) => {
  const validation = validateUpdateTourInput(req.body);
  if (!validation.ok || !validation.value) {
    return sendError(res, 400, 'VALIDATION_FAILED', 'Tour input is invalid', validation.fields);
  }
  const tour = updateTourBasics(req.params.id, validation.value);
  if (!tour) return notFound(res, 'TOUR_NOT_FOUND', 'Tour not found');
  return res.status(200).json({ tour });
});

app.post('/api/tours/:id/generate-schedule', (req, res) => {
  const validation = validateGenerateScheduleInput(req.body);
  if (!validation.ok || !validation.value) {
    return sendError(res, 400, 'VALIDATION_FAILED', 'Schedule generation input is invalid', validation.fields);
  }
  const result = generateAndSaveSchedule(req.params.id, validation.value);
  if (!result) return notFound(res, 'TOUR_NOT_FOUND', 'Tour not found');
  return res.status(200).json(result);
});

app.post('/api/tours/:id/listings', (req, res) => {
  const validation = validateCreateListingInput(req.body);
  if (!validation.ok || !validation.value) {
    return sendError(res, 400, 'VALIDATION_FAILED', 'Listing input is invalid', validation.fields);
  }
  const result = addListingToTour(req.params.id, validation.value);
  if (!result) return notFound(res, 'TOUR_NOT_FOUND', 'Tour not found');
  return res.status(201).json(result);
});

app.patch('/api/tours/:id/listings/:listingId', (req, res) => {
  const validation = validateUpdateListingInput(req.body);
  if (!validation.ok || !validation.value) {
    return sendError(res, 400, 'VALIDATION_FAILED', 'Listing input is invalid', validation.fields);
  }
  const result = updateListing(req.params.id, req.params.listingId, validation.value);
  if (!result) {
    if (!requireListing(req, res)) return;
  }
  return res.status(200).json(result);
});

app.delete('/api/tours/:id/listings/:listingId', (req, res) => {
  const result = deleteListing(req.params.id, req.params.listingId);
  if (!result) {
    if (!requireListing(req, res)) return;
  }
  return res.status(200).json(result);
});

app.get('/api/tours/:id/buyer-availability', (req, res) => {
  const buyerAvailability = listBuyerAvailability(req.params.id);
  if (!buyerAvailability) return notFound(res, 'TOUR_NOT_FOUND', 'Tour not found');
  return res.status(200).json({ buyerAvailability });
});

app.post('/api/tours/:id/buyer-availability', (req, res) => {
  const validation = validateCreateBuyerAvailabilityInput(req.body);
  if (!validation.ok || !validation.value) {
    return sendError(res, 400, 'VALIDATION_FAILED', 'Buyer availability input is invalid', validation.fields);
  }
  const result = addBuyerAvailability(req.params.id, validation.value);
  if (!result) return notFound(res, 'TOUR_NOT_FOUND', 'Tour not found');
  return res.status(201).json(result);
});

app.put('/api/tours/:id/buyer-availability', (req, res) => {
  const validation = validateReplaceBuyerAvailabilityInput(req.body);
  if (!validation.ok || !validation.value) {
    return sendError(res, 400, 'VALIDATION_FAILED', 'Buyer availability replacement input is invalid', validation.fields);
  }
  const result = replaceBuyerAvailability(req.params.id, validation.value.availability);
  if (!result) return notFound(res, 'TOUR_NOT_FOUND', 'Tour not found');
  return res.status(200).json(result);
});

app.patch('/api/tours/:id/buyer-availability/:availabilityId', (req, res) => {
  const validation = validateUpdateBuyerAvailabilityInput(req.body);
  if (!validation.ok || !validation.value) {
    return sendError(res, 400, 'VALIDATION_FAILED', 'Buyer availability input is invalid', validation.fields);
  }
  const result = updateBuyerAvailability(req.params.id, req.params.availabilityId, validation.value);
  if (!result) return notFound(res, 'BUYER_AVAILABILITY_NOT_FOUND', 'Buyer availability not found');
  return res.status(200).json(result);
});

app.delete('/api/tours/:id/buyer-availability/:availabilityId', (req, res) => {
  const result = deleteBuyerAvailability(req.params.id, req.params.availabilityId);
  if (!result) return notFound(res, 'BUYER_AVAILABILITY_NOT_FOUND', 'Buyer availability not found');
  return res.status(200).json(result);
});

app.get('/api/tours/:id/listings/:listingId/opposing-availability', (req, res) => {
  const opposingAgentAvailability = listOpposingAgentAvailability(req.params.id, req.params.listingId);
  if (!opposingAgentAvailability) {
    if (!requireListing(req, res)) return;
  }
  return res.status(200).json({ opposingAgentAvailability });
});

app.post('/api/tours/:id/listings/:listingId/opposing-availability', (req, res) => {
  const validation = validateCreateOpposingAgentAvailabilityInput(req.body);
  if (!validation.ok || !validation.value) {
    return sendError(res, 400, 'VALIDATION_FAILED', 'Opposing-agent availability input is invalid', validation.fields);
  }
  const result = addOpposingAgentAvailability(req.params.id, req.params.listingId, validation.value);
  if (!result) {
    if (!requireListing(req, res)) return;
  }
  return res.status(201).json(result);
});

app.put('/api/tours/:id/listings/:listingId/opposing-availability', (req, res) => {
  const validation = validateReplaceOpposingAgentAvailabilityInput(req.body);
  if (!validation.ok || !validation.value) {
    return sendError(res, 400, 'VALIDATION_FAILED', 'Opposing-agent availability replacement input is invalid', validation.fields);
  }
  const result = replaceOpposingAgentAvailability(req.params.id, req.params.listingId, validation.value.availability);
  if (!result) {
    if (!requireListing(req, res)) return;
  }
  return res.status(200).json(result);
});

app.patch('/api/tours/:id/listings/:listingId/opposing-availability/:availabilityId', (req, res) => {
  const validation = validateUpdateOpposingAgentAvailabilityInput(req.body);
  if (!validation.ok || !validation.value) {
    return sendError(res, 400, 'VALIDATION_FAILED', 'Opposing-agent availability input is invalid', validation.fields);
  }
  const result = updateOpposingAgentAvailability(req.params.id, req.params.listingId, req.params.availabilityId, validation.value);
  if (!result) return notFound(res, 'OPPOSING_AGENT_AVAILABILITY_NOT_FOUND', 'Opposing-agent availability not found');
  return res.status(200).json(result);
});

app.delete('/api/tours/:id/listings/:listingId/opposing-availability/:availabilityId', (req, res) => {
  const result = deleteOpposingAgentAvailability(req.params.id, req.params.listingId, req.params.availabilityId);
  if (!result) return notFound(res, 'OPPOSING_AGENT_AVAILABILITY_NOT_FOUND', 'Opposing-agent availability not found');
  return res.status(200).json(result);
});

app.patch('/api/tours/:id/listings/:listingId/status', (req, res) => {
  const validation = validateUpdateListingStatusInput(req.body);
  if (!validation.ok || !validation.value) {
    return sendError(res, 400, 'VALIDATION_FAILED', 'Listing status input is invalid', validation.fields);
  }
  const result = updateListingStatus(req.params.id, req.params.listingId, validation.value);
  if (!result) {
    if (!requireListing(req, res)) return;
  }
  return res.status(200).json(result);
});

app.get('/api/tours/:id/listings/:listingId/coordination-events', (req, res) => {
  const coordinationEvents = listCoordinationEvents(req.params.id, req.params.listingId);
  if (!coordinationEvents) {
    if (!requireListing(req, res)) return;
  }
  return res.status(200).json({ coordinationEvents });
});

app.post('/api/tours/:id/listings/:listingId/coordination-events', (req, res) => {
  const validation = validateCreateCoordinationEventInput(req.body);
  if (!validation.ok || !validation.value) {
    return sendError(res, 400, 'VALIDATION_FAILED', 'Coordination event input is invalid', validation.fields);
  }
  const result = addCoordinationEvent(req.params.id, req.params.listingId, validation.value);
  if (!result) {
    if (!requireListing(req, res)) return;
  }
  return res.status(201).json(result);
});

app.patch('/api/tours/:id/listings/:listingId/coordination-events/:eventId', (req, res) => {
  const validation = validateUpdateCoordinationEventInput(req.body);
  if (!validation.ok || !validation.value) {
    return sendError(res, 400, 'VALIDATION_FAILED', 'Coordination event input is invalid', validation.fields);
  }
  const result = updateCoordinationEvent(req.params.id, req.params.listingId, req.params.eventId, validation.value);
  if (!result) return notFound(res, 'COORDINATION_EVENT_NOT_FOUND', 'Coordination event not found');
  return res.status(200).json(result);
});

app.delete('/api/tours/:id/listings/:listingId/coordination-events/:eventId', (req, res) => {
  const result = deleteCoordinationEvent(req.params.id, req.params.listingId, req.params.eventId);
  if (!result) return notFound(res, 'COORDINATION_EVENT_NOT_FOUND', 'Coordination event not found');
  return res.status(200).json(result);
});

app.get('/api/clients', (_req, res) => {
  res.status(200).json({ clients: listClients() });
});

app.post('/api/clients', (req, res) => {
  const validation = parseClientPayload(req.body);
  if (!validation.ok) return sendError(res, 400, 'VALIDATION_FAILED', 'Client input is invalid', validation.fields);
  res.status(201).json({ client: createClient(validation.value) });
});

app.get('/api/clients/:clientId', (req, res) => {
  const client = getClientById(req.params.clientId);
  if (!client) return notFound(res, 'CLIENT_NOT_FOUND', 'Client not found');
  res.status(200).json({ client });
});

app.patch('/api/clients/:clientId', (req, res) => {
  if (!requireJsonObject(req, res)) return;
  const client = updateClient(req.params.clientId, req.body);
  if (!client) return notFound(res, 'CLIENT_NOT_FOUND', 'Client not found');
  res.status(200).json({ client });
});

app.delete('/api/clients/:clientId', (req, res) => {
  const deleted = deleteClient(req.params.clientId);
  if (!deleted) return notFound(res, 'CLIENT_NOT_FOUND', 'Client not found');
  res.status(200).json({ deletedClientId: req.params.clientId });
});

app.post('/api/search/parse', (req, res) => {
  if (!requireJsonObject(req, res)) return;
  const text = String(req.body.text || '').trim();
  const source = req.body.source === 'voice' ? 'voice' : 'text';
  res.status(200).json({ tags: parseSearchInput(text, source) });
});

app.post('/api/search/import-link', (req, res) => {
  if (!requireJsonObject(req, res)) return;
  const url = String(req.body.url || '').trim();
  res.status(200).json(importPropertyLink(url));
});

app.post('/api/search/results', (req, res) => {
  if (!requireJsonObject(req, res)) return;
  const tags = Array.isArray(req.body.tags) ? req.body.tags : [];
  const linkedListingIds = Array.isArray(req.body.linkedListingIds) ? req.body.linkedListingIds : [];
  res.status(200).json({ results: searchCatalog(tags, linkedListingIds) });
});

app.get('/api/tours/:id/threads', (req, res) => {
  const threads = listThreads(req.params.id);
  if (!threads) return notFound(res, 'TOUR_NOT_FOUND', 'Tour not found');
  res.status(200).json({ threads });
});

app.get('/api/tours/:id/threads/:threadId', (req, res) => {
  const thread = getThread(req.params.id, req.params.threadId);
  if (!thread) return notFound(res, 'THREAD_NOT_FOUND', 'Thread not found');
  res.status(200).json({ thread });
});

app.get('/api/tours/:id/threads/:threadId/messages', (req, res) => {
  const messages = listThreadMessages(req.params.id, req.params.threadId);
  if (!messages) return notFound(res, 'THREAD_NOT_FOUND', 'Thread not found');
  res.status(200).json({ messages });
});

app.post('/api/tours/:id/threads/:threadId/messages', (req, res) => {
  if (!requireJsonObject(req, res)) return;
  const text = String(req.body.text || '').trim();
  if (!text) return sendError(res, 400, 'VALIDATION_FAILED', 'Message input is invalid', { text: 'text is required' });
  const messages = postThreadMessage(req.params.id, req.params.threadId, text);
  if (!messages) return notFound(res, 'THREAD_NOT_FOUND', 'Thread not found');
  res.status(201).json({ messages });
});

app.patch('/api/tours/:id/threads/:threadId/ownership', (req, res) => {
  if (!requireJsonObject(req, res)) return;
  const ownership = req.body.ownership;
  if (ownership !== 'AI' && ownership !== 'HUMAN') {
    return sendError(res, 400, 'VALIDATION_FAILED', 'Thread ownership is invalid', { ownership: 'ownership must be AI or HUMAN' });
  }
  const thread = updateThreadOwnership(req.params.id, req.params.threadId, ownership);
  if (!thread) return notFound(res, 'THREAD_NOT_FOUND', 'Thread not found');
  res.status(200).json({ thread });
});

app.get('/api/tours/:id/exceptions', (req, res) => {
  const exceptions = listExceptions(req.params.id);
  if (!exceptions) return notFound(res, 'TOUR_NOT_FOUND', 'Tour not found');
  res.status(200).json({ exceptions });
});

app.get('/api/tours/:id/exceptions/:exceptionId', (req, res) => {
  const exception = getExceptionById(req.params.id, req.params.exceptionId);
  if (!exception) return notFound(res, 'EXCEPTION_NOT_FOUND', 'Exception not found');
  res.status(200).json({ exception });
});

app.post('/api/tours/:id/exceptions/:exceptionId/resolve', (req, res) => {
  if (!requireJsonObject(req, res)) return;
  const action = req.body.action;
  if (!['SQUEEZE_IN', 'REPROPOSE', 'DROP_LISTING'].includes(action)) {
    return sendError(res, 400, 'VALIDATION_FAILED', 'Exception resolution input is invalid', { action: 'action must be SQUEEZE_IN, REPROPOSE, or DROP_LISTING' });
  }
  const result = resolveException(req.params.id, req.params.exceptionId, action);
  if (!result) return notFound(res, 'EXCEPTION_NOT_FOUND', 'Exception not found');
  res.status(200).json(result);
});

app.get('/api/calendar', (req, res) => {
  const month = String(req.query.month || new Date().toISOString().slice(0, 7));
  res.status(200).json(buildCalendar(month));
});

app.get('/api/calendar/day', (req, res) => {
  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  res.status(200).json(buildCalendarDay(date));
});

app.get('/api/tours/:id/itinerary', (req, res) => {
  const itinerary = getItinerary(req.params.id);
  if (!itinerary) return notFound(res, 'TOUR_NOT_FOUND', 'Tour not found');
  res.status(200).json({ itinerary });
});

app.post('/api/tours/:id/itinerary/share', (req, res) => {
  const tour = requireTour(req, res);
  if (!tour) return;
  const share = recordItineraryShare(tour.id);
  res.status(200).json({ share });
});

app.post('/api/tours/:id/itinerary/export', (req, res) => {
  const tour = requireTour(req, res);
  if (!tour) return;
  res.status(200).json({ export: buildExportStub(tour.id) });
});

app.get('/api/inbox', (_req, res) => {
  res.status(200).json({ items: buildInbox() });
});

app.patch('/api/inbox/:itemId/read', (req, res) => {
  const item = markInboxItemRead(req.params.itemId);
  if (!item) return notFound(res, 'INBOX_ITEM_NOT_FOUND', 'Inbox item not found');
  res.status(200).json({ item });
});

app.get('/api/me', (_req, res) => {
  res.status(200).json({ profile: getProfile() });
});

app.patch('/api/me', (req, res) => {
  if (!requireJsonObject(req, res)) return;
  res.status(200).json({ profile: updateProfile(req.body) });
});

app.get('/api/settings', (_req, res) => {
  res.status(200).json({ settings: getSettings() });
});

app.patch('/api/settings', (req, res) => {
  if (!requireJsonObject(req, res)) return;
  res.status(200).json({ settings: updateSettings(req.body) });
});

app.use((req, res) => methodNotAllowed(res, req.method, []));

app.listen(port, () => {
  console.log(`Butler backend listening on http://localhost:${port}`);
});
