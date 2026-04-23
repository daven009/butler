import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Avatar from '../components/Avatar';
import Chip from '../components/Chip';
import LiveTicker from '../components/LiveTicker';
import { useButler } from '../context/ButlerContext';
import { toursApi } from '../lib/api';
import { AB } from '../data';
import { useAppNav } from '../navigation';

const DATE_OPTIONS = ['This weekend', 'Next weekend', 'Custom dates'];
const TIME_OPTIONS = ['Morning', 'Afternoon', 'Evening'];
const LENGTH_OPTIONS = ['Half day', 'Full day', '2 days'];
function getAvatarFromName(name = '') {
  const trimmed = name.trim();
  if (!trimmed) {
    return 'C';
  }

  return trimmed
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function getPreferencesSummary({ preferredDate, preferredTimes, tripLength, notes }) {
  const segments = [preferredDate, preferredTimes.join('/'), tripLength];
  if (notes.trim()) {
    segments.push(notes.trim());
  }
  return segments.filter(Boolean).join(' · ');
}

function getOptionButtonStyle(active, disabled) {
  return {
    border: `1px solid ${active ? AB.rausch : AB.border}`,
    background: active ? '#FFF1F4' : disabled ? AB.bg : AB.white,
    color: active ? AB.rausch : disabled ? AB.gray : AB.ink,
    borderRadius: 999,
    padding: '10px 14px',
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled && !active ? 0.76 : 1,
  };
}

export default function TourDetail() {
  const nav = useAppNav();
  const location = useLocation();
  const { activeTour, threads, setActiveThreadId, refreshApp, refreshThreads, refreshExceptions } = useButler();
  const routeShortlistedListings = location.state?.shortlistedListings || [];
  const buyer = location.state?.buyer || {};
  const listings = useMemo(() => {
    if (routeShortlistedListings.length) {
      return routeShortlistedListings;
    }

    return (activeTour?.listings || []).map((listing) => {
      const matchingThread = threads.find((thread) => thread.listingId === listing.id);
      return {
        ...listing,
        name: listing.title,
        area: listing.district || 'Unclustered',
        cluster: 0,
        color: '#E07A5F',
        bed: listing.bedrooms ? `${listing.bedrooms}BR` : 'Viewing',
        propertyType: listing.district || 'Listing',
        unit: listing.address,
        agent: listing.opposingAgentName,
        thread: matchingThread || null,
      };
    });
  }, [activeTour, routeShortlistedListings, threads]);
  const totalListings = listings.length;
  const groupedListings = useMemo(() => {
    const groups = new Map();

    listings.forEach((listing) => {
      const enriched = {
        ...listing,
        thread: listing.thread,
      };

      const area = listing.area || 'Unclustered';
      if (!groups.has(area)) {
        groups.set(area, []);
      }
      groups.get(area).push(enriched);
    });

    return Array.from(groups.entries())
      .map(([area, items]) => ({
        area,
        items: items.sort((a, b) => a.cluster - b.cluster || a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.area.localeCompare(b.area));
  }, [listings]);

  const [status, setStatus] = useState('idle');
  const [tick, setTick] = useState(0);
  const [progress, setProgress] = useState(0);
  const [preferredDate, setPreferredDate] = useState('This weekend');
  const [preferredTimes, setPreferredTimes] = useState(['Morning', 'Afternoon']);
  const [tripLength, setTripLength] = useState('2 days');
  const [notes, setNotes] = useState('Prioritize efficient routing and family-friendly transitions.');
  const [showPreferencesSheet, setShowPreferencesSheet] = useState(false);
  const [expandedAreas, setExpandedAreas] = useState(() => groupedListings.map((group) => group.area));

  const preferencesSummary = useMemo(
    () => getPreferencesSummary({ preferredDate, preferredTimes, tripLength, notes }),
    [preferredDate, preferredTimes, tripLength, notes],
  );

  useEffect(() => {
    if (status !== 'running') {
      return undefined;
    }

    setTick(0);
    setProgress(totalListings > 0 ? 1 : 0);

    const tickerTimer = window.setInterval(() => {
      setTick((current) => current + 1);
    }, 1600);

    const progressTimer = window.setInterval(() => {
      setProgress((current) => {
        if (totalListings <= 1) {
          return current;
        }
        return Math.min(totalListings - 1, current + 1);
      });
    }, 650);

    const completeTimer = window.setTimeout(() => {
      setStatus('completed');
      setProgress(totalListings);
    }, 2400);

    return () => {
      window.clearInterval(tickerTimer);
      window.clearInterval(progressTimer);
      window.clearTimeout(completeTimer);
    };
  }, [status, totalListings]);

  useEffect(() => {
    const nextAreas = groupedListings.map((group) => group.area);

    setExpandedAreas((current) => {
      const preserved = current.filter((area) => nextAreas.includes(area));
      const added = nextAreas.filter((area) => !current.includes(area));
      const nextExpanded = [...preserved, ...added];

      const unchanged = current.length === nextExpanded.length && current.every((area, index) => area === nextExpanded[index]);
      return unchanged ? current : nextExpanded;
    });
  }, [groupedListings]);

  const completedCount = status === 'completed' ? totalListings : status === 'running' ? progress : 0;
  const canEditPreferences = status === 'idle';
  const groupedAreaCount = groupedListings.length;
  const statusMeta = {
    idle: {
      label: 'Not started',
      toneBg: '#F1F1F1',
      toneText: AB.gray,
      helper: `Review ${totalListings} listing${totalListings === 1 ? '' : 's'} across ${groupedAreaCount} area${groupedAreaCount === 1 ? '' : 's'} before Butler starts.`,
      progressLabel: 'Waiting to start',
    },
    running: {
      label: 'In progress',
      toneBg: '#FDECEF',
      toneText: AB.rausch,
      helper: 'Butler is coordinating with listing agents and tightening the route live.',
      progressLabel: 'Scheduling now',
    },
    completed: {
      label: 'Completed',
      toneBg: '#E9F5F1',
      toneText: '#006A5B',
      helper: 'Everything is grouped and ready for itinerary review.',
      progressLabel: 'All set',
    },
  }[status];

  function toggleTime(option) {
    if (!canEditPreferences) {
      return;
    }

    setPreferredTimes((current) => {
      if (current.includes(option)) {
        return current.length === 1 ? current : current.filter((item) => item !== option);
      }
      return [...current, option];
    });
  }

  function handleStartScheduling() {
    if (!totalListings || status === 'running') {
      return;
    }

    setStatus('running');
    setShowPreferencesSheet(false);
    if (activeTour?.id) {
      toursApi.generateSchedule(activeTour.id, {}).then(async () => {
        await Promise.all([refreshApp(), refreshThreads(), refreshExceptions()]);
      }).catch(() => {});
    }
  }

  function handleToggleArea(area) {
    if (status !== 'idle') {
      return;
    }

    setExpandedAreas((current) => (current.includes(area) ? current.filter((item) => item !== area) : [...current, area]));
  }

  function isAreaExpanded(area) {
    return status !== 'idle' || expandedAreas.includes(area);
  }

  function renderListingStatus(item) {
    if (status === 'idle') {
      return (
        <div style={{ padding: '6px 10px', borderRadius: 999, background: '#F4F4F4', color: AB.gray, fontSize: 11, fontWeight: 700 }}>
          Not started
        </div>
      );
    }

    if (item.thread?.status === 'exception') {
      return <Chip tone="red">Needs you</Chip>;
    }

    if (status === 'completed') {
      return (
        <div style={{ padding: '6px 10px', borderRadius: 999, background: '#E9F5F1', color: '#006A5B', fontSize: 11, fontWeight: 700 }}>
          {item.thread?.time || 'Confirmed'}
        </div>
      );
    }

    return (
      <div style={{ padding: '6px 10px', borderRadius: 999, background: '#FFF1F4', color: AB.rausch, fontSize: 11, fontWeight: 700 }}>
        Scheduling…
      </div>
    );
  }

  function handleListingClick(item) {
    if (status === 'idle' || !item.thread) {
      return;
    }

    setActiveThreadId(item.thread.id);
    nav(item.thread.status === 'exception' ? 'decision' : 'chat');
  }

  const buyerName = buyer.name || activeTour?.buyerName || 'Client';
  const buyerAvatar = buyer.avatar || getAvatarFromName(buyerName);
  const buyerSubtitle = buyer.subtitle || activeTour?.nextAction || 'Buyer tour in progress';

  return (
    <div className="screen screen--bg">
      <header className="screen-header screen-header--glass">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <Avatar label={buyerAvatar} color={AB.rausch} size={42} />

          <div style={{ flex: 1, minWidth: 0, paddingTop: 1 }}>
            <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 19, fontWeight: 600, letterSpacing: -0.28, lineHeight: 1.05 }}>{buyerName}</div>
            <div style={{ fontSize: 12.5, color: AB.gray, marginTop: 4, lineHeight: 1.35 }}>{buyerSubtitle}</div>
          </div>

          <button onClick={() => nav('home')} className="icon-btn icon-btn--sm" style={{ flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={AB.ink} strokeWidth="2.3" strokeLinecap="round"><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 12 }}>
          <div style={{ fontSize: 12.5, color: AB.gray }}>
            {totalListings} listings · {groupedAreaCount} areas
          </div>
          <div style={{ padding: '7px 11px', borderRadius: 999, background: statusMeta.toneBg, color: statusMeta.toneText, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
            {statusMeta.label}
          </div>
        </div>

        {status !== 'idle' && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${AB.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 12, color: AB.gray }}>
              <div>{statusMeta.progressLabel}</div>
              <div>{completedCount} of {totalListings} ready</div>
            </div>

            <div style={{ display: 'flex', gap: 4, marginTop: 10 }}>
              {Array.from({ length: Math.max(totalListings, 1) }).map((_, index) => {
                const isComplete = index < completedCount;
                const isActive = status === 'running' && index === completedCount;
                return (
                  <div
                    key={index}
                    style={{
                      flex: 1,
                      height: 7,
                      borderRadius: 999,
                      background: isComplete ? (status === 'completed' ? '#00A699' : AB.rausch) : isActive ? '#FFB8C4' : AB.border,
                      transition: 'background .3s ease',
                    }}
                  />
                );
              })}
            </div>

            {status === 'running' && (
              <div style={{ marginTop: 10 }}>
                <LiveTicker tick={tick} />
              </div>
            )}
          </div>
        )}
      </header>

      <div className="screen-body">
        <div style={{ padding: '10px 20px 8px' }}>
          <button
            onClick={() => setShowPreferencesSheet(true)}
            style={{
              width: '100%',
              border: `1px solid ${AB.border}`,
              borderRadius: 18,
              background: AB.white,
              padding: '13px 14px',
              textAlign: 'left',
              boxShadow: '0 10px 24px rgba(0,0,0,0.03)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 12, background: '#FFF1F4', color: AB.rausch, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v3" /><path d="M12 18v3" /><path d="M3 12h3" /><path d="M18 12h3" /><path d="M5.6 5.6l2.1 2.1" /><path d="M16.3 16.3l2.1 2.1" /><path d="M5.6 18.4l2.1-2.1" /><path d="M16.3 7.7l2.1-2.1" /><circle cx="12" cy="12" r="3.25" /></svg>
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="section-label">Scheduling preferences</div>
                <div style={{ fontSize: 13, color: AB.ink, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {preferencesSummary}
                </div>
              </div>

              <div style={{ display: 'grid', justifyItems: 'end', gap: 6, flexShrink: 0 }}>
                <div style={{ padding: '6px 9px', borderRadius: 999, background: canEditPreferences ? '#FFF1F4' : '#F3F3F3', color: canEditPreferences ? AB.rausch : AB.gray, fontSize: 10.5, fontWeight: 700 }}>
                  {canEditPreferences ? 'Editable' : 'Locked'}
                </div>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={AB.gray} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
              </div>
            </div>
          </button>
        </div>

        <div style={{ padding: '8px 20px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
            <div>
              <div className="section-label">Listings grouped by area</div>
              <div style={{ fontSize: 12.5, color: AB.gray, marginTop: 4 }}>
                {status === 'idle' ? 'All shortlisted listings are expanded by default.' : 'All areas stay expanded while Butler works.'}
              </div>
            </div>
            <div style={{ padding: '7px 10px', borderRadius: 999, background: '#F6F6F6', color: AB.gray, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
              {totalListings} total
            </div>
          </div>

          <div style={{ display: 'grid', gap: 12 }}>
            {groupedListings.map((group) => {
              const expanded = isAreaExpanded(group.area);
              const groupBadge = status === 'idle' ? 'Pending' : status === 'running' ? 'Coordinating' : 'Ready';

              return (
                <div key={group.area} style={{ background: AB.white, borderRadius: 20, border: `1px solid ${AB.border}`, overflow: 'hidden' }}>
                  <button
                    onClick={() => handleToggleArea(group.area)}
                    style={{
                      width: '100%',
                      border: 0,
                      background: '#FCFCFC',
                      padding: '15px 16px',
                      textAlign: 'left',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      cursor: status === 'idle' ? 'pointer' : 'default',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 19, fontWeight: 600, letterSpacing: -0.25 }}>{group.area}</div>
                      <div style={{ fontSize: 12.5, color: AB.gray, marginTop: 4 }}>
                        {group.items.length} listing{group.items.length === 1 ? '' : 's'} · {group.items.length === 1 ? 'single stop' : 'walk ≤ 3 min'}
                      </div>
                    </div>

                    <div style={{ display: 'grid', justifyItems: 'end', gap: 8, flexShrink: 0 }}>
                      <div style={{ padding: '7px 10px', borderRadius: 999, background: '#F6F6F6', color: AB.gray, fontSize: 11, fontWeight: 700 }}>
                        {groupBadge}
                      </div>
                      {status === 'idle' && (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={AB.gray} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform .2s ease' }}>
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      )}
                    </div>
                  </button>

                  {expanded && group.items.map((item) => {
                    const clickable = status !== 'idle' && item.thread;
                    return (
                      <button
                        key={item.id}
                        onClick={() => handleListingClick(item)}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          border: 0,
                          borderTop: `1px solid ${AB.border}`,
                          background: AB.white,
                          padding: '14px 16px',
                          display: 'flex',
                          gap: 12,
                          alignItems: 'center',
                          cursor: clickable ? 'pointer' : 'default',
                        }}
                      >
                        <Avatar label={item.agent[0]} color={item.color} size={42} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                            <div style={{ fontWeight: 600, fontSize: 14.5 }}>{item.name}</div>
                            {renderListingStatus(item)}
                          </div>
                          <div style={{ fontSize: 12.5, color: AB.gray, marginTop: 3 }}>
                            {item.agent} · {item.unit} · {item.mrt}
                          </div>
                          <div style={{ fontSize: 12, color: AB.gray, marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {status === 'idle'
                              ? `${item.propertyType} · ${item.bed} · ${item.price}/mo`
                              : `${item.thread?.agent || item.agent} · “${item.thread?.last || 'Waiting for confirmation'}”`}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {showPreferencesSheet && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 40, background: 'rgba(34,34,34,0.18)', display: 'flex', alignItems: 'flex-end' }}>
          <button onClick={() => setShowPreferencesSheet(false)} style={{ position: 'absolute', inset: 0, border: 0, background: 'transparent', cursor: 'pointer' }} />
          <div
            style={{
              width: '100%',
              height: 'min(615px, calc(100% - 12px))',
              background: AB.white,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '16px 16px 0' }}>
              <div style={{ width: 38, height: 4, borderRadius: 999, background: AB.border, margin: '0 auto 14px' }} />
            </div>

            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 16px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 16 }}>Scheduling preferences</div>
                  <div style={{ fontSize: 13.5, color: AB.gray, lineHeight: 1.55, marginTop: 8 }}>
                    {canEditPreferences
                      ? 'These settings update instantly and will be sent to Butler when you start scheduling.'
                      : 'These preferences are locked because Butler has already started coordinating this tour.'}
                  </div>
                </div>
                <div style={{ padding: '7px 10px', borderRadius: 999, background: canEditPreferences ? '#FFF1F4' : '#F3F3F3', color: canEditPreferences ? AB.rausch : AB.gray, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                  {canEditPreferences ? 'Editable' : 'Read only'}
                </div>
              </div>

              <div style={{ display: 'grid', gap: 16, marginTop: 18 }}>
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Preferred dates</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {DATE_OPTIONS.map((option) => {
                      const active = preferredDate === option;
                      return (
                        <button
                          key={option}
                          onClick={() => canEditPreferences && setPreferredDate(option)}
                          style={getOptionButtonStyle(active, !canEditPreferences)}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Preferred time</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {TIME_OPTIONS.map((option) => {
                      const active = preferredTimes.includes(option);
                      return (
                        <button
                          key={option}
                          onClick={() => toggleTime(option)}
                          style={getOptionButtonStyle(active, !canEditPreferences)}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Trip length</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {LENGTH_OPTIONS.map((option) => {
                      const active = tripLength === option;
                      return (
                        <button
                          key={option}
                          onClick={() => canEditPreferences && setTripLength(option)}
                          style={getOptionButtonStyle(active, !canEditPreferences)}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <label style={{ display: 'grid', gap: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>Notes to AI</span>
                  <textarea
                    value={notes}
                    onChange={(event) => canEditPreferences && setNotes(event.target.value)}
                    readOnly={!canEditPreferences}
                    rows={4}
                    placeholder="Add date constraints, family needs, pacing preferences…"
                    style={{
                      border: `1px solid ${AB.border}`,
                      borderRadius: 16,
                      padding: '13px 14px',
                      fontSize: 14,
                      lineHeight: 1.55,
                      background: canEditPreferences ? AB.white : AB.bg,
                      color: canEditPreferences ? AB.ink : AB.gray,
                    }}
                  />
                </label>

                <div style={{ padding: '13px 14px', borderRadius: 16, background: AB.bg, fontSize: 13, color: AB.gray, lineHeight: 1.55 }}>
                  <strong style={{ color: AB.ink }}>Summary</strong>
                  <div style={{ marginTop: 6 }}>{preferencesSummary}</div>
                </div>
              </div>
            </div>

            <div style={{ padding: '14px 16px 20px', borderTop: `1px solid ${AB.border}`, background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>
              <button
                onClick={() => setShowPreferencesSheet(false)}
                className={`btn-block${canEditPreferences ? '' : ' btn-block--dark'}`}
              >
                {canEditPreferences ? 'Done' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="screen-footer screen-footer--fade">
        <div style={{ background: AB.white, borderRadius: 24, border: `1px solid ${AB.border}`, padding: 12, boxShadow: '0 18px 32px rgba(0,0,0,0.08)' }}>
          {status === 'completed' ? (
            <button
              onClick={() => nav('itinerary')}
              className="btn-block btn-block--dark"
              style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}
            >
              Preview final itinerary
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"><path d="M9 18l6-6-6-6" /></svg>
            </button>
          ) : (
            <button
              onClick={handleStartScheduling}
              disabled={!totalListings || status === 'running'}
              className="btn-block"
            >
              {status === 'running' ? 'Scheduling…' : 'Start AI Schedule'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
