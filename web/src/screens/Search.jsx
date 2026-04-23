import { useEffect, useMemo, useRef, useState } from 'react';
import Chip from '../components/Chip';
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
  const isSearchUrl = normalized.includes('?') || normalized.includes('property-for-rent');

  if (!isSearchUrl) {
    return {
      kind: 'listing',
      listing: resolveListingFromUrl(url),
      tags: [],
    };
  }

  let extracted = parseCriteriaText(
    normalized
      .replace(/[?&=_]/g, ' ')
      .replace(/%20/g, ' ')
      .replace(/-/g, ' '),
    'url',
  );

  if (!extracted.length) {
    extracted = [
      createTag({
        label: 'Condo',
        groupKey: 'propertyType',
        groupLabel: 'Property type',
        mergeStrategy: 'union',
        kind: 'propertyType',
        value: 'condo',
        source: 'url',
      }),
      createTag({
        label: '3 Rooms',
        groupKey: 'bedroom',
        groupLabel: 'Bedrooms',
        mergeStrategy: 'replace',
        kind: 'bedroom',
        value: 3,
        source: 'url',
      }),
      createTag({
        label: 'Tampines',
        groupKey: 'location',
        groupLabel: 'Location',
        mergeStrategy: 'union',
        kind: 'location',
        value: 'tampines',
        source: 'url',
      }),
      createTag({
        label: formatCurrency(3500),
        groupKey: 'budget',
        groupLabel: 'Budget',
        mergeStrategy: 'replace',
        kind: 'budgetMax',
        value: 3500,
        source: 'url',
      }),
    ];
  }

  return {
    kind: 'search',
    tags: extracted,
  };
}

function mergeIncomingTags(currentTags, incomingTags) {
  let nextTags = [...currentTags];
  const replacements = [];
  let addedCount = 0;

  incomingTags.forEach((tag) => {
    const sameGroup = nextTags.filter((item) => item.groupKey === tag.groupKey);

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
  return (
    <span
      title={`${SOURCE_META[tag.source]?.label || 'Input'} · ${tag.groupLabel}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '8px 10px',
        borderRadius: 999,
        background: tag.source === 'url' ? '#EEF5FF' : '#F4F1EA',
        color: AB.ink,
        fontSize: 12.5,
        fontWeight: 600,
        lineHeight: 1,
        maxWidth: '100%',
      }}
    >
      <span style={{ fontSize: 11 }}>{SOURCE_META[tag.source]?.icon || '•'}</span>
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tag.label}</span>
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
    </span>
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

  const results = useMemo(() => buildSearchResults(tags, linkedListingIds), [tags, linkedListingIds]);
  const { singleTags, unionGroups } = useMemo(() => buildCriteriaLayout(tags), [tags]);
  const lastUserEntry = useMemo(() => {
    return [...transcript].reverse().find((entry) => entry.from === 'user') || null;
  }, [transcript]);

  function removeTag(tagId) {
    setTags((currentTags) => currentTags.filter((tag) => tag.id !== tagId));
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

    if (isProbablyUrl(text)) {
      const parsed = parsePropertyGuruUrl(text);
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
      return;
    }

    const parsedTags = parseCriteriaText(text, source);
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
  }

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
        tags,
        linkedListingIds,
      },
    });
  }

  const previewTags = tags.length > 5 ? tags.slice(0, 4) : tags;
  const hasResults = results.length > 0;
  const shortlistedCount = shortlistedIds.length;

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
              <div style={{ fontWeight: 600, fontSize: 16 }}>{hasResults ? `${results.length} listings matched` : tags.length ? 'No matches yet' : 'Start with a brief'}</div>
              <div style={{ fontSize: 12.5, color: AB.gray, marginTop: 3 }}>
                {hasResults ? 'Results update instantly as criteria change.' : tags.length ? 'Loosen a filter or add an alternate location.' : 'Voice, text and URL imports all flow into the same criteria engine.'}
              </div>
            </div>
            {hasResults && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 12, color: AB.gray }}>ranked by AI fit</div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: shortlistedCount ? AB.rausch : AB.gray, marginTop: 4 }}>
                  {shortlistedCount} shortlisted
                </div>
              </div>
            )}
          </div>

          {hasResults ? (
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
          ) : (
            <div style={{ marginTop: 18, border: `1px solid ${AB.border}`, borderRadius: 24, padding: 18, background: '#FBFBFB' }}>
              <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 26, fontWeight: 600, lineHeight: 1.05, letterSpacing: -0.5 }}>
                Search now starts as a conversation.
              </div>
              <div style={{ fontSize: 14, color: AB.gray, lineHeight: 1.6, marginTop: 10 }}>
                Hold the mic to talk, switch to typing like WeChat, or paste a PropertyGuru URL. Butler turns everything into editable criteria chips above the listings.
              </div>

              <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
                <button
                  onClick={() => handleIncomingInput(DEMO_VOICE_INPUTS[0], 'voice')}
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
                  Try the demo brief
                </button>
                <button
                  onClick={() => {
                    setInputMode('text');
                    setDraft(URL_SAMPLE);
                  }}
                  style={{
                    border: `1px solid ${AB.border}`,
                    borderRadius: 16,
                    background: AB.white,
                    padding: '14px 16px',
                    textAlign: 'left',
                  }}
                >
                  Paste a sample PropertyGuru link
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
