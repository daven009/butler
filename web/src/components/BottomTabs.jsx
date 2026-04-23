import { AB } from '../data';

const tabs = [
  {
    key: 'tours',
    target: 'tours',
    label: 'Tours',
    icon: (color, active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? color : 'none'} stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="6" cy="5.5" r="2" />
        <circle cx="18" cy="18.5" r="2" />
        <path d="M6 7.5c0 4 12 4.5 12 9" fill="none" strokeDasharray="2 3" />
      </svg>
    ),
  },
  {
    key: 'schedule',
    target: 'schedule',
    label: 'Schedule',
    icon: (color, active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? color : 'none'} stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3.5" y="5" width="17" height="15" rx="3" />
        <path d="M7.5 3.5v4" />
        <path d="M16.5 3.5v4" />
        <path d="M3.5 9.5h17" />
      </svg>
    ),
  },
  {
    key: 'create',
    target: 'search',
    label: '',
    ariaLabel: 'New Search',
    primary: true,
    icon: () => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round">
        <path d="M12 5v14" />
        <path d="M5 12h14" />
      </svg>
    ),
  },
  {
    key: 'client',
    target: 'client',
    label: 'Client',
    icon: (color, active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? color : 'none'} stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M5 20a7 7 0 0 1 14 0" />
      </svg>
    ),
  },
  {
    key: 'inbox',
    target: 'inbox',
    label: 'Inbox',
    icon: (color, active) => (
      <svg width="22" height="22" viewBox="0 0 24 24" fill={active ? color : 'none'} stroke={color} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z" />
        <path d="M4.5 9l7.5 5 7.5-5" />
      </svg>
    ),
  },
];

export default function BottomTabs({ active, nav }) {
  return (
    <div className="bottom-tabs">
      {tabs.map((tab) => {
        const isActive = active === tab.key;
        const color = isActive ? AB.rausch : AB.gray;
        const className = `bottom-tab${isActive ? ' is-active' : ''}${tab.primary ? ' bottom-tab--primary' : ''}`;

        return (
          <button
            key={tab.key}
            type="button"
            aria-label={tab.ariaLabel || tab.label}
            className={className}
            onClick={() => nav(tab.target)}
          >
            <span className={`bottom-tab-icon${tab.primary ? ' bottom-tab-icon--primary' : ''}`}>
              {tab.icon(color, isActive)}
            </span>
            {tab.label ? (
              <span className="bottom-tab-label">{tab.label}</span>
            ) : (
              <span className="bottom-tab-label bottom-tab-label--ghost">.</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
