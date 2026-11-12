// <payment-dialog>: record a payment (or a manual credit/invoice) against an account.
// Call `open({account, currency, amount})`.

import { SoaElement, icon } from './base.js';
import { html } from '../lib/format.js';
import { parseInputAmount, todayISO, CURRENCY_CODES, addDays, toFixedFor } from '../lib/values.js';
import { listAccounts } from '../lib/statement.js';

class PaymentDialog extends SoaElement {
  static subscribe = false;
  static css = `
    dialog { border: 0; border-radius: var(--radius); padding: 0; width: min(460px, calc(100vw - 32px)); background: var(--surface); color: var(--text); box-shadow: 0 20px 60px rgb(0 0 0 / 30%); }
    dialog::backdrop { background: rgb(10 14 20 / 45%); }
    form { display: grid; gap: 14px; padding: 20px; }
    .head { display: flex; justify-content: space-between; align-items: center; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
    .seg { display: flex; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); overflow: hidden; }
    .seg label { flex: 1; text-align: center; padding: 6px 4px; cursor: pointer; font-size: 13px; color: var(--muted); }
    .seg input { position: absolute; opacity: 0; pointer-events: none; }
    .seg label:has(input:checked) { background: var(--accent); color: var(--accent-ink); font-weight: 600; }
    .seg label:has(input:focus-visible) { outline: 2px solid var(--focus); outline-offset: -2px; }
  `;

  #preset = {};

  render() {
    const p = this.#preset;
    const accounts = listAccounts(this.store.transactions).map((a) => a.name);
    const currency = p.currency || this.store.settings.defaultCurrency;
    return html`
      <dialog>
        <form method="dialog">
          <div class="head"><h2>Record a transaction</h2><button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
          <div class="seg" role="radiogroup" aria-label="Type">
            <label><input type="radio" name="kind" value="payment" checked> Payment received</label>
            <label><input type="radio" name="kind" value="credit"> Credit note</label>
            <label><input type="radio" name="kind" value="invoice"> Invoice</label>
          </div>
          <label class="field">Account
            <input name="account" list="pd-accounts" required value="${p.account ?? ''}" autocomplete="off">
          </label>
          <div class="row">
            <label class="field">Date <input type="date" name="date" required value="${todayISO()}"></label>
            <label class="field">Reference <input name="number" placeholder="e.g. bank ref, cheque no."></label>
          </div>
          <div class="row">
            <label class="field">Amount <input name="amount" inputmode="decimal" required placeholder="${toFixedFor(0, currency)}" value="${p.amount != null ? toFixedFor(p.amount, currency) : ''}"></label>
            <label class="field">Currency <input name="currency" list="pd-currencies" required maxlength="3" value="${currency}" style="text-transform:uppercase"></label>
          </div>
          <label class="field">Note <input name="description" placeholder="Optional"></label>
          <div class="actions">
            <button type="button" class="btn" data-close>Cancel</button>
            <button class="btn primary" value="save">Save</button>
          </div>
        </form>
        <datalist id="pd-accounts">${accounts.map((a) => html`<option value="${a}">`)}</datalist>
        <datalist id="pd-currencies">${CURRENCY_CODES.map((c) => html`<option value="${c}">`)}</datalist>
      </dialog>`;
  }

  afterRender() {
    const dialog = this.$('dialog');
    const form = this.$('form');
    this.$$('[data-close]').forEach((b) => b.addEventListener('click', () => dialog.close()));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(form));
      const amount = parseInputAmount(d.amount, d.currency.trim().toUpperCase());
      if (!amount) { form.amount.setCustomValidity('Enter an amount'); form.reportValidity(); return; }
      await this.store.add({
        kind: d.kind,
        account: d.account.trim(),
        number: d.number.trim(),
        date: d.date,
        dueDate: d.kind === 'invoice' ? addDays(d.date, Number(this.store.settings.termsDays) || 30) : '',
        amount: Math.abs(amount),
        currency: d.currency.trim().toUpperCase(),
        description: d.description.trim(),
        reviewed: true,
      });
      dialog.close();
    });
    form.amount.addEventListener('input', () => form.amount.setCustomValidity(''));
  }

  open(preset = {}) {
    this.#preset = preset;
    this.update();
    this.$('dialog').showModal();
    (preset.account ? this.$('[name=amount]') : this.$('[name=account]')).focus();
  }
}

customElements.define('payment-dialog', PaymentDialog);
