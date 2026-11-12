// The statement of account template: wording (with {placeholders}), which sections
// appear and in what order, which columns each table shows and what they're called,
// and branding (logo, accent colour, fonts). There is one template, stored in settings.

export const PLACEHOLDERS = [
  { key: 'customer', help: 'Account / customer name' },
  { key: 'company', help: 'Your company name' },
  { key: 'statement_date', help: 'Statement date' },
  { key: 'period', help: 'Period covered' },
  { key: 'currency', help: 'Currency code' },
  { key: 'balance_due', help: 'Balance due, with currency' },
  { key: 'overdue', help: 'Overdue amount, with currency' },
  { key: 'opening_balance', help: 'Opening balance, with currency' },
  { key: 'open_invoices', help: 'Number of unpaid invoices' },
];

export const FONTS = {
  serif: { label: 'Classic serif', stack: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif' },
  traditional: { label: 'Traditional serif', stack: '"Times New Roman", Times, serif' },
  sans: { label: 'Modern sans', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
  humanist: { label: 'Humanist sans', stack: '"Gill Sans", "Gill Sans MT", Seravek, Calibri, "Trebuchet MS", sans-serif' },
  geometric: { label: 'Geometric sans', stack: '"Avenir Next", Avenir, Montserrat, "Century Gothic", sans-serif' },
  arabic: { label: 'Arabic-friendly', stack: '"Noto Naskh Arabic", "Geeza Pro", "Segoe UI", Tahoma, "Arabic Typesetting", sans-serif' },
  mono: { label: 'Monospace', stack: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
};

export const ACCENT_PRESETS = ['#1f5c4a', '#1d4e89', '#7a1f3d', '#8a5a00', '#3b3f8f', '#2b2b2b', '#b4232a', '#00695c'];

const col = (label, visible = true) => ({ label, visible });

/** Sections that can be shown, hidden and reordered. */
export const SECTION_INFO = {
  intro: { name: 'Intro message', hint: 'Shown under the header when it has text.' },
  summary: { name: 'Summary boxes', columnsName: 'Boxes' },
  categories: { name: 'Outstanding by category' },
  items: { name: 'Outstanding items by category' },
  activity: { name: 'Account activity' },
  aging: { name: 'Aged balance', columnsName: 'Buckets' },
  footer: { name: 'Footer note', hint: 'e.g. bank details and payment instructions.' },
};

export const DEFAULT_TEMPLATE = Object.freeze({
  version: 1,
  title: 'Statement of Account',
  intro: '',
  footer: 'Please remit payment of any overdue amounts. Contact us if you have any questions about this statement.',
  header: {
    showCompanyDetails: true,
    accountLabel: 'Account',
    balanceDueLabel: 'Balance due',
    fields: {
      statementDate: col('Statement date'),
      period: col('Period'),
      currency: col('Currency'),
    },
    periodAll: 'All activity to {statement_date}',
  },
  sections: [
    { key: 'intro', visible: true },
    {
      key: 'summary', visible: true,
      columns: { opening: col('Opening balance'), invoiced: col('Invoiced'), credited: col('Payments & credits'), closing: col('Closing balance') },
    },
    {
      key: 'categories', visible: true,
      heading: 'Outstanding by category', subheading: 'as at {statement_date}, on unpaid invoices',
      columns: { category: col('Category'), invoiced: col('Invoiced'), paid: col('Paid & credited'), outstanding: col('Outstanding'), overdue: col('Overdue'), bar: col('Chart') },
    },
    {
      key: 'items', visible: true,
      heading: 'Outstanding items by category', subheading: '',
      columns: { invoice: col('Invoice'), date: col('Date'), due: col('Due'), description: col('Description'), amount: col('Amount'), outstanding: col('Outstanding'), daysOverdue: col('Days overdue') },
    },
    {
      key: 'activity', visible: true,
      heading: 'Account activity', subheading: '{period}', showLineItems: false,
      columns: { date: col('Date'), details: col('Details'), due: col('Due'), charges: col('Charges'), credits: col('Credits'), balance: col('Balance'), status: col('Status') },
    },
    {
      key: 'aging', visible: true,
      heading: 'Aged balance', subheading: '',
      columns: { current: col('Current'), d30: col('1–30 days'), d60: col('31–60 days'), d90: col('61–90 days'), over90: col('90+ days'), total: col('Total due') },
    },
    { key: 'footer', visible: true },
  ],
  labels: {
    invoice: 'Invoice',
    credit: 'Credit note',
    payment: 'Payment',
    broughtForward: 'Balance brought forward',
    totalRow: 'Balance due',
    totalOutstanding: 'Total outstanding',
    unapplied: 'Unapplied payments & credits',
    uncategorised: 'Uncategorised',
    unallocated: 'Unallocated difference',
    noTransactions: 'No transactions in this period.',
    item: 'item',
    items: 'items',
    paid: 'Paid',
    partPaid: 'Part paid',
    open: 'Open',
    overdue: 'Overdue',
    overduePart: 'Part paid · overdue',
  },
  branding: {
    logo: '',
    logoHeight: 56,
    accent: '#1f5c4a',
    headingFont: 'serif',
    bodyFont: 'sans',
  },
});

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** Deep-merge `saved` over `base`, keeping only keys `base` knows about (and their types). */
function mergeKnown(base, saved) {
  if (!isObj(saved)) return structuredClone(base);
  const out = {};
  for (const [k, v] of Object.entries(base)) {
    const s = saved[k];
    if (isObj(v)) out[k] = mergeKnown(v, s);
    else if (Array.isArray(v)) out[k] = structuredClone(v);
    else out[k] = s !== undefined && typeof s === typeof v ? s : v;
  }
  return out;
}

/**
 * A complete, valid template from whatever was saved (possibly older or partial).
 * Unknown keys are dropped, missing ones filled from the defaults, sections keep the
 * saved order and any new sections are appended.
 * @param {object|null|undefined} saved
 * @param {{statementNote?: string}} [legacy]  settings from before templates existed
 */
export function normaliseTemplate(saved, legacy = {}) {
  const t = mergeKnown(DEFAULT_TEMPLATE, saved);
  if (!isObj(saved) && typeof legacy.statementNote === 'string') t.footer = legacy.statementNote;

  const defaults = new Map(DEFAULT_TEMPLATE.sections.map((s) => [s.key, s]));
  const seen = new Set();
  const sections = [];
  for (const s of Array.isArray(saved?.sections) ? saved.sections : []) {
    if (!defaults.has(s?.key) || seen.has(s.key)) continue;
    seen.add(s.key);
    sections.push(mergeKnown(defaults.get(s.key), s));
  }
  for (const d of DEFAULT_TEMPLATE.sections) if (!seen.has(d.key)) sections.push(structuredClone(d));
  t.sections = sections;

  if (!/^#[0-9a-f]{6}$/i.test(t.branding.accent)) t.branding.accent = DEFAULT_TEMPLATE.branding.accent;
  if (!FONTS[t.branding.headingFont]) t.branding.headingFont = DEFAULT_TEMPLATE.branding.headingFont;
  if (!FONTS[t.branding.bodyFont]) t.branding.bodyFont = DEFAULT_TEMPLATE.branding.bodyFont;
  if (t.branding.logo && !/^data:image\/(png|jpeg|webp|gif|svg\+xml);base64,/.test(t.branding.logo)) t.branding.logo = '';
  t.branding.logoHeight = Math.min(160, Math.max(24, Number(t.branding.logoHeight) || 56));
  return t;
}

export const section = (template, key) => template.sections.find((s) => s.key === key);

/** Visible columns of a section, as [key, {label}] pairs in their fixed order. */
export function visibleColumns(sec) {
  return Object.entries(sec?.columns ?? {}).filter(([, c]) => c.visible);
}

/** Replace {placeholders}; unknown ones are left as typed so mistakes are visible. */
export function fill(text, values) {
  return String(text ?? '').replace(/\{(\w+)\}/g, (m, key) => (values[key] != null ? String(values[key]) : m));
}

/**
 * Read or write a value by path. Paths address sections by key:
 *   "title", "branding.accent", "sections.activity.columns.date.label"
 */
export function getPath(template, path) {
  return walk(template, path.split('.'));
}

export function setPath(template, path, value) {
  const parts = path.split('.');
  const last = parts.pop();
  const target = walk(template, parts);
  if (target == null || !(last in target)) throw new Error(`Unknown template field: ${path}`);
  target[last] = value;
  return template;
}

function walk(obj, parts) {
  let cur = obj;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = Array.isArray(cur) ? cur.find((s) => s.key === part) : cur[part];
  }
  return cur;
}

/** Move a section up (-1) or down (+1). */
export function moveSection(template, key, delta) {
  const i = template.sections.findIndex((s) => s.key === key);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= template.sections.length) return template;
  const s = [...template.sections];
  [s[i], s[j]] = [s[j], s[i]];
  template.sections = s;
  return template;
}
