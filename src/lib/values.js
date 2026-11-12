// Parsing of individual values found in invoice text: dates, amounts, currencies.
// Pure functions, no DOM — usable from Node tests.

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};
const MONTH_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

const DATE_PATTERNS = [
  // 2026-03-15, 2026/03/15, 2026.03.15
  { re: /\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/, map: (m) => [m[1], m[2], m[3]] },
  // 15 March 2026, 15th of Mar, 2026, 15-Mar-2026, 15 Mar 26
  {
    re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-.]+(?:of\\s+)?${MONTH_RE}\\.?[\\s\\-.,]+(\\d{4}|\\d{2})\\b`, 'i'),
    map: (m) => [m[3], MONTHS[m[2].toLowerCase()], m[1]],
  },
  // March 15, 2026 / Mar 15th 2026
  {
    re: new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'i'),
    map: (m) => [m[3], MONTHS[m[1].toLowerCase()], m[2]],
  },
  // 15/03/2026, 03/15/2026, 15.03.26 — order resolved by `dateOrder`
  { re: /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})\b/, numeric: true },
];

const pad = (n) => String(n).padStart(2, '0');

function makeISO(y, m, d) {
  y = Number(y); m = Number(m); d = Number(d);
  if (y < 100) y += 2000;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1990 && y <= 2100)) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null; // e.g. 31 Feb
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Find the first date in `text`. Returns ISO `YYYY-MM-DD` or null.
 * @param {string} text
 * @param {{dateOrder?: 'DMY'|'MDY'}} [opts]
 */
export function parseDate(text, { dateOrder = 'DMY' } = {}) {
  return findDate(text, { dateOrder })?.iso ?? null;
}

/** Like parseDate but also returns where the match was. */
export function findDate(text, { dateOrder = 'DMY' } = {}) {
  if (!text) return null;
  let best = null;
  for (const p of DATE_PATTERNS) {
    const m = p.re.exec(text);
    if (!m) continue;
    let iso;
    if (p.numeric) {
      let [a, b, y] = [Number(m[1]), Number(m[2]), m[3]];
      // Disambiguate when one side can't be a month.
      let order = dateOrder;
      if (a > 12 && b <= 12) order = 'DMY';
      else if (b > 12 && a <= 12) order = 'MDY';
      iso = order === 'MDY' ? makeISO(y, a, b) : makeISO(y, b, a);
    } else {
      iso = makeISO(...p.map(m));
    }
    if (iso && (!best || m.index < best.index)) best = { iso, index: m.index, length: m[0].length };
  }
  return best;
}

/** Remove every date-looking substring (so its digits aren't mistaken for amounts). */
export function stripDates(text) {
  let out = text;
  for (const p of DATE_PATTERNS) out = out.replace(new RegExp(p.re.source, p.re.flags + 'g'), ' ');
  return out;
}

// Currencies whose minor unit isn't 1/100 (ISO 4217). BHD: 1 dinar = 1000 fils.
const MINOR_UNITS = {
  BHD: 3, KWD: 3, OMR: 3, JOD: 3, TND: 3, LYD: 3, IQD: 3,
  JPY: 0, KRW: 0, ISK: 0, CLP: 0, VND: 0, UGX: 0, XOF: 0, XAF: 0,
};

/** Number of decimal places used by `currency` (2 unless listed above). */
export function currencyDecimals(currency) {
  return MINOR_UNITS[String(currency ?? '').toUpperCase()] ?? 2;
}

/** Round to `d` decimal places without binary floating-point surprises (1.005 → 1.01). */
export function roundTo(n, d = 2) {
  const x = Number(n);
  if (!Number.isFinite(x)) return x;
  let r = Number(`${Math.round(Number(`${x}e${d}`))}e-${d}`);
  if (!Number.isFinite(r)) r = Math.round(x * 10 ** d) / 10 ** d;
  return r || 0; // no -0
}

/** Format for a form field or CSV: fixed decimals for the currency, no grouping. */
export function toFixedFor(n, currency) {
  return Number(n).toFixed(currencyDecimals(currency));
}

// Currency prefixes recognised in front of an amount.
const PREFIX = String.raw`(?:\b[A-Z]{3}\s?|\bBD\s?|د\.?\s?ب\.?\s?|(?:\b[A-Z]{1,2})?[$€£¥₹₩₦₱]\s?)`;
const amountRes = new Map();
function amountRe(decimals) {
  const D = Math.max(2, decimals);
  if (!amountRes.has(D)) {
    amountRes.set(D, new RegExp(
      String.raw`(\()?(-|−)?${PREFIX}?(-|−)?(\d{1,3}(?:[,.'  ]\d{3})+(?:[.,]\d{1,${D}})?|\d+(?:[.,]\d{1,${D}})?)(?![\d%])(\))?(-(?!\d)|\s?CR\b)?`,
      'g'));
  }
  return amountRes.get(D);
}

/**
 * Parse a numeric string that may use `,` or `.` as the decimal separator.
 * With one separator followed by exactly 3 digits ("1,250" / "1.250") it's a
 * thousands separator, except in 3-decimal currencies such as BHD, where
 * "12.500" means twelve and a half dinars.
 * @returns {{value:number|null, decimal:boolean}}
 */
function parseNumber(raw, decimals = 2) {
  let s = raw.replace(/[  '\s]/g, '');
  let decimal = false;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    const dec = lastComma > lastDot ? ',' : '.';
    const thou = dec === ',' ? '.' : ',';
    s = s.split(thou).join('').replace(dec, '.');
    decimal = true;
  } else if (lastComma > -1 || lastDot > -1) {
    const sep = lastComma > -1 ? ',' : '.';
    const parts = s.split(sep);
    const tail = parts[parts.length - 1];
    const threeDecimals = decimals === 3 && sep === '.';
    if (parts.length > 2 || (tail.length === 3 && !threeDecimals)) s = parts.join('');
    else { s = parts.slice(0, -1).join('') + '.' + tail; decimal = true; }
  }
  const n = Number(s);
  return { value: Number.isFinite(n) ? n : null, decimal };
}

/**
 * Parse an amount typed into a form field. Unlike text read off an invoice, a single
 * dot is always a decimal point here ("1.250" typed for USD is 1.25, not 1250).
 * @param {string} text
 * @param {string} [currency]  decides how a lone "1,250" is read for 3-decimal currencies
 */
export function parseInputAmount(text, currency) {
  const s = String(text ?? '').replace(/[^\d.,\-−]/g, '');
  if (!/\d/.test(s)) return null;
  const negative = /^[-−]/.test(s);
  const body = s.replace(/[-−]/g, '');
  const v = /^\d*\.\d+$/.test(body) ? Number(body) : normaliseNumber(body, currencyDecimals(currency));
  if (v == null || !Number.isFinite(v)) return null;
  return negative ? -v : v;
}

/** Normalise a numeric string to a number (see parseNumber). */
export function normaliseNumber(raw, decimals = 2) {
  return parseNumber(raw, decimals).value;
}

/**
 * All money-like amounts in `text`, in order of appearance. Dates and percentages are ignored.
 * @param {string} text
 * @param {{decimals?: number}} [opts]  decimal places of the document's currency
 * @returns {{value:number, raw:string, hasSymbol:boolean, hasDecimals:boolean}[]}
 */
export function findAmounts(text, { decimals = 2 } = {}) {
  if (!text) return [];
  const clean = stripDates(text);
  const out = [];
  for (const m of clean.matchAll(amountRe(decimals))) {
    const num = m[4];
    // Skip things glued to letters, e.g. "INV1234" or "A4".
    const before = clean[m.index - 1];
    if (before && /[A-Za-z0-9#\/]/.test(before) && !m[0].match(/^[$€£¥₹(]/)) continue;
    const parsed = parseNumber(num, decimals);
    let value = parsed.value;
    if (value == null) continue;
    const negative = Boolean(m[2] || m[3] || (m[1] && m[5]) || m[6]);
    if (negative) value = -value;
    out.push({
      value,
      raw: m[0].trim(),
      hasSymbol: /[$€£¥₹₩₦₱]|[A-Z]{3}|\bBD\b|د\.?\s?ب/.test(m[0]),
      hasDecimals: parsed.decimal,
    });
  }
  return out;
}

/** The last amount in `text` (totals put the figure at the end of the line). */
export function parseAmount(text, opts) {
  const all = findAmounts(text, opts);
  if (!all.length) return null;
  // Prefer amounts that look like money (decimals or a currency symbol).
  const moneyish = all.filter((a) => a.hasDecimals || a.hasSymbol);
  return (moneyish.length ? moneyish : all).at(-1).value;
}

export const CURRENCY_CODES = [
  'USD', 'EUR', 'GBP', 'AUD', 'CAD', 'NZD', 'JPY', 'CHF', 'SGD', 'HKD', 'INR', 'ZAR',
  'SEK', 'NOK', 'DKK', 'PLN', 'MXN', 'BRL', 'CNY', 'AED', 'SAR', 'ILS', 'KRW', 'NGN',
  'PHP', 'THB', 'MYR', 'IDR', 'CZK', 'HUF', 'TRY', 'KES', 'BHD', 'KWD', 'OMR', 'QAR', 'JOD',
];
const CODE_RE = new RegExp(`\\b(${CURRENCY_CODES.join('|')})\\b`, 'g');
const PREFIXED_DOLLAR = [
  [/\bA\$|\bAU\$/g, 'AUD'], [/\bC\$|\bCA\$/g, 'CAD'], [/\bNZ\$/g, 'NZD'],
  [/\bS\$|\bSG\$/g, 'SGD'], [/\bHK\$/g, 'HKD'], [/\bUS\$/g, 'USD'], [/\bR\$/g, 'BRL'],
];
// Local names and symbols, weighted like an ISO code.
const NAMED = [
  [/\bBD\b/g, 'BHD'], [/د\.?\s?ب/g, 'BHD'], [/\bbahrain(?:i)?\s+dinars?\b/gi, 'BHD'],
  [/د\.?\s?ك/g, 'KWD'], [/\bkuwaiti\s+dinars?\b/gi, 'KWD'],
  [/ر\.?\s?ع/g, 'OMR'], [/\bomani\s+rials?\b/gi, 'OMR'],
];
const SYMBOLS = [['€', 'EUR'], ['£', 'GBP'], ['₹', 'INR'], ['¥', 'JPY'], ['₩', 'KRW'], ['₦', 'NGN'], ['₱', 'PHP'], ['$', null]];

/**
 * Best guess at the currency of a document.
 * @param {string} text           whole document text
 * @param {string} [focus]        text of the total line, checked first
 * @param {string} [fallback]     currency to assume for a bare `$` or nothing at all
 */
export function detectCurrency(text, focus = '', fallback = 'USD') {
  for (const src of [focus, text]) {
    if (!src) continue;
    const counts = new Map();
    for (const m of src.matchAll(CODE_RE)) counts.set(m[1], (counts.get(m[1]) || 0) + 1);
    for (const [re, code] of NAMED) {
      const n = (src.match(re) || []).length;
      if (n) counts.set(code, (counts.get(code) || 0) + n);
    }
    for (const [re, code] of PREFIXED_DOLLAR) {
      const n = (src.match(re) || []).length;
      if (n) counts.set(code, (counts.get(code) || 0) + n * 2);
    }
    for (const [sym, code] of SYMBOLS) {
      if (!code) continue;
      const n = src.split(sym).length - 1;
      if (n) counts.set(code, (counts.get(code) || 0) + n);
    }
    if (counts.size) return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    if (src.includes('$')) return /^(AUD|CAD|NZD|SGD|HKD|MXN)$/.test(fallback) ? fallback : 'USD';
  }
  return fallback;
}

/** Add `days` to an ISO date. */
export function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Whole days from ISO `a` to ISO `b` (b - a). */
export function daysBetween(a, b) {
  const t = (iso) => Date.UTC(...iso.split('-').map((n, i) => (i === 1 ? n - 1 : +n)));
  return Math.round((t(b) - t(a)) / 86400000);
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
