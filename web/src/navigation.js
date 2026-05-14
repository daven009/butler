import { useNavigate } from 'react-router-dom';

export const ROUTES = {
  onboarding: '/',
  '': '/',
  home: '/home',
  tours: '/home',
  schedule: '/schedule',
  search: '/search',
  tour: '/tour',
  chat: '/chat',
  decision: '/decision',
  itinerary: '/itinerary',
  buyer: '/buyer',
  client: '/client',
  notifications: '/notifications',
  inbox: '/notifications',
  settings: '/settings',
};

export function toPath(key = '') {
  return ROUTES[key] || ROUTES.home;
}

export function useAppNav() {
  const navigate = useNavigate();
  return (key = '', options) => navigate(toPath(key), options);
}
