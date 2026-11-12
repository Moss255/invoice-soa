import { test } from 'vitest';
import assert from 'node:assert/strict';
import { buildLines, linesFromText } from '../src/lib/layout.js';
import { parseInvoice } from '../src/lib/parse-invoice.js';
import { parseLineItems } from '../src/lib/line-items.js';
import { categorize, parseRules, normDesc } from '../src/lib/categories.js';
import { buildStatement, invoiceParts, distribute, summariseCategories } from '../src/lib/statement.js';
import { SAMPLES, sampleItems } from './make-pdf.js';

test('line items: table with wrapped description, discount, fee and tax', () => {
  const sample = SAMPLES.find((s) => s.expectLines);
  const lines = buildLines(sampleItems(sample));
  const { amount } = parseInvoice(lines);
  const { items, reconciled } = parseLineItems(lines, { total: amount });
  assert.deepEqual(items.map((l) => [l.description, l.amount]), sample.expectLines);
  assert.equal(items.find((l) => l.type === 'tax').category, 'Tax');
  assert.equal(items[1].qty, 10);
  assert.equal(items[1].unitPrice, 85);
  assert.ok(reconciled);
});

test('line items: simple tables reconcile to the total', () => {
  for (const name of ['northwind-1042.pdf', 'acme-uk-77.pdf']) {
    const lines = buildLines(sampleItems(SAMPLES.find((s) => s.name === name)));
    const { amount } = parseInvoice(lines);
    assert.ok(parseLineItems(lines, { total: amount }).reconciled, name);
  }
});

test('categorize: learned choices beat keyword rules', () => {
  const rules = parseRules('Hosting: hosting, domain, server\nSupport: support, retainer\nbad line');
  assert.equal(rules.length, 2);
  assert.equal(categorize('Website hosting (annual)', { rules }), 'Hosting');
  assert.equal(categorize('Domain renewal', { rules }), 'Hosting');
  assert.equal(categorize('Support retainer - Sept', { rules }), 'Support');
  assert.equal(categorize('Something else', { rules }), '');
  const learned = { [normDesc('Support retainer - Oct 2026')]: 'Retainers' };
  assert.equal(categorize('Support retainer - Oct 2026', { rules, learned }), 'Retainers');
});

test('distribute always adds up', () => {
  assert.deepEqual(distribute(100, [1, 1, 1]), [34, 33, 33]);
  assert.equal(distribute(9999, [3, 7, 11]).reduce((a, b) => a + b), 9999);
});

test('invoice parts: discount netted, difference surfaced', () => {
  const parts = invoiceParts({ amount: 1450, lines: [
    { description: 'Hosting', category: 'Hosting', amount: 1000 },
    { description: 'Support', category: 'Support', amount: 500 },
    { description: 'Discount', category: '', amount: -150 },
  ] });
  // 1000 + 500 - 150 = 1350; 100 unexplained
  assert.deepEqual(parts.map((p) => [p.category, p.net]), [['Hosting', 90000], ['Support', 45000], ['', 0], ['Unallocated difference', 10000]]);
});

const inv = (id, date, due, amount, lines, extra = {}) => ({ id, kind: 'invoice', account: 'Contoso', currency: 'USD', number: id, date, dueDate: due, amount, lines, ...extra });

test('statement: outstanding grouped by category', () => {
  const data = [
    inv('A', '2026-07-01', '2026-07-31', 1980, [
      { description: 'Brand identity', category: 'Design', amount: 1500 },
      { description: 'Templates', category: 'Marketing', amount: 480 },
    ]),
    inv('B', '2026-10-01', '2026-10-31', 300, [{ description: 'Hosting', category: 'Hosting', amount: 300 }]),
    inv('C', '2026-11-01', '2026-12-01', 200), // no lines → Uncategorised
    { id: 'P', kind: 'payment', account: 'Contoso', currency: 'USD', date: '2026-08-15', amount: 990 },
    // A credit note against Hosting reduces Hosting, not the oldest invoice.
    { id: 'CN', kind: 'credit', account: 'Contoso', currency: 'USD', date: '2026-10-10', amount: 100, lines: [{ description: 'Outage credit', category: 'Hosting', amount: 100 }] },
  ];
  const st = buildStatement(data, { account: 'Contoso', currency: 'USD', to: '2026-11-11' });
  const by = Object.fromEntries(st.categories.rows.map((r) => [r.category, [r.invoiced, r.paid, r.outstanding, r.overdue]]));
  assert.deepEqual(by, {
    Design: [1500, 750, 750, 750],          // half of A paid, pro rata
    Marketing: [480, 240, 240, 240],
    Hosting: [300, 100, 200, 200],
    Uncategorised: [200, 0, 200, 0],       // C isn't due yet
  });
  assert.equal(st.categories.total, st.closing);
  assert.equal(st.categories.items.length, 4);
  const rows = summariseCategories(data, '2026-11-11');
  assert.deepEqual(rows.map((r) => [r.category, r.outstanding]), [['Design', 750], ['Marketing', 240], ['Hosting', 200], ['Uncategorised', 200]]);
});

test('invoice-level discount reduces items, not tax or fees', () => {
  const parts = invoiceParts({ amount: 1533.35, lines: [
    { description: 'Website hosting', category: 'Hosting', amount: 600, type: 'item' },
    { description: 'Support retainer', category: 'Support', amount: 850, type: 'item' },
    { description: 'Domain renewal', category: 'Hosting', amount: 25, type: 'item' },
    { description: 'Discount (5%)', category: '', amount: -73.75, type: 'discount' },
    { description: 'Late fee', category: '', amount: 20, type: 'charge' },
    { description: 'Sales Tax 8%', category: 'Tax', amount: 112.1, type: 'tax' },
  ] });
  assert.deepEqual(parts.map((p) => p.net / 100), [570, 807.5, 23.75, 0, 20, 112.1]);
});

test('line items without a table header: "text … amount" rows above the totals', () => {
  const lines = linesFromText([
    'Blue Fin Consulting Pty Ltd',
    'Invoice Number: BF-2026-031      Date: 01/10/2026',
    'Bill to:',
    'Harbour Foods',
    'Consulting services      12 hrs      1,440.00',
    'Travel                   2.50        80.00',
    'Subtotal                             1,520.00',
    'GST                                   152.00',
    'Total AUD                         1,672.00',
  ].join('\n'));
  const { items, reconciled } = parseLineItems(lines, { total: 1672 });
  assert.deepEqual(items.map((l) => [l.description, l.amount, l.qty, l.unitPrice, l.type]), [
    ['Consulting services', 1440, 12, null, 'item'],
    ['Travel', 80, null, 2.5, 'item'],
    ['GST', 152, null, null, 'tax'],
  ]);
  assert.ok(reconciled);
});
