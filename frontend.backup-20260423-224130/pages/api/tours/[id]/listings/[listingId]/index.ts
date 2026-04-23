import type { NextApiRequest, NextApiResponse } from 'next';
import { methodNotAllowed, sendError } from '../../../../../../lib/api/errors';
import { validateUpdateListingInput } from '../../../../../../lib/api/validation';
import {
  deleteListing,
  getTourById,
  updateListing
} from '../../../../../../lib/repositories/toursRepository';

function getTourId(req: NextApiRequest) {
  return typeof req.query.id === 'string' ? req.query.id : '';
}

function getListingId(req: NextApiRequest) {
  return typeof req.query.listingId === 'string' ? req.query.listingId : '';
}

function missingResource(res: NextApiResponse, tourId: string, listingId: string) {
  const tour = getTourById(tourId);
  if (!tour) return sendError(res, 404, 'TOUR_NOT_FOUND', 'Tour not found');
  if (!tour.listings.some((listing) => listing.id === listingId)) {
    return sendError(res, 404, 'LISTING_NOT_FOUND', 'Listing not found');
  }

  return sendError(res, 404, 'RESOURCE_NOT_FOUND', 'Requested resource not found');
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const tourId = getTourId(req);
  const listingId = getListingId(req);

  if (req.method === 'PATCH') {
    const validation = validateUpdateListingInput(req.body);
    if (!validation.ok || !validation.value) {
      return sendError(res, 400, 'VALIDATION_FAILED', 'Listing update input is invalid', validation.fields);
    }

    const result = updateListing(tourId, listingId, validation.value);
    if (!result) return missingResource(res, tourId, listingId);

    return res.status(200).json(result);
  }

  if (req.method === 'DELETE') {
    const result = deleteListing(tourId, listingId);
    if (!result) return missingResource(res, tourId, listingId);

    return res.status(200).json(result);
  }

  return methodNotAllowed(res, req.method, ['PATCH', 'DELETE']);
}
