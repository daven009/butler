import { useState } from 'react';
import { AB } from '../data';
import { useAppNav } from '../navigation';

export default function Onboarding() {
  const nav = useAppNav();
  const [step, setStep] = useState(0);

  const steps = [
    {
      eyebrow: 'WELCOME',
      title: 'Let the AI handle the juggling.',
      body: 'butler.ai coordinates every opposing agent on WhatsApp so you can focus on your clients.',
      cta: 'Get started',
    },
    {
      eyebrow: 'CONNECT · STEP 1 / 2',
      title: 'Link your WhatsApp Business.',
      body: "Messages will always send from your own number. The AI introduces itself in the first line — never pretends to be you.",
      cta: 'Connect WhatsApp',
    },
    {
      eyebrow: "YOU'RE SET",
      title: 'Welcome aboard, David.',
      body: 'Start your first tour — paste a PropertyGuru search or describe what your client wants.',
      cta: 'Open dashboard',
    },
  ];

  const current = steps[step];

  return (
    <div
      style={{
        minHeight: '100%',
        background:
          step === 0
            ? 'linear-gradient(180deg, #FFE8EC 0%, #fff 60%)'
            : step === 1
              ? 'linear-gradient(180deg, #E4F5EF 0%, #fff 60%)'
              : 'linear-gradient(180deg, #FFF3DE 0%, #fff 60%)',
        padding: '80px 28px 40px',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ marginBottom: 20, display: 'flex', gap: 6 }}>
        {steps.map((_, index) => (
          <div key={index} style={{ flex: 1, height: 3, borderRadius: 2, background: index <= step ? AB.ink : '#0002' }} />
        ))}
      </div>

      <div style={{ width: '100%', aspectRatio: '1.2 / 1', borderRadius: 24, background: AB.white, boxShadow: '0 4px 24px rgba(0,0,0,0.07)', border: `1px solid ${AB.border}`, padding: 20, display: 'grid', placeItems: 'center', marginBottom: 20 }}>
        {step === 0 && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 64, marginBottom: 6 }}>🗝️</div>
            <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 22, fontWeight: 600, color: AB.rausch, letterSpacing: -0.3 }}>butler.ai</div>
            <div style={{ fontSize: 12, color: AB.gray, marginTop: 4 }}>Singapore property · agent assistant</div>
          </div>
        )}

        {step === 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 60, height: 60, borderRadius: 18, background: AB.ink, color: '#fff', display: 'grid', placeItems: 'center', fontFamily: '"Playfair Display", Georgia, serif', fontSize: 30 }}>b</div>
            <div style={{ width: 28, height: 2, background: '#0003' }} />
            <div style={{ width: 60, height: 60, borderRadius: 18, background: '#25D366', color: '#fff', display: 'grid', placeItems: 'center' }}>
              <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor"><path d="M17.5 14c-.3-.1-1.7-.8-2-.9-.3-.1-.4-.1-.6.1-.2.3-.7.9-.9 1.1-.2.2-.3.2-.6.1-1.2-.6-2.4-1.5-3.4-3-.3-.5 0-.5.3-1 .2-.2.4-.5.5-.8.1-.3 0-.5 0-.6-.1-.2-.6-1.5-.8-2-.2-.5-.4-.5-.6-.5H7.5c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.4 0 1.4 1 2.8 1.2 3 .2.2 2 3 4.8 4.2 1.7.7 2.3.8 3.2.6.5-.1 1.7-.7 2-1.4.2-.6.2-1.2.2-1.3-.2-.2-.3-.3-.6-.4zM12 2C6.5 2 2 6.5 2 12c0 1.9.5 3.7 1.5 5.3L2 22l4.8-1.3c1.5.9 3.4 1.3 5.2 1.3 5.5 0 10-4.5 10-10S17.5 2 12 2z" /></svg>
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 54, marginBottom: 10 }}>✨</div>
            <div style={{ fontSize: 13, color: AB.gray }}>1 tour in progress · 0 decisions waiting</div>
          </div>
        )}
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, color: AB.rausch, letterSpacing: 0.8 }}>{current.eyebrow}</div>
      <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 28, fontWeight: 600, letterSpacing: -0.4, lineHeight: 1.2, marginTop: 6 }}>{current.title}</div>
      <div style={{ fontSize: 14, color: AB.gray, marginTop: 8, lineHeight: 1.5 }}>{current.body}</div>

      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button
          onClick={() => (step === steps.length - 1 ? nav('home') : setStep(step + 1))}
          style={{ width: '100%', padding: '15px', border: 0, borderRadius: 12, background: AB.ink, color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
        >
          {current.cta}
        </button>
        {step > 0 && step < steps.length - 1 && (
          <button onClick={() => nav('home')} style={{ padding: '8px', border: 0, background: 'transparent', color: AB.gray, fontSize: 13, cursor: 'pointer' }}>
            Skip for now
          </button>
        )}
      </div>
    </div>
  );
}
