// Currency handling, with a focus on the Bahraini Dinar (BHD): 3 decimal places,
// 1 BHD = 1000 fils, written as "BD 12.500", "BHD 12.500" or "12.500 د.ب".
import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import {
  currencyDecimals, roundTo, toFixedFor, findAmounts, parseAmount, normaliseNumber,
  parseInputAmount, detectCurrency, CURRENCY_CODES,
} from '../src/lib/values.js';
import { buildLines, linesFromText, normaliseText } from '../src/lib/layout.js';
import { parseInvoice } from '../src/lib/parse-invoice.js';
import { parseLineItems } from '../src/lib/line-items.js';
import { buildStatement, distribute, invoiceParts, openItems } from '../src/lib/statement.js';
import { plain, amount, money } from '../src/lib/format.js';
import { SAMPLES, sampleItems } from './make-pdf.js';

const BHD_SAMPLE = SAMPLES.find((s) => s.expect.currency === 'BHD');

describe('decimal places', () => {
  test('per currency', () => {
    assert.equal(currencyDecimals('BHD'), 3);
    assert.equal(currencyDecimals('bhd'), 3);
    assert.equal(currencyDecimals('KWD'), 3);
    assert.equal(currencyDecimals('OMR'), 3);
    assert.equal(currencyDecimals('JPY'), 0);
    assert.equal(currencyDecimals('USD'), 2);
    assert.equal(currencyDecimals(''), 2);
    assert.equal(currencyDecimals(undefined), 2);
  });

  test('BHD and its Gulf neighbours are selectable', () => {
    for (const c of ['BHD', 'KWD', 'OMR', 'QAR', 'SAR', 'AED']) assert.ok(CURRENCY_CODES.includes(c), c);
  });

  test('roundTo avoids floating-point drift', () => {
    assert.equal(roundTo(1.005, 2), 1.01);
    assert.equal(roundTo(1.0005, 3), 1.001);
    assert.equal(roundTo(0.1 + 0.2, 3), 0.3);
    assert.equal(roundTo(123.4567, 0), 123);
    assert.ok(Object.is(roundTo(-0.0001, 2), 0), 'no negative zero');
  });

  test('toFixedFor', () => {
    assert.equal(toFixedFor(12.5, 'BHD'), '12.500');
    assert.equal(toFixedFor(12.5, 'USD'), '12.50');
    assert.equal(toFixedFor(1200, 'JPY'), '1200');
  });
});

describe('reading BHD amounts from invoice text', () => {
  const bhd = { decimals: 3 };

  test('three decimals are fils, not thousands', () => {
    assert.equal(parseAmount('Total BHD 12.500', bhd), 12.5);
    assert.equal(parseAmount('Total BD 1,234.500', bhd), 1234.5);
    assert.equal(parseAmount('VAT 10% 1.250', bhd), 1.25);
    assert.equal(parseAmount('Amount 0.075', bhd), 0.075);
    assert.equal(parseAmount('BD12.345', bhd), 12.345);
    assert.equal(parseAmount('Balance (25.125)', bhd), -25.125);
  });

  test('comma-grouped thousands are still thousands', () => {
    assert.equal(parseAmount('Total 1,250', bhd), 1250);
    assert.equal(parseAmount('Total 1,250,000.000', bhd), 1250000);
  });

  test('the same text in a 2-decimal currency keeps the old reading', () => {
    assert.equal(parseAmount('Total 1.250'), 1250);
    assert.equal(normaliseNumber('12.500'), 12500);
    assert.equal(normaliseNumber('12.500', 3), 12.5);
  });

  test('flags decimals and symbols', () => {
    const [a] = findAmounts('BD 12.500', bhd);
    assert.equal(a.value, 12.5);
    assert.ok(a.hasDecimals);
    assert.ok(a.hasSymbol);
  });

  test('Arabic-Indic digits and separators', () => {
    assert.equal(normaliseText('١٢٫٥٠٠'), '12.500');
    assert.equal(normaliseText('١٬٢٣٤٫٥٠٠ د.ب'), '1,234.500 د.ب');
    assert.equal(normaliseText('۱۲۳'), '123');
    const [line] = linesFromText('المجموع   ١٢٫٥٠٠ د.ب');
    assert.equal(parseAmount(line.text, bhd), 12.5);
  });
});

describe('detecting BHD', () => {
  test('code, local abbreviation, Arabic symbol and name', () => {
    assert.equal(detectCurrency('Total BHD 5.000'), 'BHD');
    assert.equal(detectCurrency('Total BD 5.000'), 'BHD');
    assert.equal(detectCurrency('المجموع 12.500 د.ب'), 'BHD');
    assert.equal(detectCurrency('Amount payable in Bahraini Dinars'), 'BHD');
  });

  test('the total line wins over the rest of the document', () => {
    assert.equal(detectCurrency('Rate card in USD\nTotal BD 10.000', 'Total BD 10.000'), 'BHD');
  });

  test('falls back to the default currency', () => {
    assert.equal(detectCurrency('Total 12.500', '', 'BHD'), 'BHD');
  });
});

describe('typed amounts', () => {
  test('a lone dot is a decimal point', () => {
    assert.equal(parseInputAmount('12.500', 'BHD'), 12.5);
    assert.equal(parseInputAmount('1.250', 'USD'), 1.25);
    assert.equal(parseInputAmount('1,234.500', 'BHD'), 1234.5);
    assert.equal(parseInputAmount('BD 7.250', 'BHD'), 7.25);
    assert.equal(parseInputAmount('-3.125', 'BHD'), -3.125);
  });

  test('blank or junk is null', () => {
    assert.equal(parseInputAmount('', 'BHD'), null);
    assert.equal(parseInputAmount('abc', 'BHD'), null);
  });
});

describe('a Bahraini invoice end to end', () => {
  const lines = buildLines(sampleItems(BHD_SAMPLE));

  test('header fields', () => {
    const p = parseInvoice(lines, { dateOrder: 'DMY' });
    assert.equal(p.currency, 'BHD');
    assert.equal(p.amount, 1100);
    assert.equal(p.number, 'ANT/2026/0412');
    assert.equal(p.account, 'Gulf Hospitality Co. B.S.C.');
    assert.equal(p.supplier, 'Al Noor Trading W.L.L.');
  });

  test('line items keep their fils and reconcile', () => {
    const { items, reconciled } = parseLineItems(lines, { total: 1100, currency: 'BHD' });
    assert.deepEqual(items.map((l) => [l.description, l.amount]), BHD_SAMPLE.expectLines);
    assert.equal(items[0].qty, 2);
    assert.equal(items[0].unitPrice, 125.5);
    assert.equal(items.at(-1).category, 'Tax');
    assert.ok(reconciled);
  });

  test('without knowing the currency, fils would be misread as thousands', () => {
    const { items } = parseLineItems(lines, { total: 1100, currency: 'USD' });
    assert.equal(items[0].amount, 251000);
  });

  test('VAT invoices issued to me make the supplier the account', () => {
    const p = parseInvoice(lines, { myCompany: 'Gulf Hospitality Co' });
    assert.equal(p.account, 'Al Noor Trading W.L.L.');
  });
});

describe('BHD statements are exact to the fil', () => {
  const inv = (id, date, amount, lines) => ({
    id, kind: 'invoice', account: 'Gulf Hospitality', currency: 'BHD', number: id, date, dueDate: date, amount, lines,
  });

  test('distribute works in fils', () => {
    // 1.000 BHD split three ways = 334 + 333 + 333 fils
    assert.deepEqual(distribute(1000, [1, 1, 1]), [334, 333, 333]);
  });

  test('invoice parts are in fils', () => {
    const parts = invoiceParts(inv('A', '2026-10-01', 12.345, [{ description: 'x', amount: 12.345 }]));
    assert.equal(parts[0].amount, 12345);
  });

  test('pro-rata payment allocation never loses a fil', () => {
    const data = [
      inv('A', '2026-09-01', 1.000, [
        { description: 'Servicing', category: 'Maintenance', amount: 0.333 },
        { description: 'Parts', category: 'Parts', amount: 0.333 },
        { description: 'Labour', category: 'Labour', amount: 0.334 },
      ]),
      { id: 'P', kind: 'payment', account: 'Gulf Hospitality', currency: 'BHD', date: '2026-09-10', amount: 0.5 },
    ];
    const { invoices } = openItems(data, '2026-11-11');
    const open = invoices[0].lines.map((l) => l.open);
    assert.equal(roundTo(open.reduce((a, b) => a + b, 0), 3), 0.5);
    for (const o of open) assert.equal(o, roundTo(o, 3), 'whole fils');

    const st = buildStatement(data, { account: 'Gulf Hospitality', currency: 'BHD', to: '2026-11-11' });
    assert.equal(st.decimals, 3);
    assert.equal(st.closing, 0.5);
    assert.equal(st.categories.total, 0.5);
    assert.equal(st.aging.total, 0.5);
  });

  test('balance-forward totals with 3-decimal amounts', () => {
    const data = [
      inv('A', '2026-08-01', 1100.125),
      inv('B', '2026-09-01', 250.250),
      { id: 'P', kind: 'payment', account: 'Gulf Hospitality', currency: 'BHD', date: '2026-09-15', amount: 333.333 },
    ];
    const st = buildStatement(data, { account: 'Gulf Hospitality', currency: 'BHD', from: '2026-09-01', to: '2026-11-11' });
    assert.equal(st.opening, 1100.125);
    assert.equal(st.closing, 1017.042);
    assert.deepEqual(st.rows.map((r) => r.balance), [1350.375, 1017.042]);
  });
});

describe('formatting', () => {
  test('BHD shows three decimals', () => {
    assert.match(plain(12.5, 'BHD'), /^12[.,٫]500$/);
    assert.match(amount(1234.5, 'BHD'), /500$/);
    assert.match(money(12.5, 'BHD'), /12[.,٫]500/);
  });

  test('USD shows two', () => {
    assert.match(plain(12.5, 'USD'), /^12[.,]50$/);
  });

  test('amount() is blank for zero, plain() is not', () => {
    assert.equal(amount(0, 'BHD'), '');
    assert.match(plain(0, 'BHD'), /^0[.,]000$/);
  });
});
