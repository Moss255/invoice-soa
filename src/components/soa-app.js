// <soa-app>: app shell — header, tabs, hash routing, and the dialogs.
//   #invoices                       upload + review
//   #statements                     account overview
//   #statement/<account-key>/<cur>  one account's statement
//   #template                       statement template editor

import { SoaElement, icon } from './base.js';
import { html } from '../lib/format.js';
import { needsReview } from './transaction-table.js';

class SoaApp extends SoaElement {
  static subscribe = false;
  static css = `
    :host { display: block; min-height: 100vh; }
    header {
      position: sticky; top: 0; z-index: 5; background: color-mix(in srgb, var(--bg) 88%, transparent);
      backdrop-filter: blur(8px); border-bottom: 1px solid var(--line);
    }
    .bar { max-width: 1280px; margin: 0 auto; padding: 0 16px; display: flex; align-items: center; gap: 20px; height: 56px; }
    .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; letter-spacing: -.01em; white-space: nowrap; }
    .logo { width: 28px; height: 28px; border-radius: 7px; background: var(--accent); color: var(--accent-ink); display: grid; place-items: center; font-family: var(--font-doc); font-size: 15px; font-weight: 700; }
    nav { display: flex; gap: 2px; height: 100%; }
    nav a {
      display: flex; align-items: center; gap: 6px; padding: 0 12px; height: 100%;
      color: var(--muted); text-decoration: none; font-weight: 550; border-bottom: 2px solid transparent; margin-bottom: -1px;
    }
    nav a:hover { color: var(--text); }
    nav a[aria-current=page] { color: var(--text); border-bottom-color: var(--accent); }
    .badge { min-width: 18px; padding: 0 5px; border-radius: 9px; background: var(--warn-soft); color: var(--warn); font-size: 11px; font-weight: 700; text-align: center; line-height: 18px; }
    .spacer { flex: 1; }
    main { max-width: 1280px; margin: 0 auto; padding: 20px 16px 64px; }
    section.view > * + * { margin-top: 16px; }
    .intro { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
    .intro h1 { font-size: 20px; margin: 0; letter-spacing: -.01em; }
    .intro p { margin: 2px 0 0; color: var(--muted); }
    @media (max-width: 560px) { .brand span:last-child, [data-action=settings] span { display: none; } .bar { gap: 8px; } nav a { padding: 0 8px; } }
    .toast {
      position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 20;
      background: var(--text); color: var(--bg); padding: 9px 16px; border-radius: 8px; font-size: 13.5px; box-shadow: var(--shadow);
    }
    @media print {
      .toast { display: none; }
      header { display: none; }
      main { padding: 0; max-width: none; }
      .intro { display: none; }
    }
  `;

  render() {
    return html`
      <header class="no-print">
        <div class="bar">
          <div class="brand"><span class="logo">S</span><span>Statements</span></div>
          <nav>
            <a href="#invoices" data-tab="invoices">Invoices <span class="badge" hidden></span></a>
            <a href="#statements" data-tab="statements">Statements</a>
            <a href="#template" data-tab="template">Template</a>
          </nav>
          <span class="spacer"></span>
          <button class="btn ghost" data-action="settings" aria-label="Settings">${icon('settings')}<span>Settings</span></button>
        </div>
      </header>
      <main>
        <section class="view" data-view="invoices">
          <div class="intro">
            <div><h1>Invoices</h1><p>Upload invoices, check what was read, and fix anything that's off.</p></div>
            <button class="btn" data-action="zoho">${icon('cloud')} Import from Zoho Books</button>
          </div>
          <invoice-upload></invoice-upload>
          <transaction-table></transaction-table>
        </section>
        <section class="view" data-view="statements" hidden>
          <div class="intro"><div><h1>Statements</h1><p>Outstanding balances by account. Open one to print or export its statement.</p></div></div>
          <account-overview></account-overview>
        </section>
        <section class="view" data-view="statement" hidden>
          <account-statement></account-statement>
        </section>
        <section class="view" data-view="template" hidden>
          <div class="intro"><div><h1>Statement template</h1><p>Wording, sections, columns and branding used for every statement of account.</p></div></div>
          <template-editor></template-editor>
        </section>
      </main>
      <div class="toast" role="status" hidden></div>
      <payment-dialog></payment-dialog>
      <settings-dialog></settings-dialog>
      <zoho-import></zoho-import>`;
  }

  connectedCallback() {
    this.update();
    this.store.addEventListener('change', () => this.#badge());
    window.addEventListener('hashchange', () => this.#route());
    this.$('[data-action=settings]').addEventListener('click', () => this.$('settings-dialog').open());
    this.$('[data-action=zoho]').addEventListener('click', () => this.$('zoho-import').open());
    this.shadowRoot.addEventListener('record-payment', (e) => this.$('payment-dialog').open(e.detail));
    this.shadowRoot.addEventListener('toast', (e) => {
      const t = this.$('.toast');
      t.textContent = e.detail.message;
      t.hidden = false;
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
    });
    this.store.ready.then(() => {
      this.#route();
      this.#badge();
      if (!this.store.settings.companyName && !this.store.transactions.length) this.$('settings-dialog').open();
    });
    this.#route();
  }

  #route() {
    const [view, ...rest] = location.hash.replace(/^#/, '').split('/');
    const name = ['invoices', 'statements', 'statement', 'template'].includes(view) ? view : 'invoices';
    this.$$('[data-view]').forEach((s) => { s.hidden = s.dataset.view !== name; });
    const tab = name === 'statement' ? 'statements' : name;
    this.$$('[data-tab]').forEach((a) => (a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    if (name === 'statement') {
      const st = this.$('account-statement');
      st.setAttribute('currency', rest[1] ?? '');
      st.setAttribute('account-key', decodeURIComponent(rest[0] ?? ''));
    }
    window.scrollTo(0, 0);
  }

  #badge() {
    const n = this.store.transactions.filter(needsReview).length;
    const b = this.$('.badge');
    b.hidden = !n;
    b.textContent = n;
    b.title = `${n} to review`;
  }
}

customElements.define('soa-app', SoaApp);
