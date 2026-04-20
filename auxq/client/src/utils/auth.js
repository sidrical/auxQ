const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'http://localhost:3001';

const TOKEN_KEY = 'auxq-jwt';
const USER_KEY = 'auxq-user';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isLoggedIn() {
  return !!getToken();
}

async function authRequest(endpoint, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const config = { headers, ...options };
  if (config.body && typeof config.body === 'object') config.body = JSON.stringify(config.body);

  const res = await fetch(`${SERVER_URL}${endpoint}`, config);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

export async function register(username, password) {
  const data = await authRequest('/auth/register', { method: 'POST', body: { username, password } });
  saveSession(data.token, data.user);
  return data.user;
}

export async function login(username, password) {
  const data = await authRequest('/auth/login', { method: 'POST', body: { username, password } });
  saveSession(data.token, data.user);
  return data.user;
}

export async function fetchMe() {
  const data = await authRequest('/auth/me');
  localStorage.setItem(USER_KEY, JSON.stringify(data.user));
  return data.user;
}

export async function connectSpotify() {
  const data = await authRequest('/auth/connect-spotify');
  window.location.href = data.url;
}

export async function connectAppleMusic(appleMusicToken) {
  await authRequest('/auth/connect-apple', { method: 'POST', body: { appleMusicToken } });
  const user = getUser();
  if (user) {
    user.appleMusicToken = appleMusicToken;
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
}

export async function disconnectSpotify() {
  await authRequest('/auth/disconnect-spotify', { method: 'DELETE' });
  const user = getUser();
  if (user) {
    user.spotify = { accessToken: null, refreshToken: null, expiresAt: null };
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
}

export async function disconnectApple() {
  await authRequest('/auth/disconnect-apple', { method: 'DELETE' });
  const user = getUser();
  if (user) {
    user.appleMusicToken = null;
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }
}
