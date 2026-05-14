import { useEffect, useRef, useState } from 'react';
import Avatar from '../components/Avatar';
import { AB, CHAT_RACHEL } from '../data';
import { useAppNav } from '../navigation';

export default function Chat() {
  const nav = useAppNav();
  const [takenOver, setTakenOver] = useState(false);
  const [draft, setDraft] = useState('');
  const bodyRef = useRef(null);

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, []);

  return (
    <div className="screen screen--bg">
      <header className="screen-header screen-header--glass">
        <div className="screen-header-row">
          <button onClick={() => nav('tour')} className="icon-btn icon-btn--sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={AB.ink} strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <Avatar label="R" color="#E07A5F" size={36} />
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 14.5 }}>Rachel Ng</div>
            <div style={{ fontSize: 11.5, color: AB.gray }}>Tampines Trilliant · +65 9222 2222</div>
          </div>
          <div style={{ padding: '5px 10px', borderRadius: 999, background: '#E9F5F1', color: '#006A5B', fontSize: 11, fontWeight: 600 }}>{takenOver ? 'YOU' : 'AI'}</div>
        </div>

        {!takenOver && (
          <div style={{ marginTop: 10, padding: '10px 12px', background: '#FFF9F0', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: AB.rausch }} />
            <span style={{ color: AB.ink }}>AI is handling this thread. Everything sends via your number.</span>
          </div>
        )}
      </header>

      <div ref={bodyRef} className="screen-body" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {CHAT_RACHEL.map((message, index) => (
          <div key={index} style={{ display: 'flex', flexDirection: 'column', alignItems: message.from === 'ai' ? 'flex-end' : 'flex-start' }}>
            <div style={{ maxWidth: '82%', padding: '10px 13px', borderRadius: 18, background: message.from === 'ai' ? AB.ink : AB.white, color: message.from === 'ai' ? '#fff' : AB.ink, border: message.from === 'them' ? `1px solid ${AB.border}` : 'none', fontSize: 13.5, lineHeight: 1.45, whiteSpace: 'pre-wrap', borderBottomRightRadius: message.from === 'ai' ? 4 : 18, borderBottomLeftRadius: message.from === 'them' ? 4 : 18 }}>
              {message.from === 'ai' && <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 3, letterSpacing: 0.4 }}>AI · BUTLER</div>}
              {message.text}
            </div>
            <div style={{ fontSize: 10.5, color: AB.gray, marginTop: 4, padding: '0 6px' }}>{message.ts}</div>
          </div>
        ))}

        {takenOver && (
          <div style={{ alignSelf: 'center', padding: '6px 14px', borderRadius: 999, background: '#FFF4DB', color: '#8B5A00', fontSize: 11.5, fontWeight: 500, margin: '10px 0' }}>
            — You've taken over · AI paused —
          </div>
        )}
      </div>

      <div className="screen-footer" style={{ background: AB.white, borderTop: `1px solid ${AB.border}` }}>
        {!takenOver ? (
          <div style={{ padding: '12px 16px 16px' }}>
            <button onClick={() => setTakenOver(true)} style={{ width: '100%', padding: '13px', border: `1.5px solid ${AB.ink}`, borderRadius: 12, background: '#fff', fontSize: 14, fontWeight: 600, color: AB.ink, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={AB.ink} strokeWidth="2.2"><path d="M20 14.66V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5.34" /><path d="m18 2 4 4-10 10H8v-4L18 2z" /></svg>
              Take over conversation
            </button>
            <div style={{ fontSize: 11, color: AB.gray, textAlign: 'center', marginTop: 6 }}>AI stops · you reply directly</div>
          </div>
        ) : (
          <div style={{ padding: '10px 12px 14px', display: 'flex', gap: 8, alignItems: 'center' }}>
            <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Message Rachel…" style={{ flex: 1, padding: '11px 14px', border: `1px solid ${AB.border}`, borderRadius: 999, fontSize: 14, background: AB.bg }} />
            <button style={{ width: 40, height: 40, borderRadius: '50%', border: 0, background: AB.rausch, display: 'grid', placeItems: 'center', padding: 0 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2 11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" /></svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
