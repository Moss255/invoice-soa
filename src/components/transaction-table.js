// <transaction-table>: every invoice, credit note and payment, editable in place.
// Extraction is heuristic, so this is where the user checks and fixes values.

import { SoaElement, icon } from './base.js';
import { html, money } from '../lib/format.js';
import { parseInputAmount, CURRENCY_CODES, currencyDecimals, roundTo, toFixedFor } from '../lib/values.js';
import { isComplete, listAccounts, accountKey } from '../lib/statement.js';
import { knownCategories } from '../lib/categories.js';
import { rereadLines } from '../lib/importer.js';
import { zohoWebUrl } from '../lib/zoho.js';

const KINDS = [['invoice', 'Invoice'], ['credit', 'Credit note'], ['payment', 'Payment']];

/** Read from a file or imported from Zoho, rather than typed in. */
const imported = (t) => Boolean(t.source || t.external);
export const needsReview = (t) => !isComplete(t) || (imported(t) && !t.reviewed);

const hasLines = (t) => t.kind !== 'payment';
/** Line totals vs the invoice total, and how many lines still need a category. */
export function lineStatus(t) {
  const lines = t.lines ?? [];
  const round2 = (n) => roundTo(n, currencyDecimals(t.currency));
  const sum = round2(lines.reduce((s, l) => s + (Number(l.amount) || 0), 0));
  const diff = lines.length && t.amount != null ? round2(Number(t.amount) - sum) : 0;
  const uncategorised = lines.filter((l) => !l.category && Number(l.amount)).length;
  return { count: lines.length, sum, diff, uncategorised };
}

class TransactionTable extends SoaElement {
  static css = `
    .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .filters { display: flex; gap: 4px; flex-wrap: wrap; }
    .chip {
      border: 1px solid var(--line); background: var(--surface); border-radius: 999px; padding: 4px 12px;
      cursor: pointer; font-size: 13px; color: var(--muted);
    }
    .chip[aria-pressed=true] { background: var(--text); border-color: var(--text); color: var(--bg); }
    .chip .count { opacity: .7; margin-left: 4px; font-variant-numeric: tabular-nums; }
    .right { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .search { width: 200px; max-width: 100%; }
    .wrap { overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 900px; }
    th { text-align: left; font-weight: 600; color: var(--muted); font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; padding: 10px 6px; border-bottom: 1px solid var(--line); background: var(--surface-2); }
    th:first-child { padding-left: 14px; }
    td { padding: 5px 6px; border-bottom: 1px solid var(--line); vertical-align: middle; }
    td:first-child { padding-left: 14px; }
    tr:last-child td { border-bottom: 0; }
    tr.review td { background: color-mix(in srgb, var(--warn-soft) 55%, transparent); }
    td input, td select { width: 100%; padding: 4px 6px; border-color: transparent; background: transparent; }
    td input:hover, td select:hover { border-color: var(--line-strong); background: var(--surface); }
    td input.missing { border-color: var(--warn); background: var(--surface); }
    td input.amount { text-align: right; font-variant-numeric: tabular-nums; }
    td.acts { white-space: nowrap; text-align: right; padding-right: 10px; }
    .c-kind { width: 118px; } .c-acc { min-width: 180px; } .c-num { width: 130px; } .c-date { width: 140px; }
    .c-cur { width: 72px; } .c-amt { width: 120px; } .c-acts { width: 104px; } .c-flag { width: 92px; }
    .src { display: block; font-size: 11.5px; color: var(--faint); max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 7px; }
    .lines-btn {
      display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--line); background: var(--surface);
      border-radius: 999px; padding: 2px 9px; font-size: 12px; color: var(--muted); cursor: pointer; vertical-align: middle; margin-right: 4px;
    }
    .lines-btn:hover { color: var(--text); border-color: var(--line-strong); }
    .lines-btn[aria-expanded=true] { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
    .lines-btn .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--warn); }
    tr.lines-row > td { background: var(--surface-2); padding: 10px 14px 14px 40px; }
    .li-table { min-width: 0; width: 100%; font-size: 12.5px; }
    .li-table th { background: transparent; padding: 4px 6px; border-bottom: 1px solid var(--line); }
    .li-table td { padding: 2px 4px; border-bottom: 0; }
    .li-table td:first-child { padding-left: 0; }
    .li-table input { padding: 3px 6px; }
    .li-table input.num { text-align: right; font-variant-numeric: tabular-nums; }
    .li-table input.uncat { border-color: color-mix(in srgb, var(--warn) 50%, transparent); }
    .li-table .c-ldesc { width: auto; } .li-table .c-lcat { width: 190px; } .li-table .c-lqty { width: 70px; } .li-table .c-lprice { width: 110px; } .li-table .c-lamt { width: 120px; } .li-table .c-lx { width: 34px; }
    .li-foot { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 8px; margin-top: 8px; font-size: 12.5px; }
    .li-foot .btns { display: flex; gap: 6px; flex-wrap: wrap; }
    .li-foot .recon { color: var(--muted); font-variant-numeric: tabular-nums; }
    .li-foot .recon .bad { color: var(--warn); font-weight: 600; }
    .li-empty { color: var(--muted); padding: 6px 0; }
    .notice { font-size: 12.5px; color: var(--accent); }
    .foot { display: flex; justify-content: space-between; padding: 10px 14px; color: var(--muted); font-size: 12.5px; border-top: 1px solid var(--line); background: var(--surface-2); border-radius: 0 0 var(--radius) var(--radius); }
  `;

  #filter = 'all';
  #query = '';
  #expanded = new Set();
  #notice = '';
  #noticeTimer;

  render() {
    const all = this.store.transactions;
    if (!all.length) {
      return html`<div class="card empty"><strong>No invoices yet</strong>Drop some invoice PDFs above to get started, or record a payment.</div>`;
    }
    const counts = {
      all: all.length,
      review: all.filter(needsReview).length,
      invoice: all.filter((t) => t.kind === 'invoice').length,
      credit: all.filter((t) => t.kind === 'credit').length,
      payment: all.filter((t) => t.kind === 'payment').length,
      confirmable: all.filter((t) => needsReview(t) && isComplete(t)).length,
      uncat: all.filter((t) => hasLines(t) && lineStatus(t).uncategorised).length,
    };
    if (this.#filter === 'uncat' && !counts.uncat) this.#filter = 'all';
    if (this.#filter === 'review' && !counts.review) this.#filter = 'all';

    const q = this.#query.trim().toLowerCase();
    const rows = all
      .filter((t) => this.#filter === 'all'
        || (this.#filter === 'review' ? needsReview(t)
          : this.#filter === 'uncat' ? hasLines(t) && lineStatus(t).uncategorised
            : t.kind === this.#filter))
      .filter((t) => !q || [t.account, t.number, t.description, t.source?.name, t.amount, ...(t.lines ?? []).flatMap((l) => [l.description, l.category])]
        .some((v) => String(v ?? '').toLowerCase().includes(q)))
      .sort((a, b) => (b.date || '9999').localeCompare(a.date || '9999') || (b.createdAt || '').localeCompare(a.createdAt || ''));

    const dupKeys = duplicateKeys(all);
    const accounts = listAccounts(all).map((a) => a.name);
    const categories = knownCategories(all, this.store.settings);

    return html`
      <div class="bar">
        <div class="filters" role="group" aria-label="Filter">
          ${[['all', 'All'], ['review', 'Needs review'], ['uncat', 'Uncategorised lines'], ['invoice', 'Invoices'], ['credit', 'Credit notes'], ['payment', 'Payments']]
            .filter(([k]) => k === 'all' || counts[k])
            .map(([k, label]) => html`<button class="chip" data-filter="${k}" aria-pressed="${this.#filter === k}">${label}<span class="count">${counts[k]}</span></button>`)}
        </div>
        <div class="right">
          ${this.#notice ? html`<span class="notice" role="status">${this.#notice}</span>` : ''}
          <input class="search" type="search" placeholder="Search…" value="${this.#query}" data-focus-key="search" aria-label="Search transactions">
          ${counts.confirmable ? html`<button class="btn" data-action="confirm-all" title="Mark every complete row that's awaiting review as checked">${icon('check')} Confirm ${counts.confirmable} complete</button>` : ''}
          <button class="btn" data-action="payment">${icon('plus')} Record payment</button>
        </div>
      </div>
      <div class="card">
        <div class="wrap">
          <table>
            <thead><tr>
              <th class="c-flag"></th><th class="c-kind">Type</th><th class="c-acc">Account</th><th class="c-num">Number</th>
              <th class="c-date">Date</th><th class="c-date">Due</th><th class="c-cur">Cur.</th><th class="c-amt num">Amount</th><th class="c-acts"></th>
            </tr></thead>
            <tbody>
              ${rows.map((t) => this.#row(t, dupKeys))}
            </tbody>
          </table>
          ${rows.length ? '' : html`<div class="empty">Nothing matches.</div>`}
        </div>
        <div class="foot"><span>${rows.length} of ${all.length} shown</span><span>Edits save automatically</span></div>
      </div>
      <datalist id="accounts">${accounts.map((a) => html`<option value="${a}">`)}</datalist>
      <datalist id="categories">${categories.map((c) => html`<option value="${c}">`)}</datalist>
      <datalist id="currencies">${CURRENCY_CODES.map((c) => html`<option value="${c}">`)}</datalist>
    `;
  }

  #row(t, dupKeys) {
    const review = needsReview(t);
    const dup = t.number && dupKeys.has(dupKey(t));
    const f = (field) => `${t.id}:${field}`;
    const miss = (v) => (v == null || v === '' ? 'missing' : '');
    return html`
      <tr class="${review ? 'review' : ''}" data-id="${t.id}">
        <td>${review ? html`<span class="pill warn" title="${isComplete(t) ? 'Check the extracted values, then confirm' : 'Some required values are missing'}">Review</span>`
          : dup ? html`<span class="pill danger" title="Another ${t.kind} for this account has the same number">Duplicate?</span>`
          : html`<span class="pill ok">OK</span>`}</td>
        <td><select data-field="kind" data-focus-key="${f('kind')}" aria-label="Type">
          ${KINDS.map(([k, label]) => html`<option value="${k}" ${k === t.kind ? 'selected' : ''}>${label}</option>`)}
        </select></td>
        <td>
          <input data-field="account" data-focus-key="${f('account')}" list="accounts" value="${t.account}" class="${miss(t.account)}" placeholder="Account" aria-label="Account">
          ${t.source ? html`<span class="src" title="${t.source.name}">${t.source.name}</span>` : ''}
          ${t.external?.system === 'zoho' ? html`<span class="src">Zoho Books</span>` : ''}
        </td>
        <td><input data-field="number" data-focus-key="${f('number')}" value="${t.number}" placeholder="${t.kind === 'payment' ? 'Reference' : 'Number'}" aria-label="Number"></td>
        <td><input type="date" data-field="date" data-focus-key="${f('date')}" value="${t.date}" class="${miss(t.date)}" aria-label="Date"></td>
        <td>${t.kind === 'invoice'
          ? html`<input type="date" data-field="dueDate" data-focus-key="${f('dueDate')}" value="${t.dueDate}" aria-label="Due date">`
          : html`<span class="faint" style="padding:0 7px">—</span>`}</td>
        <td><input data-field="currency" data-focus-key="${f('currency')}" list="currencies" value="${t.currency}" maxlength="3" class="${miss(t.currency)}" aria-label="Currency" style="text-transform:uppercase"></td>
        <td><input class="amount ${miss(t.amount)}" inputmode="decimal" data-field="amount" data-focus-key="${f('amount')}" value="${t.amount == null ? '' : toFixedFor(t.amount, t.currency)}" placeholder="${toFixedFor(0, t.currency)}" aria-label="Amount" title="${t.amount != null ? money(t.amount, t.currency) : ''}"></td>
        <td class="acts">
          ${hasLines(t) ? this.#linesButton(t) : ''}
          ${review && isComplete(t) ? html`<button class="icon-btn" data-action="confirm" title="Values look right — confirm" aria-label="Confirm">${icon('check')}</button>` : ''}
          ${t.source ? html`<button class="icon-btn" data-action="view" title="Open original file" aria-label="Open original file">${icon('file')}</button>` : ''}
          ${zohoWebUrl(t.external) ? html`<a class="icon-btn" href="${zohoWebUrl(t.external)}" target="_blank" rel="noopener" title="Open in Zoho Books" aria-label="Open in Zoho Books">${icon('external')}</a>` : ''}
          <button class="icon-btn danger" data-action="delete" title="Delete" aria-label="Delete">${icon('trash')}</button>
        </td>
      </tr>
      ${hasLines(t) && this.#expanded.has(t.id) ? this.#linesEditor(t) : ''}`;
  }

  #linesButton(t) {
    const st = lineStatus(t);
    const problem = st.uncategorised || st.diff;
    const title = [
      `${st.count} line item${st.count === 1 ? '' : 's'}`,
      st.uncategorised ? `${st.uncategorised} without a category` : '',
      st.diff ? `lines differ from the total by ${money(st.diff, t.currency)}` : '',
    ].filter(Boolean).join(' · ');
    return html`<button class="lines-btn" data-action="lines" aria-expanded="${this.#expanded.has(t.id)}" title="${title}">
      ${problem ? html`<span class="dot"></span>` : ''}${st.count ? `${st.count} line${st.count === 1 ? '' : 's'}` : 'Lines'}</button>`;
  }

  #linesEditor(t) {
    const lines = t.lines ?? [];
    const st = lineStatus(t);
    const k = (i, field) => `${t.id}:line:${i}:${field}`;
    const num = (v) => (v == null || v === '' ? '' : Number(v));
    return html`
      <tr class="lines-row" data-id="${t.id}">
        <td colspan="9">
          ${lines.length ? html`
          <table class="li-table">
            <thead><tr>
              <th class="c-ldesc">Description</th><th class="c-lcat">Category</th>
              <th class="c-lqty num">Qty</th><th class="c-lprice num">Unit price</th><th class="c-lamt num">Amount</th><th class="c-lx"></th>
            </tr></thead>
            <tbody>
              ${lines.map((l, i) => html`<tr data-idx="${i}">
                <td><input data-line-field="description" data-focus-key="${k(i, 'description')}" value="${l.description}" aria-label="Description"></td>
                <td><input data-line-field="category" data-focus-key="${k(i, 'category')}" list="categories" value="${l.category}" placeholder="Uncategorised" class="${!l.category && Number(l.amount) ? 'uncat' : ''}" aria-label="Category"></td>
                <td><input class="num" inputmode="decimal" data-line-field="qty" data-focus-key="${k(i, 'qty')}" value="${num(l.qty)}" aria-label="Quantity"></td>
                <td><input class="num" inputmode="decimal" data-line-field="unitPrice" data-focus-key="${k(i, 'unitPrice')}" value="${l.unitPrice == null ? '' : toFixedFor(l.unitPrice, t.currency)}" aria-label="Unit price"></td>
                <td><input class="num" inputmode="decimal" data-line-field="amount" data-focus-key="${k(i, 'amount')}" value="${l.amount == null ? '' : toFixedFor(l.amount, t.currency)}" aria-label="Amount"></td>
                <td><button class="icon-btn danger" data-line-action="remove" title="Remove line" aria-label="Remove line">${icon('x')}</button></td>
              </tr>`)}
            </tbody>
          </table>` : html`<div class="li-empty">No line items were found. Add them, or the whole invoice counts as one uncategorised line.</div>`}
          <div class="li-foot">
            <div class="btns">
              <button class="btn small" data-line-action="add">${icon('plus')} Add line</button>
              ${st.diff ? html`<button class="btn small" data-line-action="diff" title="Add a line for the amount the lines don't cover">${icon('plus')} Add ${money(st.diff, t.currency)} difference</button>` : ''}
              ${t.source ? html`<button class="btn small" data-line-action="reread" title="Extract the line items from the original file again">Re-read from file</button>` : ''}
            </div>
            ${lines.length ? html`<span class="recon">Lines ${money(st.sum, t.currency)} · Invoice ${money(t.amount, t.currency)}${st.diff
              ? html` · <span class="bad">${money(st.diff, t.currency)} not covered by lines</span>` : ' · ✓ reconciled'}</span>` : ''}
          </div>
        </td>
      </tr>`;
  }

  afterRender() {
    const root = this.shadowRoot;
    root.querySelectorAll('[data-filter]').forEach((b) => b.addEventListener('click', () => { this.#filter = b.dataset.filter; this.update(); }));
    root.querySelector('.search')?.addEventListener('input', (e) => { this.#query = e.target.value; this.update(); });
    root.querySelector('[data-action=payment]')?.addEventListener('click', () => this.emit('record-payment', {}));
    root.querySelector('[data-action=confirm-all]')?.addEventListener('click', async () => {
      for (const t of this.store.transactions.filter((t) => needsReview(t) && isComplete(t))) await this.store.update(t.id, { reviewed: true });
    });

    root.querySelectorAll('[data-field]').forEach((el) => el.addEventListener('change', () => {
      const id = el.closest('tr').dataset.id;
      this.#save(id, el.dataset.field, el.value);
    }));
    root.querySelectorAll('[data-line-field]').forEach((el) => el.addEventListener('change', () => {
      const id = el.closest('tr.lines-row').dataset.id;
      this.#saveLine(id, Number(el.closest('tr[data-idx]').dataset.idx), el.dataset.lineField, el.value);
    }));
    root.querySelectorAll('[data-line-action]').forEach((btn) => btn.addEventListener('click', () => {
      const id = btn.closest('tr.lines-row').dataset.id;
      this.#lineAction(id, btn.dataset.lineAction, Number(btn.closest('tr[data-idx]')?.dataset.idx), btn);
    }));
    root.querySelectorAll('tr[data-id] [data-action]').forEach((btn) => btn.addEventListener('click', async () => {
      const id = btn.closest('tr').dataset.id;
      const t = this.store.get(id);
      if (btn.dataset.action === 'lines') {
        if (this.#expanded.has(id)) this.#expanded.delete(id); else this.#expanded.add(id);
        this.update();
      }
      if (btn.dataset.action === 'confirm') this.store.update(id, { reviewed: true });
      if (btn.dataset.action === 'delete') {
        if (confirm(`Delete ${t.kind} ${t.number || ''}${t.account ? ` for ${t.account}` : ''}?`)) this.store.remove(id);
      }
      if (btn.dataset.action === 'view') {
        const file = await this.store.getFile(t.source.fileId);
        if (!file) return alert('The original file is no longer stored.');
        const url = URL.createObjectURL(file.blob);
        window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    }));
  }

  async #saveLine(id, idx, field, value) {
    const t = this.store.get(id);
    const lines = (t.lines ?? []).map((l) => ({ ...l }));
    const line = lines[idx];
    if (!line) return;
    let v = value.trim();
    if (['qty', 'unitPrice', 'amount'].includes(field)) v = v === '' ? null : parseInputAmount(v, t.currency);
    line[field] = v;
    if ((field === 'qty' || field === 'unitPrice') && line.qty != null && line.unitPrice != null) line.amount = roundTo(line.qty * line.unitPrice, currencyDecimals(t.currency));
    await this.store.update(id, { lines, ...(imported(t) ? { reviewed: true } : {}) });
    if (field === 'category' && line.description) {
      const n = await this.store.learnCategory(line.description, v, id);
      if (n) this.#flash(`Also set ${n} other “${line.description}” line${n === 1 ? '' : 's'} to ${v}`);
    }
  }

  async #lineAction(id, action, idx, btn) {
    const t = this.store.get(id);
    const lines = (t.lines ?? []).map((l) => ({ ...l }));
    if (action === 'remove') lines.splice(idx, 1);
    if (action === 'add') lines.push({ description: '', category: '', qty: null, unitPrice: null, amount: lineStatus(t).diff || null, type: 'item' });
    if (action === 'diff') lines.push({ description: 'Other charges', category: '', qty: null, unitPrice: null, amount: lineStatus(t).diff, type: 'charge' });
    if (action === 'reread') {
      if (lines.length && !confirm('Replace these line items with the ones read from the original file?')) return;
      btn.disabled = true;
      btn.textContent = 'Reading…';
      try {
        const fresh = await rereadLines(t);
        if (!fresh.length) { this.#flash('No line items found in the file'); this.update(); return; }
        await this.store.update(id, { lines: fresh });
      } catch (err) {
        alert(err.message);
        this.update();
      }
      return;
    }
    await this.store.update(id, { lines });
    if (action === 'add' || action === 'diff') this.shadowRoot.querySelector(`[data-focus-key="${CSS.escape(`${id}:line:${lines.length - 1}:description`)}"]`)?.focus();
  }

  #flash(msg) {
    this.#notice = msg;
    this.update();
    clearTimeout(this.#noticeTimer);
    this.#noticeTimer = setTimeout(() => { this.#notice = ''; this.update(); }, 5000);
  }

  #save(id, field, value) {
    let v = value.trim();
    const t = this.store.get(id);
    if (field === 'amount') v = v === '' ? null : Math.abs(parseInputAmount(v, t.currency) ?? 0);
    if (field === 'currency') v = v.toUpperCase();
    const patch = { [field]: v };
    // Editing an extracted invoice counts as reviewing it.
    if (imported(t) && field !== 'kind') patch.reviewed = true;
    if (field === 'kind' && v !== 'invoice') patch.dueDate = '';
    if (field === 'kind' && v === 'invoice' && !t.dueDate && t.date) patch.dueDate = t.date;
    this.store.update(id, patch);
  }
}

const dupKey = (t) => `${t.kind}|${accountKey(t.account)}|${String(t.number).trim().toLowerCase()}`;
function duplicateKeys(all) {
  const seen = new Map();
  for (const t of all) if (t.number) seen.set(dupKey(t), (seen.get(dupKey(t)) || 0) + 1);
  return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
}

customElements.define('transaction-table', TransactionTable);
