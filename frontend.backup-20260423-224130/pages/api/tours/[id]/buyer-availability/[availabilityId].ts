import type { NextApiRequest, NextApiResponse } from 'next';
import { methodNotAllowed, sendError } from '../../../../../lib/api/errors';
import { validateUpdateBuyerAvailabilityInput } from '../../../../../lib/api/validation';
import {
  deleteBuyerAvailability,
  getTourById,
  updateBuyerAvailability
} from '../../../../../lib/repositories/toursRepository';

function getTourId(req: NextApiRequest) {
  return typeof req.query.id === 'string' ? req.query.id : '';
}

function getAvailabilityId(req: NextApiRequest) {
  return typeof req.query.availabilityId === 'string' ? req.query.availabilityId : '';
}

function missingResource(res: NextApiResponse, tourId: string, availabilityId: string) {
  const tour = getTourById(tourId);
  if (!tour) return sendError(res, 404, 'TOUR_NOT_FOUND', 'Tour not found');
  if (!tour.buyerAvailability.some((item) => item.id === availabilityId)) {
    return sendError(
      res,
      404,
      'BUYER_AVAILABILITY_NOT_FOUND',
      'Buyer availability item not found'
    );
  }

  return sendError(res, 404, 'RESOURCE_NOT_FOUND', 'Requested resource not found');
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const tourId = getTourId(req);
  const availabilityId = getAvailabilityId(req);

  if (req.method === 'PATCH') {
    const validation = validateUpdateBuyerAvailabilityInput(req.body);
    if (!validation.ok || !validation.value) {
      return sendError(
        res,
        400,
        'VALIDATION_FAILED',
        'Buyer availability update input is invalid',
        validation.fields
      );
    }

    const result = updateBuyerAvailability(tourId, availabilityId, validation.value);
    if (!result) return missingResource(res, tourId, availabilityId);

    return res.status(200).json(result);
  }

  if (req.method === 'DELETE') {
    const result = deleteBuyerAvailability(tourId, availabilityId);
    if (!result) return missingResource(res, tourId, availabilityId);

    return res.status(200).json(result);
  }

  return methodNotAllowed(res, req.method, ['PATCH', 'DELETE']);
}
