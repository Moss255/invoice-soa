// <account-overview>: balance and aging for every account, as at today.

import { SoaElement } from './base.js';
import { html, money, date as fmtDate } from '../lib/format.js';
import { summarise, summariseCategories, BUCKETS } from '../lib/statement.js';
import { todayISO } from '../lib/values.js';

class AccountOverview extends SoaElement {
  #view = 'accounts';

  static css = `
    .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .tile { padding: 14px 16px; }
    .tile .label { font-size: 12px; color: var(--muted); font-weight: 500; }
    .tile .value { font-size: 22px; font-weight: 650; font-variant-numeric: tabular-nums; letter-spacing: -.01em; margin-top: 2px; }
    .tile .value small { display: block; font-size: 14px; font-weight: 600; }
    .tile.overdue .value { color: var(--danger); }
    .wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13.5px; min-width: 760px; }
    th { text-align: left; font-weight: 600; color: var(--muted); font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; padding: 10px 12px; border-bottom: 1px solid var(--line); background: var(--surface-2); }
    th.num { text-align: right; }
    td { padding: 11px 12px; border-bottom: 1px solid var(--line); }
    tbody tr { cursor: pointer; }
    tbody tr.static { cursor: default; }
    tbody tr:hover td { background: var(--surface-2); }
    tr:last-child td { border-bottom: 0; }
    td.acc a { color: var(--text); font-weight: 600; text-decoration: none; }
    td.acc a:hover { text-decoration: underline; }
    td.bal { font-weight: 650; }
    td.late { color: var(--danger); }
    td.zero { color: var(--faint); }
    .seg { display: inline-flex; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); overflow: hidden; }
    .seg button { border: 0; background: var(--surface); padding: 4px 12px; font-size: 13px; color: var(--muted); cursor: pointer; }
    .seg button + button { border-left: 1px solid var(--line-strong); }
    .seg button[aria-pressed=true] { background: var(--text); color: var(--bg); }
    .accs { color: var(--muted); font-size: 12.5px; max-width: 360px; }
    .accs a { color: inherit; }
    .accs a:hover { color: var(--text); }
    .head { display: flex; justify-content: space-between; align-items: baseline; padding: 14px 16px 10px; }
  `;

  render() {
    const asOf = todayISO();
    const rows = summarise(this.store.transactions, asOf);
    if (!rows.length) {
      return html`<div class="card empty"><strong>No statements yet</strong>Statements appear here once invoices have an account, date and amount.</div>`;
    }
    const byCur = new Map();
    for (const r of rows) {
      const c = byCur.get(r.currency) ?? { balance: 0, overdue: 0 };
      c.balance += r.balance; c.overdue += r.overdue;
      byCur.set(r.currency, c);
    }
    const curs = [...byCur.entries()];
    const accountsOwing = new Set(rows.filter((r) => r.balance > 0.004).map((r) => r.key)).size;

    return html`
      <div class="tiles">
        <div class="card tile"><div class="label">Outstanding</div><div class="value">${curs.map(([c, v]) => html`<small>${money(v.balance, c)}</small>`)}</div></div>
        <div class="card tile overdue"><div class="label">Overdue</div><div class="value">${curs.map(([c, v]) => html`<small>${money(v.overdue, c)}</small>`)}</div></div>
        <div class="card tile"><div class="label">Accounts with a balance</div><div class="value">${accountsOwing}<span class="muted" style="font-size:14px;font-weight:500"> of ${new Set(rows.map((r) => r.key)).size}</span></div></div>
      </div>
      <div class="card">
        <div class="head">
          <div class="seg" role="group" aria-label="Group by">
            <button data-view="accounts" aria-pressed="${this.#view === 'accounts'}">By account</button>
            <button data-view="categories" aria-pressed="${this.#view === 'categories'}">By category</button>
          </div>
          <span class="muted" style="font-size:12.5px">${this.#view === 'accounts' ? `Aged as at ${fmtDate(asOf)} · click an account for its statement` : `Outstanding as at ${fmtDate(asOf)}, from invoice line items`}</span>
        </div>
        ${this.#view === 'categories' ? this.#categories(asOf, rows) : html`
        <div class="wrap">
          <table>
            <thead><tr>
              <th>Account</th><th>Cur.</th><th class="num">Balance</th>
              ${BUCKETS.map((b) => html`<th class="num">${b.label}</th>`)}
              <th class="num">Last activity</th>
            </tr></thead>
            <tbody>
              ${rows.map((r) => html`
                <tr data-href="#statement/${encodeURIComponent(r.key)}/${r.currency}">
                  <td class="acc"><a href="#statement/${encodeURIComponent(r.key)}/${r.currency}">${r.account}</a></td>
                  <td class="muted">${r.currency}</td>
                  <td class="num bal">${money(r.balance, r.currency)}</td>
                  ${BUCKETS.map((b) => {
                    const v = r.aging[b.key];
                    return html`<td class="num ${!v ? 'zero' : b.key !== 'current' ? 'late' : ''}">${v ? money(v, r.currency) : '–'}</td>`;
                  })}
                  <td class="num muted">${fmtDate(r.lastDate)}</td>
                </tr>`)}
            </tbody>
          </table>
        </div>`}
      </div>`;
  }

  #categories(asOf, accountRows) {
    const rows = summariseCategories(this.store.transactions, asOf);
    if (!rows.length) return html`<div class="empty">Nothing outstanding.</div>`;
    const keyOf = new Map(accountRows.map((r) => [r.account, r.key]));
    return html`
      <div class="wrap">
        <table>
          <thead><tr><th>Category</th><th>Cur.</th><th class="num">Outstanding</th><th class="num">Overdue</th><th>Owed by</th></tr></thead>
          <tbody>
            ${rows.map((r) => html`<tr class="static">
              <td class="acc"><strong>${r.category}</strong></td>
              <td class="muted">${r.currency}</td>
              <td class="num bal">${money(r.outstanding, r.currency)}</td>
              <td class="num ${r.overdue ? 'late' : 'zero'}">${r.overdue ? money(r.overdue, r.currency) : '–'}</td>
              <td class="accs">${r.accounts.map((a, i) => html`${i ? ', ' : ''}<a href="#statement/${encodeURIComponent(keyOf.get(a) ?? a.toLowerCase())}/${r.currency}">${a}</a>`)}</td>
            </tr>`)}
          </tbody>
        </table>
      </div>`;
  }

  afterRender() {
    this.$$('[data-view]').forEach((b) => b.addEventListener('click', () => { this.#view = b.dataset.view; this.update(); }));
    this.$$('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      location.hash = tr.dataset.href;
    }));
  }
}

customElements.define('account-overview', AccountOverview);
