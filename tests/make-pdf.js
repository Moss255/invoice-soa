// Minimal PDF writer for test fixtures: places Helvetica text at given positions.
// Coordinates are from the top-left in points (A4 = 595 x 842).

/**
 * @param {{x:number, y:number, text:string, size?:number, bold?:boolean}[]} items
 * @returns {Uint8Array}
 */
export function makePdf(items) {
  const esc = (s) => s.replace(/[\\()]/g, (c) => '\\' + c);
  const content = items.map(({ x, y, text, size = 10, bold }) =>
    `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${842 - y} Td (${esc(text)}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

/** A handful of differently laid-out invoices, with the values we expect to extract. */
export const SAMPLES = [
  {
    name: 'northwind-1042.pdf',
    expect: { number: 'INV-1042', date: '2026-08-03', dueDate: '2026-09-02', amount: 1980, currency: 'USD', account: 'Contoso Retail LLC', kind: 'invoice' },
    items: [
      { x: 50, y: 60, text: 'Northwind Design Studio', size: 16, bold: true },
      { x: 50, y: 80, text: '12 Harbour Street, Portland OR' },
      { x: 430, y: 60, text: 'INVOICE', size: 20, bold: true },
      { x: 50, y: 140, text: 'Bill To:', bold: true },
      { x: 50, y: 155, text: 'Contoso Retail LLC' },
      { x: 50, y: 170, text: '400 Market Ave, Seattle WA' },
      { x: 360, y: 140, text: 'Invoice #:' },
      { x: 450, y: 140, text: 'INV-1042' },
      { x: 360, y: 155, text: 'Invoice Date:' },
      { x: 450, y: 155, text: 'August 3, 2026' },
      { x: 360, y: 170, text: 'Due Date:' },
      { x: 450, y: 170, text: 'September 2, 2026' },
      { x: 50, y: 230, text: 'Description', bold: true },
      { x: 330, y: 230, text: 'Qty', bold: true },
      { x: 400, y: 230, text: 'Rate', bold: true },
      { x: 480, y: 230, text: 'Amount', bold: true },
      { x: 50, y: 250, text: 'Brand identity refresh' },
      { x: 330, y: 250, text: '1' },
      { x: 400, y: 250, text: '1,500.00' },
      { x: 480, y: 250, text: '1,500.00' },
      { x: 50, y: 265, text: 'Social media templates' },
      { x: 330, y: 265, text: '4' },
      { x: 400, y: 265, text: '120.00' },
      { x: 480, y: 265, text: '480.00' },
      { x: 400, y: 300, text: 'Subtotal' },
      { x: 480, y: 300, text: '$1,980.00' },
      { x: 400, y: 315, text: 'Tax (0%)' },
      { x: 480, y: 315, text: '$0.00' },
      { x: 400, y: 330, text: 'Total Due', bold: true },
      { x: 480, y: 330, text: '$1,980.00', bold: true },
    ],
  },
  {
    name: 'acme-uk-77.pdf',
    expect: { number: '00077', date: '2026-09-14', dueDate: '2026-10-14', amount: 2340.5, currency: 'GBP', account: 'Globex Ltd', kind: 'invoice' },
    items: [
      { x: 50, y: 50, text: 'TAX INVOICE', size: 18, bold: true },
      { x: 50, y: 80, text: 'From: Acme Supplies Ltd' },
      { x: 50, y: 95, text: 'VAT Reg: GB123456789' },
      { x: 50, y: 130, text: 'Invoice No.' },
      { x: 170, y: 130, text: 'Date' },
      { x: 290, y: 130, text: 'Terms' },
      { x: 50, y: 145, text: '00077' },
      { x: 170, y: 145, text: '14/09/2026' },
      { x: 290, y: 145, text: 'Net 30' },
      { x: 50, y: 185, text: 'Invoice to' },
      { x: 50, y: 200, text: 'Globex Ltd' },
      { x: 50, y: 215, text: 'Unit 4, Riverside Park, Leeds' },
      { x: 50, y: 260, text: 'Item' },
      { x: 450, y: 260, text: 'Total' },
      { x: 50, y: 275, text: 'Pallet racking (x3)' },
      { x: 450, y: 275, text: '1,950.42' },
      { x: 330, y: 320, text: 'Net' },
      { x: 450, y: 320, text: '1,950.42' },
      { x: 330, y: 335, text: 'VAT @ 20%' },
      { x: 450, y: 335, text: '390.08' },
      { x: 330, y: 350, text: 'Total GBP' },
      { x: 450, y: 350, text: '£2,340.50' },
    ],
  },
  {
    name: 'credit-note-cn-9.pdf',
    expect: { number: 'CN-9', date: '2026-09-20', amount: 150, currency: 'USD', account: 'Contoso Retail LLC', kind: 'credit' },
    items: [
      { x: 50, y: 60, text: 'Northwind Design Studio', size: 16, bold: true },
      { x: 400, y: 60, text: 'CREDIT NOTE', size: 18, bold: true },
      { x: 50, y: 120, text: 'Customer: Contoso Retail LLC' },
      { x: 360, y: 120, text: 'Credit Note No: CN-9' },
      { x: 360, y: 135, text: 'Date: 2026-09-20' },
      { x: 50, y: 200, text: 'Refund for cancelled social templates' },
      { x: 360, y: 260, text: 'Amount' },
      { x: 450, y: 260, text: '$150.00' },
    ],
  },
  {
    name: 'northwind-1100-services.pdf',
    expect: { number: 'NW-2026-1100', date: '2026-10-05', dueDate: '2026-11-04', amount: 1533.35, currency: 'USD', account: 'Contoso Retail LLC', kind: 'invoice' },
    expectLines: [
      ['Website hosting (annual)', 600],
      ['Support retainer - September includes 10 hours of ad-hoc support', 850],
      ['Domain renewal', 25],
      ['Discount (5%)', -73.75],
      ['Late fee', 20],
      ['Sales Tax 8%', 112.1],
    ],
    items: [
      { x: 50, y: 50, text: 'Northwind Design Studio', size: 16, bold: true },
      { x: 430, y: 50, text: 'INVOICE', size: 20, bold: true },
      { x: 50, y: 110, text: 'Billed to', bold: true },
      { x: 50, y: 125, text: 'Contoso Retail LLC' },
      { x: 360, y: 110, text: 'Invoice No: NW-2026-1100' },
      { x: 360, y: 125, text: 'Issue date: 05 Oct 2026' },
      { x: 360, y: 140, text: 'Payment terms: Net 30' },
      { x: 50, y: 200, text: 'Item Description', bold: true },
      { x: 320, y: 200, text: 'Hours', bold: true },
      { x: 390, y: 200, text: 'Rate', bold: true },
      { x: 480, y: 200, text: 'Line Total', bold: true },
      { x: 50, y: 220, text: 'Website hosting (annual)' },
      { x: 320, y: 220, text: '1' },
      { x: 390, y: 220, text: '600.00' },
      { x: 480, y: 220, text: '600.00' },
      { x: 50, y: 236, text: 'Support retainer - September' },
      { x: 320, y: 236, text: '10' },
      { x: 390, y: 236, text: '85.00' },
      { x: 480, y: 236, text: '850.00' },
      { x: 50, y: 248, text: 'includes 10 hours of ad-hoc support', size: 8 },
      { x: 50, y: 264, text: 'Domain renewal' },
      { x: 320, y: 264, text: '1' },
      { x: 390, y: 264, text: '25.00' },
      { x: 480, y: 264, text: '25.00' },
      { x: 390, y: 300, text: 'Subtotal' },
      { x: 480, y: 300, text: '1,475.00' },
      { x: 390, y: 315, text: 'Discount (5%)' },
      { x: 480, y: 315, text: '-73.75' },
      { x: 390, y: 330, text: 'Late fee' },
      { x: 480, y: 330, text: '20.00' },
      { x: 390, y: 345, text: 'Sales Tax 8%' },
      { x: 480, y: 345, text: '112.10' },
      { x: 390, y: 365, text: 'Total', bold: true },
      { x: 480, y: 365, text: '$1,533.35', bold: true },
      { x: 50, y: 420, text: 'Thank you for your business.' },
    ],
  },
  {
    name: 'al-noor-bhd-0412.pdf',
    expect: { number: 'ANT/2026/0412', date: '2026-10-15', dueDate: '2026-11-14', amount: 1100, currency: 'BHD', account: 'Gulf Hospitality Co. B.S.C.', supplier: 'Al Noor Trading W.L.L.', kind: 'invoice' },
    expectLines: [
      ['Kitchen equipment servicing', 251],
      ['Replacement parts - compressor', 742.75],
      ['Delivery charges', 6.25],
      ['VAT 10%', 100],
    ],
    items: [
      { x: 50, y: 50, text: 'Al Noor Trading W.L.L.', size: 15, bold: true },
      { x: 50, y: 68, text: 'Building 1021, Road 3618, Seef, Kingdom of Bahrain' },
      { x: 400, y: 50, text: 'TAX INVOICE', size: 18, bold: true },
      { x: 50, y: 84, text: 'VAT Reg No: 200012345600002' },
      { x: 50, y: 130, text: 'Bill To:', bold: true },
      { x: 50, y: 145, text: 'Gulf Hospitality Co. B.S.C.' },
      { x: 50, y: 160, text: 'Manama, Bahrain' },
      { x: 340, y: 130, text: 'Invoice No:' },
      { x: 430, y: 130, text: 'ANT/2026/0412' },
      { x: 340, y: 145, text: 'Invoice Date:' },
      { x: 430, y: 145, text: '15/10/2026' },
      { x: 340, y: 160, text: 'Due Date:' },
      { x: 430, y: 160, text: '14/11/2026' },
      { x: 50, y: 210, text: 'Description', bold: true },
      { x: 290, y: 210, text: 'Qty', bold: true },
      { x: 340, y: 210, text: 'Unit Price (BHD)', bold: true },
      { x: 470, y: 210, text: 'Amount (BHD)', bold: true },
      { x: 50, y: 230, text: 'Kitchen equipment servicing' },
      { x: 290, y: 230, text: '2' },
      { x: 340, y: 230, text: '125.500' },
      { x: 470, y: 230, text: '251.000' },
      { x: 50, y: 246, text: 'Replacement parts - compressor' },
      { x: 290, y: 246, text: '1' },
      { x: 340, y: 246, text: '742.750' },
      { x: 470, y: 246, text: '742.750' },
      { x: 50, y: 262, text: 'Delivery charges' },
      { x: 290, y: 262, text: '1' },
      { x: 340, y: 262, text: '6.250' },
      { x: 470, y: 262, text: '6.250' },
      { x: 340, y: 300, text: 'Subtotal' },
      { x: 470, y: 300, text: '1,000.000' },
      { x: 340, y: 315, text: 'VAT 10%' },
      { x: 470, y: 315, text: '100.000' },
      { x: 340, y: 335, text: 'Total Amount Due (BHD)', bold: true },
      { x: 470, y: 335, text: 'BD 1,100.000', bold: true },
      { x: 50, y: 380, text: 'Please pay by bank transfer to IBAN BH67 BMAG 0000 1299 1234 56' },
    ],
  },
];

/** The same samples as positioned text items (what pdf.js would hand the layout step). */
export function sampleItems(sample) {
  return sample.items.map(({ x, y, text, size = 10 }) => ({
    text, page: 1, x0: x, x1: x + text.length * size * 0.52, y0: y - size, y1: y,
  }));
}
