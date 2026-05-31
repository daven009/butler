/**
 * OneMap API Client for Singapore geographic services.
 *
 * Provides:
 * 1. Authentication (token management with auto-refresh)
 * 2. Geocoding (address → lat/lng via Search API)
 * 3. Routing (walk/drive distance & time between two points)
 *
 * All coordinates use WGS84 (lat, lng).
 * OneMap API docs: https://www.onemap.gov.sg/apidocs/
 */

const ONEMAP_BASE = 'https://www.onemap.gov.sg/api';

// ── Token management ──

interface TokenCache {
  accessToken: string;
  expiryTimestamp: number; // unix seconds
}

let _tokenCache: TokenCache | null = null;

/**
 * Get a valid OneMap access token.
 *
 * Supports two modes:
 * 1. ONEMAP_TOKEN env var — use a static token directly (simplest)
 * 2. ONEMAP_EMAIL + ONEMAP_PASSWORD — auto-fetch and refresh token via API
 */
export async function getOneMapToken(): Promise<string> {
  // Mode 1: Static token from env (simplest — paste the token you got at registration)
  const staticToken = process.env.ONEMAP_TOKEN;
  if (staticToken) {
    return staticToken;
  }

  // Mode 2: Dynamic token via email/password (auto-refreshes)
  // Return cached token if still valid (with 5 min buffer)
  if (_tokenCache && _tokenCache.expiryTimestamp > Date.now() / 1000 + 300) {
    return _tokenCache.accessToken;
  }

  const email = process.env.ONEMAP_EMAIL;
  const password = process.env.ONEMAP_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'OneMap credentials required. Set either:\n' +
      '  - ONEMAP_TOKEN (static token), or\n' +
      '  - ONEMAP_EMAIL + ONEMAP_PASSWORD (auto-refresh)\n' +
      'Register at https://www.onemap.gov.sg/apidocs/register'
    );
  }

  const res = await fetch(`${ONEMAP_BASE}/auth/post/getToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OneMap auth failed (${res.status}): ${text}`);
  }

  const data = await res.json() as { access_token: string; expiry_timestamp: string };
  _tokenCache = {
    accessToken: data.access_token,
    expiryTimestamp: Number(data.expiry_timestamp),
  };

  return _tokenCache.accessToken;
}

// ── Geocoding ──

export interface GeocodedLocation {
  address: string;
  lat: number;
  lng: number;
  postalCode?: string;
  building?: string;
}

/**
 * Geocode a Singapore address string to lat/lng using OneMap Search API.
 * Returns null if no result found.
 */
export async function geocodeAddress(address: string): Promise<GeocodedLocation | null> {
  const token = await getOneMapToken();
  const params = new URLSearchParams({
    searchVal: address,
    returnGeom: 'Y',
    getAddrDetails: 'Y',
    pageNum: '1',
  });

  const res = await fetch(`${ONEMAP_BASE}/common/elastic/search?${params}`, {
    headers: { Authorization: token },
  });

  if (!res.ok) {
    console.error(`[OneMap geocode] Error ${res.status} for "${address}"`);
    return null;
  }

  const data = await res.json() as {
    found: number;
    results: Array<{
      SEARCHVAL: string;
      ADDRESS: string;
      POSTAL: string;
      BUILDING: string;
      LATITUDE: string;
      LONGITUDE: string;
    }>;
  };

  if (!data.found || !data.results.length) {
    return null;
  }

  const r = data.results[0];
  return {
    address: r.ADDRESS || r.SEARCHVAL,
    lat: parseFloat(r.LATITUDE),
    lng: parseFloat(r.LONGITUDE),
    postalCode: r.POSTAL || undefined,
    building: r.BUILDING !== 'NIL' ? r.BUILDING : undefined,
  };
}

/**
 * Batch geocode multiple addresses. Returns a Map of address → GeocodedLocation.
 * Skips addresses that fail to geocode.
 */
export async function batchGeocode(addresses: string[]): Promise<Map<string, GeocodedLocation>> {
  const results = new Map<string, GeocodedLocation>();
  
  // Deduplicate
  const unique = [...new Set(addresses)];
  
  // Process in parallel batches of 5 to avoid rate limiting
  const BATCH_SIZE = 5;
  for (let i = 0; i < unique.length; i += BATCH_SIZE) {
    const batch = unique.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (addr) => {
      const geo = await geocodeAddress(addr);
      if (geo) results.set(addr, geo);
    });
    await Promise.all(promises);
    
    // Small delay between batches to be respectful of rate limits
    if (i + BATCH_SIZE < unique.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  return results;
}

// ── Routing ──

export type RouteType = 'walk' | 'drive';

export interface RouteResult {
  totalTimeSeconds: number;
  totalDistanceMeters: number;
  routeType: RouteType;
}

/**
 * Get route (walk or drive) between two points using OneMap Routing API.
 * Returns time in seconds and distance in meters.
 */
export async function getRoute(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  routeType: RouteType = 'walk'
): Promise<RouteResult | null> {
  const token = await getOneMapToken();
  const params = new URLSearchParams({
    start: `${startLat},${startLng}`,
    end: `${endLat},${endLng}`,
    routeType,
  });

  const res = await fetch(`${ONEMAP_BASE}/public/routingsvc/route?${params}`, {
    headers: { Authorization: token },
  });

  if (!res.ok) {
    console.error(`[OneMap route] Error ${res.status} for ${routeType}: (${startLat},${startLng}) → (${endLat},${endLng})`);
    return null;
  }

  const data = await res.json() as {
    status: number;
    status_message: string;
    route_summary: {
      total_time: number;
      total_distance: number;
    };
  };

  if (data.status !== 0) {
    console.error(`[OneMap route] No route found: ${data.status_message}`);
    return null;
  }

  return {
    totalTimeSeconds: data.route_summary.total_time,
    totalDistanceMeters: data.route_summary.total_distance,
    routeType,
  };
}

/**
 * Get walking time in minutes between two points.
 * Returns null if route cannot be calculated.
 */
export async function getWalkingMinutes(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number
): Promise<number | null> {
  const route = await getRoute(startLat, startLng, endLat, endLng, 'walk');
  if (!route) return null;
  return route.totalTimeSeconds / 60;
}

/**
 * Get driving time in minutes between two points.
 * Returns null if route cannot be calculated.
 */
export async function getDrivingMinutes(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number
): Promise<number | null> {
  const route = await getRoute(startLat, startLng, endLat, endLng, 'drive');
  if (!route) return null;
  return route.totalTimeSeconds / 60;
}
