/**
 * Content script — runs on PropertyGuru listing detail pages.
 *
 * Two modes (controlled by `advanced` flag in the PG_EXTRACT message):
 *
 *  1. Basic (default):
 *     - Read whatever is already rendered in the DOM.
 *     - Cheap, instant, no clicks. Misses long descriptions, full image
 *       gallery, and agent contact info that PG hides behind buttons.
 *
 *  2. Advanced (user opt-in via popup):
 *     - Smooth-scroll to the bottom (triggers lazy-load of map, more cards,
 *       hidden image src attrs).
 *     - Auto-click "See more / Read more / View more details" expanders.
 *     - Cycle the image carousel to surface every photo URL.
 *     - Click WhatsApp/Call buttons to reveal `wa.me/...` / `tel:...` links.
 *       NOTE: the agent receives a "buyer interested" notification on PG —
 *       this is why advanced mode is opt-in.
 *     - Then run the basic extractor.
 */

const SLEEP = (ms) => new Promise((r) => setTimeout(r, ms));

/* ─── BASIC EXTRACTION ────────────────────────────────────────────────── */

function extractListing() {
  const url = location.href;
  const listingId = (url.match(/-(\d{6,})(?:[/?#]|$)/) || [])[1] || '';

  const all = document.body?.innerText || '';
  const flat = all.replace(/\s+/g, ' ');

  const out = {
    listingId,
    url,
    rawText: all.trim(),
    title: (document.title || '').replace(/\s*\|\s*PropertyGuru.*/i, '').trim(),
  };

  const priceMatch = flat.match(/S\$\s*([\d,]+)/);
  if (priceMatch) {
    out.price = Number(priceMatch[1].replace(/,/g, ''));
    out.priceLabel = `S$ ${priceMatch[1]}`;
  }

  const psfMatch = flat.match(/S\$\s*([\d,]+(?:\.\d+)?)\s*psf/i);
  if (psfMatch) out.psfLabel = `S$ ${psfMatch[1]} psf`;

  const bedM = flat.match(/(\d+)\s*Bed(?:room)?s?\b/i);
  if (bedM) out.bedrooms = Number(bedM[1]);
  const bathM = flat.match(/(\d+)\s*Bath(?:room)?s?\b/i);
  if (bathM) out.bathrooms = Number(bathM[1]);
  const sqftM = flat.match(/([\d,]+)\s*sqft/i);
  if (sqftM) out.areaSqft = Number(sqftM[1].replace(/,/g, ''));

  const typeMatch = flat.match(/(HDB Flat|Executive Condominium|Condominium|Apartment|Terraced House|Semi-Detached|Detached|Bungalow|Walk-up|Cluster House)/i);
  if (typeMatch) out.propertyType = typeMatch[1];
  const tenureMatch = flat.match(/((?:9?9|103|110|999)-year\s+(?:lease|leasehold)|Freehold)/i);
  if (tenureMatch) out.tenure = tenureMatch[1];

  const listedMatch = flat.match(/Listed on\s+([0-9]{1,2}\s+[A-Za-z]+\s+[0-9]{4})/i);
  if (listedMatch) out.listedOn = listedMatch[1];

  // Hero image only — we intentionally skip the full gallery to keep payloads
  // light. The first PG-hosted <img> is enough for the listing-card thumbnail.
  const heroImg = document.querySelector('img[src*="propertyguru"], img[srcset*="propertyguru"]');
  out.imageUrl = heroImg?.src || '';

  // "About this property" prose
  const description = extractAboutThisProperty();
  if (description) out.detail = { description };

  // Contact info — three sources in priority order:
  //   1. captured tel:/wa.me URLs intercepted during revealContact()
  //   2. tel:/wa.me anchors already in DOM
  //   3. plain text phone number that PG rendered after View Phone Number
  const contact = extractContactLinks();
  const phoneFromText = extractPhoneFromText();
  const finalPhone = _capturedContact.phone || contact.phone || phoneFromText;
  const finalWhatsapp = _capturedContact.whatsapp || contact.whatsapp;
  if (finalPhone || finalWhatsapp) {
    out.coAgent = out.coAgent || {};
    if (finalWhatsapp) out.coAgent.whatsapp = finalWhatsapp;
    if (finalPhone) out.coAgent.phone = finalPhone;
  }

  // CEA registration numbers (e.g. "CEA: R058129E / L3009643J").
  const ceaMatch = flat.match(/CEA[:\s]*([A-Z]\d{6}[A-Z])(?:\s*\/\s*([A-Z]\d{7}[A-Z]))?/i);
  if (ceaMatch) {
    out.coAgent = out.coAgent || {};
    out.coAgent.ceaAgent = ceaMatch[1];
    if (ceaMatch[2]) out.coAgent.ceaAgency = ceaMatch[2];
  }

  return out;
}

function extractAboutThisProperty() {
  const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,div,section'));
  for (const h of headings) {
    const txt = (h.textContent || '').trim();
    if (/^about this property/i.test(txt) && txt.length < 60) {
      const collected = [];
      let cur = h.nextElementSibling;
      while (cur && collected.join('').length < 8000) {
        const tag = cur.tagName?.toLowerCase();
        if (/^h[1-4]$/.test(tag)) break;
        const text = (cur.textContent || '').trim();
        if (text) collected.push(text);
        cur = cur.nextElementSibling;
      }
      const joined = collected.join('\n').trim();
      if (joined) return joined;
    }
  }
  return '';
}

function extractContactLinks() {
  const out = { phone: '', whatsapp: '' };
  const anchors = Array.from(document.querySelectorAll('a[href]'));
  for (const a of anchors) {
    const href = a.getAttribute('href') || '';
    if (!out.whatsapp) {
      const wa = href.match(/wa\.me\/(?:\+?\d[\d\s\-]+)/i) || href.match(/api\.whatsapp\.com.*phone=(\+?\d[\d\s\-]+)/i);
      if (wa) {
        const num = (wa[1] || wa[0]).replace(/[^\d+]/g, '');
        if (num.length >= 8) out.whatsapp = num;
      }
    }
    if (!out.phone) {
      const m = href.match(/^tel:(\+?\d[\d\s\-]+)/i);
      if (m) {
        const num = m[1].replace(/[^\d+]/g, '');
        if (num.length >= 8) out.phone = num;
      }
    }
  }
  return out;
}

/* ─── ADVANCED MODE: scroll, expand, cycle, reveal ─────────────────────── */

async function smoothScrollToBottom(maxMs = 2500) {
  const start = Date.now();
  let lastY = -1;
  while (Date.now() - start < maxMs) {
    window.scrollBy({ top: window.innerHeight * 0.95, behavior: 'instant' });
    await SLEEP(80);
    if (window.scrollY === lastY) break;
    lastY = window.scrollY;
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
  await SLEEP(80);
}

function findButtonsByText(texts) {
  const wanted = texts.map((t) => t.toLowerCase());
  const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], span, div'));
  const out = [];
  for (const el of candidates) {
    const t = (el.textContent || '').trim().toLowerCase();
    if (!t || t.length > 40) continue;
    if (wanted.some((w) => t === w || t.startsWith(w))) {
      out.push(el);
    }
  }
  return out;
}

async function closeAnyOpenDialog() {
  // PG sometimes opens "About this property" or photo gallery as a full-screen
  // dialog; if it's open while we try to reveal contact, the agent card is not
  // mounted. Try to close it by ESC + clicking common close buttons.
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'));
  if (!dialogs.length) return;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await SLEEP(150);
  // Click any visible "close" buttons inside dialogs
  for (const dlg of dialogs) {
    const closes = dlg.querySelectorAll('button[aria-label*="close" i], button[title*="close" i]');
    for (const c of closes) { try { c.click(); } catch (_) {} await SLEEP(100); }
  }
  await SLEEP(200);
}

async function clickAllExpanders() {
  const phrases = [
    'see more', 'show more', 'read more',
    'see all details', 'view more details', 'view more',
    'show more facilities', 'show more amenities',
  ];
  for (let pass = 0; pass < 2; pass++) {
    const btns = findButtonsByText(phrases).filter(isInlineExpander);
    if (!btns.length) return; // most PG detail pages don't have these — bail fast
    for (const b of btns) {
      try { b.click(); } catch (_) {}
      await SLEEP(60);
    }
    await SLEEP(120);
  }
}

/**
 * Heuristic: only click "See more" buttons that look like inline expanders,
 * NOT ones that open a full-screen modal. We avoid:
 *   - buttons inside [role="dialog"]
 *   - buttons whose aria-haspopup="dialog"
 *   - buttons that look like media triggers (photos, floor plan)
 */
function isInlineExpander(el) {
  if (!el) return false;
  if (el.closest('[role="dialog"], [aria-modal="true"]')) return false;
  if (el.getAttribute('aria-haspopup') === 'dialog') return false;
  const t = (el.textContent || '').trim().toLowerCase();
  if (/photos|floor plan|map view|gallery/.test(t)) return false;
  return true;
}

async function cyclePhotoCarousel(maxClicks = 25) {
  // PG carousels expose "next" arrows with various aria-labels — we try a few.
  const selectors = [
    'button[aria-label="Next" i]',
    'button[aria-label*="next" i]',
    'button[aria-label*="forward" i]',
    'button[class*="carousel" i][class*="next" i]',
  ];
  let nextBtn = null;
  for (const sel of selectors) {
    const found = document.querySelector(sel);
    if (found) { nextBtn = found; break; }
  }
  if (!nextBtn) return 0;
  let clicks = 0;
  for (let i = 0; i < maxClicks; i++) {
    try { nextBtn.click(); } catch (_) { break; }
    clicks++;
    await SLEEP(200);
  }
  return clicks;
}

/**
 * Reveal contact on PropertyGuru SG (May 2026 layout).
 *
 * The contact widget is identified by `da-id` attributes — PG's internal
 * test-id system. Real selectors in the wild:
 *   - `a[da-id="enquiry-widget-contact-btn"]`  → "Contact Agent" entry button
 *   - After clicking it, an enquiry panel mounts with a "View Phone Number"
 *     button that has its own da-id; we also fall back to text matching.
 *
 * Clicking "Contact Agent" → "View Phone Number" reveals the digits inline
 * and writes a tel:+65... link; this flow does NOT message the agent (only
 * "View Phone Number" outside the WhatsApp button is safe).
 */
/**
 * Capture-mode interceptor.
 *
 * PG's "View Phone Number" button doesn't write the phone into the page —
 * it calls `window.open('tel:+65xxxxxxxx', '_blank')` which causes the OS
 * to launch FaceTime/Phone. To capture the number without leaving the
 * page, we monkey-patch window.open and trap click events on tel:/wa.me
 * anchors during the reveal flow, then restore originals afterwards.
 */
const _capturedContact = { phone: '', whatsapp: '' };

function pickFromUrl(url) {
  if (!url) return;
  const tel = url.match(/^tel:(\+?\d[\d\s\-]+)/i);
  if (tel) {
    const num = tel[1].replace(/[^\d+]/g, '');
    if (num.length >= 8 && !_capturedContact.phone) _capturedContact.phone = num;
  }
  const wa = url.match(/wa\.me\/(\+?\d[\d\s\-]+)/i) || url.match(/api\.whatsapp\.com.*?phone=(\+?\d[\d\s\-]+)/i);
  if (wa) {
    const num = wa[1].replace(/[^\d+]/g, '');
    if (num.length >= 8 && !_capturedContact.whatsapp) _capturedContact.whatsapp = num;
  }
}

function installContactInterceptor() {
  _capturedContact.phone = '';
  _capturedContact.whatsapp = '';

  const origOpen = window.open;
  const origAssign = window.location.assign?.bind(window.location);
  const captureClick = (ev) => {
    const a = ev.target?.closest?.('a[href]');
    if (!a) return;
    const href = a.getAttribute('href') || '';
    if (/^tel:/i.test(href) || /wa\.me/i.test(href) || /api\.whatsapp\.com/i.test(href)) {
      pickFromUrl(href);
      ev.preventDefault();
      ev.stopPropagation();
    }
  };

  window.open = function patchedOpen(url, ...rest) {
    pickFromUrl(String(url || ''));
    if (typeof url === 'string' && (/^tel:/i.test(url) || /wa\.me/i.test(url) || /api\.whatsapp\.com/i.test(url))) {
      // swallow — don't actually open FaceTime / WhatsApp Web
      return null;
    }
    return origOpen.apply(window, [url, ...rest]);
  };

  document.addEventListener('click', captureClick, true);

  return function uninstall() {
    window.open = origOpen;
    document.removeEventListener('click', captureClick, true);
  };
}

const _revealLog = [];

function describeEl(el) {
  if (!el) return null;
  return {
    tag: el.tagName?.toLowerCase(),
    daId: el.getAttribute?.('da-id'),
    className: typeof el.className === 'string' ? el.className.slice(0, 80) : '',
    href: el.getAttribute?.('href'),
    text: (el.textContent || '').trim().slice(0, 60),
  };
}

function logReveal(step, info) {
  _revealLog.push({ step, ts: Date.now(), ...info });
}

async function revealContact() {
  _revealLog.length = 0;
  const uninstall = installContactInterceptor();
  try {
    return await runRevealSteps();
  } finally {
    uninstall();
  }
}

/**
 * Find the SMALLEST element on the page whose own text content matches `re`.
 * Mirrors the Playwright scraper strategy in backend/src/lib/scrapers/propertyGuru.ts:
 *   1. Prefer elements where `re` matches the element's OWN direct text
 *      (text nodes only, not including descendants).
 *   2. Fall back to the smallest element whose innerText matches.
 * This avoids matching huge parent containers that happen to contain the
 * phrase somewhere deep inside.
 */
function findSmallestByText(re) {
  const all = Array.from(document.querySelectorAll('div, button, span, a, p, summary, details, li'));
  // Pass 1 — direct text only
  for (const el of all) {
    const directText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => (n.textContent || '').trim())
      .join(' ');
    if (re.test(directText)) return el;
  }
  // Pass 2 — smallest innerText match
  let best = null;
  let bestLen = Infinity;
  for (const el of all) {
    const text = (el.innerText || '').trim();
    if (re.test(text) && text.length < bestLen) {
      bestLen = text.length;
      best = el;
    }
  }
  return best;
}

async function runRevealSteps() {
  await closeAnyOpenDialog();

  // Step 1 — find & scroll "Other ways to enquire" into view, then click it.
  const enquireRe = /other\s+ways?\s+to\s+enquir/i;
  const enquireEl = findSmallestByText(enquireRe);
  if (enquireEl) {
    enquireEl.scrollIntoView({ block: 'center', behavior: 'instant' });
    logReveal('found-other-ways', { picked: describeEl(enquireEl) });
    await SLEEP(150);
    try { enquireEl.click(); } catch (_) {}
    await SLEEP(500);
    logReveal('clicked-other-ways', {});
  } else {
    logReveal('other-ways-not-found', {});
  }

  // Step 2 — find & click "View Phone Number".
  const viewPhoneRe = /view\s+phone\s+number/i;
  for (let pass = 0; pass < 3; pass++) {
    const el = findSmallestByText(viewPhoneRe);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      logReveal(`found-view-phone-pass-${pass}`, { picked: describeEl(el) });
      await SLEEP(120);
      try { el.click(); } catch (_) {}
      logReveal(`clicked-view-phone-pass-${pass}`, {});
      break;
    }
    await SLEEP(250);
  }

  // Step 3 — fast poll for the phone digits / tel: link / interceptor capture.
  // Most pages settle within 500ms; we cap at ~3s.
  for (let i = 0; i < 30; i++) {
    const c = extractContactLinks();
    const fromText = extractPhoneFromText();
    if (c.phone || fromText) {
      logReveal('phone-found-in-dom', { phone: c.phone || fromText });
      return true;
    }
    if (_capturedContact.phone || _capturedContact.whatsapp) {
      logReveal('phone-captured-by-interceptor', {
        phone: _capturedContact.phone,
        whatsapp: _capturedContact.whatsapp,
      });
      return true;
    }
    await SLEEP(100);
  }
  logReveal('phone-not-found', {});
  return false;
}

async function scrollToAgentCard() {
  // The agent card on a PG listing always contains the agency disclaimer text
  // "CEA: <regno>" — locate any element holding that and scroll it into view.
  const all = Array.from(document.querySelectorAll('div,section,aside,p,span'));
  const card = all.find((el) => /CEA[:\s]/.test((el.textContent || '').slice(0, 200)));
  if (card) {
    card.scrollIntoView({ block: 'center', behavior: 'instant' });
    await SLEEP(300);
  }
}

/** Look for a SG / intl phone pattern in document.body.innerText (after View Phone). */
function extractPhoneFromText() {
  const txt = document.body?.innerText || '';
  // 1) International format anywhere in the page — high confidence.
  const intl = txt.match(/\+65[\s\-]?\d{4}[\s\-]?\d{4}/) ||
               txt.match(/\+\d{1,3}[\s\-]?\d{4,}[\s\-]?\d{3,}/);
  if (intl) return intl[0].replace(/\s+/g, '');
  // 2) Bare 8-digit number — ONLY accept if it appears within ~50 chars after
  //    a "Phone Number" / "Mobile" label, otherwise it's almost certainly the
  //    PG Listing ID (e.g. "Listing ID - 60244724") which also matches /[689]\d{7}/.
  const labeled = txt.match(/(?:Phone\s*Number|Mobile|Call|WhatsApp)[\s:]*?([689]\d{3}[\s\-]?\d{4})/i);
  if (labeled) return labeled[1].replace(/\s+/g, '');
  return '';
}

/**
 * Debug snapshot — returns up to 6 short outerHTML snippets of elements whose
 * textContent matches contact-related keywords. Used to figure out the right
 * selector when "Reveal contact" doesn't produce a phone number.
 */
function buildContactDebugSnapshot() {
  const keywords = ['view phone', 'phone number', 'other ways to enquire', 'whatsapp web', 'enquire', 'contact agent'];
  const snapshots = [];
  const seen = new Set();
  const all = Array.from(document.querySelectorAll('button, a, div[role="button"], span, h1, h2, h3, h4, h5'));
  for (const el of all) {
    const t = (el.textContent || '').trim().toLowerCase();
    if (!t || t.length > 80) continue;
    if (!keywords.some((k) => t.includes(k))) continue;
    let target = el;
    for (let i = 0; i < 2 && target.parentElement; i++) target = target.parentElement;
    let html = (target.outerHTML || '').slice(0, 1500);
    if (seen.has(html)) continue;
    seen.add(html);
    snapshots.push({
      label: t,
      tag: el.tagName.toLowerCase(),
      ariaExpanded: el.getAttribute('aria-expanded'),
      role: el.getAttribute('role'),
      htmlPreview: html,
    });
    if (snapshots.length >= 6) break;
  }

  // Page-level diagnostics — useful when the keyword sweep returns nothing
  const dialogs = Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"]'))
    .map((d) => ({
      ariaLabel: d.getAttribute('aria-label'),
      visible: d.offsetParent !== null,
      htmlHead: (d.outerHTML || '').slice(0, 300),
    }));

  // All unique data-* attribute keys + a sample of testid values
  const allEls = Array.from(document.querySelectorAll('*'));
  const testidValues = new Set();
  const automationIdValues = new Set();
  const daIdValues = new Set();
  for (const el of allEls) {
    const ti = el.getAttribute('data-testid');
    const ai = el.getAttribute('data-automation-id');
    const di = el.getAttribute('da-id'); // PG's own test-id attribute
    if (ti) testidValues.add(ti);
    if (ai) automationIdValues.add(ai);
    if (di) daIdValues.add(di);
  }

  // Around-keyword snippets in raw innerText
  const text = document.body?.innerText || '';
  const keywordHits = [];
  for (const kw of keywords) {
    const idx = text.toLowerCase().indexOf(kw);
    if (idx >= 0) {
      keywordHits.push({
        keyword: kw,
        snippet: text.slice(Math.max(0, idx - 60), idx + 120).replace(/\s+/g, ' '),
      });
    }
  }

  return {
    url: location.href,
    revealLog: _revealLog.slice(),
    keywordMatches: snapshots,
    keywordHitsInText: keywordHits,
    openDialogs: dialogs,
    daIdSamples: Array.from(daIdValues).filter((v) => /phone|contact|enquir|whatsapp|agent/i.test(v)).slice(0, 30),
    daIdAll: Array.from(daIdValues).slice(0, 60),
    testidSamples: Array.from(testidValues).filter((v) => /phone|contact|enquir|whatsapp|agent/i.test(v)).slice(0, 30),
    automationIdSamples: Array.from(automationIdValues).filter((v) => /phone|contact|enquir|whatsapp|agent/i.test(v)).slice(0, 30),
    allTestidCount: testidValues.size,
    allAutomationIdCount: automationIdValues.size,
    allDaIdCount: daIdValues.size,
  };
}

async function runAdvanced(options) {
  // Fast path — if "About this property" prose is already mounted and the
  // page has substantive text, skip scroll/expand entirely and go straight
  // to reveal. Saves ~1.2s on most listings.
  const initialDescription = extractAboutThisProperty();
  const initialChars = (document.body?.innerText || '').length;
  const needsHydration = !initialDescription || initialChars < 4000;

  if (needsHydration) {
    await smoothScrollToBottom();
    await clickAllExpanders();
  }

  if (options?.revealContact) {
    await closeAnyOpenDialog();
    await revealContact();
  }
  await SLEEP(80);
}

/* ─── MESSAGE HANDLER ─────────────────────────────────────────────────── */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'PG_EXTRACT') return false;
  (async () => {
    try {
      if (msg.advanced) {
        await runAdvanced({ revealContact: !!msg.revealContact });
      }
      const data = extractListing();
      data.advanced = !!msg.advanced;
      // When user asked to reveal contact but we couldn't get a phone, attach
      // a small DOM snapshot so we can adjust the selector.
      if (msg.advanced && msg.revealContact && !data.coAgent?.phone) {
        data._debug = { contactSnapshot: buildContactDebugSnapshot() };
      }
      sendResponse({ ok: true, data });
    } catch (err) {
      sendResponse({ ok: false, error: String(err?.message || err) });
    }
  })();
  return true; // async
});

/* ─── AUTO MODE ──────────────────────────────────────────────────────────
 * When the user clicks "Import" in Butler, Butler opens this PG URL with
 * `?butlerImport=<tourId>&taskId=<rand>` appended. The content script picks
 * that up, runs advanced+reveal, hands the listing to background.js for
 * backend insertion, then asks background to close the tab once done.
 * Butler is notified via background → externalMessage so it can refresh
 * and highlight the new listing.
 */

(async function autoModeIfRequested() {
  try {
    const params = new URLSearchParams(location.search);
    const butlerImportTourId = params.get('butlerImport');
    if (!butlerImportTourId) return;

    const taskId = params.get('taskId') || `task-${Date.now()}`;
    const reveal = params.get('reveal') !== '0'; // default ON

    const ui = mountFloatingPanel();
    ui.setState('working', 'Extracting listing…');

    // Wait for the page to settle a bit before extracting.
    await SLEEP(500);

    let listing;
    try {
      await runAdvanced({ revealContact: reveal });
      listing = extractListing();
      listing.advanced = true;
    } catch (err) {
      ui.setState('error', `Extract failed: ${err?.message || err}`);
      notifyButler(butlerImportTourId, taskId, { ok: false, error: String(err?.message || err) });
      return;
    }

    ui.setState('working', 'Saving to Butler…');

    let result;
    try {
      result = await chromeSendMessage({
        type: 'IMPORT_TO_TOUR',
        data: { tourId: butlerImportTourId, listing, sourceUrl: location.href },
      });
    } catch (err) {
      ui.setState('error', `Backend save failed: ${err?.message || err}`);
      notifyButler(butlerImportTourId, taskId, { ok: false, error: String(err?.message || err) });
      return;
    }

    const stats = result?.stats || {};
    const summary = `added=${stats.added ?? 0} merged=${stats.merged ?? 0}`;
    ui.setState('ok', `Imported ${listing.coAgent?.phone ? '☎ ' + listing.coAgent.phone : '(no phone)'} · ${summary}`);

    // Pick the listing id we just imported so Butler can highlight it.
    const importedId = (Array.isArray(result?.listings)
      ? result.listings.find((l) => String(l.propertyGuruUrl || '').includes(listing.listingId))
      : null)?.id || `pg-${listing.listingId}`;

    notifyButler(butlerImportTourId, taskId, { ok: true, importedId, stats });

    // Auto-close the tab after a short delay so the user sees the success state.
    await SLEEP(2000);
    try {
      // Pass taskId so background.js can refocus the Butler tab that kicked
      // this off (looked up via stashTaskOrigin) BEFORE removing this PG tab.
      // Without this, Chrome would just auto-activate whatever tab happened
      // to be next, which usually isn't Butler.
      await chromeSendMessage({ type: 'CLOSE_SELF_TAB', taskId });
    } catch (_) {
      // ignore — popup-blocked or no permission, fall back to staying open
    }
  } catch (err) {
    console.warn('[butler-auto] failed', err);
  }
})();

function notifyButler(tourId, taskId, payload) {
  // Ask background to broadcast to any Butler tab(s).
  try {
    chrome.runtime.sendMessage({ type: 'BUTLER_BROADCAST', tourId, taskId, payload });
  } catch (_) {}
}

function chromeSendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!resp?.ok) return reject(new Error(resp?.error || 'unknown error'));
      resolve(resp.data);
    });
  });
}

/* ─── Floating panel ─── */
function mountFloatingPanel() {
  const el = document.createElement('div');
  el.id = '__butler-import-panel';
  el.style.cssText = [
    'position:fixed', 'right:24px', 'bottom:24px', 'z-index:2147483647',
    'min-width:300px', 'max-width:380px',
    'padding:14px 16px',
    'background:#ffffff', 'color:#111',
    'border-radius:14px',
    'box-shadow:0 10px 40px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.08)',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif',
    'font-size:13px', 'line-height:1.4',
  ].join(';');
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;">
      <div id="__butler-spinner" style="width:18px;height:18px;border:2.5px solid #e5e7eb;border-top-color:#2563eb;border-radius:50%;animation:butlerSpin 0.8s linear infinite;flex:none;"></div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;color:#111;">Butler PG Importer</div>
        <div id="__butler-msg" style="margin-top:2px;color:#374151;white-space:pre-wrap;"></div>
      </div>
    </div>
    <style>@keyframes butlerSpin { to { transform: rotate(360deg); } }</style>
  `;
  document.documentElement.appendChild(el);
  const msgEl = el.querySelector('#__butler-msg');
  const spin = el.querySelector('#__butler-spinner');
  return {
    setState(kind, text) {
      msgEl.textContent = text || '';
      if (kind === 'ok') {
        spin.style.border = '2.5px solid #10b981';
        spin.style.borderTopColor = '#10b981';
        spin.style.animation = 'none';
        spin.textContent = '';
        spin.style.background = '#10b981';
      } else if (kind === 'error') {
        spin.style.border = '2.5px solid #dc2626';
        spin.style.borderTopColor = '#dc2626';
        spin.style.animation = 'none';
        spin.style.background = '#dc2626';
      }
    },
  };
}
