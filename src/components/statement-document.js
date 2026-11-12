// Renders a statement of account as a printable "paper" document, driven by the
// template (wording, sections, columns, branding). Used by <account-statement> and
// the live preview in <template-editor>, so both always look identical.
//
// The paper is always light, whatever the app theme, because it's a document meant
// for printing and for the customer, and branding colours are chosen against white.

import { html, money, amount, plain, date as fmtDate } from '../lib/format.js';
import { UNCATEGORISED, UNALLOCATED } from '../lib/categories.js';
import { FONTS, fill, section, visibleColumns } from '../lib/template.js';

const NUMERIC = new Set(['charges', 'credits', 'balance', 'invoiced', 'paid', 'outstanding', 'overdue', 'amount', 'daysOverdue',
  'current', 'd30', 'd60', 'd90', 'over90', 'total']);
const STATUS_CLASS = { paid: 'ok', 'part-paid': 'accent', open: '', overdue: 'danger', 'overdue-part': 'danger' };
const STATUS_LABEL = { paid: 'paid', 'part-paid': 'partPaid', open: 'open', overdue: 'overdue', 'overdue-part': 'overduePart' };

export const documentCss = new CSSStyleSheet();
documentCss.replaceSync(`
  .paper {
    --ink: #1d2330; --muted: #5f6676; --faint: #8b91a0; --rule: #e2dfd8; --rule-strong: #c9c5bc; --soft: #f6f5f1;
    --danger-ink: #a12d2d; --danger-bg: #f8e4e2; --ok-ink: #2c6e3f; --ok-bg: #e2f1e5;
    --accent-bg: color-mix(in srgb, var(--doc-accent) 12%, white);
    color-scheme: light;
    background: #fff; color: var(--ink); font-family: var(--doc-body); font-size: 13px; line-height: 1.5;
    border: 1px solid var(--line, #e2dfd8); border-radius: 4px; box-shadow: var(--shadow);
    padding: clamp(20px, 5vw, 56px); max-width: 960px; margin: 0 auto;
  }
  .paper * { box-sizing: border-box; }
  .doc-head { display: grid; grid-template-columns: 1fr auto; gap: 24px; align-items: start; }
  .logo { display: block; max-width: 280px; object-fit: contain; object-position: left center; margin-bottom: 10px; }
  .from .name { font-family: var(--doc-heading); font-size: 22px; font-weight: 600; }
  .from .details { white-space: pre-line; color: var(--muted); font-size: 12.5px; margin-top: 4px; }
  .title { text-align: right; }
  .title h1 { font-family: var(--doc-heading); color: var(--doc-accent); font-weight: 500; font-size: 26px; letter-spacing: .02em; margin: 0 0 8px; text-transform: uppercase; }
  .meta { display: grid; grid-template-columns: auto auto; gap: 2px 14px; font-size: 12.5px; justify-content: end; margin: 0; }
  .meta dt { color: var(--muted); text-align: right; }
  .meta dd { margin: 0; text-align: right; font-weight: 500; }
  .to { margin: 28px 0 22px; padding: 12px 0; border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule); display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; align-items: baseline; }
  .lbl { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
  .to .acct { font-family: var(--doc-heading); font-size: 19px; font-weight: 600; }
  .due-box { text-align: right; }
  .due-box .amt { font-family: var(--doc-heading); font-size: 24px; font-weight: 600; font-variant-numeric: tabular-nums; color: var(--doc-accent); }
  .intro { white-space: pre-line; margin: 0 0 22px; }
  .summary { display: grid; grid-template-columns: repeat(var(--boxes, 4), 1fr); border: 1px solid var(--rule); border-radius: 6px; margin-bottom: 26px; }
  .summary > div { padding: 10px 14px; border-left: 1px solid var(--rule); }
  .summary > div:first-child { border-left: 0; }
  .summary .k { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
  .summary .v { font-variant-numeric: tabular-nums; font-weight: 600; font-size: 15px; }
  .summary .closing .v { color: var(--doc-accent); }
  .section-title { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; font-family: var(--doc-heading); color: var(--doc-accent); font-size: 15px; font-weight: 600; margin: 30px 0 8px; }
  .section-title small { font-family: var(--doc-body); font-size: 12px; font-weight: 400; color: var(--muted); }
  .doc-section:first-child .section-title { margin-top: 0; }
  .wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); font-weight: 600; padding: 8px; border-bottom: 1.5px solid var(--doc-accent); }
  th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td { padding: 8px; border-bottom: 1px solid var(--rule); vertical-align: top; }
  tfoot td { border-bottom: 0; border-top: 1.5px solid var(--doc-accent); font-weight: 650; }
  td.strong { font-weight: 600; }
  td.late { color: var(--danger-ink); }
  td.muted, .muted { color: var(--muted); }
  tr.bf td { color: var(--muted); font-style: italic; }
  tr.unapplied td { color: var(--muted); font-style: italic; }
  tr.group td { padding-top: 14px; border-bottom: 1px solid var(--rule-strong); font-weight: 650; }
  tr.group .count { font-weight: 400; color: var(--muted); font-size: 12px; margin-left: 6px; }
  tr.sub td { border-bottom: 0; padding-top: 0; padding-bottom: 3px; font-size: 12px; color: var(--muted); }
  tr.has-sub td { border-bottom: 0; }
  tr.sub + tr:not(.sub) td { border-top: 1px solid var(--rule); }
  .nowrap { white-space: nowrap; }
  .desc { color: var(--muted); font-size: 12px; }
  .tag { display: inline-block; font-size: 10.5px; padding: 0 6px; border-radius: 4px; background: var(--soft); border: 1px solid var(--rule); color: var(--muted); margin-left: 6px; white-space: nowrap; }
  .status { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 600; background: var(--soft); color: var(--muted); white-space: nowrap; }
  .status.ok { background: var(--ok-bg); color: var(--ok-ink); }
  .status.danger { background: var(--danger-bg); color: var(--danger-ink); }
  .status.accent { background: var(--accent-bg); color: var(--doc-accent); }
  .meter { height: 6px; border-radius: 3px; background: var(--rule); overflow: hidden; min-width: 60px; }
  .meter span { display: block; height: 100%; background: var(--doc-accent); border-radius: 3px; }
  .cats td.bar { width: 22%; vertical-align: middle; }
  .footer-note { margin-top: 28px; padding-top: 14px; border-top: 1px solid var(--rule); color: var(--muted); font-size: 12.5px; white-space: pre-line; }
  .placeholder-name { color: var(--faint); font-weight: 400; font-size: 15px; }
  @media (max-width: 640px) {
    .doc-head { grid-template-columns: 1fr; }
    .title, .meta dt, .meta dd { text-align: left; }
    .meta { justify-content: start; }
    .summary { grid-template-columns: 1fr 1fr; }
    .summary > div:nth-child(odd) { border-left: 0; }
    .summary > div:nth-child(n+3) { border-top: 1px solid var(--rule); }
  }
  @media print {
    .paper { border: 0; box-shadow: none; padding: 0; max-width: none; }
    .placeholder-name { display: none; }
    .wrap { overflow: visible; }
  }
`);

/** Values for {placeholders} in template text. */
export function placeholderValues(st, settings, template) {
  const cur = st.currency;
  const statementDate = fmtDate(st.to);
  return {
    customer: st.account,
    company: settings.companyName || '',
    statement_date: statementDate,
    period: st.from ? `${fmtDate(st.from)} – ${statementDate}` : fill(template.header.periodAll, { statement_date: statementDate }),
    currency: cur,
    balance_due: money(st.closing, cur),
    overdue: money(st.aging.total - st.aging.current, cur),
    opening_balance: money(st.opening, cur),
    open_invoices: new Set(st.categories.items.map((i) => i.tx.id)).size,
  };
}

/**
 * @param {object} st         buildStatement() result
 * @param {object} settings   store settings (company name/details)
 * @param {object} template   normaliseTemplate() result
 */
export function renderStatement(st, settings, template) {
  const t = template;
  const v = placeholderValues(st, settings, t);
  const b = t.branding;
  const style = `--doc-accent:${b.accent};--doc-heading:${FONTS[b.headingFont].stack};--doc-body:${FONTS[b.bodyFont].stack}`;
  const ctx = { st, t, v, cur: st.currency };

  return html`
    <article class="paper" style="${style}">
      ${header(ctx, settings)}
      ${t.sections.filter((s) => s.visible).map((s) => {
        const body = SECTIONS[s.key](ctx, s);
        return body ? html`<div class="doc-section" data-section="${s.key}">${body}</div>` : '';
      })}
    </article>`;
}

function header({ st, t, v, cur }, settings) {
  const f = t.header.fields;
  const meta = [
    ['statementDate', v.statement_date],
    ['period', v.period],
    ['currency', cur],
  ].filter(([k]) => f[k].visible);
  return html`
    <header class="doc-head">
      <div class="from">
        ${t.branding.logo ? html`<img class="logo" src="${t.branding.logo}" alt="${settings.companyName || 'Logo'}" style="height:${t.branding.logoHeight}px">` : ''}
        <div class="name">${settings.companyName || html`<span class="placeholder-name">Your company name — set it in Settings</span>`}</div>
        ${t.header.showCompanyDetails && settings.companyDetails ? html`<div class="details">${settings.companyDetails}</div>` : ''}
      </div>
      <div class="title">
        <h1>${fill(t.title, v)}</h1>
        ${meta.length ? html`<dl class="meta">${meta.map(([k, val]) => html`<dt>${fill(f[k].label, v)}</dt><dd>${val}</dd>`)}</dl>` : ''}
      </div>
    </header>
    <section class="to">
      <div><div class="lbl">${fill(t.header.accountLabel, v)}</div><div class="acct">${st.account}</div></div>
      <div class="due-box"><div class="lbl">${fill(t.header.balanceDueLabel, v)}</div><div class="amt">${money(st.closing, cur)}</div></div>
    </section>`;
}

function sectionTitle(sec, v) {
  if (!sec.heading) return '';
  return html`<div class="section-title"><span>${fill(sec.heading, v)}</span>${sec.subheading ? html`<small>${fill(sec.subheading, v)}</small>` : ''}</div>`;
}

/**
 * A table for `cols` (visible [key, {label}] pairs). Each row gives cell contents by
 * column key; `label` (for total/group rows) goes in the first column.
 */
function table(cls, cols, rows, foot, v) {
  if (!cols.length) return '';
  const cell = (row, [k], i) => {
    const content = row.label != null && i === 0 ? row.label : row.cells?.[k];
    const classes = [NUMERIC.has(k) ? 'num' : '', row.classes?.[k] ?? ''].join(' ').trim();
    return html`<td class="${classes}">${content ?? ''}</td>`;
  };
  return html`
    <div class="wrap">
      <table class="${cls}">
        <thead><tr>${cols.map(([k, c]) => html`<th class="${NUMERIC.has(k) ? 'num' : ''}">${fill(c.label, v)}</th>`)}</tr></thead>
        <tbody>${rows.map((row) => html`<tr class="${row.cls ?? ''}">${cols.map((c, i) => cell(row, c, i))}</tr>`)}</tbody>
        ${foot ? html`<tfoot><tr>${cols.map((c, i) => cell(foot, c, i))}</tr></tfoot>` : ''}
      </table>
    </div>`;
}

const categoryName = (name, t) => (name === UNCATEGORISED ? t.labels.uncategorised : name === UNALLOCATED ? t.labels.unallocated : name);
const plural = (n, t) => `${n} ${n === 1 ? t.labels.item : t.labels.items}`;

const SECTIONS = {
  intro({ t, v }) {
    const text = fill(t.intro, v).trim();
    return text ? html`<div class="intro">${text}</div>` : '';
  },

  summary({ st, v, cur }, sec) {
    const values = { opening: st.opening, invoiced: st.invoiced, credited: st.credited, closing: st.closing };
    const boxes = visibleColumns(sec);
    if (!boxes.length) return '';
    return html`<section class="summary" style="--boxes:${boxes.length}">
      ${boxes.map(([k, c]) => html`<div class="${k}"><div class="k">${fill(c.label, v)}</div><div class="v">${money(values[k], cur)}</div></div>`)}
    </section>`;
  },

  categories({ st, t, v, cur }, sec) {
    const c = st.categories;
    if (!c.rows.length && !c.unappliedCredit) return '';
    const max = Math.max(...c.rows.map((r) => r.outstanding), 0.000001);
    const rows = c.rows.map((r) => ({
      cells: {
        category: categoryName(r.category, t),
        invoiced: amount(r.invoiced, cur) || '–',
        paid: amount(r.paid, cur) || '–',
        outstanding: money(r.outstanding, cur),
        overdue: amount(r.overdue, cur) || '–',
        bar: html`<div class="meter"><span style="width:${Math.max(0, (r.outstanding / max) * 100).toFixed(1)}%"></span></div>`,
      },
      classes: { category: 'strong', outstanding: 'strong', overdue: r.overdue > 0 ? 'late' : '', bar: 'bar' },
    }));
    if (c.unappliedCredit) rows.push({ cls: 'unapplied', label: t.labels.unapplied, cells: { outstanding: money(-c.unappliedCredit, cur) } });
    const foot = {
      label: t.labels.totalOutstanding,
      cells: {
        invoiced: amount(c.rows.reduce((s, r) => s + r.invoiced, 0), cur),
        paid: amount(c.rows.reduce((s, r) => s + r.paid, 0), cur),
        outstanding: money(c.total, cur),
        overdue: amount(c.overdue, cur) || '–',
      },
    };
    return html`${sectionTitle(sec, v)}${table('cats', visibleColumns(sec), rows, foot, v)}`;
  },

  items({ st, t, v, cur }, sec) {
    const c = st.categories;
    const open = c.rows.filter((r) => r.outstanding > 0);
    if (!open.length) return '';
    const cols = visibleColumns(sec);
    const rows = [];
    for (const r of open) {
      rows.push({
        cls: 'group',
        label: html`${categoryName(r.category, t)}<span class="count">${plural(r.items, t)}</span>`,
        cells: { outstanding: money(r.outstanding, cur) },
      });
      for (const i of c.items.filter((x) => x.category === r.category).sort((a, b) => a.tx.date.localeCompare(b.tx.date))) {
        rows.push({
          cells: {
            invoice: i.tx.number || '—',
            date: fmtDate(i.tx.date),
            due: fmtDate(i.tx.dueDate),
            description: i.description,
            amount: amount(i.amount, cur),
            outstanding: amount(i.open, cur),
            daysOverdue: i.daysOverdue || '–',
          },
          classes: { invoice: 'strong nowrap', date: 'nowrap', due: 'nowrap', outstanding: 'strong', daysOverdue: i.daysOverdue ? 'late' : '' },
        });
      }
    }
    return html`${sectionTitle(sec, v)}${table('items', cols, rows, null, v)}`;
  },

  activity({ st, t, v, cur }, sec) {
    const kind = (k) => t.labels[k];
    const rows = [];
    if (st.from) rows.push({ cls: 'bf', label: t.labels.broughtForward, cells: { balance: plain(st.opening, cur) } });
    for (const r of st.rows) {
      const showLines = sec.showLineItems && r.tx.lines?.length;
      rows.push({
        cls: showLines ? 'has-sub' : '',
        cells: {
          date: fmtDate(r.tx.date),
          details: html`<span class="strong">${kind(r.tx.kind)}${r.tx.number ? ` ${r.tx.number}` : ''}</span>${r.tx.description ? html`<div class="desc">${r.tx.description}</div>` : ''}`,
          due: r.tx.kind === 'invoice' ? fmtDate(r.tx.dueDate) : '',
          charges: amount(r.debit, cur),
          credits: amount(r.credit, cur),
          balance: plain(r.balance, cur),
          status: r.status ? html`<span class="status ${STATUS_CLASS[r.status]}">${t.labels[STATUS_LABEL[r.status]]}</span>` : '',
        },
        classes: { date: 'nowrap', due: 'nowrap', balance: 'strong' },
      });
      if (showLines) {
        const isInvoice = r.tx.kind === 'invoice';
        const lines = isInvoice && r.lines ? r.lines : r.tx.lines;
        for (const l of lines) {
          const text = html`${l.description || '—'}<span class="tag">${categoryName(l.category || UNCATEGORISED, t)}</span>`;
          rows.push({
            cls: 'sub',
            cells: {
              details: text,
              // If Details is hidden, show the line in the first visible column instead.
              ...(sec.columns.details.visible ? {} : { [visibleColumns(sec)[0]?.[0]]: text }),
              charges: isInvoice ? amount(l.amount, cur) : '',
              credits: isInvoice ? '' : amount(l.amount, cur),
            },
          });
        }
      }
    }
    if (!st.rows.length) rows.push({ label: html`<span class="muted">${t.labels.noTransactions}</span>` });
    const foot = {
      label: t.labels.totalRow,
      cells: { charges: amount(st.invoiced, cur), credits: amount(st.credited, cur), balance: money(st.closing, cur) },
    };
    return html`${sectionTitle(sec, v)}${table('ledger', visibleColumns(sec), rows, foot, v)}`;
  },

  aging({ st, v, cur }, sec) {
    const row = {
      cells: Object.fromEntries(Object.keys(sec.columns).map((k) => [k, money(st.aging[k], cur)])),
      classes: Object.fromEntries(['d30', 'd60', 'd90', 'over90'].map((k) => [k, st.aging[k] > 0 ? 'late' : ''])),
    };
    row.classes.total = 'strong';
    return html`${sectionTitle(sec, v)}${table('aging', visibleColumns(sec), [row], null, v)}`;
  },

  footer({ t, v }) {
    const text = fill(t.footer, v).trim();
    return text ? html`<div class="footer-note">${text}</div>` : '';
  },
};

