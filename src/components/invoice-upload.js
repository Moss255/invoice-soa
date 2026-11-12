// <invoice-upload>: drop zone + file picker. Reads each file in the browser and
// stores the extracted invoice. Shows per-file progress.

import { SoaElement, icon } from './base.js';
import { html } from '../lib/format.js';
import { ACCEPT } from '../lib/extract.js';
import { importFile } from '../lib/importer.js';

class InvoiceUpload extends SoaElement {
  static subscribe = false;
  static css = `
    .zone {
      display: grid; place-items: center; gap: 6px; text-align: center;
      padding: 28px 16px; border: 1.5px dashed var(--line-strong); border-radius: var(--radius);
      background: var(--surface); cursor: pointer; transition: border-color .15s, background .15s;
    }
    .zone:hover, .zone.over { border-color: var(--accent); background: var(--accent-soft); }
    .zone .ico { width: 40px; height: 40px; border-radius: 50%; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent); }
    .zone .ico svg { width: 20px; height: 20px; }
    .zone strong { font-size: 15px; }
    .zone .hint { color: var(--muted); font-size: 12.5px; }
    input[type=file] { display: none; }
    ul { list-style: none; margin: 10px 0 0; padding: 0; display: grid; gap: 6px; }
    li {
      display: grid; grid-template-columns: 1fr auto; gap: 12px; align-items: center;
      padding: 8px 12px; border-radius: var(--radius-sm); background: var(--surface); border: 1px solid var(--line);
      font-size: 13px;
    }
    li .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
    li .msg { color: var(--muted); font-size: 12.5px; }
    .spinner { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--line-strong); border-top-color: var(--accent); animation: spin .8s linear infinite; display: inline-block; vertical-align: -2px; margin-right: 6px; }
    @keyframes spin { to { transform: rotate(360deg); } }
  `;

  /** @type {{id:number, name:string, state:'queued'|'working'|'done'|'dup'|'error', msg:string}[]} */
  #jobs = [];
  #queue = Promise.resolve();
  #nextId = 1;

  render() {
    return html`
      <label class="zone" part="zone">
        <span class="ico">${icon('upload')}</span>
        <strong>Drop invoices here, or click to choose</strong>
        <span class="hint">PDF, images (OCR) or text · read entirely in your browser — nothing is uploaded</span>
        <input type="file" multiple accept="${ACCEPT}">
      </label>
      <ul aria-live="polite">${this.#jobs.map((j) => html`
        <li>
          <span class="name" title="${j.name}">${j.name}</span>
          <span class="msg">${j.state === 'working' ? html`<span class="spinner"></span>` : ''}${statusPill(j)}</span>
        </li>`)}
      </ul>`;
  }

  afterRender() {
    const zone = this.$('.zone');
    const input = this.$('input');
    input.addEventListener('change', () => { this.add([...input.files]); input.value = ''; });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('over');
      this.add([...(e.dataTransfer?.files ?? [])]);
    });
  }

  /** Queue files for import (processed one at a time). */
  add(files) {
    for (const file of files) {
      const job = { id: this.#nextId++, name: file.name, state: 'queued', msg: 'Waiting…' };
      this.#jobs.unshift(job);
      this.#queue = this.#queue.then(() => this.#run(job, file));
    }
    this.#jobs = this.#jobs.slice(0, 30);
    this.update();
  }

  async #run(job, file) {
    const set = (state, msg) => { job.state = state; job.msg = msg; this.update(); };
    set('working', 'Starting…');
    try {
      const { status, record } = await importFile(file, (msg) => set('working', msg));
      if (status === 'duplicate') set('dup', `Already imported${record.number ? ` as ${record.number}` : ''}`);
      else {
        const missing = record.extracted?.missing ?? [];
        set('done', missing.length ? `Check: ${missing.join(', ')} not found` : `Read ${record.number || 'invoice'}`);
        this.emit('invoice-imported', { record });
      }
    } catch (err) {
      console.error(err);
      set('error', err?.message || 'Could not read this file');
    }
  }
}

function statusPill(j) {
  const cls = { done: j.msg.startsWith('Check') ? 'warn' : 'ok', dup: '', error: 'danger', working: '', queued: '' }[j.state];
  return j.state === 'working' || j.state === 'queued' ? j.msg : html`<span class="pill ${cls}">${j.msg}</span>`;
}

customElements.define('invoice-upload', InvoiceUpload);
