/**
 * LLM-powered PropertyGuru listing parser.
 *
 * The PG listing card layout is unstable — order of lines, presence of
 * promo banners, marketing headlines and rating widgets all vary. Regex
 * heuristics work for ~80% but break in long-tail cases.
 *
 * This module asks gpt-4o-mini to extract 5 structured fields from the
 * `rawText` block of a single listing. We use JSON mode + a tight prompt
 * so output is deterministic.
 *
 * Batching: we send up to N listings in one call to amortise latency.
 */
import OpenAI from 'openai';

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not set');
    _openai = new OpenAI({ apiKey });
  }
  return _openai;
}

export interface PgListingFields {
  /** Condo / project name, e.g. "Ecopolitan", "The Estuary @ Yishun". Empty if HDB / no named project. */
  condo: string;
  /** Clean street address, e.g. "124 Punggol Walk". Empty if not present. */
  address: string;
  /** Coarse Singapore neighbourhood, e.g. "Punggol", "Yishun", "Tanjong Rhu". Empty if unknown. */
  area: string;
  /** Real co-agent personal name, e.g. "Chan Yong Jie (Bob)". Empty if unparseable. */
  coAgentName: string;
  /** Co-agent's company, e.g. "PROPNEX REALTY PTE. LTD.". Empty if not in rawText. */
  coAgentAgency: string;
}

const SYSTEM_PROMPT = `You extract structured fields from a PropertyGuru listing text block.

The input may be either:
  (A) a short list-card snippet from a search-results page, OR
  (B) the FULL detail-page text dump (contains nav-bar items like
      "Buy / Rent / Sell / New Projects", section headings like "Photos",
      "Floor Plan", "About this property", and the agent's prose).

Common content you'll see (any subset may be present):
- Agent display name (e.g. "Chan Yong Jie (Bob)")
- A rating like "4.9" and review count like "(25)"
- Promo banners: "PROMOTED", "Listing with similar price range", "Explore around"
- The agency in ALL CAPS (e.g. "PROPNEX REALTY PTE. LTD.")
- "Contact" button label, follower counts, image counts (small integers)
- Marketing headlines ("Stunning 3 Bedroom HDB at...", "C.H.E.A.P! Corner Unit...")
- Price ("S$ 1,650,000") and PSF ("S$ 1,502.73 psf")
- The PROJECT / CONDO name (e.g. "Ecopolitan", "Anchorvale Grove", "The Estuary @ Yishun"). HDB units usually have no named project.
- The street address (e.g. "124 Punggol Walk", "21 Teban Gardens Road"). MUST start with a house/block number.
- Numeric specs (bedrooms, bathrooms, "1,098 sqft")
- Property type ("Executive Condominium", "HDB Flat", "Condominium")
- Tenure, build year, MRT distance, listing date
- For detail-page input: a long prose "About this property" written by the agent — this is the BEST source for project name and selling points.

For EACH listing, output JSON with exactly these fields:
- condo:         Project / development name (e.g. "Ecopolitan", "Anchorvale Grove"). EMPTY STRING if HDB block with no named project.
- address:       Clean street address (e.g. "124 Punggol Walk"). MUST start with a house/block number. EMPTY STRING if absent.
- area:          Singapore neighbourhood derived from the address — drop the house number AND road-type suffix. Examples:
                   "124 Punggol Walk"        → "Punggol"
                   "1 Yishun Avenue 1"       → "Yishun"
                   "21 Teban Gardens Road"   → "Teban Gardens"
                   "16 De Souza Avenue"      → "De Souza"
                   "91 Tampines Avenue 1"    → "Tampines"
                   "319A Anchorvale Drive"   → "Anchorvale"
                 EMPTY STRING if no address.
- coAgentName:   Real personal name of the listing agent. NOT a marketing headline, NOT "PROMOTED", NOT a rating number. NOT nav-bar items like "Buy" / "Rent". EMPTY STRING if cannot tell.
- coAgentAgency: Company name (usually ALL CAPS, "PTE LTD"). EMPTY STRING if not present.

CRITICAL: ignore the page chrome (nav bar, breadcrumbs, "Show all media", "Photos", "Floor Plan", "Map View", "Property details", "About this property" headings, "Check loan eligibility", "See all details"). Look at content, not page structure.

Output JSON shape: {"results": [{"condo":"","address":"","area":"","coAgentName":"","coAgentAgency":""}, ...]}
Output one result object per input listing in the SAME ORDER as input.
Never invent data — leave a field as "" rather than guess.`;

export interface PgInputItem {
  /** Anything that uniquely identifies this listing within the batch — used only to keep order. */
  listingId: string;
  rawText: string;
}

/**
 * Parse a batch of PG listings via gpt-4o-mini.
 *
 * Returns one PgListingFields per input, in input order.
 * On API failure, returns empty fields for every listing (caller should
 * fall back to whatever heuristics they want).
 */
export async function llmParsePgListings(
  items: PgInputItem[],
  options: { batchSize?: number; logger?: (msg: string) => void } = {},
): Promise<PgListingFields[]> {
  if (!items.length) return [];
  const batchSize = options.batchSize ?? 20;
  const log = options.logger ?? ((msg) => console.log('[pgLlm]', msg));

  const out: PgListingFields[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const parsed = await parseOneBatch(batch, log);
    out.push(...parsed);
  }
  return out;
}

async function parseOneBatch(
  batch: PgInputItem[],
  log: (msg: string) => void,
): Promise<PgListingFields[]> {
  const openai = getOpenAI();
  const userContent = batch
    .map((item, idx) => `[Listing ${idx}] id=${item.listingId}\n${item.rawText}`)
    .join('\n\n---\n\n');

  const t0 = Date.now();
  let response;
  try {
    response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Parse these ${batch.length} listings:\n\n${userContent}` },
      ],
    });
  } catch (err) {
    log(`batch of ${batch.length} failed: ${(err as Error).message}`);
    return batch.map(() => emptyFields());
  }

  const ms = Date.now() - t0;
  const content = response.choices[0]?.message?.content || '{"results":[]}';
  let parsed: { results?: Partial<PgListingFields>[] };
  try {
    parsed = JSON.parse(content);
  } catch {
    log(`batch of ${batch.length} returned non-JSON content; falling back to empty`);
    return batch.map(() => emptyFields());
  }

  const results = Array.isArray(parsed.results) ? parsed.results : [];
  log(`batch of ${batch.length} done in ${ms}ms (got ${results.length} results)`);

  // Pad / truncate to match input length
  const fixed: PgListingFields[] = batch.map((_, idx) => {
    const r = results[idx] || {};
    return {
      condo: typeof r.condo === 'string' ? r.condo.trim() : '',
      address: typeof r.address === 'string' ? r.address.trim() : '',
      area: typeof r.area === 'string' ? r.area.trim() : '',
      coAgentName: typeof r.coAgentName === 'string' ? r.coAgentName.trim() : '',
      coAgentAgency: typeof r.coAgentAgency === 'string' ? r.coAgentAgency.trim() : '',
    };
  });
  return fixed;
}

function emptyFields(): PgListingFields {
  return { condo: '', address: '', area: '', coAgentName: '', coAgentAgency: '' };
}
