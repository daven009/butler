import Avatar from '../components/Avatar';
import BottomTabs from '../components/BottomTabs';
import StatusDot from '../components/StatusDot';
import { useButler } from '../context/ButlerContext';
import { AB } from '../data';
import { useAppNav } from '../navigation';

export default function Home() {
  const nav = useAppNav();
  const { loading, error, tourCards, activeTourCard, setActiveTourId } = useButler();
  const secondaryTours = activeTourCard ? tourCards.filter((tour) => tour.id !== activeTourCard.id) : tourCards;

  return (
    <div className="screen screen--white">
      <header className="screen-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 13, color: AB.gray, fontWeight: 500 }}>Good morning, David</div>
            <h1 className="screen-title" style={{ marginTop: 2 }}>Your tours</h1>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => nav('notifications')} className="icon-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={AB.ink} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>
              <span style={{ position: 'absolute', top: 6, right: 6, width: 9, height: 9, borderRadius: '50%', background: AB.rausch, border: '2px solid #fff' }} />
            </button>
            <button onClick={() => nav('settings')} className="icon-btn">
              <Avatar label="D" color={AB.ink} size={32} />
            </button>
          </div>
        </div>

        <button onClick={() => nav('search')} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', marginTop: 16, padding: '14px 18px', border: `1px solid ${AB.border}`, borderRadius: 40, background: AB.white, boxShadow: '0 2px 8px rgba(0,0,0,0.06)', textAlign: 'left' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={AB.ink} strokeWidth="2.4"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Start a new tour</div>
            <div style={{ fontSize: 12, color: AB.gray }}>Paste a PropertyGuru link · describe what they want</div>
          </div>
        </button>
      </header>

      <div className="screen-body">
        <div style={{ padding: '18px 24px 8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 16 }}>Active</div>
            <div style={{ fontSize: 13, color: AB.gray }}>{tourCards.length} tours</div>
          </div>

          {error && (
            <div style={{ padding: '16px 18px', borderRadius: 16, border: `1px solid ${AB.border}`, background: '#FFF5F6', color: AB.rausch, fontSize: 13.5 }}>
              {error}
            </div>
          )}

          {!error && activeTourCard && (
            <button
              onClick={() => {
                setActiveTourId(activeTourCard.id);
                nav('tour');
              }}
              style={{ width: '100%', textAlign: 'left', padding: 0, background: AB.white, border: `1px solid ${AB.border}`, borderRadius: 16, overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}
            >
              <div style={{ height: 4, background: AB.border, position: 'relative' }}>
                <div style={{ position: 'absolute', inset: 0, width: `${Math.max(12, Math.round((activeTourCard.progress / activeTourCard.total) * 100))}%`, background: AB.rausch, borderRadius: 2 }} />
              </div>
              <div style={{ padding: '16px 18px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <StatusDot status={activeTourCard.status} />
                  <div style={{ fontSize: 12, color: AB.gray, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 }}>{activeTourCard.status.toUpperCase()} · {activeTourCard.updated}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Avatar label={activeTourCard.avatar} color={activeTourCard.color} size={44} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 17 }}>{activeTourCard.buyer}</div>
                    <div style={{ fontSize: 13, color: AB.gray }}>{activeTourCard.type} · {activeTourCard.total} shortlisted</div>
                  </div>
                </div>
                <div style={{ marginTop: 12, display: 'flex', gap: 6 }}>
                  {Array.from({ length: Math.max(activeTourCard.total, 1) }).map((_, index) => (
                    <div key={index} style={{ flex: 1, height: 6, borderRadius: 3, background: index < activeTourCard.confirmedCount ? '#00A699' : index < activeTourCard.confirmedCount + activeTourCard.needsAttentionCount ? AB.rausch : AB.border }} />
                  ))}
                </div>
                <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 13, color: AB.gray }}>{activeTourCard.confirmedCount} confirmed · {activeTourCard.needsAttentionCount} needs you · {activeTourCard.pendingCount} pending</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: AB.rausch }}>Open →</div>
                </div>
              </div>
            </button>
          )}

          {!loading && !error && !activeTourCard && (
            <div style={{ padding: '16px 18px', borderRadius: 16, border: `1px solid ${AB.border}`, background: AB.white, color: AB.gray, fontSize: 13.5 }}>
              No active tours yet.
            </div>
          )}
        </div>

        <div style={{ padding: '12px 24px 24px' }}>
          {secondaryTours.map((tour) => (
            <button
              key={tour.id}
              type="button"
              onClick={() => {
                setActiveTourId(tour.id);
                nav('tour');
              }}
              style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '14px 0', borderTop: `1px solid ${AB.border}`, width: '100%', background: 'transparent', borderLeft: 0, borderRight: 0, borderBottom: 0, textAlign: 'left' }}
            >
              <Avatar label={tour.avatar} color={tour.color} size={44} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <div style={{ fontWeight: 600, fontSize: 15 }}>{tour.buyer}</div>
                  <div style={{ fontSize: 11, color: AB.gray }}>{tour.updated}</div>
                </div>
                <div style={{ fontSize: 13, color: AB.gray, marginTop: 2 }}>{tour.type}</div>
                <div style={{ fontSize: 12.5, color: AB.ink, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  <StatusDot status={tour.status} /> <span style={{ marginLeft: 6 }}>{tour.preview}</span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      <BottomTabs active="tours" nav={nav} />
    </div>
  );
}
