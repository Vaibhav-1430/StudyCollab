import { API_BASE } from './config.js';

const tokenKey = 'token';
const userKey = 'user';

export const getToken = () =>
  localStorage.getItem(tokenKey) || sessionStorage.getItem(tokenKey);

export const setToken = (token, remember = false) => {
  if (remember) {
    localStorage.setItem(tokenKey, token);
    sessionStorage.removeItem(tokenKey);
  } else {
    sessionStorage.setItem(tokenKey, token);
    localStorage.removeItem(tokenKey);
  }
};

export const setUser = (user) => {
  localStorage.setItem(userKey, JSON.stringify(user));
  sessionStorage.setItem(userKey, JSON.stringify(user));
};

export const getUser = () => {
  const raw =
    localStorage.getItem(userKey) || sessionStorage.getItem(userKey) || '{}';
  try {
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
};

export const clearAuth = () => {
  localStorage.removeItem(tokenKey);
  sessionStorage.removeItem(tokenKey);
  localStorage.removeItem(userKey);
  sessionStorage.removeItem(userKey);
};

export const requireAuth = () => {
  if (!getToken()) {
    window.location.href = '/login';
  }
};

export const logout = async () => {
  try {
    const token = getToken();
    if (token) {
      await fetch(`${API_BASE}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
    }
  } catch (err) {
    // Best effort logout
  } finally {
    clearAuth();
    window.location.href = '/login';
  }
};
