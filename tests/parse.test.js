import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseAmount, parseDate, detectCurrency, normaliseNumber } from '../src/lib/values.js';
import { buildLines, linesFromText } from '../src/lib/layout.js';
import { parseInvoice, sameParty } from '../src/lib/parse-invoice.js';
import { SAMPLES, sampleItems } from './make-pdf.js';

test('amounts', () => {
  assert.equal(parseAmount('Total $1,234.56'), 1234.56);
  assert.equal(parseAmount('Amount Due: EUR 1.234,56'), 1234.56);
  assert.equal(parseAmount('Balance (250.00)'), -250);
  assert.equal(parseAmount('Total -100.00'), -100);
  assert.equal(parseAmount('15/03/2026 Total 45.50'), 45.5);
  assert.equal(parseAmount('INV1234 total 12.00'), 12);
  assert.equal(parseAmount('Tax 10% 5.00'), 5);
  assert.equal(parseAmount('Qty 2 Rate 50.00 Amount 100.00'), 100);
  assert.equal(normaliseNumber('12,50'), 12.5);
  assert.equal(normaliseNumber('1,250'), 1250);
});

test('dates', () => {
  assert.equal(parseDate('Invoice date: 15/03/2026'), '2026-03-15');
  assert.equal(parseDate('03/04/2026', { dateOrder: 'MDY' }), '2026-03-04');
  assert.equal(parseDate('03/04/2026', { dateOrder: 'DMY' }), '2026-04-03');
  assert.equal(parseDate('03/15/2026', { dateOrder: 'DMY' }), '2026-03-15'); // unambiguous
  assert.equal(parseDate('March 5, 2026'), '2026-03-05');
  assert.equal(parseDate('5th of March 2026'), '2026-03-05');
  assert.equal(parseDate('15-Mar-26'), '2026-03-15');
  assert.equal(parseDate('2026-02-31'), null);
});

test('currency', () => {
  assert.equal(detectCurrency('Total A$100'), 'AUD');
  assert.equal(detectCurrency('€ 5'), 'EUR');
  assert.equal(detectCurrency('Total $5', '', 'AUD'), 'AUD');
  assert.equal(detectCurrency('nothing here', '', 'NZD'), 'NZD');
});

for (const sample of SAMPLES) {
  test(`parses ${sample.name}`, () => {
    const parsed = parseInvoice(buildLines(sampleItems(sample)), { dateOrder: 'DMY' });
    for (const [key, value] of Object.entries(sample.expect)) assert.equal(parsed[key], value, key);
    assert.deepEqual(parsed.missing, []);
  });
}

test('account is the party that is not me', () => {
  const lines = buildLines(sampleItems(SAMPLES[0]));
  // Uploading a bill we received: we are the customer, so the account is the supplier.
  const parsed = parseInvoice(lines, { myCompany: 'Contoso Retail' });
  assert.equal(parsed.account, 'Northwind Design Studio');
  assert.ok(sameParty('ACME Ltd.', 'Acme'));
});

test('plain text invoice with terms', () => {
  const lines = linesFromText([
    'Blue Fin Consulting Pty Ltd',
    'Invoice Number: BF-2026-031      Date: 01/10/2026',
    'Bill to:',
    'Harbour Foods',
    'Payment terms: 14 days',
    'Consulting services      12 hrs      1,440.00',
    'GST                                   144.00',
    'Total AUD                         1,584.00',
  ].join('\n'));
  const p = parseInvoice(lines, { dateOrder: 'DMY' });
  assert.equal(p.number, 'BF-2026-031');
  assert.equal(p.date, '2026-10-01');
  assert.equal(p.dueDate, '2026-10-15');
  assert.equal(p.amount, 1584);
  assert.equal(p.currency, 'AUD');
  assert.equal(p.account, 'Harbour Foods');
});
