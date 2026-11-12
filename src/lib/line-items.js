// Line-item extraction from layout lines (see layout.js).
//
// 1. Find the item table header ("Description … Qty … Rate … Amount").
// 2. Each row below it with an amount in the amount column is an item; rows with
//    text but no amount continue the previous item's description.
// 3. Stop at the totals block (Subtotal / Net / Total …). Tax, discount, shipping and
//    fee lines in that block become lines too, so line totals reconcile to the invoice.
// Without a recognisable header, rows of "text … 123.45" above the totals are used.

import { findAmounts, findDate, currencyDecimals, roundTo } from './values.js';

/** @typedef {import('./layout.js').Line} Line */
/**
 * @typedef {object} LineItem
 * @property {string} description
 * @property {number|null} qty
 * @property {number|null} unitPrice
 * @property {number} amount
 * @property {string} category
 * @property {'item'|'tax'|'discount'|'charge'} type
 */

export const TAX_CATEGORY = 'Tax';

const DESC_H = /^(?:item\s+)?(?:description|items?|details|services?|products?|particulars|activity|task|work|goods)(?:\s+(?:description|of\s+(?:goods|services)))?\b/i;
const AMT_H = /^(?:line\s+)?(?:amount|total|ext(?:ended)?\.?(?:\s+(?:price|amount))?|net\s+amount|value|sum|subtotal)(?:\s*\(?[A-Z]{3}\)?)?$/i;
const QTY_H = /^(?:qty|quantity|hours|hrs|units|no\.?|days)$/i;
const PRICE_H = /^(?:rate|unit\s+price|price|unit\s+cost|each|cost|unit\s+rate|price\s+each)(?:\s*\(?[A-Z]{3}\)?)?$/i;

// A whole segment that is a totals-block label, e.g. "Subtotal", "VAT @ 20%", "Tax (0%)", "Total GBP".
const SUMMARY = /^(?:sub[\s-]?total|total(?:\s+[a-z]{2,10})?|net(?:\s+(?:total|amount))?|balance(?:\s+due)?|amount\s+(?:due|paid|payable)|(?:sales\s+)?tax|vat|gst|hst|pst|discount|less\s+discount|shipping|delivery|freight|postage|handling|surcharge|(?:service|card|late)\s+fee)\b(?:\s*(?:[@(].*|\d+(?:\.\d+)?\s*%.*|:))?\s*$/i;
const TAX = /^(?:(?:sales\s+)?tax|vat|gst|hst|pst)\b/i;
const DISCOUNT = /^(?:less\s+)?discount\b/i;
const CHARGE = /^(?:shipping|delivery|freight|postage|handling|surcharge|(?:service|card|late)\s+fee)\b/i;
const END = /^(?:total|balance(?:\s+due)?|amount\s+(?:due|payable))\b/i;
const SKIP = /^(?:sub[\s-]?total|net|amount\s+paid)\b/i;

const NUMERIC = /^[\s$€£¥₹(\-−]*(?:[A-Z]{3}\s?)?[\d][\d.,'\s]*\)?\s*(?:[A-Z]{3}|%|-|CR)?$/;
const isNumeric = (s) => NUMERIC.test(s.text) || /^(?:x\s?)?\d+(?:\.\d+)?\s*(?:hrs?|hours?|days?|units?|pcs)?$/i.test(s.text);
const overlaps = (s, col) => col && s.x0 < col.x1 + 6 && s.x1 > col.x0 - 6;

/**
 * @param {Line[]} lines
 * @param {{total?: number|null}} [opts]
 * @returns {{items: LineItem[], reconciled: boolean}}
 */
export function parseLineItems(lines, { total = null, currency = '' } = {}) {
  const decimals = currencyDecimals(currency);
  ctx = { decimals };
  const header = findHeader(lines);
  let items = header ? rowsBelowHeader(lines, header) : fallbackRows(lines);
  const startOfTotals = items.endIndex;
  items = items.items;

  const adjustments = totalsBlock(lines, startOfTotals);
  const all = [...items, ...adjustments].filter((l) => l.amount !== 0 || l.description);
  const sum = round(all.reduce((s, l) => s + l.amount, 0));
  return { items: all, reconciled: total != null && Math.abs(sum - total) < 0.5 * 10 ** -decimals };
}

function findHeader(lines) {
  for (let i = 0; i < lines.length; i++) {
    const segs = lines[i].segments;
    const desc = segs.find((s) => DESC_H.test(s.text));
    if (!desc) continue;
    const amountCols = segs.filter((s) => s.x0 > desc.x0 && AMT_H.test(s.text));
    if (!amountCols.length) continue;
    return {
      index: i,
      page: lines[i].page,
      desc,
      amount: amountCols.at(-1),
      qty: segs.find((s) => s.x0 > desc.x0 && QTY_H.test(s.text)),
      price: segs.find((s) => s.x0 > desc.x0 && PRICE_H.test(s.text)),
    };
  }
  return null;
}

function rowsBelowHeader(lines, h) {
  const items = [];
  let i = h.index + 1;
  for (; i < lines.length; i++) {
    const segs = lines[i].segments;
    if (segs.some((s) => SUMMARY.test(s.text))) break;
    // A repeated header on a later page: skip it.
    if (segs.some((s) => DESC_H.test(s.text)) && segs.some((s) => AMT_H.test(s.text))) continue;

    const amountSeg = [...segs].reverse().find((s) => isNumeric(s) && (overlaps(s, h.amount) || s.x0 > h.amount.x0 - 40));
    const amount = amountSeg ? lastAmount(amountSeg.text) : null;
    const textSegs = segs.filter((s) => s !== amountSeg && !isNumeric(s));
    const description = textSegs.map((s) => s.text).join(' ').trim();

    if (amount == null) {
      if (!description) continue;
      // Wrapped description, or notes after the table.
      const prev = items.at(-1);
      if (prev && lines[i].page === lines[i - 1].page && lines[i].y - lines[i - 1].y < lines[i].height * 2.2) {
        prev.description = `${prev.description} ${description}`.trim();
        continue;
      }
      if (items.length) break; // a gap then free text: the table has ended
      continue;
    }
    const num = (col) => {
      const s = col && segs.find((x) => x !== amountSeg && isNumeric(x) && overlaps(x, col));
      return s ? lastAmount(s.text) : null;
    };
    items.push(item(description || '(no description)', amount, num(h.qty), num(h.price)));
  }
  return { items, endIndex: i };
}

function fallbackRows(lines) {
  let end = lines.findIndex((l) => l.segments.some((s) => SUMMARY.test(s.text)));
  if (end < 0) end = lines.length;
  const items = [];
  for (let i = 0; i < end; i++) {
    const segs = lines[i].segments;
    if (findDate(lines[i].text)) continue;
    const last = segs.at(-1);
    if (segs.length < 2 || !isNumeric(last)) continue;
    const amt = findAmounts(last.text, ctx).at(-1);
    if (!amt || !amt.hasDecimals) continue;
    const textSegs = segs.filter((s) => !isNumeric(s));
    if (!textSegs.length) continue;
    const description = textSegs.map((s) => s.text).join(' ');
    if (/[:#]\s*$|\b(?:invoice|inv|account|acct|abn|vat\s+reg|phone|tel)\b/i.test(textSegs[0].text)) continue;
    if (/^(?:amount|total|balance|price|sum|value)\b/i.test(description)) continue;
    const nums = segs.filter((s) => s !== last && isNumeric(s));
    let qty = null, unitPrice = null;
    if (nums.length >= 2) { qty = lastAmount(nums[0].text); unitPrice = lastAmount(nums.at(-1).text); }
    else if (nums.length === 1) {
      if (/[.,]\d{2,3}\b/.test(nums[0].text)) unitPrice = lastAmount(nums[0].text);
      else qty = lastAmount(nums[0].text);
    }
    items.push(item(description, amt.value, qty, unitPrice));
  }
  return { items, endIndex: end };
}

function totalsBlock(lines, start) {
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const segs = lines[i].segments;
    const labelIdx = segs.findIndex((s) => SUMMARY.test(s.text));
    if (labelIdx < 0) continue;
    const label = segs[labelIdx].text;
    if (END.test(label)) break;
    if (SKIP.test(label)) continue;
    const amount = lastAmount(segs.slice(labelIdx).map((s) => s.text).join('   '));
    if (amount == null || amount === 0) continue;
    if (TAX.test(label)) out.push({ ...item(label, amount), type: 'tax', category: TAX_CATEGORY });
    else if (DISCOUNT.test(label)) out.push({ ...item(label, -Math.abs(amount)), type: 'discount' });
    else if (CHARGE.test(label)) out.push({ ...item(label, amount), type: 'charge' });
  }
  return out;
}

// Decimal places for the invoice being parsed (set by parseLineItems; parsing is synchronous).
let ctx = { decimals: 2 };

function lastAmount(text) {
  const a = findAmounts(text, ctx).at(-1);
  return a ? a.value : null;
}

function item(description, amount, qty = null, unitPrice = null) {
  return { description: description.replace(/\s+/g, ' ').trim(), qty, unitPrice, amount: round(amount), category: '', type: 'item' };
}

const round = (n) => roundTo(n, ctx.decimals);
