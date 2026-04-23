import { randomUUID } from 'node:crypto';
import { clone, readJsonFile, writeJsonFile } from '../store';

export interface ClientRecord {
  id: string;
  name: string;
  avatar: string;
  phone: string;
  email: string;
  type: string;
  status: string;
  budget: string;
  moveIn: string;
  needs: string[];
  notes: string;
  lastActivity: string;
  updatedAt: string;
  activeTourId: string;
  scheduledStops: number;
  color: string;
}

interface ClientsState {
  clients: ClientRecord[];
}

const DEFAULT_CLIENTS: ClientsState = {
  clients: [
    {
      id: 'client-1001',
      name: 'Alicia Tan',
      avatar: 'AT',
      phone: '+65 9123 4455',
      email: 'alicia.tan@client.butler.ai',
      type: 'Buy',
      status: 'coordinating',
      budget: 'S$2.3M – S$3.2M',
      moveIn: '2026-05-15',
      needs: ['Near MRT', 'Family pacing', '3BR'],
      notes: 'Buyer prefers central locations and tight routing.',
      lastActivity: 'Reviewing Friday afternoon slots',
      updatedAt: '2026-04-23T13:44:00.000Z',
      activeTourId: 'tour-1001',
      scheduledStops: 1,
      color: '#FF385C'
    },
    {
      id: 'client-1002',
      name: 'Marcus Lee',
      avatar: 'ML',
      phone: '+65 9888 7301',
      email: 'marcus.lee@client.butler.ai',
      type: 'Buy',
      status: 'confirmed',
      budget: 'S$1.9M – S$2.9M',
      moveIn: '2026-06-01',
      needs: ['CBD', 'Walkable', 'Condo'],
      notes: 'Prefers compact and efficient city route.',
      lastActivity: 'Schedule proposed and ready to confirm',
      updatedAt: '2026-04-22T10:10:00.000Z',
      activeTourId: 'tour-1002',
      scheduledStops: 2,
      color: '#00A699'
    }
  ]
};

function readState() {
  return readJsonFile<ClientsState>('clients.json', DEFAULT_CLIENTS);
}

function writeState(state: ClientsState) {
  writeJsonFile('clients.json', state);
}

function nextId() {
  return `client-${randomUUID().slice(0, 8)}`;
}

function normalizeNeeds(needs: unknown): string[] {
  if (Array.isArray(needs)) {
    return needs.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof needs === 'string') {
    return needs.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
  }

  return [];
}

export function listClients() {
  return clone(readState().clients.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
}

export function getClientById(id: string) {
  return clone(readState().clients.find((client) => client.id === id));
}

export function createClient(input: Partial<ClientRecord>) {
  const state = readState();
  const now = new Date().toISOString();
  const client: ClientRecord = {
    id: nextId(),
    name: String(input.name || 'New Client').trim(),
    avatar: String(input.avatar || 'C').trim() || 'C',
    phone: String(input.phone || '').trim(),
    email: String(input.email || '').trim(),
    type: String(input.type || 'Buy').trim(),
    status: String(input.status || 'planning').trim(),
    budget: String(input.budget || '').trim(),
    moveIn: String(input.moveIn || '').trim(),
    needs: normalizeNeeds(input.needs),
    notes: String(input.notes || '').trim(),
    lastActivity: String(input.lastActivity || 'New client profile created.').trim(),
    updatedAt: now,
    activeTourId: String(input.activeTourId || '').trim(),
    scheduledStops: Number(input.scheduledStops || 0),
    color: String(input.color || '#FF385C')
  };

  state.clients.unshift(client);
  writeState(state);
  return clone(client);
}

export function updateClient(id: string, updates: Partial<ClientRecord>) {
  const state = readState();
  const index = state.clients.findIndex((client) => client.id === id);
  if (index === -1) return undefined;

  const current = state.clients[index];
  const next: ClientRecord = {
    ...current,
    ...updates,
    needs: updates.needs !== undefined ? normalizeNeeds(updates.needs) : current.needs,
    updatedAt: new Date().toISOString()
  };

  state.clients[index] = next;
  writeState(state);
  return clone(next);
}

export function deleteClient(id: string) {
  const state = readState();
  const exists = state.clients.some((client) => client.id === id);
  if (!exists) return false;
  state.clients = state.clients.filter((client) => client.id !== id);
  writeState(state);
  return true;
}
