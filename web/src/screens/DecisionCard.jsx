import { useState } from 'react';
import { AB } from '../data';
import { useAppNav } from '../navigation';

const btnPrimary = {
  padding: '14px',
  border: 0,
  borderRadius: 12,
  background: AB.ink,
  color: '#fff',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
  textAlign: 'center',
};

const btnOutline = {
  padding: '12px',
  border: `1px solid ${AB.border}`,
  borderRadius: 12,
  background: '#fff',
  color: AB.ink,
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

export default function DecisionCard() {
  const nav = useAppNav();
  const [resolved, setResolved] = useState(null);

  return (
    <div className="screen screen--bg">
      <header className="screen-header screen-header--glass">
        <div className="screen-header-row">
          <button onClick={() => nav('tour')} className="icon-btn icon-btn--sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={AB.ink} strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <div style={{ fontWeight: 600, fontSize: 16 }}>Needs your decision</div>
        </div>
      </header>

      <div className="screen-body">
        <div style={{ padding: '18px 20px 24px' }}>
          <div style={{ background: AB.white, borderRadius: 18, padding: '20px', border: `1px solid ${AB.border}`, boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 18 }}>⚠️</span>
              <div className="eyebrow">Fell in the cracks</div>
            </div>
            <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 22, fontWeight: 600, letterSpacing: -0.3 }}>Bedok Residences · #09-22</div>
            <div style={{ fontSize: 13, color: AB.gray, marginTop: 4 }}>Sarah Lim · +65 9444 4444</div>

            <div style={{ marginTop: 16, padding: '14px', background: AB.bg, borderRadius: 12, fontSize: 13.5, lineHeight: 1.5 }}>
              Sarah Lim only has <strong>Sun 2:00 PM</strong> available — but that block is already filled with your Tampines viewings. A manual decision is needed.
            </div>

            {!resolved && (
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button onClick={() => setResolved('squeeze')} style={btnPrimary}>
                  Squeeze into Sun 2 PM block
                  <span style={{ fontSize: 12, opacity: 0.7, fontWeight: 400, display: 'block', marginTop: 3 }}>I'll drop the Tampines Court slot</span>
                </button>
                <button onClick={() => setResolved('repropose')} style={btnOutline}>Propose new times to Sarah</button>
                <button onClick={() => setResolved('drop')} style={{ ...btnOutline, color: AB.gray }}>Drop this unit</button>
              </div>
            )}

            {resolved && (
              <div style={{ marginTop: 16, padding: '14px', background: '#E9F5F1', borderRadius: 12, color: '#006A5B', fontSize: 13.5, fontWeight: 500 }}>
                ✓ Got it. {resolved === 'squeeze' && 'AI is rescheduling Tampines Court and confirming Sun 2 PM.'}
                {resolved === 'repropose' && 'AI is reaching out to Sarah with three new times.'}
                {resolved === 'drop' && 'Unit removed from the tour. Chen family will be notified.'}
              </div>
            )}
          </div>

          <div style={{ marginTop: 16, padding: 16, background: AB.white, borderRadius: 16, border: `1px solid ${AB.border}` }}>
            <div className="section-label" style={{ marginBottom: 10 }}>Why AI flagged this</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, color: AB.ink, lineHeight: 1.5 }}>
              <div>→ Tampines cluster anchored at Sat 10 AM</div>
              <div>→ Sun PM already has 2 Tampines viewings</div>
              <div>→ Moving Bedok would add 22 min of driving</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
