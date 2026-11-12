// Statement of account maths. Pure functions over transaction records.
//
// Transaction: { id, kind: 'invoice'|'credit'|'payment', account, currency,
//                number, date, dueDate, amount (positive), description }
// Invoices increase what the account owes; credit notes and payments reduce it.
//
// Money is handled in each currency's minor units (cents, fils…) wherever it is
// split or summed, so BHD's 3 decimals and JPY's 0 stay exact.

import { daysBetween, currencyDecimals, roundTo } from './values.js';
import { UNCATEGORISED, UNALLOCATED } from './categories.js';
import { TAX_CATEGORY } from './line-items.js';

export const BUCKETS = [
  { key: 'current', label: 'Current' },
  { key: 'd30', label: '1–30 days' },
  { key: 'd60', label: '31–60 days' },
  { key: 'd90', label: '61–90 days' },
  { key: 'over90', label: '90+ days' },
];

const KIND_ORDER = { invoice: 0, credit: 1, payment: 2 };

export const signed = (t) => (t.kind === 'invoice' ? 1 : -1) * (Number(t.amount) || 0);

/** Transactions usable in statements (have the essentials filled in). */
export function isComplete(t) {
  return Boolean(t.account && t.date && Number.isFinite(Number(t.amount)) && t.currency);
}

export function sortTransactions(list) {
  return [...list].sort((a, b) =>
    a.date.localeCompare(b.date) ||
    KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
    String(a.number ?? '').localeCompare(String(b.number ?? ''), undefined, { numeric: true }));
}

export function accountKey(account) {
  return String(account ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Group complete transactions by account name (case-insensitive) and currency. */
export function listAccounts(transactions) {
  const map = new Map();
  for (const t of transactions) {
    if (!isComplete(t)) continue;
    const key = accountKey(t.account);
    if (!map.has(key)) map.set(key, { key, name: t.account.trim(), currencies: new Set() });
    map.get(key).currencies.add(t.currency);
  }
  return [...map.values()]
    .map((a) => ({ ...a, currencies: [...a.currencies].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Amount → integer minor units (e.g. 1.255 BHD → 1255 fils). */
const toMinor = (n, d) => Math.round(Number(n) * 10 ** d);
/** Decimal places for a set of same-currency transactions. */
const decimalsOf = (transactions) => currencyDecimals(transactions.find((t) => t.currency)?.currency);
const sumBy = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

/**
 * Split `total` minor units across `weights` (all >= 0) in proportion, exactly, using
 * largest remainders so the parts always add back up to the total.
 */
export function distribute(total, weights) {
  const W = sumBy(weights, (w) => w);
  if (W <= 0 || total === 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const raw = weights.map((w) => (total * w) / W);
  const base = raw.map(Math.floor);
  let rem = total - sumBy(base, (b) => b);
  const order = raw.map((r, i) => [r - base[i], i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; rem > 0; k++, rem--) base[order[k % order.length][1]]++;
  return base;
}

/**
 * An invoice's lines in minor units, reconciled to its total:
 *  - no lines → one line for the whole invoice (uncategorised)
 *  - lines that don't add up → an extra "unallocated difference" line
 *  - negative lines (discounts) are netted off the positive lines of the same
 *    category, or across all lines if none share it, so every line's `net` is >= 0.
 */
export function invoiceParts(t) {
  const d = currencyDecimals(t.currency);
  const cents = (n) => toMinor(n, d);
  const total = cents(t.amount);
  const lines = (t.lines ?? [])
    .filter((l) => Number.isFinite(Number(l.amount)) && Number(l.amount) !== 0)
    .map((l) => ({ description: l.description ?? '', category: l.category || '', type: l.type || 'item', amount: cents(l.amount) }));
  if (!lines.length) return [{ description: '', category: '', amount: total, net: total, whole: true }];
  const residual = total - sumBy(lines, (l) => l.amount);
  if (residual !== 0) lines.push({ description: 'Difference between line items and invoice total', category: UNALLOCATED, amount: residual });

  for (const l of lines) l.net = Math.max(0, l.amount);
  if (sumBy(lines, (l) => l.net) > 0) {
    for (const neg of lines.filter((l) => l.amount < 0)) {
      // Where a discount goes: lines of its own category, else the goods/services
      // lines (not tax, fees or the unexplained difference), else anything positive.
      const pools = [
        neg.category && neg.category !== UNALLOCATED ? lines.filter((l) => l.category === neg.category && l.net > 0) : [],
        lines.filter((l) => l.net > 0 && l.type === 'item' && l.category !== TAX_CATEGORY && l.category !== UNALLOCATED),
        lines.filter((l) => l.net > 0 && l.category !== UNALLOCATED),
        lines.filter((l) => l.net > 0),
      ];
      const targets = pools.find((p) => p.length && sumBy(p, (l) => l.net) >= -neg.amount) ?? pools[3];
      const take = Math.min(-neg.amount, sumBy(targets, (l) => l.net));
      distribute(take, targets.map((l) => l.net)).forEach((c, i) => { targets[i].net -= c; });
    }
  }
  return lines;
}

/**
 * Work out what is still open on each invoice (and each of its lines) as at `asOf`.
 *  - Credit-note lines with a category are applied first to open lines of the same
 *    category, oldest invoice first.
 *  - Everything else (payments, uncategorised credit) is applied to the oldest
 *    invoices first (FIFO), spread across each invoice's lines pro rata.
 */
export function openItems(transactions, asOf) {
  const d = decimalsOf(transactions);
  const cents = (n) => toMinor(n, d);
  const unit = 10 ** d;
  const txs = sortTransactions(transactions.filter((t) => t.date <= asOf));
  const invoices = txs.filter((t) => t.kind === 'invoice')
    .map((t) => ({ tx: t, lines: invoiceParts(t).map((l) => ({ ...l, open: l.net })) }));

  let pool = 0;
  for (const c of txs.filter((t) => t.kind !== 'invoice')) {
    let remaining = cents(c.amount);
    if (c.kind === 'credit') {
      for (const cl of c.lines ?? []) {
        let amt = Math.min(cents(cl.amount), remaining);
        if (!cl.category || amt <= 0) continue;
        for (const inv of invoices) {
          for (const il of inv.lines) {
            if (amt <= 0) break;
            if (il.category !== cl.category || il.open <= 0) continue;
            const take = Math.min(amt, il.open);
            il.open -= take; amt -= take; remaining -= take;
          }
        }
      }
    }
    pool += remaining;
  }
  for (const inv of invoices) {
    if (pool <= 0) break;
    const x = Math.min(pool, sumBy(inv.lines, (l) => Math.max(0, l.open)));
    distribute(x, inv.lines.map((l) => Math.max(0, l.open))).forEach((c, i) => { inv.lines[i].open -= c; });
    pool -= x;
  }

  return {
    decimals: d,
    invoices: invoices.map((inv) => ({
      tx: inv.tx,
      open: sumBy(inv.lines, (l) => l.open) / unit,
      lines: inv.lines.map((l) => ({
        description: l.description || describe(inv.tx),
        category: l.category,
        amount: l.amount / unit,
        net: l.net / unit,
        open: l.open / unit,
      })),
    })),
    unappliedCredit: pool / unit,
  };
}

const KIND_NAME = { invoice: 'Invoice', credit: 'Credit note', payment: 'Payment' };
const describe = (t) => t.description || `${KIND_NAME[t.kind]}${t.number ? ` ${t.number}` : ''}`;

/**
 * Outstanding balance grouped by line-item category, plus the open lines behind it.
 * Only invoices that still have something outstanding are included.
 */
export function categoryBreakdown({ invoices, unappliedCredit, decimals = 2 }, asOf) {
  const round = (n) => roundTo(n, decimals);
  const map = new Map();
  const items = [];
  for (const inv of invoices) {
    if (inv.open <= 0) continue;
    const late = daysBetween(inv.tx.dueDate || inv.tx.date, asOf);
    for (const l of inv.lines) {
      const category = l.category || UNCATEGORISED;
      if (!map.has(category)) map.set(category, { category, invoiced: 0, paid: 0, outstanding: 0, overdue: 0, items: 0 });
      const row = map.get(category);
      row.invoiced += l.net;
      row.outstanding += l.open;
      row.paid += l.net - l.open;
      if (late > 0) row.overdue += l.open;
      if (l.open > 0) {
        row.items++;
        items.push({ category, tx: inv.tx, description: l.description, amount: l.net, open: l.open, daysOverdue: Math.max(0, late) });
      }
    }
  }
  const rows = [...map.values()]
    .map((r) => ({ ...r, invoiced: round(r.invoiced), paid: round(r.paid), outstanding: round(r.outstanding), overdue: round(r.overdue) }))
    .filter((r) => r.invoiced || r.outstanding)
    .sort((a, b) => b.outstanding - a.outstanding || a.category.localeCompare(b.category));
  return {
    rows,
    items,
    unappliedCredit,
    total: round(sumBy(rows, (r) => r.outstanding) - unappliedCredit),
    overdue: round(sumBy(rows, (r) => r.overdue)),
  };
}

export function invoiceStatus(item, asOf) {
  const amount = Number(item.tx.amount);
  if (item.open <= 0) return 'paid';
  const overdue = daysBetween(item.tx.dueDate || item.tx.date, asOf) > 0;
  if (item.open < amount) return overdue ? 'overdue-part' : 'part-paid';
  return overdue ? 'overdue' : 'open';
}

export function aging(transactions, asOf) {
  const round = (n) => roundTo(n, decimalsOf(transactions));
  const { invoices, unappliedCredit } = openItems(transactions, asOf);
  const totals = Object.fromEntries(BUCKETS.map((b) => [b.key, 0]));
  for (const inv of invoices) {
    if (inv.open <= 0) continue;
    const late = daysBetween(inv.tx.dueDate || inv.tx.date, asOf);
    const key = late <= 0 ? 'current' : late <= 30 ? 'd30' : late <= 60 ? 'd60' : late <= 90 ? 'd90' : 'over90';
    totals[key] = round(totals[key] + inv.open);
  }
  totals.current = round(totals.current - unappliedCredit);
  totals.total = round(BUCKETS.reduce((s, b) => s + totals[b.key], 0));
  return totals;
}

/**
 * Build a balance-forward statement for one account and currency.
 * @param {object[]} transactions  all transactions
 * @param {{account:string, currency:string, from?:string, to:string}} opts
 *   `from` empty = from the beginning; `to` is the statement date.
 */
export function buildStatement(transactions, { account, currency, from = '', to }) {
  const decimals = currencyDecimals(currency);
  const round = (n) => roundTo(n, decimals);
  const key = accountKey(account);
  const mine = transactions.filter((t) => isComplete(t) && accountKey(t.account) === key && t.currency === currency);
  const upTo = mine.filter((t) => t.date <= to);

  const before = from ? upTo.filter((t) => t.date < from) : [];
  const opening = round(before.reduce((s, t) => s + signed(t), 0));

  const open = openItems(mine, to);
  const statusById = new Map(open.invoices.map((i) => [i.tx.id, { status: invoiceStatus(i, to), open: i.open, lines: i.lines }]));

  let balance = opening;
  let invoiced = 0, credited = 0;
  const rows = sortTransactions(upTo.filter((t) => !from || t.date >= from)).map((t) => {
    const s = signed(t);
    balance = round(balance + s);
    if (s > 0) invoiced = round(invoiced + s); else credited = round(credited - s);
    return {
      tx: t,
      debit: s > 0 ? s : 0,
      credit: s < 0 ? -s : 0,
      balance,
      lines: (t.lines ?? []).map((l) => ({ ...l, open: null })),
      ...(statusById.get(t.id) ?? {}),
    };
  });

  return {
    account: mine[0]?.account ?? account,
    currency, decimals, from, to,
    opening, invoiced, credited,
    closing: balance,
    rows,
    aging: aging(mine, to),
    categories: categoryBreakdown(open, to),
  };
}

/** Balance and aging for every account/currency pair, as at `asOf`. */
export function summarise(transactions, asOf) {
  const out = [];
  for (const acc of listAccounts(transactions)) {
    for (const currency of acc.currencies) {
      const mine = transactions.filter((t) => isComplete(t) && accountKey(t.account) === acc.key && t.currency === currency);
      const ag = aging(mine, asOf);
      const round = (n) => roundTo(n, currencyDecimals(currency));
      const last = sortTransactions(mine).at(-1);
      out.push({
        key: acc.key, account: acc.name, currency,
        balance: ag.total,
        overdue: round(ag.total - ag.current),
        aging: ag,
        count: mine.length,
        lastDate: last?.date ?? null,
      });
    }
  }
  return out;
}

/** Outstanding by category across all accounts (one row per category and currency). */
export function summariseCategories(transactions, asOf) {
  const out = new Map();
  for (const acc of listAccounts(transactions)) {
    for (const currency of acc.currencies) {
      const mine = transactions.filter((t) => isComplete(t) && accountKey(t.account) === acc.key && t.currency === currency);
      const round = (n) => roundTo(n, currencyDecimals(currency));
      for (const r of categoryBreakdown(openItems(mine, asOf), asOf).rows) {
        const key = `${r.category}|${currency}`;
        const row = out.get(key) ?? { category: r.category, currency, outstanding: 0, overdue: 0, accounts: new Set() };
        row.outstanding = round(row.outstanding + r.outstanding);
        row.overdue = round(row.overdue + r.overdue);
        if (r.outstanding > 0) row.accounts.add(acc.name);
        out.set(key, row);
      }
    }
  }
  return [...out.values()]
    .filter((r) => r.outstanding)
    .map((r) => ({ ...r, accounts: [...r.accounts].sort() }))
    .sort((a, b) => a.currency.localeCompare(b.currency) || b.outstanding - a.outstanding);
}
