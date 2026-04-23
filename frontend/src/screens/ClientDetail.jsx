import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import Avatar from '../components/Avatar';
import { CLIENT_STATUS_OPTIONS, getClientAvatarLabel, useClients } from '../clientStore';
import { useButler } from '../context/ButlerContext';
import { AB } from '../data';
import { useAppNav } from '../navigation';

const fieldStyle = {
  border: `1px solid ${AB.border}`,
  borderRadius: 14,
  padding: '13px 14px',
  fontSize: 14,
  background: AB.white,
  width: '100%',
};

const CLIENT_TYPE_OPTIONS = [
  { value: 'Buy', label: 'Buy' },
  { value: 'Rent', label: 'Rent' },
];

function normalizeClientType(value) {
  if (!value) {
    return 'Buy';
  }
  const lowered = String(value).toLowerCase();
  if (lowered.includes('rent') || lowered.includes('lease')) {
    return 'Rent';
  }
  return 'Buy';
}

function splitBudget(value) {
  if (!value) {
    return { min: '', max: '' };
  }
  const parts = String(value).split(/\s*[–-]\s*/);
  if (parts.length >= 2) {
    return { min: parts[0].trim(), max: parts.slice(1).join(' - ').trim() };
  }
  return { min: parts[0].trim(), max: '' };
}

function joinBudget(min, max) {
  const a = (min || '').trim();
  const b = (max || '').trim();
  if (a && b) {
    return `${a} – ${b}`;
  }
  return a || b || '';
}

// Try to interpret a saved moveIn string as a YYYY-MM-DD for <input type="date">.
function parseDateForInput(value) {
  if (!value) {
    return '';
  }
  const trimmed = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDateForDisplay(isoDate) {
  if (!isoDate) {
    return '';
  }
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function buildFormState(client) {
  const budget = splitBudget(client?.budget);
  return {
    name: client?.name || '',
    phone: client?.phone || '',
    type: normalizeClientType(client?.type),
    status: client?.status || 'planning',
    budgetMin: budget.min,
    budgetMax: budget.max,
    moveIn: parseDateForInput(client?.moveIn),
    needs: client?.needs?.join(', ') || '',
    notes: client?.notes || '',
  };
}

export default function ClientDetail({ isNewEntry = false }) {
  const nav = useAppNav();
  const navigate = useNavigate();
  const location = useLocation();
  const { clientId } = useParams();
  const { clients, createClient, updateClient, deleteClient } = useClients();
  const { tours, setActiveTourId } = useButler();
  const client = useMemo(
    () => (isNewEntry ? null : clients.find((item) => item.id === clientId) || null),
    [clientId, clients, isNewEntry],
  );
  const activeTour = useMemo(
    () => (client?.activeTourId ? tours.find((tour) => tour.id === client.activeTourId) || null : null),
    [client, tours],
  );
  const [form, setForm] = useState(() => buildFormState(client));
  const [toast, setToast] = useState('');

  useEffect(() => {
    setForm(buildFormState(client));
  }, [client]);

  useEffect(() => {
    if (!location.state?.notice) {
      return;
    }

    setToast(location.state.notice);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  useEffect(() => {
    if (!toast) {
      return undefined;
    }

    const timer = window.setTimeout(() => setToast(''), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function updateField(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleBack() {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    nav('client');
  }

  function handleSave() {
    if (!form.name.trim()) {
      setToast('Client name is required.');
      return;
    }

    const payload = {
      name: form.name,
      phone: form.phone,
      type: form.type,
      status: form.status,
      budget: joinBudget(form.budgetMin, form.budgetMax),
      moveIn: form.moveIn || '',
      needs: form.needs,
      notes: form.notes,
      avatar: getClientAvatarLabel(form.name),
      color: client?.color || '#FF385C',
      activeTourId: client?.activeTourId || '',
      scheduledStops: client?.scheduledStops || 0,
      lastActivity: isNewEntry ? 'New client profile created.' : 'Client profile updated.',
    };

    if (isNewEntry) {
      const created = createClient(payload);
      navigate(`/client/${created.id}`, { replace: true, state: { notice: 'Client created.' } });
      return;
    }

    updateClient(client.id, payload);
    setToast('Changes saved.');
  }

  function handleDelete() {
    if (!client) {
      return;
    }

    const confirmed = window.confirm(`Delete ${client.name}? This will remove the client profile from Butler.`);
    if (!confirmed) {
      return;
    }

    deleteClient(client.id);
    navigate('/client', { replace: true, state: { notice: 'Client deleted.' } });
  }

  if (!isNewEntry && !client) {
    return (
      <div className="screen screen--bg">
        <header className="screen-header screen-header--glass">
          <div className="screen-header-row">
            <button type="button" onClick={handleBack} className="icon-btn icon-btn--sm">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={AB.ink} strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
            </button>
            <div style={{ fontWeight: 600, fontSize: 16 }}>Client detail</div>
          </div>
        </header>
        <div className="screen-body">
          <div style={{ padding: '20px 20px' }}>
            <div style={{ background: AB.white, borderRadius: 22, border: `1px solid ${AB.border}`, padding: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 18 }}>Client not found</div>
              <div style={{ fontSize: 13.5, color: AB.gray, lineHeight: 1.6, marginTop: 8 }}>
                That profile may have been deleted. Go back to the client list to open another record.
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const title = isNewEntry ? 'New client' : client.name;
  const subtitle = isNewEntry ? 'Create a fresh profile you can reuse across tours and shortlist sharing.' : `${client.type} · ${client.phone || 'Add a phone number'}`;
  const avatarLabel = getClientAvatarLabel(form.name || client?.name || 'Client');
  const heroColor = client?.color || '#FF385C';

  return (
    <div className="screen screen--bg">
      <header className="screen-header screen-header--glass">
        <div className="screen-header-row">
          <button type="button" onClick={handleBack} className="icon-btn icon-btn--sm">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={AB.ink} strokeWidth="2.5" strokeLinecap="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 16, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</div>
            <div style={{ fontSize: 12, color: AB.gray, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subtitle}</div>
          </div>
          <div style={{ padding: '6px 10px', borderRadius: 999, background: '#FFF1F4', color: AB.rausch, fontSize: 11, fontWeight: 700 }}>
            {isNewEntry ? 'Draft' : 'Detail'}
          </div>
        </div>
      </header>

      <div className="screen-body">
        <div style={{ padding: '18px 16px 16px' }}>
          <div style={{ background: AB.white, borderRadius: 22, border: `1px solid ${AB.border}`, padding: 18, boxShadow: '0 12px 30px rgba(0,0,0,0.04)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <Avatar label={avatarLabel} color={heroColor} size={52} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="eyebrow">{isNewEntry ? 'Create profile' : 'Client detail'}</div>
                <div style={{ fontFamily: '"Playfair Display", Georgia, serif', fontSize: 26, fontWeight: 600, letterSpacing: -0.35, lineHeight: 1.08, marginTop: 4 }}>
                  {form.name.trim() || 'Add a client name'}
                </div>
                <div style={{ fontSize: 13, color: AB.gray, marginTop: 5, lineHeight: 1.55 }}>
                  {form.type || 'Buy'} · {joinBudget(form.budgetMin, form.budgetMax) || 'Budget pending'}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginTop: 16 }}>
              {[
                [formatDateForDisplay(form.moveIn) || 'TBD', 'move-in'],
                [String(client?.scheduledStops || 0), 'stops'],
                [CLIENT_STATUS_OPTIONS.find((option) => option.value === form.status)?.label || 'Planning', 'status'],
              ].map(([value, label]) => (
                <div key={label} style={{ background: AB.bg, borderRadius: 14, padding: '12px 10px', textAlign: 'center' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: AB.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value}</div>
                  <div style={{ fontSize: 11, color: AB.gray, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop: 16, background: AB.white, borderRadius: 20, border: `1px solid ${AB.border}`, padding: 16 }}>
            <div className="section-label" style={{ marginBottom: 14 }}>Profile fields</div>
            <div style={{ display: 'grid', gap: 12 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>Client name</span>
                <input value={form.name} onChange={(event) => updateField('name', event.target.value)} placeholder="e.g. Olivia Tan" style={fieldStyle} />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>Phone / WhatsApp</span>
                  <input value={form.phone} onChange={(event) => updateField('phone', event.target.value)} placeholder="e.g. +65 9123 4567" style={fieldStyle} />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>Status</span>
                  <select value={form.status} onChange={(event) => updateField('status', event.target.value)} style={fieldStyle}>
                    {CLIENT_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>Client type</span>
                  <select value={form.type} onChange={(event) => updateField('type', event.target.value)} style={fieldStyle}>
                    {CLIENT_TYPE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>Budget</span>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <input
                      value={form.budgetMin}
                      onChange={(event) => updateField('budgetMin', event.target.value)}
                      placeholder="Min"
                      style={fieldStyle}
                    />
                    <input
                      value={form.budgetMax}
                      onChange={(event) => updateField('budgetMax', event.target.value)}
                      placeholder="Max"
                      style={fieldStyle}
                    />
                  </div>
                </label>
              </div>

              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>Move-in target</span>
                <input
                  type="date"
                  value={form.moveIn}
                  onChange={(event) => updateField('moveIn', event.target.value)}
                  style={fieldStyle}
                />
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>Needs / constraints</span>
                <textarea
                  value={form.needs}
                  onChange={(event) => updateField('needs', event.target.value)}
                  placeholder="Comma-separated, e.g. Pet-friendly, Near MRT, Family pacing"
                  rows={5}
                  style={fieldStyle}
                />
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>Notes</span>
                <textarea
                  value={form.notes}
                  onChange={(event) => updateField('notes', event.target.value)}
                  placeholder="Family profile, commute needs, viewing constraints…"
                  rows={5}
                  style={fieldStyle}
                />
              </label>
            </div>
          </div>

          

          {activeTour && (
            <div style={{ marginTop: 16, background: AB.white, borderRadius: 20, border: `1px solid ${AB.border}`, padding: 16 }}>
              <div className="section-label" style={{ marginBottom: 10 }}>Linked tour</div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{activeTour.buyer}</div>
              <div style={{ fontSize: 13, color: AB.gray, marginTop: 4 }}>{activeTour.preview}</div>
              <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTourId(activeTour.id);
                    nav('tour', { state: { buyer: { name: activeTour.buyerName, avatar: getClientAvatarLabel(activeTour.buyerName), subtitle: activeTour.nextAction } } });
                  }}
                  style={{ flex: 1, border: 0, borderRadius: 14, background: AB.rausch, color: '#fff', padding: '14px 16px', fontSize: 14, fontWeight: 700 }}
                >
                  Open current tour
                </button>
                <button
                  type="button"
                  onClick={() => nav('buyer')}
                  style={{ flex: 1, border: `1px solid ${AB.border}`, borderRadius: 14, background: AB.white, color: AB.ink, padding: '14px 16px', fontSize: 14, fontWeight: 700 }}
                >
                  Share shortlist
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {toast && (
        <div className="toast-wrap" style={{ bottom: 96 }}>
          <div className="toast">{toast}</div>
        </div>
      )}

      <div className="screen-footer screen-footer--fade">
        <div style={{ background: AB.white, borderRadius: 24, border: `1px solid ${AB.border}`, padding: 12, boxShadow: '0 18px 32px rgba(0,0,0,0.08)' }}>
          <div style={{ display: 'flex', gap: 10 }}>
            {!isNewEntry && (
              <button
                type="button"
                onClick={handleDelete}
                style={{ width: 60, flexShrink: 0, border: `1px solid ${AB.border}`, borderRadius: 16, background: AB.white, color: AB.gray, padding: '14px 0', display: 'grid', placeItems: 'center' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 6h18" />
                  <path d="M8 6V4h8v2" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v6" />
                  <path d="M14 11v6" />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              className="btn-block"
            >
              {isNewEntry ? 'Create client' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
