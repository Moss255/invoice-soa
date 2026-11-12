// Browser-side text extraction: PDF (pdf.js), images and scanned PDFs (Tesseract OCR,
// lazy-loaded only when needed), and plain text. Everything runs locally in the page.

import { buildLines, linesFromText, linesToText } from './layout.js';
// Vite emits these worker scripts as assets and gives us their URLs.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import tesseractWorkerUrl from 'tesseract.js/dist/worker.min.js?url';

const MAX_OCR_PAGES = 5;

// Both libraries are loaded on first use, so they don't slow down the first page load.
let pdfjsPromise;
function loadPdfjs() {
  pdfjsPromise ??= import('pdfjs-dist').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    return pdfjs;
  });
  return pdfjsPromise;
}

// The OCR worker is bundled; the OCR engine (WASM) and English model are fetched
// from jsDelivr the first time an image or scanned PDF is read.
let ocrWorkerPromise;
function loadOcr(onProgress) {
  ocrWorkerPromise ??= import('tesseract.js').then((mod) => {
    const Tesseract = mod.default ?? mod;
    return Tesseract.createWorker('eng', 1, {
      workerPath: tesseractWorkerUrl,
      workerBlobURL: false,
      logger: (m) => ocrLogger?.(m),
    });
  });
  ocrLogger = onProgress;
  return ocrWorkerPromise;
}
let ocrLogger = null;

export const ACCEPT = '.pdf,application/pdf,image/png,image/jpeg,image/webp,image/gif,image/bmp,.txt,text/plain';

/**
 * @param {File} file
 * @param {(msg:string)=>void} [onProgress]
 * @returns {Promise<{lines: import('./layout.js').Line[], text: string, method: 'pdf'|'ocr'|'text'}>}
 */
export async function extractLines(file, onProgress = () => {}) {
  const type = file.type || guessType(file.name);
  if (type === 'application/pdf') return extractPdf(file, onProgress);
  if (type.startsWith('image/')) {
    onProgress('Reading image (OCR)…');
    const lines = await ocrImage(file, 1, onProgress);
    return { lines, text: linesToText(lines), method: 'ocr' };
  }
  if (type.startsWith('text/')) {
    const lines = linesFromText(await file.text());
    return { lines, text: linesToText(lines), method: 'text' };
  }
  throw new Error(`Unsupported file type: ${type || file.name}`);
}

function guessType(name) {
  const ext = name.toLowerCase().split('.').pop();
  return { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', txt: 'text/plain' }[ext] ?? '';
}

async function extractPdf(file, onProgress) {
  onProgress('Reading PDF…');
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false });
  const doc = await task.promise;
  try {
    const items = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      for (const it of content.items) {
        if (!('str' in it) || !it.str.trim()) continue;
        const tx = pdfjs.Util.transform(vp.transform, it.transform);
        const fontHeight = Math.hypot(tx[2], tx[3]) || it.height || 10;
        const x0 = tx[4];
        const yBase = tx[5];
        items.push({ text: it.str, x0, x1: x0 + (it.width || fontHeight * it.str.length * 0.5), y0: yBase - fontHeight, y1: yBase, page: p });
      }
    }
    const textChars = items.reduce((n, i) => n + i.text.trim().length, 0);
    if (textChars >= 30) {
      const lines = buildLines(items);
      return { lines, text: linesToText(lines), method: 'pdf' };
    }

    // No text layer: a scanned document. Render pages and OCR them.
    const lines = [];
    const pages = Math.min(doc.numPages, MAX_OCR_PAGES);
    for (let p = 1; p <= pages; p++) {
      onProgress(`Scanned PDF — OCR page ${p} of ${pages}…`);
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: 2.5 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      lines.push(...(await ocrImage(canvas, p, onProgress)));
    }
    return { lines, text: linesToText(lines), method: 'ocr' };
  } finally {
    task.destroy();
  }
}

async function ocrImage(image, page, onProgress) {
  onProgress('Loading OCR engine (first time only)…');
  const worker = await loadOcr((m) => {
    if (m.status === 'recognizing text') onProgress(`Recognising text… ${Math.round(m.progress * 100)}%`);
  });
  const { data } = await worker.recognize(image, {}, { blocks: true });
  const items = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs) {
      for (const line of para.lines) {
        for (const w of line.words) {
          if (w.confidence < 30) continue;
          items.push({ text: w.text, x0: w.bbox.x0, x1: w.bbox.x1, y0: line.bbox.y0, y1: line.bbox.y1, page });
        }
      }
    }
  }
  return buildLines(items);
}

/** SHA-256 hex digest, used to skip files that were already imported. */
export async function hashFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Non-secure context (plain http on a LAN address): fall back to FNV-1a.
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193);
  return `fnv-${(h >>> 0).toString(16)}-${bytes.length}`;
}
