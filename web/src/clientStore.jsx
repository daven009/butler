import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { TOURS } from './data';

const CLIENT_STORAGE_KEY = 'butler.clients.v1';

const CLIENT_PROFILES = {
  T1: {
    phone: '+65 9123 4567',
    budget: 'S$3.2k – S$3.8k',
    moveIn: 'June 2026',
    needs: ['Pet-friendly', 'Near MRT', 'Family pacing', 'Weekend tours'],
    notes: 'Couple with two young children. Prefer tight routing, easy stroller access and calmer transitions between viewings.',
  },
  T2: {
    phone: '+65 9666 9912',
    budget: 'S$2.3M – S$2.8M',
    moveIn: 'Q3 2026',
    needs: ['Condo', 'Home office', 'Near school', 'West side'],
    notes: 'Looking for a buy-side shortlist with strong study layout and reasonable commute to one-north.',
  },
  T3: {
    phone: '+65 9777 1104',
    budget: 'S$2.6k – S$3.0k',
    moveIn: 'ASAP',
    needs: ['HDB rental', 'Single-floor living', 'Quiet block'],
    notes: 'Works shifts, so prefers late afternoon tours and fewer but higher-confidence options.',
  },
  T4: {
    phone: '+65 9888 2201',
    budget: 'S$4.8M – S$6.0M',
    moveIn: 'Flexible',
    needs: ['Landed', 'Parking', 'Entertainment space', 'Privacy'],
    notes: 'Family office buyer. Wants owner readiness first before any physical viewing is confirmed.',
  },
};

const SEED_TIMESTAMPS = [
  '2026-04-23T13:44:00.000Z',
  '2026-04-23T12:46:00.000Z',
  '2026-04-22T13:40:00.000Z',
  '2026-04-21T13:40:00.000Z',
];

export const CLIENT_STATUS_OPTIONS = [
  { value: 'planning', label: 'Planning' },
  { value: 'searching', label: 'Searching' },
  { value: 'coordinating', label: 'Coordinating' },
  { value: 'confirmed', label: 'Confirmed' },
];

const ClientContext = createContext(null);

function slugify(value = '') {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function getClientAvatarLabel(name = '') {
  const trimmed = name.trim();
  if (!trimmed) {
    return 'C';
  }

  const compact = trimmed.replace(/\s+/g, '');
  if (/[\u4e00-\u9fff]/.test(compact)) {
    return compact.slice(0, 1);
  }

  return trimmed
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

function formatRelativeLabel(updatedAt) {
  if (!updatedAt) {
    return 'recently';
  }

  const diffMs = Date.now() - new Date(updatedAt).getTime();
  const diffMinutes = Math.max(1, Math.round(diffMs / 60000));

  if (diffMinutes < 60) {
    return `${diffMinutes} min ago`;
  }

  if (diffMinutes < 1440) {
    return `${Math.round(diffMinutes / 60)}h ago`;
  }

  return `${Math.round(diffMinutes / 1440)}d ago`;
}

function normalizeNeeds(needs = []) {
  if (Array.isArray(needs)) {
    return needs.map((item) => item.trim()).filter(Boolean);
  }

  return String(needs)
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeClient(client, fallback = {}) {
  const name = client.name?.trim() || fallback.name || 'New client';
  const updatedAt = client.updatedAt || fallback.updatedAt || new Date().toISOString();
  const needs = normalizeNeeds(client.needs ?? fallback.needs ?? []);

  return {
    id: client.id || fallback.id || `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    avatar: client.avatar || fallback.avatar || getClientAvatarLabel(name),
    phone: client.phone?.trim() || fallback.phone || '',
    email: client.email?.trim() || fallback.email || '',
    type: client.type?.trim() || fallback.type || 'Buyer profile',
    status: client.status || fallback.status || 'planning',
    budget: client.budget?.trim() || fallback.budget || '',
    moveIn: client.moveIn?.trim() || fallback.moveIn || '',
    needs,
    notes: client.notes?.trim() || fallback.notes || '',
    lastActivity: client.lastActivity?.trim() || fallback.lastActivity || 'Profile ready for follow-up.',
    updatedAt,
    updatedLabel: formatRelativeLabel(updatedAt),
    activeTourId: client.activeTourId ?? fallback.activeTourId ?? '',
    scheduledStops: Number(client.scheduledStops ?? fallback.scheduledStops ?? 0),
    color: client.color || fallback.color || '#FF385C',
  };
}

function sortClients(clients = []) {
  return [...clients].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function buildDefaultClients() {
  return TOURS.map((tour, index) => {
    const profile = CLIENT_PROFILES[tour.id] || {};
    const updatedAt = SEED_TIMESTAMPS[index] || new Date().toISOString();

    return normalizeClient({
      id: tour.id,
      name: tour.buyer,
      avatar: tour.avatar,
      phone: profile.phone,
      email: `${slugify(tour.buyer) || 'client'}@client.butler.ai`,
      type: tour.type,
      status: tour.status,
      budget: profile.budget,
      moveIn: profile.moveIn,
      needs: profile.needs,
      notes: profile.notes,
      lastActivity: tour.preview,
      updatedAt,
      activeTourId: tour.id,
      scheduledStops: tour.total,
      color: tour.color,
    });
  });
}

function readStoredClients() {
  if (typeof window === 'undefined') {
    return buildDefaultClients();
  }

  try {
    const raw = window.localStorage.getItem(CLIENT_STORAGE_KEY);
    if (!raw) {
      return buildDefaultClients();
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) {
      return buildDefaultClients();
    }

    return sortClients(parsed.map((client) => normalizeClient(client)));
  } catch {
    return buildDefaultClients();
  }
}

export function ClientProvider({ children }) {
  const [clients, setClients] = useState(() => readStoredClients());

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(CLIENT_STORAGE_KEY, JSON.stringify(clients));
  }, [clients]);

  const value = useMemo(() => ({
    clients,
    createClient(input) {
      const created = normalizeClient({
        ...input,
        updatedAt: new Date().toISOString(),
        lastActivity: input.lastActivity || 'New client profile created.',
      });

      setClients((current) => sortClients([created, ...current]));
      return created;
    },
    updateClient(id, updates) {
      let updatedClient = null;

      setClients((current) => sortClients(current.map((client) => {
        if (client.id !== id) {
          return client;
        }

        updatedClient = normalizeClient({
          ...client,
          ...updates,
          updatedAt: new Date().toISOString(),
          lastActivity: updates.lastActivity || 'Client profile updated.',
        }, client);
        return updatedClient;
      })));

      return updatedClient;
    },
    deleteClient(id) {
      setClients((current) => current.filter((client) => client.id !== id));
    },
  }), [clients]);

  return <ClientContext.Provider value={value}>{children}</ClientContext.Provider>;
}

export function useClients() {
  const context = useContext(ClientContext);

  if (!context) {
    throw new Error('useClients must be used within a ClientProvider');
  }

  return context;
}
