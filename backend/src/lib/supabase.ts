/**
 * Server-side Supabase clients.
 *
 *   supabaseAdmin  — uses SERVICE_ROLE key. Bypasses Row Level Security.
 *                    Use ONLY for: admin operations, the cross-user
 *                    pg_listings_archive cache, and one-shot scripts.
 *
 *   supabaseForUser(jwt) — uses ANON key + the user's JWT in Authorization
 *                          header. RLS policies are enforced by Postgres,
 *                          so a leak in our application layer can't expose
 *                          another user's rows.
 *
 *   verifyToken(jwt) — used by the requireUser middleware. Returns the
 *                      Supabase user record (with .id, .email, …) or null.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anon || !serviceRole) {
  throw new Error(
    '[supabase] Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY env vars',
  );
}

export const supabaseAdmin: SupabaseClient = createClient(url, serviceRole, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Build a per-request client whose calls are authorized as the given user.
 * Cheap to instantiate (it's just a wrapper around fetch + headers), so we
 * make a fresh one per request — this avoids leaking JWTs between requests.
 */
export function supabaseForUser(jwt: string): SupabaseClient {
  return createClient(url!, anon!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      headers: { Authorization: `Bearer ${jwt}` },
    },
  });
}

/**
 * Verify a Supabase access token. Returns the user (id, email, …) on
 * success, or null when the token is missing / invalid / expired.
 *
 * Uses the admin client because verification needs to be authoritative
 * regardless of RLS.
 */
export async function verifyToken(jwt: string) {
  if (!jwt) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(jwt);
  if (error || !data.user) return null;
  return data.user;
}
