import type { NextApiRequest, NextApiResponse } from 'next';
import { methodNotAllowed, sendError } from '../../../../../../../lib/api/errors';
import { validateUpdateCoordinationEventInput } from '../../../../../../../lib/api/validation';
import {
  deleteCoordinationEvent,
  getTourById,
  updateCoordinationEvent
} from '../../../../../../../lib/repositories/toursRepository';

function getTourId(req: NextApiRequest) {
  return typeof req.query.id === 'string' ? req.query.id : '';
}

function getListingId(req: NextApiRequest) {
  return typeof req.query.listingId === 'string' ? req.query.listingId : '';
}

function getEventId(req: NextApiRequest) {
  return typeof req.query.eventId === 'string' ? req.query.eventId : '';
}

function missingResource(res: NextApiResponse, tourId: string, listingId: string, eventId: string) {
  const tour = getTourById(tourId);
  if (!tour) return sendError(res, 404, 'TOUR_NOT_FOUND', 'Tour not found');
  if (!tour.listings.some((listing) => listing.id === listingId)) {
    return sendError(res, 404, 'LISTING_NOT_FOUND', 'Listing not found');
  }
  if (!tour.coordinationEvents.some((event) => event.id === eventId && event.listingId === listingId)) {
    return sendError(
      res,
      404,
      'COORDINATION_EVENT_NOT_FOUND',
      'Coordination event not found'
    );
  }

  return sendError(res, 404, 'RESOURCE_NOT_FOUND', 'Requested resource not found');
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const tourId = getTourId(req);
  const listingId = getListingId(req);
  const eventId = getEventId(req);

  if (req.method === 'PATCH') {
    const validation = validateUpdateCoordinationEventInput(req.body);
    if (!validation.ok || !validation.value) {
      return sendError(
        res,
        400,
        'VALIDATION_FAILED',
        'Coordination event update input is invalid',
        validation.fields
      );
    }

    const result = updateCoordinationEvent(tourId, listingId, eventId, validation.value);
    if (!result) return missingResource(res, tourId, listingId, eventId);

    return res.status(200).json(result);
  }

  if (req.method === 'DELETE') {
    const result = deleteCoordinationEvent(tourId, listingId, eventId);
    if (!result) return missingResource(res, tourId, listingId, eventId);

    return res.status(200).json(result);
  }

  return methodNotAllowed(res, req.method, ['PATCH', 'DELETE']);
}
