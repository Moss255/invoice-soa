// Turns positioned text fragments (from pdf.js or OCR) into reading-order lines,
// each split into "segments" wherever there is a wide horizontal gap. Keeping the
// segments lets the parser tell `Bill To: Acme` apart from `Invoice #: 42` when the
// two sit side by side on the page.

/**
 * @typedef {{text:string, x0:number, x1:number, y0:number, y1:number, page:number}} Item
 *   y grows downwards (top of page = 0).
 * @typedef {{text:string, x0:number, x1:number}} Segment
 * @typedef {{page:number, y:number, height:number, segments:Segment[], text:string}} Line
 */

/**
 * Normalise digits and separators so the parsers only see ASCII numbers:
 * Arabic-Indic ٠-٩ and Persian ۰-۹ digits, ٫ (decimal) and ٬ (thousands).
 */
export function normaliseText(text) {
  return String(text)
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x06F0))
    .replace(/\u066B/g, '.')
    .replace(/\u066C/g, ',');
}

/**
 * @param {Item[]} items
 * @returns {Line[]}
 */
export function buildLines(items) {
  const words = items.filter((it) => it.text && it.text.trim()).map((it) => ({ ...it, text: normaliseText(it.text) }));
  const pages = new Map();
  for (const w of words) {
    if (!pages.has(w.page)) pages.set(w.page, []);
    pages.get(w.page).push(w);
  }

  const lines = [];
  for (const page of [...pages.keys()].sort((a, b) => a - b)) {
    const pageWords = pages.get(page).sort((a, b) => midY(a) - midY(b) || a.x0 - b.x0);
    /** @type {{y0:number,y1:number,words:Item[]}[]} */
    const rows = [];
    for (const w of pageWords) {
      const h = Math.max(1, w.y1 - w.y0);
      // Join the row whose vertical band overlaps this word's middle.
      const row = rows.find((r) => Math.abs(midY(w) - (r.y0 + r.y1) / 2) < Math.max(h, r.y1 - r.y0) * 0.5);
      if (row) {
        row.words.push(w);
        row.y0 = Math.min(row.y0, w.y0);
        row.y1 = Math.max(row.y1, w.y1);
      } else {
        rows.push({ y0: w.y0, y1: w.y1, words: [w] });
      }
    }
    rows.sort((a, b) => a.y0 - b.y0);

    for (const row of rows) {
      const ws = row.words.sort((a, b) => a.x0 - b.x0);
      const height = Math.max(1, row.y1 - row.y0);
      const segments = [];
      let cur = null;
      for (const w of ws) {
        const gap = cur ? w.x0 - cur.x1 : Infinity;
        if (cur && gap < height * 1.6) {
          // Same segment. Insert a space unless the fragments touch.
          const sep = gap > height * 0.15 && !cur.text.endsWith(' ') && !w.text.startsWith(' ') ? ' ' : '';
          cur.text += sep + w.text;
          cur.x1 = Math.max(cur.x1, w.x1);
        } else {
          cur = { text: w.text, x0: w.x0, x1: w.x1 };
          segments.push(cur);
        }
      }
      for (const s of segments) s.text = s.text.replace(/\s+/g, ' ').trim();
      const segs = segments.filter((s) => s.text);
      if (!segs.length) continue;
      lines.push({ page, y: row.y0, height, segments: segs, text: segs.map((s) => s.text).join('   ') });
    }
  }
  return lines;
}

const midY = (w) => (w.y0 + w.y1) / 2;

/** Plain-text rendering of lines (segments separated by wide gaps). */
export function linesToText(lines) {
  let out = '';
  let page = lines[0]?.page;
  for (const l of lines) {
    if (l.page !== page) { out += '\n'; page = l.page; }
    out += l.text + '\n';
  }
  return out;
}

/** Build lines from plain text (e.g. pasted text): segments split on runs of 3+ spaces or tabs. */
export function linesFromText(text) {
  return normaliseText(text).split(/\r?\n/).map((raw, i) => {
    const segments = [];
    let x = 0;
    for (const part of raw.split(/(\t+| {3,})/)) {
      if (/^(\t+| {3,})$/.test(part) || !part) { x += part.length; continue; }
      segments.push({ text: part.trim(), x0: x, x1: x + part.length });
      x += part.length;
    }
    return { page: 1, y: i, height: 1, segments, text: segments.map((s) => s.text).join('   ') };
  }).filter((l) => l.segments.length);
}
