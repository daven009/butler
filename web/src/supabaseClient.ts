/**
 * Browser-side Supabase client.
 *
 * Uses the ANON public key (safe for the frontend). All access is gated by
 * Row Level Security policies on the database — once a user signs in, the
 * SDK auto-attaches their JWT to every request and policies kick in.
 */

import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // Fail loudly during dev — silent fallback would mask config bugs that
  // only show up when network calls 401 mysteriously.
  throw new Error(
    '[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
      'Did you forget to populate web/.env.local?',
  )
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,   // for magic-link callbacks
  },
})
