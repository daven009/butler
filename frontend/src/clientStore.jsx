import { useButler } from './context/ButlerContext';

export const CLIENT_STATUS_OPTIONS = [
  { value: 'planning', label: 'Planning' },
  { value: 'searching', label: 'Searching' },
  { value: 'coordinating', label: 'Coordinating' },
  { value: 'confirmed', label: 'Confirmed' },
];

export function getClientAvatarLabel(name = '') {
  const trimmed = name.trim();
  if (!trimmed) return 'C';
  const compact = trimmed.replace(/\s+/g, '');
  if (/[\u4e00-\u9fff]/.test(compact)) return compact.slice(0, 1);
  return trimmed
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export function ClientProvider({ children }) {
  return children;
}

export function useClients() {
  const butler = useButler();
  return {
    clients: butler.clients,
    createClient: butler.createClient,
    updateClient: butler.updateClient,
    deleteClient: butler.deleteClient,
  };
}
