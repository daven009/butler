import { useState } from 'react';
import Avatar from '../components/Avatar';
import BottomTabs from '../components/BottomTabs';
import ToggleRow from '../components/ToggleRow';
import { AB } from '../data';
import { useAppNav } from '../navigation';

export default function Settings() {
  const nav = useAppNav();
  const [tone, setTone] = useState('friendly');
  const [cadence, setCadence] = useState(24);
  const [autoProfile, setAutoProfile] = useState(true);
  const [voice, setVoice] = useState(true);

  const preview =
    tone === 'formal'
      ? "Good morning. I'm an AI assistant coordinating on behalf of David Tan (PropNex). Is the unit at Tampines Trilliant still available for rent?"
      : tone === 'friendly'
        ? "Hi! I'm an AI assistant helping David Tan with scheduling. Is your unit at Tampines Trilliant still available for rent?"
        : "Hello — David Tan's AI assistant here helping arrange viewings. Your Tampines Trilliant unit still open for rent?";

  return (
    <div className="screen screen--bg">
      <header className="screen-header">
        <h1 className="screen-title">Profile</h1>
      </header>

      <div className="screen-body">
        <div style={{ padding: '16px 20px 0' }}>
          <div style={{ background: AB.white, borderRadius: 16, padding: 16, border: `1px solid ${AB.border}`, display: 'flex', gap: 12, alignItems: 'center' }}>
            <Avatar label="D" color={AB.ink} size={48} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 15 }}>David Tan</div>
              <div style={{ fontSize: 12, color: AB.gray }}>PropNex · Tampines Branch · R058123G</div>
            </div>
            <div style={{ padding: '5px 10px', borderRadius: 999, background: '#E9F5F1', color: '#006A5B', fontSize: 11, fontWeight: 700 }}>✓ WA</div>
          </div>
        </div>

        <div style={{ padding: '16px 20px 0' }}>
          <div className="section-label" style={{ marginBottom: 8, paddingLeft: 4 }}>AI voice</div>
          <div style={{ background: AB.white, borderRadius: 16, padding: 16, border: `1px solid ${AB.border}` }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {['formal', 'friendly', 'casual'].map((option) => (
                <button
                  key={option}
                  onClick={() => setTone(option)}
                  style={{
                    flex: 1,
                    padding: '10px 0',
                    border: `1.5px solid ${tone === option ? AB.ink : AB.border}`,
                    borderRadius: 10,
                    background: tone === option ? AB.ink : '#fff',
                    color: tone === option ? '#fff' : AB.ink,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    textTransform: 'capitalize',
                  }}
                >
                  {option}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 14, background: AB.bg, padding: '12px 14px', borderRadius: 12, fontSize: 13, lineHeight: 1.45 }}>
              <div className="eyebrow" style={{ fontSize: 10, marginBottom: 4 }}>PREVIEW</div>
              {preview}
            </div>
          </div>
        </div>

        <div style={{ padding: '16px 20px 0' }}>
          <div className="section-label" style={{ marginBottom: 8, paddingLeft: 4 }}>Pacing</div>
          <div style={{ background: AB.white, borderRadius: 16, padding: 16, border: `1px solid ${AB.border}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span>Follow-up cadence</span>
              <strong>{cadence}h</strong>
            </div>
            <input type="range" min={4} max={48} value={cadence} onChange={(event) => setCadence(Number(event.target.value))} style={{ width: '100%', marginTop: 10, accentColor: AB.rausch }} />
          </div>
        </div>

        <div style={{ padding: '16px 20px 24px' }}>
          <div className="section-label" style={{ marginBottom: 8, paddingLeft: 4 }}>Automations</div>
          <div style={{ background: AB.white, borderRadius: 16, border: `1px solid ${AB.border}`, overflow: 'hidden' }}>
            <ToggleRow title="Auto-send tenant profile" subtitle="After availability check" on={autoProfile} onChange={setAutoProfile} />
            <ToggleRow title="Transcribe voice notes" subtitle="Whisper · confirm understanding" on={voice} onChange={setVoice} />
            <ToggleRow title="Auto-handoff on pricing" subtitle="Escalate to you for offer questions" on={true} onChange={() => {}} />
            <ToggleRow title="Disclose AI identity" subtitle="Required by Meta · always on" on={true} onChange={() => {}} locked last />
          </div>
        </div>
      </div>

      <BottomTabs nav={nav} />
    </div>
  );
}
