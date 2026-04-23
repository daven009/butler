import type { NextApiRequest, NextApiResponse } from 'next';
import { methodNotAllowed, sendError } from '../../../../../lib/api/errors';
import {
  validateCreateBuyerAvailabilityInput,
  validateReplaceBuyerAvailabilityInput
} from '../../../../../lib/api/validation';
import {
  addBuyerAvailability,
  listBuyerAvailability,
  replaceBuyerAvailability
} from '../../../../../lib/repositories/toursRepository';

function getTourId(req: NextApiRequest) {
  return typeof req.query.id === 'string' ? req.query.id : '';
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const tourId = getTourId(req);

  if (req.method === 'GET') {
    const buyerAvailability = listBuyerAvailability(tourId);
    if (!buyerAvailability) return sendError(res, 404, 'TOUR_NOT_FOUND', 'Tour not found');

    return res.status(200).json({ buyerAvailability });
  }

  if (req.method === 'POST') {
    const validation = validateCreateBuyerAvailabilityInput(req.body);
    if (!validation.ok || !validation.value) {
      return sendError(
        res,
        400,
        'VALIDATION_FAILED',
        'Buyer availability input is invalid',
        validation.fields
      );
    }

    const result = addBuyerAvailability(tourId, validation.value);
    if (!result) return sendError(res, 404, 'TOUR_NOT_FOUND', 'Tour not found');

    return res.status(201).json(result);
  }

  if (req.method === 'PUT') {
    const validation = validateReplaceBuyerAvailabilityInput(req.body);
    if (!validation.ok || !validation.value) {
      return sendError(
        res,
        400,
        'VALIDATION_FAILED',
        'Buyer availability replacement input is invalid',
        validation.fields
      );
    }

    const result = replaceBuyerAvailability(tourId, validation.value.availability);
    if (!result) return sendError(res, 404, 'TOUR_NOT_FOUND', 'Tour not found');

    return res.status(200).json(result);
  }

  return methodNotAllowed(res, req.method, ['GET', 'POST', 'PUT']);
}
