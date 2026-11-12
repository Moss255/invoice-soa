import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import { buildLines, linesToText, linesFromText } from '../src/lib/layout.js';
import { html, raw, escape, toCsv, slug, date } from '../src/lib/format.js';
import { parseDate, addDays, daysBetween, stripDates } from '../src/lib/values.js';

const word = (text, x0, y, page = 1, size = 10) => ({ text, x0, x1: x0 + text.length * size * 0.5, y0: y - size, y1: y, page });

describe('buildLines', () => {
  test('groups fragments on the same row and orders them left to right', () => {
    const lines = buildLines([word('World', 60, 100), word('Hello', 30, 100), word('Below', 30, 120)]);
    assert.deepEqual(lines.map((l) => l.text), ['Hello World', 'Below']);
  });

  test('wide gaps start a new segment', () => {
    const [line] = buildLines([word('Invoice #:', 50, 100), word('INV-1', 300, 100)]);
    assert.deepEqual(line.segments.map((s) => s.text), ['Invoice #:', 'INV-1']);
    assert.ok(line.segments[1].x0 > line.segments[0].x1);
  });

  test('touching fragments join without a space', () => {
    const [line] = buildLines([{ text: 'INV-', x0: 10, x1: 30, y0: 90, y1: 100, page: 1 }, { text: '0042', x0: 30, x1: 50, y0: 90, y1: 100, page: 1 }]);
    assert.equal(line.text, 'INV-0042');
  });

  test('slightly offset baselines still count as one row', () => {
    const lines = buildLines([word('Total', 30, 100), word('$5.00', 300, 102)]);
    assert.equal(lines.length, 1);
  });

  test('pages are kept in order and blank fragments dropped', () => {
    const lines = buildLines([word('Page two', 30, 50, 2), word('Page one', 30, 500, 1), word('   ', 30, 60, 1)]);
    assert.deepEqual(lines.map((l) => [l.page, l.text]), [[1, 'Page one'], [2, 'Page two']]);
    assert.equal(linesToText(lines), 'Page one\n\nPage two\n');
  });
});

describe('linesFromText', () => {
  test('splits columns on 3+ spaces or tabs', () => {
    const [a, b] = linesFromText('Item   Total\nWidget\t9.99');
    assert.deepEqual(a.segments.map((s) => s.text), ['Item', 'Total']);
    assert.deepEqual(b.segments.map((s) => s.text), ['Widget', '9.99']);
  });

  test('drops empty lines', () => {
    assert.equal(linesFromText('a\n\n   \nb').length, 2);
  });
});

describe('html template tag', () => {
  test('escapes interpolated text (uploaded files cannot inject markup)', () => {
    const name = '<img src=x onerror=alert(1)> & "quotes"';
    assert.equal(String(html`<b>${name}</b>`), '<b>&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quotes&quot;</b>');
    assert.equal(escape("it's"), 'it&#39;s');
  });

  test('nested templates and raw() are trusted, arrays are joined', () => {
    const items = ['a', '<b>'];
    assert.equal(String(html`<ul>${items.map((i) => html`<li>${i}</li>`)}</ul>`), '<ul><li>a</li><li>&lt;b&gt;</li></ul>');
    assert.equal(String(html`${raw('<hr>')}`), '<hr>');
  });

  test('null, undefined and false render nothing; 0 renders', () => {
    assert.equal(String(html`[${null}${undefined}${false}${0}]`), '[0]');
  });
});

describe('CSV and file names', () => {
  test('quotes commas, quotes and newlines', () => {
    assert.equal(toCsv([['a', 'b,c', 'say "hi"'], ['line\nbreak', 1, null]]), 'a,"b,c","say ""hi"""\r\n"line\nbreak",1,');
  });

  test('slug', () => {
    assert.equal(slug('Gulf Hospitality Co. B.S.C.'), 'gulf-hospitality-co-b-s-c');
    assert.equal(slug('***'), 'account');
  });
});

describe('dates', () => {
  test('formats ISO dates in UTC (no off-by-one in any timezone)', () => {
    assert.match(date('2026-01-01'), /2026/);
    assert.match(date('2026-01-01'), /1/);
    assert.equal(date(''), '');
  });

  test('date arithmetic', () => {
    assert.equal(addDays('2026-01-31', 30), '2026-03-02');
    assert.equal(addDays('2026-12-25', 7), '2027-01-01');
    assert.equal(daysBetween('2026-02-01', '2026-03-01'), 28);
    assert.equal(daysBetween('2026-03-01', '2026-02-01'), -28);
  });

  test('more date formats', () => {
    assert.equal(parseDate('Dated: 1st Jan 2026'), '2026-01-01');
    assert.equal(parseDate('Sept 9, 2026'), '2026-09-09');
    assert.equal(parseDate('31.12.26'), '2026-12-31');
    assert.equal(parseDate('29/02/2027'), null); // not a leap year
    assert.equal(parseDate('no date here'), null);
    assert.equal(stripDates('Due 15/03/2026 total 45.50').includes('2026'), false);
  });
});
