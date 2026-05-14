export function IOSListRow({ title, detail, icon, chevron = true, isLast = false, dark = false }) {
  const text = dark ? '#fff' : '#000';
  const secondary = dark ? 'rgba(235,235,245,0.6)' : 'rgba(60,60,67,0.6)';
  const tertiary = dark ? 'rgba(235,235,245,0.3)' : 'rgba(60,60,67,0.3)';
  const separator = dark ? 'rgba(84,84,88,0.65)' : 'rgba(60,60,67,0.12)';

  return (
    <div style={{ display: 'flex', alignItems: 'center', minHeight: 52, padding: '0 16px', position: 'relative', fontFamily: '-apple-system, system-ui', fontSize: 17, letterSpacing: -0.43 }}>
      {icon && <div style={{ width: 30, height: 30, borderRadius: 7, background: icon, marginRight: 12, flexShrink: 0 }} />}
      <div style={{ flex: 1, color: text }}>{title}</div>
      {detail && <span style={{ color: secondary, marginRight: 6 }}>{detail}</span>}
      {chevron && (
        <svg width="8" height="14" viewBox="0 0 8 14" style={{ flexShrink: 0 }}>
          <path d="M1 1l6 6-6 6" stroke={tertiary} strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      {!isLast && <div style={{ position: 'absolute', bottom: 0, right: 0, left: icon ? 58 : 16, height: 0.5, background: separator }} />}
    </div>
  );
}

export default function IOSList({ header, children, dark = false }) {
  const headerColor = dark ? 'rgba(235,235,245,0.6)' : 'rgba(60,60,67,0.6)';
  const background = dark ? '#1C1C1E' : '#fff';

  return (
    <div>
      {header && (
        <div style={{ fontFamily: '-apple-system, system-ui', fontSize: 13, color: headerColor, textTransform: 'uppercase', padding: '8px 36px 6px', letterSpacing: -0.08 }}>
          {header}
        </div>
      )}
      <div style={{ background, borderRadius: 26, margin: '0 16px', overflow: 'hidden' }}>{children}</div>
    </div>
  );
}
