export default function Avatar({ label, color = '#E4E4E4', size = 40 }) {
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        background: color,
        fontSize: size * 0.38,
      }}
    >
      {label}
    </div>
  );
}
