// <account-statement account-key="…" currency="USD">: one account's statement, drawn
// from the statement template (see statement-document.js), with print and CSV export.

import { SoaElement, icon } from './base.js';
import { html, raw, download, toCsv, slug } from '../lib/format.js';
import { buildStatement, listAccounts } from '../lib/statement.js';
import { todayISO, toFixedFor } from '../lib/values.js';
import { section, fill } from '../lib/template.js';
import { documentCss, renderStatement, placeholderValues } from './statement-document.js';

const STATUS_LABEL = { paid: 'paid', 'part-paid': 'partPaid', open: 'open', overdue: 'overdue', 'overdue-part': 'overduePart' };

class AccountStatement extends SoaElement {
  static observedAttributes = ['account-key', 'currency'];
  static css = `
    .controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; justify-content: space-between; margin-bottom: 14px; }
    .controls .left, .controls .right { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; }
    .controls select { max-width: 260px; }
    .back { color: var(--muted); text-decoration: none; display: inline-flex; align-items: center; gap: 2px; font-size: 13px; margin-bottom: 10px; }
    .back:hover { color: var(--text); }
    .back svg { width: 16px; height: 16px; }
    .toggles { display: flex; gap: 14px; align-items: center; font-size: 13px; color: var(--muted); flex-wrap: wrap; }
    .toggles label { display: inline-flex; gap: 6px; align-items: center; cursor: pointer; }
    a.btn { text-decoration: none; }
  `;

  constructor() {
    super();
    this.shadowRoot.adoptedStyleSheets = [...this.shadowRoot.adoptedStyleSheets, documentCss];
  }

  #from = '';
  #to = todayISO();

  attributeChangedCallback() { if (this.isConnected) this.update(); }

  get #params() {
    const accounts = listAccounts(this.store.transactions);
    const acc = accounts.find((a) => a.key === this.getAttribute('account-key'));
    const currency = acc?.currencies.includes(this.getAttribute('currency')) ? this.getAttribute('currency') : acc?.currencies[0];
    return { accounts, acc, currency };
  }

  render() {
    const { accounts, acc, currency } = this.#params;
    if (!acc) {
      return html`<a class="back" href="#statements">${icon('back')} All accounts</a>
        <div class="card empty"><strong>Account not found</strong>It may have been renamed or deleted.</div>`;
    }
    const st = buildStatement(this.store.transactions, { account: acc.name, currency, from: this.#from, to: this.#to });
    this._statement = st;
    const template = this.store.template;

    return html`
      <div class="no-print">
        <a class="back" href="#statements">${icon('back')} All accounts</a>
        <div class="controls">
          <div class="left">
            <label class="field">Account
              <select data-ctl="account">${accounts.map((a) => html`<option value="${a.key}" ${a.key === acc.key ? 'selected' : ''}>${a.name}</option>`)}</select>
            </label>
            ${acc.currencies.length > 1 ? html`<label class="field">Currency
              <select data-ctl="currency">${acc.currencies.map((c) => html`<option ${c === currency ? 'selected' : ''}>${c}</option>`)}</select></label>` : ''}
            <label class="field">From <input type="date" data-ctl="from" value="${this.#from}" title="Leave empty to show all history"></label>
            <label class="field">Statement date <input type="date" data-ctl="to" value="${this.#to}" required></label>
            <div class="toggles" title="These change the statement template">
              <label><input type="checkbox" data-ctl="itemise" ${section(template, 'items').visible ? 'checked' : ''}> Itemise by category</label>
              <label><input type="checkbox" data-ctl="lines" ${section(template, 'activity').showLineItems ? 'checked' : ''}> Line items in activity</label>
            </div>
          </div>
          <div class="right">
            <a class="btn" href="#template" data-action="template">${icon('settings')} Edit template</a>
            <button class="btn" data-action="payment">${icon('plus')} Record payment</button>
            <button class="btn" data-action="csv">${icon('download')} CSV</button>
            <button class="btn primary" data-action="print">${icon('print')} Print / PDF</button>
          </div>
        </div>
      </div>
      ${raw(String(renderStatement(st, this.store.settings, template)))}`;
  }

  afterRender() {
    const on = (sel, ev, fn) => this.$(sel)?.addEventListener(ev, fn);
    on('[data-ctl=account]', 'change', (e) => { location.hash = `#statement/${encodeURIComponent(e.target.value)}`; });
    on('[data-ctl=currency]', 'change', (e) => { location.hash = `#statement/${encodeURIComponent(this.getAttribute('account-key'))}/${e.target.value}`; });
    on('[data-ctl=from]', 'change', (e) => { this.#from = e.target.value; this.update(); });
    on('[data-ctl=to]', 'change', (e) => { this.#to = e.target.value || todayISO(); this.update(); });
    on('[data-ctl=itemise]', 'change', (e) => this.#setTemplate((t) => { section(t, 'items').visible = e.target.checked; }));
    on('[data-ctl=lines]', 'change', (e) => this.#setTemplate((t) => { section(t, 'activity').showLineItems = e.target.checked; }));
    on('[data-action=print]', 'click', () => window.print());
    on('[data-action=csv]', 'click', () => this.#csv());
    on('[data-action=payment]', 'click', () => {
      const st = this._statement;
      this.emit('record-payment', { account: st.account, currency: st.currency, amount: st.closing > 0 ? st.closing : null });
    });
  }

  #setTemplate(change) {
    const t = this.store.template;
    change(t);
    this.store.saveTemplate(t);
  }

  /** CSV keeps every column (it's data), but uses the template's wording. */
  #csv() {
    const st = this._statement;
    const t = this.store.template;
    const v = placeholderValues(st, this.store.settings, t);
    const L = t.labels;
    const label = (sec, key) => fill(section(t, sec).columns[key].label, v);
    const heading = (sec) => fill(section(t, sec).heading, v);
    const f = (n) => toFixedFor(n, st.currency);
    const cat = (name) => (name === 'Uncategorised' ? L.uncategorised : name);

    const rows = [
      [fill(t.title, v), st.account],
      [fill(t.header.fields.statementDate.label, v), st.to], ['From', st.from || ''], [fill(t.header.fields.currency.label, v), st.currency],
      [],
      [heading('activity')],
      [label('activity', 'date'), 'Type', 'Reference', 'Description', label('activity', 'due'), label('activity', 'charges'),
        label('activity', 'credits'), label('activity', 'balance'), label('activity', 'status')],
    ];
    if (st.from) rows.push([st.from, '', '', L.broughtForward, '', '', '', f(st.opening), '']);
    for (const r of st.rows) {
      rows.push([r.tx.date, L[r.tx.kind], r.tx.number ?? '', r.tx.description ?? '', r.tx.kind === 'invoice' ? r.tx.dueDate ?? '' : '',
        r.debit ? f(r.debit) : '', r.credit ? f(r.credit) : '', f(r.balance), r.status ? L[STATUS_LABEL[r.status]] : '']);
    }
    const c = st.categories;
    rows.push([], [heading('categories')],
      ['category', 'invoiced', 'paid', 'outstanding', 'overdue'].map((k) => label('categories', k)));
    for (const r of c.rows) rows.push([cat(r.category), f(r.invoiced), f(r.paid), f(r.outstanding), f(r.overdue)]);
    if (c.unappliedCredit) rows.push([L.unapplied, '', '', f(-c.unappliedCredit), '']);
    rows.push([L.totalOutstanding, '', '', f(c.total), f(c.overdue)]);
    rows.push([], [heading('items')],
      [label('categories', 'category'), ...['invoice', 'date', 'due', 'description', 'amount', 'outstanding', 'daysOverdue'].map((k) => label('items', k))]);
    for (const i of c.items) rows.push([cat(i.category), i.tx.number ?? '', i.tx.date, i.tx.dueDate ?? '', i.description, f(i.amount), f(i.open), i.daysOverdue]);
    const buckets = ['current', 'd30', 'd60', 'd90', 'over90', 'total'];
    rows.push([], [heading('aging')], buckets.map((k) => label('aging', k)), buckets.map((k) => f(st.aging[k])));
    download(`statement-${slug(st.account)}-${st.currency}-${st.to}.csv`, toCsv(rows), 'text/csv');
  }
}

customElements.define('account-statement', AccountStatement);
