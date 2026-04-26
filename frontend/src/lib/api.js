const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data?.error?.message || 'Request failed');
    error.code = data?.error?.code;
    error.fields = data?.error?.fields;
    throw error;
  }

  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body || {}) }),
  patch: (path, body) => request(path, { method: 'PATCH', body: JSON.stringify(body || {}) }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body || {}) }),
  delete: (path) => request(path, { method: 'DELETE' }),
};

export const toursApi = {
  async list() {
    return api.get('/api/tours');
  },
  async get(id) {
    return api.get(`/api/tours/${id}`);
  },
  async generateSchedule(id, body = {}) {
    return api.post(`/api/tours/${id}/generate-schedule`, body);
  },
  async getItinerary(id) {
    return api.get(`/api/tours/${id}/itinerary`);
  },
  async shareItinerary(id) {
    return api.post(`/api/tours/${id}/itinerary/share`, {});
  },
  async exportItinerary(id) {
    return api.post(`/api/tours/${id}/itinerary/export`, {});
  },
  async listThreads(id) {
    return api.get(`/api/tours/${id}/threads`);
  },
  async getThreadMessages(id, threadId) {
    return api.get(`/api/tours/${id}/threads/${threadId}/messages`);
  },
  async sendThreadMessage(id, threadId, text) {
    return api.post(`/api/tours/${id}/threads/${threadId}/messages`, { text });
  },
  async updateThreadOwnership(id, threadId, ownership) {
    return api.patch(`/api/tours/${id}/threads/${threadId}/ownership`, { ownership });
  },
  async listExceptions(id) {
    return api.get(`/api/tours/${id}/exceptions`);
  },
  async resolveException(id, exceptionId, action) {
    return api.post(`/api/tours/${id}/exceptions/${exceptionId}/resolve`, { action });
  },
};

export const clientsApi = {
  list: () => api.get('/api/clients'),
  create: (body) => api.post('/api/clients', body),
  update: (id, body) => api.patch(`/api/clients/${id}`, body),
  delete: (id) => api.delete(`/api/clients/${id}`),
};

export const searchApi = {
  parse: (text, source = 'text') => api.post('/api/search/parse', { text, source }),
  importLink: (url) => api.post('/api/search/import-link', { url }),
  results: (tags, linkedListingIds = []) => api.post('/api/search/results', { tags, linkedListingIds }),
};

async function requestWithTimeout(path, options = {}, timeoutMs = 150000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
      ...options,
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data?.error?.message || 'Request failed');
      error.code = data?.error?.code;
      error.fields = data?.error?.fields;
      throw error;
    }
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Request timed out — the scraping took too long. Try again or use a different URL.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const scrapeApi = {
  /** Scrape PropertyGuru search results (with details for AI filtering) */
  listings: (url, { limit = 20, debug = false } = {}) =>
    requestWithTimeout('/api/scrape/propertyguru', {
      method: 'POST',
      body: JSON.stringify({ url, limit, scrapeDetails: true, debug }),
    }, 660000), // 11 min timeout for scraping (backend has 10 min limit)

  /** Scrape agent phone/WhatsApp numbers for specific listing URLs */
  phones: (urls, { debug = false } = {}) =>
    requestWithTimeout('/api/scrape/propertyguru/phones', {
      method: 'POST',
      body: JSON.stringify({ urls, debug }),
    }, 120000), // 2 min timeout for phone scraping
};

export const calendarApi = {
  month: (month) => api.get(`/api/calendar?month=${encodeURIComponent(month)}`),
  day: (date) => api.get(`/api/calendar/day?date=${encodeURIComponent(date)}`),
};

export const inboxApi = {
  list: () => api.get('/api/inbox'),
  markRead: (id) => api.patch(`/api/inbox/${id}/read`, {}),
};

export const settingsApi = {
  profile: () => api.get('/api/me'),
  updateProfile: (body) => api.patch('/api/me', body),
  settings: () => api.get('/api/settings'),
  updateSettings: (body) => api.patch('/api/settings', body),
};
