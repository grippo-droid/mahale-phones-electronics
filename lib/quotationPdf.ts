import * as Print from 'expo-print';
import { Directory, File, Paths } from 'expo-file-system';

import type { BusinessDetails } from '@/constants/business';
import type { QuotationWithItems } from '@/db/quotations';
import {
  DOCUMENT_STYLES,
  escapeHtml,
  money,
  real,
  shopHeaderHtml,
} from '@/lib/documentChrome';
import { formatDate } from '@/lib/format';
import { rupeesInWords } from '@/lib/numberToWords';
import { base64ToBytes, readLogoDataUri } from '@/lib/pdf';
import { formatQuantity } from '@/lib/units';

/**
 * The quotation as a PDF (T5.7).
 *
 * Deliberately similar to `lib/pdf.ts` and deliberately not the same document.
 * The shop's chrome — stylesheet, logo, name, address, GSTIN — comes from
 * `lib/documentChrome.ts` so branding cannot drift between a quotation and the
 * invoice that follows it. Everything below the header differs:
 *
 *   - **It is titled "Quotation", never "Tax Invoice".** A quotation is not a
 *     tax document, and a customer must never be able to mistake one for the
 *     other — nor should it be presentable as proof of a sale.
 *   - **One GST figure, no CGST/SGST/IGST split.** Which heads apply is decided
 *     by the customer's state when the sale happens, and a quotation does not
 *     collect it. Printing a split would be inventing one.
 *   - **No place of supply, no customer GSTIN, no signature block.** None of
 *     them mean anything on an offer.
 *   - **It carries a validity note**, because prices move and a quotation with
 *     no stated shelf life invites an argument months later.
 *
 * Like the bill, it prints only what was stored on the quotation. Nothing is
 * recalculated and nothing is joined back to `products` — `purchase_price` must
 * never reach a customer, and the surest way to keep that true is to have no
 * path from here to that table.
 */

/** Where generated quotations are kept, beside but separate from bills. */
const QUOTATION_DIRECTORY_NAME = 'quotations';

/** A4 at 72 PPI, matching the invoice. */
const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;

/**
 * How long a quotation is presented as holding good.
 *
 * Matches `QUOTATION_STALE_DAYS`, which is what the list badges on — the
 * document and the app must not disagree about when a price stops being
 * dependable.
 */
export const QUOTATION_VALID_DAYS = 20;

export type QuotationRenderOptions = {
  /** The logo as a `data:` URI. See the note in `lib/pdf.ts` on why not a path. */
  logoDataUri?: string | null;
};

/** A quotation reference is Q-0001 — no slashes, so it is already a safe filename. */
export function quotationNumberToFileName(reference: string): string {
  return reference.replace(/[^A-Za-z0-9._-]/g, '-');
}

export function renderQuotationHtml(
  quotation: QuotationWithItems,
  business: BusinessDetails,
  options: QuotationRenderOptions = {}
): string {
  const itemRows = quotation.items
    .map((item, index) => {
      const rateEach = item.qty > 0 ? item.taxable_value / item.qty : 0;
      return `
        <tr>
          <td class="c">${index + 1}</td>
          <td>${escapeHtml(item.product_name_snapshot)}</td>
          <td class="c">${escapeHtml(item.hsn_code_snapshot ?? '—')}</td>
          <td class="r">${escapeHtml(formatQuantity(item.qty, item.unit))}</td>
          <td class="r">${money(rateEach)}</td>
          <td class="r">${money(item.taxable_value)}</td>
          <td class="c">${item.gst_rate_snapshot}%</td>
          <td class="r">${money(item.gst_amount)}</td>
          <td class="r">${money(item.line_total)}</td>
        </tr>`;
    })
    .join('');

  const converted = quotation.converted_bill_id !== null;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>${DOCUMENT_STYLES}
  .stamp { text-align: center; font-size: 10px; font-weight: 700; color: #555;
           text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
</style>
</head>
<body>
  <div class="title">Quotation</div>
  ${converted ? '<div class="stamp">Converted to an invoice</div>' : ''}

  <div class="frame">
    ${shopHeaderHtml(business, options.logoDataUri ?? null)}

    <div class="meta">
      <div>
        <div class="label">Quotation No.</div>
        <div class="value">${escapeHtml(quotation.reference_number)}</div>
      </div>
      <div>
        <div class="label">Date</div>
        <div class="value">${escapeHtml(formatDate(quotation.date))}</div>
      </div>
      <div>
        <div class="label">Valid for</div>
        <div class="value">${QUOTATION_VALID_DAYS} days</div>
      </div>
    </div>

    <div class="meta">
      <div>
        <div class="sub">Quotation for</div>
        <div class="value">${escapeHtml(quotation.customer_name)}</div>
        ${
          quotation.customer_address
            ? `<div class="muted">${escapeHtml(quotation.customer_address)}</div>`
            : ''
        }
        <div class="muted">Phone: ${escapeHtml(quotation.customer_phone)}</div>
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
        <div class="sub">Amount in words</div>
        <div class="words">${escapeHtml(rupeesInWords(quotation.grand_total))}</div>
        <div class="note" style="text-align:left; margin-top:10px">
          This is a quotation, not a tax invoice. Prices are held for
          ${QUOTATION_VALID_DAYS} days from the date above and may change after that.
          The GST split into CGST/SGST or IGST is set on the final invoice,
          according to the place of supply.
        </div>
      </div>
      <div class="foot-right">
        <table class="totals">
          <tr><td>Taxable Value</td><td class="r">${money(quotation.subtotal)}</td></tr>
          <tr><td>GST</td><td class="r">${money(quotation.gst_total)}</td></tr>
          <tr class="grand"><td>Total</td><td class="r">₹${money(quotation.grand_total)}</td></tr>
        </table>
      </div>
    </div>
  </div>

  <div class="note">
    ${escapeHtml(real(business.name))} &nbsp;·&nbsp; Quotation ${escapeHtml(
      quotation.reference_number
    )}
  </div>
</body>
</html>`;
}

export async function buildQuotationHtml(
  quotation: QuotationWithItems,
  business: BusinessDetails
): Promise<string> {
  return renderQuotationHtml(quotation, business, {
    logoDataUri: await readLogoDataUri(business.logoPath),
  });
}

/**
 * Renders the quotation to a PDF and returns its path.
 *
 * The same route as a bill, for the same reasons: `base64` rather than moving
 * the file, because expo-print writes into the host app's cache which is
 * outside this experience's sandbox under Expo Go; and a filename a customer
 * can recognise rather than a random cache name.
 */
export async function generateQuotationPdf(
  quotation: QuotationWithItems,
  business: BusinessDetails
): Promise<string> {
  const html = await buildQuotationHtml(quotation, business);

  const printed = await Print.printToFileAsync({
    html,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    base64: true,
  });

  if (!printed.base64) {
    throw new Error('The quotation was rendered but its contents could not be read back.');
  }

  const directory = new Directory(Paths.document, QUOTATION_DIRECTORY_NAME);
  if (!directory.exists) directory.create({ intermediates: true });

  const destination = new File(
    directory,
    `${quotationNumberToFileName(quotation.reference_number)}.pdf`
  );

  // A quotation can legitimately be re-rendered — after an edit to the shop's
  // details, or a reshare — so an existing file is replaced rather than failing.
  if (destination.exists) destination.delete();
  destination.create();
  destination.write(base64ToBytes(printed.base64));

  return destination.uri;
}

/** The PDF for a quotation, if one has already been generated. */
export function existingQuotationPdf(reference: string): string | null {
  try {
    const file = new File(
      new Directory(Paths.document, QUOTATION_DIRECTORY_NAME),
      `${quotationNumberToFileName(reference)}.pdf`
    );
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}
