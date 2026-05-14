import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Avatar from '../components/Avatar';
import BottomTabs from '../components/BottomTabs';
import StatusDot from '../components/StatusDot';
import { useClients } from '../clientStore';
import { AB } from '../data';
import { useAppNav } from '../navigation';

function formatMoveIn(value) {
  if (!value) {
    return '';
  }
  const trimmed = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(`${trimmed}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return trimmed;
  }
  return parsed.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function matchesQuery(client, query) {
  if (!query.trim()) {
    return true;
  }

  const normalizedQuery = query.trim().toLowerCase();
  return [client.name, client.phone, client.email, client.type, client.budget, client.moveIn, client.lastActivity]
    .filter(Boolean)
    .some((value) => value.toLowerCase().includes(normalizedQuery));
}

export default function Client() {
  const nav = useAppNav();
  const navigate = useNavigate();
  const location = useLocation();
  const { clients } = useClients();
  const [query, setQuery] = useState('');
  const [toast, setToast] = useState('');

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

  const filteredClients = useMemo(
    () => clients.filter((client) => matchesQuery(client, query)),
    [clients, query],
  );

  return (
    <div className="screen screen--bg">
      <header className="screen-header">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <h1 className="screen-title">Client book</h1>
            <div className="screen-subtitle">
              Browse everyone you are coordinating with. Tap a card to open their detail page.
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate('/client/new')}
            className="btn-pill"
            style={{ flexShrink: 0 }}
          >
            New client
          </button>
        </div>

        <div className="search-bar" style={{ marginTop: 16 }}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={AB.gray} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, phone, type, budget…"
          />
        </div>
      </header>

      <div className="screen-body">
        <div style={{ padding: '12px 20px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8, paddingLeft: 4 }}>
            <div className="section-label">All clients</div>
            <div style={{ fontSize: 11.5, color: AB.gray }}>{filteredClients.length} shown</div>
          </div>

          <div className="card card--list">
            {!filteredClients.length ? (
              <div style={{ padding: '32px 22px', textAlign: 'center' }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>No clients match that search</div>
                <div style={{ fontSize: 13, color: AB.gray, marginTop: 8, lineHeight: 1.6 }}>
                  Try a broader keyword, or create a new client profile for someone you are about to onboard.
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/client/new')}
                  className="btn-pill"
                  style={{ marginTop: 16 }}
                >
                  Create client
                </button>
              </div>
            ) : (
              filteredClients.map((client) => (
                <button
                  key={client.id}
                  type="button"
                  onClick={() => navigate(`/client/${client.id}`)}
                  className="list-row list-row--button"
                >
                  <Avatar label={client.avatar} color={client.color} size={44} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                      <div style={{ fontWeight: 600, fontSize: 14.5 }}>{client.name}</div>
                      <div style={{ fontSize: 11, color: AB.gray }}>{client.updatedLabel}</div>
                    </div>
                    <div style={{ fontSize: 12.5, color: AB.gray, marginTop: 2 }}>{client.type} · {client.phone || 'No phone yet'}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: AB.gray, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <StatusDot status={client.status} />
                      <span>{client.lastActivity}</span>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {[client.budget, formatMoveIn(client.moveIn)]
                        .filter(Boolean)
                        .slice(0, 3)
                        .map((item) => (
                          <span key={item} style={{ padding: '5px 9px', borderRadius: 999, background: AB.bg, fontSize: 11.5, color: AB.gray }}>
                            {item}
                          </span>
                        ))}
                    </div>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={AB.gray} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {toast && (
        <div className="toast-wrap" style={{ bottom: 96 }}>
          <div className="toast">{toast}</div>
        </div>
      )}

      <BottomTabs active="client" nav={nav} />
    </div>
  );
}
