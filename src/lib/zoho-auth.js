// Signing in to Zoho Books from the browser (OAuth 2 for "client-based" apps).
//
// 1. signIn() opens Zoho's sign-in page in a popup, with this page as the redirect URI.
// 2. Zoho sends the popup back here with an access token in the URL.
// 3. handleRedirect() (run first thing on load, see zoho-callback.js) spots that,
//    passes the token to the main window over a BroadcastChannel and closes the popup.
// Tokens last an hour and are kept in sessionStorage (this tab only), never in IndexedDB or backups.

import { accountsUrl, safeApiDomain } from './zoho.js';

const CHANNEL = 'invoice-soa-zoho-auth';
const STATE_PREFIX = 'soazoho_';
const SESSION_KEY = 'invoice-soa:zoho-session';

export const SCOPES = [
  'ZohoBooks.invoices.READ',
  'ZohoBooks.creditnotes.READ',
  'ZohoBooks.customerpayments.READ',
  'ZohoBooks.settings.READ', // list organisations
];

/** The address Zoho sends the user back to; register it in the Zoho API console. */
export function redirectUri(loc = location) {
  return loc.origin + loc.pathname;
}

export function authUrl({ region, clientId, state, redirect = redirectUri() }) {
  const u = new URL('/oauth/v2/auth', accountsUrl(region));
  u.search = new URLSearchParams({ response_type: 'token', client_id: clientId, scope: SCOPES.join(','), redirect_uri: redirect, state }).toString();
  return u.toString();
}

/**
 * Zoho's answer in a redirect URL, or null if this isn't one. Zoho documents the token
 * in the fragment (#access_token=…&expires_in=…&api_domain=…&location=…) and doesn't
 * promise to echo `state`, so a missing state is accepted; someone else's state isn't.
 */
export function parseRedirect(loc) {
  for (const part of [loc.hash, loc.search]) {
    const p = new URLSearchParams(String(part ?? '').replace(/^[#?]/, ''));
    const state = p.get('state');
    if ((!state || state.startsWith(STATE_PREFIX)) && (p.has('access_token') || p.has('error'))) {
      return {
        state,
        token: p.get('access_token'),
        expiresIn: Number(p.get('expires_in')) || 3600,
        apiDomain: p.get('api_domain'),
        error: p.get('error'),
      };
    }
  }
  return null;
}

/** In the sign-in popup: hand Zoho's answer to the app window and close. Returns true if handled. */
export function handleRedirect() {
  const r = parseRedirect(location);
  if (!r) return false;
  history.replaceState(null, '', location.pathname);
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage(r);
    ch.close();
  } catch { /* very old browser: the opener will report the window closing */ }
  // Don't start the app in the popup.
  document.querySelector('soa-app')?.remove();
  const p = document.createElement('p');
  p.style.cssText = 'font: 15px system-ui, sans-serif; padding: 24px';
  p.textContent = r.error ? 'Zoho sign-in was cancelled. You can close this window.' : 'Connected to Zoho Books. You can close this window.';
  document.body.append(p);
  setTimeout(() => window.close(), 300);
  return true;
}

function randomState() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return STATE_PREFIX + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Open Zoho's sign-in popup and wait for the token.
 * @returns {Promise<{token:string, apiDomain:string, region:string, expiresAt:number}>}
 */
export function signIn({ region, clientId }) {
  const state = randomState();
  const popup = window.open(authUrl({ region, clientId, state }), 'zoho-signin', 'popup,width=520,height=720');
  if (!popup) return Promise.reject(new Error('The Zoho sign-in window was blocked. Allow pop-ups for this site and try again.'));

  return new Promise((resolve, reject) => {
    const ch = new BroadcastChannel(CHANNEL);
    let settled = false;
    let timer = null;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      ch.close();
      clearInterval(timer);
      fn(value);
    };
    ch.onmessage = (e) => {
      const r = e.data;
      // We only listen while our own sign-in window is open; Zoho may not echo `state`.
      if (!r || (r.state && r.state !== state)) return;
      if (r.error || !r.token) {
        finish(reject, new Error(r.error === 'access_denied' ? 'Access to Zoho Books was declined.' : `Zoho sign-in failed (${r.error || 'no token returned'}).`));
        return;
      }
      const session = { token: r.token, apiDomain: safeApiDomain(r.apiDomain, region), region, expiresAt: Date.now() + (r.expiresIn - 60) * 1000 };
      saveSession(session);
      finish(resolve, session);
    };
    timer = setInterval(() => {
      if (!popup.closed) return;
      clearInterval(timer);
      // Give the channel a moment to deliver a message sent just before closing.
      setTimeout(() => finish(reject, new Error('The Zoho sign-in window was closed before finishing.')), 1500);
    }, 500);
  });
}

// --- Session (this tab only) -------------------------------------------------------

export function loadSession(region) {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null');
    if (s?.token && s.expiresAt > Date.now() && (!region || s.region === region)) return s;
  } catch { /* storage blocked */ }
  return null;
}

function saveSession(s) {
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* storage blocked: lasts until reload */ }
}

export function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}
