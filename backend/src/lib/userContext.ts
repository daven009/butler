/**
 * Per-request user context.
 *
 * Express middleware (`requireUser`) wraps each handler in `runWithUser` so
 * any repository function running below in the call stack can read:
 *   - the user's id (uuid)
 *   - the user's raw JWT (needed to spin up a Supabase client whose calls
 *     are authorized as that user, so RLS policies kick in)
 *
 * Backed by `AsyncLocalStorage` — the standard Node.js mechanism for
 * "thread-local" data across async boundaries.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface UserContext {
  userId: string;
  jwt: string;
}

const als = new AsyncLocalStorage<UserContext>();

export function runWithUser<T>(ctx: UserContext, fn: () => T): T {
  return als.run(ctx, fn);
}

export function getCurrentUserId(): string {
  const ctx = als.getStore();
  if (!ctx) {
    throw new Error(
      '[userContext] No user context — repository called outside an authenticated HTTP request',
    );
  }
  return ctx.userId;
}

export function getCurrentJwt(): string {
  const ctx = als.getStore();
  if (!ctx) {
    throw new Error(
      '[userContext] No user context — repository called outside an authenticated HTTP request',
    );
  }
  return ctx.jwt;
}

export function getCurrentUserIdOrUndefined(): string | undefined {
  return als.getStore()?.userId;
}
