import { useEffect, useState } from 'react';
import Chip from '../components/Chip';
import { useButler } from '../context/ButlerContext';
import { toursApi } from '../lib/api';
import { AB } from '../data';
import { useAppNav } from '../navigation';

function StopRow({ time, ampm, address, unit, agent, tags = [], transit, first = false }) {
  return (
    <div>
      {transit && (
        <div style={{ padding: '8px 16px 8px 88px', fontSize: 11, color: AB.gray, background: AB.bg, borderTop: `1px solid ${AB.border}`, borderBottom: `1px solid ${AB.border}` }}>
          ↓ {transit}
        </div>
      )}
      <div style={{ display: 'flex', gap: 14, padding: '14px 16px', borderTop: !first && !transit ? `1px solid ${AB.border}` : 'none' }}>
        <div style={{ width: 58, flexShrink: 0 }}>
          <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 22, fontWeight: 600, letterSpacing: -0.3, lineHeight: 1 }}>{time}</div>
          <div style={{ fontSize: 10.5, color: AB.gray, marginTop: 2, fontWeight: 600 }}>{ampm}</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 14.5 }}>{address}</div>
          <div style={{ fontSize: 12, color: AB.gray }}>{unit} · {agent}</div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6 }}>
            {tags.map((tag) => (
              <Chip key={tag} tone={tag.startsWith('✓') ? 'green' : 'default'}>{tag}</Chip>
            ))}
          </div>
        </div>
        <div style={{ fontSize: 11, color: AB.gray, flexShrink: 0, paddingTop: 4 }}>30 min</div>
      </div>
    </div>
  );
}

export default function Itinerary() {
  const nav = useAppNav();
  const { activeTour } = useButler();
  const [sent, setSent] = useState(false);
  const [toast, setToast] = useState('');
  const [itinerary, setItinerary] = useState(null);

  useEffect(() => {
    if (!activeTour?.id) {
      setItinerary(null);
      return;
    }
    toursApi.getItinerary(activeTour.id).then((response) => setItinerary(response.itinerary)).catch(() => setItinerary(null));
  }, [activeTour]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    const timer = window.setTimeout(() => setToast(''), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function handleSend() {
    if (sent || !activeTour?.id) {
      return;
    }
    toursApi.shareItinerary(activeTour.id).then(() => {
      setSent(true);
      setToast(`Sent to ${activeTour.buyerName}.`);
    }).catch(() => {});
  }

  const outlineButton = {
    padding: '12px',
    border: `1px solid ${AB.border}`,
    borderRadius: 12,
    background: '#fff',
    color: AB.ink,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
  };

  return (
    <div className="screen screen--bg">
      <header className="screen-header">
        <div className="screen-header-row">
          <button onClick={() => nav('tour')} className="icon-btn icon-btn--sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={AB.ink} strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <div style={{ fontWeight: 600, fontSize: 16 }}>Itinerary</div>
          <div style={{ marginLeft: 'auto', padding: '4px 10px', background: '#E9F5F1', color: '#006A5B', borderRadius: 999, fontSize: 11, fontWeight: 700, letterSpacing: 0.5 }}>READY</div>
        </div>
      </header>

      <div className="screen-body">
        <div style={{ padding: '18px 20px 0' }}>
          <div style={{ background: AB.white, borderRadius: 18, padding: '18px', border: `1px solid ${AB.border}` }}>
            <div className="section-label">{itinerary?.buyerName || activeTour?.buyerName || 'Client'} · Active itinerary</div>
            <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 24, fontWeight: 600, letterSpacing: -0.3, marginTop: 4 }}>{activeTour?.targetDate || 'Schedule ready'}</div>
            <div style={{ fontSize: 13, color: AB.gray, marginTop: 2 }}>{itinerary?.subtitle || 'Review and share this itinerary.'}</div>

            <div style={{ marginTop: 14, background: AB.bg, borderRadius: 12, padding: 16, position: 'relative', height: 130 }}>
              <svg viewBox="0 0 300 100" width="100%" height="100%" style={{ position: 'absolute', inset: 16, width: 'calc(100% - 32px)' }}>
                <path d="M20 70 C 60 30, 120 40, 170 55 C 220 70, 260 60, 280 45" fill="none" stroke={AB.rausch} strokeWidth="1.8" strokeDasharray="4 3" strokeLinecap="round" />
                <g>
                  <circle cx="20" cy="70" r="8" fill={AB.rausch} />
                  <text x="20" y="73" fontSize="9" fill="#fff" textAnchor="middle" fontWeight="700">1</text>
                  <text x="20" y="90" fontSize="8" fill={AB.gray} textAnchor="middle">Queenstown</text>
                </g>
                <g>
                  <circle cx="170" cy="55" r="8" fill={AB.rausch} />
                  <text x="170" y="58" fontSize="9" fill="#fff" textAnchor="middle" fontWeight="700">3</text>
                  <text x="170" y="40" fontSize="8" fill={AB.gray} textAnchor="middle">Bedok</text>
                </g>
                <g>
                  <circle cx="280" cy="45" r="8" fill={AB.rausch} />
                  <text x="280" y="48" fontSize="9" fill="#fff" textAnchor="middle" fontWeight="700">5</text>
                  <text x="280" y="30" fontSize="8" fill={AB.gray} textAnchor="middle">Tampines</text>
                </g>
              </svg>
            </div>
          </div>
        </div>

        <div style={{ padding: '16px 20px 0' }}>
          <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 19, fontWeight: 600, marginBottom: 8 }}>Planned route</div>
          <div style={{ background: AB.white, borderRadius: 16, overflow: 'hidden', border: `1px solid ${AB.border}` }}>
            {(itinerary?.stops || []).map((stop, index) => (
              <StopRow key={stop.id} time={stop.time} ampm={stop.ampm} address={stop.address} unit={stop.unit} agent={stop.agent} tags={stop.tags} transit={index === 0 ? '' : stop.transit} first={index === 0} />
            ))}
          </div>
        </div>

        <div style={{ padding: '20px 20px 12px' }}>
          <button
            type="button"
            onClick={handleSend}
            disabled={sent}
            aria-disabled={sent}
            className="btn-block"
            style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 8,
              background: sent ? '#E9F5F1' : undefined,
              color: sent ? '#006A5B' : undefined,
              cursor: sent ? 'default' : 'pointer',
              opacity: sent ? 1 : undefined,
            }}
          >
            {sent ? (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12l5 5L20 7" />
                </svg>
                Sent to Chen family
              </>
            ) : (
              <>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="#fff"><path d="M17.5 14c-.3-.1-1.7-.8-2-.9-.3-.1-.4-.1-.6.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.2-.6-2.4-1.5-3.4-3-.3-.5 0-.5.3-1 .2-.2.4-.5.5-.8.1-.3 0-.5 0-.6-.1-.2-.6-1.5-.8-2-.2-.5-.4-.5-.6-.5H7.5c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4 0 1.4 1 2.8 1.2 3 .2.2 2 3 4.8 4.2 1.7.7 2.3.8 3.2.6.5-.1 1.7-.7 2-1.4.2-.6.2-1.2.2-1.3-.2-.2-.3-.3-.6-.4zM12 2C6.5 2 2 6.5 2 12c0 1.9.5 3.7 1.5 5.3L2 22l4.8-1.3c1.5.9 3.4 1.3 5.2 1.3 5.5 0 10-4.5 10-10S17.5 2 12 2z" /></svg>
                Send to Chen family
              </>
            )}
          </button>
          <button type="button" onClick={() => activeTour?.id && toursApi.exportItinerary(activeTour.id)} style={{ ...outlineButton, width: '100%', marginTop: 10 }}>Export as PDF</button>
        </div>
      </div>

      {toast && (
        <div className="toast-wrap" style={{ bottom: 32 }}>
          <div className="toast">{toast}</div>
        </div>
      )}
    </div>
  );
}
