// File → extracted fields → stored transaction.

import { extractLines, hashFile } from './extract.js';
import { parseInvoice } from './parse-invoice.js';
import { parseLineItems } from './line-items.js';
import { categorizeLines, categoryContext } from './categories.js';
import { store, uid } from './store.js';

/**
 * @param {File} file
 * @param {(msg:string)=>void} onProgress
 * @returns {Promise<{status:'added'|'duplicate', record:object}>}
 */
export async function importFile(file, onProgress = () => {}) {
  await store.ready;
  const hash = await hashFile(file);
  const existing = store.findByHash(hash);
  if (existing) return { status: 'duplicate', record: existing };

  const { lines, text, method } = await extractLines(file, onProgress);
  onProgress('Finding invoice details…');
  const s = store.settings;
  const parsed = parseInvoice(lines, {
    dateOrder: s.dateOrder,
    defaultCurrency: s.defaultCurrency,
    myCompany: s.companyName,
    termsDays: Number(s.termsDays) || 30,
  });

  const { items } = parseLineItems(lines, { total: parsed.amount, currency: parsed.currency });
  const fileId = uid();
  const record = await store.add({
    kind: parsed.kind,
    account: parsed.account ?? '',
    number: parsed.number ?? '',
    date: parsed.date ?? '',
    dueDate: parsed.kind === 'invoice' ? parsed.dueDate ?? '' : '',
    amount: parsed.amount,
    currency: parsed.currency,
    description: '',
    lines: categorizeLines(items, categoryContext(s)),
    reviewed: false,
    extracted: { billTo: parsed.billTo, supplier: parsed.supplier, missing: parsed.missing, method },
    source: { fileId, name: file.name, type: file.type, size: file.size, hash },
  }, { id: fileId, blob: file, name: file.name, type: file.type, text });

  return { status: 'added', record };
}

/** Re-read line items from the stored original file of a transaction. */
export async function rereadLines(record) {
  const stored = record.source?.fileId && (await store.getFile(record.source.fileId));
  if (!stored) throw new Error('The original file is no longer stored.');
  const file = new File([stored.blob], stored.name, { type: stored.type });
  const { lines } = await extractLines(file);
  const { items } = parseLineItems(lines, { total: Number(record.amount) || null, currency: record.currency });
  return categorizeLines(items, categoryContext(store.settings));
}
