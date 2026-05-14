import { API_BASE } from './config.js';
import { clearAuth, getToken } from './auth.js';

export const apiFetch = async (path, options = {}) => {
  const { timeoutMs = 15000, signal: userSignal, ...fetchRest } = options;
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(fetchRest.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  let timeoutId;
  if (!userSignal && timeoutMs > 0) {
    timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...fetchRest,
      headers,
      signal: userSignal || controller.signal
    });
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);
    if (err?.name === 'AbortError') {
      throw new Error('Request timed out — is the server running on this port?');
    }
    throw err;
  }
  if (timeoutId) clearTimeout(timeoutId);

  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && typeof window !== 'undefined') {
    const authPage = /\/(login|register)(\/|$)/.test(window.location.pathname);
    if (!authPage) {
      clearAuth();
      window.location.href = '/login';
    }
  }
  if (!response.ok) {
    throw new Error(data.message || 'Request failed');
  }
  return data;
};

export const uploadFile = async (path, file) => {
  const token = getToken();
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || 'Upload failed');
  }
  return data;
};
