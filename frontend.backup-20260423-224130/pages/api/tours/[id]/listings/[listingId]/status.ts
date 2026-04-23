import type { NextApiRequest, NextApiResponse } from 'next';
import { methodNotAllowed, sendError } from '../../../../../../lib/api/errors';
import { validateUpdateListingStatusInput } from '../../../../../../lib/api/validation';
import {
  getTourById,
  updateListingStatus
} from '../../../../../../lib/repositories/toursRepository';

function getTourId(req: NextApiRequest) {
  return typeof req.query.id === 'string' ? req.query.id : '';
}

function getListingId(req: NextApiRequest) {
  return typeof req.query.listingId === 'string' ? req.query.listingId : '';
}

function missingTourOrListing(res: NextApiResponse, tourId: string, listingId: string) {
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

  if (req.method !== 'PATCH') {
    return methodNotAllowed(res, req.method, ['PATCH']);
  }

  const validation = validateUpdateListingStatusInput(req.body);
  if (!validation.ok || !validation.value) {
    return sendError(
      res,
      400,
      'VALIDATION_FAILED',
      'Listing status input is invalid',
      validation.fields
    );
  }

  const result = updateListingStatus(tourId, listingId, validation.value);
  if (!result) return missingTourOrListing(res, tourId, listingId);

  return res.status(200).json(result);
}
