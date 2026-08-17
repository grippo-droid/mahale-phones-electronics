import * as Print from 'expo-print';
import { Directory, File, Paths } from 'expo-file-system';

import type { BusinessDetails } from '@/constants/business';
import { stateCodeFor } from '@/constants/states';
import type { BillWithItems } from '@/db/bills';
import type { BillItemRow } from '@/db/schema';
import { formatDate } from '@/lib/format';
import { supplyTypeFor } from '@/lib/gst';
import { invoiceNumberToFileName } from '@/lib/invoiceNumber';
import { logoExists } from '@/lib/logo';
import { rupeesInWords } from '@/lib/numberToWords';

/**
 * The bill as a PDF (T4.2).
 *
 * This module renders a bill that has ALREADY been written to the database. It
 * does no arithmetic of its own — every figure it prints is read from the
 * stored `bills` and `bill_items` rows. That is deliberate: the customer's copy
 * and the shop's record must be the same document, and the way they stop being
 * the same is a template that recalculates.
 *
 * ---------------------------------------------------------------------------
 * NOTHING INTERNAL GOES ON THIS PAGE.
 *
 * `products.purchase_price` must never appear here. It cannot: this renders
 * from `bill_items`, which has no column for it. Keep it that way — do not
 * "enrich" a bill by joining back to `products` to print anything.
 * ---------------------------------------------------------------------------
 */

/** Where generated bills are kept, inside the document directory. */
const BILL_DIRECTORY_NAME = 'bills';

/** A4 at 72 PPI. Indian invoices are A4, not US Letter (expo-print's default). */
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

/**
 * Escapes text for HTML.
 *
 * Customer names and addresses are free text typed at a counter, and they land
 * in this template. An ampersand in "Sharma & Sons" would break the markup;
 * anything sharper would be worse.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A stored value that is still a placeholder is printed as nothing.
 *
 * A customer's invoice reading `PLACEHOLDER_CITY` is worse than one with a gap
 * where the city should be — the gap is obviously incomplete, the placeholder
 * looks like a system fault.
 */
function real(value: string | null | undefined): string {
  if (!value) return '';
  return value.startsWith('PLACEHOLDER') ? '' : value;
}

/** Money for the page. Grouped the Indian way, always two decimals. */
function money(amount: number): string {
  return amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ---------------------------------------------------------------------------
// Pieces of the invoice
// ---------------------------------------------------------------------------

/** A state's name with its GST code, e.g. "Madhya Pradesh (23)". */
function stateWithCode(state: string): string {
  const clean = real(state);
  if (!clean) return '';
  const code = stateCodeFor(clean);
  return code ? `${clean} (${code})` : clean;
}

/**
 * True when the bill was taxed as inter-state.
 *
 * Read from the stored figures rather than by re-comparing the states: the bill
 * records how it WAS taxed, and if the shop's state has since been corrected in
 * Settings, a reprint must still show what the customer was actually charged.
 *
 * A bill of entirely 0%-rated goods carries no tax under any head, so the
 * figures cannot say which it was. That one case falls back to comparing the
 * states — which is safe precisely because there is no tax to get wrong; only
 * the column heading differs.
 */
export function isInterStateBill(bill: BillWithItems, businessState: string): boolean {
  if (bill.igst_total > 0) return true;
  if (bill.cgst_total > 0 || bill.sgst_total > 0) return false;
  return supplyTypeFor(businessState, bill.customer_state) === 'inter-state';
}

type RateRow = {
  gstRate: number;
  taxableValue: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
};

/**
 * The rate-wise tax summary, built from the STORED line items.
 *
 * `lib/gst.ts` has `summariseByRate`, but it works on freshly calculated lines.
 * This groups what was actually saved, so a reprint years later shows the same
 * figures even if the calculation has changed since.
 */
export function summariseStoredItems(items: BillItemRow[]): RateRow[] {
  const byRate = new Map<number, RateRow>();

  for (const item of items) {
    const existing = byRate.get(item.gst_rate_snapshot) ?? {
      gstRate: item.gst_rate_snapshot,
      taxableValue: 0,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
    };

    byRate.set(item.gst_rate_snapshot, {
      gstRate: item.gst_rate_snapshot,
      taxableValue: round2(existing.taxableValue + item.taxable_value),
      cgstAmount: round2(existing.cgstAmount + item.cgst_amount),
      sgstAmount: round2(existing.sgstAmount + item.sgst_amount),
      igstAmount: round2(existing.igstAmount + item.igst_amount),
    });
  }

  return [...byRate.values()].sort((a, b) => a.gstRate - b.gstRate);
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// ---------------------------------------------------------------------------
// The template
// ---------------------------------------------------------------------------

export type RenderOptions = {
  /**
   * The logo as a `data:` URI, already read from disk.
   *
   * Passed in rather than read here so this function stays pure and testable,
   * and — more importantly — because a `file://` image is not reliably loadable
   * inside the WebView `expo-print` renders through. Embedding the bytes
   * removes the question entirely. `generateBillPdf` does the reading.
   */
  logoDataUri?: string | null;
};

export function renderBillHtml(
  bill: BillWithItems,
  business: BusinessDetails,
  options: RenderOptions = {}
): string {
  const interState = isInterStateBill(bill, business.state);
  const rateRows = summariseStoredItems(bill.items);

  const businessAddress = [
    real(business.addressLine1),
    real(business.addressLine2),
    [real(business.city), real(business.pincode)].filter(Boolean).join(' - '),
  ]
    .filter(Boolean)
    .map(escapeHtml)
    .join('<br>');

  const contact = [
    real(business.phone) ? `Phone: ${real(business.phone)}` : '',
    real(business.email),
  ]
    .filter(Boolean)
    .map(escapeHtml)
    .join(' &nbsp;·&nbsp; ');

  // Only embedded when the caller managed to read it. A path can outlive its
  // file across a restore, and a broken image on an invoice looks like a fault.
  const logo = options.logoDataUri
    ? `<img class="logo" src="${escapeHtml(options.logoDataUri)}" alt="">`
    : '';

  const bank = [
    real(business.bankName),
    real(business.bankAccountNumber) ? `A/c: ${real(business.bankAccountNumber)}` : '',
    real(business.bankIfsc) ? `IFSC: ${real(business.bankIfsc)}` : '',
  ].filter(Boolean);

  const itemRows = bill.items
    .map((item, index) => {
      const rateEach = item.qty > 0 ? item.taxable_value / item.qty : 0;
      return `
        <tr>
          <td class="c">${index + 1}</td>
          <td>${escapeHtml(item.product_name_snapshot)}</td>
          <td class="c">${escapeHtml(item.hsn_code_snapshot ?? '—')}</td>
          <td class="r">${item.qty}</td>
          <td class="r">${money(rateEach)}</td>
          <td class="r">${money(item.taxable_value)}</td>
          <td class="c">${item.gst_rate_snapshot}%</td>
          <td class="r">${money(item.cgst_amount + item.sgst_amount + item.igst_amount)}</td>
          <td class="r">${money(item.line_total)}</td>
        </tr>`;
    })
    .join('');

  const rateSummaryRows = rateRows
    .map(
      (row) => `
        <tr>
          <td class="c">${row.gstRate}%</td>
          <td class="r">${money(row.taxableValue)}</td>
          ${
            interState
              ? `<td class="r">${money(row.igstAmount)}</td>`
              : `<td class="r">${money(row.cgstAmount)}</td><td class="r">${money(row.sgstAmount)}</td>`
          }
        </tr>`
    )
    .join('');

  const taxLines = interState
    ? `<tr><td>IGST</td><td class="r">${money(bill.igst_total)}</td></tr>`
    : `<tr><td>CGST</td><td class="r">${money(bill.cgst_total)}</td></tr>
       <tr><td>SGST</td><td class="r">${money(bill.sgst_total)}</td></tr>`;

  // Shown only when it is not zero, matching the on-screen summary panel.
  const roundOffLine =
    bill.round_off !== 0
      ? `<tr><td>Round Off</td><td class="r">${bill.round_off > 0 ? '+' : '−'}${money(
          Math.abs(bill.round_off)
        )}</td></tr>`
      : '';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, 'Helvetica Neue', Roboto, Arial, sans-serif;
    font-size: 10px;
    color: #111;
    margin: 0;
    padding: 24px;
    -webkit-print-color-adjust: exact;
  }
  .title { text-align: center; font-size: 15px; font-weight: 700; letter-spacing: 1px;
           text-transform: uppercase; margin-bottom: 10px; }
  .frame { border: 1px solid #333; }
  .head { display: flex; gap: 12px; padding: 10px; border-bottom: 1px solid #333; align-items: flex-start; }
  .logo { width: 56px; height: 56px; object-fit: contain; }
  .shop-name { font-size: 14px; font-weight: 700; }
  .muted { color: #555; }
  .gstin { font-weight: 700; margin-top: 3px; }

  .meta { display: flex; border-bottom: 1px solid #333; }
  .meta > div { flex: 1; padding: 8px 10px; }
  .meta > div + div { border-left: 1px solid #333; }
  .label { color: #555; font-size: 9px; text-transform: uppercase; letter-spacing: 0.4px; }
  .value { font-weight: 700; font-size: 11px; }

  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 5px 6px; border-bottom: 1px solid #ddd; }
  thead th { background: #f0f2f4; border-bottom: 1px solid #333; text-align: left;
             font-size: 9px; text-transform: uppercase; letter-spacing: 0.3px; }

  /* Pagination. A bill with enough lines runs past one A4 page, and the
     defaults break it badly: the column headings appear only on page one, a
     row can be sliced through the middle, and the totals block can end up
     orphaned on a page of its own. */
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  .foot { page-break-inside: avoid; break-inside: avoid; }
  .sign { page-break-inside: avoid; break-inside: avoid; }
  td.r, th.r { text-align: right; }
  td.c, th.c { text-align: center; }

  .foot { display: flex; border-top: 1px solid #333; }
  .foot-left { flex: 1.3; padding: 10px; border-right: 1px solid #333; }
  .foot-right { flex: 1; padding: 10px; }
  .totals { width: 100%; }
  .totals td { border: none; padding: 3px 0; }
  .grand td { border-top: 1px solid #333; font-weight: 700; font-size: 13px; padding-top: 6px; }
  .words { margin-top: 6px; font-style: italic; }
  .sign { margin-top: 34px; text-align: right; padding: 0 10px 10px; }
  .sign-line { border-top: 1px solid #333; display: inline-block; padding-top: 4px; min-width: 150px;
               text-align: center; }
  .note { margin-top: 10px; font-size: 9px; color: #555; text-align: center; }
  .sub { font-size: 9px; font-weight: 700; text-transform: uppercase; color: #555; margin-bottom: 4px; }
</style>
</head>
<body>
  <div class="title">Tax Invoice</div>

  <div class="frame">
    <div class="head">
      ${logo}
      <div style="flex:1">
        <div class="shop-name">${escapeHtml(real(business.name))}</div>
        <div class="muted">${businessAddress}</div>
        ${contact ? `<div class="muted">${contact}</div>` : ''}
        ${real(business.gstin) ? `<div class="gstin">GSTIN: ${escapeHtml(real(business.gstin))}</div>` : ''}
        ${
          real(business.state)
            ? `<div class="muted">State: ${escapeHtml(stateWithCode(business.state))}</div>`
            : ''
        }
      </div>
    </div>

    <div class="meta">
      <div>
        <div class="label">Invoice No.</div>
        <div class="value">${escapeHtml(bill.invoice_number)}</div>
      </div>
      <div>
        <div class="label">Date</div>
        <div class="value">${escapeHtml(formatDate(bill.date))}</div>
      </div>
      <div>
        <div class="label">Place of Supply</div>
        <div class="value">${escapeHtml(stateWithCode(bill.customer_state))}</div>
      </div>
    </div>

    <div class="meta">
      <div>
        <div class="sub">Billed to</div>
        <div class="value">${escapeHtml(bill.customer_name)}</div>
        ${bill.customer_address ? `<div class="muted">${escapeHtml(bill.customer_address)}</div>` : ''}
        <div class="muted">Phone: ${escapeHtml(bill.customer_phone)}</div>
        ${bill.customer_gstin ? `<div class="gstin">GSTIN: ${escapeHtml(bill.customer_gstin)}</div>` : ''}
        <div class="muted">State: ${escapeHtml(stateWithCode(bill.customer_state))}</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th class="c">#</th>
          <th>Description</th>
          <th class="c">HSN</th>
          <th class="r">Qty</th>
          <th class="r">Rate</th>
          <th class="r">Taxable</th>
          <th class="c">GST</th>
          <th class="r">Tax</th>
          <th class="r">Amount</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <div class="foot">
      <div class="foot-left">
        <div class="sub">Tax summary</div>
        <table>
          <thead>
            <tr>
              <th class="c">Rate</th>
              <th class="r">Taxable</th>
              ${interState ? '<th class="r">IGST</th>' : '<th class="r">CGST</th><th class="r">SGST</th>'}
            </tr>
          </thead>
          <tbody>${rateSummaryRows}</tbody>
        </table>

        <div class="words">
          <span class="label">Amount in words</span><br>
          ${escapeHtml(rupeesInWords(bill.grand_total))}
        </div>

        ${
          bank.length > 0
            ? `<div style="margin-top:8px">
                 <div class="sub">Bank details</div>
                 <div class="muted">${bank.map(escapeHtml).join('<br>')}</div>
               </div>`
            : ''
        }
      </div>

      <div class="foot-right">
        <table class="totals">
          <tr><td>Taxable Value</td><td class="r">${money(bill.subtotal)}</td></tr>
          ${taxLines}
          ${roundOffLine}
          <tr class="grand"><td>Grand Total</td><td class="r">₹${money(bill.grand_total)}</td></tr>
        </table>
      </div>
    </div>

    <div class="sign">
      <div class="sign-line">
        For ${escapeHtml(real(business.name))}<br>
        <span class="muted">Authorised Signatory</span>
      </div>
    </div>
  </div>

  <div class="note">This is a computer-generated invoice.</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Generating the file
// ---------------------------------------------------------------------------

/** Lookup table for base64 decoding, built once rather than per character. */
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = (() => {
  const table = new Uint8Array(256).fill(255);
  for (let i = 0; i < BASE64_ALPHABET.length; i++) {
    table[BASE64_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/**
 * Decodes base64 into bytes.
 *
 * Written out rather than relying on `atob`, which is not guaranteed across
 * JS engines, and on `Buffer`, which React Native does not provide.
 */
export function base64ToBytes(base64: string): Uint8Array {
  let length = 0;
  // Count the real characters first so the output is sized exactly, ignoring
  // padding and any line breaks the encoder inserted.
  for (let i = 0; i < base64.length; i++) {
    if (BASE64_LOOKUP[base64.charCodeAt(i)] !== 255) length++;
  }

  const bytes = new Uint8Array(Math.floor((length * 3) / 4));
  let accumulator = 0;
  let bits = 0;
  let out = 0;

  for (let i = 0; i < base64.length; i++) {
    const value = BASE64_LOOKUP[base64.charCodeAt(i)];
    if (value === 255) continue;

    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[out++] = (accumulator >> bits) & 0xff;
    }
  }

  return bytes;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/**
 * Reads the logo into a `data:` URI, or null if there isn't a usable one.
 *
 * A failure here must never stop a bill being produced — a missing logo is a
 * cosmetic problem, an unissued invoice is not.
 */
export async function readLogoDataUri(logoPath: string | null): Promise<string | null> {
  if (!logoPath || !logoExists(logoPath)) return null;

  try {
    const file = new File(logoPath);
    const extension = Object.keys(MIME_BY_EXTENSION).find((ext) =>
      logoPath.toLowerCase().endsWith(ext)
    );
    const mime = extension ? MIME_BY_EXTENSION[extension] : 'image/png';
    return `data:${mime};base64,${await file.base64()}`;
  } catch {
    return null;
  }
}

/**
 * The bill's HTML with its logo already embedded, ready to hand to
 * `Print.printAsync({ html })`.
 *
 * Printing goes through HTML rather than through the generated PDF file on
 * purpose. `expo-print`'s Android `{ uri }` path resumes its coroutine as soon
 * as the job is handed to the system PrintManager, and then resumes it a second
 * time from `onWrite` if anything goes wrong — an "Already resumed"
 * IllegalStateException thrown on a background thread, which is an uncaught
 * native crash rather than a JavaScript error. The `{ html }` path resumes
 * exactly once, in its render callback.
 *
 * The output is identical either way: `generateBillPdf` renders this same HTML.
 */
export async function buildBillHtml(
  bill: BillWithItems,
  business: BusinessDetails
): Promise<string> {
  return renderBillHtml(bill, business, {
    logoDataUri: await readLogoDataUri(business.logoPath),
  });
}

/**
 * Renders the bill to a PDF and returns its path.
 *
 * `expo-print` writes to a cache file with a random name. It is moved into the
 * document directory under the invoice number, for two reasons: the cache is
 * cleared by Android under storage pressure, and a share sheet showing
 * `MPE-2026-27-0001.pdf` is far more use to a customer than one showing
 * `3a7f9c2b-....pdf`.
 *
 * The invoice number contains slashes, which are path separators — hence
 * `invoiceNumberToFileName`, which has exactly one definition for that mapping.
 */
export async function generateBillPdf(
  bill: BillWithItems,
  business: BusinessDetails
): Promise<string> {
  const html = await buildBillHtml(bill, business);

  // The bytes are asked for rather than the file being moved. `expo-print`
  // writes its output to the *host* app's cache directory, which under Expo Go
  // is outside this experience's sandbox — and `File.move`/`File.copy` validate
  // READ permission against the sandbox, so moving that file is rejected with
  // "Missing 'READ' permission for accessing the file". `base64` is encoded
  // natively inside expo-print, so it never crosses that boundary.
  const printed = await Print.printToFileAsync({
    html,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    base64: true,
  });

  if (!printed.base64) {
    throw new Error('The bill was rendered but its contents could not be read back.');
  }

  const directory = new Directory(Paths.document, BILL_DIRECTORY_NAME);
  if (!directory.exists) directory.create({ intermediates: true });

  const destination = new File(directory, `${invoiceNumberToFileName(bill.invoice_number)}.pdf`);

  // Regenerating a bill (a reshare, or a retry after a failure) must not fail
  // on a file that is already there.
  if (destination.exists) destination.delete();
  destination.create();
  destination.write(base64ToBytes(printed.base64));

  return destination.uri;
}

/** The PDF for a bill, if one has already been generated. */
export function existingBillPdf(invoiceNumber: string): string | null {
  try {
    const file = new File(
      new Directory(Paths.document, BILL_DIRECTORY_NAME),
      `${invoiceNumberToFileName(invoiceNumber)}.pdf`
    );
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}
