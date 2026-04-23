import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Avatar from '../components/Avatar';
import { useClients } from '../clientStore';
import { useButler } from '../context/ButlerContext';
import { AB } from '../data';
import { useAppNav } from '../navigation';

function getBuyerAvatar(name = '') {
  const trimmed = name.trim();
  if (!trimmed) {
    return 'B';
  }

  return trimmed
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export default function BuyerView() {
  const nav = useAppNav();
  const navigate = useNavigate();
  const location = useLocation();
  const { clients } = useClients();
  const { activeTour } = useButler();
  const routeShortlistedIds = location.state?.shortlistedIds || [];
  const routeShortlistedListings = location.state?.shortlistedListings || [];
  const routeTags = location.state?.tags || [];
  const shortlist = useMemo(() => routeShortlistedListings, [routeShortlistedListings]);
  const hasExistingClients = clients.length > 0;

  const [step, setStep] = useState('mode');
  const [buyerMode, setBuyerMode] = useState(() => (hasExistingClients ? 'existing' : 'new'));
  const [selectedBuyerId, setSelectedBuyerId] = useState(() => (clients[0]?.id || ''));
  const [buyerName, setBuyerName] = useState('');
  const [buyerPhone, setBuyerPhone] = useState('');
  const [buyerNotes, setBuyerNotes] = useState('');
  const [toast, setToast] = useState('');
  const [showShareSheet, setShowShareSheet] = useState(false);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timer = window.setTimeout(() => setToast(''), 2400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!hasExistingClients && buyerMode === 'existing') {
      setBuyerMode('new');
      setSelectedBuyerId('');
      return;
    }

    if (hasExistingClients && !selectedBuyerId) {
      setSelectedBuyerId(clients[0].id);
    }
  }, [buyerMode, clients, hasExistingClients, selectedBuyerId]);

  const selectedClient = clients.find((client) => client.id === selectedBuyerId) || null;
  const activeBuyer = buyerMode === 'existing'
    ? {
      name: selectedClient?.name || 'Client',
      avatar: selectedClient?.avatar || 'C',
      subtitle: selectedClient?.type || 'Client preview',
      helper: selectedClient?.lastActivity || 'Shortlist ready to share',
    }
    : {
      name: buyerName.trim() || 'New client',
      avatar: getBuyerAvatar(buyerName),
      subtitle: buyerPhone.trim() || 'Client profile',
      helper: buyerNotes.trim() || 'A fresh client profile ready to receive this shortlist.',
    };

  const canAdvance = buyerMode === 'existing' ? Boolean(selectedClient) : Boolean(buyerName.trim());
  const canSend = canAdvance;
  const shareTargetName = buyerMode === 'existing'
    ? selectedClient?.name || 'this client'
    : buyerName.trim() || 'this client';
  const shareButtonLabel = buyerMode === 'existing'
    ? `Send to ${selectedClient?.name || 'client'}`
    : buyerName.trim()
      ? `Send to ${buyerName.trim()}`
      : 'Send client preview';

  function handleBack() {
    if (step === 'details') {
      setShowShareSheet(false);
      setStep('mode');
      return;
    }

    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    nav('search');
  }

  function handleModeNext() {
    if (!canAdvance) {
      return;
    }

    setStep('details');
  }

  function handleShare() {
    if (!canSend) {
      return;
    }

    setShowShareSheet(true);
  }

  function confirmShare() {
    if (!canSend) {
      return;
    }

    setShowShareSheet(false);
    setToast(`Client preview sent to ${shareTargetName}.`);
  }

  return (
    <div className="screen screen--bg">
      <header className="screen-header screen-header--glass">
        <div className="screen-header-row">
          <button onClick={handleBack} className="icon-btn icon-btn--sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={AB.ink} strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 16 }}>Client preview</div>
            <div style={{ fontSize: 12, color: AB.gray, marginTop: 2 }}>
              {step === 'mode' ? 'Choose who should receive this shortlist' : 'Preview and confirm before sending'}
            </div>
          </div>
          <div style={{ padding: '6px 10px', borderRadius: 999, background: shortlist.length ? '#FDECEF' : '#EEEEEE', color: shortlist.length ? AB.rausch : AB.gray, fontSize: 11, fontWeight: 700 }}>
            {shortlist.length} shortlisted
          </div>
        </div>
      </header>

      <div className="screen-body">
        <div style={{ padding: '18px 16px 16px' }}>
        <div style={{ background: AB.white, borderRadius: 22, border: `1px solid ${AB.border}`, padding: 18, boxShadow: '0 12px 30px rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: 11, color: AB.rausch, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase' }}>
            {step === 'mode' ? 'Step 1' : 'Step 2'}
          </div>
          <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 28, fontWeight: 600, letterSpacing: -0.4, lineHeight: 1.05, marginTop: 6 }}>
            {step === 'mode' ? 'Who should receive this shortlist?' : 'Ready to send this preview?'}
          </div>
          <div style={{ fontSize: 13.5, color: AB.gray, lineHeight: 1.6, marginTop: 8 }}>
            {step === 'mode'
              ? 'Pick an existing client or add a new client. The matching details will appear below right away.'
              : 'Review exactly what the client will see, then confirm if you want to send it.'}
          </div>

          {step === 'mode' && (
            <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[
                ['existing', 'Existing client', hasExistingClients],
                ['new', 'Add new client', true],
              ].map(([key, label, enabled]) => {
                const active = buyerMode === key;
                const disabled = !enabled;

                return (
                  <button
                    key={key}
                    onClick={() => {
                      if (!disabled) {
                        setBuyerMode(key);
                      }
                    }}
                    disabled={disabled}
                    style={{
                      border: `1px solid ${disabled ? '#E5E5E5' : active ? AB.rausch : AB.border}`,
                      background: disabled ? '#F3F3F3' : active ? '#FFF1F4' : AB.white,
                      color: disabled ? AB.gray2 : active ? AB.rausch : AB.ink,
                      borderRadius: 16,
                      padding: '14px 12px',
                      textAlign: 'left',
                      cursor: disabled ? 'not-allowed' : 'pointer',
                      opacity: disabled ? 0.9 : 1,
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 13.5 }}>{label}</div>
                    <div style={{ fontSize: 12, color: disabled ? AB.gray2 : active ? AB.rausch : AB.gray, marginTop: 4 }}>
                      {key === 'existing' ? 'Reuse a client already in Butler' : 'Create a one-off client profile'}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {step === 'details' && (
            <div style={{ marginTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              {[
                [activeBuyer.name, 'recipient'],
                [String(shortlist.length), 'homes'],
                [String(routeTags.length || 0), 'filters'],
              ].map(([value, label]) => (
                <div key={label} style={{ background: AB.bg, borderRadius: 12, padding: '12px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: AB.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
                  <div style={{ fontSize: 11, color: AB.gray, marginTop: 4 }}>{label}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {step === 'mode' && buyerMode === 'existing' && (
          <div style={{ marginTop: 16, background: AB.white, borderRadius: 20, border: `1px solid ${AB.border}`, overflow: 'hidden' }}>
            <div style={{ padding: '16px 16px 10px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, color: AB.gray, textTransform: 'uppercase' }}>Choose an existing client</div>
            </div>
            {clients.map((client, index) => {
              const active = selectedBuyerId === client.id;
              return (
                <button
                  key={client.id}
                  onClick={() => setSelectedBuyerId(client.id)}
                  style={{
                    width: '100%',
                    border: 0,
                    borderTop: index === 0 ? 0 : `1px solid ${AB.border}`,
                    background: active ? '#FFF6F7' : AB.white,
                    padding: '14px 16px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <Avatar label={client.avatar} color={client.color} size={42} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14.5 }}>{client.name}</div>
                    <div style={{ fontSize: 12.5, color: AB.gray, marginTop: 2 }}>{client.type}</div>
                    <div style={{ fontSize: 12, color: active ? AB.rausch : AB.gray, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {client.lastActivity}
                    </div>
                  </div>
                  <div style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${active ? AB.rausch : AB.border}`, background: active ? AB.rausch : '#fff', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                    {active && <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff' }} />}
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {step === 'mode' && buyerMode === 'new' && (
          <div style={{ marginTop: 16, background: AB.white, borderRadius: 20, border: `1px solid ${AB.border}`, padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, color: AB.gray, textTransform: 'uppercase', marginBottom: 14 }}>Add client info</div>
            <div style={{ display: 'grid', gap: 12 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>Client name</span>
                <input
                  value={buyerName}
                  onChange={(event) => setBuyerName(event.target.value)}
                  placeholder="e.g. Olivia Tan"
                  style={{ border: `1px solid ${AB.border}`, borderRadius: 14, padding: '13px 14px', fontSize: 14, outline: 'none' }}
                />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>Phone or WhatsApp</span>
                <input
                  value={buyerPhone}
                  onChange={(event) => setBuyerPhone(event.target.value)}
                  placeholder="e.g. +65 9123 4567"
                  style={{ border: `1px solid ${AB.border}`, borderRadius: 14, padding: '13px 14px', fontSize: 14, outline: 'none' }}
                />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>Client notes</span>
                <textarea
                  value={buyerNotes}
                  onChange={(event) => setBuyerNotes(event.target.value)}
                  placeholder="Budget, move-in date, family profile, special constraints…"
                  rows={4}
                  style={{ border: `1px solid ${AB.border}`, borderRadius: 14, padding: '13px 14px', fontSize: 14, outline: 'none', resize: 'none', fontFamily: 'inherit' }}
                />
              </label>
            </div>
          </div>
        )}

        {step === 'details' && (
          <div style={{ marginTop: 16, background: AB.white, borderRadius: 20, border: `1px solid ${AB.border}`, overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', borderBottom: `1px solid ${AB.border}`, background: AB.bg, display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: AB.gray, fontFamily: 'ui-monospace, monospace' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={AB.gray} strokeWidth="2.4"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              butler.ai/client-preview/{buyerMode === 'existing' ? selectedClient?.id || 'draft' : buyerName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'draft'}
            </div>

            <div style={{ padding: '20px 18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar label={activeBuyer.avatar} color={AB.rausch} size={48} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 11, color: AB.rausch, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase' }}>Client preview</div>
                  <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 24, fontWeight: 600, letterSpacing: -0.3, marginTop: 2, lineHeight: 1.1 }}>
                    Hi {activeBuyer.name} 👋
                  </div>
                  <div style={{ fontSize: 12.5, color: AB.gray, marginTop: 4 }}>{activeBuyer.subtitle}</div>
                </div>
              </div>

              <div style={{ fontSize: 14, color: AB.ink, marginTop: 12, lineHeight: 1.55 }}>
                I’ve shortlisted <strong>{shortlist.length} homes</strong> for you to review. Open the link anytime, heart the ones you like, and reply once you’re ready for viewings.
              </div>

              <div style={{ marginTop: 18, fontSize: 11, fontWeight: 700, color: AB.gray, letterSpacing: 0.7, textTransform: 'uppercase' }}>Shortlist preview</div>
              {shortlist.map((listing, index) => (
                <div key={listing.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '12px 0', borderTop: `1px solid ${AB.border}` }}>
                  <div style={{ width: 52, height: 52, borderRadius: 12, flexShrink: 0, background: `linear-gradient(135deg, ${listing.color}25, ${listing.color}55)`, color: listing.color, display: 'grid', placeItems: 'center', fontFamily: '"Playfair Display", Georgia, serif', fontSize: 18, fontWeight: 700 }}>
                    {index + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{listing.name}</div>
                    <div style={{ fontSize: 12, color: AB.gray }}>{listing.unit} · {listing.price}/mo</div>
                    <div style={{ fontSize: 12, color: AB.gray, marginTop: 4 }}>{listing.propertyType} · {listing.bed} · {listing.mrt}</div>
                  </div>
                </div>
              ))}

              <div style={{ marginTop: 14, padding: 12, background: AB.bg, borderRadius: 12, fontSize: 12, color: AB.gray, lineHeight: 1.5 }}>
                {activeBuyer.helper}
              </div>
            </div>
          </div>
        )}
        </div>
      </div>

      {showShareSheet && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 40, background: 'rgba(34,34,34,0.18)', display: 'flex', alignItems: 'flex-end' }}>
          <button onClick={() => setShowShareSheet(false)} style={{ position: 'absolute', inset: 0, border: 0, background: 'transparent', cursor: 'pointer' }} />
          <div style={{ width: '100%', background: AB.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: '16px 16px 28px', position: 'relative' }}>
            <div style={{ width: 38, height: 4, borderRadius: 999, background: AB.border, margin: '0 auto 14px' }} />
            <div style={{ fontWeight: 600, fontSize: 16 }}>Share this preview?</div>
            <div style={{ fontSize: 13.5, color: AB.gray, lineHeight: 1.6, marginTop: 8 }}>
              This shortlist preview will be shared with <strong style={{ color: AB.ink }}>{shareTargetName}</strong>.
            </div>
            <div style={{ display: 'grid', gap: 10, marginTop: 18 }}>
              <button
                onClick={confirmShare}
                style={{ border: 0, borderRadius: 16, background: AB.rausch, color: '#fff', padding: '14px 16px', fontWeight: 600, cursor: 'pointer' }}
              >
                Confirm share
              </button>
              <button
                onClick={() => setShowShareSheet(false)}
                style={{ border: `1px solid ${AB.border}`, borderRadius: 16, background: AB.white, padding: '14px 16px', fontWeight: 600, cursor: 'pointer' }}
              >
                Not now
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="screen-footer screen-footer--fade">
        {toast && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
            <div className="toast">{toast}</div>
          </div>
        )}

        <div style={{ background: AB.white, borderRadius: 24, border: `1px solid ${AB.border}`, padding: 12, boxShadow: '0 18px 32px rgba(0,0,0,0.08)' }}>
          {step === 'mode' ? (
            <button
              onClick={handleModeNext}
              disabled={!canAdvance}
              className="btn-block"
            >
              Next
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={handleShare}
                disabled={!canSend}
                aria-label={shareButtonLabel}
                title={shareButtonLabel}
                style={{
                  width: 58,
                  flexShrink: 0,
                  border: 0,
                  borderRadius: 16,
                  background: canSend ? AB.rausch : '#E6E6E6',
                  color: canSend ? '#fff' : AB.gray,
                  padding: '14px 0',
                  display: 'grid',
                  placeItems: 'center',
                  cursor: canSend ? 'pointer' : 'not-allowed',
                }}
              >
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 16V4" />
                  <path d="M8 8l4-4 4 4" />
                  <path d="M5 13v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
                </svg>
              </button>
              <button
                onClick={() => nav('tour', {
                  state: {
                    shortlistedIds: shortlist.map((listing) => listing.id),
                    shortlistedListings: shortlist,
                    buyer: activeBuyer,
                  },
                })}
                style={{
                  flex: 1,
                  border: `1px solid ${AB.border}`,
                  borderRadius: 16,
                  background: AB.white,
                  color: AB.ink,
                  padding: '14px 16px',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Continue Scheduling
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
