// Local persistence in IndexedDB. Nothing leaves the browser.
// The store keeps everything in memory too and fires a `change` event after writes,
// which components listen to in order to re-render.

import { normDesc, categorize, categoryContext } from './categories.js';
import { normaliseTemplate } from './template.js';

const DB_NAME = 'invoice-soa';
const DB_VERSION = 1;

export const DEFAULT_SETTINGS = {
  companyName: '',
  companyDetails: '',
  statementNote: 'Please remit payment of any overdue amounts. Contact us if you have any questions about this statement.',
  dateOrder: guessDateOrder(),
  defaultCurrency: 'USD',
  termsDays: 30,
  categoryRules: '',
  /** Statement template (see template.js); null until first edited. */
  template: null,
  learnedCategories: {},
  /** Zoho Books import (see zoho.js). The client ID identifies this app to Zoho; it isn't a secret. */
  zohoRegion: '',
  zohoClientId: '',
  zohoOrgId: '',
  zohoFrom: '',
  zohoTypes: ['invoices', 'creditnotes', 'customerpayments'],
};

function guessDateOrder() {
  try {
    const parts = new Intl.DateTimeFormat(undefined).formatToParts(new Date(2026, 10, 25));
    return parts.findIndex((p) => p.type === 'month') < parts.findIndex((p) => p.type === 'day') ? 'MDY' : 'DMY';
  } catch { return 'DMY'; }
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('transactions')) db.createObjectStore('transactions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const reqP = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
const txDone = (tx) => new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });

export const uid = () => (crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

export class Store extends EventTarget {
  /** @type {IDBDatabase|null} */ #db = null;
  transactions = [];
  settings = { ...DEFAULT_SETTINGS };
  ready;

  constructor() {
    super();
    this.ready = this.#load();
  }

  async #load() {
    try {
      this.#db = await openDb();
      const tx = this.#db.transaction(['transactions', 'meta'], 'readonly');
      this.transactions = await reqP(tx.objectStore('transactions').getAll());
      const saved = await reqP(tx.objectStore('meta').get('settings'));
      this.settings = { ...DEFAULT_SETTINGS, ...(saved || {}) };
    } catch (err) {
      console.warn('IndexedDB unavailable; data will not persist.', err);
      this.#db = null;
    }
    this.#emit('load');
  }

  #emit(reason) {
    this.dispatchEvent(new CustomEvent('change', { detail: { reason } }));
  }

  async #write(stores, fn) {
    if (!this.#db) return;
    const tx = this.#db.transaction(stores, 'readwrite');
    fn(tx);
    await txDone(tx);
  }

  get(id) { return this.transactions.find((t) => t.id === id); }

  async add(record, file) {
    const t = { id: uid(), createdAt: new Date().toISOString(), ...record };
    this.transactions = [...this.transactions, t];
    await this.#write(['transactions', 'files'], (tx) => {
      tx.objectStore('transactions').put(t);
      if (file) tx.objectStore('files').put(file);
    });
    this.#emit('add');
    return t;
  }

  async update(id, patch) {
    const cur = this.get(id);
    if (!cur) return;
    const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    this.transactions = this.transactions.map((t) => (t.id === id ? next : t));
    await this.#write(['transactions'], (tx) => tx.objectStore('transactions').put(next));
    this.#emit('update');
    return next;
  }

  /** Apply several patches in one write and one change event. */
  async updateMany(patches) {
    if (!patches.length) return;
    const now = new Date().toISOString();
    const byId = new Map(patches.map(({ id, patch }) => [id, patch]));
    this.transactions = this.transactions.map((t) => (byId.has(t.id) ? { ...t, ...byId.get(t.id), updatedAt: now } : t));
    const changed = this.transactions.filter((t) => byId.has(t.id));
    await this.#write(['transactions'], (tx) => changed.forEach((t) => tx.objectStore('transactions').put(t)));
    this.#emit('update');
  }

  /**
   * Remember that lines described like `description` belong to `category`, and fill
   * that category in on other uncategorised lines with the same description.
   * @returns {Promise<number>} how many other lines were filled in
   */
  async learnCategory(description, category, exceptId) {
    const key = normDesc(description);
    if (!key) return 0;
    const learned = { ...(this.settings.learnedCategories ?? {}) };
    if (category) learned[key] = category; else delete learned[key];
    this.settings = { ...this.settings, learnedCategories: learned };
    await this.#write(['meta'], (tx) => tx.objectStore('meta').put(this.settings, 'settings'));
    if (!category) return 0;
    let filled = 0;
    const patches = [];
    for (const t of this.transactions) {
      if (t.id === exceptId || !t.lines?.some((l) => !l.category && normDesc(l.description) === key)) continue;
      const lines = t.lines.map((l) => (!l.category && normDesc(l.description) === key ? (filled++, { ...l, category }) : l));
      patches.push({ id: t.id, patch: { lines } });
    }
    await this.updateMany(patches);
    return filled;
  }

  /** Run the category rules over every uncategorised line. */
  async applyCategoryRules() {
    const ctx = categoryContext(this.settings);
    const patches = [];
    let filled = 0;
    for (const t of this.transactions) {
      if (!t.lines?.some((l) => !l.category)) continue;
      const lines = t.lines.map((l) => {
        if (l.category) return l;
        const category = categorize(l.description, ctx);
        if (category) filled++;
        return category ? { ...l, category } : l;
      });
      patches.push({ id: t.id, patch: { lines } });
    }
    await this.updateMany(patches.filter((p, i) => p.patch.lines.some((l, j) => l !== this.get(p.id).lines[j])));
    return filled;
  }

  async remove(id) {
    const cur = this.get(id);
    this.transactions = this.transactions.filter((t) => t.id !== id);
    await this.#write(['transactions', 'files'], (tx) => {
      tx.objectStore('transactions').delete(id);
      if (cur?.source?.fileId) tx.objectStore('files').delete(cur.source.fileId);
    });
    this.#emit('remove');
  }

  async getFile(fileId) {
    if (!this.#db) return null;
    return reqP(this.#db.transaction('files').objectStore('files').get(fileId));
  }

  findByHash(hash) {
    return this.transactions.find((t) => t.source?.hash === hash);
  }

  /** A record imported from another system (e.g. Zoho Books) by that system's id. */
  findExternal(system, type, id) {
    return this.transactions.find((t) => t.external?.system === system && t.external.type === type && t.external.id === id);
  }

  /** Add, update and remove records in one write and one change event (used by imports). */
  async applySync({ added = [], updated = [], removed = [] }) {
    const now = new Date().toISOString();
    const fresh = added.map((r) => ({ id: uid(), createdAt: now, ...r }));
    const patches = new Map(updated.map(({ id, patch }) => [id, patch]));
    const gone = new Set(removed);
    this.transactions = [
      ...this.transactions.filter((t) => !gone.has(t.id)).map((t) => (patches.has(t.id) ? { ...t, ...patches.get(t.id), updatedAt: now } : t)),
      ...fresh,
    ];
    const changed = this.transactions.filter((t) => patches.has(t.id));
    await this.#write(['transactions'], (tx) => {
      const os = tx.objectStore('transactions');
      [...fresh, ...changed].forEach((t) => os.put(t));
      gone.forEach((id) => os.delete(id));
    });
    this.#emit('sync');
  }

  /** The statement template, complete and valid (defaults filled in). */
  get template() {
    return normaliseTemplate(this.settings.template, this.settings);
  }

  async saveTemplate(template) {
    await this.saveSettings({ template: normaliseTemplate(template) });
  }

  async saveSettings(patch) {
    this.settings = { ...this.settings, ...patch };
    await this.#write(['meta'], (tx) => tx.objectStore('meta').put(this.settings, 'settings'));
    this.#emit('settings');
  }

  exportBackup() {
    return {
      app: 'invoice-soa',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: this.settings,
      transactions: this.transactions,
    };
  }

  /** Merge a backup into the current data (records with the same id are replaced). */
  async importBackup(data) {
    if (data?.app !== 'invoice-soa' || !Array.isArray(data.transactions)) throw new Error('Not an invoice-soa backup file.');
    const byId = new Map(this.transactions.map((t) => [t.id, t]));
    for (const t of data.transactions) byId.set(t.id, t);
    this.transactions = [...byId.values()];
    if (data.settings) this.settings = { ...DEFAULT_SETTINGS, ...data.settings };
    await this.#write(['transactions', 'meta'], (tx) => {
      for (const t of data.transactions) tx.objectStore('transactions').put(t);
      tx.objectStore('meta').put(this.settings, 'settings');
    });
    this.#emit('import');
    return data.transactions.length;
  }

  async clearAll() {
    this.transactions = [];
    await this.#write(['transactions', 'files'], (tx) => {
      tx.objectStore('transactions').clear();
      tx.objectStore('files').clear();
    });
    this.#emit('clear');
  }
}

export const store = new Store();
