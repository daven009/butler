import type { NextApiResponse } from 'next';

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
  };
}

export function sendError(
  res: NextApiResponse,
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>
) {
  const payload: ApiErrorPayload = {
    error: {
      code,
      message,
      ...(fields ? { fields } : {})
    }
  };

  return res.status(status).json(payload);
}

export function methodNotAllowed(res: NextApiResponse, method: string | undefined, allowed: string[]) {
  res.setHeader('Allow', allowed);
  return sendError(
    res,
    405,
    'METHOD_NOT_ALLOWED',
    `Method ${method || 'UNKNOWN'} not allowed`
  );
}
