export default function Chip({ children, tone = 'default' }) {
  return <span className={`chip chip--${tone}`}>{children}</span>;
}
