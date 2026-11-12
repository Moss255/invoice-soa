// Display helpers + a tiny safe HTML templating tag used by the components.

import { currencyDecimals } from './values.js';

const moneyFormats = new Map();
export function money(value, currency) {
  if (value == null || Number.isNaN(Number(value))) return '';
  const key = currency || '';
  if (!moneyFormats.has(key)) {
    let fmt;
    try {
      fmt = new Intl.NumberFormat(undefined, currency
        ? { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }
        : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    } catch {
      fmt = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    moneyFormats.set(key, fmt);
  }
  return moneyFormats.get(key).format(Number(value));
}

const plainFormats = new Map();
/** Number only, no currency symbol, with the currency's decimals (BHD → 3). Always shows 0. */
export function plain(value, currency) {
  if (value == null || Number.isNaN(Number(value))) return '';
  const d = currencyDecimals(currency);
  if (!plainFormats.has(d)) plainFormats.set(d, new Intl.NumberFormat(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
  return plainFormats.get(d).format(Number(value) || 0);
}

/** Like plain() but blank for zero (for ledger debit/credit columns). */
export function amount(value, currency) {
  if (value == null || Number(value) === 0) return '';
  return plain(value, currency);
}

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
export function date(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return dateFmt.format(new Date(Date.UTC(y, m - 1, d)));
}

// --- HTML ---------------------------------------------------------------------

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);

/** Tagged template: interpolations are escaped unless wrapped in raw() / nested html``. Arrays are joined. */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += render(v) + strings[i + 1]; });
  return new Raw(out);
}
function render(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return escape(v);
}

// --- Files --------------------------------------------------------------------

export function download(filename, content, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function toCsv(rows) {
  return rows.map((r) => r.map((c) => {
    const s = String(c ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');
}

export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'account';
