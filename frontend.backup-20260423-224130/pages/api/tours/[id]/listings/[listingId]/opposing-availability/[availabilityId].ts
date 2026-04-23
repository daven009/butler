import type { NextApiRequest, NextApiResponse } from 'next';
import { methodNotAllowed, sendError } from '../../../../../../../lib/api/errors';
import { validateUpdateOpposingAgentAvailabilityInput } from '../../../../../../../lib/api/validation';
import {
  deleteOpposingAgentAvailability,
  getTourById,
  updateOpposingAgentAvailability
} from '../../../../../../../lib/repositories/toursRepository';

function getTourId(req: NextApiRequest) {
  return typeof req.query.id === 'string' ? req.query.id : '';
}

function getListingId(req: NextApiRequest) {
  return typeof req.query.listingId === 'string' ? req.query.listingId : '';
}

function getAvailabilityId(req: NextApiRequest) {
  return typeof req.query.availabilityId === 'string' ? req.query.availabilityId : '';
}

function missingResource(res: NextApiResponse, tourId: string, listingId: string, availabilityId: string) {
  const tour = getTourById(tourId);
  if (!tour) return sendError(res, 404, 'TOUR_NOT_FOUND', 'Tour not found');
  if (!tour.listings.some((listing) => listing.id === listingId)) {
    return sendError(res, 404, 'LISTING_NOT_FOUND', 'Listing not found');
  }
  if (!tour.opposingAgentAvailability.some((item) => (
    item.id === availabilityId && item.listingId === listingId
  ))) {
    return sendError(
      res,
      404,
      'OPPOSING_AGENT_AVAILABILITY_NOT_FOUND',
      'Opposing-agent availability item not found'
    );
  }

  return sendError(res, 404, 'RESOURCE_NOT_FOUND', 'Requested resource not found');
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const tourId = getTourId(req);
  const listingId = getListingId(req);
  const availabilityId = getAvailabilityId(req);

  if (req.method === 'PATCH') {
    const validation = validateUpdateOpposingAgentAvailabilityInput(req.body);
    if (!validation.ok || !validation.value) {
      return sendError(
        res,
        400,
        'VALIDATION_FAILED',
        'Opposing-agent availability update input is invalid',
        validation.fields
      );
    }

    const result = updateOpposingAgentAvailability(tourId, listingId, availabilityId, validation.value);
    if (!result) return missingResource(res, tourId, listingId, availabilityId);

    return res.status(200).json(result);
  }

  if (req.method === 'DELETE') {
    const result = deleteOpposingAgentAvailability(tourId, listingId, availabilityId);
    if (!result) return missingResource(res, tourId, listingId, availabilityId);

    return res.status(200).json(result);
  }

  return methodNotAllowed(res, req.method, ['PATCH', 'DELETE']);
}
