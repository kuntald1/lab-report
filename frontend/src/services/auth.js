import { api } from './api';

const TOKEN_KEY = 'mc_token';
const USER_KEY  = 'mc_user';

export const auth = {
  token:   () => localStorage.getItem(TOKEN_KEY),
  user:    () => { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; } },
  isAuthed:() => !!localStorage.getItem(TOKEN_KEY),

  async login(email, password) {
    const r = await fetch(api.BASE + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!r.ok) {
      let msg = 'Login failed';
      try { const e = await r.json(); if (typeof e.detail === 'string') msg = e.detail; } catch {}
      throw new Error(msg);
    }
    const data = await r.json();
    localStorage.setItem(TOKEN_KEY, data.access_token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    return data.user;
  },

  logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

// fetch wrapper that attaches the bearer token; returns the Response
export function authedFetch(path, opts = {}) {
  const headers = Object.assign({}, opts.headers, {
    Authorization: 'Bearer ' + auth.token(),
  });
  return fetch(api.BASE + path, Object.assign({}, opts, { headers }));
}
