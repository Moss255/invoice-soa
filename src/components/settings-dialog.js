// <settings-dialog>: company details for the statement header, parsing preferences,
// and backup / restore of the locally stored data.

import { SoaElement, icon } from './base.js';
import { html, download } from '../lib/format.js';
import { CURRENCY_CODES, todayISO } from '../lib/values.js';
import { REGIONS, consoleUrl } from '../lib/zoho.js';
import { redirectUri, clearSession } from '../lib/zoho-auth.js';

class SettingsDialog extends SoaElement {
  static subscribe = false;
  static css = `
    dialog { border: 0; border-radius: var(--radius); padding: 0; width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 32px); background: var(--surface); color: var(--text); box-shadow: 0 20px 60px rgb(0 0 0 / 30%); }
    dialog::backdrop { background: rgb(10 14 20 / 45%); }
    form { display: grid; gap: 14px; padding: 20px; }
    .head { display: flex; justify-content: space-between; align-items: center; }
    fieldset { border: 0; padding: 0; margin: 0; display: grid; gap: 12px; }
    legend { font-weight: 650; font-size: 13px; padding: 0; margin-bottom: 8px; }
    .row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
    .row.two { grid-template-columns: 1fr 1.4fr; }
    @media (max-width: 520px) { .row, .row.two { grid-template-columns: 1fr; } }
    textarea { resize: vertical; min-height: 64px; }
    .hint { font-size: 12px; color: var(--faint); font-weight: 400; }
    .hint code { font-family: var(--font-mono); color: var(--muted); }
    hr { border: 0; border-top: 1px solid var(--line); margin: 4px 0; width: 100%; }
    .data { display: flex; flex-wrap: wrap; gap: 8px; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; }
    input[type=file] { display: none; }
  `;

  render() {
    const s = this.store.settings;
    return html`
      <dialog>
        <form method="dialog">
          <div class="head"><h2>Settings</h2><button type="button" class="icon-btn" data-close aria-label="Close">${icon('x')}</button></div>
          <fieldset>
            <legend>Your business</legend>
            <label class="field">Company name
              <input name="companyName" value="${s.companyName}" placeholder="Shown at the top of statements">
              <span class="hint">Also used to work out the other party on each invoice — whether you issued it or received it.</span>
            </label>
            <label class="field">Address &amp; contact details <textarea name="companyDetails" rows="3">${s.companyDetails}</textarea></label>
            <span class="hint">The statement's wording, sections, columns, logo and colours are edited on the <a href="#template" data-close>Template</a> page.</span>
          </fieldset>
          <hr>
          <fieldset>
            <legend>Reading invoices</legend>
            <div class="row">
              <label class="field">Numeric dates
                <select name="dateOrder">
                  <option value="DMY" ${s.dateOrder === 'DMY' ? 'selected' : ''}>DD/MM/YYYY</option>
                  <option value="MDY" ${s.dateOrder === 'MDY' ? 'selected' : ''}>MM/DD/YYYY</option>
                </select>
              </label>
              <label class="field">Default currency
                <select name="defaultCurrency">${CURRENCY_CODES.map((c) => html`<option ${c === s.defaultCurrency ? 'selected' : ''}>${c}</option>`)}</select>
              </label>
              <label class="field">Default terms (days) <input name="termsDays" type="number" min="0" max="365" value="${s.termsDays}"></label>
            </div>
          </fieldset>
          <hr>
          <fieldset>
            <legend>Line item categories</legend>
            <label class="field">Keyword rules
              <textarea name="categoryRules" rows="5" spellcheck="false" style="font-family:var(--font-mono);font-size:12.5px" placeholder="Design: logo, brand, identity, design&#10;Hosting: hosting, domain, server&#10;Support: support, retainer, maintenance">${s.categoryRules}</textarea>
              <span class="hint">One category per line: <code>Category: keyword, keyword</code>. New lines get the first category whose keyword appears in their description. When you pick a category by hand, it's remembered for lines with the same description. That takes priority over these rules. Tax lines are put in <em>Tax</em> automatically.</span>
            </label>
            <div class="data">
              <span class="hint" style="align-self:center">${Object.keys(s.learnedCategories ?? {}).length} remembered description${Object.keys(s.learnedCategories ?? {}).length === 1 ? '' : 's'}</span>
              ${Object.keys(s.learnedCategories ?? {}).length ? html`<button type="button" class="btn small" data-action="forget">Forget remembered</button>` : ''}
            </div>
          </fieldset>
          <hr>
          <fieldset>
            <legend>Zoho Books</legend>
            <div class="row two">
              <label class="field">Region
                <select name="zohoRegion">
                  <option value="" ${REGIONS[s.zohoRegion] ? '' : 'selected'}>Not set</option>
                  ${Object.entries(REGIONS).map(([k, v]) => html`<option value="${k}" ${k === s.zohoRegion ? 'selected' : ''}>${v.label}</option>`)}
                </select>
              </label>
              <label class="field">Client ID <input name="zohoClientId" value="${s.zohoClientId}" placeholder="1000.XXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" spellcheck="false" autocomplete="off"></label>
            </div>
            <span class="hint">Your region is the domain in your Zoho Books address (books.zoho.ae is UAE, books.zoho.sa is Saudi Arabia). Create a <em>Client-based Application</em> in your region's <a href="${REGIONS[s.zohoRegion] ? consoleUrl(s.zohoRegion) : 'https://api-console.zoho.com'}" target="_blank" rel="noopener" data-zoho-console>Zoho API console</a> with JavaScript domain <code>${location.origin}</code> and redirect URI <code>${redirectUri()}</code>. The redirect URI is wherever this app is open, so register each address you use it at. Full steps are under <strong>Invoices → Import from Zoho Books</strong>.</span>
          </fieldset>
          <hr>
          <fieldset>
            <legend>Your data</legend>
            <span class="hint" style="margin-top:-6px">Everything is stored in this browser only. Export a backup to move it or keep it safe (original files aren't included).</span>
            <div class="data">
              <button type="button" class="btn small" data-action="export">${icon('download')} Export backup</button>
              <label class="btn small">${icon('upload')} Import backup<input type="file" accept="application/json,.json" data-action="import"></label>
              <button type="button" class="btn small danger" data-action="clear">${icon('trash')} Delete all data</button>
            </div>
          </fieldset>
          <div class="actions">
            <button type="button" class="btn" data-close>Cancel</button>
            <button class="btn primary">Save</button>
          </div>
        </form>
      </dialog>`;
  }

  afterRender() {
    const dialog = this.$('dialog');
    const form = this.$('form');
    this.$$('[data-close]').forEach((b) => b.addEventListener('click', () => dialog.close()));
    // Set explicitly as well as via <option selected>: saving compares it with the stored
    // region to decide whether to sign out of Zoho, so it must never read as "Not set" by mistake.
    this.$('[name=zohoRegion]').value = REGIONS[this.store.settings.zohoRegion] ? this.store.settings.zohoRegion : '';
    this.$('[name=zohoRegion]').addEventListener('change', (e) => {
      if (REGIONS[e.target.value]) this.$('[data-zoho-console]').href = consoleUrl(e.target.value);
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(form));
      d.zohoClientId = d.zohoClientId.trim();
      // A Zoho sign-in belongs to one region and client; changing either means signing in again.
      const prev = this.store.settings;
      if (d.zohoRegion !== prev.zohoRegion || d.zohoClientId !== prev.zohoClientId) clearSession();
      await this.store.saveSettings({ ...d, termsDays: Number(d.termsDays) || 0 });
      const filled = await this.store.applyCategoryRules();
      dialog.close();
      if (filled) this.emit('toast', { message: `Categorised ${filled} line item${filled === 1 ? '' : 's'} using your rules` });
    });
    this.$('[data-action=forget]')?.addEventListener('click', async () => {
      if (!confirm('Forget every remembered category choice? Existing line categories are kept.')) return;
      await this.store.saveSettings({ learnedCategories: {} });
      this.update();
    });
    this.$('[data-action=export]').addEventListener('click', () => {
      download(`invoice-soa-backup-${todayISO()}.json`, JSON.stringify(this.store.exportBackup(), null, 2), 'application/json');
    });
    this.$('[data-action=import]').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const n = await this.store.importBackup(JSON.parse(await file.text()));
        alert(`Imported ${n} transactions.`);
        dialog.close();
      } catch (err) {
        alert(`Couldn't import: ${err.message}`);
      }
    });
    this.$('[data-action=clear]').addEventListener('click', async () => {
      if (!confirm('Delete every invoice, payment and stored file from this browser? This cannot be undone.')) return;
      await this.store.clearAll();
      dialog.close();
    });
  }

  open() {
    this.update();
    this.$('dialog').showModal();
  }
}

customElements.define('settings-dialog', SettingsDialog);
