/**
 * Auth — Supabase-backed.
 *
 * The fake-user scaffolding (FAKE_USERS / fixed UUIDs) is gone. We now lean
 * entirely on Supabase Auth: the SDK manages session + token storage, we
 * just expose tiny helpers that the rest of the app reads.
 */

import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'
import { clearTokenInExtension } from './extensionBridge'

export interface ButlerUser {
  /** auth.users.id — uuid */
  userId: string
  /** Display label — email is fine for now */
  displayName: string
  email: string
}

function toButlerUser(u: User): ButlerUser {
  return {
    userId: u.id,
    email: u.email || '',
    displayName: u.email?.split('@')[0] || u.id.slice(0, 8),
  }
}

/**
 * Synchronously read the current session token (if any). The SDK keeps this
 * in localStorage so this is safe to call during a render without awaiting.
 *
 * Returns null when the user is signed out.
 */
export function getStoredToken(): string | null {
  // Supabase v2 stores session in localStorage under sb-<ref>-auth-token.
  // Rather than parse that ourselves, ask the SDK for the cached session
  // synchronously via the v2 helper.
  // Note: getSession() is async but the underlying read is local; we expose
  // a sync mirror cached by the bootstrap below for places that can't await.
  return _cachedToken
}

/** Async, authoritative — preferred when the caller can await. */
export async function getCurrentSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession()
  return data.session
}

export async function getCurrentUser(): Promise<ButlerUser | null> {
  const session = await getCurrentSession()
  if (!session?.user) return null
  return toButlerUser(session.user)
}

export async function signOut(): Promise<void> {
  // Best-effort: clear the JWT cached inside the Chrome extension so the
  // next user on this browser can't accidentally write under the previous
  // user's identity. Ignore failures — the extension may not be installed.
  await clearTokenInExtension().catch(() => false)
  await supabase.auth.signOut()
}

// ─── Sync token cache ──────────────────────────────────────────────────────
// We mirror the latest access_token into module state so callers that can't
// await (e.g. the api.ts request interceptor) can still attach Authorization.
let _cachedToken: string | null = null

/**
 * Initialize the auth subsystem. Wires up:
 *   1. an initial session pull (so getStoredToken() works on first render)
 *   2. an onAuthStateChange listener that refreshes the cached token + fires
 *      the user-supplied callback whenever sign-in / sign-out / refresh happens.
 *
 * Returns the unsubscribe function.
 */
export async function initAuth(
  onChange: (user: ButlerUser | null) => void,
): Promise<() => void> {
  const { data: { session } } = await supabase.auth.getSession()
  _cachedToken = session?.access_token ?? null
  onChange(session?.user ? toButlerUser(session.user) : null)

  const { data: sub } = supabase.auth.onAuthStateChange((_event, sess) => {
    _cachedToken = sess?.access_token ?? null
    onChange(sess?.user ? toButlerUser(sess.user) : null)
  })

  return () => sub.subscription.unsubscribe()
}
