/**
 * Sign-in / sign-up screen.
 *
 * Hand-rolled (instead of using @supabase/auth-ui-react which has React 18
 * pinned in deps and breaks under React 19). Calls Supabase Auth directly
 * via supabase.auth.signInWithPassword / signUp / signInWithOtp.
 */

import { useState } from "react"
import { supabase } from "./supabaseClient"

type Mode = "signin" | "signup" | "magiclink"

export function SignIn() {
  const [mode, setMode] = useState<Mode>("signin")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setBusy(true)
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password })
        if (error) throw error
        // AppRoot's onAuthStateChange listener will swap to the main app.
      } else if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password })
        if (error) throw error
        if (data.session) {
          // Email confirmation is OFF in Supabase project settings → user is
          // signed in immediately, AppRoot listener will route us in.
        } else {
          setInfo("Account created — check your email to confirm before signing in.")
          setMode("signin")
        }
      } else {
        // magic link
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: window.location.origin },
        })
        if (error) throw error
        setInfo("Magic link sent — check your email.")
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-[#fdf2f8] via-[#f5f3ff] to-[#ecfeff] px-6 py-10">
      <div className="mx-auto flex max-w-md flex-col items-stretch gap-6 pt-16">
        <header className="text-center">
          <div className="text-3xl font-black tracking-tight text-[#222222]">Butler</div>
          <p className="mt-2 text-sm text-[#666]">AI PA for property agents</p>
        </header>

        <div className="rounded-3xl bg-white/95 p-6 shadow-[0_24px_60px_rgba(0,0,0,0.08)] backdrop-blur-xl">
          <div className="mb-5 flex gap-1 rounded-2xl bg-[#f5f5f5] p-1 text-[12px] font-bold">
            {(["signin", "signup", "magiclink"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setMode(m); setError(null); setInfo(null) }}
                className={`flex-1 cursor-pointer rounded-xl px-3 py-2 transition ${
                  mode === m
                    ? "bg-white text-[#222] shadow-sm"
                    : "text-[#888] hover:text-[#222]"
                }`}
              >
                {m === "signin" ? "Sign in" : m === "signup" ? "Sign up" : "Magic link"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-[12px] font-bold text-[#666]">
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="h-11 rounded-xl border border-[#dddddd] bg-white px-3 text-sm font-medium outline-none transition focus:border-[#222222] focus:ring-2 focus:ring-[#222222]/10"
                autoComplete="email"
              />
            </label>

            {mode !== "magiclink" && (
              <label className="flex flex-col gap-1 text-[12px] font-bold text-[#666]">
                Password
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="h-11 rounded-xl border border-[#dddddd] bg-white px-3 text-sm font-medium outline-none transition focus:border-[#222222] focus:ring-2 focus:ring-[#222222]/10"
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                />
              </label>
            )}

            {error && (
              <div className="rounded-xl border border-[#ffd5de] bg-[#fff5f7] px-3 py-2 text-[12px] font-medium text-[#c13515]">
                {error}
              </div>
            )}
            {info && (
              <div className="rounded-xl border border-[#d7f4df] bg-[#f3fbf5] px-3 py-2 text-[12px] font-medium text-[#177245]">
                {info}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-2 inline-flex cursor-pointer items-center justify-center rounded-2xl bg-[#ff385c] px-4 py-3 text-sm font-bold text-white transition-colors hover:bg-[#e00b41] disabled:cursor-not-allowed disabled:bg-[#e5e7eb] disabled:text-[#9ca3af]"
            >
              {busy
                ? "Working…"
                : mode === "signin"
                  ? "Sign in"
                  : mode === "signup"
                    ? "Create account"
                    : "Email me a magic link"}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-[#999]">
          Internal preview — please use a personal email you have access to.
        </p>
      </div>
    </div>
  )
}
