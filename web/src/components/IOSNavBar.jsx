import IOSGlassPill from './IOSGlassPill';

export default function IOSNavBar({ title = 'Title', dark = false, trailingIcon = true }) {
  const muted = dark ? 'rgba(255,255,255,0.6)' : '#404040';
  const text = dark ? '#fff' : '#000';

  const pillIcon = (content) => (
    <IOSGlassPill dark={dark}>
      <div style={{ width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{content}</div>
    </IOSGlassPill>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 62, paddingBottom: 10, position: 'relative', zIndex: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px' }}>
        {pillIcon(
          <svg width="12" height="20" viewBox="0 0 12 20" fill="none" style={{ marginLeft: -1 }}>
            <path d="M10 2L2 10l8 8" stroke={muted} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>,
        )}

        {trailingIcon &&
          pillIcon(
            <svg width="22" height="6" viewBox="0 0 22 6">
              <circle cx="3" cy="3" r="2.5" fill={muted} />
              <circle cx="11" cy="3" r="2.5" fill={muted} />
              <circle cx="19" cy="3" r="2.5" fill={muted} />
            </svg>,
          )}
      </div>

      <div style={{ padding: '0 16px', fontFamily: '-apple-system, system-ui', fontSize: 34, fontWeight: 700, lineHeight: '41px', color: text, letterSpacing: 0.4 }}>
        {title}
      </div>
    </div>
  );
}
