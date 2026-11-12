// Zoho Books: regions, a small API client, and turning Zoho documents into
// transaction records. Everything runs in the browser: the Zoho Books API allows
// cross-origin GET requests, so no backend is involved. Sign-in is in zoho-auth.js.
//
// Imported records carry `external: { system: 'zoho', type, id, orgId, region, modified }`
// (and no `source`, which means "read from an uploaded file"). Importing again
// updates records that changed in Zoho, skips the rest, and removes records that were
// voided or deleted in Zoho.

import { currencyDecimals, roundTo } from './values.js';
import { distribute } from './statement.js';
import { TAX_CATEGORY } from './line-items.js';
import { normDesc, categorizeLines, categoryContext } from './categories.js';

/** Zoho data centres. The account's region is the domain used to sign in to Zoho Books. */
export const REGIONS = {
  com: { label: 'United States (zoho.com)', domain: 'zoho.com', api: 'zohoapis.com' },
  eu: { label: 'Europe (zoho.eu)', domain: 'zoho.eu', api: 'zohoapis.eu' },
  uk: { label: 'United Kingdom (zoho.uk)', domain: 'zoho.uk', api: 'zohoapis.uk' },
  ae: { label: 'United Arab Emirates (zoho.ae)', domain: 'zoho.ae', api: 'zohoapis.ae' },
  sa: { label: 'Saudi Arabia (zoho.sa)', domain: 'zoho.sa', api: 'zohoapis.sa' },
  in: { label: 'India (zoho.in)', domain: 'zoho.in', api: 'zohoapis.in' },
  'com.au': { label: 'Australia (zoho.com.au)', domain: 'zoho.com.au', api: 'zohoapis.com.au' },
  jp: { label: 'Japan (zoho.jp)', domain: 'zoho.jp', api: 'zohoapis.jp' },
  ca: { label: 'Canada (zohocloud.ca)', domain: 'zohocloud.ca', api: 'zohoapis.ca' },
};

const region = (r) => {
  if (!REGIONS[r]) throw new Error('Choose your Zoho region first.');
  return REGIONS[r];
};
export const accountsUrl = (r) => `https://accounts.${region(r).domain}`;
export const apiUrl = (r) => `https://www.${region(r).api}`;
export const booksUrl = (r) => `https://books.${region(r).domain}`;
export const consoleUrl = (r) => `https://api-console.${region(r).domain}`;

/** Only send the token to a Zoho API host. */
export function safeApiDomain(apiDomain, r) {
  return /^https:\/\/www\.zohoapis\.[a-z]{2,3}(?:\.[a-z]{2})?$/.test(apiDomain ?? '') ? apiDomain : apiUrl(r);
}

/**
 * What we import, and how each Zoho list/detail endpoint is shaped (checked against
 * Zoho's published OpenAPI specs for Books v3).
 *  - detail: true = list items are summaries, always fetch the document;
 *            'if-needed' = fetch only when the list item lacks the customer or currency.
 *  - dateParam: list filter for "dated on or after" (only invoices document one; the
 *    others are filtered here after listing).
 */
export const TYPES = {
  invoices: {
    label: 'Invoices', single: 'invoice', kind: 'invoice', listKey: 'invoices', key: 'invoice', dateParam: 'date_start',
    idField: 'invoice_id', numberField: 'invoice_number', detail: true, skip: ['draft', 'void'], web: 'invoices',
  },
  creditnotes: {
    label: 'Credit notes', single: 'credit note', kind: 'credit', listKey: 'creditnotes', key: 'creditnote', dateParam: null,
    idField: 'creditnote_id', numberField: 'creditnote_number', detail: true, skip: ['draft', 'void'], web: 'creditnotes',
  },
  customerpayments: {
    label: 'Payments received', single: 'payment', kind: 'payment', listKey: 'customer_payments', key: 'payment', dateParam: null,
    idField: 'payment_id', numberField: 'payment_number', detail: 'if-needed', skip: ['void'], web: 'paymentsreceived',
  },
};

/**
 * What identifies a version of a listed document. Zoho's lists give `last_modified_time`
 * for invoices and credit notes; payments don't document one, so use the listed values.
 */
export function listVersion(item) {
  return item.last_modified_time ?? `list:${item.date ?? ''}|${item.amount ?? item.total ?? ''}|${item.payment_mode ?? ''}|${item.payment_number ?? ''}`;
}

/** Link to the document in the Zoho Books web app. */
export function zohoWebUrl(ext) {
  const t = TYPES[ext?.type];
  if (!t || !REGIONS[ext.region]) return '';
  return `${booksUrl(ext.region)}/app/${encodeURIComponent(ext.orgId)}#/${t.web}/${encodeURIComponent(ext.id)}`;
}

// --- API client -------------------------------------------------------------------

export class ZohoAuthError extends Error {}

export class ZohoBooksClient {
  #last = 0;

  /**
   * @param {object} o
   * @param {string} o.token        OAuth access token
   * @param {string} o.apiDomain    e.g. https://www.zohoapis.ae
   * @param {number} [o.minInterval] ms between requests (Zoho allows 100/min per organisation)
   */
  constructor({ token, apiDomain, expiresAt = Infinity, fetch = (...a) => globalThis.fetch(...a), minInterval = 650,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)), onWait = () => {} }) {
    Object.assign(this, { token, apiDomain, expiresAt, fetch, minInterval, sleep, onWait });
  }

  async get(path, params = {}) {
    for (let attempt = 0; ; attempt++) {
      const wait = this.#last + this.minInterval - Date.now();
      if (wait > 0) await this.sleep(wait);
      if (Date.now() > this.expiresAt) throw new ZohoAuthError('Your Zoho sign-in has expired (it lasts an hour). Connect again to carry on.');
      this.#last = Date.now();
      const url = new URL(`/books/v3/${path}`, this.apiDomain);
      for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, v);
      let res;
      try {
        res = await this.fetch(url.toString(), { headers: { Authorization: `Zoho-oauthtoken ${this.token}` } });
      } catch {
        // Zoho's "not authorised" responses carry no CORS header, so the browser reports them
        // as a network failure instead of a 401. A rejected sign-in is the usual cause.
        throw new ZohoAuthError('Couldn’t read Zoho’s response. This usually means the Zoho sign-in was rejected or has expired, so connect again. If it keeps happening, check your internet connection and the region in Settings.');
      }
      if (res.status === 401) throw new ZohoAuthError('Your Zoho sign-in has expired. Connect again.');
      if (res.status === 429 && attempt < 3) {
        this.onWait('Zoho’s rate limit was reached. Waiting a minute…');
        await this.sleep(60_000);
        continue;
      }
      let body = null;
      try { body = await res.json(); } catch { /* not JSON */ }
      if (!res.ok || body?.code !== 0) {
        throw new Error(body?.message ? `Zoho Books: ${body.message}` : `Zoho Books returned HTTP ${res.status}.`);
      }
      return body;
    }
  }

  async organizations() {
    return (await this.get('organizations')).organizations ?? [];
  }

  /** Every item of a list endpoint, page by page. */
  async *list(resource, key, params = {}) {
    for (let page = 1; ; page++) {
      const body = await this.get(resource, { ...params, page, per_page: 200 });
      yield* body[key] ?? [];
      if (!body.page_context?.has_more_page) return;
    }
  }

  async detail(resource, key, id, orgId) {
    return (await this.get(`${resource}/${encodeURIComponent(id)}`, { organization_id: orgId }))[key];
  }
}

// --- Mapping --------------------------------------------------------------------

const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

function lineDescription(li) {
  const name = String(li.name ?? '').trim();
  const desc = String(li.description ?? '').replace(/\s+/g, ' ').trim();
  return name && desc && desc !== name ? `${name} — ${desc}` : name || desc;
}

/**
 * A Zoho invoice or credit note (detail response) → line items that add up to its total:
 * item lines, an invoice-level discount, tax lines, shipping, adjustment and rounding.
 * @returns {{lines: object[], reconciled: boolean}}
 */
export function documentLines(doc, currency) {
  // Work in minor units so the check (and any fix) is exact.
  const d = currencyDecimals(currency);
  const minor = (v) => Math.round((Number(v) || 0) * 10 ** d);
  const major = (m) => roundTo(m / 10 ** d, d);
  const line = (description, m, type, category = '') => ({ description, qty: null, unitPrice: null, amount: major(m), category, type });
  const sumOf = (ls) => ls.reduce((s, l) => s + minor(l.amount), 0);

  const items = (doc.line_items ?? []).map((li) => {
    const qty = num(li.quantity);
    const rate = num(li.rate);
    const total = li.item_total ?? (qty != null && rate != null ? qty * rate - (Number(li.discount_amount) || 0) : 0);
    return { description: lineDescription(li), qty, unitPrice: rate, amount: major(minor(total)), category: '', type: 'item' };
  });
  const taxes = (doc.taxes ?? []).filter((t) => Number(t.tax_amount)).map((t) => line(t.tax_name || 'Tax', minor(t.tax_amount), 'tax', TAX_CATEGORY));
  const charges = [];
  if (Number(doc.shipping_charge)) charges.push(line('Shipping', minor(doc.shipping_charge), 'charge'));
  if (Number(doc.adjustment)) charges.push(line(doc.adjustment_description || 'Adjustment', minor(doc.adjustment), 'charge'));
  if (Number(doc.roundoff_value)) charges.push(line('Rounding', minor(doc.roundoff_value), 'charge'));

  const total = minor(doc.total);
  const gap = () => total - sumOf([...items, ...taxes, ...charges]);
  const taxTotal = sumOf(taxes);

  // Tax-inclusive rates: the item totals already contain the tax, so take it back out of them.
  if (doc.is_inclusive_tax && taxTotal > 0 && items.length && gap() <= -taxTotal) {
    distribute(sumOf(items) - taxTotal, items.map((l) => Math.max(0, minor(l.amount)))).forEach((m, i) => {
      items[i].amount = major(m);
      items[i].unitPrice = null;
    });
  }
  // Invoice-level discount: Zoho gives `discount` as "10%" or as an amount, so the
  // discount line is whatever the other lines leave over, which is exact either way.
  const discount = [];
  if (doc.discount_type !== 'item_level' && parseFloat(doc.discount) > 0 && gap() < 0) discount.push(line('Discount', gap(), 'discount'));

  const lines = [...items, ...discount, ...taxes, ...charges];
  return { lines, reconciled: sumOf(lines) === total };
}

/** A Zoho document → a transaction record (without id), plus whether its lines add up. */
export function toRecord(type, doc, { orgId, region: r, baseCurrency = '' }) {
  const T = TYPES[type];
  const currency = String(doc.currency_code || baseCurrency || '').toUpperCase();
  const d = currencyDecimals(currency);
  const external = { system: 'zoho', type, id: String(doc[T.idField]), orgId: String(orgId), region: r, modified: doc.last_modified_time ?? null };
  const base = {
    kind: T.kind,
    account: String(doc.customer_name ?? '').trim(),
    date: doc.date ?? '',
    dueDate: T.kind === 'invoice' ? doc.due_date || doc.date || '' : '',
    amount: roundTo(Number(T.kind === 'payment' ? doc.amount : doc.total) || 0, d),
    currency,
    external,
  };
  if (T.kind === 'payment') {
    return { ...base, number: String(doc.reference_number || doc.payment_number || ''), description: doc.payment_mode ?? '', lines: [], reviewed: true };
  }
  const { lines, reconciled } = documentLines(doc, currency);
  return {
    ...base,
    number: String(doc[T.numberField] ?? ''),
    description: doc.reference_number ? `Ref ${doc.reference_number}` : '',
    lines,
    // Lines that don't add up are flagged for review, like an uploaded invoice would be.
    reviewed: reconciled,
  };
}

/** Keep categories the user already chose on lines with the same description. */
export function carryCategories(lines, previous = []) {
  const known = new Map();
  for (const l of previous) if (l.category) known.set(`${l.type}|${normDesc(l.description)}`, l.category);
  return lines.map((l) => (l.category ? l : { ...l, category: known.get(`${l.type}|${normDesc(l.description)}`) ?? '' }));
}

// --- Sync -----------------------------------------------------------------------

/**
 * Import (or refresh) documents from one Zoho Books organisation into the store.
 * @param {object} o
 * @param {ZohoBooksClient} o.client
 * @param {import('./store.js').Store} o.store
 * @param {{organization_id:string, currency_code?:string}} o.org
 * @param {string} o.region
 * @param {string} [o.from]   ISO date: only documents dated on or after it
 * @param {string[]} [o.types] keys of TYPES
 */
export async function syncZoho({ client, store, org, region: r, from = '', types = Object.keys(TYPES), onProgress = () => {} }) {
  const orgId = String(org.organization_id);
  const counts = { added: 0, updated: 0, unchanged: 0, removed: 0, toReview: 0, alsoUploaded: 0 };
  const ctx = categoryContext(store.settings);
  let batch = { added: [], updated: [], removed: [] };
  const flush = async () => {
    if (batch.added.length || batch.updated.length || batch.removed.length) await store.applySync(batch);
    batch = { added: [], updated: [], removed: [] };
  };
  // Invoices already read from uploaded files, to point out likely duplicates.
  const uploaded = new Set(store.transactions.filter((t) => t.source && t.number).map((t) => `${t.kind}|${String(t.number).trim().toLowerCase()}`));

  for (const type of types) {
    const T = TYPES[type];
    onProgress(`Listing ${T.label.toLowerCase()}…`);
    const seen = new Set();
    const params = { organization_id: orgId, ...(from && T.dateParam ? { [T.dateParam]: from } : {}) };
    for await (const item of client.list(type, T.listKey, params)) {
      if (from && item.date && item.date < from) continue;
      const id = String(item[T.idField]);
      seen.add(id);
      const existing = store.findExternal('zoho', type, id);
      const drop = () => { if (existing) { batch.removed.push(existing.id); counts.removed++; } };
      if (T.skip.includes(item.status)) { drop(); continue; }
      const version = listVersion(item);
      if (existing && existing.external.modified === version) { counts.unchanged++; continue; }

      onProgress(`Reading ${T.single} ${item[T.numberField] ?? ''}…`);
      const needDetail = T.detail === true || (T.detail === 'if-needed' && !(item.customer_name && item.currency_code));
      const doc = needDetail ? { ...item, ...(await client.detail(type, T.key, id, orgId)) } : item;
      if (T.skip.includes(doc.status)) { drop(); continue; }
      const record = toRecord(type, doc, { orgId, region: r, baseCurrency: org.currency_code });
      record.external.modified = version;
      if (record.lines.length) record.lines = categorizeLines(carryCategories(record.lines, existing?.lines), ctx);
      if (!record.reviewed) counts.toReview++;
      if (!existing && uploaded.has(`${record.kind}|${record.number.trim().toLowerCase()}`)) counts.alsoUploaded++;

      if (existing) { batch.updated.push({ id: existing.id, patch: record }); counts.updated++; }
      else { batch.added.push(record); counts.added++; }
      if (batch.added.length + batch.updated.length >= 20) await flush();
    }
    // Deleted in Zoho: imported earlier from this organisation and date range, but no longer listed.
    for (const t of store.transactions) {
      const x = t.external;
      if (x?.system !== 'zoho' || x.type !== type || x.orgId !== orgId || seen.has(x.id)) continue;
      if (from && t.date && t.date < from) continue;
      if (!batch.removed.includes(t.id)) { batch.removed.push(t.id); counts.removed++; }
    }
    await flush();
  }
  return counts;
}
