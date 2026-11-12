// <template-editor>: edit the statement of account template with a live preview.
// Branding (logo, accent, fonts), wording with {placeholders}, sections (show/hide,
// reorder) and their columns (show/hide, rename), plus the smaller labels.
// Changes save automatically.

import { SoaElement, icon } from './base.js';
import { html, raw } from '../lib/format.js';
import { buildStatement, listAccounts } from '../lib/statement.js';
import { todayISO, addDays } from '../lib/values.js';
import {
  DEFAULT_TEMPLATE, FONTS, ACCENT_PRESETS, PLACEHOLDERS, SECTION_INFO,
  normaliseTemplate, getPath, setPath, moveSection,
} from '../lib/template.js';
import { logoFromFile } from '../lib/image.js';
import { documentCss, renderStatement } from './statement-document.js';

const SAMPLE = '__sample__';
const SAVE_DELAY = 400;

const LABEL_NAMES = {
  invoice: 'Invoice (type)', credit: 'Credit note (type)', payment: 'Payment (type)',
  broughtForward: 'Brought-forward row', totalRow: 'Activity total row', totalOutstanding: 'Category total row',
  unapplied: 'Unapplied credit row', uncategorised: 'Uncategorised', unallocated: 'Unallocated difference',
  noTransactions: 'No transactions', item: 'item (singular)', items: 'items (plural)',
  paid: 'Status: paid', partPaid: 'Status: part paid', open: 'Status: open', overdue: 'Status: overdue', overduePart: 'Status: part paid & overdue',
};
const HEADER_FIELD_NAMES = { statementDate: 'Statement date', period: 'Period', currency: 'Currency' };

class TemplateEditor extends SoaElement {
  static subscribe = false;
  static css = `
    .layout { display: grid; grid-template-columns: minmax(300px, 400px) minmax(0, 1fr); gap: 20px; align-items: start; }
    @media (max-width: 960px) { .layout { grid-template-columns: 1fr; } }
    .panel { position: sticky; top: 72px; max-height: calc(100vh - 88px); overflow: auto; padding: 0; }
    @media (max-width: 960px) { .panel { position: static; max-height: none; } }
    .panel-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 14px 16px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: var(--surface); z-index: 1; }
    .saved { font-size: 12px; color: var(--muted); }
    details { border-bottom: 1px solid var(--line); }
    summary { cursor: pointer; padding: 12px 16px; font-weight: 650; list-style: none; display: flex; justify-content: space-between; align-items: center; }
    summary::-webkit-details-marker { display: none; }
    summary::after { content: '▸'; color: var(--faint); transition: transform .15s; }
    details[open] > summary::after { transform: rotate(90deg); }
    .group { padding: 0 16px 16px; display: grid; gap: 12px; }
    .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    textarea { resize: vertical; min-height: 56px; }
    .hint { font-size: 12px; color: var(--faint); font-weight: 400; }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .chip { font: 12px var(--font-mono); padding: 2px 7px; border-radius: 4px; border: 1px solid var(--line-strong); background: var(--surface-2); color: var(--muted); cursor: pointer; }
    .chip:hover { color: var(--text); border-color: var(--accent); }
    .logo-box { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .logo-box img { max-height: 48px; max-width: 160px; background: #fff; border: 1px solid var(--line); border-radius: 4px; padding: 4px; }
    .logo-box .none { font-size: 12.5px; color: var(--faint); }
    input[type=file] { display: none; }
    .swatches { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .swatch { width: 24px; height: 24px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; padding: 0; box-shadow: inset 0 0 0 1px rgb(0 0 0 / 15%); }
    .swatch[aria-pressed=true] { border-color: var(--text); }
    input[type=color] { width: 36px; height: 28px; padding: 0 2px; cursor: pointer; }
    input[type=range] { width: 100%; padding: 0; border: 0; }
    .sec { border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); }
    .sec + .sec { margin-top: 6px; }
    .sec.off .sec-name { color: var(--faint); text-decoration: line-through; }
    .sec-head { display: flex; align-items: center; gap: 6px; padding: 6px 6px 6px 10px; }
    .sec-head .sec-name { flex: 1; font-weight: 550; font-size: 13.5px; }
    .sec-head label { display: flex; align-items: center; }
    .sec-body { padding: 4px 10px 12px; display: grid; gap: 10px; border-top: 1px solid var(--line); }
    .cols { display: grid; gap: 4px; }
    .col { display: grid; grid-template-columns: auto 1fr; gap: 8px; align-items: center; }
    .col input[type=text] { padding: 4px 6px; font-size: 13px; }
    .col.off input[type=text] { color: var(--faint); }
    .icon-btn[disabled] { opacity: .3; cursor: default; }
    .check { display: flex; gap: 8px; align-items: center; font-size: 13px; }
    .labels { display: grid; gap: 6px; }
    .labels label { display: grid; grid-template-columns: 140px 1fr; align-items: center; gap: 8px; font-size: 12.5px; color: var(--muted); }
    .labels input { padding: 4px 6px; font-size: 13px; }
    .preview { min-width: 0; }
    .preview-bar { display: flex; justify-content: space-between; align-items: end; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
    .preview-bar .muted { font-size: 12.5px; }
  `;

  constructor() {
    super();
    this.shadowRoot.adoptedStyleSheets = [...this.shadowRoot.adoptedStyleSheets, documentCss];
  }

  /** Working copy of the template; saved to the store shortly after each edit. */
  #tpl = null;
  #open = new Set(['branding', 'wording', 'sections']);
  #openSections = new Set();
  #previewKey = '';
  #saveTimer = null;
  #ownSave = false;
  #status = '';
  #lastField = null;
  #onStore = (e) => {
    // Our own saves only need the preview, which is already current.
    if (e.detail?.reason === 'settings' && this.#ownSave) { this.#ownSave = false; return; }
    // Keep a draft that hasn't been saved yet; otherwise pick up changes made elsewhere.
    if (!this.#saveTimer) this.#tpl = this.store.template;
    this.update();
  };

  connectedCallback() {
    this.#tpl = this.store.template;
    this.store.addEventListener('change', this.#onStore);
    this.update();
  }

  disconnectedCallback() {
    this.store.removeEventListener('change', this.#onStore);
    this.#flush();
  }

  /** The template being edited (for tests and the statement page). */
  get template() { return this.#tpl; }

  render() {
    const t = this.#tpl;
    return html`
      <div class="layout">
        <aside class="card panel" aria-label="Template settings">
          <div class="panel-head">
            <h2>Statement template</h2>
            <span class="saved" role="status">${this.#status}</span>
            <button class="btn small" data-action="reset" title="Restore the original wording, sections and look">Reset</button>
          </div>
          ${this.#group('branding', 'Branding', this.#branding(t))}
          ${this.#group('wording', 'Wording', this.#wording(t))}
          ${this.#group('sections', 'Sections & columns', this.#sections(t))}
          ${this.#group('labels', 'Other wording', this.#labels(t))}
        </aside>
        <section class="preview" aria-label="Preview">
          ${this.#previewBar()}
          <div class="preview-doc">${raw(this.#previewHtml())}</div>
        </section>
      </div>`;
  }

  #group(key, title, body) {
    return html`<details data-group="${key}" ${this.#open.has(key) ? 'open' : ''}><summary>${title}</summary><div class="group">${body}</div></details>`;
  }

  #branding(t) {
    const b = t.branding;
    return html`
      <div class="field" style="display:grid;gap:6px">
        <span class="hint" style="font-weight:500;color:var(--muted);font-size:12.5px">Logo</span>
        <div class="logo-box">
          ${b.logo ? html`<img src="${b.logo}" alt="Current logo">` : html`<span class="none">No logo</span>`}
          <label class="btn small">${icon('upload')} ${b.logo ? 'Replace' : 'Upload'}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" data-action="logo"></label>
          ${b.logo ? html`<button class="btn small danger" data-action="remove-logo">Remove</button>` : ''}
        </div>
      </div>
      ${b.logo ? html`<label class="field">Logo height: ${b.logoHeight}px
        <input type="range" min="24" max="160" step="4" data-path="branding.logoHeight" data-focus-key="branding.logoHeight" value="${b.logoHeight}"></label>` : ''}
      <div class="field" style="display:grid;gap:6px">
        <span class="hint" style="font-weight:500;color:var(--muted);font-size:12.5px">Accent colour</span>
        <div class="swatches">
          ${ACCENT_PRESETS.map((c) => html`<button class="swatch" style="background:${c}" data-accent="${c}" aria-pressed="${c.toLowerCase() === b.accent.toLowerCase()}" aria-label="Accent ${c}" title="${c}"></button>`)}
          <input type="color" data-path="branding.accent" data-focus-key="branding.accent" value="${b.accent}" aria-label="Custom accent colour" title="Custom colour">
        </div>
      </div>
      <div class="row2">
        <label class="field">Heading font
          <select data-path="branding.headingFont" data-focus-key="branding.headingFont">${Object.entries(FONTS).map(([k, f]) => html`<option value="${k}" ${k === b.headingFont ? 'selected' : ''}>${f.label}</option>`)}</select>
        </label>
        <label class="field">Body font
          <select data-path="branding.bodyFont" data-focus-key="branding.bodyFont">${Object.entries(FONTS).map(([k, f]) => html`<option value="${k}" ${k === b.bodyFont ? 'selected' : ''}>${f.label}</option>`)}</select>
        </label>
      </div>`;
  }

  #wording(t) {
    const text = (path, label, { area = false, rows = 3, placeholder = '' } = {}) => {
      const value = getPath(t, path);
      return html`<label class="field">${label}
        ${area
          ? html`<textarea data-path="${path}" data-focus-key="${path}" rows="${rows}" placeholder="${placeholder}">${value}</textarea>`
          : html`<input type="text" data-path="${path}" data-focus-key="${path}" value="${value}" placeholder="${placeholder}">`}
      </label>`;
    };
    return html`
      <div class="field" style="display:grid;gap:6px">
        <span class="hint">Click a placeholder to insert it where you're typing. It's filled in for each statement.</span>
        <div class="chips">${PLACEHOLDERS.map((p) => html`<button class="chip" data-insert="{${p.key}}" title="${p.help}">{${p.key}}</button>`)}</div>
      </div>
      ${text('title', 'Title')}
      ${text('intro', 'Intro message', { area: true, placeholder: 'e.g. Dear {customer}, your balance as at {statement_date} is {balance_due}.' })}
      ${text('footer', 'Footer note', { area: true, placeholder: 'e.g. bank details and payment instructions' })}
      <div class="row2">
        ${text('header.accountLabel', 'Account label')}
        ${text('header.balanceDueLabel', 'Balance due label')}
      </div>
      <div class="field" style="display:grid;gap:4px">
        <span class="hint" style="font-weight:500;color:var(--muted);font-size:12.5px">Header details</span>
        <div class="cols">
          ${Object.entries(t.header.fields).map(([k, f]) => html`
            <div class="col ${f.visible ? '' : 'off'}">
              <input type="checkbox" data-path="header.fields.${k}.visible" data-focus-key="header.fields.${k}.visible" ${f.visible ? 'checked' : ''} aria-label="Show ${HEADER_FIELD_NAMES[k]}">
              <input type="text" data-path="header.fields.${k}.label" data-focus-key="header.fields.${k}.label" value="${f.label}" aria-label="${HEADER_FIELD_NAMES[k]} label">
            </div>`)}
        </div>
      </div>
      ${text('header.periodAll', 'Period wording with no start date')}
      <label class="check"><input type="checkbox" data-path="header.showCompanyDetails" data-focus-key="header.showCompanyDetails" ${t.header.showCompanyDetails ? 'checked' : ''}> Show company address &amp; details</label>`;
  }

  #sections(t) {
    const n = t.sections.length;
    return html`
      <span class="hint">Tick to show, use the arrows to reorder, and open a section to rename or hide its columns.</span>
      <div>
        ${t.sections.map((s, i) => {
          const info = SECTION_INFO[s.key];
          const open = this.#openSections.has(s.key);
          const hasBody = s.columns || 'heading' in s || 'showLineItems' in s || info.hint;
          return html`
            <div class="sec ${s.visible ? '' : 'off'}" data-section="${s.key}">
              <div class="sec-head">
                <label title="Show this section"><input type="checkbox" data-path="sections.${s.key}.visible" data-focus-key="sections.${s.key}.visible" ${s.visible ? 'checked' : ''} aria-label="Show ${info.name}"></label>
                <span class="sec-name">${info.name}</span>
                <button class="icon-btn" data-move="${s.key}" data-delta="-1" ${i === 0 ? 'disabled' : ''} aria-label="Move ${info.name} up" title="Move up">${raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>')}</button>
                <button class="icon-btn" data-move="${s.key}" data-delta="1" ${i === n - 1 ? 'disabled' : ''} aria-label="Move ${info.name} down" title="Move down">${raw('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>')}</button>
                ${hasBody ? html`<button class="icon-btn" data-expand="${s.key}" aria-expanded="${open}" aria-label="Edit ${info.name}" title="Edit">${raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform:rotate(${open ? 90 : 0}deg)"><path d="m9 18 6-6-6-6"/></svg>`)}</button>` : ''}
              </div>
              ${open ? html`<div class="sec-body">${this.#sectionBody(s, info)}</div>` : ''}
            </div>`;
        })}
      </div>`;
  }

  #sectionBody(s, info) {
    const p = `sections.${s.key}`;
    return html`
      ${info.hint ? html`<span class="hint">${info.hint}${s.key === 'intro' || s.key === 'footer' ? ' Edit its text under Wording.' : ''}</span>` : ''}
      ${'heading' in s ? html`<div class="row2">
        <label class="field">Heading <input type="text" data-path="${p}.heading" data-focus-key="${p}.heading" value="${s.heading}"></label>
        <label class="field">Note beside heading <input type="text" data-path="${p}.subheading" data-focus-key="${p}.subheading" value="${s.subheading}"></label>
      </div>` : ''}
      ${'showLineItems' in s ? html`<label class="check"><input type="checkbox" data-path="${p}.showLineItems" data-focus-key="${p}.showLineItems" ${s.showLineItems ? 'checked' : ''}> Show line items under each invoice</label>` : ''}
      ${s.columns ? html`<div class="field" style="display:grid;gap:4px">
        <span class="hint" style="font-weight:500;color:var(--muted);font-size:12.5px">${info.columnsName ?? 'Columns'}</span>
        <div class="cols">
          ${Object.entries(s.columns).map(([k, c]) => html`
            <div class="col ${c.visible ? '' : 'off'}">
              <input type="checkbox" data-path="${p}.columns.${k}.visible" data-focus-key="${p}.columns.${k}.visible" ${c.visible ? 'checked' : ''} aria-label="Show ${c.label || k}">
              <input type="text" data-path="${p}.columns.${k}.label" data-focus-key="${p}.columns.${k}.label" value="${c.label}" aria-label="${k} label">
            </div>`)}
        </div>
      </div>` : ''}`;
  }

  #labels(t) {
    return html`
      <span class="hint">Smaller pieces of text used inside the tables.</span>
      <div class="labels">
        ${Object.entries(t.labels).map(([k, val]) => html`<label>${LABEL_NAMES[k] ?? k}<input type="text" data-path="labels.${k}" data-focus-key="labels.${k}" value="${val}"></label>`)}
      </div>`;
  }

  #previewOptions() {
    const opts = [];
    for (const a of listAccounts(this.store.transactions)) for (const c of a.currencies) opts.push({ key: `${a.key}|${c}`, label: a.currencies.length > 1 ? `${a.name} (${c})` : a.name, account: a.name, currency: c });
    opts.push({ key: SAMPLE, label: `Sample customer (${this.store.settings.defaultCurrency || 'USD'})` });
    return opts;
  }

  #previewBar() {
    const opts = this.#previewOptions();
    if (!opts.some((o) => o.key === this.#previewKey)) this.#previewKey = opts[0].key;
    return html`<div class="preview-bar">
      <label class="field">Preview with
        <select data-action="preview-account">${opts.map((o) => html`<option value="${o.key}" ${o.key === this.#previewKey ? 'selected' : ''}>${o.label}</option>`)}</select>
      </label>
      <span class="muted">Changes save automatically and apply to every statement.</span>
    </div>`;
  }

  #previewStatement() {
    const opt = this.#previewOptions().find((o) => o.key === this.#previewKey);
    const to = todayISO();
    if (!opt || opt.key === SAMPLE) {
      const currency = this.store.settings.defaultCurrency || 'USD';
      return buildStatement(sampleTransactions(currency, to), { account: 'Sample Customer Ltd', currency, to });
    }
    return buildStatement(this.store.transactions, { account: opt.account, currency: opt.currency, to });
  }

  #previewHtml() {
    return String(renderStatement(this.#previewStatement(), this.store.settings, this.#tpl));
  }

  #refreshPreview() {
    const box = this.$('.preview-doc');
    if (box) box.innerHTML = this.#previewHtml();
  }

  afterRender() {
    const root = this.shadowRoot;
    root.querySelectorAll('details[data-group]').forEach((d) => d.addEventListener('toggle', () => {
      if (d.open) this.#open.add(d.dataset.group); else this.#open.delete(d.dataset.group);
    }));

    root.querySelectorAll('[data-path]').forEach((el) => {
      const isText = el.matches('input[type=text], textarea');
      if (isText) el.addEventListener('focus', () => { this.#lastField = el.dataset.path; });
      // Text, colours and sliders update live; ticks and selects may change the editor itself.
      el.addEventListener(isText || el.type === 'color' || el.type === 'range' ? 'input' : 'change', () => this.#edit(el));
    });

    root.querySelectorAll('[data-accent]').forEach((b) => b.addEventListener('click', () => {
      setPath(this.#tpl, 'branding.accent', b.dataset.accent);
      this.#changed({ structural: true });
    }));
    root.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => {
      moveSection(this.#tpl, b.dataset.move, Number(b.dataset.delta));
      this.#changed({ structural: true });
    }));
    root.querySelectorAll('[data-expand]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.expand;
      if (this.#openSections.has(k)) this.#openSections.delete(k); else this.#openSections.add(k);
      this.update();
    }));
    root.querySelectorAll('[data-insert]').forEach((b) => b.addEventListener('mousedown', (e) => e.preventDefault()));
    root.querySelectorAll('[data-insert]').forEach((b) => b.addEventListener('click', () => this.#insert(b.dataset.insert)));

    this.$('[data-action=reset]').addEventListener('click', () => {
      if (!confirm('Reset the statement template to the original wording, sections, columns and look? Your logo will be removed.')) return;
      this.#tpl = normaliseTemplate(structuredClone(DEFAULT_TEMPLATE));
      this.#changed({ structural: true });
    });
    this.$('[data-action=logo]').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        setPath(this.#tpl, 'branding.logo', await logoFromFile(file));
        this.#changed({ structural: true });
      } catch (err) {
        alert(err.message);
      }
    });
    this.$('[data-action=remove-logo]')?.addEventListener('click', () => {
      setPath(this.#tpl, 'branding.logo', '');
      this.#changed({ structural: true });
    });
    this.$('[data-action=preview-account]').addEventListener('change', (e) => {
      this.#previewKey = e.target.value;
      this.#refreshPreview();
    });
  }

  #edit(el) {
    const path = el.dataset.path;
    const value = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
    setPath(this.#tpl, path, value);
    // Ticking a box or picking from a list can change the editor (e.g. greyed-out rows).
    const structural = el.type === 'checkbox' || el.tagName === 'SELECT' || el.type === 'range';
    this.#changed({ structural });
  }

  /** Insert a {placeholder} at the cursor of the last text field used (default: intro). */
  #insert(token) {
    const path = this.#lastField ?? 'intro';
    const el = this.$(`[data-path="${CSS.escape(path)}"]`);
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    el.value = el.value.slice(0, start) + token + el.value.slice(end);
    el.focus();
    el.setSelectionRange(start + token.length, start + token.length);
    this.#edit(el);
  }

  #changed({ structural = false } = {}) {
    if (structural) this.update(); else this.#refreshPreview();
    this.#setStatus('Saving…');
    clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => this.#flush(), SAVE_DELAY);
  }

  async #flush() {
    if (!this.#saveTimer) return;
    clearTimeout(this.#saveTimer);
    this.#saveTimer = null;
    this.#ownSave = true;
    await this.store.saveTemplate(this.#tpl);
    this.#setStatus('Saved');
  }

  #setStatus(text) {
    this.#status = text;
    const el = this.$('.saved');
    if (el) el.textContent = text;
  }
}

/** Illustrative data for previewing the template before any invoices are imported. */
export function sampleTransactions(currency, today) {
  const acc = { account: 'Sample Customer Ltd', currency };
  return [
    { id: 's1', kind: 'invoice', ...acc, number: 'INV-1001', date: addDays(today, -75), dueDate: addDays(today, -45), amount: 1815, lines: [
      { description: 'Consulting services', category: 'Services', amount: 1200 },
      { description: 'Software licence', category: 'Licences', amount: 450 },
      { description: 'VAT', category: 'Tax', amount: 165, type: 'tax' },
    ] },
    { id: 's2', kind: 'payment', ...acc, number: 'Bank transfer', date: addDays(today, -40), amount: 1000 },
    { id: 's3', kind: 'credit', ...acc, number: 'CN-12', date: addDays(today, -32), amount: 100 },
    { id: 's4', kind: 'invoice', ...acc, number: 'INV-1002', date: addDays(today, -20), dueDate: addDays(today, 10), amount: 660, lines: [
      { description: 'Support retainer', category: 'Support', amount: 600 },
      { description: 'VAT', category: 'Tax', amount: 60, type: 'tax' },
    ] },
  ];
}

customElements.define('template-editor', TemplateEditor);
