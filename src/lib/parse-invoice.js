// Heuristic invoice field extraction from layout lines (see layout.js).
// Each field is located by its label, then the value is looked for (in order):
//   1. after the label in the same segment   "Invoice #: INV-042"
//   2. in the next segment on the same line  "Invoice #        INV-042"
//   3. in a segment directly below the label "Invoice #" / "INV-042"
// Anything the heuristics get wrong can be corrected in the UI.

import { findDate, parseAmount, detectCurrency, addDays, findAmounts, currencyDecimals } from './values.js';

/** @typedef {import('./layout.js').Line} Line */
/** @typedef {import('./layout.js').Segment} Segment */

/**
 * @typedef {object} ParsedInvoice
 * @property {'invoice'|'credit'} kind
 * @property {string|null} number
 * @property {string|null} date
 * @property {string|null} dueDate
 * @property {number|null} amount     always positive; `kind` carries the sign
 * @property {string} currency
 * @property {string|null} billTo
 * @property {string|null} supplier
 * @property {string|null} account    the counterparty the statement is for
 * @property {string[]} missing       required fields that could not be found
 */

const LABELS = {
  number: [
    /\b(?:tax\s+)?invoice\s*(?:no\.?|number|num\.?|#|ref(?:erence)?\.?|id)\s*[:#.]?/i,
    /\b(?:credit\s+(?:note|memo)|bill|document|receipt)\s*(?:no\.?|number|#)\s*[:#.]?/i,
    /\binv\.?\s*(?:no\.?|#)\s*[:#.]?/i,
    /^invoice\s*:?$/i,
    /^(?:invoice|reference|ref\.?|no\.?)\s*[:#]/i,
  ],
  date: [
    /\b(?:invoice|issue|issued|tax\s+point|billing|document|statement)\s+date\b\s*:?/i,
    /\bdate\s+(?:of\s+)?(?:issue|invoice)\b\s*:?/i,
    /\bdate\s+issued\b\s*:?/i,
    /\bdated\b\s*:?/i,
    /^date\b\s*:?/i,
  ],
  due: [
    /\b(?:payment\s+)?due\s+(?:date|on|by)\b\s*:?/i,
    /\bdate\s+due\b\s*:?/i,
    /\bpay(?:ment)?\s+by\b\s*:?/i,
    /\bpayment\s+due\b\s*:?/i,
    /^due\s*:?/i,
  ],
  billTo: [
    /\b(?:bill(?:ed)?|invoice[d]?|sold|charge[d]?)\s+to\b\s*:?/i,
    /\b(?:customer|client|buyer|recipient)(?:\s+name)?\b\s*:?(?!\s*(?:no|number|#|id|ref|po|vat|tax|abn)\b)/i,
    /^to\s*:/i,
    /^to$/i,
  ],
  supplier: [
    /\b(?:from|supplier|vendor|seller|issued\s+by|payable\s+to|pay\s+to|remit\s+to)\b\s*:?/i,
  ],
};

// Totals in order of preference. Within a tier the last occurrence wins (the
// summary block at the bottom of an invoice is the authoritative one).
const TOTAL_TIERS = [
  /\b(?:grand\s+total|invoice\s+total|total\s+(?:amount\s+)?(?:due|payable)|total\s+(?:inc|incl|including)\b\.?|total\s+(?:\(?(?:[A-Z]{3})\)?)\s*$|amount\s+due|balance\s+due|total\s+amount|amount\s+payable|total\s+to\s+pay)/i,
  /(?<!sub[\s-]?)\btotal\b(?!\s*(?:tax|vat|gst|excl|ex\b|before|net|discount|qty|quantity|items|hours|weight|units|paid|savings))/i,
  /\b(?:balance|amount)\b(?!\s*(?:paid|forward|brought))/i,
];

const COMPANY_SUFFIX = /\b(?:ltd|limited|llc|l\.l\.c|inc|incorporated|corp|corporation|co\.|company|plc|pty|gmbh|ag|bv|b\.v\.|sa|s\.a\.|sarl|srl|oy|ab|as|llp|lp|pte|kk|group|holdings|studio|agency|w\.?l\.?l|b\.?s\.?c|s\.?p\.?c|fze|fzco)\b\.?/i;
const NOT_A_NAME = /^(?:invoice|tax invoice|credit note|statement|receipt|quote|bill to|ship to|page \d|date|due|total|amount|description|qty|quantity|item|price|address|phone|tel|email|e-mail|www\.|https?:)/i;

/**
 * @param {Line[]} lines
 * @param {{dateOrder?:'DMY'|'MDY', defaultCurrency?:string, myCompany?:string, termsDays?:number}} [opts]
 * @returns {ParsedInvoice}
 */
export function parseInvoice(lines, opts = {}) {
  const { dateOrder = 'DMY', defaultCurrency = 'USD', myCompany = '', termsDays = 30 } = opts;
  const fullText = lines.map((l) => l.text).join('\n');
  const head = lines.slice(0, 25).map((l) => l.text).join('\n');

  const kind = /\bcredit\s*(?:note|memo)\b/i.test(head) ? 'credit' : 'invoice';

  const number = findLabeled(lines, LABELS.number, valueAsDocNumber) ?? fallbackNumber(fullText);

  const dateTest = (t) => findDate(t, { dateOrder })?.iso ?? null;
  let date = findLabeled(lines, LABELS.date, dateTest, { avoid: /\bdue\b/i });
  let dueDate = findLabeled(lines, LABELS.due, dateTest);
  if (!date) {
    // First date anywhere that isn't the due date.
    for (const l of lines) {
      const d = dateTest(l.text);
      if (d && d !== dueDate) { date = d; break; }
    }
  }
  if (!dueDate && date) {
    const terms = fullText.match(/\bnet\s*[-:]?\s*(\d{1,3})\b|\b(\d{1,3})\s*days?\b(?=[^\n]*\b(?:terms|due|payment|net)\b)|\b(?:terms|payment)[^\n]{0,30}?\b(\d{1,3})\s*days?\b/i);
    const days = terms ? Number(terms[1] || terms[2] || terms[3]) : null;
    if (/\bdue\s+(?:on|upon)\s+receipt\b/i.test(fullText)) dueDate = date;
    else dueDate = addDays(date, days ?? termsDays);
  }

  // Currency first: it decides whether "12.500" is 12.5 (BHD, 3 decimals) or 12,500.
  let currency = detectCurrency(fullText, '', defaultCurrency);
  let total = findTotal(lines, currencyDecimals(currency));
  const onTotalLine = detectCurrency(fullText, total?.lineText, defaultCurrency);
  if (onTotalLine !== currency) {
    if (currencyDecimals(onTotalLine) !== currencyDecimals(currency)) total = findTotal(lines, currencyDecimals(onTotalLine));
    currency = onTotalLine;
  }
  let amount = total?.value ?? null;
  let finalKind = kind;
  if (amount != null && amount < 0) { finalKind = 'credit'; amount = -amount; }

  const billTo = findLabeled(lines, LABELS.billTo, valueAsName, { preferBelow: true });
  const supplier = findLabeled(lines, LABELS.supplier, valueAsName, { preferBelow: true }) ?? letterhead(lines, billTo);

  let account = billTo || supplier || null;
  if (myCompany) {
    if (sameParty(billTo, myCompany)) account = supplier;
    else if (sameParty(supplier, myCompany)) account = billTo;
  }

  const result = { kind: finalKind, number, date, dueDate, amount, currency, billTo, supplier, account: account || null };
  result.missing = ['number', 'date', 'amount', 'account'].filter((k) => result[k] == null || result[k] === '');
  return result;
}

/**
 * Find the first label match across all lines and return the parsed value next to it.
 * @param {Line[]} lines
 * @param {RegExp[]} labels   tried in order of preference
 * @param {(text:string)=>any} test  returns the parsed value or null
 */
function findLabeled(lines, labels, test, { preferBelow = false, avoid = null } = {}) {
  for (const label of labels) {
    for (let i = 0; i < lines.length; i++) {
      const segs = lines[i].segments;
      for (let j = 0; j < segs.length; j++) {
        const seg = segs[j];
        const m = label.exec(seg.text);
        if (!m) continue;
        if (avoid && avoid.test(seg.text.slice(0, m.index + m[0].length))) continue;
        const rest = seg.text.slice(m.index + m[0].length).replace(/^[\s:#.\-–]+/, '');
        const sameLine = segs.slice(j + 1, j + 3).map((s) => s.text);
        const below = segmentsBelow(lines, i, seg).map((s) => s.text);
        const candidates = preferBelow
          ? [rest, ...below, ...sameLine]
          : [rest, ...sameLine, ...below];
        for (const c of candidates) {
          if (!c) continue;
          const v = test(c);
          if (v != null) return v;
        }
      }
    }
  }
  return null;
}

/** Segments on the next couple of lines that horizontally overlap `seg`. */
function segmentsBelow(lines, i, seg) {
  const out = [];
  for (let k = i + 1; k < Math.min(lines.length, i + 3); k++) {
    if (lines[k].page !== lines[i].page) break;
    const s = lines[k].segments.find((s) => s.x0 < seg.x1 + 4 && s.x1 > seg.x0 - 4);
    if (s) { out.push(s); break; }
  }
  return out;
}

function valueAsDocNumber(text) {
  const tokens = text.split(/\s+/);
  for (const raw of tokens.slice(0, 3)) {
    const t = raw.replace(/^[#:№]+|[,;:.]+$/g, '');
    if (t.length < 1 || t.length > 30) continue;
    if (!/\d/.test(t)) continue;
    if (!/^[A-Z0-9][A-Z0-9\-\/._]*$/i.test(t)) continue;
    if (findDate(t)) continue; // a date, not a number
    if (/^\d{1,3}(,\d{3})*\.\d{2,3}$/.test(t)) continue; // a money amount
    return t;
  }
  return null;
}

function fallbackNumber(text) {
  const m = text.match(/\b(?:invoice|inv)\b[^\n\d]{0,12}?([A-Z]{0,6}[-/]?\d[\w\-/]{0,20})/i);
  return m ? valueAsDocNumber(m[1]) : null;
}

function valueAsName(text) {
  const t = text.replace(/^[\s:,\-–]+|[\s,]+$/g, '');
  if (t.length < 2 || t.length > 80) return null;
  if (!/[A-Za-z]{2}/.test(t)) return null;
  if (NOT_A_NAME.test(t)) return null;
  if (/@|^\+?[\d\s()\-]{7,}$/.test(t)) return null; // email or phone
  for (const labels of Object.values(LABELS)) if (labels.some((re) => re.test(t))) return null;
  return t;
}

/** The sender's name usually sits at the top of the first page. */
function letterhead(lines, billTo) {
  const top = lines.filter((l) => l.page === lines[0]?.page).slice(0, 12);
  const names = top.flatMap((l) => l.segments.map((s) => s.text)).map(valueAsName).filter(Boolean)
    .filter((n) => !sameParty(n, billTo) && !findDate(n) && !findAmounts(n).some((a) => a.hasDecimals));
  return names.find((n) => COMPANY_SUFFIX.test(n)) ?? names[0] ?? null;
}

function findTotal(lines, decimals = 2) {
  const opts = { decimals };
  for (const tier of TOTAL_TIERS) {
    let found = null;
    for (let i = 0; i < lines.length; i++) {
      const segs = lines[i].segments;
      for (let j = 0; j < segs.length; j++) {
        const m = tier.exec(segs[j].text);
        if (!m) continue;
        // Amount after the label, in this segment or the rest of the line.
        const after = [segs[j].text.slice(m.index + m[0].length), ...segs.slice(j + 1).map((s) => s.text)].join('   ');
        let value = parseAmount(after, opts);
        // Stacked layouts: "Amount due" with the figure on the next line.
        if (value == null && tier === TOTAL_TIERS[0]) {
          const below = segmentsBelow(lines, i, segs[j])[0];
          if (below) value = parseAmount(below.text, opts);
        }
        if (value != null && value !== 0) found = { value, lineText: lines[i].text };
        else if (value === 0 && !found) found = { value, lineText: lines[i].text };
      }
    }
    if (found) return found;
  }
  // Stripe-style headline: "$120.00 due November 3, 2026"
  for (const l of lines) {
    const m = l.text.match(/^(.{0,20}?\d[\d,.]*)\s+due\b/i);
    if (m) {
      const value = parseAmount(m[1], opts);
      if (value != null) return { value, lineText: l.text };
    }
  }
  return null;
}

/** Loose comparison of company names ("Acme Ltd." == "ACME Limited"). */
export function sameParty(a, b) {
  if (!a || !b) return false;
  const norm = (s) => s.toLowerCase().replace(COMPANY_SUFFIX, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const na = norm(a), nb = norm(b);
  return Boolean(na) && (na === nb || na.startsWith(nb + ' ') || nb.startsWith(na + ' '));
}
