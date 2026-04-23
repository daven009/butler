import type { NextApiRequest, NextApiResponse } from 'next';
import { methodNotAllowed, sendError } from '../../../../../lib/api/errors';
import { validateCreateListingInput } from '../../../../../lib/api/validation';
import { addListingToTour } from '../../../../../lib/repositories/toursRepository';

function getTourId(req: NextApiRequest) {
  return typeof req.query.id === 'string' ? req.query.id : '';
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, req.method, ['POST']);
  }

  const validation = validateCreateListingInput(req.body);
  if (!validation.ok || !validation.value) {
    return sendError(res, 400, 'VALIDATION_FAILED', 'Listing input is invalid', validation.fields);
  }

  const result = addListingToTour(getTourId(req), validation.value);
  if (!result) return sendError(res, 404, 'TOUR_NOT_FOUND', 'Tour not found');

  return res.status(201).json(result);
}
