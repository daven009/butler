import type { NextApiRequest, NextApiResponse } from 'next';
import { methodNotAllowed, sendError } from '../../../../lib/api/errors';
import { validateUpdateTourInput } from '../../../../lib/api/validation';
import { getTourById, updateTourBasics } from '../../../../lib/repositories/toursRepository';

function getId(req: NextApiRequest) {
  return typeof req.query.id === 'string' ? req.query.id : '';
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = getId(req);

  if (req.method === 'GET') {
    const tour = getTourById(id);
    if (!tour) return sendError(res, 404, 'TOUR_NOT_FOUND', 'Tour not found');
    return res.status(200).json({ tour });
  }

  if (req.method === 'PATCH') {
    const validation = validateUpdateTourInput(req.body);
    if (!validation.ok || !validation.value) {
      return sendError(res, 400, 'VALIDATION_FAILED', 'Tour update input is invalid', validation.fields);
    }

    const tour = updateTourBasics(id, validation.value);
    if (!tour) return sendError(res, 404, 'TOUR_NOT_FOUND', 'Tour not found');

    return res.status(200).json({ tour });
  }

  return methodNotAllowed(res, req.method, ['GET', 'PATCH']);
}
