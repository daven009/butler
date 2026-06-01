/**
 * Auth — Supabase-backed.
 *
 * The fake-user scaffolding (FAKE_USERS / fixed UUIDs) is gone. We now lean
 * entirely on Supabase Auth: the SDK manages session + token storage, we
 * just expose tiny helpers that the rest of the app reads.
 */

import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabaseClient'
import { clearTokenInExtension, storeTokenInExtension } from './extensionBridge'

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
  // On first boot, if we already have a session, push the JWT into the
  // extension straight away. The App.tsx-level effect will also do this when
  // the user object materialises, but doing it here too means a fresh tab on
  // a returning user has the extension primed before any UI even mounts.
  if (session?.access_token) {
    void storeTokenInExtension(session.access_token).catch(() => {})
  }

  const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
    _cachedToken = sess?.access_token ?? null
    onChange(sess?.user ? toButlerUser(sess.user) : null)
    // Keep the extension's cached JWT in lockstep with the web SDK:
    //   SIGNED_IN          → push fresh token
    //   TOKEN_REFRESHED    → push the refreshed (not-yet-expired) token,
    //                        otherwise extension calls 401 once the old one
    //                        expires (default Supabase TTL is 1h)
    //   SIGNED_OUT / USER_DELETED → clear it (signOut() also does this, but
    //                        catching the event covers cases where a tab
    //                        was signed out from another tab via the
    //                        cross-tab BroadcastChannel)
    if (sess?.access_token && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION' || event === 'USER_UPDATED')) {
      void storeTokenInExtension(sess.access_token).catch(() => {})
    } else if (event === 'SIGNED_OUT') {
      void clearTokenInExtension().catch(() => {})
    }
  })

  return () => sub.subscription.unsubscribe()
}
