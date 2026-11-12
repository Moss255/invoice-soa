// Line-item categories.
// A line's category comes from (in order):
//   1. what the user previously chose for the same description ("learned"),
//   2. keyword rules from Settings, written one per line as  `Category: keyword, keyword`,
//   3. otherwise it stays uncategorised.

export const UNCATEGORISED = 'Uncategorised';
export const UNALLOCATED = 'Unallocated difference';

/** Normalised description used to remember choices: lowercase, no numbers or punctuation. */
export function normDesc(description) {
  return String(description ?? '').toLowerCase().replace(/[\d]+/g, ' ').replace(/[^a-z]+/g, ' ').trim();
}

/**
 * @param {string} text  e.g. "Design: logo, brand\nHosting: hosting, server"
 * @returns {{category:string, keywords:string[]}[]}
 */
export function parseRules(text) {
  return String(text ?? '').split(/\r?\n/).map((line) => {
    const i = line.indexOf(':');
    if (i < 1) return null;
    const category = line.slice(0, i).trim();
    const keywords = line.slice(i + 1).split(',').map((k) => k.trim().toLowerCase()).filter(Boolean);
    return category && keywords.length ? { category, keywords } : null;
  }).filter(Boolean);
}

/**
 * @param {string} description
 * @param {{rules?: {category:string, keywords:string[]}[], learned?: Record<string,string>}} ctx
 * @returns {string} category, or '' when nothing matches
 */
export function categorize(description, { rules = [], learned = {} } = {}) {
  const key = normDesc(description);
  if (key && learned[key]) return learned[key];
  const text = ` ${String(description ?? '').toLowerCase().replace(/[^a-z0-9%]+/g, ' ')} `;
  for (const r of rules) {
    if (r.keywords.some((k) => text.includes(` ${k.replace(/[^a-z0-9%]+/g, ' ').trim()}`))) return r.category;
  }
  return '';
}

/** Fill in categories on lines that don't have one yet. */
export function categorizeLines(lines, ctx) {
  return (lines ?? []).map((l) => (l.category ? l : { ...l, category: categorize(l.description, ctx) }));
}

/** Context for categorize() built from saved settings. */
export function categoryContext(settings) {
  return { rules: parseRules(settings.categoryRules), learned: settings.learnedCategories ?? {} };
}

/** Every category name in use or defined, sorted. */
export function knownCategories(transactions, settings) {
  const set = new Set(parseRules(settings.categoryRules).map((r) => r.category));
  for (const v of Object.values(settings.learnedCategories ?? {})) set.add(v);
  for (const t of transactions) for (const l of t.lines ?? []) if (l.category) set.add(l.category);
  set.add('Tax');
  return [...set].sort((a, b) => a.localeCompare(b));
}
