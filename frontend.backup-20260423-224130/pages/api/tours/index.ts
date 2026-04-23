import type { NextApiRequest, NextApiResponse } from 'next';
import { methodNotAllowed, sendError } from '../../../lib/api/errors';
import { validateCreateTourInput } from '../../../lib/api/validation';
import { createTour, listTourSummaries } from '../../../lib/repositories/toursRepository';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({ tours: listTourSummaries() });
  }

  if (req.method === 'POST') {
    const validation = validateCreateTourInput(req.body);
    if (!validation.ok || !validation.value) {
      return sendError(res, 400, 'VALIDATION_FAILED', 'Tour input is invalid', validation.fields);
    }

    const tour = createTour(validation.value);
    return res.status(201).json({ tour });
  }

  return methodNotAllowed(res, req.method, ['GET', 'POST']);
}
