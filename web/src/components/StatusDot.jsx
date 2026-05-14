import { AB } from '../data';

const colors = {
  coordinating: AB.rausch,
  searching: AB.babu,
  confirmed: AB.babu,
  planning: AB.beach,
};

export default function StatusDot({ status }) {
  const color = colors[status] || '#ccc';

  return (
    <span
      className="status-dot"
      style={{
        background: color,
        boxShadow: `0 0 0 3px ${color}22`,
      }}
    />
  );
}
