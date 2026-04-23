import type { Response } from 'express';

export function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>
) {
  return res.status(status).json({
    error: {
      code,
      message,
      ...(fields ? { fields } : {})
    }
  });
}

export function notFound(res: Response, code: string, message: string) {
  return sendError(res, 404, code, message);
}

export function methodNotAllowed(res: Response, method: string, allowed: string[]) {
  res.setHeader('Allow', allowed);
  return sendError(res, 405, 'METHOD_NOT_ALLOWED', `Method ${method} not allowed`);
}
