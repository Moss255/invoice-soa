# Statement of Accounts

Drop in invoices, check what was read, and produce a statement of account for each customer that breaks down what they owe by category.
Everything runs in the browser: there is no backend. The UI is built only from native web components, and Vite does the dev serving and bundling.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/
npm run preview    # serve dist/ locally
npm test           # unit tests (Vitest)
npm run test:watch # re-run tests as you edit
npm run coverage   # tests plus a coverage report (coverage/index.html)
```

`dist/` uses relative paths, so you can host it on any static host or in a sub-folder, such as GitHub Pages, Netlify or S3.

## Currencies

Each currency uses its own number of decimal places, as defined by ISO 4217. Parsing, allocation, rounding, display, form fields and CSV export all respect this.

- **Bahraini Dinar (BHD)** has 3 decimals: 1 BHD = 1,000 fils.
  - On an invoice in BHD, `12.500` is read as 12.5 dinars, not 12,500.
  - `1,234.500` is read as 1,234.5.
  - BHD is recognised from `BHD`, `BD`, the Arabic symbol `د.ب` and "Bahraini Dinar".
  - Arabic-Indic digits (`١٢٫٥٠٠`) are converted to `12.500`.
- **KWD, OMR and JOD** also use 3 decimals, and **JPY** uses 0.
- **Payments are split exactly.** Allocation works in whole minor units (fils, cents), so splitting a payment across categories never gains or loses a fil.
- **Typed amounts.** In form fields, a single dot is always a decimal point: typing `1.250` gives 1.25 in any currency.

## Tests

| File | What it covers |
| --- | --- |
| `currency.test.js` | Currency decimals, BHD parsing and detection, Arabic-Indic digits, a Bahraini invoice end to end, statements exact to the fil, and formatting |
| `parse.test.js` | Amounts, dates and currencies, plus invoice header fields across several layouts |
| `categories.test.js` | Line-item extraction (with and without a table header), keyword rules and remembered categories, discounts and splitting payments across categories |
| `statement.test.js` | Balance-forward ledger, oldest-first (FIFO) allocation, aging buckets, statuses and summaries |
| `layout-format.test.js` | Turning positioned PDF text into lines, HTML escaping (protection against malicious text in uploads), CSV and dates |
| `store.test.js` | IndexedDB persistence (using fake-indexeddb), remembered categories, rules, backup and restore, and the full import pipeline on a BHD text invoice |
| `components.test.js` | The custom elements rendered in happy-dom: invoice table and line editor, statement, overview, payment and settings dialogs, upload, Zoho import dialog and routing |
| `zoho.test.js` | Zoho Books import against a fake API: mapping invoices, credit notes and payments (discounts, tax-inclusive prices, BHD), paging, rate limits and errors, re-import and void handling, sign-in URLs |

Real PDF and OCR extraction (`extract.js`) needs a browser engine, so unit tests don't cover it. Test it by importing invoices in the running app. Likewise the Zoho sign-in popup and live Zoho API are only exercised in the running app.

In component tests, never assert on DOM nodes directly (`assert.equal(node, null)`): when such an assertion fails, `node:assert` inspects the whole happy-dom window and runs out of memory. Compare strings or booleans instead. `vite.config.js` caps each test worker at 1 GB so a mistake like this fails fast.

## How it works

1. **Upload**: drop PDFs, images or `.txt` files on the Invoices tab.
   - PDFs with a text layer are read with [pdf.js](https://mozilla.github.io/pdf.js/) (`pdfjs-dist`).
   - Images and scanned PDFs go through [Tesseract.js](https://tesseract.projectnaptha.com/) OCR. The OCR worker is bundled, but the OCR engine (WASM) and the English language model are downloaded from jsDelivr the first time OCR is used.
   - Files are hashed, so if you import the same file twice it's skipped.
2. **Extract**: `parse-invoice.js` finds the invoice number, dates, total, currency and parties. `line-items.js` finds the item table and its rows, joining descriptions that wrap onto a second line, plus tax, discount and fee lines, so the lines add up to the invoice total.
3. **Categorise**: each line gets a category:
   - **Remembered.** When you pick a category by hand, it is remembered for lines with the same description, and other uncategorised lines with that description are filled in too.
   - **Keyword rules** in Settings, one per line: `Hosting: hosting, domain, server`.
   - Tax lines go into *Tax* automatically.
4. **Review**: imported rows are marked *Review* until you confirm or edit them. Click **N lines** on a row to edit its line items. The editor shows whether the lines add up to the invoice total, and you can add the difference as a line or re-read the lines from the original file.
5. **Statements**:
   - **Overview**: balances and aging by account, or outstanding amounts by category across every customer.
   - **Customer statement**: the balance-forward ledger, *Outstanding by category* (invoiced, paid and credited, outstanding, overdue), the unpaid items listed under each category, and an aged balance. You can print or save it as a PDF, or export it as CSV.

### How payments are split across categories

- **Payments** are applied to the oldest invoice first. Within that invoice they're spread across its lines in proportion to the line amounts.
- **Credit notes** with categorised lines first reduce open lines of the same category. Anything left over is treated like a payment.
- **Invoice-level discounts** reduce the invoice's goods and services lines in proportion. They don't reduce tax or fees.
- **Lines that don't add up.** If an invoice's lines don't add up to its total, the gap shows as *Unallocated difference*, so the category totals always equal the balance due.

## Importing from Zoho Books

**Invoices → Import from Zoho Books** pulls invoices, credit notes and payments received straight from the Zoho Books API in the browser. There's still no backend: Zoho's API accepts requests from web pages, and you sign in to Zoho in a popup.

### One-time setup

1. Find your Zoho region from the address you use for Zoho Books: `books.zoho.ae` is UAE, `books.zoho.sa` is Saudi Arabia, `books.zoho.com` is United States, and so on.
2. In that region's API console (for example <https://api-console.zoho.ae>), choose **Add client → Client-based Applications**.
   - **Homepage URL** and **JavaScript domain**: where the app runs, such as `http://localhost:5173`.
   - **Authorized redirect URI**: the app's full address, such as `http://localhost:5173/`. The dialog shows the exact values to copy.
   - If the app is used at more than one address (local and hosted), add each one.
3. Paste the **Client ID** into the dialog. It identifies the app to Zoho and isn't a secret. It's saved in Settings and included in backups.

You can change the region and client ID later in the import dialog (**Region & client ID…**) or under **Settings → Zoho Books**. Changing either signs you out of Zoho, so you sign in again on the next import.

### What gets imported

- **Invoices and credit notes** (not drafts or voided ones), with their line items, entity-level discount, tax, shipping, adjustment and rounding as lines, so they add up to the total. Tax-inclusive prices have the tax taken out of the item lines. Category rules and remembered categories apply as for uploads.
- **Payments received**, by reference number (or payment number) and payment mode.
- Only documents dated on or after **Dated from**.
- Importing again updates documents changed in Zoho since the last import, keeps categories you've set on their lines, and removes documents that have since been voided or deleted in Zoho (within the **Dated from** range). Unchanged documents aren't fetched again, which keeps within Zoho's API limits (100 requests a minute, and a daily allowance that depends on your plan).
- Documents whose lines don't add up are marked *Review*. Invoices with the same number as one you uploaded as a file show *Duplicate?*, so you can delete one copy.

If an import says it couldn't read Zoho's response, sign in again: Zoho's "not authorised" replies carry no CORS header, so the browser can't tell them apart from a network failure.

Zoho's sign-in lasts an hour and is kept only for the current browser tab (sessionStorage). It's never stored in IndexedDB or backups. The app asks for read-only access: `ZohoBooks.invoices.READ`, `ZohoBooks.creditnotes.READ`, `ZohoBooks.customerpayments.READ` and `ZohoBooks.settings.READ` (to list organisations).

## Storage

Transactions, settings, remembered categories and the original files are kept in IndexedDB in your browser. Use **Settings → Export backup** to move data between browsers. Backups include line items and categories, but not the original files.

## Layout

```
index.html                 entry point
vite.config.js
styles/theme.css           design tokens (light/dark), inherited through shadow DOM
src/main.js                registers the custom elements
src/components/            <soa-app>, <invoice-upload>, <transaction-table>,
                           <account-overview>, <account-statement>,
                           <payment-dialog>, <settings-dialog>, <zoho-import>
src/lib/extract.js         pdf.js / OCR → positioned text
src/lib/layout.js          positioned text → lines and column segments
src/lib/parse-invoice.js   lines → invoice header fields
src/lib/line-items.js      lines → line items
src/lib/categories.js      keyword rules and remembered categories
src/lib/statement.js       ledger, line-level allocation, aging, category breakdown (minor units)
src/lib/store.js           IndexedDB persistence
src/lib/zoho.js            Zoho Books regions, API client, mapping and sync
src/lib/zoho-auth.js       Zoho sign-in popup (OAuth for client-based apps)
tests/                     node:test unit tests and PDF fixtures
```
