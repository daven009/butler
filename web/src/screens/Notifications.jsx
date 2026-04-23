import BottomTabs from '../components/BottomTabs';
import { AB } from '../data';
import { useAppNav } from '../navigation';

const items = [
  { icon: '⚠️', tone: 'red', title: 'Bedok Residences needs a decision', sub: 'Sarah Lim — scheduling conflict · 2 min ago', target: 'decision' },
  { icon: '✓', tone: 'green', title: 'Daniel Koh confirmed Sun 7:45 PM', sub: 'Commonwealth Towers · 5 min ago' },
  { icon: '💬', tone: 'amber', title: 'Priya Menon asked about parking', sub: 'Queenstown View · auto-handoff · 14 min ago', target: 'chat' },
  { icon: '✓', tone: 'green', title: 'James Wong owner approved profile', sub: 'Bedok Grove · 32 min ago' },
  { icon: '🔍', tone: 'default', title: "Rishi Patel's shortlist is in", sub: '3 listings · ready for your review · 1h ago' },
  { icon: '📝', tone: 'default', title: 'Weekly summary ready', sub: '12 tours handled · 47h saved · yesterday' },
];

const backgrounds = {
  red: '#FEE7EC',
  green: '#E9F5F1',
  amber: '#FFF4DB',
  default: AB.bg,
};

export default function Notifications() {
  const nav = useAppNav();

  return (
    <div className="screen screen--white">
      <header className="screen-header">
        <h1 className="screen-title">Inbox</h1>
        <div className="screen-subtitle" style={{ marginTop: 2 }}>What the AI handled for you overnight</div>
      </header>

      <div className="screen-body">
        <div style={{ padding: '12px 20px 20px' }}>
          {items.map((item, index) => (
            <button
              key={`${item.title}-${index}`}
              onClick={() => item.target && nav(item.target)}
              style={{ display: 'flex', gap: 12, alignItems: 'flex-start', width: '100%', textAlign: 'left', border: 0, background: 'transparent', cursor: item.target ? 'pointer' : 'default', padding: '14px 0', borderTop: `1px solid ${AB.border}` }}
            >
              <div style={{ width: 38, height: 38, borderRadius: 12, background: backgrounds[item.tone], display: 'grid', placeItems: 'center', fontSize: 16, flexShrink: 0 }}>{item.icon}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{item.title}</div>
                <div style={{ fontSize: 12, color: AB.gray, marginTop: 2 }}>{item.sub}</div>
              </div>
              {item.target && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={AB.gray} strokeWidth="2.4" style={{ marginTop: 12 }}><path d="M9 18l6-6-6-6" /></svg>}
            </button>
          ))}
        </div>
      </div>

      <BottomTabs active="inbox" nav={nav} />
    </div>
  );
}
