import IOSDevice from './IOSDevice';

export default function PhoneFrame({ children, scale = 1 }) {
  return (
    <div className="phone-frame-wrap">
      <div className="phone-frame" style={{ transform: `scale(${scale})` }}>
        <IOSDevice width={390} height={844}>
          <div className="screen-scroll">{children}</div>
        </IOSDevice>
      </div>
    </div>
  );
}
