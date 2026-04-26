import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';

/* ─── types ─── */

export interface PropertyGuruListingDetail {
  /** e.g. "Condominium for sale" */
  propertyCategory?: string;
  /** e.g. "Fully furnished" */
  furnishing?: string;
  /** e.g. "TOP in Jun 2019" */
  topDate?: string;
  /** e.g. "99-year lease" */
  tenureDetail?: string;
  /** e.g. "Listed on 23 Apr 2026" */
  listedDate?: string;
  /** e.g. "500088257" */
  detailListingId?: string;
  /** e.g. "Built: 2019" */
  builtYear?: string;
  /** Floor level info */
  floorLevel?: string;
  /** District info */
  district?: string;
  /** Full property details raw text */
  propertyDetailsRaw?: string;
  /** "About this property" description text */
  description?: string;
  /** All detail key-value pairs extracted */
  allDetails?: Record<string, string>;
  /** Agent name from detail page */
  agentName?: string;
  /** Agent phone number, e.g. "+65 9233 2402" (requires login + scrapePhone) */
  agentPhone?: string;
}

export interface PropertyGuruListing {
  index: number;
  url: string;
  listingId?: string;
  title: string;
  address?: string;
  agent?: string;
  price?: number;
  priceLabel?: string;
  psfLabel?: string;
  bedrooms?: number;
  bathrooms?: number;
  areaSqft?: number;
  propertyType?: string;
  tenure?: string;
  listedOn?: string;
  rawText: string;
  /** Detail page information (populated when scrapeDetails is true) */
  detail?: PropertyGuruListingDetail;
}

export interface ScrapePropertyGuruInput {
  url: string;
  limit?: number;
  headless?: boolean;
  timeoutMs?: number;
  debug?: boolean;
  autoVerify?: boolean;
  userDataDir?: string;
  windowWidth?: number;
  windowHeight?: number;
  maxRetries?: number;
  /** If true, click into each listing page to scrape Property details + About (default: false) */
  scrapeDetails?: boolean;
  /** If true, click "Other ways to enquire" → "View Phone Number" to get agent phone (requires login, default: false) */
  scrapePhone?: boolean;
}

/* ─── constants ─── */

const DEFAULT_WINDOW_WIDTH = 1440;
const DEFAULT_WINDOW_HEIGHT = 900;
const CHALLENGE_POLL_INTERVAL = 1500;
const MAX_VERIFY_RETRIES = 3;

/* ─── helpers ─── */

function getDefaultProfileDir() {
  return path.resolve(process.cwd(), '.playwright', 'propertyguru-profile');
}

function normalizeWhitespace(value: string | null | undefined) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function uniqueNonEmpty(lines: string[]) {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const line of lines) {
    const normalized = normalizeWhitespace(line);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function parsePrice(value: string) {
  const match = value.match(/S\$\s*([\d,]+)/i);
  if (!match) return undefined;
  return Number(match[1].replace(/,/g, ''));
}

function parseIntegerAfterToken(value: string, token: string) {
  const match = value.match(new RegExp(`${token}\\s*(\\d+)`, 'i'));
  if (!match) return undefined;
  return Number(match[1]);
}

function parseIntegerBeforeToken(value: string, token: string) {
  const match = value.match(new RegExp(`(\\d[\\d,]*)\\s*${token}`, 'i'));
  if (!match) return undefined;
  return Number(match[1].replace(/,/g, ''));
}

function parseListedOn(value: string) {
  const match = value.match(/Listed on (.+?)(?:Contact Agent|$)/i);
  return match ? normalizeWhitespace(match[1]) : undefined;
}

function parseListingIdFromUrl(value: string) {
  const match = value.match(/-(\d{6,})$/);
  return match?.[1];
}

function log(debug: boolean, message: string, meta?: Record<string, unknown>) {
  if (!debug) return;
  const payload = meta ? ` ${JSON.stringify(meta)}` : '';
  console.error(`[propertyguru] ${message}${payload}`);
}

/** Random delay between min and max ms — makes behavior look more human */
function randomDelay(min: number, max: number) {
  return Math.floor(Math.random() * (max - min)) + min;
}

/**
 * Send a mouse event via Chrome DevTools Protocol (CDP).
 * CDP-dispatched events bypass Playwright's synthetic event markers and
 * are much harder for Cloudflare Turnstile to distinguish from real input.
 */
async function cdpMouseEvent(
  cdp: any,
  type: 'mouseMoved' | 'mousePressed' | 'mouseReleased',
  x: number,
  y: number,
  button?: 'left'
) {
  const params: Record<string, any> = { type, x, y };
  if (button) {
    params.button = button;
    params.clickCount = 1;
  }
  await cdp.send('Input.dispatchMouseEvent', params);
}

/** Simulate a human-like mouse move via CDP, then click */
async function humanMouseMoveCDP(
  cdp: any,
  targetX: number,
  targetY: number,
  debug: boolean
) {
  const startX = Math.random() * 400 + 100;
  const startY = Math.random() * 300 + 100;
  const steps = Math.floor(Math.random() * 12) + 8;

  log(debug, 'cdp-mouse-move', { from: { x: startX, y: startY }, to: { x: targetX, y: targetY }, steps });

  for (let i = 0; i <= steps; i++) {
    const progress = i / steps;
    const ease = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;

    const x = startX + (targetX - startX) * ease + (Math.random() - 0.5) * 2;
    const y = startY + (targetY - startY) * ease + (Math.random() - 0.5) * 2;

    await cdpMouseEvent(cdp, 'mouseMoved', x, y);
    // Small human-like delay between move steps
    await new Promise(r => setTimeout(r, randomDelay(8, 30)));
  }

  // Final precise move
  await cdpMouseEvent(cdp, 'mouseMoved', targetX, targetY);
}

/** CDP-based click: move → press → release with realistic timing */
async function humanClickCDP(
  cdp: any,
  x: number,
  y: number,
  debug: boolean
) {
  await humanMouseMoveCDP(cdp, x, y, debug);
  await new Promise(r => setTimeout(r, randomDelay(50, 150)));
  await cdpMouseEvent(cdp, 'mousePressed', x, y, 'left');
  await new Promise(r => setTimeout(r, randomDelay(40, 120)));
  await cdpMouseEvent(cdp, 'mouseReleased', x, y, 'left');
  log(debug, 'cdp-click', { x, y });
}

/** Fallback: Simulate a human-like mouse move using Playwright page.mouse */
async function humanMouseMove(page: Page, targetX: number, targetY: number, debug: boolean) {
  const startX = Math.random() * 400 + 100;
  const startY = Math.random() * 300 + 100;
  const steps = Math.floor(Math.random() * 15) + 10;

  log(debug, 'human-mouse-move', { from: { x: startX, y: startY }, to: { x: targetX, y: targetY }, steps });

  for (let i = 0; i <= steps; i++) {
    const progress = i / steps;
    const ease = progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;

    const x = startX + (targetX - startX) * ease + (Math.random() - 0.5) * 3;
    const y = startY + (targetY - startY) * ease + (Math.random() - 0.5) * 3;

    await page.mouse.move(x, y);
    await page.waitForTimeout(randomDelay(5, 25));
  }

  await page.mouse.move(targetX, targetY);
}

/** Get CDP session for a page, returns null if unavailable */
async function getCDP(page: Page, debug: boolean): Promise<any | null> {
  try {
    const cdp = await (page.context() as any).newCDPSession(page);
    log(debug, 'cdp-session-created');
    return cdp;
  } catch (err) {
    log(debug, 'cdp-session-failed', { error: String(err) });
    return null;
  }
}

/* ─── listing parser ─── */

function pickTitle(lines: string[], fallbackUrl: string) {
  const ignored = new Set([
    'Contact',
    'Hide Property',
    'Shortlist Property',
    'Verified Listing',
    'Contact Agent'
  ]);

  for (const line of lines) {
    if (!line) continue;
    if (ignored.has(line)) continue;
    if (/^S\$\s*[\d,]+/.test(line)) continue;
    if (/^\d+\s*$/.test(line)) continue;
    if (/sqft|leasehold|built:|listed on|propertyguru/i.test(line)) continue;
    if (/^(HDB Flat|Condominium|Apartment|Executive Condominium|Terraced House|Detached House|Semi-Detached House)$/i.test(line)) continue;
    if (/^(Photos?|Floor Plan|Video|Virtual Tour)$/i.test(line)) continue;
    return line;
  }

  return fallbackUrl.split('/').pop()?.replace(/-/g, ' ') || fallbackUrl;
}

function parseListing(raw: { url: string; text: string }, index: number): PropertyGuruListing {
  const lines = uniqueNonEmpty(raw.text
    .split('\n')
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean));
  const rawText = lines.join('\n');

  const priceLine = lines.find((line) => /^S\$\s*[\d,]+/.test(line));
  const psfLine = lines.find((line) => /psf/i.test(line));
  const addressCandidates = lines.filter((line) => (
    !/^S\$\s*[\d,]+/.test(line) &&
    !/psf/i.test(line) &&
    !/listed on/i.test(line) &&
    !/leasehold|built:/i.test(line) &&
    !/contact|shortlist|hide property|photos?|floor plan|video|virtual tour/i.test(line) &&
    /road|street|avenue|drive|crescent|lane|close|place|way|walk|rise|view|plain|central|terrace|boulevard|silat|shunfu|choa chu kang|woodlands|west coast|jurong|strathmore/i.test(line)
  ));
  const addressLine = addressCandidates[0];
  const agentLine = lines.find((line) => /REALTY|PROPNEX|HUTTONS|ERA|SRI|HOMES|PROPERTY|PTE LTD/i.test(line));
  const propertyTypeLine = lines.find((line) => /HDB Flat|Condominium|Apartment|Executive Condominium|Terraced House|Detached House|Semi-Detached House/i.test(line));
  const tenureLine = lines.find((line) => /leasehold|freehold/i.test(line));
  const title = lines.find((line) => /^For Sale\b/i.test(line) || /^For Rent\b/i.test(line) || /^Modern\b/i.test(line) || /^Rare\b/i.test(line) || /^Huge\b/i.test(line) || /^Newly\b/i.test(line)) || pickTitle(lines, raw.url);
  const bedsIndex = lines.findIndex((line) => /^3$|^4$|^2$|^5$/.test(line));

  return {
    index,
    url: raw.url,
    listingId: parseListingIdFromUrl(raw.url),
    title,
    address: addressLine,
    agent: agentLine,
    price: priceLine ? parsePrice(priceLine) : undefined,
    priceLabel: priceLine,
    psfLabel: psfLine,
    bedrooms: bedsIndex >= 0 ? Number(lines[bedsIndex]) : parseIntegerBeforeToken(rawText, 'Beds?') ?? parseIntegerAfterToken(rawText, 'Bedrooms?'),
    bathrooms: bedsIndex >= 0 && lines[bedsIndex + 1] && /^\d+$/.test(lines[bedsIndex + 1]) ? Number(lines[bedsIndex + 1]) : parseIntegerBeforeToken(rawText, 'Baths?') ?? parseIntegerAfterToken(rawText, 'Bathrooms?'),
    areaSqft: parseIntegerBeforeToken(rawText, 'sqft'),
    propertyType: propertyTypeLine,
    tenure: tenureLine,
    listedOn: parseListedOn(rawText),
    rawText
  };
}

/* ─── detail page scraper ─── */

/**
 * Navigate to a listing detail page, extract "Property details" and "About this property".
 * Uses the same page to avoid opening too many tabs.
 */
async function scrapeListingDetail(
  page: Page,
  listingUrl: string,
  cdp: any | null,
  autoVerify: boolean,
  timeoutMs: number,
  maxRetries: number,
  debug: boolean,
  scrapePhone: boolean = false
): Promise<PropertyGuruListingDetail> {
  log(debug, 'detail-navigate', { url: listingUrl });

  await page.goto(listingUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  await page.waitForTimeout(randomDelay(1500, 3000));

  // Handle Cloudflare if triggered
  if (await isInChallenge(page)) {
    log(debug, 'challenge-on-detail-page');
    await handleCloudflareChallenge(page, cdp, autoVerify, timeoutMs, maxRetries, debug);
  }

  // Wait for page content to load
  try {
    await page.waitForSelector('h3, [class*="property-detail"], [class*="about"], [data-testid]', {
      timeout: 15000
    });
  } catch {
    log(debug, 'detail-selector-timeout', { url: listingUrl });
  }
  await page.waitForTimeout(randomDelay(500, 1500));

  // Extract Property details and About this property from the page
  const detail = await page.evaluate(() => {
    const result: Record<string, any> = {};
    const allDetails: Record<string, string> = {};

    // --- Strategy 1: Find "Property details" section ---
    // Look for a heading that says "Property details"
    const headings = Array.from(document.querySelectorAll('h3, h2, h4, [class*="heading"]'));
    let propertyDetailsSection: Element | null = null;
    let aboutSection: Element | null = null;

    for (const h of headings) {
      const text = h.textContent?.trim() || '';
      if (/property\s*details/i.test(text)) {
        propertyDetailsSection = h;
      }
      if (/about\s*this\s*property/i.test(text)) {
        aboutSection = h;
      }
    }

    // Extract property details: walk sibling/parent elements after the heading
    if (propertyDetailsSection) {
      // Get the container that holds all the detail items
      let container = propertyDetailsSection.parentElement;
      // Try to find a wider container if the heading is deeply nested
      for (let i = 0; i < 3 && container; i++) {
        const text = container.textContent || '';
        if (text.includes('Listing ID') || text.includes('lease') || text.includes('TOP in')) {
          break;
        }
        container = container.parentElement;
      }

      if (container) {
        result.propertyDetailsRaw = container.innerText?.trim();

        // Parse key-value pairs from the details section
        const detailText = container.innerText || '';
        const lines = detailText.split('\n').map((l: string) => l.trim()).filter(Boolean);

        for (const line of lines) {
          // "Condominium for sale"
          if (/^(Condominium|HDB|Apartment|Terraced|Detached|Semi-Detached|Executive)\b.*\bfor\s+(sale|rent)\b/i.test(line)) {
            result.propertyCategory = line;
            allDetails['Property Category'] = line;
          }
          // "Fully furnished" / "Partially furnished" / "Unfurnished"
          if (/\b(fully|partially)\s*furnished|unfurnished/i.test(line)) {
            result.furnishing = line;
            allDetails['Furnishing'] = line;
          }
          // "TOP in Jun 2019"
          if (/^TOP\s+in\s+/i.test(line)) {
            result.topDate = line;
            allDetails['TOP'] = line;
          }
          // "99-year lease" / "Freehold"
          if (/\d+-year\s+lease|freehold/i.test(line)) {
            result.tenureDetail = line;
            allDetails['Tenure'] = line;
          }
          // "Listed on 23 Apr 2026"
          if (/^Listed\s+on\s+/i.test(line)) {
            result.listedDate = line;
            allDetails['Listed Date'] = line;
          }
          // "Listing ID - 500088257"
          if (/Listing\s*ID/i.test(line)) {
            const match = line.match(/(\d{6,})/);
            if (match) {
              result.detailListingId = match[1];
              allDetails['Listing ID'] = match[1];
            }
          }
          // "Built: 2019" or "Built in 2019"
          if (/^Built[\s:]+/i.test(line)) {
            result.builtYear = line;
            allDetails['Built'] = line;
          }
          // Floor level
          if (/\b(high|mid|low)\s+floor/i.test(line)) {
            result.floorLevel = line;
            allDetails['Floor Level'] = line;
          }
          // District
          if (/^D\d+\b/i.test(line) || /^District\s+\d+/i.test(line)) {
            result.district = line;
            allDetails['District'] = line;
          }
        }
      }
    }

    // --- Strategy 2: fallback — look for common detail item patterns ---
    if (!result.propertyDetailsRaw) {
      // Try data-testid or class-based selectors
      const detailItems = Array.from(document.querySelectorAll(
        '[class*="detail-item"], [class*="property-attr"], [class*="info-row"], [class*="listing-detail"] li, [class*="PropertyType"]'
      ));
      if (detailItems.length > 0) {
        const texts = detailItems.map(el => (el as HTMLElement).innerText?.trim()).filter(Boolean);
        result.propertyDetailsRaw = texts.join('\n');
      }
    }

    // --- Extract "About this property" description ---
    if (aboutSection) {
      let descContainer = aboutSection.parentElement;
      for (let i = 0; i < 3 && descContainer; i++) {
        const text = descContainer.textContent || '';
        if (text.length > 100) break;
        descContainer = descContainer.parentElement;
      }

      if (descContainer) {
        // Get all paragraphs/text after the "About" heading
        const descParts: string[] = [];
        let foundHeading = false;
        const walker = document.createTreeWalker(descContainer, NodeFilter.SHOW_ELEMENT);
        let node: Node | null = walker.currentNode;

        while (node) {
          if (node === aboutSection) {
            foundHeading = true;
          } else if (foundHeading && node instanceof HTMLElement) {
            const tag = node.tagName.toLowerCase();
            // Stop if we hit another section heading
            if (/^h[2-4]$/.test(tag) && node !== aboutSection) break;
            if (['p', 'div', 'span'].includes(tag)) {
              const t = node.innerText?.trim();
              if (t && t.length > 20 && !/see (more|all|less)/i.test(t)) {
                descParts.push(t);
              }
            }
          }
          node = walker.nextNode();
        }

        // Deduplicate and join
        const seen = new Set<string>();
        const unique = descParts.filter(p => {
          if (seen.has(p)) return false;
          // Skip if it's a substring of an already-seen longer text
          for (const s of seen) {
            if (s.includes(p) || p.includes(s)) {
              if (p.length > s.length) {
                seen.delete(s);
                seen.add(p);
              }
              return false;
            }
          }
          seen.add(p);
          return true;
        });
        result.description = unique.join('\n\n');
      }
    }

    // Fallback for description: look for meta description or class-based
    if (!result.description) {
      // Try common description selectors
      const descSelectors = [
        '[class*="about"] p',
        '[class*="description"] p',
        '[class*="listing-description"]',
        'meta[name="description"]'
      ];
      for (const sel of descSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const text = sel.startsWith('meta')
            ? (el as HTMLMetaElement).content
            : (el as HTMLElement).innerText?.trim();
          if (text && text.length > 30) {
            result.description = text;
            break;
          }
        }
      }
    }

    // Try to click "See more" to expand full description
    // (we'll handle this with a separate step)

    result.allDetails = allDetails;
    return result;
  });

  // Try to expand "See more" for description if it exists
  try {
    const seeMoreBtn = page.locator('button:has-text("See more"), a:has-text("See more"), [class*="see-more"]').first();
    if (await seeMoreBtn.count() > 0) {
      await seeMoreBtn.click();
      await page.waitForTimeout(randomDelay(500, 1000));

      // Re-extract the expanded description
      const expandedDesc = await page.evaluate(() => {
        const headings = Array.from(document.querySelectorAll('h3, h2, h4'));
        for (const h of headings) {
          if (/about\s*this\s*property/i.test(h.textContent || '')) {
            let container = h.parentElement;
            for (let i = 0; i < 4 && container; i++) {
              const text = container.textContent || '';
              if (text.length > 200) break;
              container = container.parentElement;
            }
            if (container) {
              // Get text after the heading
              const fullText = container.innerText || '';
              const idx = fullText.indexOf('About this property');
              if (idx >= 0) {
                let desc = fullText.slice(idx + 'About this property'.length).trim();
                // Remove "See less" etc.
                desc = desc.replace(/\bSee (more|less|all details?)\b/gi, '').trim();
                return desc || null;
              }
            }
          }
        }
        return null;
      });

      if (expandedDesc && expandedDesc.length > (detail.description?.length || 0)) {
        detail.description = expandedDesc;
      }
    }
  } catch (err) {
    log(debug, 'see-more-click-failed', { error: String(err) });
  }

  // --- Scrape agent phone number (requires logged-in PG account) ---
  if (scrapePhone) {
    log(debug, 'phone-scrape-start', { url: listingUrl });

    try {
      // First, try to extract agent name from the page
      const agentName = await page.evaluate(() => {
        const agentSelectors = [
          '[class*="agent-name"]',
          '[class*="AgentName"]',
          '[data-testid*="agent-name"]',
          '[class*="listing-agent"] a',
          '[class*="agent-info"] a',
          '[class*="agent"] h2',
          '[class*="agent"] h3',
        ];
        for (const sel of agentSelectors) {
          const el = document.querySelector(sel);
          if (el) {
            const text = (el as HTMLElement).innerText?.trim();
            if (text && text.length > 1 && text.length < 60) return text;
          }
        }
        return null;
      });

      if (agentName) {
        detail.agentName = agentName;
        log(debug, 'agent-name-found', { agentName });
      }

      // ── Step 1: Scroll to the agent card / "Other ways to enquire" area ──
      // The agent contact section is typically in the right sidebar or lower on page.
      // We need to scroll it into view BEFORE trying to click anything.
      log(debug, 'scrolling-to-agent-card');

      const scrolledToEnquire = await page.evaluate(() => {
        // Find the element whose OWN direct text (not children's) matches
        const allEls = Array.from(document.querySelectorAll('div, button, span, a, p, summary, details'));
        for (const el of allEls) {
          // Check only direct text content (excluding children) to avoid matching
          // huge parent containers that happen to contain "Other ways to enquire" somewhere deep inside
          const directText = Array.from(el.childNodes)
            .filter(n => n.nodeType === Node.TEXT_NODE)
            .map(n => n.textContent?.trim() || '')
            .join(' ');
          if (/other\s+ways?\s+to\s+enquir/i.test(directText)) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            return { found: true, tag: el.tagName, text: directText.slice(0, 60) };
          }
        }
        // Fallback: match innerText but pick the SMALLEST matching element (most specific)
        let bestEl: Element | null = null;
        let bestLen = Infinity;
        for (const el of allEls) {
          const text = (el as HTMLElement).innerText?.trim() || '';
          if (/other\s+ways?\s+to\s+enquir/i.test(text) && text.length < bestLen) {
            bestLen = text.length;
            bestEl = el;
          }
        }
        if (bestEl) {
          bestEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return { found: true, tag: bestEl.tagName, text: (bestEl as HTMLElement).innerText?.trim().slice(0, 60) };
        }
        return { found: false };
      });

      log(debug, 'scroll-to-enquire-result', scrolledToEnquire);
      await page.waitForTimeout(randomDelay(800, 1500));

      // ── Step 2: Click "Other ways to enquire" ──
      let enquireExpanded = false;

      if (scrolledToEnquire.found) {
        // Use evaluate to find and click the MOST SPECIFIC element
        enquireExpanded = await page.evaluate(() => {
          const allEls = Array.from(document.querySelectorAll('div, button, span, a, p, summary, details'));
          // First try: elements whose own text matches
          for (const el of allEls) {
            const directText = Array.from(el.childNodes)
              .filter(n => n.nodeType === Node.TEXT_NODE)
              .map(n => n.textContent?.trim() || '')
              .join(' ');
            if (/other\s+ways?\s+to\s+enquir/i.test(directText)) {
              (el as HTMLElement).click();
              return true;
            }
          }
          // Fallback: smallest innerText match
          let bestEl: HTMLElement | null = null;
          let bestLen = Infinity;
          for (const el of allEls) {
            const text = (el as HTMLElement).innerText?.trim() || '';
            if (/other\s+ways?\s+to\s+enquir/i.test(text) && text.length < bestLen) {
              bestLen = text.length;
              bestEl = el as HTMLElement;
            }
          }
          if (bestEl) {
            bestEl.click();
            return true;
          }
          return false;
        });

        if (enquireExpanded) {
          log(debug, 'clicked-other-ways-to-enquire');
          await page.waitForTimeout(randomDelay(1000, 2000));
        }
      }

      log(debug, 'enquire-expanded', { success: enquireExpanded });

      // ── Step 3: Click "View Phone Number" button ──
      if (enquireExpanded) {
        // Scroll to and click "View Phone Number" the same way
        const phoneRevealed = await page.evaluate(() => {
          const allEls = Array.from(document.querySelectorAll('div, button, span, a, p'));
          // First try: own direct text
          for (const el of allEls) {
            const directText = Array.from(el.childNodes)
              .filter(n => n.nodeType === Node.TEXT_NODE)
              .map(n => n.textContent?.trim() || '')
              .join(' ');
            if (/view\s+phone\s+number/i.test(directText)) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              (el as HTMLElement).click();
              return true;
            }
          }
          // Fallback: smallest innerText match
          let bestEl: HTMLElement | null = null;
          let bestLen = Infinity;
          for (const el of allEls) {
            const text = (el as HTMLElement).innerText?.trim() || '';
            if (/view\s+phone\s+number/i.test(text) && text.length < bestLen) {
              bestLen = text.length;
              bestEl = el as HTMLElement;
            }
          }
          if (bestEl) {
            bestEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
            bestEl.click();
            return true;
          }
          return false;
        });

        log(debug, 'phone-revealed', { success: phoneRevealed });

        if (phoneRevealed) {
          await page.waitForTimeout(randomDelay(1500, 2500));
        }
      }

      // ── Step 4: Extract the phone number ──
      // Try multiple strategies to find the phone number now visible on page
      const phoneNumber = await page.evaluate(() => {
        const phoneRegex = /\+65[\s\-]?\d{4}[\s\-]?\d{4}/;
        const intlPhoneRegex = /\+\d{1,3}[\s\-]?\d{4,}[\s\-]?\d{3,}/;
        // Also match bare SG numbers like "9233 2402" or "92332402"
        const bareSgRegex = /\b[689]\d{3}[\s\-]?\d{4}\b/;

        // Strategy 1: tel: links (most reliable — the phone number is in the href)
        const telLinks = Array.from(document.querySelectorAll('a[href^="tel:"]'));
        for (const link of telLinks) {
          const href = (link as HTMLAnchorElement).href;
          const num = href.replace('tel:', '').replace(/\s+/g, '').trim();
          if (num.length >= 8) return num;
        }

        // Strategy 2: Look near "Phone Number" label text
        const allEls = Array.from(document.querySelectorAll('div, span, a, p, li'));
        for (const el of allEls) {
          const text = (el as HTMLElement).innerText?.trim() || '';
          if (/phone\s*number/i.test(text) && text.length < 120) {
            const container = el.closest('div, section, li') || el.parentElement;
            if (container) {
              const cText = (container as HTMLElement).innerText || '';
              const match = cText.match(phoneRegex) || cText.match(intlPhoneRegex) || cText.match(bareSgRegex);
              if (match) return match[0].trim();
            }
          }
        }

        // Strategy 3: Search the agent/contact/enquire area for phone patterns
        const areaSelectors = [
          '[class*="contact"]', '[class*="agent"]', '[class*="enquir"]',
          '[class*="phone"]', '[class*="Phone"]', '[data-testid*="phone"]'
        ];
        for (const sel of areaSelectors) {
          const areas = Array.from(document.querySelectorAll(sel));
          for (const area of areas) {
            const text = (area as HTMLElement).innerText || '';
            const match = text.match(phoneRegex) || text.match(intlPhoneRegex);
            if (match) return match[0].trim();
          }
        }

        // Strategy 4: Any +65 number visible on page (narrowly scoped to short text)
        for (const el of allEls) {
          const text = (el as HTMLElement).innerText?.trim() || '';
          if (text.length < 25) {
            const match = text.match(phoneRegex);
            if (match) return match[0].trim();
          }
        }

        return null;
      });

      if (phoneNumber) {
        detail.agentPhone = phoneNumber;
        log(debug, 'phone-number-extracted', { phone: phoneNumber });
        console.error(`    📞 Agent phone: ${phoneNumber}`);
      } else {
        log(debug, 'phone-number-not-found');
        console.error(`    ⚠️  Phone number not found (may need login or different page structure)`);

        // Debug: dump visible text around the agent area to help diagnose
        if (debug) {
          const debugInfo = await page.evaluate(() => {
            const areas = Array.from(document.querySelectorAll('[class*="agent"], [class*="enquir"], [class*="contact"], [class*="phone"]'));
            return areas.slice(0, 5).map(el => ({
              tag: el.tagName,
              class: el.className?.toString().slice(0, 80),
              text: (el as HTMLElement).innerText?.trim().slice(0, 200)
            }));
          });
          log(debug, 'phone-debug-area-dump', { areas: debugInfo });
        }
      }
    } catch (err) {
      log(debug, 'phone-scrape-error', { error: String(err) });
      console.error(`    ⚠️  Phone scrape error: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  log(debug, 'detail-scraped', {
    url: listingUrl,
    hasPropertyDetails: !!detail.propertyDetailsRaw,
    hasDescription: !!detail.description,
    agentPhone: detail.agentPhone || null,
    detailKeys: Object.keys(detail.allDetails || {})
  });

  return detail as PropertyGuruListingDetail;
}

/* ─── Cloudflare Turnstile / challenge handling ─── */

/** Check if the page is currently showing a Cloudflare challenge */
async function isInChallenge(page: Page): Promise<boolean> {
  const title = await page.title();
  const bodyText = normalizeWhitespace(
    await page.locator('body').innerText().catch(() => '')
  );
  return (
    /just a moment|security verification|attention required/i.test(title) ||
    /verify you are human|performing security verification|checking your browser/i.test(bodyText)
  );
}

/** Wait up to `timeoutMs` for the challenge page to disappear */
async function waitForChallengeToClear(page: Page, timeoutMs: number, debug: boolean): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!(await isInChallenge(page))) {
      log(debug, 'challenge-cleared', { waitedMs: Date.now() - start });
      return false; // challenge cleared
    }
    await page.waitForTimeout(CHALLENGE_POLL_INTERVAL);
  }
  log(debug, 'challenge-still-active', { waitedMs: Date.now() - start });
  return true; // still in challenge
}

/**
 * Find the Cloudflare Turnstile iframe and click inside it using page.mouse.
 *
 * Key insight: The Turnstile iframe is cross-origin, so we CANNOT access its
 * internal DOM from Playwright. Instead we:
 *   1. Find the <iframe> element on the main page via its `src` attribute
 *   2. Get the iframe element's bounding box in viewport coordinates
 *   3. Click inside that box with page.mouse (human-like trajectory)
 *
 * The Turnstile checkbox is typically in the left-center of a ~300×65 widget.
 */
async function findAndClickTurnstile(page: Page, cdp: any | null, debug: boolean): Promise<boolean> {
  // Strategy 1: Locate the Turnstile iframe element on the main page and
  //             click inside its bounding box. This works even for cross-origin iframes.
  const cfFrames = page.frames().filter(f => {
    const url = f.url();
    return /challenges\.cloudflare\.com|turnstile|cdn-cgi\/challenge-platform/i.test(url);
  });

  for (const cfFrame of cfFrames) {
    log(debug, 'found-cf-frame', { url: cfFrame.url() });

    try {
      const frameElement = await cfFrame.frameElement();
      const box = await frameElement.boundingBox();
      if (!box || box.width < 10 || box.height < 10) {
        log(debug, 'cf-frame-too-small-or-hidden', { box });
        continue;
      }

      log(debug, 'cf-frame-bounds', { x: box.x, y: box.y, width: box.width, height: box.height });

      // Turnstile checkbox is at approximately left-center of the widget
      const clickX = box.x + Math.min(30 + Math.random() * 6, box.width * 0.15);
      const clickY = box.y + box.height / 2 + (Math.random() - 0.5) * 6;

      log(debug, 'clicking-inside-cf-iframe', { clickX, clickY, method: cdp ? 'cdp' : 'playwright' });

      if (cdp) {
        // Preferred: CDP-dispatched events are harder to detect as synthetic
        await humanClickCDP(cdp, clickX, clickY, debug);
      } else {
        await humanMouseMove(page, clickX, clickY, debug);
        await page.waitForTimeout(randomDelay(150, 400));
        await page.mouse.click(clickX, clickY);
      }

      // Wait and check if widget expanded (secondary challenge)
      await page.waitForTimeout(randomDelay(600, 1500));
      const box2 = await frameElement.boundingBox();
      if (box2 && box2.height > box.height + 50) {
        const cx = box2.x + box2.width / 2 + (Math.random() - 0.5) * 10;
        const cy = box2.y + box2.height / 2 + (Math.random() - 0.5) * 10;
        log(debug, 'cf-frame-expanded, clicking center', { cx, cy, newHeight: box2.height });
        if (cdp) {
          await humanClickCDP(cdp, cx, cy, debug);
        } else {
          await humanMouseMove(page, cx, cy, debug);
          await page.waitForTimeout(randomDelay(200, 500));
          await page.mouse.click(cx, cy);
        }
      }

      return true;
    } catch (err) {
      log(debug, 'cf-frame-click-error', { error: String(err) });
    }
  }

  // Strategy 2: Find any iframe element by src attribute on the main page
  const iframeSelectors = [
    'iframe[src*="challenges.cloudflare.com"]',
    'iframe[src*="turnstile"]',
    'iframe[src*="cdn-cgi/challenge-platform"]',
    'iframe[title*="Cloudflare"]',
    '#turnstile-wrapper iframe',
    '.cf-turnstile iframe',
  ];

  for (const selector of iframeSelectors) {
    const iframe = page.locator(selector).first();
    const count = await iframe.count();
    if (count === 0) continue;

    log(debug, 'found-iframe-by-selector', { selector });

    try {
      await iframe.waitFor({ state: 'attached', timeout: 3000 });
      const box = await iframe.boundingBox();
      if (!box || box.width < 10 || box.height < 10) {
        log(debug, 'iframe-too-small', { selector, box });
        continue;
      }

      const clickX = box.x + Math.min(30 + Math.random() * 6, box.width * 0.15);
      const clickY = box.y + box.height / 2 + (Math.random() - 0.5) * 6;

      if (cdp) {
        await humanClickCDP(cdp, clickX, clickY, debug);
      } else {
        await humanMouseMove(page, clickX, clickY, debug);
        await page.waitForTimeout(randomDelay(150, 400));
        await page.mouse.click(clickX, clickY);
      }
      return true;
    } catch (err) {
      log(debug, 'iframe-selector-click-error', { selector, error: String(err) });
    }
  }

  // Strategy 3: Look for standalone challenge elements on the main page
  const challengeSelectors = [
    'input[type="checkbox"]',
    '#challenge-stage',
    '#challenge-form input',
    'button:has-text("Verify")',
  ];

  for (const selector of challengeSelectors) {
    const el = page.locator(selector).first();
    const count = await el.count();
    if (count === 0) continue;

    try {
      const box = await el.boundingBox();
      if (!box) continue;

      log(debug, 'found-challenge-element', { selector, box });
      const clickX = box.x + box.width / 2 + (Math.random() - 0.5) * 4;
      const clickY = box.y + box.height / 2 + (Math.random() - 0.5) * 4;

      if (cdp) {
        await humanClickCDP(cdp, clickX, clickY, debug);
      } else {
        await humanMouseMove(page, clickX, clickY, debug);
        await page.waitForTimeout(randomDelay(100, 300));
        await page.mouse.click(clickX, clickY);
      }
      return true;
    } catch (err) {
      log(debug, 'challenge-element-click-error', { selector, error: String(err) });
    }
  }

  log(debug, 'no-turnstile-element-found');
  return false;
}

/**
 * Main challenge handler: detect challenge → find Turnstile → click → wait → retry
 */
async function handleCloudflareChallenge(
  page: Page,
  cdp: any | null,
  autoVerify: boolean,
  timeoutMs: number,
  maxRetries: number,
  debug: boolean
): Promise<void> {
  // First, wait a bit to see if the challenge resolves on its own
  // (happens often with persistent context / cached cookies)
  const stillInChallenge = await waitForChallengeToClear(page, 8000, debug);
  if (!stillInChallenge) return;

  log(debug, 'challenge-detected', { autoVerify, maxRetries });
  if (!autoVerify) {
    log(debug, 'auto-verify-disabled, waiting for manual resolution');
    // Wait the full timeout for manual resolution
    await waitForChallengeToClear(page, timeoutMs, debug);
    return;
  }

  // Auto-verify: try to click the Turnstile checkbox
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    log(debug, `verify-attempt-${attempt}/${maxRetries}`);

    // Random pre-click delay to appear more human
    await page.waitForTimeout(randomDelay(800, 2000));

    // Scroll a little and move the mouse randomly first
    if (cdp) {
      await cdpMouseEvent(cdp, 'mouseMoved', Math.random() * 600 + 200, Math.random() * 400 + 100);
    } else {
      await page.mouse.move(
        Math.random() * 600 + 200,
        Math.random() * 400 + 100
      );
    }
    await page.waitForTimeout(randomDelay(300, 800));

    const clicked = await findAndClickTurnstile(page, cdp, debug);
    if (!clicked) {
      log(debug, 'no-clickable-element-found', { attempt });
      // Maybe the challenge auto-resolves, wait and re-check
      await page.waitForTimeout(randomDelay(2000, 4000));
    } else {
      log(debug, 'clicked-turnstile', { attempt });
    }

    // Wait to see if challenge clears
    const cleared = !(await waitForChallengeToClear(page, 10000, debug));
    if (cleared) {
      log(debug, 'challenge-resolved', { attempt });
      return;
    }

    // If not cleared, wait before retrying
    if (attempt < maxRetries) {
      const backoff = randomDelay(2000, 5000);
      log(debug, 'retrying-after-backoff', { attempt, backoffMs: backoff });
      await page.waitForTimeout(backoff);
    }
  }

  log(debug, 'all-verify-attempts-exhausted', { maxRetries });
  // Final long wait — let the user intervene manually if running headed
  await waitForChallengeToClear(page, timeoutMs, debug);
}

/* ─── main scraper ─── */

export async function scrapePropertyGuruSearch(input: ScrapePropertyGuruInput) {
  const limit = Math.max(1, Math.min(input.limit ?? 20, 100));
  const timeoutMs = input.timeoutMs ?? 90000;
  const debug = input.debug ?? false;
  const autoVerify = input.autoVerify ?? true; // default ON now
  const maxRetries = input.maxRetries ?? MAX_VERIFY_RETRIES;
  const windowWidth = input.windowWidth ?? DEFAULT_WINDOW_WIDTH;
  const windowHeight = input.windowHeight ?? DEFAULT_WINDOW_HEIGHT;
  const userDataDir = input.userDataDir ?? getDefaultProfileDir();
  const scrapeDetails = input.scrapeDetails ?? false;
  const scrapePhone = input.scrapePhone ?? false;

  mkdirSync(userDataDir, { recursive: true });

  // ── Clean up stale Chrome profile lock & processes ──
  const lockFile = path.join(userDataDir, 'SingletonLock');
  if (existsSync(lockFile)) {
    log(debug, 'removing-stale-singleton-lock', { lockFile });
    try { unlinkSync(lockFile); } catch { /* ignore */ }
  }
  // Kill any lingering Chrome processes using this profile directory
  try {
    const profileBase = path.basename(userDataDir);
    execSync(`ps aux | grep "${profileBase}" | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null || true`, { stdio: 'ignore', timeout: 5000 });
    log(debug, 'killed-stale-chrome-processes');
  } catch { /* ignore — no stale processes */ }

  log(debug, 'launching-context', {
    userDataDir,
    headless: input.headless ?? false,
    autoVerify,
    maxRetries,
    windowWidth,
    windowHeight
  });

  const context: BrowserContext = await chromium.launchPersistentContext(userDataDir, {
    headless: input.headless ?? false,
    channel: 'chrome',
    viewport: { width: windowWidth, height: windowHeight },
    args: [
      '--window-position=0,0',
      `--window-size=${windowWidth},${windowHeight}`,
      '--disable-blink-features=AutomationControlled',
    ],
    // Make the browser fingerprint look more real
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-SG',
    timezoneId: 'Asia/Singapore',
  });

  try {
    const existing = context.pages();
    const page: Page = existing[0] || await context.newPage();

    // Remove webdriver flag to reduce detection
    await page.addInitScript(() => {
      // Hide webdriver
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

      // Patch chrome object to look like a real browser
      const w = window as any;
      w.chrome = {
        app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
        runtime: { OnInstalledReason: {}, OnRestartRequiredReason: {}, PlatformArch: {}, PlatformNaclArch: {}, PlatformOs: {}, RequestUpdateCheckStatus: {} },
        csi: function() { return {}; },
        loadTimes: function() { return {}; }
      };

      // Patch plugins to look non-empty
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5]
      });

      // Patch languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en', 'zh-CN']
      });

      // Remove automation-related properties
      delete (window as any).__playwright;
      delete (window as any).__pw_manual;
    });

    page.setDefaultTimeout(timeoutMs);

    // Create CDP session for more realistic mouse events
    const cdp = await getCDP(page, debug);

    // Simulate a more natural browsing pattern: visit homepage first
    log(debug, 'warming-up-session');
    await page.goto('https://www.propertyguru.com.sg', {
      waitUntil: 'domcontentloaded',
      timeout: timeoutMs
    });
    await page.waitForTimeout(randomDelay(1500, 3000));

    // Handle any challenge on the homepage
    if (await isInChallenge(page)) {
      log(debug, 'challenge-on-homepage');
      await handleCloudflareChallenge(page, cdp, autoVerify, timeoutMs, maxRetries, debug);
    }

    // Now navigate to the actual search URL
    log(debug, 'navigating-to-search', { url: input.url });
    await page.goto(input.url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    log(debug, 'navigation-complete');

    // Handle challenge on the search page
    if (await isInChallenge(page)) {
      log(debug, 'challenge-on-search-page');
      await handleCloudflareChallenge(page, cdp, autoVerify, timeoutMs, maxRetries, debug);
    }

    log(debug, 'waiting-for-listings');
    await page.waitForSelector('a[href*="/listing/"]', { timeout: timeoutMs });
    await page.waitForTimeout(randomDelay(1500, 3000));
    log(debug, 'listing-links-visible');

    const rawListings = await page.evaluate((maxItems: number) => {
      const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/listing/"]:not([href*="#"])'));
      const seen = new Set<string>();
      const rows: { url: string; text: string }[] = [];

      for (const anchor of anchors) {
        const url = anchor.href;
        if (!url || seen.has(url)) continue;

        let candidate: HTMLElement | null = anchor;
        let bestText = '';
        while (candidate) {
          const text = (candidate as HTMLElement).innerText?.trim() || '';
          if (text.includes('S$') && text.length > bestText.length && text.length < 1200) {
            bestText = text;
          }
          candidate = candidate.parentElement;
          if (candidate && candidate.tagName === 'BODY') break;
        }

        const text = bestText || anchor.innerText.trim();
        if (!text || !/S\$\s*[\d,]+/.test(text)) continue;

        seen.add(url);
        rows.push({ url, text });
        if (rows.length >= maxItems) break;
      }

      return rows;
    }, limit);

    const listings = rawListings.map((item: { url: string; text: string }, index: number) => parseListing(item, index + 1));
    log(debug, 'list-scrape-finished', { count: listings.length });

    // Scrape detail pages if requested (scrapePhone implies scrapeDetails)
    if ((scrapeDetails || scrapePhone) && listings.length > 0) {
      log(debug, 'starting-detail-scrape', { total: listings.length, scrapePhone });

      for (let i = 0; i < listings.length; i++) {
        const listing = listings[i];
        log(debug, `detail-${i + 1}/${listings.length}`, { url: listing.url });
        console.error(`  📄 Scraping detail ${i + 1}/${listings.length}: ${listing.url}`);

        try {
          listing.detail = await scrapeListingDetail(
            page,
            listing.url,
            cdp,
            autoVerify,
            timeoutMs,
            maxRetries,
            debug,
            scrapePhone
          );

          // Random delay between detail pages to look human
          if (i < listings.length - 1) {
            const delay = randomDelay(2000, 4000);
            log(debug, 'detail-inter-page-delay', { delayMs: delay });
            await page.waitForTimeout(delay);
          }
        } catch (err) {
          log(debug, 'detail-scrape-error', { url: listing.url, error: String(err) });
          console.error(`  ⚠️  Failed to scrape detail for ${listing.url}: ${err instanceof Error ? err.message : String(err)}`);
          // Continue with next listing
        }
      }

      log(debug, 'detail-scrape-finished', {
        total: listings.length,
        withDetails: listings.filter(l => l.detail).length
      });
    }

    return {
      sourceUrl: input.url,
      scrapedAt: new Date().toISOString(),
      count: listings.length,
      profileDir: userDataDir,
      listings
    };
  } finally {
    await context.close();
  }
}
