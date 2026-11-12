// Shared base class for the app's custom elements: shadow root, shared styles,
// store subscription and focus-preserving re-render.

import { store } from '../lib/store.js';
import { raw } from '../lib/format.js';

export const sharedStyles = new CSSStyleSheet();
sharedStyles.replaceSync(`
  :host { display: block; }
  [hidden] { display: none !important; }
  button, input, select, textarea { font: inherit; color: inherit; }
  .btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 7px 12px; border-radius: var(--radius-sm);
    border: 1px solid var(--line-strong); background: var(--surface); color: var(--text);
    cursor: pointer; font-weight: 500; white-space: nowrap; line-height: 1.2;
  }
  .btn:hover { background: var(--surface-2); }
  .btn svg { width: 16px; height: 16px; flex: none; }
  .btn.small svg { width: 14px; height: 14px; }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  .btn.primary:hover { filter: brightness(1.08); }
  .btn.ghost { border-color: transparent; background: transparent; }
  .btn.ghost:hover { background: var(--surface-2); }
  .btn.danger { color: var(--danger); }
  .btn.small { padding: 4px 8px; font-size: 12.5px; }
  .btn:disabled { opacity: .5; cursor: default; }
  .icon-btn {
    display: inline-grid; place-items: center; width: 28px; height: 28px; padding: 0;
    border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--muted); cursor: pointer;
  }
  .icon-btn:hover { background: var(--surface-2); color: var(--text); }
  .icon-btn.danger:hover { color: var(--danger); background: var(--danger-soft); }
  .icon-btn svg { width: 16px; height: 16px; }
  :focus-visible { outline: 2px solid var(--focus); outline-offset: 1px; }
  input, select, textarea {
    background: var(--surface); border: 1px solid var(--line-strong); border-radius: var(--radius-sm);
    padding: 6px 8px; min-width: 0;
  }
  input:focus, select:focus, textarea:focus { outline: 2px solid var(--focus); outline-offset: -1px; border-color: transparent; }
  label.field { display: grid; gap: 4px; font-size: 12.5px; color: var(--muted); font-weight: 500; }
  label.field > input, label.field > select, label.field > textarea { color: var(--text); font-size: 14px; font-weight: 400; }
  .card { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); box-shadow: var(--shadow); }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .muted { color: var(--muted); }
  .faint { color: var(--faint); }
  .pill {
    display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 600;
    background: var(--surface-2); color: var(--muted); white-space: nowrap;
  }
  .pill.ok { background: var(--ok-soft); color: var(--ok); }
  .pill.warn { background: var(--warn-soft); color: var(--warn); }
  .pill.danger { background: var(--danger-soft); color: var(--danger); }
  .pill.accent { background: var(--accent-soft); color: var(--accent); }
  .empty { padding: 40px 16px; text-align: center; color: var(--muted); }
  .empty strong { display: block; color: var(--text); font-size: 15px; margin-bottom: 4px; }
  h2 { font-size: 16px; margin: 0; }
  @media print { .no-print { display: none !important; } }
`);

export class SoaElement extends HTMLElement {
  /** Component-specific CSS (string). */
  static css = '';
  /** Re-render when the store changes. */
  static subscribe = true;

  #sheet;
  #onStore = () => this.update();

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    const ctor = /** @type {typeof SoaElement} */ (this.constructor);
    if (!ctor.hasOwnProperty('_sheet')) {
      ctor._sheet = new CSSStyleSheet();
      ctor._sheet.replaceSync(ctor.css);
    }
    this.shadowRoot.adoptedStyleSheets = [sharedStyles, ctor._sheet];
  }

  connectedCallback() {
    if (this.constructor.subscribe) store.addEventListener('change', this.#onStore);
    this.update();
  }

  disconnectedCallback() {
    store.removeEventListener('change', this.#onStore);
  }

  get store() { return store; }

  /** @returns {string|{toString():string}} */
  render() { return ''; }

  /** Re-render, restoring focus/selection on the element with the same `data-focus-key`. */
  update() {
    const active = this.shadowRoot.activeElement;
    const key = active?.dataset?.focusKey;
    const sel = key && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
    this.shadowRoot.innerHTML = String(this.render());
    this.afterRender?.();
    if (key) {
      const el = this.shadowRoot.querySelector(`[data-focus-key="${CSS.escape(key)}"]`);
      if (el) {
        el.focus();
        try { if (sel) el.setSelectionRange(...sel); } catch { /* not a text input */ }
      }
    }
  }

  $(sel) { return this.shadowRoot.querySelector(sel); }
  $$(sel) { return [...this.shadowRoot.querySelectorAll(sel)]; }

  emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
}

// Small inline icons (Lucide-style strokes).
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const icons = {
  upload: svg('<path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M20 15v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4"/>'),
  trash: svg('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>'),
  file: svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  print: svg('<path d="M6 9V2h12v7"/><rect x="6" y="14" width="12" height="8"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>'),
  download: svg('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>'),
  plus: svg('<path d="M12 5v14"/><path d="M5 12h14"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  back: svg('<path d="m15 18-6-6 6-6"/>'),
  x: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  cloud: svg('<path d="M12 13v8"/><path d="m8 17 4 4 4-4"/><path d="M4.4 15.3A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.4 8.3"/>'),
  external: svg('<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
  alert: svg('<circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/>'),
};

/** Icon as trusted HTML for use inside html`` templates. */
export const icon = (name) => raw(icons[name]);
