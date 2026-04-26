import { useEffect, useMemo, useRef, useState } from 'react';
import Chip from '../components/Chip';
import { searchApi, scrapeApi } from '../lib/api';
import { AB, LISTINGS } from '../data';
import { useAppNav } from '../navigation';

const SOURCE_META = {
  voice: { icon: '🎙', label: 'Voice' },
  text: { icon: '⌨', label: 'Typed' },
  url: { icon: '🔗', label: 'From link' },
};

const DEMO_VOICE_INPUTS = [
  'My client is looking for a 3-bedroom HDB near Bishan MRT, budget around $3,000, must be within Nanyang Primary 1km circle, and the landlord should be okay with a small dog.',
  'Actually, also needs to be within 30 min drive to one-north.',
  'If Bishan is too tight, Tampines is okay too.',
];

const LOCATION_CATALOG = ['Bishan', 'Tampines', 'Bedok', 'Queenstown', 'one-north'];
const SCHOOL_CATALOG = ['Nanyang Primary 1km', 'Angsana Primary 1km'];
const URL_SAMPLE = 'https://www.propertyguru.com.sg/property-for-rent?property_type=hdb&bedrooms=3&district=bishan&maxprice=3000';

function makeId(prefix = 'item') {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function slugify(text = '') {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function isProbablyUrl(text = '') {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

function formatCurrency(value) {
  return `$${Number(value).toLocaleString('en-SG')}/mo`;
}

function createTag({ label, groupKey, groupLabel, mergeStrategy, kind, value, source, target, field }) {
  return {
    id: makeId('tag'),
    label,
    groupKey,
    groupLabel,
    mergeStrategy,
    kind,
    value,
    source,
    target,
    field,
  };
}

function pushUniqueTag(list, tag) {
  if (list.some((item) => item.groupKey === tag.groupKey && item.value === tag.value)) {
    return list;
  }
  return [...list, tag];
}

function parseCriteriaText(rawText, source = 'text') {
  const text = rawText.trim();
  const lower = text.toLowerCase();
  let tags = [];

  if (/\bhdb\b/i.test(text)) {
    tags = pushUniqueTag(tags, createTag({
      label: 'HDB',
      groupKey: 'propertyType',
      groupLabel: 'Property type',
      mergeStrategy: 'union',
      kind: 'propertyType',
      value: 'hdb',
      source,
    }));
  }

  if (/\bcondo\b|\bcondominium\b/i.test(text)) {
    tags = pushUniqueTag(tags, createTag({
      label: 'Condo',
      groupKey: 'propertyType',
      groupLabel: 'Property type',
      mergeStrategy: 'union',
      kind: 'propertyType',
      value: 'condo',
      source,
    }));
  }

  if (/\blanded\b/i.test(text)) {
    tags = pushUniqueTag(tags, createTag({
      label: 'Landed',
      groupKey: 'propertyType',
      groupLabel: 'Property type',
      mergeStrategy: 'union',
      kind: 'propertyType',
      value: 'landed',
      source,
    }));
  }

  const bedroomMatch = text.match(/(\d)\s*(?:-|\s)?(?:bed(?:room)?s?|br|rooms?)/i);
  if (bedroomMatch) {
    const bedrooms = Number(bedroomMatch[1]);
    tags = pushUniqueTag(tags, createTag({
      label: `${bedrooms} Rooms`,
      groupKey: 'bedroom',
      groupLabel: 'Bedrooms',
      mergeStrategy: 'replace',
      kind: 'bedroom',
      value: bedrooms,
      source,
    }));
  }

  const budgetMatch = text.match(/(?:budget(?:\s+around|\s+under|\s+below)?|under|below|around|max)?\s*(?:s\$|\$)\s*([\d,]{4,6})/i);
  if (budgetMatch) {
    const amount = Number(budgetMatch[1].replace(/,/g, ''));
    tags = pushUniqueTag(tags, createTag({
      label: formatCurrency(amount),
      groupKey: 'budget',
      groupLabel: 'Budget',
      mergeStrategy: 'replace',
      kind: 'budgetMax',
      value: amount,
      source,
    }));
  }

  SCHOOL_CATALOG.forEach((school) => {
    const base = school.replace(' 1km', '').toLowerCase();
    if (lower.includes(base)) {
      tags = pushUniqueTag(tags, createTag({
        label: school,
        groupKey: 'school',
        groupLabel: 'School zone',
        mergeStrategy: 'union',
        kind: 'school',
        value: school.toLowerCase(),
        source,
      }));
    }
  });

  LOCATION_CATALOG.forEach((location) => {
    const normalized = location.toLowerCase();
    if (!lower.includes(normalized)) {
      return;
    }

    if (normalized === 'one-north') {
      return;
    }

    const nearMrt = lower.includes(`near ${normalized} mrt`) || lower.includes(`${normalized} mrt`);
    tags = pushUniqueTag(tags, createTag({
      label: nearMrt ? `Near ${location} MRT` : location,
      groupKey: 'location',
      groupLabel: 'Location',
      mergeStrategy: 'union',
      kind: 'location',
      value: normalized,
      source,
    }));
  });

  const commuteMatch = text.match(/within\s+(\d{1,2})\s*min(?:ute)?s?\s*(?:drive|travel)?\s*(?:to|from)\s+([a-z0-9-\s]+)/i);
  if (commuteMatch) {
    const target = commuteMatch[2].trim().replace(/\.$/, '').toLowerCase().replace(/\s+/g, ' ');
    tags = pushUniqueTag(tags, createTag({
      label: `${commuteMatch[1]} min drive to ${target}`,
      groupKey: 'commuteTime',
      groupLabel: 'Commute',
      mergeStrategy: 'replace',
      kind: 'commuteMax',
      value: Number(commuteMatch[1]),
      source,
      target,
    }));
  }

  if (/pet[-\s]?friendly|pets?\s+(?:ok|okay)|small dog|dog friendly|dog ok/i.test(text)) {
    tags = pushUniqueTag(tags, createTag({
      label: 'Pet Friendly',
      groupKey: 'petFriendly',
      groupLabel: 'Pets',
      mergeStrategy: 'replace',
      kind: 'boolean',
      field: 'petFriendly',
      value: true,
      source,
    }));
  }

  if (/south[-\s]?facing/i.test(text)) {
    tags = pushUniqueTag(tags, createTag({
      label: 'South-facing',
      groupKey: 'southFacing',
      groupLabel: 'Aspect',
      mergeStrategy: 'replace',
      kind: 'boolean',
      field: 'southFacing',
      value: true,
      source,
    }));
  }

  if (/renovated/i.test(text)) {
    tags = pushUniqueTag(tags, createTag({
      label: 'Renovated',
      groupKey: 'renovated',
      groupLabel: 'Condition',
      mergeStrategy: 'replace',
      kind: 'boolean',
      field: 'renovated',
      value: true,
      source,
    }));
  }

  if (/high floor/i.test(text)) {
    tags = pushUniqueTag(tags, createTag({
      label: 'High floor',
      groupKey: 'highFloor',
      groupLabel: 'Level',
      mergeStrategy: 'replace',
      kind: 'boolean',
      field: 'highFloor',
      value: true,
      source,
    }));
  }

  // ── Min size (sqft) ──
  // English: "above 1000 sqft", ">1000sqft", "at least 1000 sq ft", "min 1000sqft", "more than 1000 sqft"
  // Chinese: "大于1000sqft", "1000sqft以上", "面积大于1000", "超过1000sqft"
  const sizeMatch = text.match(
    /(?:(?:大于|超过|不低于|至少|面积(?:大于|超过)?|above|over|more\s+than|greater\s+than|at\s+least|min(?:imum)?|>|≥)\s*(\d{3,5})\s*(?:sq\s*f(?:ee)?t|sqft|平方英尺)?|(\d{3,5})\s*(?:sq\s*f(?:ee)?t|sqft|平方英尺)\s*(?:以上|及以上|或以上|above|\+))/i
  );
  if (sizeMatch) {
    const size = Number(sizeMatch[1] || sizeMatch[2]);
    if (size >= 100 && size <= 50000) {
      tags = pushUniqueTag(tags, createTag({
        label: `≥ ${size} sqft`,
        groupKey: 'minSize',
        groupLabel: 'Min size',
        mergeStrategy: 'replace',
        kind: 'minSize',
        value: size,
        source,
      }));
    }
  }

  // ── Semantic tags: extract unmatched phrases as free-text criteria ──
  // Split input into comma/semicolon/newline-separated phrases, then check if
  // each phrase was already captured by a structured tag above.
  if (source !== 'url') {
    const matchedPatterns = [
      /\bhdb\b/i, /\bcondo\b|\bcondominium\b/i, /\blanded\b/i,
      /(\d)\s*(?:-|\s)?(?:bed(?:room)?s?|br|rooms?)/i,
      /(?:budget(?:\s+around|\s+under|\s+below)?|under|below|around|max)?\s*(?:s\$|\$)\s*([\d,]{4,6})/i,
      /pet[-\s]?friendly|pets?\s+(?:ok|okay)|small dog|dog friendly|dog ok/i,
      /south[-\s]?facing/i, /renovated/i, /high floor/i,
      /within\s+(\d{1,2})\s*min(?:ute)?s?\s*(?:drive|travel)?\s*(?:to|from)\s+/i,
      /(?:大于|超过|不低于|至少|面积|above|over|more\s+than|greater\s+than|at\s+least|min(?:imum)?|>|≥)\s*\d{3,5}\s*(?:sq\s*f(?:ee)?t|sqft|平方英尺)?/i,
      /\d{3,5}\s*(?:sq\s*f(?:ee)?t|sqft|平方英尺)\s*(?:以上|及以上|或以上|above|\+)/i,
    ];
    const locationPatterns = LOCATION_CATALOG.map(l => new RegExp(`\\b${l.replace('-', '[-\\s]?')}\\b`, 'i'));
    const schoolPatterns = SCHOOL_CATALOG.map(s => new RegExp(s.replace(' 1km', '').replace(/[-\s]/g, '[-\\s]?'), 'i'));
    const allPatterns = [...matchedPatterns, ...locationPatterns, ...schoolPatterns];

    const phrases = text.split(/[,;.\n]+/).map(s => s.trim()).filter(s => s.length > 2);
    for (const phrase of phrases) {
      const alreadyCaptured = allPatterns.some(rx => rx.test(phrase));
      if (!alreadyCaptured) {
        tags = pushUniqueTag(tags, createTag({
          label: phrase.length > 30 ? phrase.slice(0, 28) + '…' : phrase,
          groupKey: 'semantic',
          groupLabel: 'Keyword filter',
          mergeStrategy: 'union',
          kind: 'semantic',
          value: phrase.toLowerCase(),
          source,
        }));
      }
    }
  }

  return tags;
}

function resolveListingFromUrl(url) {
  const normalized = decodeURIComponent(url).toLowerCase();
  return LISTINGS.find((listing) => {
    return normalized.includes(slugify(listing.name)) || normalized.includes(slugify(listing.area)) || normalized.includes(slugify(listing.mrtStation));
  }) || LISTINGS[0];
}

function parsePropertyGuruUrl(url) {
  const normalized = decodeURIComponent(url).toLowerCase();
  const isSearchUrl = normalized.includes('?') || normalized.includes('property-for-rent') || normalized.includes('property-for-sale');

  if (!isSearchUrl) {
    return {
      kind: 'listing',
      listing: resolveListingFromUrl(url),
      tags: [],
    };
  }

  // ── Parse URL query parameters directly ──
  let params;
  try {
    params = new URL(url).searchParams;
  } catch {
    // Fallback: try to extract query string manually
    const qIdx = url.indexOf('?');
    params = new URLSearchParams(qIdx >= 0 ? url.slice(qIdx + 1) : '');
  }

  let tags = [];

  // NOTE: Listing type (sale/rent) is metadata, not a filter criterion — skip it.

  // Property type: property_type, property_type_code
  const propType = (params.get('property_type') || params.get('property_type_code') || '').toLowerCase();
  if (propType) {
    const typeMap = {
      condo: 'Condo', condominium: 'Condo', 'executive condominium': 'EC',
      hdb: 'HDB', landed: 'Landed', apartment: 'Apartment',
    };
    const label = typeMap[propType] || propType.charAt(0).toUpperCase() + propType.slice(1);
    tags = pushUniqueTag(tags, createTag({
      label,
      groupKey: 'propertyType',
      groupLabel: 'Property type',
      mergeStrategy: 'union',
      kind: 'propertyType',
      value: propType,
      source: 'url',
    }));
  }

  // Bedrooms: bedrooms, beds[], beds
  const bedrooms = params.get('bedrooms') || params.get('beds[]') || params.get('beds');
  if (bedrooms && !isNaN(Number(bedrooms))) {
    tags = pushUniqueTag(tags, createTag({
      label: `${bedrooms} Bed`,
      groupKey: 'bedroom',
      groupLabel: 'Bedrooms',
      mergeStrategy: 'replace',
      kind: 'bedroom',
      value: Number(bedrooms),
      source: 'url',
    }));
  }

  // Max price: maxPrice, maxprice, max_price
  const maxPrice = params.get('maxPrice') || params.get('maxprice') || params.get('max_price');
  if (maxPrice && !isNaN(Number(maxPrice))) {
    const amount = Number(maxPrice);
    tags = pushUniqueTag(tags, createTag({
      label: `≤ ${formatCurrency(amount)}`,
      groupKey: 'budget',
      groupLabel: 'Budget',
      mergeStrategy: 'replace',
      kind: 'budgetMax',
      value: amount,
      source: 'url',
    }));
  }

  // Min price: minPrice, minprice, min_price
  const minPrice = params.get('minPrice') || params.get('minprice') || params.get('min_price');
  if (minPrice && !isNaN(Number(minPrice))) {
    const amount = Number(minPrice);
    tags = pushUniqueTag(tags, createTag({
      label: `≥ ${formatCurrency(amount)}`,
      groupKey: 'budgetMin',
      groupLabel: 'Budget min',
      mergeStrategy: 'replace',
      kind: 'budgetMin',
      value: amount,
      source: 'url',
    }));
  }

  // Location / district: district, district_code, freetext
  const district = params.get('district') || params.get('district_code') || '';
  const freetext = params.get('freetext') || '';
  // NOTE: skip params.get('search') — it's usually "true"/"false", not a location
  const locationStr = (district + ' ' + freetext).trim();
  if (locationStr) {
    // Try matching known locations from catalog first
    const locLower = locationStr.toLowerCase();
    let matched = false;
    LOCATION_CATALOG.forEach((location) => {
      if (locLower.includes(location.toLowerCase())) {
        matched = true;
        tags = pushUniqueTag(tags, createTag({
          label: location,
          groupKey: 'location',
          groupLabel: 'Location',
          mergeStrategy: 'union',
          kind: 'location',
          value: location.toLowerCase(),
          source: 'url',
        }));
      }
    });
    // If no catalog match, use the raw text
    if (!matched && locationStr.length > 1) {
      const label = locationStr.length > 25 ? locationStr.slice(0, 23) + '…' : locationStr;
      tags = pushUniqueTag(tags, createTag({
        label: label.charAt(0).toUpperCase() + label.slice(1),
        groupKey: 'location',
        groupLabel: 'Location',
        mergeStrategy: 'union',
        kind: 'location',
        value: locationStr.toLowerCase(),
        source: 'url',
      }));
    }
  }

  // Min size: minSize, min_size (sqft)
  const minSize = params.get('minSize') || params.get('min_size');
  if (minSize && !isNaN(Number(minSize))) {
    tags = pushUniqueTag(tags, createTag({
      label: `≥ ${Number(minSize)} sqft`,
      groupKey: 'minSize',
      groupLabel: 'Min size',
      mergeStrategy: 'replace',
      kind: 'minSize',
      value: Number(minSize),
      source: 'url',
    }));
  }

  return {
    kind: 'search',
    tags,
  };
}

function mergeIncomingTags(currentTags, incomingTags) {
  let nextTags = [...currentTags];
  const replacements = [];
  let addedCount = 0;

  incomingTags.forEach((tag) => {
    const sameGroup = nextTags.filter((item) => item.groupKey === tag.groupKey);

    // If the existing tag in this group is locked and the incoming one isn't,
    // do NOT replace — locked tags (from URL) are first-layer and immutable.
    const hasLockedInGroup = sameGroup.some((item) => item.locked);
    if (hasLockedInGroup && !tag.locked && tag.mergeStrategy !== 'union') {
      return; // skip — cannot override locked tags
    }

    if (tag.mergeStrategy === 'union') {
      if (sameGroup.some((item) => item.value === tag.value)) {
        return;
      }
      nextTags = [...nextTags, tag];
      addedCount += 1;
      return;
    }

    if (sameGroup.length && sameGroup[0].value === tag.value) {
      return;
    }

    if (sameGroup.length) {
      replacements.push({
        label: tag.groupLabel,
        from: sameGroup.map((item) => item.label).join(' or '),
        to: tag.label,
      });
    }

    nextTags = nextTags.filter((item) => item.groupKey !== tag.groupKey);
    nextTags.push(tag);
    addedCount += 1;
  });

  return { tags: nextTags, replacements, addedCount };
}

function tagMatchesListing(tag, listing) {
  switch (tag.kind) {
    case 'propertyType':
      return listing.propertyType.toLowerCase() === tag.value;
    case 'bedroom':
      return listing.bedrooms === tag.value;
    case 'budgetMax':
      return listing.priceValue <= tag.value;
    case 'budgetMin':
      return listing.priceValue >= tag.value;
    case 'minSize':
      return listing.areaSqft && Number(listing.areaSqft) >= tag.value;
    case 'location':
      return listing.area.toLowerCase() === tag.value || listing.mrtStation.toLowerCase() === tag.value;
    case 'school':
      return listing.schoolZones.some((zone) => zone.toLowerCase() === tag.value);
    case 'boolean':
      return Boolean(listing[tag.field]) === tag.value;
    case 'commuteMax':
      return (listing.commuteDrive?.[tag.target] ?? Number.POSITIVE_INFINITY) <= tag.value;
    default:
      return true;
  }
}

function buildSearchResults(tags, linkedListingIds) {
  const pinnedIds = new Set(linkedListingIds);
  const groupedTags = tags.reduce((acc, tag) => {
    acc[tag.groupKey] = acc[tag.groupKey] || [];
    acc[tag.groupKey].push(tag);
    return acc;
  }, {});

  return LISTINGS.map((listing) => {
    const matchedLabels = [];
    let passes = true;

    Object.values(groupedTags).forEach((group) => {
      if (!passes) {
        return;
      }

      if (group[0].mergeStrategy === 'union') {
        const hits = group.filter((tag) => tagMatchesListing(tag, listing));
        if (!hits.length) {
          passes = false;
          return;
        }
        matchedLabels.push(hits[0].label);
        return;
      }

      if (!tagMatchesListing(group[0], listing)) {
        passes = false;
        return;
      }
      matchedLabels.push(group[0].label);
    });

    const pinned = pinnedIds.has(listing.id);
    if (!passes && !pinned) {
      return null;
    }

    const baseScore = tags.length ? Math.round((matchedLabels.length / tags.length) * 100) : 72;
    const score = Math.min(99, baseScore + (pinned ? 8 : 0));
    return {
      ...listing,
      pinned,
      score,
      matchedLabels,
      reason: pinned && !matchedLabels.length ? 'Added directly from a PropertyGuru link' : matchedLabels.slice(0, 2).join(' · '),
    };
  })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1;
      }
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      return a.priceValue - b.priceValue;
    });
}

function buildCriteriaLayout(tags) {
  const singleTags = [];
  const unionGroups = [];
  const unionMap = {};

  tags.forEach((tag) => {
    if (tag.mergeStrategy === 'union') {
      unionMap[tag.groupKey] = unionMap[tag.groupKey] || [];
      unionMap[tag.groupKey].push(tag);
      return;
    }
    singleTags.push(tag);
  });

  Object.values(unionMap).forEach((group) => {
    if (group.length === 1) {
      singleTags.push(group[0]);
      return;
    }
    unionGroups.push(group);
  });

  return { singleTags, unionGroups };
}

function CriteriaTag({ tag, onRemove }) {
  const bgMap = { url: '#EEF5FF', semantic: '#E6F9F0' };
  const bg = tag.locked ? '#E8EDF4' : (bgMap[tag.source] || bgMap[tag.kind] || '#F4F1EA');
  return (
    <span
      title={`${SOURCE_META[tag.source]?.label || 'Input'} · ${tag.groupLabel}${tag.kind === 'semantic' ? ' (keyword)' : ''}${tag.locked ? ' (from URL — cannot remove)' : ''}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 10px',
        borderRadius: 999,
        background: bg,
        color: AB.ink,
        fontSize: 12.5,
        fontWeight: 600,
        lineHeight: 1,
        maxWidth: '100%',
      }}
    >
      <span style={{ fontSize: 11 }}>{SOURCE_META[tag.source]?.icon || (tag.locked ? '🔗' : '•')}</span>
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tag.label}</span>
      {!tag.locked && (
        <button
          onClick={() => onRemove(tag.id)}
          style={{
            border: 0,
            background: 'transparent',
            padding: 0,
            fontSize: 14,
            lineHeight: 1,
            cursor: 'pointer',
            color: AB.gray,
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}

/* ─── PG scraped listing helpers ─── */

function formatPgPrice(price) {
  if (!price) return '—';
  return `S$${Number(price).toLocaleString('en-SG')}`;
}

/** Keyword-based filter: checks semantic tags against listing description + all detail fields.
 *  Returns { pass: boolean, matches: string[], misses: string[] } */
function aiFilterListing(listing, semanticTags) {
  if (!semanticTags.length) return { pass: true, matches: [], misses: [] };

  const corpus = [
    listing.title,
    listing.address,
    listing.detail?.description,
    listing.detail?.furnishing,
    listing.detail?.tenureDetail,
    listing.detail?.propertyDetailsRaw,
    listing.rawText,
    listing.detail?.floorLevel,
    ...(Object.values(listing.detail?.allDetails || {})),
  ].filter(Boolean).join(' ').toLowerCase();

  const matches = [];
  const misses = [];

  for (const tag of semanticTags) {
    const kw = tag.value; // already lowercase
    // Split multi-word criteria into key terms and check if ALL are present
    const terms = kw.split(/\s+/).filter(t => t.length > 2);
    const found = terms.length > 0 && terms.every(term => corpus.includes(term));
    if (found) {
      matches.push(tag.label);
    } else {
      misses.push(tag.label);
    }
  }

  return {
    pass: misses.length === 0,
    matches,
    misses,
  };
}

/** Filter PG listings against user-added tags (structured + semantic).
 *  Tags with source='url' are skipped — PG already filtered by those URL params.
 *  Returns sorted array with aiResult attached. */
function filterPgListingsWithTags(pgListings, tags) {
  if (!pgListings.length) return [];

  // Skip URL-sourced tags: PropertyGuru already filtered by those search params
  const userTags = tags.filter(t => t.source !== 'url');
  const semanticTags = userTags.filter(t => t.kind === 'semantic');
  const structuredTags = userTags.filter(t => t.kind !== 'semantic');

  return pgListings.map(listing => {
    // ── Structured tag matching (property type, bedrooms, budget, etc.) ──
    let structuredPass = true;
    const structuredMatches = [];
    const structuredMisses = [];

    if (structuredTags.length) {
      const grouped = structuredTags.reduce((acc, tag) => {
        acc[tag.groupKey] = acc[tag.groupKey] || [];
        acc[tag.groupKey].push(tag);
        return acc;
      }, {});

      for (const [, group] of Object.entries(grouped)) {
        const matched = group.some(tag => pgTagMatchesListing(tag, listing));
        if (matched) {
          structuredMatches.push(group[0].label);
        } else {
          structuredMisses.push(group[0].label);
          structuredPass = false;
        }
      }
    }

    // ── Semantic tag matching (keyword search in description) ──
    const aiResult = aiFilterListing(listing, semanticTags);

    const totalCriteria = (structuredTags.length ? Object.keys(structuredTags.reduce((a, t) => { a[t.groupKey] = 1; return a; }, {})).length : 0)
      + semanticTags.length;
    const totalMatches = structuredMatches.length + aiResult.matches.length;
    const score = totalCriteria > 0 ? Math.round((totalMatches / totalCriteria) * 100) : 100;

    return {
      listing,
      aiResult: {
        pass: structuredPass && aiResult.pass,
        matches: [...structuredMatches, ...aiResult.matches],
        misses: [...structuredMisses, ...aiResult.misses],
      },
      score,
    };
  })
    .sort((a, b) => {
      // Passing first, then by score
      if (a.aiResult.pass !== b.aiResult.pass) return a.aiResult.pass ? -1 : 1;
      return b.score - a.score;
    });
}

/** Check if a structured tag matches a PG listing's fields */
function pgTagMatchesListing(tag, listing) {
  const detail = listing.detail || {};
  const corpus = [listing.title, listing.address, listing.propertyType, detail.propertyDetailsRaw, listing.rawText]
    .filter(Boolean).join(' ').toLowerCase();

  switch (tag.kind) {
    case 'propertyType':
      return corpus.includes(tag.value);
    case 'bedroom':
      return listing.bedrooms === tag.value;
    case 'budgetMax':
      return listing.price && Number(listing.price) <= tag.value;
    case 'budgetMin':
      return listing.price && Number(listing.price) >= tag.value;
    case 'minSize':
      return listing.areaSqft && Number(listing.areaSqft) >= tag.value;
    case 'location':
      return corpus.includes(tag.value);
    case 'boolean':
      return corpus.includes(tag.field?.replace(/([A-Z])/g, ' $1').toLowerCase());
    default:
      return false;
  }
}

function PGListingCard({ listing, shortlisted, onToggleShortlist, onGetPhone, phoneLoading, aiResult, matchScore }) {
  const [expanded, setExpanded] = useState(false);
  const detail = listing.detail || {};
  const dimmed = aiResult && !aiResult.pass;

  return (
    <div
      style={{
        padding: '14px 0',
        borderTop: `1px solid ${AB.border}`,
        opacity: dimmed ? 0.5 : 1,
        transition: 'opacity 200ms ease',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', gap: 12 }}>
        <div
          onClick={() => setExpanded(v => !v)}
          style={{
            width: 84,
            height: 84,
            borderRadius: 16,
            flexShrink: 0,
            background: `linear-gradient(135deg, ${AB.babu}20, ${AB.babu}45)`,
            position: 'relative',
            overflow: 'hidden',
            cursor: 'pointer',
          }}
        >
          <div style={{ position: 'absolute', inset: 0, backgroundImage: `repeating-linear-gradient(-45deg, ${AB.babu}18 0 6px, transparent 6px 12px)` }} />
          <div style={{ position: 'absolute', left: 8, bottom: 8, fontSize: 9, fontWeight: 700, letterSpacing: 0.5, color: AB.babu, textTransform: 'uppercase' }}>
            {listing.detail?.propertyCategory?.replace(/for (sale|rent)/i, '').trim() || listing.propertyType || 'PG'}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div
                  style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.3, cursor: 'pointer' }}
                  onClick={() => window.open(listing.url, '_blank', 'noopener,noreferrer')}
                >
                  {listing.title}
                </div>
              </div>
              {listing.address && (
                <div style={{ fontSize: 12, color: AB.gray, marginTop: 2 }}>{listing.address}</div>
              )}
              <div style={{ fontSize: 12.5, color: AB.ink, fontWeight: 600, marginTop: 3 }}>
                {formatPgPrice(listing.price)}
                {listing.psfLabel ? ` · ${listing.psfLabel}` : ''}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              {matchScore !== null && (
                <div style={{ fontSize: 12, fontWeight: 700, color: aiResult.pass ? AB.babu : AB.hack }}>{matchScore}%</div>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onToggleShortlist(listing.url); }}
                aria-label={shortlisted ? 'Remove from shortlist' : 'Add to shortlist'}
                style={{
                  border: 0, background: 'transparent', padding: 0,
                  width: 24, height: 24, display: 'grid', placeItems: 'center', cursor: 'pointer',
                  color: shortlisted ? AB.rausch : AB.gray2,
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill={shortlisted ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m12 21-1.45-1.32C5.4 15.01 2 11.93 2 8.15 2 5.08 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.08 22 8.15c0 3.78-3.4 6.86-8.55 11.54L12 21Z" />
                </svg>
              </button>
            </div>
          </div>

          {/* Tags row */}
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
            {listing.bedrooms && <Chip>{listing.bedrooms} Bed</Chip>}
            {listing.bathrooms && <Chip>{listing.bathrooms} Bath</Chip>}
            {listing.areaSqft && <Chip>{listing.areaSqft} sqft</Chip>}
            {detail.tenureDetail && <Chip>{detail.tenureDetail}</Chip>}
            {detail.furnishing && <Chip>{detail.furnishing}</Chip>}
          </div>

          {/* AI match indicators */}
          {aiResult && (aiResult.matches.length > 0 || aiResult.misses.length > 0) && (
            <div style={{ marginTop: 6, fontSize: 11.5, lineHeight: 1.4 }}>
              {aiResult.matches.map(m => (
                <span key={m} style={{ color: AB.babu, marginRight: 8 }}>✅ {m}</span>
              ))}
              {aiResult.misses.map(m => (
                <span key={m} style={{ color: AB.hack, marginRight: 8 }}>⚠️ {m}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Agent row + phone button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, paddingLeft: 96, gap: 8 }}>
        <div style={{ fontSize: 12, color: AB.gray }}>
          🏠 {listing.agent || detail.agentName || 'Agent unknown'}
          {detail.agentPhone && (
            <a href={`https://wa.me/${detail.agentPhone.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer"
              style={{ marginLeft: 8, color: '#25D366', fontWeight: 600, textDecoration: 'none' }}>
              📱 {detail.agentPhone}
            </a>
          )}
        </div>
        {!detail.agentPhone && (
          <button
            onClick={(e) => { e.stopPropagation(); onGetPhone(listing.url); }}
            disabled={phoneLoading}
            style={{
              border: `1px solid ${AB.border}`, borderRadius: 999, background: '#FBFBFB',
              padding: '5px 10px', fontSize: 11, fontWeight: 600, cursor: phoneLoading ? 'wait' : 'pointer',
              color: AB.ink, whiteSpace: 'nowrap',
            }}
          >
            {phoneLoading ? '⏳ Getting...' : '📞 Get WhatsApp'}
          </button>
        )}
      </div>

      {/* Expandable detail section */}
      <div style={{ paddingLeft: 96, marginTop: 6 }}>
        <button
          onClick={() => setExpanded(v => !v)}
          style={{ border: 0, background: 'transparent', padding: 0, fontSize: 12, color: AB.babu, fontWeight: 600, cursor: 'pointer' }}
        >
          {expanded ? '▲ Hide details' : '▼ View details'}
        </button>
        {expanded && detail.description && (
          <div style={{
            marginTop: 8, padding: 12, borderRadius: 14, background: '#F7F7F7',
            fontSize: 12.5, color: AB.ink, lineHeight: 1.6, maxHeight: 200, overflowY: 'auto',
          }}>
            {detail.description.slice(0, 800)}{detail.description.length > 800 ? '…' : ''}
          </div>
        )}
        {expanded && detail.allDetails && (
          <div style={{ marginTop: 8, display: 'grid', gap: 4, fontSize: 12 }}>
            {Object.entries(detail.allDetails).map(([k, v]) => (
              <div key={k}><span style={{ color: AB.gray }}>{k}:</span> <span style={{ fontWeight: 500 }}>{v}</span></div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ListingCard({ listing, shortlisted, onToggleShortlist }) {
  function openListing() {
    window.open(listing.listingUrl, '_blank', 'noopener,noreferrer');
  }

  return (
    <div
      onClick={openListing}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openListing();
        }
      }}
      role="link"
      tabIndex={0}
      style={{
        display: 'flex',
        gap: 12,
        padding: '14px 0',
        borderTop: `1px solid ${AB.border}`,
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          width: 84,
          height: 84,
          borderRadius: 16,
          flexShrink: 0,
          background: `linear-gradient(135deg, ${listing.color}20, ${listing.color}45)`,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', inset: 0, backgroundImage: `repeating-linear-gradient(-45deg, ${listing.color}18 0 6px, transparent 6px 12px)` }} />
        <div style={{ position: 'absolute', left: 8, bottom: 8, fontSize: 10, fontWeight: 700, letterSpacing: 0.5, color: listing.color, textTransform: 'uppercase' }}>{listing.area}</div>
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{listing.name}</div>
              {listing.pinned && <Chip tone="amber">Added via link</Chip>}
            </div>
            <div style={{ fontSize: 12.5, color: AB.gray, marginTop: 2 }}>{listing.propertyType} · {listing.bed} · {listing.price}/mo</div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: AB.rausch }}>{listing.score}%</div>
            <button
              onClick={(event) => {
                event.stopPropagation();
                onToggleShortlist(listing.id);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
              }}
              aria-label={shortlisted ? 'Remove from shortlist' : 'Add to shortlist'}
              style={{
                border: 0,
                background: 'transparent',
                padding: 0,
                width: 24,
                height: 24,
                display: 'grid',
                placeItems: 'center',
                cursor: 'pointer',
                color: shortlisted ? AB.rausch : AB.gray2,
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill={shortlisted ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m12 21-1.45-1.32C5.4 15.01 2 11.93 2 8.15 2 5.08 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.08 22 8.15c0 3.78-3.4 6.86-8.55 11.54L12 21Z" />
              </svg>
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 8 }}>
          {listing.petFriendly && <Chip tone="green">✓ pet-friendly</Chip>}
          <Chip>{listing.mrt}</Chip>
          {listing.schoolZones[0] && <Chip>{listing.schoolZones[0]}</Chip>}
        </div>

        <div style={{ fontSize: 11.5, color: AB.gray, marginTop: 8, lineHeight: 1.4 }}>
          AI fit <strong style={{ color: AB.ink }}>{listing.score}%</strong>
          {listing.reason ? ` · ${listing.reason}` : ''}
        </div>
      </div>
    </div>
  );
}

export default function Search() {
  const nav = useAppNav();
  const [inputMode, setInputMode] = useState('voice');
  const [draft, setDraft] = useState('');
  const [tags, setTags] = useState([]);
  const [transcript, setTranscript] = useState([]);
  const [linkedListingIds, setLinkedListingIds] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [showCriteria, setShowCriteria] = useState(false);
  const [showDiscardSheet, setShowDiscardSheet] = useState(false);
  const [shortlistedIds, setShortlistedIds] = useState([]);
  const [toast, setToast] = useState('');
  const [results, setResults] = useState([]);

  // ── PG live scraping state ──
  const [pgListings, setPgListings] = useState([]); // scraped PG listings (raw from API)
  const [pgLoading, setPgLoading] = useState(false); // true while scraping
  const [pgError, setPgError] = useState('');
  const [pgShortlistedUrls, setPgShortlistedUrls] = useState([]); // shortlisted by URL
  const [phoneLoadingUrls, setPhoneLoadingUrls] = useState(new Set()); // URLs currently fetching phone

  // ── On mount: restore stored PG listings from backend DB ──
  useEffect(() => {
    scrapeApi.storedListings()
      .then((result) => {
        const stored = result.listings || [];
        if (stored.length) {
          // Extract the `data` field — that's the flat listing object the frontend expects
          const flatListings = stored.map((entry) => entry.data).filter(Boolean);
          setPgListings(flatListings);

          // Find the _sourceUrl with the MOST query parameters (most informative)
          let bestUrl = '';
          let bestParamCount = -1;
          flatListings.forEach((listing) => {
            const u = listing?._sourceUrl || '';
            if (!u.includes('propertyguru.com')) return;
            const qIdx = u.indexOf('?');
            const paramCount = qIdx >= 0 ? u.slice(qIdx + 1).split('&').length : 0;
            if (paramCount > bestParamCount) {
              bestParamCount = paramCount;
              bestUrl = u;
            }
          });

          if (bestUrl) {
            const pgParsed = parsePropertyGuruUrl(bestUrl);
            if (pgParsed.tags?.length) {
              // Mark URL-derived tags as locked (cannot be removed — first-layer filter)
              const lockedTags = pgParsed.tags.map((t) => ({ ...t, locked: true }));
              setTags((current) => {
                if (current.length === 0) return mergeIncomingTags(current, lockedTags).tags;
                return current;
              });
            }
          }
        }
      })
      .catch(() => { /* silently ignore — fresh start */ });
  }, []);

  const recognitionRef = useRef(null);
  const shouldCommitVoiceRef = useRef(false);
  const pendingVoiceTextRef = useRef('');
  const voiceDemoIndexRef = useRef(0);

  useEffect(() => {
    const SpeechRecognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
    if (!SpeechRecognition) {
      return undefined;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-SG';
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      pendingVoiceTextRef.current = Array.from(event.results)
        .map((item) => item[0]?.transcript || '')
        .join(' ')
        .trim();
    };

    recognition.onend = () => {
      if (!shouldCommitVoiceRef.current) {
        return;
      }

      shouldCommitVoiceRef.current = false;
      const fallback = DEMO_VOICE_INPUTS[voiceDemoIndexRef.current % DEMO_VOICE_INPUTS.length];
      if (!pendingVoiceTextRef.current.trim()) {
        voiceDemoIndexRef.current += 1;
      }
      handleIncomingInput(pendingVoiceTextRef.current.trim() || fallback, 'voice');
      pendingVoiceTextRef.current = '';
    };

    recognitionRef.current = recognition;
    return () => {
      recognition.stop?.();
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    searchApi.results(tags, linkedListingIds)
      .then((response) => setResults(response.results || []))
      .catch(() => setResults([]));
  }, [tags, linkedListingIds]);

  const { singleTags, unionGroups } = useMemo(() => buildCriteriaLayout(tags), [tags]);
  const lastUserEntry = useMemo(() => {
    return [...transcript].reverse().find((entry) => entry.from === 'user') || null;
  }, [transcript]);

  function removeTag(tagId) {
    setTags((currentTags) => {
      const tag = currentTags.find((t) => t.id === tagId);
      if (tag?.locked) return currentTags; // URL-derived tags cannot be removed
      return currentTags.filter((t) => t.id !== tagId);
    });
  }

  function applyIncomingTags(incomingTags) {
    let mergeResult = { tags: [], replacements: [], addedCount: 0 };
    setTags((currentTags) => {
      mergeResult = mergeIncomingTags(currentTags, incomingTags);
      return mergeResult.tags;
    });
    return mergeResult;
  }

  function handleIncomingInput(rawText, source = 'text') {
    const text = rawText.trim();
    if (!text) {
      return;
    }

    setTranscript((current) => [...current, { id: makeId('turn'), from: 'user', source, text }]);

    // ── PG URL → extract URL tags + trigger real scraping ──
    if (isProbablyUrl(text) && text.includes('propertyguru.com')) {
      setPgLoading(true);
      setPgError('');
      setToast('🔍 Scraping PropertyGuru listings…');

      // Immediately parse URL params into tags and show in criteria panel
      // URL-derived tags are locked (first-layer filter — cannot be removed)
      const pgParsed = parsePropertyGuruUrl(text);
      if (pgParsed.tags?.length) {
        applyIncomingTags(pgParsed.tags.map((t) => ({ ...t, locked: true })));
      }

      scrapeApi.listings(text, { limit: 20 })
        .then((result) => {
          const listings = result.listings || [];
          setPgListings(listings);
          setPgLoading(false);
          if (listings.length) {
            const db = result.db || {};
            const dbInfo = db.inserted ? ` (${db.inserted} new, ${db.updated} updated, ${db.total} total in DB)` : '';
            setToast(`✅ ${listings.length} listings scraped${dbInfo}`);
          } else {
            setToast('No listings found at that URL.');
          }
        })
        .catch((err) => {
          setPgLoading(false);
          setPgError(err.message || 'Scraping failed');
          setToast('⚠️ Scraping failed — check the URL or try again.');
        });
      return;
    }

    // ── Non-URL text: parse into tags via LLM (structured + semantic) ──
    if (pgListings.length > 0) {
      // Use LLM for parsing — much more flexible than regex
      setToast('🧠 Understanding your requirements…');
      searchApi.parseLlm(text, source)
        .then((response) => {
          const llmTags = response.tags || [];
          if (llmTags.length) {
            const result = applyIncomingTags(llmTags);
            if (result.replacements.length) {
              const latest = result.replacements[result.replacements.length - 1];
              setToast(`${latest.label} updated: ${latest.from} → ${latest.to}`);
            } else {
              setToast(`🎯 ${result.addedCount} filter${result.addedCount > 1 ? 's' : ''} added to criteria.`);
            }
          } else {
            setToast('Try mentioning location, budget, bedrooms, or specific requirements.');
          }
        })
        .catch(() => {
          // Fallback to local regex parsing if LLM fails
          const localTags = parseCriteriaText(text, source);
          if (localTags.length) {
            const result = applyIncomingTags(localTags);
            if (result.replacements.length) {
              const latest = result.replacements[result.replacements.length - 1];
              setToast(`${latest.label} updated: ${latest.from} → ${latest.to}`);
            } else {
              setToast(`🎯 ${result.addedCount} filter${result.addedCount > 1 ? 's' : ''} added (offline mode).`);
            }
          } else {
            setToast('Try mentioning location, budget, bedrooms, or specific requirements.');
          }
        });
      return;
    }

    // ── Fallback: legacy URL import or text parse ──
    if (isProbablyUrl(text)) {
      searchApi.importLink(text)
        .then((parsed) => {
          if (parsed.kind === 'listing') {
            setLinkedListingIds((current) => (current.includes(parsed.listing.id) ? current : [parsed.listing.id, ...current]));
            setToast(`Added ${parsed.listing.name} from link.`);
            return;
          }

          const result = applyIncomingTags(parsed.tags);
          if (result.replacements.length) {
            const latest = result.replacements[result.replacements.length - 1];
            setToast(`${latest.label} updated: ${latest.from} → ${latest.to}`);
            return;
          }
          setToast(`Imported ${parsed.tags.length} criteria from link.`);
        })
        .catch(() => setToast('Unable to import that PropertyGuru link right now.'));
      return;
    }

    searchApi.parse(text, source)
      .then((response) => {
        const parsedTags = response.tags || [];
        if (!parsedTags.length) {
          setToast('Try mentioning location, budget, bedrooms, school or pet needs.');
          return;
        }

        const result = applyIncomingTags(parsedTags);
        if (result.replacements.length) {
          const latest = result.replacements[result.replacements.length - 1];
          setToast(`${latest.label} updated: ${latest.from} → ${latest.to}`);
          return;
        }

        setToast(`${parsedTags.length} criteria added.`);
      })
      .catch(() => setToast('Search parsing is unavailable right now.'));
  }

  // ── Fetch phone number for a single listing URL ──
  function handleGetPhone(url) {
    setPhoneLoadingUrls(prev => new Set([...prev, url]));
    scrapeApi.phones([url])
      .then((res) => {
        const phoneResult = res.results?.[0];
        if (phoneResult?.agentPhone) {
          // Update the listing in state with the phone number
          setPgListings(prev => prev.map(l => {
            if (l.url === url) {
              return {
                ...l,
                detail: { ...l.detail, agentPhone: phoneResult.agentPhone, agentName: phoneResult.agentName || l.detail?.agentName },
              };
            }
            return l;
          }));
          setToast(`📞 Got number: ${phoneResult.agentPhone}`);
        } else {
          setToast('⚠️ Phone number not found (may need login — run npm run pg:login first)');
        }
      })
      .catch(() => setToast('⚠️ Failed to fetch phone number'))
      .finally(() => setPhoneLoadingUrls(prev => { const n = new Set(prev); n.delete(url); return n; }));
  }

  function togglePgShortlist(url) {
    const exists = pgShortlistedUrls.includes(url);
    const next = exists ? pgShortlistedUrls.filter(u => u !== url) : [...pgShortlistedUrls, url];
    setPgShortlistedUrls(next);
    setToast(exists ? `Removed from shortlist · ${next.length} remaining` : `Saved to shortlist · ${next.length} total`);
  }

  // ── Compute filtered PG listings based on tags (structured + LLM semantic) ──
  const [filteredPgData, setFilteredPgData] = useState([]);

  useEffect(() => {
    if (!pgListings.length) {
      setFilteredPgData([]);
      return;
    }

    // Step 1: Immediate structural filtering (bedrooms, price, size, etc.)
    const structuralResult = filterPgListingsWithTags(pgListings, tags);
    setFilteredPgData(structuralResult);

    // Step 2: If there are semantic tags, send to LLM for deeper evaluation
    const userTags = tags.filter(t => t.source !== 'url');
    const semanticTags = userTags.filter(t => t.kind === 'semantic');
    if (!semanticTags.length) return;

    // Build lightweight listing summaries for the LLM
    const listingSummaries = structuralResult
      .filter(d => d.aiResult.pass) // Only evaluate structurally-passing listings
      .map(d => ({
        id: d.listing.url || d.listing.id,
        title: d.listing.title,
        address: d.listing.address,
        price: d.listing.price ? Number(d.listing.price) : undefined,
        bedrooms: d.listing.bedrooms,
        areaSqft: d.listing.areaSqft ? Number(d.listing.areaSqft) : undefined,
        propertyType: d.listing.propertyType,
        description: d.listing.detail?.description,
        details: [
          d.listing.detail?.furnishing,
          d.listing.detail?.tenureDetail,
          d.listing.detail?.propertyDetailsRaw,
          d.listing.detail?.floorLevel,
        ].filter(Boolean).join(' · '),
      }));

    if (!listingSummaries.length) return;

    const criteriaLabels = semanticTags.map(t => t.label);

    searchApi.filterLlm(listingSummaries, criteriaLabels)
      .then((response) => {
        const llmResults = response.results || [];
        const llmMap = new Map(llmResults.map(r => [r.listingId, r]));

        setFilteredPgData((prev) => {
          const updated = prev.map(item => {
            const llm = llmMap.get(item.listing.url || item.listing.id);
            if (!llm) return item;

            // Merge LLM results with structural results
            return {
              ...item,
              aiResult: {
                pass: item.aiResult.pass && llm.pass,
                matches: [...item.aiResult.matches, ...llm.matches],
                misses: [...item.aiResult.misses, ...llm.misses],
              },
              score: Math.round((item.score + llm.score) / 2),
            };
          });
          // Re-sort: passing first, then by score
          return updated.sort((a, b) => {
            if (a.aiResult.pass !== b.aiResult.pass) return a.aiResult.pass ? -1 : 1;
            return b.score - a.score;
          });
        });
      })
      .catch(() => {
        // LLM failed — keep structural results only (already set)
      });
  }, [pgListings, tags]);

  const filteredPgListings = filteredPgData.map(d => d.listing);

  function beginVoiceCapture() {
    setIsRecording(true);
    setInputMode('voice');
    pendingVoiceTextRef.current = '';

    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
      } catch {
        // noop: browser speech recognition may throw when restarted too quickly
      }
    }
  }

  function finishVoiceCapture() {
    if (!isRecording) {
      return;
    }

    setIsRecording(false);
    shouldCommitVoiceRef.current = true;

    if (recognitionRef.current) {
      recognitionRef.current.stop();
      return;
    }

    const fallback = DEMO_VOICE_INPUTS[voiceDemoIndexRef.current % DEMO_VOICE_INPUTS.length];
    voiceDemoIndexRef.current += 1;
    shouldCommitVoiceRef.current = false;
    handleIncomingInput(fallback, 'voice');
  }

  function submitDraft() {
    if (!draft.trim()) {
      return;
    }
    handleIncomingInput(draft, 'text');
    setDraft('');
  }

  function handleCancelPress() {
    if (!tags.length && !linkedListingIds.length && !transcript.length) {
      nav('home');
      return;
    }
    setShowDiscardSheet(true);
  }

  function handleNextPress() {
    if (!shortlistedIds.length) {
      return;
    }

    nav('buyer', {
      state: {
        shortlistedIds,
        shortlistedListings: results.filter((listing) => shortlistedIds.includes(listing.id)),
        tags,
        linkedListingIds,
      },
    });
  }

  const previewTags = tags.length > 5 ? tags.slice(0, 4) : tags;
  const hasPgResults = filteredPgListings.length > 0;
  const hasResults = results.length > 0 || hasPgResults;
  const shortlistedCount = shortlistedIds.length + pgShortlistedUrls.length;

  function toggleShortlist(listingId) {
    const exists = shortlistedIds.includes(listingId);
    const next = exists
      ? shortlistedIds.filter((id) => id !== listingId)
      : [...shortlistedIds, listingId];

    setShortlistedIds(next);
    setToast(exists ? `Removed from shortlist · ${next.length} remaining` : `Saved to shortlist · ${next.length} total`);
  }

  return (
    <div className="screen screen--white">
      <header className="screen-header screen-header--glass">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <button onClick={handleCancelPress} className="icon-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={AB.ink} strokeWidth="2.2" strokeLinecap="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="eyebrow">New search</div>
            <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 25, fontWeight: 600, letterSpacing: -0.4, lineHeight: 1.1 }}>Live search brief</div>
          </div>

          <button
            onClick={handleNextPress}
            disabled={!shortlistedCount}
            style={{
              border: 0,
              borderRadius: 999,
              background: shortlistedCount ? AB.rausch : '#E6E6E6',
              color: shortlistedCount ? '#fff' : AB.gray,
              padding: '10px 16px',
              fontSize: 13,
              fontWeight: 700,
              cursor: shortlistedCount ? 'pointer' : 'not-allowed',
              boxShadow: shortlistedCount ? '0 8px 18px rgba(255,56,92,0.18)' : 'none',
              transition: 'all 160ms ease',
            }}
          >
            Next
          </button>
        </div>

        <div style={{ position: 'relative', marginTop: 12 }}>
          <button
            onClick={() => setShowCriteria((value) => !value)}
            style={{
              width: '100%',
              border: `1px solid ${AB.border}`,
              borderRadius: 18,
              background: '#FBFBFB',
              padding: '14px 14px 12px',
              textAlign: 'left',
              boxShadow: '0 4px 14px rgba(0,0,0,0.03)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <div className="section-label">Search Criteria</div>
                <div style={{ fontSize: 13, color: AB.gray, marginTop: 4 }}>
                  {tags.length ? `${tags.length} live filters` : 'Speak, type or paste a PropertyGuru link to create filters'}
                </div>
              </div>
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 999,
                  display: 'grid',
                  placeItems: 'center',
                  color: AB.gray,
                  flexShrink: 0,
                  transform: showCriteria ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 160ms ease',
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </div>
            </div>

            {!!previewTags.length && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
                {previewTags.map((tag) => (
                  <span key={tag.id} style={{ padding: '6px 10px', borderRadius: 999, background: '#F3EFE7', fontSize: 12, fontWeight: 600 }}>
                    {tag.label}
                  </span>
                ))}
                {tags.length > previewTags.length && (
                  <span style={{ padding: '6px 10px', borderRadius: 999, background: '#F3EFE7', fontSize: 12, fontWeight: 700 }}>
                    +{tags.length - previewTags.length}
                  </span>
                )}
              </div>
            )}
          </button>

          {showCriteria && (
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: 'calc(100% + 8px)',
                zIndex: 20,
                background: AB.white,
                border: `1px solid ${AB.border}`,
                borderRadius: 22,
                boxShadow: '0 20px 40px rgba(0,0,0,0.14)',
                padding: 16,
              }}
            >
              {!!singleTags.length && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {singleTags.map((tag) => <CriteriaTag key={tag.id} tag={tag} onRemove={removeTag} />)}
                </div>
              )}

              {!!unionGroups.length && (
                <div style={{ display: 'grid', gap: 12, marginTop: singleTags.length ? 14 : 0 }}>
                  {unionGroups.map((group) => (
                    <div key={group[0].groupKey} style={{ border: `1px solid ${AB.border}`, borderRadius: 18, padding: 12, background: '#FCFCFC' }}>
                      <div className="section-label" style={{ marginBottom: 10 }}>
                        {group[0].groupLabel} · OR
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                        {group.map((tag, index) => (
                          <div key={tag.id} style={{ display: 'inline-flex', gap: 8, alignItems: 'center', maxWidth: '100%' }}>
                            <CriteriaTag tag={tag} onRemove={removeTag} />
                            {index < group.length - 1 && <span style={{ fontSize: 12, fontWeight: 700, color: AB.gray }}>or</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!tags.length && (
                <div style={{ marginTop: 14, padding: '14px 12px', borderRadius: 16, background: '#F7F7F7', fontSize: 13, color: AB.gray, lineHeight: 1.5 }}>
                  Try a natural brief like “3-bedroom HDB near Bishan MRT, under $3,000, Nanyang Primary 1km, pet-friendly”.
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      <div className="screen-body">
        <div style={{ padding: '18px 20px 18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 12 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 16 }}>
                {pgLoading ? '🔍 Scraping PropertyGuru…' : hasPgResults ? `${filteredPgListings.length} listings scraped${tags.length ? ` · ${filteredPgData.filter(d => d.aiResult.pass).length} match` : ''}` : hasResults ? `${results.length} listings matched` : tags.length ? 'No matches yet' : 'Start with a brief'}
              </div>
              <div style={{ fontSize: 12.5, color: AB.gray, marginTop: 3 }}>
                {pgLoading ? 'Fetching listings with details from PropertyGuru (may take a minute)…' : hasPgResults ? 'Type criteria below to narrow down — filters auto-apply.' : hasResults ? 'Results update instantly as criteria change.' : tags.length ? 'Loosen a filter or add an alternate location.' : 'Paste a PropertyGuru search URL, or describe what your buyer wants.'}
              </div>
            </div>
            {hasResults && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 12, color: AB.gray }}>{hasPgResults ? 'from PG' : 'ranked by AI fit'}</div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: shortlistedCount ? AB.rausch : AB.gray, marginTop: 4 }}>
                  {shortlistedCount} shortlisted
                </div>
              </div>
            )}
          </div>

          {pgError && (
            <div style={{ padding: '10px 14px', borderRadius: 14, background: '#FFF3F0', color: AB.hack, fontSize: 13, marginBottom: 12 }}>
              ⚠️ {pgError}
            </div>
          )}

          {/* ── PG loading skeleton ── */}
          {pgLoading && (
            <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div style={{ fontSize: 12.5, color: AB.gray }}>
                  🌐 Opening Chrome and navigating to PropertyGuru…
                </div>
                <button
                  onClick={() => {
                    setPgLoading(false);
                    setPgError('Scraping cancelled by user.');
                    setToast('Scraping cancelled.');
                  }}
                  style={{
                    border: 'none',
                    background: '#F3F3F3',
                    borderRadius: 10,
                    padding: '4px 12px',
                    fontSize: 12,
                    fontWeight: 600,
                    color: AB.hack || '#c13515',
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              </div>
              {[1, 2, 3].map(i => (
                <div key={i} style={{ height: 80, borderRadius: 16, background: '#F3F3F3', animation: 'pulse 1.5s ease-in-out infinite' }} />
              ))}
            </div>
          )}

          {/* ── PG scraped results ── */}
          {hasPgResults && (
            <>
              <div>
                {filteredPgData.map(({ listing, aiResult, score }) => (
                  <PGListingCard
                    key={listing.url}
                    listing={listing}
                    shortlisted={pgShortlistedUrls.includes(listing.url)}
                    onToggleShortlist={togglePgShortlist}
                    onGetPhone={handleGetPhone}
                    phoneLoading={phoneLoadingUrls.has(listing.url)}
                    aiResult={aiResult}
                    matchScore={score}
                  />
                ))}
              </div>
            </>
          )}

          {/* ── Legacy mock results (when no PG listings) ── */}
          {!hasPgResults && !pgLoading && hasResults && (
            <div>
              {results.map((listing) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  shortlisted={shortlistedIds.includes(listing.id)}
                  onToggleShortlist={toggleShortlist}
                />
              ))}
            </div>
          )}

          {/* ── Empty state ── */}
          {!hasResults && !pgLoading && (
            <div style={{ marginTop: 18, border: `1px solid ${AB.border}`, borderRadius: 24, padding: 18, background: '#FBFBFB' }}>
              <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 26, fontWeight: 600, lineHeight: 1.05, letterSpacing: -0.5 }}>
                Search now starts as a conversation.
              </div>
              <div style={{ fontSize: 14, color: AB.gray, lineHeight: 1.6, marginTop: 10 }}>
                Paste a PropertyGuru search URL to scrape real listings, or hold the mic / type to describe what your buyer wants. Butler fetches listings, extracts details, and lets you filter them.
              </div>

              <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
                <button
                  onClick={() => {
                    setInputMode('text');
                    setDraft('https://www.propertyguru.com.sg/property-for-sale?market=residential&listing_type=sale&search=true');
                  }}
                  style={{
                    border: 0,
                    borderRadius: 16,
                    background: AB.rausch,
                    color: '#fff',
                    padding: '14px 16px',
                    fontWeight: 600,
                    textAlign: 'left',
                  }}
                >
                  📎 Try a sample PG search URL
                </button>
                <button
                  onClick={() => handleIncomingInput(DEMO_VOICE_INPUTS[0], 'voice')}
                  style={{
                    border: `1px solid ${AB.border}`,
                    borderRadius: 16,
                    background: AB.white,
                    padding: '14px 16px',
                    textAlign: 'left',
                  }}
                >
                  🎙 Try the demo voice brief
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="screen-footer" style={{ padding: '12px 16px 16px', background: AB.white, borderTop: `1px solid ${AB.border}` }}>
        {toast && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
            <div className="toast">{toast}</div>
          </div>
        )}

        {lastUserEntry && (
          <div
            style={{
              marginBottom: 10,
              padding: '10px 14px',
              borderRadius: 18,
              background: '#F6F3EE',
              color: AB.ink,
              fontSize: 13,
              lineHeight: 1.45,
              boxShadow: '0 6px 18px rgba(0,0,0,0.05)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: AB.gray, marginBottom: 4 }}>
              <span>{SOURCE_META[lastUserEntry.source]?.icon || '💬'}</span>
              <span>Latest brief</span>
            </div>
            {lastUserEntry.text}
          </div>
        )}

        <div style={{ borderRadius: 26, background: AB.white, border: `1px solid ${AB.border}`, boxShadow: '0 18px 32px rgba(0,0,0,0.08)', padding: 12 }}>
          {inputMode === 'voice' ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                onPointerDown={(event) => {
                  event.preventDefault();
                  beginVoiceCapture();
                }}
                onPointerUp={(event) => {
                  event.preventDefault();
                  finishVoiceCapture();
                }}
                onPointerCancel={finishVoiceCapture}
                style={{
                  flex: 1,
                  border: 0,
                  borderRadius: 999,
                  padding: '15px 18px',
                  background: isRecording ? AB.rausch : AB.ink,
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: 14,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 10,
                  boxShadow: isRecording ? '0 10px 22px rgba(255,56,92,0.28)' : 'none',
                  transition: 'all 160ms ease',
                }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
                  <path d="M19 11a7 7 0 0 1-14 0" />
                  <path d="M12 18v3" />
                  <path d="M8 21h8" />
                </svg>
                {isRecording ? 'Release to send brief' : 'Hold to talk'}
              </button>
              <button
                onClick={() => setInputMode('text')}
                className="icon-btn"
                style={{ width: 48, height: 48, flexShrink: 0 }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="6" width="18" height="12" rx="2.5" />
                  <path d="M7 10h.01" />
                  <path d="M10 10h.01" />
                  <path d="M13 10h.01" />
                  <path d="M16 10h.01" />
                  <path d="M8 14h8" />
                </svg>
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ flex: 1, height: 48, borderRadius: 18, background: '#F6F6F6', padding: '0 14px', display: 'flex', alignItems: 'center' }}>
                <input
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Type a brief or paste a PropertyGuru link…"
                  style={{ width: '100%', fontSize: 14, lineHeight: 1.2 }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      submitDraft();
                    }
                  }}
                />
              </div>

              <button
                onClick={submitDraft}
                aria-label="Send message"
                style={{
                  border: 0,
                  borderRadius: 18,
                  background: AB.rausch,
                  color: '#fff',
                  width: 48,
                  height: 48,
                  padding: 0,
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 2 11 13" />
                  <path d="M22 2 15 22l-4-9-9-4 20-7Z" />
                </svg>
              </button>

              <button
                onClick={() => setInputMode('voice')}
                className="icon-btn"
                style={{ width: 48, height: 48, flexShrink: 0 }}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
                  <path d="M19 11a7 7 0 0 1-14 0" />
                  <path d="M12 18v3" />
                  <path d="M8 21h8" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>

      {showDiscardSheet && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 40, background: 'rgba(34,34,34,0.18)', display: 'flex', alignItems: 'flex-end' }}>
          <button onClick={() => setShowDiscardSheet(false)} style={{ position: 'absolute', inset: 0, border: 0, background: 'transparent', cursor: 'pointer' }} />
          <div style={{ width: '100%', background: AB.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: '16px 16px 28px', position: 'relative' }}>
            <div style={{ width: 38, height: 4, borderRadius: 999, background: AB.border, margin: '0 auto 14px' }} />
            <div style={{ fontWeight: 600, fontSize: 16 }}>Discard this search?</div>
            <div style={{ fontSize: 13.5, color: AB.gray, lineHeight: 1.6, marginTop: 8 }}>
              You’ll lose the current transcript, imported links and criteria chips.
            </div>
            <div style={{ display: 'grid', gap: 10, marginTop: 18 }}>
              <button
                onClick={() => nav('home')}
                className="btn-block btn-block--dark"
              >
                Discard and go home
              </button>
              <button
                onClick={() => setShowDiscardSheet(false)}
                className="btn-block btn-block--outline"
              >
                Keep editing
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
