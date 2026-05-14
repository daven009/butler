import { AB } from '../data';

export default function ToggleRow({ title, subtitle, on, onChange, locked = false, last = false }) {
  return (
    <div style={{ padding: '14px 16px', display: 'flex', gap: 10, alignItems: 'center', borderBottom: !last ? `1px solid ${AB.border}` : 'none' }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 500, fontSize: 14 }}>{title}</div>
        <div style={{ fontSize: 12, color: AB.gray, marginTop: 1 }}>{subtitle}</div>
      </div>
      <button
        onClick={() => !locked && onChange(!on)}
        disabled={locked}
        style={{
          width: 40,
          height: 24,
          borderRadius: 999,
          border: 0,
          cursor: locked ? 'not-allowed' : 'pointer',
          background: on ? AB.ink : '#ccc',
          position: 'relative',
          opacity: locked ? 0.5 : 1,
          padding: 0,
        }}
      >
        <span style={{ position: 'absolute', top: 2, left: on ? 18 : 2, width: 20, height: 20, borderRadius: '50%', background: '#fff', transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
      </button>
    </div>
  );
}
