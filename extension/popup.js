/**
 * Popup script — wires UI → background worker.
 * Stores backendBase + last-used plan/tour in chrome.storage.local.
 *
 * Auth UX (added 2026-06-01 in v1.0.2):
 *   On open we ask background.js for the cached Butler JWT (via
 *   GET_AUTH_STATE). If absent, we render the "Sign in to Butler" banner
 *   instead of trying to load plans (which would 401). The "Open Butler"
 *   button targets the stored butlerWebOrigin (set when web pushed the
 *   token last time) or falls back to the production URL.
 */

const $ = (id) => document.getElementById(id);
const elBackend = $('backendBase');
const elPlan = $('plan');
const elTour = $('tour');
const elPreview = $('preview');
const elExtract = $('extract');
const elImport = $('import');
const elStatus = $('status');
const elReload = $('reloadPlans');
const elAdvanced = $('advanced');
const elReveal = $('revealContact');
const elAuthBanner = $('authBanner');
const elOpenButlerBtn = $('openButlerBtn');
const elIdentityStrip = $('identityStrip');
const elIdentityHost = $('identityHost');

// Default Butler URL when we've never been told otherwise (first install,
// no STORE_TOKEN ever received). Production URL only — the popup intentionally
// doesn't know about localhost so a normal user sees the right destination.
// 2026-06-01: switched from raw IP (https://47.236.98.146, self-signed cert)
// to the real domain. Self-signed certs aren't trusted by the extension's
// service worker network stack, which broke every fetch from popup/background
// even when the page-context content script could reach the server. Real
// Let's Encrypt cert on app.hey-alfred.vip resolves all of that.
const DEFAULT_BUTLER_URL = 'https://app.hey-alfred.vip';

let extracted = null;

function setStatus(msg, kind = '') {
  elStatus.textContent = msg || '';
  elStatus.className = `status ${kind}`;
}

function send(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (resp) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!resp?.ok) return reject(new Error(resp?.error || 'unknown error'));
      resolve(resp.data);
    });
  });
}

/** Read cached Butler JWT + last-known web origin from chrome.storage.local. */
async function getAuthState() {
  const out = await chrome.storage.local.get(['butlerToken', 'butlerWebOrigin']);
  return {
    hasToken: !!(out.butlerToken && typeof out.butlerToken === 'string'),
    webOrigin: typeof out.butlerWebOrigin === 'string' ? out.butlerWebOrigin : null,
  };
}

/**
 * Wipe a stale token from storage. Called when the backend says 401, which
 * means whatever JWT we cached has expired (Supabase default TTL: 1h) or the
 * user signed out from another tab. After this, the popup re-renders the
 * "Sign in to Butler" banner so the user has a clear next action instead of
 * seeing a generic "Failed to load plans" error.
 */
async function clearStaleToken() {
  await chrome.storage.local.remove('butlerToken');
}

function showAuthBanner(webOrigin) {
  elAuthBanner.hidden = false;
  elIdentityStrip.hidden = true;
  // Disable everything that hits the backend until the user signs in.
  elPlan.disabled = true;
  elTour.disabled = true;
  elReload.disabled = true;
  elExtract.disabled = false; // local-only DOM extract still works without auth
  elImport.disabled = true;
  // Clear any stale dropdown content so the user doesn't see the previous
  // session's plans/tours behind the banner.
  elPlan.innerHTML = '';
  elTour.innerHTML = '';
  const target = webOrigin || DEFAULT_BUTLER_URL;
  setStatus(`Click "Sign in to Butler" below — once you're logged in at ${target}, come back and reopen this popup.`);
}

function showSignedIn(webOrigin) {
  elAuthBanner.hidden = true;
  elIdentityStrip.hidden = false;
  elIdentityHost.textContent = webOrigin || '(unknown origin)';
  elPlan.disabled = false;
  elTour.disabled = false;
  elReload.disabled = false;
}

elOpenButlerBtn?.addEventListener('click', async () => {
  const { webOrigin } = await getAuthState();
  const target = webOrigin || DEFAULT_BUTLER_URL;
  await chrome.tabs.create({ url: target, active: true });
});

async function loadSettings() {
  const settings = await send({ type: 'GET_SETTINGS' });
  elBackend.value = settings.backendBase || 'http://localhost:8787';
  elAdvanced.checked = !!settings.advanced;
  elReveal.disabled = !elAdvanced.checked;
  elReveal.checked = !!settings.revealContact && elAdvanced.checked;
  return settings;
}

async function saveSettings(patch) {
  await send({ type: 'SAVE_SETTINGS', data: patch });
}

async function loadPlans() {
  setStatus('Loading plans…');
  try {
    const { plans = [] } = await send({ type: 'LIST_PLANS' });
    elPlan.innerHTML = '';
    if (!plans.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '(no plans yet — create one first)';
      elPlan.appendChild(opt);
      elTour.innerHTML = '';
      setStatus('No plans found on backend.', 'error');
      return;
    }
    for (const p of plans) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.title} — ${p.clientName}`;
      elPlan.appendChild(opt);
    }
    await loadTours();
    setStatus('');
  } catch (e) {
    // 401 here is the user's main signal something's wrong — surface it
    // alongside the auth banner so the recovery path is obvious. Crucially,
    // we also wipe the stale token: a common case is "popup remembers a JWT
    // from a previous session that has since expired", in which case
    // hasToken=true on open but every backend call 401s. Clearing here flips
    // us back into the unsigned-in UI on next open (and immediately, below).
    if (/sign(ed)? in/i.test(e.message) || /401/.test(e.message)) {
      await clearStaleToken();
      const { webOrigin } = await getAuthState();
      showAuthBanner(webOrigin);
      return;
    }
    setStatus(`Failed to load plans: ${e.message}`, 'error');
  }
}

async function loadTours() {
  const planId = elPlan.value;
  elTour.innerHTML = '';
  if (!planId) return;
  try {
    const { tours = [] } = await send({ type: 'LIST_TOURS', planId });
    if (!tours.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '(no tours in this plan)';
      elTour.appendChild(opt);
      return;
    }
    for (const t of tours) {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `${t.title} (${t.targetDate || ''})`;
      elTour.appendChild(opt);
    }
    // restore last used tour if still in list
    const { tourId } = await send({ type: 'GET_SETTINGS' });
    if (tourId && Array.from(elTour.options).some((o) => o.value === tourId)) {
      elTour.value = tourId;
    }
  } catch (e) {
    setStatus(`Failed to load tours: ${e.message}`, 'error');
  }
}

elBackend.addEventListener('change', async () => {
  await saveSettings({ backendBase: elBackend.value.trim() });
  await loadPlans();
});

elReload.addEventListener('click', () => loadPlans());
elPlan.addEventListener('change', () => loadTours());
elTour.addEventListener('change', () => saveSettings({ tourId: elTour.value }));

elAdvanced.addEventListener('change', async () => {
  const advanced = elAdvanced.checked;
  elReveal.disabled = !advanced;
  if (!advanced) elReveal.checked = false;
  await saveSettings({ advanced, revealContact: elReveal.checked });
});

elReveal.addEventListener('change', async () => {
  await saveSettings({ revealContact: elReveal.checked });
});

elExtract.addEventListener('click', async () => {
  const advanced = elAdvanced.checked;
  const revealContact = advanced && elReveal.checked;
  setStatus(advanced
    ? (revealContact ? 'Advanced extract + reveal contact…' : 'Advanced extract (scrolling/expanding)…')
    : 'Extracting current page…');
  elImport.disabled = true;
  extracted = null;
  elPreview.hidden = true;
  try {
    const data = await send({ type: 'EXTRACT_ACTIVE', advanced, revealContact });
    extracted = data;
    const summary = {
      listingId: data.listingId,
      title: data.title,
      priceLabel: data.priceLabel,
      psfLabel: data.psfLabel,
      bedrooms: data.bedrooms,
      bathrooms: data.bathrooms,
      areaSqft: data.areaSqft,
      propertyType: data.propertyType,
      tenure: data.tenure,
      imageUrl: data.imageUrl ? `${data.imageUrl.slice(0, 80)}…` : '',
      hasDescription: !!data.detail?.description,
      descriptionChars: (data.detail?.description || '').length,
      coAgentPhone: data.coAgent?.phone || '',
      coAgentWhatsApp: data.coAgent?.whatsapp || '',
      rawTextChars: (data.rawText || '').length,
      advanced: !!data.advanced,
    };
    elPreview.textContent = JSON.stringify(summary, null, 2);
    if (data._debug?.contactSnapshot) {
      elPreview.textContent += '\n\n--- contact debug snapshot ---\n' +
        JSON.stringify(data._debug.contactSnapshot, null, 2);
    }
    elPreview.hidden = false;
    // Import button stays disabled if no token (user can extract for preview
    // but not push to backend until signed in).
    const auth = await getAuthState();
    elImport.disabled = !elTour.value || !auth.hasToken;
    setStatus(`Extracted listing ${data.listingId || '(no id)'}.`, 'ok');
  } catch (e) {
    setStatus(`Extract failed: ${e.message}`, 'error');
  }
});

elImport.addEventListener('click', async () => {
  if (!extracted) return;
  const tourId = elTour.value;
  if (!tourId) return setStatus('Select a tour first.', 'error');
  setStatus('Importing to backend…');
  elImport.disabled = true;
  try {
    const result = await send({
      type: 'IMPORT_TO_TOUR',
      data: { tourId, listing: extracted, sourceUrl: extracted.url },
    });
    const stats = result?.stats || {};
    setStatus(
      `Imported. added=${stats.added ?? 0} merged=${stats.merged ?? 0} archive=${stats.pgArchive?.total ?? '?'}.`,
      'ok',
    );
  } catch (e) {
    setStatus(`Import failed: ${e.message}`, 'error');
  } finally {
    elImport.disabled = false;
  }
});

(async () => {
  await loadSettings();
  const auth = await getAuthState();
  if (!auth.hasToken) {
    showAuthBanner(auth.webOrigin);
    return; // Don't try to LIST_PLANS — it'll just 401.
  }
  showSignedIn(auth.webOrigin);
  await loadPlans();
})();

/**
 * React live to storage changes so the popup recovers without a manual close
 * + reopen cycle. Two scenarios this covers:
 *
 *   1. User opens popup → sees "Sign in to Butler" banner → clicks the button
 *      → signs in on the Butler tab → STORE_TOKEN fires → butlerToken
 *      appears in storage → we transparently swap UI to signed-in and load
 *      plans. (Without this, the user would have to close + reopen the
 *      popup, which is non-obvious.)
 *
 *   2. User signs out from Butler in another tab → CLEAR_TOKEN fires →
 *      butlerToken removed → we swap back to the banner so a subsequent
 *      Import attempt doesn't 401 silently.
 *
 *   3. backendBase auto-syncs (web pushes webOrigin → background derives
 *      backendBase) — reflect the new value in the input field so the user
 *      sees the right host without reopening.
 */
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local') return;
  if ('butlerToken' in changes) {
    const newVal = changes.butlerToken.newValue;
    if (newVal && typeof newVal === 'string') {
      const { webOrigin } = await getAuthState();
      showSignedIn(webOrigin);
      await loadPlans();
    } else {
      const { webOrigin } = await getAuthState();
      showAuthBanner(webOrigin);
    }
  }
  if ('backendBase' in changes && typeof changes.backendBase.newValue === 'string') {
    elBackend.value = changes.backendBase.newValue;
  }
});
