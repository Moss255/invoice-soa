// Zoho Books import: mapping, the API client, sync into the store, and sign-in URLs.
// Zoho is simulated with a fake fetch; nothing goes over the network.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { Store } from '../src/lib/store.js';
import { documentLines, toRecord, ZohoBooksClient, ZohoAuthError, syncZoho, safeApiDomain, zohoWebUrl, apiUrl } from '../src/lib/zoho.js';
import { authUrl, parseRedirect, redirectUri } from '../src/lib/zoho-auth.js';
import { buildStatement } from '../src/lib/statement.js';

const sum = (lines) => lines.reduce((s, l) => s + Math.round(l.amount * 1000), 0) / 1000;

/** A BHD invoice as Zoho's invoice detail endpoint returns it. */
const bhdInvoice = (extra = {}) => ({
  invoice_id: '4600000000001', invoice_number: 'INV-000412', status: 'sent', date: '2026-10-15', due_date: '2026-11-14',
  customer_name: 'Gulf Hospitality Co. B.S.C.', currency_code: 'BHD', last_modified_time: '2026-10-15T09:00:00+0300',
  reference_number: 'PO-77',
  line_items: [
    { name: 'Kitchen equipment servicing', description: 'Quarterly', quantity: 2, rate: 125.5, item_total: 251 },
    { name: 'Replacement parts', description: '', quantity: 1, rate: 742.75, item_total: 742.75 },
  ],
  discount_type: 'entity_level', discount: 43.75, is_discount_before_tax: true,
  taxes: [{ tax_name: 'VAT (10%)', tax_amount: 95 }],
  shipping_charge: 6.25, adjustment: -0.25, adjustment_description: 'Goodwill',
  total: 1051, ...extra,
});

describe('mapping Zoho documents', () => {
  test('a BHD invoice: items, discount, VAT, shipping and adjustment add up to the fil', () => {
    const r = toRecord('invoices', bhdInvoice(), { orgId: '777', region: 'ae' });
    assert.equal(r.kind, 'invoice');
    assert.equal(r.account, 'Gulf Hospitality Co. B.S.C.');
    assert.equal(r.number, 'INV-000412');
    assert.equal(r.dueDate, '2026-11-14');
    assert.equal(r.currency, 'BHD');
    assert.equal(r.amount, 1051);
    assert.equal(r.description, 'Ref PO-77');
    assert.deepEqual(r.lines.map((l) => [l.description, l.amount, l.type]), [
      ['Kitchen equipment servicing — Quarterly', 251, 'item'],
      ['Replacement parts', 742.75, 'item'],
      ['Discount', -43.75, 'discount'],
      ['VAT (10%)', 95, 'tax'],
      ['Shipping', 6.25, 'charge'],
      ['Goodwill', -0.25, 'charge'],
    ]);
    assert.equal(r.lines[3].category, 'Tax');
    assert.equal(sum(r.lines), 1051);
    assert.equal(r.reviewed, true, 'lines reconcile, so nothing to review');
    assert.deepEqual(r.external, { system: 'zoho', type: 'invoices', id: '4600000000001', orgId: '777', region: 'ae', modified: '2026-10-15T09:00:00+0300' });
  });

  test('tax-inclusive prices: the tax is taken back out of the items, exactly', () => {
    const { lines, reconciled } = documentLines({
      is_inclusive_tax: true, total: 220.001,
      line_items: [{ name: 'A', quantity: 1, rate: 110, item_total: 110 }, { name: 'B', quantity: 1, rate: 110.001, item_total: 110.001 }],
      taxes: [{ tax_name: 'VAT', tax_amount: 20 }],
    }, 'BHD');
    assert.equal(reconciled, true);
    assert.equal(sum(lines), 220.001);
    assert.equal(lines.find((l) => l.type === 'tax').amount, 20);
    assert.equal(sum(lines.filter((l) => l.type === 'item')), 200.001);
  });

  test('a percentage discount ("10%") becomes the exact amount it took off', () => {
    const { lines, reconciled } = documentLines({
      discount: '10%', discount_type: 'entity_level', total: 99.001,
      line_items: [{ name: 'A', quantity: 1, rate: 100.001, item_total: 100.001 }],
      taxes: [{ tax_name: 'VAT', tax_amount: 9 }],
    }, 'BHD');
    assert.equal(reconciled, true);
    assert.deepEqual(lines.map((l) => [l.description, l.amount]), [['A', 100.001], ['Discount', -10], ['VAT', 9]]);
  });

  test('line totals fall back to quantity × rate when item_total is missing', () => {
    const { lines, reconciled } = documentLines({ total: 30.5, line_items: [{ name: 'A', quantity: 2, rate: 15.25 }] }, 'BHD');
    assert.equal(lines[0].amount, 30.5);
    assert.equal(reconciled, true);
  });

  test("lines that don't add up are flagged for review", () => {
    const r = toRecord('invoices', bhdInvoice({ total: 1100 }), { orgId: '1', region: 'ae' });
    assert.equal(r.reviewed, false);
  });

  test('credit notes and payments', () => {
    const cn = toRecord('creditnotes', {
      creditnote_id: 'c1', creditnote_number: 'CN-9', date: '2026-10-20', customer_name: 'Gulf', currency_code: 'BHD', total: 11,
      line_items: [{ name: 'Parts returned', quantity: 1, rate: 10, item_total: 10 }], taxes: [{ tax_name: 'VAT', tax_amount: 1 }],
    }, { orgId: '1', region: 'ae' });
    assert.equal(cn.kind, 'credit');
    assert.equal(cn.number, 'CN-9');
    assert.equal(cn.dueDate, '');
    assert.equal(cn.lines.length, 2);

    const p = toRecord('customerpayments', {
      payment_id: 'p1', payment_number: '12', reference_number: 'TRF-55', date: '2026-10-25', customer_name: 'Gulf',
      amount: 500.125, payment_mode: 'Bank Transfer',
    }, { orgId: '1', region: 'ae', baseCurrency: 'BHD' });
    assert.deepEqual([p.kind, p.number, p.amount, p.currency, p.description, p.lines.length, p.reviewed], ['payment', 'TRF-55', 500.125, 'BHD', 'Bank Transfer', 0, true]);
  });

  test('links to the document in Zoho Books', () => {
    assert.equal(zohoWebUrl({ type: 'invoices', id: '46', orgId: '777', region: 'ae' }), 'https://books.zoho.ae/app/777#/invoices/46');
    assert.equal(zohoWebUrl({ type: 'customerpayments', id: '9', orgId: '1', region: 'sa' }), 'https://books.zoho.sa/app/1#/paymentsreceived/9');
    assert.equal(zohoWebUrl(undefined), '');
  });
});

// --- A fake Zoho Books API ------------------------------------------------------------

function fakeZoho(data) {
  const calls = [];
  const reply = (status, body) => ({ status, ok: status < 400, json: async () => body });
  const fetch = async (url, opts) => {
    const u = new URL(url);
    calls.push({ path: u.pathname, params: Object.fromEntries(u.searchParams), auth: opts?.headers?.Authorization });
    if (data.status) return reply(data.status, data.body ?? {});
    const path = u.pathname.replace('/books/v3/', '');
    if (path === 'organizations') return reply(200, { code: 0, organizations: data.orgs ?? [] });
    const [resource, id] = path.split('/');
    const docs = data[resource] ?? [];
    // Response keys and list fields as in Zoho's OpenAPI specs for Books v3.
    if (id) {
      const key = { invoices: 'invoice', creditnotes: 'creditnote', customerpayments: 'payment' }[resource];
      return reply(200, { code: 0, [key]: docs.find((d) => String(d[`${key}_id`]) === id) });
    }
    const page = Number(u.searchParams.get('page'));
    const per = data.perPage ?? 200;
    const summary = resource === 'customerpayments'
      ? ({ payment_id, payment_number, date, payment_mode, amount }) => ({ payment_id, payment_number, date, payment_mode, amount, bcy_amount: amount })
      : ({ line_items, taxes, ...rest }) => rest;
    const items = docs.slice((page - 1) * per, page * per).map(summary);
    const listKey = { customerpayments: 'customer_payments' }[resource] ?? resource;
    return reply(200, { code: 0, [listKey]: items, page_context: { page, has_more_page: page * per < docs.length } });
  };
  return { fetch, calls };
}

const client = (fetch, extra) => new ZohoBooksClient({ token: 'tok', apiDomain: 'https://www.zohoapis.ae', fetch, minInterval: 0, ...extra });

describe('Zoho Books API client', () => {
  test('sends the token, follows pages, and reads details', async () => {
    const docs = Array.from({ length: 5 }, (_, i) => bhdInvoice({ invoice_id: `i${i}`, invoice_number: `INV-${i}` }));
    const z = fakeZoho({ invoices: docs, perPage: 2 });
    const c = client(z.fetch);
    const listed = [];
    for await (const inv of c.list('invoices', 'invoices', { organization_id: '777' })) listed.push(inv.invoice_number);
    assert.deepEqual(listed, ['INV-0', 'INV-1', 'INV-2', 'INV-3', 'INV-4']);
    assert.deepEqual(z.calls.map((x) => x.params.page), ['1', '2', '3']);
    assert.ok(z.calls.every((x) => x.auth === 'Zoho-oauthtoken tok' && x.params.organization_id === '777'));
    const d = await c.detail('invoices', 'invoice', 'i3', '777');
    assert.equal(d.line_items.length, 2);
  });

  test('errors: expired sign-in, Zoho error messages, and waiting out the rate limit', async () => {
    await assert.rejects(client(fakeZoho({ status: 401 }).fetch).organizations(), ZohoAuthError);
    await assert.rejects(client(fakeZoho({ status: 400, body: { code: 6041, message: 'Invalid organization' } }).fetch).organizations(), /Zoho Books: Invalid organization/);

    let n = 0;
    const waits = [];
    const flaky = async () => (++n === 1 ? { status: 429, ok: false, json: async () => ({}) } : { status: 200, ok: true, json: async () => ({ code: 0, organizations: [{ name: 'X' }] }) });
    const orgs = await client(flaky, { sleep: async (ms) => waits.push(ms), onWait: () => {} }).organizations();
    assert.deepEqual(orgs, [{ name: 'X' }]);
    assert.ok(waits.includes(60_000));
  });

  test('an unreadable response (Zoho hides 401s from browsers) or an expired token means signing in again', async () => {
    const refused = async () => { throw new TypeError('Failed to fetch'); };
    await assert.rejects(client(refused).organizations(), (e) => e instanceof ZohoAuthError && /connect again/.test(e.message));
    let called = false;
    const spy = async () => { called = true; return { status: 200, ok: true, json: async () => ({ code: 0 }) }; };
    await assert.rejects(client(spy, { expiresAt: Date.now() - 1 }).organizations(), ZohoAuthError);
    assert.equal(called, false, 'no request with an expired token');
  });

  test('only ever sends the token to a Zoho API host', () => {
    assert.equal(safeApiDomain('https://www.zohoapis.sa', 'ae'), 'https://www.zohoapis.sa');
    assert.equal(safeApiDomain('https://www.zohoapis.com.au', 'ae'), 'https://www.zohoapis.com.au');
    assert.equal(safeApiDomain('https://evil.example/www.zohoapis.ae', 'ae'), apiUrl('ae'));
    assert.equal(safeApiDomain('https://www.zohoapis.ae.evil.example', 'ae'), apiUrl('ae'));
    assert.equal(safeApiDomain(null, 'sa'), 'https://www.zohoapis.sa');
  });
});

describe('syncing into the store', () => {
  let store;
  beforeEach(async () => {
    globalThis.indexedDB = new IDBFactory();
    store = new Store();
    await store.ready;
  });

  const org = { organization_id: '777', currency_code: 'BHD' };
  const data = () => ({
    invoices: [
      bhdInvoice(),
      bhdInvoice({ invoice_id: 'draft1', invoice_number: 'INV-DRAFT', status: 'draft' }),
      bhdInvoice({ invoice_id: 'old1', invoice_number: 'INV-OLD', date: '2024-03-01' }),
    ],
    creditnotes: [{
      creditnote_id: 'c1', creditnote_number: 'CN-1', status: 'open', date: '2026-10-20', customer_name: 'Gulf Hospitality Co. B.S.C.',
      currency_code: 'BHD', total: 51, last_modified_time: 't1', line_items: [{ name: 'Replacement parts', quantity: 1, rate: 51, item_total: 51 }],
    }],
    customerpayments: [{
      payment_id: 'p1', payment_number: '1', date: '2026-10-25', customer_name: 'Gulf Hospitality Co. B.S.C.', currency_code: 'BHD',
      amount: 500, payment_mode: 'Bank Transfer', reference_number: 'TRF-1', status: 'success',
    }],
  });

  test('first import, then an unchanged re-import, then changes and a void', async () => {
    await store.saveSettings({ categoryRules: 'Maintenance: servicing' });
    const zoho = data();
    const z = fakeZoho(zoho);
    const run = () => syncZoho({ client: client(z.fetch), store, org, region: 'ae', from: '2026-01-01' });

    assert.deepEqual(await run(), { added: 3, updated: 0, unchanged: 0, removed: 0, toReview: 0, alsoUploaded: 0 });
    assert.equal(z.calls.find((c) => c.path.endsWith('/invoices')).params.date_start, '2026-01-01');
    assert.equal(z.calls.find((c) => c.path.endsWith('/creditnotes')).params.date_start, undefined, 'only invoices document date_start');
    const pay = store.transactions.find((t) => t.kind === 'payment');
    assert.deepEqual([pay.account, pay.currency, pay.number], ['Gulf Hospitality Co. B.S.C.', 'BHD', 'TRF-1'], 'payment details fetched for what the list lacks');
    assert.deepEqual(store.transactions.map((t) => t.kind).sort(), ['credit', 'invoice', 'payment']);
    const inv = store.transactions.find((t) => t.kind === 'invoice');
    assert.equal(inv.lines[0].category, 'Maintenance', 'keyword rules apply to imported lines');

    // The statement works off imported records like any others: 1051 − 51 − 500.
    const st = buildStatement(store.transactions, { account: 'Gulf Hospitality Co. B.S.C.', currency: 'BHD', to: '2026-11-11' });
    assert.equal(st.closing, 500);

    // Nothing changed in Zoho: no detail requests, nothing written.
    const before = z.calls.length;
    assert.deepEqual(await run(), { added: 0, updated: 0, unchanged: 3, removed: 0, toReview: 0, alsoUploaded: 0 });
    assert.ok(z.calls.slice(before).every((c) => !/\/(invoices|creditnotes|customerpayments)\/./.test(c.path)), 'unchanged documents are not fetched again');

    // The user categorises a line; then the invoice is edited in Zoho and the credit note voided.
    await store.update(inv.id, { lines: inv.lines.map((l, i) => (i === 1 ? { ...l, category: 'Parts' } : l)) });
    zoho.invoices[0] = bhdInvoice({ last_modified_time: 'later', total: 1101, adjustment: 49.75 });
    zoho.creditnotes[0].status = 'void';
    assert.deepEqual(await run(), { added: 0, updated: 1, unchanged: 1, removed: 1, toReview: 0, alsoUploaded: 0 });
    const updated = store.get(inv.id);
    assert.equal(updated.amount, 1101);
    assert.equal(updated.lines[1].category, 'Parts', "the user's category survives the update");
    assert.equal(store.transactions.length, 2);

    // And it all persisted.
    const reloaded = new Store();
    await reloaded.ready;
    assert.equal(reloaded.transactions.length, 2);
    assert.equal(reloaded.findExternal('zoho', 'invoices', '4600000000001').amount, 1101);
  });

  test('documents deleted in Zoho are removed, but only within the imported date range', async () => {
    const zoho = data();
    const z = fakeZoho(zoho);
    await syncZoho({ client: client(z.fetch), store, org, region: 'ae', from: '2026-01-01' });
    // An older import from the same organisation, outside this date range.
    await store.add({ kind: 'invoice', account: 'Gulf', number: 'INV-2025', date: '2025-06-01', amount: 5, currency: 'BHD', external: { system: 'zoho', type: 'invoices', id: 'gone-but-old', orgId: '777' } });
    zoho.customerpayments = [];
    const c = await syncZoho({ client: client(z.fetch), store, org, region: 'ae', from: '2026-01-01' });
    assert.equal(c.removed, 1);
    assert.ok(!store.transactions.some((t) => t.kind === 'payment'));
    assert.ok(store.findExternal('zoho', 'invoices', 'gone-but-old'), 'outside the date range, so left alone');
  });

  test('points out invoices that were also uploaded as files', async () => {
    await store.add({ kind: 'invoice', account: 'Gulf', number: 'inv-000412', date: '2026-10-15', amount: 1051, currency: 'BHD', source: { name: 'a.pdf' } });
    const z = fakeZoho({ invoices: [bhdInvoice()] });
    const c = await syncZoho({ client: client(z.fetch), store, org, region: 'ae', types: ['invoices'] });
    assert.equal(c.alsoUploaded, 1);
  });
});

describe('sign-in', () => {
  test('the authorisation URL for the UAE data centre', () => {
    const u = new URL(authUrl({ region: 'ae', clientId: '1000.ABC', state: 'soazoho_x', redirect: 'http://localhost:5173/' }));
    assert.equal(u.origin, 'https://accounts.zoho.ae');
    assert.equal(u.pathname, '/oauth/v2/auth');
    assert.equal(u.searchParams.get('response_type'), 'token');
    assert.equal(u.searchParams.get('client_id'), '1000.ABC');
    assert.equal(u.searchParams.get('redirect_uri'), 'http://localhost:5173/');
    assert.match(u.searchParams.get('scope'), /ZohoBooks\.invoices\.READ,.*ZohoBooks\.customerpayments\.READ/);
    assert.throws(() => authUrl({ region: '', clientId: 'x', state: 's', redirect: 'http://localhost:5173/' }), /region/);
  });

  test("reads Zoho's redirect, and ignores the app's own routes", () => {
    const r = parseRedirect({ hash: '#access_token=1000.tok&expires_in=3600&api_domain=https%3A%2F%2Fwww.zohoapis.ae&token_type=Bearer&state=soazoho_ab', search: '' });
    assert.deepEqual(r, { state: 'soazoho_ab', token: '1000.tok', expiresIn: 3600, apiDomain: 'https://www.zohoapis.ae', error: null });
    assert.equal(parseRedirect({ hash: '', search: '?error=access_denied&state=soazoho_ab' }).error, 'access_denied');
    // Zoho's documented example has no state.
    const doc = parseRedirect({ hash: '#access_token=1000.xyz&expires_in=3600&location=in&api_domain=https://www.zohoapis.in&granted_for_session=true', search: '' });
    assert.deepEqual([doc.token, doc.apiDomain, doc.state], ['1000.xyz', 'https://www.zohoapis.in', null]);
    assert.equal(parseRedirect({ hash: '#statements', search: '' }), null);
    assert.equal(parseRedirect({ hash: '#access_token=x&state=someone-else', search: '' }), null);
    assert.equal(redirectUri({ origin: 'https://me.github.io', pathname: '/soa/' }), 'https://me.github.io/soa/');
  });
});
