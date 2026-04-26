/**
 * LLM-powered criteria parser and semantic matcher.
 *
 * Replaces regex-based parseCriteriaText with GPT-4o-mini calls that can understand
 * any natural language input (Chinese, English, Singlish, etc.) and extract structured
 * search criteria tags.
 *
 * Also provides semantic matching: given a listing's description, decide whether it
 * matches a set of user requirements.
 */
import OpenAI from 'openai';

// ── OpenAI client (lazy init) ──
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY environment variable is not set');
    _openai = new OpenAI({ apiKey });
  }
  return _openai;
}

// ── Tag schema for the LLM ──

const TAG_SCHEMA_DESCRIPTION = `
You are a real-estate search assistant for Singapore properties.
Given user input (which may be in English, Chinese, Singlish, or mixed), extract ALL search criteria as structured tags.

Each tag MUST have these fields:
- label: Human-readable display label (English, concise)
- groupKey: One of the predefined keys below
- groupLabel: Human-readable group name
- mergeStrategy: "replace" (only one value per group) or "union" (multiple values allowed)
- kind: The tag type (see below)
- value: The parsed value (number, string, or boolean)
- source: Use the provided source value

SUPPORTED TAG TYPES:

1. propertyType (groupKey: "propertyType", mergeStrategy: "union")
   - kind: "propertyType"
   - value: "hdb" | "condo" | "landed" | "apartment" | "ec" (executive condo)
   - label: "HDB", "Condo", "Landed", "Apartment", "EC"

2. bedroom (groupKey: "bedroom", mergeStrategy: "replace")
   - kind: "bedroom"
   - value: number (e.g. 3)
   - label: "3 Bed" or "3 Rooms"

3. budgetMax (groupKey: "budget", mergeStrategy: "replace")
   - kind: "budgetMax"
   - value: number (e.g. 2000000)
   - label: "≤ S$2,000,000"

4. budgetMin (groupKey: "budgetMin", mergeStrategy: "replace")
   - kind: "budgetMin"
   - value: number (e.g. 500000)
   - label: "≥ S$500,000"

5. minSize (groupKey: "minSize", mergeStrategy: "replace")
   - kind: "minSize"
   - value: number in sqft (e.g. 1000)
   - label: "≥ 1000 sqft"

6. maxSize (groupKey: "maxSize", mergeStrategy: "replace")
   - kind: "maxSize"
   - value: number in sqft
   - label: "≤ 1500 sqft"

7. location (groupKey: "location", mergeStrategy: "union")
   - kind: "location"
   - value: location name in lowercase (e.g. "bishan", "tampines")
   - label: "Bishan" or "Near Bishan MRT"

8. school (groupKey: "school", mergeStrategy: "union")
   - kind: "school"
   - value: school name in lowercase
   - label: "Nanyang Primary 1km"

9. boolean flags (groupKey = field name, mergeStrategy: "replace")
   - kind: "boolean"
   - field: "petFriendly" | "southFacing" | "renovated" | "highFloor" | "balcony" | "pool" | "gym" | "parking" | "furnished" | "nearMrt" | "cornerUnit" | "cityView" | "seaView" | "quietArea"
   - value: true
   - label: "Pet Friendly", "South-facing", "Renovated", "High Floor", etc.

10. commuteMax (groupKey: "commuteTime", mergeStrategy: "replace")
    - kind: "commuteMax"
    - value: number (minutes)
    - target: destination in lowercase (e.g. "one-north", "cbd", "raffles place")
    - label: "≤ 30 min to one-north"

11. tenure (groupKey: "tenure", mergeStrategy: "replace")
    - kind: "tenure"
    - value: "freehold" | "leasehold" | "999-year" | "99-year"
    - label: "Freehold", "99-year lease", etc.

12. minFloor (groupKey: "minFloor", mergeStrategy: "replace")
    - kind: "minFloor"
    - value: number (floor number)
    - label: "≥ Floor 10"

13. yearBuilt (groupKey: "yearBuilt", mergeStrategy: "replace")
    - kind: "yearBuilt"
    - value: number (year, e.g. 2015)
    - label: "Built after 2015"

14. semantic (groupKey: "semantic", mergeStrategy: "union")
    - kind: "semantic"
    - value: the requirement as a short English phrase (lowercase)
    - label: Short English description (≤ 30 chars)
    - USE THIS for any requirement that doesn't fit the above categories
    - Examples: "quiet neighborhood", "near hawker center", "good feng shui", "mature estate"

IMPORTANT RULES:
- Extract ALL criteria mentioned, even if vague
- Convert Chinese/Singlish to proper English labels
- 永久地契/永久产权 = "freehold", NOT "99-year". 99年地契/99年产权 = "99-year". Distinguish carefully.
- Convert all currency to SGD numbers (e.g. "200万" = 2000000, "$2M" = 2000000, "2k" = 2000)
- Convert sqm to sqft if needed (1 sqm ≈ 10.764 sqft)
- If user says "大于/above/more than X sqft", use minSize
- If user says "小于/below/less than X sqft", use maxSize
- If user says "大约/around X sqft", use both minSize (X*0.9) and maxSize (X*1.1)
- For budget: "under/below/max" → budgetMax; "above/at least/min" → budgetMin
- If no criteria can be extracted, return an empty array
- DO NOT return duplicates
- Return ONLY valid JSON array of tags, no explanation
`;

export interface ParsedTag {
  label: string;
  groupKey: string;
  groupLabel: string;
  mergeStrategy: 'replace' | 'union';
  kind: string;
  value: string | number | boolean;
  field?: string;
  target?: string;
  source: string;
}

/**
 * Use LLM to parse natural language text into structured search tags.
 */
export async function llmParseCriteria(
  rawText: string,
  source: 'text' | 'voice' | 'url' = 'text'
): Promise<ParsedTag[]> {
  const openai = getOpenAI();

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: TAG_SCHEMA_DESCRIPTION + '\n\nReturn a JSON object with a single key "tags" containing the array of tag objects.',
      },
      {
        role: 'user',
        content: `Parse the following user input into search criteria tags.\nSource: ${source}\nUser input: "${rawText}"`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content || '{"tags":[]}';

  try {
    const parsed = JSON.parse(content);
    const tags: ParsedTag[] = (parsed.tags || parsed || []).map((tag: any) => ({
      ...tag,
      source,
    }));
    return tags;
  } catch {
    console.error('[LLM] Failed to parse response:', content);
    return [];
  }
}

// ── Semantic matching: does a listing match a set of criteria? ──

interface ListingSummary {
  id: string;
  title: string;
  address?: string;
  price?: number;
  bedrooms?: number;
  areaSqft?: number;
  propertyType?: string;
  description?: string;
  details?: string;
}

export interface MatchResult {
  listingId: string;
  pass: boolean;
  score: number; // 0-100
  matches: string[];
  misses: string[];
  reasoning?: string;
}

/**
 * Use LLM to evaluate whether listings match semantic/complex criteria.
 * We batch listings into a single call for efficiency.
 */
export async function llmFilterListings(
  listings: ListingSummary[],
  criteria: string[], // human-readable criteria labels
): Promise<MatchResult[]> {
  if (!criteria.length || !listings.length) {
    return listings.map(l => ({
      listingId: l.id,
      pass: true,
      score: 100,
      matches: [],
      misses: [],
    }));
  }

  const openai = getOpenAI();

  // Truncate listings to avoid token limits (max ~20 at a time)
  const batch = listings.slice(0, 30);

  const listingsText = batch.map((l, i) => {
    const parts = [
      `[${i}] ID: ${l.id}`,
      l.title && `Title: ${l.title}`,
      l.address && `Address: ${l.address}`,
      l.price != null && `Price: S$${l.price.toLocaleString('en-SG')}`,
      l.bedrooms != null && `Bedrooms: ${l.bedrooms}`,
      l.areaSqft != null && `Size: ${l.areaSqft} sqft`,
      l.propertyType && `Type: ${l.propertyType}`,
      l.description && `Description: ${l.description.slice(0, 300)}`,
      l.details && `Details: ${l.details.slice(0, 200)}`,
    ].filter(Boolean);
    return parts.join('\n  ');
  }).join('\n\n');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a Singapore real estate listing evaluator.
Given a list of property listings and a set of buyer criteria, evaluate EACH listing against ALL criteria.

For each listing, determine:
- pass: true if the listing reasonably matches ALL criteria (or mostly matches with minor gaps)
- score: 0-100 indicating how well it matches (100 = perfect match)
- matches: array of criteria labels that this listing satisfies
- misses: array of criteria labels that this listing does NOT satisfy

Be generous with matching:
- If a listing description mentions "renovated" or "newly done up", match "Renovated"
- If near an MRT station, match "Near MRT"
- Use common sense for vague criteria like "quiet area", "good location"
- For numeric criteria (price, size), allow ±5% tolerance

Return a JSON object: { "results": [ { "index": 0, "pass": true, "score": 85, "matches": [...], "misses": [...] }, ... ] }
Each result's "index" corresponds to the listing index [0], [1], etc.`,
      },
      {
        role: 'user',
        content: `BUYER CRITERIA:\n${criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\nLISTINGS:\n${listingsText}`,
      },
    ],
  });

  const content = response.choices[0]?.message?.content || '{"results":[]}';

  try {
    const parsed = JSON.parse(content);
    const results = parsed.results || [];

    return batch.map((listing, i) => {
      const r = results.find((r: any) => r.index === i) || {};
      return {
        listingId: listing.id,
        pass: r.pass ?? true,
        score: r.score ?? 100,
        matches: r.matches || [],
        misses: r.misses || [],
      };
    });
  } catch {
    console.error('[LLM] Failed to parse filter response:', content);
    return batch.map(l => ({
      listingId: l.id,
      pass: true,
      score: 100,
      matches: [],
      misses: [],
    }));
  }
}
