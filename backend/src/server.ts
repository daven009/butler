import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import {
  scrapePropertyGuruSearch,
  scrapePropertyGuruListingDetail,
  isPropertyGuruListingDetailUrl,
} from './lib/scrapers/propertyGuru';
import {
  enqueueScrapeTask,
  ScrapeQueueFullError,
} from './lib/scrapers/scrapeQueue';
import { llmParsePgListings } from './lib/llm/pgListingParser';
import { batchGetOrGeocode, cacheSize } from './lib/scheduling/geoCache';
import {
  upsertPgListings,
} from './lib/repositories/pgListingsRepository';
import { methodNotAllowed, notFound, sendError } from './lib/http';
import {
  addConversationMessage,
  addListingToTourWeb,
  createPlan,
  createTourForPlan,
  generateRoute,
  getConversationsByListing,
  getPlanById,
  getRouteByShareToken,
  getSchedulingRun,
  getTourDetail,
  listConversationsByTour,
  listListingsByTour,
  listPlans,
  listToursByPlan,
  pgToBusinessListing,
  removeListingFromTour,
  shareRoute,
  startSchedulingRun,
  retrySchedulingRun,
} from './lib/repositories/plansRepository';
import { seedTourConversations } from './lib/repositories/conversationsMock';
import { runWithUser } from './lib/userContext';
import { STEP_DEFS } from './lib/scheduling/schedulerSteps';
import { verifyToken, supabaseAdmin } from './lib/supabase';

const app = express();
const port = Number(process.env.PORT || 8787);

app.use(cors());
app.use(express.json());

/**
 * Express middleware: extract Bearer token, verify against Supabase Auth,
 * then run the rest of the request inside `runWithUser` so repositories see
 * the right userId + can spin up an RLS-respecting Supabase client.
 */
async function requireUser(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) {
    return sendError(res, 401, 'NO_TOKEN', 'Missing Authorization token');
  }
  const user = await verifyToken(token);
  if (!user) {
    return sendError(res, 401, 'INVALID_TOKEN', 'Token is invalid or expired');
  }
  runWithUser({ userId: user.id, jwt: token }, () => next());
}

app.get('/', (_req, res) => {
  res.json({ status: 'ok', service: 'appointment-scheduler-api', version: '1.0.0' });
});

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

// Public share endpoint — uses the share token, not a user token. Mounted
// BEFORE app.use('/api', requireUser) so it can be hit without auth.
app.get('/api/share/routes/:shareToken', async (req, res) => {
  const { data, error } = await supabaseAdmin.rpc('get_route_by_share_token', {
    p_token: req.params.shareToken,
  });
  if (error) {
    console.error('[share] rpc error:', error);
    return sendError(res, 500, 'SHARE_LOOKUP_FAILED', error.message);
  }
  if (!data) return notFound(res, 'SHARE_NOT_FOUND', 'Share link not found or expired');
  return res.status(200).json({ route: data });
});

app.use('/api', requireUser);

function requireJsonObject(req: express.Request, res: express.Response) {
  if (req.body && typeof req.body === 'object') return true;
  sendError(
    res,
    400,
    'VALIDATION_FAILED',
    'JSON object body is required',
    { body: 'JSON object body is required' },
  );
  return false;
}

// ── Plans ──────────────────────────────────────────────────────────────────

app.get('/api/plans', async (_req, res) => {
  res.status(200).json({ plans: await listPlans() });
});

app.post('/api/plans', async (req, res) => {
  if (!requireJsonObject(req, res)) return;
  const { title, clientName, clientWhatsapp, brief } = req.body;
  if (!title || !clientName) {
    return sendError(res, 400, 'VALIDATION_FAILED', 'title and clientName are required');
  }
  const plan = await createPlan({ title, clientName, clientWhatsapp, brief: brief || '' });
  return res.status(201).json({ plan });
});

app.get('/api/plans/:planId/tours', async (req, res) => {
  const plan = await getPlanById(req.params.planId);
  if (!plan) return notFound(res, 'PLAN_NOT_FOUND', 'Plan not found');
  return res.status(200).json({ tours: await listToursByPlan(req.params.planId) });
});

app.post('/api/plans/:planId/tours', async (req, res) => {
  if (!requireJsonObject(req, res)) return;
  const plan = await getPlanById(req.params.planId);
  if (!plan) return notFound(res, 'PLAN_NOT_FOUND', 'Plan not found');
  const { title, targetDate, timeWindow, command } = req.body;
  if (!title || !targetDate || !timeWindow) {
    return sendError(
      res,
      400,
      'VALIDATION_FAILED',
      'title, targetDate, and timeWindow are required',
    );
  }
  const tour = await createTourForPlan(req.params.planId, {
    title,
    targetDate,
    timeWindow,
    command: typeof command === 'string' ? command : '',
  });
  return res.status(201).json({ tour });
});

// ── Listings ───────────────────────────────────────────────────────────────

app.get('/api/tours/:tourId/listings', async (req, res) => {
  return res.status(200).json({ listings: await listListingsByTour(req.params.tourId) });
});

app.delete('/api/tours/:tourId/web-listings/:listingId', async (req, res) => {
  const ok = await removeListingFromTour(req.params.tourId, req.params.listingId);
  if (!ok) return notFound(res, 'LISTING_NOT_FOUND', 'Listing not found');
  return res.status(200).json({ deleted: true });
});

// ── Tour import from PropertyGuru ──────────────────────────────────────────

app.post('/api/tours/:tourId/import', async (req, res) => {
  if (!requireJsonObject(req, res)) return;
  const tour = await getTourDetail(req.params.tourId);
  if (!tour) return notFound(res, 'TOUR_NOT_FOUND', 'Tour not found');

  const url = String(req.body.url || '').trim();
  if (!url) return sendError(res, 400, 'VALIDATION_FAILED', 'url is required');

  const limit = Math.min(Number(req.body.limit) || 20, 100);
  const headless =
    typeof req.body.headless === 'boolean'
      ? req.body.headless
      : false;
  const t0 = Date.now();
  console.log('[tour-import] ▶ start', { tourId: req.params.tourId, url, limit });

  try {
    const TIMEOUT_MS = 300_000;
    const isDetail = isPropertyGuruListingDetailUrl(url);
    console.log('[tour-import] mode:', isDetail ? 'single-detail' : 'search-results');

    let fresh: any[];
    if (isDetail) {
      const single = await enqueueScrapeTask('scrape:propertyguru:detail', async () => {
        const detailPromise = scrapePropertyGuruListingDetail({
          url,
          headless,
          scrapePhone: false,
          debug: true,
          timeoutMs: 240_000,
        });
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Detail scraping timed out after 5 minutes.')), TIMEOUT_MS),
        );
        return Promise.race([detailPromise, timeoutPromise]);
      });
      fresh = [single];
    } else {
      const result = await enqueueScrapeTask('scrape:propertyguru:search', async () => {
        const scrapePromise = scrapePropertyGuruSearch({
          url,
          limit,
          headless,
          scrapeDetails: false,
          scrapePhone: false,
          debug: true,
          timeoutMs: 240_000,
        });
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Scraping timed out after 5 minutes.')), TIMEOUT_MS),
        );
        return Promise.race([scrapePromise, timeoutPromise]);
      });
      fresh = result.listings || [];
    }

    const dbResult = fresh.length
      ? upsertPgListings(fresh as any[], url)
      : { inserted: 0, updated: 0, total: 0, versionsAppended: 0 };

    let llmFields: any[] = [];
    try {
      llmFields = await llmParsePgListings(
        fresh.map((item: any) => {
          const rawText = String(item.rawText || '');
          const description = String(item.detail?.description || '');
          const combined = description
            ? `${rawText}\n\n--- About this property ---\n${description}`
            : rawText;
          return {
            listingId: String(item.listingId || item.url || ''),
            rawText: combined,
          };
        }),
      );
      console.log('[tour-import] llm parsed', llmFields.length, 'rows');
    } catch (error) {
      console.warn(
        '[tour-import] llm parsing failed, falling back to regex mapper:',
        (error as Error).message,
      );
      llmFields = fresh.map(() => ({}));
    }

    const businessListings = fresh.map((item: any, idx: number) => {
      const enriched = { ...item, _llm: llmFields[idx] || {} };
      return pgToBusinessListing(enriched, url);
    });

    try {
      const addresses = businessListings.map((listing) => listing.address).filter(Boolean);
      const geoResults = await batchGetOrGeocode(addresses);
      let geocoded = 0;
      for (const listing of businessListings) {
        const hit = geoResults.get(listing.address);
        if (hit) {
          listing.lat = hit.lat;
          listing.lng = hit.lng;
          geocoded++;
        }
      }
      console.log(
        '[tour-import] geocoded',
        geocoded,
        '/',
        businessListings.length,
        '(cache size now',
        cacheSize(),
        ')',
      );
    } catch (error) {
      console.warn(
        '[tour-import] geocode step failed, continuing without coords:',
        (error as Error).message,
      );
    }

    let merged = 0;
    let added = 0;
    for (const listing of businessListings) {
      const existing = (await listListingsByTour(req.params.tourId)).find((item) => item.id === listing.id);
      await addListingToTourWeb(req.params.tourId, listing);
      if (existing) merged++;
      else added++;
    }

    const finalListings = await listListingsByTour(req.params.tourId);

    console.log('[tour-import] ✓ done', {
      ms: Date.now() - t0,
      scraped: fresh.length,
      added,
      merged,
      pgArchive: dbResult,
      tourTotal: finalListings.length,
    });

    return res.status(200).json({
      listings: finalListings,
      stats: { scraped: fresh.length, added, merged, pgArchive: dbResult },
    });
  } catch (error) {
    if (error instanceof ScrapeQueueFullError) {
      const stats = error.stats;
      return sendError(res, 429, error.code, 'Scrape queue is busy. Please retry shortly.', {
        running: String(stats.running),
        queued: String(stats.queued),
        concurrency: String(stats.concurrency),
      });
    }
    const message = error instanceof Error ? error.message : 'Tour import failed';
    console.error('[tour-import] ✗ error', { ms: Date.now() - t0, message });
    return sendError(res, 500, 'TOUR_IMPORT_FAILED', message);
  }
});

// ── Tour import from browser extension ────────────────────────────────────
// MV3 content_script 已经在用户浏览器里把 PG 详情页 / 列表页 DOM 抽好了，
// 这里只负责：归档 → LLM 抽字段 → geocode → 写 tour，与 /import 后半段一致。
app.post('/api/tours/:tourId/import-from-extension', async (req, res) => {
  if (!requireJsonObject(req, res)) return;
  const tour = await getTourDetail(req.params.tourId);
  if (!tour) return notFound(res, 'TOUR_NOT_FOUND', 'Tour not found');

  const sourceUrl = String(req.body.url || '').trim();
  const incoming = Array.isArray(req.body.listings) ? req.body.listings : [];
  if (!incoming.length) {
    return sendError(res, 400, 'VALIDATION_FAILED', 'listings (non-empty array) is required');
  }

  const t0 = Date.now();
  console.log('[ext-import] ▶ start', {
    tourId: req.params.tourId,
    source: req.body.source || 'pg-detail',
    sourceUrl,
    count: incoming.length,
  });

  try {
    const dbResult = upsertPgListings(incoming as any[], sourceUrl);

    let llmFields: any[] = [];
    try {
      llmFields = await llmParsePgListings(
        incoming.map((item: any) => {
          const rawText = String(item.rawText || '');
          const description = String(item.detail?.description || '');
          const combined = description
            ? `${rawText}\n\n--- About this property ---\n${description}`
            : rawText;
          return {
            listingId: String(item.listingId || item.url || ''),
            rawText: combined,
          };
        }),
      );
      console.log('[ext-import] llm parsed', llmFields.length, 'rows');
    } catch (error) {
      console.warn(
        '[ext-import] llm parsing failed, continuing with empty fields:',
        (error as Error).message,
      );
      llmFields = incoming.map(() => ({}));
    }

    const businessListings = incoming.map((item: any, idx: number) => {
      const enriched = { ...item, _llm: llmFields[idx] || {} };
      return pgToBusinessListing(enriched, sourceUrl);
    });

    try {
      const addresses = businessListings.map((listing) => listing.address).filter(Boolean);
      const geoResults = await batchGetOrGeocode(addresses);
      let geocoded = 0;
      for (const listing of businessListings) {
        const hit = geoResults.get(listing.address);
        if (hit) {
          listing.lat = hit.lat;
          listing.lng = hit.lng;
          geocoded++;
        }
      }
      console.log(
        '[ext-import] geocoded',
        geocoded,
        '/',
        businessListings.length,
        '(cache size now',
        cacheSize(),
        ')',
      );
    } catch (error) {
      console.warn(
        '[ext-import] geocode step failed, continuing without coords:',
        (error as Error).message,
      );
    }

    let merged = 0;
    let added = 0;
    for (const listing of businessListings) {
      const existing = (await listListingsByTour(req.params.tourId)).find((item) => item.id === listing.id);
      await addListingToTourWeb(req.params.tourId, listing);
      if (existing) merged++;
      else added++;
    }

    const finalListings = await listListingsByTour(req.params.tourId);

    console.log('[ext-import] ✓ done', {
      ms: Date.now() - t0,
      received: incoming.length,
      added,
      merged,
      pgArchive: dbResult,
      tourTotal: finalListings.length,
    });

    return res.status(200).json({
      listings: finalListings,
      stats: { scraped: incoming.length, added, merged, pgArchive: dbResult },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Extension import failed';
    console.error('[ext-import] ✗ error', { ms: Date.now() - t0, message });
    return sendError(res, 500, 'EXT_IMPORT_FAILED', message);
  }
});

// ── Conversations / scheduling workflow ───────────────────────────────────

app.post('/api/tours/:tourId/conversations/seed', async (req, res) => {
  const tour = await getTourDetail(req.params.tourId);
  if (!tour) return notFound(res, 'TOUR_NOT_FOUND', 'Tour not found');
  const agentName = typeof req.body?.agentName === 'string' ? req.body.agentName : undefined;
  const result = await seedTourConversations(req.params.tourId, agentName);
  console.log('[seed] tour', req.params.tourId, result);
  return res.status(200).json(result);
});

app.post('/api/tours/:tourId/scheduling-runs', async (req, res) => {
  const tour = await getTourDetail(req.params.tourId);
  if (!tour) return notFound(res, 'TOUR_NOT_FOUND', 'Tour not found');
  const run = await startSchedulingRun(req.params.tourId);
  return res.status(201).json({ run });
});

app.get('/api/scheduling-runs/:runId', async (req, res) => {
  const run = await getSchedulingRun(req.params.runId);
  if (!run) return notFound(res, 'RUN_NOT_FOUND', 'Scheduling run not found');
  return res.status(200).json({ run });
});

/**
 * Retry a failed scheduling run from its first non-'done' step. The run
 * row's step_state and step_artifacts are preserved, so completed steps
 * (e.g. gather, geocode) won't re-run on retry.
 *
 * 404 → run not found
 * 409 → run is not in 'failed' state (caller must wait or look at status)
 */
app.post('/api/scheduling-runs/:runId/retry', async (req, res) => {
  try {
    const run = await retrySchedulingRun(req.params.runId);
    return res.status(202).json({ run });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === 'RUN_NOT_FOUND') return notFound(res, 'RUN_NOT_FOUND', 'Scheduling run not found');
    if (msg === 'RUN_NOT_FAILED') {
      return sendError(res, 409, 'RUN_NOT_FAILED', 'Run is not in failed state; cannot retry.');
    }
    throw err;
  }
});

/**
 * Static step catalogue. Frontend reads this once on mount so progress UI
 * labels stay in sync with the backend (instead of duplicating the list).
 */
app.get('/api/scheduling-steps', (_req, res) => {
  return res.status(200).json({ steps: STEP_DEFS });
});

app.get('/api/tours/:tourId/conversations', async (req, res) => {
  const messages = await listConversationsByTour(req.params.tourId);
  const byListing: Record<string, any[]> = {};
  for (const msg of messages) {
    if (!byListing[msg.listingId]) byListing[msg.listingId] = [];
    byListing[msg.listingId].push(msg);
  }
  const listings = await listListingsByTour(req.params.tourId);
  const conversations = Object.entries(byListing).map(([listingId, msgs]) => {
    if (listingId === '__buyer__') {
      return {
        id: `conv-${listingId}`,
        listingId,
        coAgentName: 'Buyer',
        listingTitle: 'Buyer availability',
        messages: msgs,
        lastMessage: msgs[msgs.length - 1],
      };
    }
    const listing = listings.find((item) => item.id === listingId);
    return {
      id: `conv-${listingId}`,
      listingId,
      coAgentName: listing?.coAgent.name || 'Unknown',
      listingTitle: listing?.title || 'Unknown Listing',
      messages: msgs,
      lastMessage: msgs[msgs.length - 1],
    };
  });
  return res.status(200).json({ conversations });
});

app.get('/api/conversations/:conversationId/messages', async (req, res) => {
  const listingId = req.params.conversationId.replace('conv-', '');
  const plans = await listPlans();
  for (const plan of plans) {
    const tours = await listToursByPlan(plan.id);
    for (const tour of tours) {
      const msgs = await getConversationsByListing(tour.id, listingId);
      if (msgs.length > 0) {
        return res.status(200).json({ messages: msgs });
      }
    }
  }
  return res.status(200).json({ messages: [] });
});

app.post('/api/conversations/:conversationId/messages', async (req, res) => {
  if (!requireJsonObject(req, res)) return;
  const listingId = req.params.conversationId.replace('conv-', '');
  const { body: msgBody, sender, senderName } = req.body;
  if (!msgBody) {
    return sendError(res, 400, 'VALIDATION_FAILED', 'body is required');
  }

  const plans = await listPlans();
  for (const plan of plans) {
    const tours = await listToursByPlan(plan.id);
    for (const tour of tours) {
      const listings = await listListingsByTour(tour.id);
      const hasExistingThread = (await getConversationsByListing(tour.id, listingId)).length > 0;
      const isBuyerThread = listingId === '__buyer__' && hasExistingThread;
      const belongsToListing = listings.some((item) => item.id === listingId);
      if (!isBuyerThread && !belongsToListing) continue;

      const msg = await addConversationMessage(tour.id, {
        id: `m-${Date.now()}`,
        listingId,
        sender: sender || 'agent',
        senderName: senderName || 'Dave Shen',
        body: msgBody,
        timestamp: new Date().toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }),
      });
      return res.status(201).json({ message: msg });
    }
  }

  return notFound(res, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
});

// ── Route generation / sharing ────────────────────────────────────────────

app.post('/api/tours/:tourId/routes/generate', async (req, res) => {
  const tour = await getTourDetail(req.params.tourId);
  if (!tour) return notFound(res, 'TOUR_NOT_FOUND', 'Tour not found');
  const route = await generateRoute(req.params.tourId);
  return res.status(201).json({ route });
});

app.post('/api/routes/:routeId/share', async (req, res) => {
  try {
    const result = await shareRoute(req.params.routeId);
    return res.status(200).json(result);
  } catch (error: any) {
    return notFound(res, 'ROUTE_NOT_FOUND', error.message);
  }
});

// This public share endpoint is registered BEFORE app.use('/api', requireUser)
// at the top of this file. Keep it there so customer share links don't need
// a user token.

app.use((req, res) => methodNotAllowed(res, req.method, []));

app.listen(port, () => {
  console.log(`Butler backend listening on http://localhost:${port}`);
});
