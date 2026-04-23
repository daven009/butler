import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { clientsApi, inboxApi, settingsApi, toursApi } from '../lib/api';
import { adaptClient, adaptThread, adaptTourCard } from '../lib/adapters';

const ButlerContext = createContext(null);

export function ButlerProvider({ children }) {
  const [tours, setTours] = useState([]);
  const [tourCards, setTourCards] = useState([]);
  const [activeTourId, setActiveTourId] = useState('');
  const [clients, setClients] = useState([]);
  const [inboxItems, setInboxItems] = useState([]);
  const [profile, setProfile] = useState(null);
  const [settings, setSettingsState] = useState(null);
  const [threadsByTour, setThreadsByTour] = useState({});
  const [activeThreadId, setActiveThreadId] = useState('');
  const [exceptionsByTour, setExceptionsByTour] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refreshApp = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [toursSummary, clientsResponse, inboxResponse, profileResponse, settingsResponse] = await Promise.all([
        toursApi.list(),
        clientsApi.list(),
        inboxApi.list(),
        settingsApi.profile(),
        settingsApi.settings(),
      ]);

      const fullTours = await Promise.all((toursSummary.tours || []).map((tour) => toursApi.get(tour.id).then((result) => result.tour)));
      setTours(fullTours);
      setTourCards(fullTours.map((tour, index) => adaptTourCard(tour, index)));
      setClients((clientsResponse.clients || []).map(adaptClient));
      setInboxItems(inboxResponse.items || []);
      setProfile(profileResponse.profile);
      setSettingsState(settingsResponse.settings);
      if (!activeTourId && fullTours[0]?.id) {
        setActiveTourId(fullTours[0].id);
      }
    } catch (nextError) {
      setError(nextError.message || 'Failed to load Butler data.');
    } finally {
      setLoading(false);
    }
  }, [activeTourId]);

  useEffect(() => {
    refreshApp();
  }, [refreshApp]);

  const activeTour = useMemo(
    () => tours.find((tour) => tour.id === activeTourId) || tours[0] || null,
    [activeTourId, tours],
  );

  const activeTourCard = useMemo(
    () => tourCards.find((tour) => tour.id === activeTour?.id) || tourCards[0] || null,
    [activeTour, tourCards],
  );

  const loadThreads = useCallback(async (tourId) => {
    if (!tourId) return [];
    const response = await toursApi.listThreads(tourId);
    const threads = (response.threads || []).map(adaptThread);
    setThreadsByTour((current) => ({ ...current, [tourId]: threads }));
    if (!activeThreadId && threads[0]?.id) setActiveThreadId(threads[0].id);
    return threads;
  }, [activeThreadId]);

  const loadExceptions = useCallback(async (tourId) => {
    if (!tourId) return [];
    const response = await toursApi.listExceptions(tourId);
    const exceptions = response.exceptions || [];
    setExceptionsByTour((current) => ({ ...current, [tourId]: exceptions }));
    return exceptions;
  }, []);

  useEffect(() => {
    if (!activeTour?.id) return;
    loadThreads(activeTour.id).catch(() => {});
    loadExceptions(activeTour.id).catch(() => {});
  }, [activeTour, loadExceptions, loadThreads]);

  const value = useMemo(() => ({
    loading,
    error,
    tours,
    tourCards,
    activeTour,
    activeTourCard,
    activeTourId,
    setActiveTourId,
    clients,
    inboxItems,
    profile,
    settings,
    threads: activeTour ? (threadsByTour[activeTour.id] || []) : [],
    activeThreadId,
    setActiveThreadId,
    exceptions: activeTour ? (exceptionsByTour[activeTour.id] || []) : [],
    async refreshApp() {
      await refreshApp();
    },
    async createClient(payload) {
      const response = await clientsApi.create(payload);
      const client = adaptClient(response.client);
      setClients((current) => [client, ...current]);
      return client;
    },
    async updateClient(id, payload) {
      const response = await clientsApi.update(id, payload);
      const client = adaptClient(response.client);
      setClients((current) => current.map((item) => item.id === id ? client : item));
      return client;
    },
    async deleteClient(id) {
      await clientsApi.delete(id);
      setClients((current) => current.filter((item) => item.id !== id));
    },
    async refreshThreads() {
      if (!activeTour?.id) return [];
      return loadThreads(activeTour.id);
    },
    async refreshExceptions() {
      if (!activeTour?.id) return [];
      return loadExceptions(activeTour.id);
    },
    async updateSettings(patch) {
      const response = await settingsApi.updateSettings(patch);
      setSettingsState(response.settings);
      return response.settings;
    },
    async updateProfile(patch) {
      const response = await settingsApi.updateProfile(patch);
      setProfile(response.profile);
      return response.profile;
    },
    async markInboxRead(id) {
      const response = await inboxApi.markRead(id);
      setInboxItems((current) => current.map((item) => item.id === id ? response.item : item));
      return response.item;
    },
  }), [
    activeThreadId,
    activeTour,
    activeTourCard,
    activeTourId,
    clients,
    error,
    exceptionsByTour,
    inboxItems,
    loadExceptions,
    loadThreads,
    loading,
    profile,
    refreshApp,
    settings,
    threadsByTour,
    tourCards,
    tours,
  ]);

  return <ButlerContext.Provider value={value}>{children}</ButlerContext.Provider>;
}

export function useButler() {
  const context = useContext(ButlerContext);
  if (!context) throw new Error('useButler must be used within ButlerProvider');
  return context;
}
