import * as Print from 'expo-print';
import { Directory, File, Paths } from 'expo-file-system';

import type { BusinessDetails } from '@/constants/business';
import {
  DOCUMENT_STYLES,
  escapeHtml,
  money,
  real,
  shopHeaderHtml,
  stateWithCode,
} from '@/lib/documentChrome';
import type { BillWithItems } from '@/db/bills';
import { listPayments, type BillPayment } from '@/db/payments';
import type { BillItemRow } from '@/db/schema';
import { formatDate } from '@/lib/format';
import { supplyTypeFor } from '@/lib/gst';
import { invoiceNumberToFileName } from '@/lib/invoiceNumber';
import { logoExists } from '@/lib/logo';
import { rupeesInWords } from '@/lib/numberToWords';
import { paymentTotalsFor } from '@/lib/payment';
import { formatQuantityWithUnit } from '@/lib/units';

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

// Escaping, placeholder handling, money and state formatting all live in
// lib/documentChrome.ts now, shared with the quotation template so the two
// documents cannot format the same shop differently. Re-exported because
// callers and tests already import escapeHtml from here.
export { escapeHtml };

// ---------------------------------------------------------------------------
// Pieces of the invoice
// ---------------------------------------------------------------------------

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
  /**
   * The bill's payment ledger (T9.3). Passed in for the same reason the logo
   * is: this function stays pure, and `buildBillHtml` does the reading.
   *
   * An EMPTY list prints nothing at all. An invoice with no payment recorded
   * must look exactly as it did before this existed — the document should not
   * start asserting something about money that nobody entered.
   */
  payments?: BillPayment[];
  /**
   * When the payments block was drawn. Defaults to now.
   *
   * A parameter so the output is reproducible in a test, and so the date is
   * decided once rather than by whenever the template happens to run.
   */
  renderedAt?: Date;
};

/**
 * Styles for the payments block, kept here rather than in `documentChrome`.
 *
 * A quotation has no payments and never will, and the shared module is
 * deliberately only the chrome the two documents have in common.
 */
const PAYMENT_STYLES = `
  .payments { margin-top: 18px; padding: 10px; border: 1px solid #333;
              page-break-inside: avoid; break-inside: avoid; }
  .pay { width: 60%; }
  .pay td, .pay th { padding: 3px 6px; }
  .pay-total td { border-top: 1px solid #333; font-weight: 700; }
  .pay-standing { margin-top: 6px; font-weight: 700; }
  .pay-asat { margin-top: 2px; font-size: 9px; }
`;

export function renderBillHtml(
  bill: BillWithItems,
  business: BusinessDetails,
  options: RenderOptions = {}
): string {
  const interState = isInterStateBill(bill, business.state);
  const rateRows = summariseStoredItems(bill.items);

  const bank = [
    real(business.bankName),
    real(business.bankAccountNumber) ? `A/c: ${real(business.bankAccountNumber)}` : '',
    real(business.bankIfsc) ? `IFSC: ${real(business.bankIfsc)}` : '',
  ].filter(Boolean);

  /**
   * What has been received, and when (T9.3).
   *
   * ---------------------------------------------------------------------------
   * This is the one part of the document that can change after the bill is
   * issued, and it is deliberately kept apart from the invoice because of that.
   *
   * Everything above is fixed the moment the bill is saved: the same figures
   * print the same way for ever, which is the whole reason this module renders
   * from the STORED bill and never recalculates. A payment ledger is not like
   * that — another instalment arrives and the same invoice number produces a
   * different page. So the block sits BELOW the signature, under its own
   * heading, and carries the date it was drawn. Without that date two copies in
   * a customer's hand contradict each other with nothing to explain why; with
   * it, they are two statements made at different times, which is what they are.
   *
   * It prints only when something has actually been recorded. A bill with an
   * empty ledger renders exactly as it did before this existed.
   * ---------------------------------------------------------------------------
   */
  const payments = options.payments ?? [];
  const paymentsBlock =
    payments.length === 0
      ? ''
      : (() => {
          const totals = paymentTotalsFor(
            bill.grand_total,
            payments.map((payment) => payment.amount)
          );

          const rows = payments
            .map(
              (payment) => `
                <tr>
                  <td>${
                    // NULL only for entries migration 010 created, from a bill
                    // already marked paid before the ledger existed. The amount
                    // was recorded; the date never was, and printing a guess
                    // here would put a date on the customer's copy that nobody
                    // ever entered.
                    payment.paid_on ? escapeHtml(formatDate(payment.paid_on)) : '&mdash;'
                  }</td>
                  <td class="r">${money(payment.amount)}</td>
                </tr>`
            )
            .join('');

          const standing =
            totals.state === 'paid'
              ? totals.overpaidBy > 0
                ? `Paid in full &mdash; ₹${money(totals.overpaidBy)} received above the invoice total`
                : 'Paid in full'
              : totals.state === 'partial'
                ? `Part paid &mdash; ₹${money(totals.outstanding)} outstanding`
                : `Nothing outstanding has been received &mdash; ₹${money(totals.outstanding)} due`;

          return `
            <div class="payments">
              <div class="sub">Payments received</div>
              <table class="pay">
                <thead>
                  <tr><th>Date</th><th class="r">Amount</th></tr>
                </thead>
                <tbody>${rows}</tbody>
                <tfoot>
                  <tr class="pay-total">
                    <td>Total received</td>
                    <td class="r">₹${money(totals.paidAmount)}</td>
                  </tr>
                </tfoot>
              </table>
              <div class="pay-standing">${standing}</div>
              <div class="muted pay-asat">As at ${escapeHtml(
                formatDate(options.renderedAt ?? new Date())
              )}. Payments recorded after this date are not shown.</div>
            </div>`;
        })();

  const itemRows = bill.items
    .map((item, index) => {
      const rateEach = item.qty > 0 ? item.taxable_value / item.qty : 0;
      return `
        <tr>
          <td class="c">${index + 1}</td>
          <td>${escapeHtml(item.product_name_snapshot)}</td>
          <td class="c">${escapeHtml(item.hsn_code_snapshot ?? '—')}</td>
          <td class="r">${escapeHtml(formatQuantityWithUnit(item.qty, item.unit))}</td>
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
<style>${DOCUMENT_STYLES}${PAYMENT_STYLES}</style>
</head>
<body>
  <div class="title">Tax Invoice</div>

  <div class="frame">
    ${shopHeaderHtml(business, options.logoDataUri ?? null)}

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
        ${
          // Name and phone are optional (T9.5). A line printed empty, or a
          // "Phone:" label with nothing after it, reads as a fault on a GST
          // invoice — worse than the absence it is trying to show. On screen
          // the name slot gets a muted "No name" instead, because a list row
          // needs something there; a document does not.
          //
          // This block never dangles: the place of supply always prints below,
          // because the state is still required and decides the tax heads.
          bill.customer_name.trim()
            ? `<div class="value">${escapeHtml(bill.customer_name)}</div>`
            : ''
        }
        ${bill.customer_address ? `<div class="muted">${escapeHtml(bill.customer_address)}</div>` : ''}
        ${
          bill.customer_phone.trim()
            ? `<div class="muted">Phone: ${escapeHtml(bill.customer_phone)}</div>`
            : ''
        }
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

  ${paymentsBlock}

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
/**
 * The single place a bill becomes HTML.
 *
 * The ledger is read HERE rather than by the callers, for the reason the logo
 * is: both the share path and the print path go through this function, so
 * neither can render an invoice that forgets the payments. A failed read
 * yields no payments block rather than a failed bill — the invoice itself is
 * complete without it.
 */
export async function buildBillHtml(
  bill: BillWithItems,
  business: BusinessDetails
): Promise<string> {
  const [logoDataUri, payments] = await Promise.all([
    readLogoDataUri(business.logoPath),
    listPayments(bill.id).catch(() => [] as BillPayment[]),
  ]);
  return renderBillHtml(bill, business, { logoDataUri, payments });
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

/**
 * Removes the generated PDF for a bill.
 *
 * Called after an edit. The file is named by invoice number, so the stale one
 * would be found and reshared by `existingBillPdf` — handing the customer the
 * pre-edit figures under the same number, which is exactly the disagreement
 * between their copy and the shop's record that this module exists to prevent.
 *
 * Best effort: the bill has already been edited by the time this runs, and a
 * file that cannot be removed is not worth failing the edit over.
 */
export function deleteBillPdf(invoiceNumber: string): void {
  try {
    const file = new File(
      new Directory(Paths.document, BILL_DIRECTORY_NAME),
      `${invoiceNumberToFileName(invoiceNumber)}.pdf`
    );
    if (file.exists) file.delete();
  } catch {
    // Nothing to do about it, and nothing depends on it succeeding.
  }
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
