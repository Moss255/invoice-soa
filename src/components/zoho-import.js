// <zoho-import>: connect to Zoho Books and import invoices, credit notes and payments.
// First use walks through registering a Zoho API client (the app has no backend, so
// each installation uses its own client ID).

import { SoaElement, icon } from './base.js';
import { html } from '../lib/format.js';
import { REGIONS, TYPES, consoleUrl, ZohoBooksClient, ZohoAuthError, syncZoho } from '../lib/zoho.js';
import { signIn, loadSession, clearSession, redirectUri } from '../lib/zoho-auth.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

class ZohoImport extends SoaElement {
  static subscribe = false;
  static css = `
    dialog { border: 0; border-radius: var(--radius); padding: 0; width: min(580px, calc(100vw - 32px)); max-height: calc(100vh - 32px); background: var(--surface); color: var(--text); box-shadow: 0 20px 60px rgb(0 0 0 / 30%); }
    dialog::backdrop { background: rgb(10 14 20 / 45%); }
    .content { display: grid; gap: 14px; padding: 20px; }
    .head { display: flex; justify-content: space-between; align-items: center; }
    p { margin: 0; }
    ol { margin: 0; padding-left: 20px; display: grid; gap: 8px; font-size: 13.5px; }
    code { font-family: var(--font-mono); font-size: 12.5px; background: var(--surface-2); padding: 1px 5px; border-radius: 4px; word-break: break-all; }
    .copy { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-top: 4px; }
    .hint { font-size: 12px; color: var(--faint); }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    @media (max-width: 520px) { .row { grid-template-columns: 1fr; } }
    .types { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 13.5px; }
    .types label { display: flex; gap: 6px; align-items: center; }
    .status { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; padding: 10px 12px; border-radius: var(--radius-sm); background: var(--surface-2); font-size: 13.5px; }
    .progress { font-size: 13px; color: var(--muted); min-height: 1.4em; }
    .error { color: var(--danger); background: var(--danger-soft); padding: 8px 12px; border-radius: var(--radius-sm); font-size: 13px; }
    .result { background: var(--ok-soft); padding: 10px 12px; border-radius: var(--radius-sm); font-size: 13.5px; display: grid; gap: 4px; }
    .actions { display: flex; justify-content: space-between; gap: 8px; align-items: center; flex-wrap: wrap; }
    .actions .right { display: flex; gap: 8px; margin-left: auto; }
    .spinner { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--line-strong); border-top-color: var(--accent); animation: spin .8s linear infinite; display: inline-block; vertical-align: -2px; margin-right: 6px; }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;

  #setup = false;
  #session = null;
  #orgs = null;
  #busy = false;
  #error = '';
  #result = null;

  render() {
    return html`<dialog aria-labelledby="zoho-title"><div class="content"></div></dialog>`;
  }

  afterRender() {
    this.$('dialog').addEventListener('close', () => { if (this.#busy) this.emit('toast', { message: 'Zoho import continues in the background' }); });
  }

  open() {
    const s = this.store.settings;
    this.#setup = !s.zohoClientId || !REGIONS[s.zohoRegion];
    this.#session = REGIONS[s.zohoRegion] ? loadSession(s.zohoRegion) : null;
    // Signed out (or region/client changed in Settings): the organisation list is stale.
    if (!this.#session) this.#orgs = null;
    this.#error = '';
    if (!this.#busy) this.#result = null;
    this.#paint();
    this.$('dialog').showModal();
    if (this.#session && !this.#orgs) this.#loadOrgs();
  }

  // --- Views ---------------------------------------------------------------------

  #paint() {
    const box = this.$('.content');
    box.innerHTML = String(html`
      <div class="head"><h2 id="zoho-title">Import from Zoho Books</h2><button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
      ${this.#setup ? this.#setupView() : this.#mainView()}
      ${this.#error ? html`<div class="error" role="alert">${this.#error}</div>` : ''}`);
    this.#wire();
  }

  #setupView() {
    const s = this.store.settings;
    const r = REGIONS[s.zohoRegion] ? s.zohoRegion : '';
    const origin = location.origin;
    return html`
      <p class="muted">This app runs entirely in your browser, so it connects to Zoho with a client ID you register once in Zoho's API console.</p>
      <label class="field">Zoho region
        <select name="region" required>
          <option value="" ${r ? '' : 'selected'} disabled>Choose…</option>
          ${Object.entries(REGIONS).map(([k, v]) => html`<option value="${k}" ${k === r ? 'selected' : ''}>${v.label}</option>`)}
        </select>
        <span class="hint">The domain in your Zoho Books address: books.zoho.ae is UAE, books.zoho.sa is Saudi Arabia, books.zoho.com is United States.</span>
      </label>
      <ol>
        <li>Open the <a href="${r ? consoleUrl(r) : 'https://api-console.zoho.com'}" target="_blank" rel="noopener" data-console>Zoho API console</a> for your region, choose <strong>Add client</strong>, then <strong>Client-based Applications</strong>.</li>
        <li>Enter any client name. For <strong>Homepage URL</strong> and <strong>JavaScript domain</strong> use
          <div class="copy"><code>${origin}</code><button type="button" class="btn small" data-copy="${origin}">Copy</button></div></li>
        <li>For <strong>Authorized redirect URI</strong> use
          <div class="copy"><code>${redirectUri()}</code><button type="button" class="btn small" data-copy="${redirectUri()}">Copy</button></div>
          <span class="hint">If you use the app at more than one address (for example locally and on your website), register a client for each, or add every address.</span></li>
        <li>Create it, then paste the <strong>Client ID</strong> here.</li>
      </ol>
      <label class="field">Client ID <input name="clientId" value="${s.zohoClientId}" placeholder="1000.XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" spellcheck="false" autocomplete="off"></label>
      <div class="actions"><div class="right">
        ${s.zohoClientId && REGIONS[s.zohoRegion] ? html`<button type="button" class="btn" data-action="back">Cancel</button>` : html`<button type="button" class="btn" data-close>Cancel</button>`}
        <button type="button" class="btn primary" data-action="save-setup">Save</button>
      </div></div>`;
  }

  #mainView() {
    const s = this.store.settings;
    const connected = Boolean(this.#session);
    const types = new Set(s.zohoTypes ?? Object.keys(TYPES));
    const from = s.zohoFrom || `${new Date().getFullYear() - 1}-01-01`;
    return html`
      <div class="status">
        <span>${connected ? html`<span class="pill ok">Connected</span> ${REGIONS[s.zohoRegion].label}` : html`Not connected · ${REGIONS[s.zohoRegion].label}`}</span>
        ${connected
          ? html`<button type="button" class="btn small" data-action="disconnect">Disconnect</button>`
          : html`<button type="button" class="btn primary" data-action="connect" ${this.#busy ? 'disabled' : ''}>Connect to Zoho Books</button>`}
      </div>
      ${connected ? html`
        <div class="row">
          <label class="field">Organisation
            <select name="org" ${this.#orgs ? '' : 'disabled'}>
              ${this.#orgs
                ? this.#orgs.map((o) => html`<option value="${o.organization_id}" ${String(o.organization_id) === String(s.zohoOrgId) ? 'selected' : ''}>${o.name} (${o.currency_code})</option>`)
                : html`<option>Loading…</option>`}
            </select>
          </label>
          <label class="field">Dated from <input type="date" name="from" value="${from}"></label>
        </div>
        <div class="types" role="group" aria-label="What to import">
          ${Object.entries(TYPES).map(([k, t]) => html`<label><input type="checkbox" name="types" value="${k}" ${types.has(k) ? 'checked' : ''}> ${t.label}</label>`)}
        </div>
        <p class="hint">Importing again updates anything changed in Zoho since last time and removes documents voided or deleted there. Categories you've set on lines are kept.</p>` : ''}
      <div class="progress" aria-live="polite">${this.#busy ? html`<span class="spinner"></span>Working…` : ''}</div>
      ${this.#result ? this.#resultView(this.#result) : ''}
      <div class="actions">
        <button type="button" class="btn ghost small" data-action="setup" ${this.#busy ? 'disabled' : ''}>Region &amp; client ID…</button>
        <div class="right">
          <button type="button" class="btn" data-close>Close</button>
          ${connected ? html`<button type="button" class="btn primary" data-action="import" ${this.#busy || !this.#orgs?.length ? 'disabled' : ''}>${icon('download')} Import</button>` : ''}
        </div>
      </div>`;
  }

  #resultView(c) {
    const changed = c.added + c.updated + c.removed;
    return html`<div class="result" role="status">
      <strong>${changed ? `Imported ${plural(c.added, 'new document')}, updated ${c.updated}, removed ${c.removed} voided or deleted in Zoho.` : 'Everything is already up to date.'}</strong>
      ${c.unchanged ? html`<span>${plural(c.unchanged, 'document')} unchanged since the last import.</span>` : ''}
      ${c.toReview ? html`<span>${plural(c.toReview, 'document')} with line items that don't add up to the total are marked <em>Review</em>.</span>` : ''}
      ${c.alsoUploaded ? html`<span>${plural(c.alsoUploaded, 'document')} share a number with an invoice you uploaded as a file. Check rows marked <em>Duplicate?</em> and delete the copy you don't want.</span>` : ''}
    </div>`;
  }

  #wire() {
    const box = this.$('.content');
    const on = (sel, fn) => box.querySelectorAll(sel).forEach((el) => el.addEventListener('click', fn));
    on('[data-close]', () => this.$('dialog').close());
    on('[data-copy]', async (e) => {
      const b = e.currentTarget;
      try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied'; } catch { b.textContent = 'Select and copy'; }
    });
    box.querySelector('[name=region]')?.addEventListener('change', (e) => {
      const a = box.querySelector('[data-console]');
      if (a && REGIONS[e.target.value]) a.href = consoleUrl(e.target.value);
    });
    on('[data-action=save-setup]', () => this.#saveSetup());
    on('[data-action=back]', () => { this.#setup = false; this.#error = ''; this.#paint(); });
    on('[data-action=setup]', () => { this.#setup = true; this.#error = ''; this.#paint(); });
    on('[data-action=connect]', () => this.#connect());
    on('[data-action=disconnect]', () => this.#disconnect());
    on('[data-action=import]', () => this.#import());
  }

  // --- Actions -------------------------------------------------------------------

  async #saveSetup() {
    const box = this.$('.content');
    const region = box.querySelector('[name=region]').value;
    const clientId = box.querySelector('[name=clientId]').value.trim();
    if (!REGIONS[region]) { this.#error = 'Choose your Zoho region.'; return this.#paint(); }
    if (!clientId) { this.#error = 'Paste the client ID from the Zoho API console.'; return this.#paint(); }
    const s = this.store.settings;
    if (region !== s.zohoRegion || clientId !== s.zohoClientId) {
      clearSession();
      this.#session = null;
      this.#orgs = null;
    }
    await this.store.saveSettings({ zohoRegion: region, zohoClientId: clientId });
    this.#setup = false;
    this.#error = '';
    this.#paint();
  }

  async #connect() {
    const s = this.store.settings;
    this.#error = '';
    try {
      this.#session = await signIn({ region: s.zohoRegion, clientId: s.zohoClientId });
    } catch (err) {
      this.#error = err.message;
    }
    this.#paint();
    if (this.#session) this.#loadOrgs();
  }

  #disconnect() {
    clearSession();
    this.#session = null;
    this.#orgs = null;
    this.#result = null;
    this.#paint();
  }

  #client() {
    const { token, apiDomain, expiresAt } = this.#session;
    return new ZohoBooksClient({ token, apiDomain, expiresAt, onWait: (m) => this.#progress(m) });
  }

  async #loadOrgs() {
    try {
      this.#orgs = await this.#client().organizations();
      if (!this.#orgs.length) this.#error = 'This Zoho account has no Zoho Books organisations.';
    } catch (err) {
      this.#fail(err);
    }
    this.#paint();
  }

  async #import() {
    const box = this.$('.content');
    const orgId = box.querySelector('[name=org]').value;
    const from = box.querySelector('[name=from]').value;
    const types = [...box.querySelectorAll('[name=types]:checked')].map((i) => i.value);
    if (!types.length) { this.#error = 'Choose at least one thing to import.'; return this.#paint(); }
    const org = this.#orgs.find((o) => String(o.organization_id) === orgId);
    await this.store.saveSettings({ zohoOrgId: orgId, zohoFrom: from, zohoTypes: types });

    this.#busy = true;
    this.#error = '';
    this.#result = null;
    this.#paint();
    try {
      this.#result = await syncZoho({
        client: this.#client(), store: this.store, org, region: this.store.settings.zohoRegion, from, types,
        onProgress: (m) => this.#progress(m),
      });
      const c = this.#result;
      this.emit('toast', { message: `Zoho Books: ${c.added} new, ${c.updated} updated, ${c.removed} removed` });
    } catch (err) {
      this.#fail(err);
    }
    this.#busy = false;
    this.#paint();
  }

  #fail(err) {
    console.error(err);
    if (err instanceof ZohoAuthError) {
      clearSession();
      this.#session = null;
      this.#orgs = null;
    }
    this.#error = err instanceof TypeError
      ? 'Couldn’t reach Zoho Books. Check your connection and that the region is right.'
      : err.message;
  }

  #progress(message) {
    const el = this.$('.progress');
    if (el) el.innerHTML = String(html`<span class="spinner"></span>${message}`);
  }
}

customElements.define('zoho-import', ZohoImport);
