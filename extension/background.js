/**
 * Background service worker — relays popup ↔ active tab ↔ backend.
 *
 * Why a background worker?
 *  - Popup loses its connection on close; long-running fetch (e.g. backend
 *    geocoding + LLM) should be resilient.
 *  - Future: a context-menu / page action click can route through here too.
 *
 * Auth model (added 2026-06-01):
 *  - The Butler web app pushes the user's Supabase JWT into this extension
 *    via chrome.runtime.onMessageExternal { type: 'STORE_TOKEN', token }
 *    after sign-in (see web/src/extensionBridge.ts → storeTokenInExtension).
 *  - The token is stashed in chrome.storage.local under "butlerToken" and
 *    automatically attached to every backend request as
 *    `Authorization: Bearer <token>`.
 *  - This is what enforces per-user isolation: backend RLS sees the same
 *    user_id as the web UI, so listings imported by user A are only visible
 *    to user A.
 */

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function getSettings() {
  const {
    backendBase = 'http://localhost:8787',
    tourId = '',
    advanced = false,
    revealContact = false,
  } = await chrome.storage.local.get(['backendBase', 'tourId', 'advanced', 'revealContact']);
  return { backendBase, tourId, advanced, revealContact };
}

/**
 * Read the cached Butler/Supabase JWT. Returns null if the user hasn't signed
 * in yet from the web app (in which case backend calls will 401).
 */
async function getStoredToken() {
  const { butlerToken } = await chrome.storage.local.get(['butlerToken']);
  return butlerToken && typeof butlerToken === 'string' ? butlerToken : null;
}

/** Build headers, optionally adding Authorization: Bearer <token>. */
async function buildAuthHeaders(extra = {}) {
  const token = await getStoredToken();
  const headers = { ...extra };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function extractFromActiveTab(opts = {}) {
  const tab = await getActiveTab();
  if (!tab?.id) throw new Error('No active tab');
  if (!/^https:\/\/www\.propertyguru\.com\.sg\/listing\//.test(tab.url || '')) {
    throw new Error('Open a PropertyGuru listing page first.');
  }
  const resp = await chrome.tabs.sendMessage(tab.id, {
    type: 'PG_EXTRACT',
    advanced: !!opts.advanced,
    revealContact: !!opts.revealContact,
  });
  if (!resp?.ok) throw new Error(resp?.error || 'extract failed');
  return resp.data;
}

async function postToBackend(path, body) {
  const { backendBase } = await getSettings();
  const url = `${backendBase.replace(/\/$/, '')}${path}`;
  const headers = await buildAuthHeaders({ 'Content-Type': 'application/json' });
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Not signed in to Butler. Open Butler in another tab and sign in, then retry.');
    }
    const msg = json?.error?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return json;
}

async function getJsonFromBackend(path) {
  const { backendBase } = await getSettings();
  const url = `${backendBase.replace(/\/$/, '')}${path}`;
  const headers = await buildAuthHeaders();
  const res = await fetch(url, { headers });
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error('Not signed in to Butler. Open Butler in another tab and sign in, then retry.');
    }
    throw new Error(`HTTP ${res.status}`);
  }
  return res.json();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'GET_SETTINGS') {
        sendResponse({ ok: true, data: await getSettings() });
        return;
      }
      if (msg.type === 'SAVE_SETTINGS') {
        await chrome.storage.local.set(msg.data || {});
        sendResponse({ ok: true });
        return;
      }
      if (msg.type === 'EXTRACT_ACTIVE') {
        const data = await extractFromActiveTab({
          advanced: !!msg.advanced,
          revealContact: !!msg.revealContact,
        });
        sendResponse({ ok: true, data });
        return;
      }
      if (msg.type === 'LIST_PLANS') {
        const data = await getJsonFromBackend('/api/plans');
        sendResponse({ ok: true, data });
        return;
      }
      if (msg.type === 'LIST_TOURS') {
        const data = await getJsonFromBackend(`/api/plans/${encodeURIComponent(msg.planId)}/tours`);
        sendResponse({ ok: true, data });
        return;
      }
      if (msg.type === 'IMPORT_TO_TOUR') {
        const { tourId, listing, sourceUrl } = msg.data;
        const result = await postToBackend(
          `/api/tours/${encodeURIComponent(tourId)}/import-from-extension`,
          {
            source: 'pg-detail',
            url: sourceUrl,
            scrapedAt: new Date().toISOString(),
            listings: [listing],
          },
        );
        sendResponse({ ok: true, data: result });
        return;
      }
      if (msg.type === 'BUTLER_BROADCAST') {
        // Forward auto-mode result to whichever Butler tab kicked it off.
        broadcastToButlerTabs({
          type: 'BUTLER_IMPORT_RESULT',
          tourId: msg.tourId,
          taskId: msg.taskId,
          payload: msg.payload,
        });
        // Also stash the latest result keyed by taskId so a Butler tab that
        // polls (e.g. via PING_TASK) can fetch it even after refresh.
        await stashTaskResult(msg.taskId, { tourId: msg.tourId, payload: msg.payload });
        sendResponse({ ok: true });
        return;
      }
      if (msg.type === 'CLOSE_SELF_TAB') {
        // Before closing the PG tab, refocus the Butler tab that started this
        // import (so the user sees their workspace, not whatever tab Chrome
        // happens to pick when the active tab dies). The taskId was attached
        // to the URL by IMPORT_VIA_TAB and propagated through content.js.
        try {
          const taskId = msg.taskId || extractTaskIdFromTabUrl(sender?.tab?.url);
          const origin = taskId ? await getTaskOrigin(taskId) : null;
          if (origin?.butlerTabId) {
            try {
              await chrome.tabs.update(origin.butlerTabId, { active: true });
              if (origin.butlerWindowId != null) {
                await chrome.windows.update(origin.butlerWindowId, { focused: true });
              }
            } catch (_) {
              // Butler tab may have been closed by the user; nothing to focus.
            }
          }
        } catch (_) {}
        if (sender?.tab?.id) {
          try { await chrome.tabs.remove(sender.tab.id); } catch (_) {}
        }
        sendResponse({ ok: true });
        return;
      }
      sendResponse({ ok: false, error: `unknown message: ${msg.type}` });
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true; // async response
});

/* ─── External (Butler web → extension) ──────────────────────────────── */

chrome.runtime.onMessageExternal.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === 'PING') {
        sendResponse({
          ok: true,
          data: {
            version: chrome.runtime.getManifest().version,
            hasToken: !!(await getStoredToken()),
          },
        });
        return;
      }
      if (msg?.type === 'STORE_TOKEN') {
        // Butler web app pushes Supabase JWT here after sign-in. The token is
        // then auto-attached to every backend call via buildAuthHeaders().
        if (typeof msg.token !== 'string' || !msg.token) {
          sendResponse({ ok: false, error: 'token (string) is required' });
          return;
        }
        const patch = { butlerToken: msg.token };
        // The web app also tells us *which Butler instance* it came from
        // (e.g. https://47.236.98.146 in prod, http://localhost:5173 in dev).
        // Remember it so:
        //   1. The popup's "Open Butler" button can target the right host.
        //   2. backendBase auto-syncs to the same host (web origin → API host
        //      via deriveBackendBaseFromWebOrigin), avoiding the gotcha
        //      where the user logged in on prod but the popup still talked
        //      to localhost:8787.
        if (typeof msg.webOrigin === 'string' && msg.webOrigin) {
          patch.butlerWebOrigin = msg.webOrigin;
          const derived = deriveBackendBaseFromWebOrigin(msg.webOrigin);
          if (derived) patch.backendBase = derived;
        }
        await chrome.storage.local.set(patch);
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === 'CLEAR_TOKEN') {
        await chrome.storage.local.remove('butlerToken');
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === 'IMPORT_VIA_TAB') {
        const { tourId, url, reveal = true } = msg;
        if (!tourId || !url) {
          sendResponse({ ok: false, error: 'tourId and url are required' });
          return;
        }
        const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const fullUrl = appendButlerParams(url, tourId, taskId, reveal);
        const tab = await chrome.tabs.create({ url: fullUrl, active: true });
        // Remember which Butler tab started this import so we can refocus it
        // when the PG tab closes (auto-mode finish handler in content.js calls
        // CLOSE_SELF_TAB; we use this stash to bring Butler back to the front).
        if (_sender?.tab?.id != null) {
          await stashTaskOrigin(taskId, {
            butlerTabId: _sender.tab.id,
            butlerWindowId: _sender.tab.windowId,
          });
        }
        sendResponse({ ok: true, data: { taskId, tabId: tab.id } });
        return;
      }
      if (msg?.type === 'PING_TASK') {
        const { taskId } = msg;
        const result = await getStashedTaskResult(taskId);
        sendResponse({ ok: true, data: result || null });
        return;
      }
      sendResponse({ ok: false, error: `unknown external message: ${msg?.type}` });
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true;
});

function appendButlerParams(url, tourId, taskId, reveal) {
  try {
    const u = new URL(url);
    u.searchParams.set('butlerImport', tourId);
    u.searchParams.set('taskId', taskId);
    if (!reveal) u.searchParams.set('reveal', '0');
    return u.toString();
  } catch (_) {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}butlerImport=${encodeURIComponent(tourId)}&taskId=${encodeURIComponent(taskId)}${reveal ? '' : '&reveal=0'}`;
  }
}

async function broadcastToButlerTabs(message) {
  // Broadcast to all tabs whose origin matches our externally_connectable list.
  const matches = chrome.runtime.getManifest().externally_connectable?.matches || [];
  const tabs = await chrome.tabs.query({ url: matches });
  for (const t of tabs) {
    if (!t.id) continue;
    try {
      await chrome.tabs.sendMessage(t.id, message);
    } catch (_) {
      // Butler tab may not have a listener wired up yet — that's fine; we
      // also stash the result so the tab can fetch it via PING_TASK.
    }
  }
}

async function stashTaskResult(taskId, value) {
  if (!taskId) return;
  const key = `task:${taskId}`;
  const blob = { ...value, savedAt: Date.now() };
  await chrome.storage.local.set({ [key]: blob });
  // Best-effort cleanup — drop entries older than 1h
  setTimeout(() => chrome.storage.local.remove(key).catch(() => {}), 60 * 60 * 1000);
}

async function getStashedTaskResult(taskId) {
  if (!taskId) return null;
  const key = `task:${taskId}`;
  const out = await chrome.storage.local.get(key);
  return out[key] || null;
}
/**
 * Stash which Butler tab kicked off a given taskId, so when the PG tab
 * finishes auto-import and asks to be closed, we can refocus that Butler
 * tab (instead of letting Chrome auto-pick whatever neighbouring tab was
 * next, which often isn't Butler).
 */
async function stashTaskOrigin(taskId, value) {
  if (!taskId) return;
  const key = `taskOrigin:${taskId}`;
  await chrome.storage.local.set({ [key]: { ...value, savedAt: Date.now() } });
  setTimeout(() => chrome.storage.local.remove(key).catch(() => {}), 60 * 60 * 1000);
}

async function getTaskOrigin(taskId) {
  if (!taskId) return null;
  const key = `taskOrigin:${taskId}`;
  const out = await chrome.storage.local.get(key);
  return out[key] || null;
}

/** Best-effort: pull ?taskId=... out of the PG tab's URL when content.js
 *  forgets to pass it explicitly in the CLOSE_SELF_TAB message. */
function extractTaskIdFromTabUrl(url) {
  if (typeof url !== 'string') return null;
  try { return new URL(url).searchParams.get('taskId'); } catch { return null; }
}

/**
 * Map a Butler web origin → the backend base the extension should call.
 *
 *   https://app.hey-alfred.vip      → https://app.hey-alfred.vip   (prod, /api routed by nginx)
 *   https://47.236.98.146           → https://47.236.98.146        (legacy IP, kept for old installs)
 *   http://localhost:5173           → http://localhost:8787        (dev: vite at 5173, backend at 8787)
 *   http://127.0.0.1:5173           → http://127.0.0.1:8787
 *   anything else                   → return as-is (assume reverse-proxy is doing /api routing)
 *
 * Returns null if the origin can't be parsed (in which case we leave the
 * existing backendBase alone — never wipe a user's manual override on a
 * malformed input).
 */
function deriveBackendBaseFromWebOrigin(origin) {
  try {
    const u = new URL(origin);
    // Vite dev server on 5173 → tsx backend on 8787. Common dev pairing.
    if ((u.hostname === 'localhost' || u.hostname === '127.0.0.1') && u.port === '5173') {
      return `${u.protocol}//${u.hostname}:8787`;
    }
    // Anything else: web and api share the same origin (production reverse
    // proxy splits / vs /api).
    return u.origin;
  } catch {
    return null;
  }
}
