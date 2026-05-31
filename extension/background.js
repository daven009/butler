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
        await chrome.storage.local.set({ butlerToken: msg.token });
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
