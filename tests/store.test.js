// IndexedDB persistence and the import pipeline, using an in-memory IndexedDB.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { Store, DEFAULT_SETTINGS } from '../src/lib/store.js';

/** A store on a fresh, empty database. */
async function freshStore() {
  globalThis.indexedDB = new IDBFactory();
  const s = new Store();
  await s.ready;
  return s;
}

/** Simulate a page reload: a new Store on the same database. */
async function reload() {
  const s = new Store();
  await s.ready;
  return s;
}

const invoice = (extra = {}) => ({
  kind: 'invoice', account: 'Gulf Hospitality', number: 'A-1', date: '2026-10-01', dueDate: '2026-10-31',
  amount: 100.5, currency: 'BHD', lines: [], ...extra,
});

let store;
beforeEach(async () => { store = await freshStore(); });

describe('transactions', () => {
  test('add, update and remove persist across reloads', async () => {
    const t = await store.add(invoice());
    assert.ok(t.id && t.createdAt);
    await store.update(t.id, { amount: 200.25 });
    assert.equal((await reload()).get(t.id).amount, 200.25);

    await store.remove(t.id);
    assert.equal((await reload()).transactions.length, 0);
  });

  test('the original file is stored with the record and deleted with it', async () => {
    const t = await store.add(invoice({ source: { fileId: 'f1', hash: 'abc' } }), { id: 'f1', blob: new Blob(['pdf']), name: 'a.pdf' });
    assert.equal((await store.getFile('f1')).name, 'a.pdf');
    assert.equal(store.findByHash('abc').id, t.id);
    await store.remove(t.id);
    assert.equal(await store.getFile('f1'), undefined);
  });

  test('every write emits one change event', async () => {
    const reasons = [];
    store.addEventListener('change', (e) => reasons.push(e.detail.reason));
    const t = await store.add(invoice());
    await store.update(t.id, { number: 'A-2' });
    await store.updateMany([{ id: t.id, patch: { amount: 1 } }]);
    await store.remove(t.id);
    assert.deepEqual(reasons, ['add', 'update', 'update', 'remove']);
  });

  test('updateMany with nothing to do is a no-op', async () => {
    let fired = 0;
    store.addEventListener('change', () => fired++);
    await store.updateMany([]);
    assert.equal(fired, 0);
  });
});

describe('settings', () => {
  test('defaults, then saved values survive a reload', async () => {
    assert.equal(store.settings.termsDays, DEFAULT_SETTINGS.termsDays);
    await store.saveSettings({ companyName: 'Al Noor Trading W.L.L.', defaultCurrency: 'BHD' });
    const again = await reload();
    assert.equal(again.settings.companyName, 'Al Noor Trading W.L.L.');
    assert.equal(again.settings.defaultCurrency, 'BHD');
    assert.equal(again.settings.termsDays, DEFAULT_SETTINGS.termsDays);
  });
});

describe('categories', () => {
  test('learnCategory remembers the choice and fills blanks whose description differs only in numbers', async () => {
    const a = await store.add(invoice({ lines: [{ description: 'Kitchen servicing 10/2026', category: '', amount: 50 }] }));
    const b = await store.add(invoice({ number: 'A-2', lines: [
      { description: 'Kitchen servicing 11/2026', category: '', amount: 50 },
      { description: 'Kitchen servicing 12/2026', category: 'Already set', amount: 50 },
    ] }));
    const filled = await store.learnCategory('Kitchen servicing 10/2026', 'Maintenance', a.id);
    assert.equal(filled, 1);
    assert.equal(store.get(b.id).lines[0].category, 'Maintenance');
    assert.equal(store.get(b.id).lines[1].category, 'Already set', 'never overwrites a chosen category');
    assert.equal(store.get(a.id).lines[0].category, '', 'the edited record is left to the caller');
    assert.equal((await reload()).settings.learnedCategories['kitchen servicing'], 'Maintenance');
  });

  test('clearing a category forgets it', async () => {
    await store.learnCategory('Parts', 'Spares');
    await store.learnCategory('Parts', '');
    assert.equal(store.settings.learnedCategories.parts, undefined);
  });

  test('applyCategoryRules only fills uncategorised lines', async () => {
    const t = await store.add(invoice({ lines: [
      { description: 'Compressor parts', category: '', amount: 10 },
      { description: 'Delivery', category: '', amount: 2 },
      { description: 'Parts (manual)', category: 'Mine', amount: 1 },
    ] }));
    await store.saveSettings({ categoryRules: 'Parts: parts, compressor\nLogistics: delivery' });
    assert.equal(await store.applyCategoryRules(), 2);
    assert.deepEqual(store.get(t.id).lines.map((l) => l.category), ['Parts', 'Logistics', 'Mine']);
    assert.equal(await store.applyCategoryRules(), 0, 'running again changes nothing');
  });
});

describe('backup', () => {
  test('export then import into an empty browser', async () => {
    await store.add(invoice());
    await store.saveSettings({ companyName: 'Al Noor' });
    const backup = JSON.parse(JSON.stringify(store.exportBackup()));

    const other = await freshStore();
    assert.equal(await other.importBackup(backup), 1);
    assert.equal(other.transactions[0].amount, 100.5);
    assert.equal(other.settings.companyName, 'Al Noor');
  });

  test('import merges by id instead of duplicating', async () => {
    const t = await store.add(invoice());
    const backup = store.exportBackup();
    backup.transactions[0] = { ...backup.transactions[0], amount: 999 };
    await store.importBackup(backup);
    assert.equal(store.transactions.length, 1);
    assert.equal(store.get(t.id).amount, 999);
  });

  test('rejects files that are not backups', async () => {
    await assert.rejects(store.importBackup({ hello: 'world' }), /Not an invoice-soa backup/);
  });

  test('clearAll empties transactions but keeps settings', async () => {
    await store.add(invoice());
    await store.saveSettings({ companyName: 'Keep me' });
    await store.clearAll();
    const again = await reload();
    assert.equal(again.transactions.length, 0);
    assert.equal(again.settings.companyName, 'Keep me');
  });
});

describe('import pipeline (text invoice, no PDF engine needed)', async () => {
  const { importFile } = await import('../src/lib/importer.js');
  // The importer uses the app's shared store, so point it at a clean database.
  const { store: shared } = await import('../src/lib/store.js');

  const text = [
    'Al Noor Trading W.L.L.',
    'TAX INVOICE',
    'Invoice No: ANT/2026/0500      Invoice Date: 01/11/2026',
    'Bill To:',
    'Gulf Hospitality Co. B.S.C.',
    'Payment terms: 30 days',
    'Description            Qty      Unit Price      Amount',
    'Grease trap cleaning    1        45.500          45.500',
    'Filter replacement      4        3.125           12.500',
    'VAT 10%                                          5.800',
    'Total BHD                                        BD 63.800',
  ].join('\n');

  test('reads, categorises and stores a BHD invoice, then skips the duplicate', async () => {
    await shared.ready;
    await shared.clearAll();
    await shared.saveSettings({ dateOrder: 'DMY', companyName: '', categoryRules: 'Cleaning: cleaning\nParts: filter' });

    const file = new File([text], 'ant-0500.txt', { type: 'text/plain' });
    const { status, record } = await importFile(file);
    assert.equal(status, 'added');
    assert.equal(record.currency, 'BHD');
    assert.equal(record.amount, 63.8);
    assert.equal(record.number, 'ANT/2026/0500');
    assert.equal(record.account, 'Gulf Hospitality Co. B.S.C.');
    assert.equal(record.date, '2026-11-01');
    assert.equal(record.dueDate, '2026-12-01');
    assert.deepEqual(record.lines.map((l) => [l.description, l.amount, l.category]), [
      ['Grease trap cleaning', 45.5, 'Cleaning'],
      ['Filter replacement', 12.5, 'Parts'],
      ['VAT 10%', 5.8, 'Tax'],
    ]);
    assert.equal(record.reviewed, false);

    const again = await importFile(new File([text], 'copy.txt', { type: 'text/plain' }));
    assert.equal(again.status, 'duplicate');
    assert.equal(shared.transactions.length, 1);
  });

  test('unsupported files are rejected with a clear message', async () => {
    await assert.rejects(importFile(new File(['x'], 'sheet.xlsx', { type: 'application/vnd.ms-excel' })), /Unsupported file type/);
  });
});
