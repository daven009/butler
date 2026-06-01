/**
 * Butler ↔ Chrome extension bridge.
 *
 * Talks to the "Butler PG Importer" extension via chrome.runtime.sendMessage
 * with a fixed extensionId (derived from the manifest "key" field). Used to:
 *  - detect whether the extension is installed
 *  - trigger an "Import via PG tab" flow that opens PG, runs advanced extract,
 *    saves to backend, then closes the tab
 *  - listen for the result so the page can refresh listings
 */

// This must match the extension id derived from manifest.json -> "key".
// Once published to Web Store this becomes the listing's stable id.
// In dev/unpacked mode the id is unstable per-machine; users can override
// it via localStorage.setItem('butler.extensionId', '<id from chrome://extensions>').
// Production id is the Chrome Web Store listing for "Butler PG Importer".
const DEFAULT_EXTENSION_ID = 'melnenopfkellcalpdbopiickpmidjld'

export function getButlerExtensionId(): string {
  try {
    const stored = window.localStorage?.getItem('butler.extensionId')
    if (stored && stored.trim()) return stored.trim()
  } catch {
    // ignore
  }
  return DEFAULT_EXTENSION_ID
}

export const BUTLER_EXTENSION_ID = getButlerExtensionId()

type ChromeRuntime = {
  sendMessage: (
    extensionId: string,
    message: unknown,
    callback: (resp: unknown) => void,
  ) => void
  onMessage?: { addListener: (cb: (msg: unknown) => void) => void }
  lastError?: { message: string }
}

function getChromeRuntime(): ChromeRuntime | null {
  const w = window as unknown as { chrome?: { runtime?: ChromeRuntime } }
  return w.chrome?.runtime || null
}

function send<T = unknown>(message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const rt = getChromeRuntime()
    if (!rt) return reject(new Error('Chrome runtime not available'))
    try {
      rt.sendMessage(getButlerExtensionId(), message, (resp: unknown) => {
        const err = rt.lastError?.message
        if (err) return reject(new Error(err))
        const r = resp as { ok?: boolean; error?: string; data?: T } | undefined
        if (!r) return reject(new Error('No response from extension'))
        if (!r.ok) return reject(new Error(r.error || 'Extension error'))
        resolve(r.data as T)
      })
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)))
    }
  })
}

export interface ExtensionPingResult {
  /** True if Chrome was reachable AND the extension responded. */
  installed: boolean
  /** Manifest version string (e.g. "1.0.2"). Undefined when not installed. */
  version?: string
  /**
   * True only when the extension is v1.0.2+ (PING returns hasToken).
   * Older versions return undefined here, which lets the web app prompt the
   * user to upgrade.
   */
  tokenAware: boolean
  /** Whether the extension currently has a Butler JWT cached. */
  hasToken: boolean
}

/**
 * Probe the extension. Returns rich metadata so the web app can:
 *   - show an "install" banner when not installed,
 *   - show an "upgrade" banner when v1.0.1 (no STORE_TOKEN handler),
 *   - decide whether it still needs to push the token (hasToken=false → push).
 */
export async function pingExtensionDetailed(): Promise<ExtensionPingResult> {
  try {
    const data = await send<{ version?: string; hasToken?: boolean }>({ type: 'PING' })
    return {
      installed: true,
      version: data?.version,
      tokenAware: typeof data?.hasToken === 'boolean',
      hasToken: !!data?.hasToken,
    }
  } catch {
    return { installed: false, tokenAware: false, hasToken: false }
  }
}

/** Backwards-compatible boolean shim. Prefer pingExtensionDetailed in new code. */
export async function pingExtension(): Promise<boolean> {
  return (await pingExtensionDetailed()).installed
}

/**
 * Push the Butler user token into the extension's chrome.storage.local so
 * that the extension's popup / content-script can include it as
 * `Authorization: Bearer <token>` when calling our backend.
 *
 * Also pushes the current page origin (e.g. https://47.236.98.146) so the
 * extension's popup can open the same Butler instance when prompting an
 * unauthenticated user to sign in. This way an agent who's logged in on
 * production never gets bounced to localhost (or vice-versa).
 *
 * Resolves true when the extension acknowledged; false otherwise (extension
 * not installed / unreachable / pre-token-aware version 1.0.1).
 */
export async function storeTokenInExtension(token: string): Promise<boolean> {
  try {
    let webOrigin: string | undefined
    try {
      webOrigin = window.location.origin
    } catch {
      // ignore — running outside a window
    }
    await send({ type: 'STORE_TOKEN', token, webOrigin })
    return true
  } catch {
    return false
  }
}

/**
 * Tell the extension to drop its cached token. Call on sign-out so the next
 * user on the same browser can't accidentally write under the previous
 * user's identity.
 */
export async function clearTokenInExtension(): Promise<boolean> {
  try {
    await send({ type: 'CLEAR_TOKEN' })
    return true
  } catch {
    return false
  }
}

export async function importViaTab(args: {
  tourId: string
  url: string
  reveal?: boolean
}): Promise<{ taskId: string }> {
  const data = await send<{ taskId: string }>({
    type: 'IMPORT_VIA_TAB',
    tourId: args.tourId,
    url: args.url,
    reveal: args.reveal !== false,
  })
  return data
}

/**
 * Wait for the extension to broadcast a result for the given taskId, OR
 * fall back to polling chrome.storage via PING_TASK every second.
 *
 * Resolves when the auto-mode flow completes (either ok or error).
 */
export function waitForImportResult(taskId: string, timeoutMs = 5 * 60 * 1000) {
  return new Promise<{ ok: boolean; importedId?: string; error?: string; stats?: unknown }>((resolve, reject) => {
    const rt = getChromeRuntime()
    let settled = false
    const finish = (value: { ok: boolean; importedId?: string; error?: string; stats?: unknown }) => {
      if (settled) return
      settled = true
      clearInterval(pollTimer)
      clearTimeout(timeoutTimer)
      resolve(value)
    }

    // Listen for live broadcasts from the extension.
    rt?.onMessage?.addListener((msg) => {
      const m = msg as { type?: string; taskId?: string; payload?: { ok: boolean; importedId?: string; error?: string; stats?: unknown } }
      if (m?.type === 'BUTLER_IMPORT_RESULT' && m.taskId === taskId && m.payload) {
        finish(m.payload)
      }
    })

    // Also poll the stash in case the listener wasn't attached in time.
    const pollTimer = setInterval(async () => {
      try {
        const stash = await send<{ payload?: { ok: boolean; importedId?: string; error?: string; stats?: unknown } } | null>({
          type: 'PING_TASK',
          taskId,
        })
        if (stash?.payload) finish(stash.payload)
      } catch {
        // ignore — extension might have been reloaded
      }
    }, 1000)

    const timeoutTimer = setTimeout(() => {
      if (!settled) {
        settled = true
        clearInterval(pollTimer)
        reject(new Error('Import timed out'))
      }
    }, timeoutMs)
  })
}
