import { AB } from '../data';

const EVENTS = [
  { agent: 'Daniel Koh', text: 'confirmed Sun 7:45pm', tone: 'green' },
  { agent: 'Sarah Lim', text: 'proposed Sun 2pm · flagged conflict', tone: 'red' },
  { agent: 'James Wong', text: 'owner approved the profile', tone: 'green' },
  { agent: 'Rachel Ng', text: 'confirmed Sat 10:00am', tone: 'green' },
  { agent: 'Priya Menon', text: 'replied to follow-up', tone: 'amber' },
];

const tones = {
  green: { bg: '#E9F5F1', stroke: '#006A5B' },
  red: { bg: '#FEE7EC', stroke: '#C13584' },
  amber: { bg: '#FFF4DB', stroke: '#8B5A00' },
};

export default function LiveTicker({ tick }) {
  const event = EVENTS[tick % EVENTS.length];
  const tone = tones[event.tone];

  return (
    <div
      key={tick % EVENTS.length}
      style={{
        background: AB.white,
        border: `1px solid ${AB.border}`,
        borderRadius: 14,
        padding: '12px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        animation: 'slidein .4s ease-out',
      }}
    >
      <div style={{ width: 28, height: 28, borderRadius: '50%', background: tone.bg, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        {event.tone === 'green' && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tone.stroke} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
        {event.tone === 'red' && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tone.stroke} strokeWidth="3"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.1" /></svg>}
        {event.tone === 'amber' && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={tone.stroke} strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" /></svg>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5 }}>
          <strong>{event.agent}</strong> {event.text}
        </div>
        <div style={{ fontSize: 11, color: AB.gray, marginTop: 1 }}>just now</div>
      </div>
    </div>
  );
}
