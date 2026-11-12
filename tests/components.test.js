// @vitest-environment happy-dom
// The custom elements rendered in a simulated browser, against an in-memory IndexedDB.
import 'fake-indexeddb/auto';
import { beforeEach, afterEach, describe, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { store } from '../src/lib/store.js';
import '../src/main.js';

const shadow = (el) => el.shadowRoot;
const $ = (el, sel) => shadow(el).querySelector(sel);
const $$ = (el, sel) => [...shadow(el).querySelectorAll(sel)];
const text = (el) => shadow(el).textContent.replace(/\s+/g, ' ');

function mount(tag, attrs = {}) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.append(el);
  return el;
}

/** Retry an assertion until IndexedDB writes have settled. */
const eventually = (fn) => vi.waitFor(fn, { timeout: 2000, interval: 5 });

function change(input, value) {
  input.value = value;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

const bhdInvoice = {
  kind: 'invoice', account: 'Gulf Hospitality Co. B.S.C.', number: 'ANT/2026/0412', date: '2026-10-15', dueDate: '2026-11-14',
  amount: 1100, currency: 'BHD', reviewed: false, source: { fileId: 'f1', name: 'ant-0412.pdf', hash: 'h1' },
  lines: [
    { description: 'Kitchen equipment servicing', category: 'Maintenance', qty: 2, unitPrice: 125.5, amount: 251, type: 'item' },
    { description: 'Replacement parts - compressor', category: '', qty: 1, unitPrice: 742.75, amount: 742.75, type: 'item' },
    { description: 'Delivery charges', category: 'Maintenance', qty: 1, unitPrice: 6.25, amount: 6.25, type: 'item' },
    { description: 'VAT 10%', category: 'Tax', amount: 100, type: 'tax' },
  ],
};

beforeEach(async () => {
  await store.ready;
  await store.clearAll();
  await store.saveSettings({ companyName: 'Al Noor Trading W.L.L.', learnedCategories: {}, categoryRules: '' });
});
afterEach(() => { document.body.innerHTML = ''; });

describe('<transaction-table>', () => {
  test('empty state', () => {
    const el = mount('transaction-table');
    assert.match(text(el), /No invoices yet/);
  });

  test('shows BHD amounts with 3 decimals and flags rows to review', async () => {
    await store.add(bhdInvoice);
    const el = mount('transaction-table');
    assert.equal($(el, '[data-field=amount]').value, '1100.000');
    assert.equal($(el, '[data-field=currency]').value, 'BHD');
    assert.match($(el, 'tr[data-id] .pill').textContent, /Review/);
    assert.match($(el, '.lines-btn').textContent, /4 lines/);
  });

  test('typing 12.500 into a BHD amount stores 12.5 dinars and marks it reviewed', async () => {
    const t = await store.add(bhdInvoice);
    const el = mount('transaction-table');
    change($(el, '[data-field=amount]'), '12.500');
    await eventually(() => {
      assert.equal(store.get(t.id).amount, 12.5);
      assert.equal(store.get(t.id).reviewed, true);
    });
  });

  test('line editor: fils, reconciliation and learning a category', async () => {
    const t = await store.add(bhdInvoice);
    await store.add({ ...bhdInvoice, number: 'ANT/2026/0413', source: { ...bhdInvoice.source, hash: 'h2' } });
    const el = mount('transaction-table');
    const row = $$(el, 'tr[data-id]').find((r) => r.dataset.id === t.id && !r.classList.contains('lines-row'));
    row.querySelector('[data-action=lines]').click();

    const amounts = $$(el, 'tr.lines-row [data-line-field=amount]').map((i) => i.value);
    assert.deepEqual(amounts, ['251.000', '742.750', '6.250', '100.000']);
    assert.match($(el, '.recon').textContent, /reconciled/);

    // Categorise the uncategorised line; the other invoice's identical line is filled in too.
    change($$(el, 'tr.lines-row [data-line-field=category]')[1], 'Parts');
    await eventually(() => {
      assert.equal(store.get(t.id).lines[1].category, 'Parts');
      const other = store.transactions.find((x) => x.id !== t.id);
      assert.equal(other.lines[1].category, 'Parts');
      assert.match($(el, '.notice')?.textContent ?? '', /Also set 1 other/);
    });
  });

  test('editing qty × unit price recalculates the line in fils', async () => {
    const t = await store.add(bhdInvoice);
    const el = mount('transaction-table');
    $(el, '[data-action=lines]').click();
    change($$(el, 'tr.lines-row [data-line-field=unitPrice]')[0], '125.125');
    await eventually(() => {
      assert.equal(store.get(t.id).lines[0].amount, 250.25);
      assert.match($(el, '.recon .bad')?.textContent ?? '', /not covered by lines/);
    });
  });

  test('filters: needs review and uncategorised lines', async () => {
    await store.add(bhdInvoice);
    await store.add({ kind: 'payment', account: 'Gulf Hospitality Co. B.S.C.', date: '2026-10-20', amount: 500, currency: 'BHD', reviewed: true });
    const el = mount('transaction-table');
    $(el, '[data-filter=review]').click();
    assert.equal($$(el, 'tbody > tr[data-id]:not(.lines-row)').length, 1);
    $(el, '[data-filter=uncat]').click();
    assert.equal($$(el, 'tbody > tr[data-id]:not(.lines-row)').length, 1);
    $(el, '[data-filter=payment]').click();
    // happy-dom ignores <option selected> from innerHTML, so read the attribute.
    assert.equal($(el, 'tbody [data-field=kind] option[selected]').value, 'payment');
  });
});

describe('<account-statement>', () => {
  test('a BHD statement with outstanding by category', async () => {
    await store.add(bhdInvoice);
    await store.add({ kind: 'payment', account: 'Gulf Hospitality Co. B.S.C.', date: '2026-10-20', amount: 550, currency: 'BHD', reviewed: true });
    const el = mount('account-statement', { 'account-key': 'gulf hospitality co. b.s.c.', currency: 'BHD' });

    assert.match($(el, '.due-box .amt').textContent, /550[.,]000/);
    const cats = $$(el, '.cats tbody tr').map((r) => r.querySelector('td').textContent);
    assert.deepEqual(cats, ['Uncategorised', 'Maintenance', 'Tax']);
    assert.match($(el, '.cats tfoot').textContent, /550[.,]000/);
    // Ledger balance column uses 3 decimals too.
    assert.match($$(el, '.ledger tbody tr').at(-1).lastElementChild.previousElementSibling.textContent, /550[.,]000/);
    assert.match($(el, '.ledger tfoot').textContent, /550[.,]000/);
    assert.match(text(el), /Al Noor Trading W\.L\.L\./);
  });

  test('line items can be shown under each invoice (saved to the template)', async () => {
    await store.add(bhdInvoice);
    const el = mount('account-statement', { 'account-key': 'gulf hospitality co. b.s.c.', currency: 'BHD' });
    assert.equal($$(el, 'tr.sub').length, 0);
    const box = $(el, '[data-ctl=lines]');
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await eventually(() => assert.equal($$(el, 'tr.sub').length, 4));
    assert.equal(store.template.sections.find((s) => s.key === 'activity').showLineItems, true);
  });

  test('follows the template: wording, hidden columns, section order and branding', async () => {
    await store.add(bhdInvoice);
    const t = store.template;
    t.title = 'Kashf Hisab — {customer}';
    t.intro = 'Dear {customer}, your balance is {balance_due}.';
    t.branding.accent = '#7a1f3d';
    t.branding.logo = 'data:image/png;base64,iVBORw0KGgo=';
    const activity = t.sections.find((s) => s.key === 'activity');
    activity.heading = 'Transactions';
    activity.columns.status.visible = false;
    activity.columns.balance.label = 'Running total';
    t.sections.find((s) => s.key === 'aging').visible = false;
    // Move "activity" to the top of the sections.
    t.sections = [activity, ...t.sections.filter((s) => s !== activity)];
    await store.saveTemplate(t);

    const el = mount('account-statement', { 'account-key': 'gulf hospitality co. b.s.c.', currency: 'BHD' });
    assert.equal($(el, 'h1').textContent, 'Kashf Hisab — Gulf Hospitality Co. B.S.C.');
    assert.match($(el, '.intro').textContent, /Dear Gulf Hospitality Co\. B\.S\.C\., your balance is BHD.?1,100[.,]000\./);
    assert.match($(el, '.paper').getAttribute('style'), /--doc-accent:#7a1f3d/);
    assert.ok($(el, 'img.logo'));
    const heads = $$(el, '.ledger thead th').map((th) => th.textContent);
    assert.ok(!heads.includes('Status'));
    assert.ok(heads.includes('Running total'));
    assert.ok(!$(el, '[data-section=aging]'), 'aging section hidden');
    assert.deepEqual($$(el, '.doc-section').map((s) => s.dataset.section).slice(0, 3), ['activity', 'intro', 'summary']);
    assert.match($(el, '[data-section=activity] .section-title').textContent, /Transactions/);
  });

  test('unknown account', () => {
    const el = mount('account-statement', { 'account-key': 'nobody', currency: 'BHD' });
    assert.match(text(el), /Account not found/);
  });
});

describe('<account-overview>', () => {
  test('lists balances and switches to the category view', async () => {
    await store.add(bhdInvoice);
    const el = mount('account-overview');
    assert.match($(el, 'td.acc').textContent, /Gulf Hospitality/);
    assert.match($(el, 'td.bal').textContent, /1,100[.,]000|1100[.,]000/);
    $(el, '[data-view=categories]').click();
    const cats = $$(el, 'tbody td.acc').map((td) => td.textContent.trim());
    assert.deepEqual(cats, ['Uncategorised', 'Maintenance', 'Tax']);
  });
});

describe('<payment-dialog>', () => {
  test('pre-fills BHD with 3 decimals and saves what was typed', async () => {
    const el = mount('payment-dialog');
    el.open({ account: 'Gulf Hospitality Co. B.S.C.', currency: 'BHD', amount: 550 });
    const form = $(el, 'form');
    assert.equal(form.amount.value, '550.000');
    form.amount.value = '7.250';
    form.requestSubmit();
    await eventually(() => {
      const p = store.transactions.find((t) => t.kind === 'payment');
      assert.equal(p?.amount, 7.25);
      assert.equal(p.currency, 'BHD');
    });
  });
});

describe('<settings-dialog>', () => {
  test('saving rules categorises existing lines', async () => {
    const t = await store.add(bhdInvoice);
    const el = mount('settings-dialog');
    el.open();
    const form = $(el, 'form');
    form.categoryRules.value = 'Parts: compressor, parts';
    form.defaultCurrency.value = 'BHD';
    form.requestSubmit();
    await eventually(() => {
      assert.equal(store.settings.defaultCurrency, 'BHD');
      assert.equal(store.get(t.id).lines[1].category, 'Parts');
    });
  });
});

describe('<template-editor>', () => {
  const doc = (el) => $(el, '.preview-doc');

  test('previews sample data before anything is imported', () => {
    const el = mount('template-editor');
    assert.match($(el, '[data-action=preview-account]').textContent, /Sample customer/);
    assert.match(doc(el).textContent, /Sample Customer Ltd/);
  });

  test('typing updates the preview live and saves to the template', async () => {
    await store.add(bhdInvoice);
    const el = mount('template-editor');
    const title = $(el, '[data-path=title]');
    title.focus();
    title.value = 'Account Statement for {customer}';
    title.dispatchEvent(new Event('input'));
    assert.equal(doc(el).querySelector('h1').textContent, 'Account Statement for Gulf Hospitality Co. B.S.C.');
    await eventually(() => assert.equal(store.template.title, 'Account Statement for {customer}'));
    // Compare strings/booleans, never DOM nodes: a failing assert on a node makes
    // node:assert inspect the whole happy-dom window and run out of memory.
    assert.ok(document.activeElement === el, 'focus stays inside the editor');
    assert.equal(shadow(el).activeElement?.dataset.path, 'title', 'focus stays in the title field');
  });

  test('placeholder chips insert at the cursor', async () => {
    const el = mount('template-editor');
    const intro = $(el, '[data-path=intro]');
    intro.value = 'Dear , thanks.';
    intro.dispatchEvent(new Event('focus'));
    intro.setSelectionRange(5, 5);
    $(el, '[data-insert="{customer}"]').click();
    assert.equal($(el, '[data-path=intro]').value, 'Dear {customer}, thanks.');
    await eventually(() => assert.equal(store.template.intro, 'Dear {customer}, thanks.'));
  });

  test('hide a section, reorder, and hide/rename a column', async () => {
    await store.add(bhdInvoice);
    const el = mount('template-editor');

    const aging = $(el, '[data-path="sections.aging.visible"]');
    aging.checked = false;
    aging.dispatchEvent(new Event('change'));
    assert.ok(!doc(el).querySelector('[data-section=aging]'), 'aging section hidden');

    $(el, '[data-move=footer][data-delta="-1"]').click();
    const order = $$(el, '.sec').map((s) => s.dataset.section);
    assert.deepEqual(order.slice(-2), ['footer', 'aging']);

    $(el, '[data-expand=activity]').click();
    const status = $(el, '[data-path="sections.activity.columns.status.visible"]');
    status.checked = false;
    status.dispatchEvent(new Event('change'));
    const balance = $(el, '[data-path="sections.activity.columns.balance.label"]');
    balance.value = 'Running total';
    balance.dispatchEvent(new Event('input'));
    const heads = [...doc(el).querySelectorAll('.ledger th')].map((th) => th.textContent);
    assert.ok(!heads.includes('Status'));
    assert.ok(heads.includes('Running total'));

    await eventually(() => {
      const t = store.template;
      assert.equal(t.sections.find((s) => s.key === 'aging').visible, false);
      assert.deepEqual(t.sections.map((s) => s.key).slice(-2), ['footer', 'aging']);
      assert.equal(t.sections.find((s) => s.key === 'activity').columns.balance.label, 'Running total');
    });
  });

  test('branding: accent swatch and fonts', async () => {
    const el = mount('template-editor');
    $(el, '[data-accent="#1d4e89"]').click();
    assert.match(doc(el).querySelector('.paper').getAttribute('style'), /--doc-accent:#1d4e89/);
    const font = $(el, '[data-path="branding.headingFont"]');
    font.value = 'arabic';
    font.dispatchEvent(new Event('change'));
    assert.match(doc(el).querySelector('.paper').getAttribute('style'), /Noto Naskh Arabic/);
    await eventually(() => {
      assert.equal(store.template.branding.accent, '#1d4e89');
      assert.equal(store.template.branding.headingFont, 'arabic');
    });
  });

  test('reset restores the defaults', async () => {
    await store.saveTemplate({ ...store.template, title: 'Custom' });
    const el = mount('template-editor');
    // happy-dom has no window.confirm, so stub the global rather than spying on it.
    vi.stubGlobal('confirm', () => true);
    $(el, '[data-action=reset]').click();
    vi.unstubAllGlobals();
    assert.equal(doc(el).querySelector('h1').textContent, 'Statement of Account');
    await eventually(() => assert.equal(store.template.title, 'Statement of Account'));
  });
});

describe('<invoice-upload>', () => {
  const invoice = [
    'Al Noor Trading W.L.L.',
    'Invoice No: ANT/2026/0600      Invoice Date: 05/11/2026',
    'Bill To:',
    'Gulf Hospitality Co. B.S.C.',
    'Description        Amount',
    'Duct cleaning      80.000',
    'VAT 10%             8.000',
    'Total BHD      BD 88.000',
  ].join('\n');

  test('imports a dropped text invoice and reports the duplicate', async () => {
    const el = mount('invoice-upload');
    el.add([new File([invoice], 'ant-0600.txt', { type: 'text/plain' })]);
    await eventually(() => assert.match($(el, 'li').textContent, /Read ANT\/2026\/0600/));
    assert.equal(store.transactions[0].amount, 88);
    assert.equal(store.transactions[0].currency, 'BHD');

    el.add([new File([invoice], 'again.txt', { type: 'text/plain' })]);
    await eventually(() => assert.match($(el, 'li').textContent, /Already imported as ANT\/2026\/0600/));
    assert.equal(store.transactions.length, 1);
  });

  test('reports files it cannot read', async () => {
    const el = mount('invoice-upload');
    el.add([new File(['x'], 'data.xlsx', { type: 'application/vnd.ms-excel' })]);
    await eventually(() => assert.match($(el, 'li .pill.danger')?.textContent ?? '', /Unsupported file type/));
  });
});

describe('<zoho-import>', () => {
  afterEach(() => { sessionStorage.clear(); vi.unstubAllGlobals(); });

  test('first use: walks through registering a client, then offers to connect', async () => {
    const el = mount('zoho-import');
    el.open();
    assert.match(text(el), /Client-based Applications/);
    assert.match(text(el), new RegExp(`Authorized redirect URI.*${location.origin}`));
    $(el, '[data-action=save-setup]').click();
    await eventually(() => assert.match($(el, '.error')?.textContent ?? '', /Choose your Zoho region/));

    $(el, '[name=region]').value = 'ae';
    $(el, '[name=clientId]').value = ' 1000.ABC ';
    $(el, '[data-action=save-setup]').click();
    await eventually(() => assert.ok($(el, '[data-action=connect]'), 'connect button shown'));
    assert.equal(store.settings.zohoRegion, 'ae');
    assert.equal(store.settings.zohoClientId, '1000.ABC');
    assert.match(text(el), /Not connected · United Arab Emirates/);
  });

  test('signed in: lists organisations and imports invoices', async () => {
    await store.saveSettings({ zohoRegion: 'ae', zohoClientId: '1000.ABC', zohoTypes: ['invoices'] });
    sessionStorage.setItem('invoice-soa:zoho-session', JSON.stringify({ token: 'tok', apiDomain: 'https://www.zohoapis.ae', region: 'ae', expiresAt: Date.now() + 3e6 }));
    const invoice = {
      invoice_id: '46', invoice_number: 'INV-1', status: 'sent', date: '2026-10-15', due_date: '2026-11-14', customer_name: 'Gulf Hospitality Co. B.S.C.',
      currency_code: 'BHD', total: 110, last_modified_time: 't1', line_items: [{ name: 'Servicing', quantity: 1, rate: 100, item_total: 100 }], taxes: [{ tax_name: 'VAT', tax_amount: 10 }],
    };
    const ok = (body) => ({ status: 200, ok: true, json: async () => ({ code: 0, ...body }) });
    vi.stubGlobal('fetch', async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/organizations')) return ok({ organizations: [{ organization_id: '777', name: 'Al Noor Trading', currency_code: 'BHD' }] });
      if (path.endsWith('/invoices')) return ok({ invoices: [invoice], page_context: { has_more_page: false } });
      if (path.endsWith('/invoices/46')) return ok({ invoice });
      return { status: 404, ok: false, json: async () => ({ code: 5, message: 'Not found' }) };
    });

    const el = mount('zoho-import');
    el.open();
    await eventually(() => assert.match($(el, '[name=org]').textContent, /Al Noor Trading \(BHD\)/));
    $(el, '[name=from]').value = '2026-01-01';
    $(el, '[data-action=import]').click();
    await vi.waitFor(() => assert.match($(el, '.result')?.textContent ?? '', /Imported 1 new document/), { timeout: 5000, interval: 20 });
    const t = store.transactions[0];
    assert.equal(t.amount, 110);
    assert.equal(t.external.id, '46');
    assert.deepEqual(t.lines.map((l) => l.amount), [100, 10]);
    assert.equal(store.settings.zohoOrgId, '777');
    assert.equal(store.settings.zohoFrom, '2026-01-01');
  });

  test('region and client ID can be set in Settings; changing them signs out of Zoho', async () => {
    await store.saveSettings({ zohoRegion: 'ae', zohoClientId: '1000.OLD' });
    sessionStorage.setItem('invoice-soa:zoho-session', JSON.stringify({ token: 'tok', apiDomain: 'https://www.zohoapis.ae', region: 'ae', expiresAt: Date.now() + 3e6 }));
    const el = mount('settings-dialog');
    el.open();
    const form = $(el, 'form');
    assert.equal(form.zohoRegion.value, 'ae');
    assert.equal(form.zohoClientId.value, '1000.OLD');
    assert.match($(el, '[data-zoho-console]').getAttribute('href'), /api-console\.zoho\.ae/);
    assert.match(text(el), new RegExp(`redirect URI ${location.origin}`));

    change(form.zohoRegion, 'sa');
    assert.match($(el, '[data-zoho-console]').getAttribute('href'), /api-console\.zoho\.sa/);
    form.zohoClientId.value = ' 1000.NEW ';
    form.requestSubmit();
    await eventually(() => {
      assert.equal(store.settings.zohoRegion, 'sa');
      assert.equal(store.settings.zohoClientId, '1000.NEW');
    });
    assert.equal(sessionStorage.getItem('invoice-soa:zoho-session'), null);

    // The import dialog picks up the new settings.
    const zi = mount('zoho-import');
    zi.open();
    assert.match(text(zi), /Not connected · Saudi Arabia/);
  });

  test('saving Settings without touching Zoho keeps the Zoho sign-in', async () => {
    await store.saveSettings({ zohoRegion: 'ae', zohoClientId: '1000.ABC' });
    sessionStorage.setItem('invoice-soa:zoho-session', JSON.stringify({ token: 'tok', apiDomain: 'https://www.zohoapis.ae', region: 'ae', expiresAt: Date.now() + 3e6 }));
    const el = mount('settings-dialog');
    el.open();
    $(el, 'form').companyName.value = 'Renamed W.L.L.';
    $(el, 'form').requestSubmit();
    await eventually(() => assert.equal(store.settings.companyName, 'Renamed W.L.L.'));
    assert.ok(sessionStorage.getItem('invoice-soa:zoho-session'), 'still signed in');
  });

  test('imported rows are labelled and link to Zoho Books', async () => {
    await store.add({ ...bhdInvoice, source: undefined, reviewed: true, external: { system: 'zoho', type: 'invoices', id: '46', orgId: '777', region: 'ae' } });
    const el = mount('transaction-table');
    assert.match($(el, '.src').textContent, /Zoho Books/);
    assert.equal($(el, 'a[aria-label="Open in Zoho Books"]').getAttribute('href'), 'https://books.zoho.ae/app/777#/invoices/46');
    assert.ok(!$(el, '[data-action=view]'), 'no "open original file" for Zoho records');
  });
});

describe('<soa-app>', () => {
  test('routes between invoices, statements and one statement', async () => {
    await store.add(bhdInvoice);
    location.hash = '#invoices';
    const el = mount('soa-app');
    const visible = () => $$(el, '[data-view]').filter((s) => !s.hidden).map((s) => s.dataset.view);
    assert.deepEqual(visible(), ['invoices']);
    await eventually(() => assert.equal($(el, '.badge').textContent, '1', 'one invoice to review'));

    const go = (hash) => { location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); };
    go('#statements');
    assert.deepEqual(visible(), ['statements']);

    go('#statement/gulf%20hospitality%20co.%20b.s.c./BHD');
    assert.deepEqual(visible(), ['statement']);
    assert.equal($(el, 'account-statement').getAttribute('currency'), 'BHD');
    assert.equal($(el, 'account-statement').getAttribute('account-key'), 'gulf hospitality co. b.s.c.');
  });
});
