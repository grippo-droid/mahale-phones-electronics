import type { BusinessDetails } from '@/constants/business';
import { stateCodeFor } from '@/constants/states';

/**
 * The parts of a printed document that are the shop rather than the document:
 * the stylesheet, and the header block with the logo, name, address and GSTIN.
 *
 * Shared by the invoice (`lib/pdf.ts`) and the quotation
 * (`lib/quotationPdf.ts`) so the two cannot drift apart. Branding drifting
 * between a customer's quotation and the invoice that follows it is exactly the
 * kind of thing nobody notices until a customer asks whether they came from the
 * same shop.
 *
 * The document-specific parts — the title, the columns, the totals, whether a
 * tax split is shown — deliberately stay with each document.
 */

/** Escapes text into HTML. Customer names are typed at a counter. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A `PLACEHOLDER` value prints as an empty gap.
 *
 * An invoice reading `PLACEHOLDER_CITY` looks like a system fault; a gap looks
 * like missing data, which is what it is.
 */
export function real(value: string | null | undefined): string {
  if (!value) return '';
  return value.startsWith('PLACEHOLDER') ? '' : value;
}

/** Two decimals, grouped Indian-style by the platform's own formatter. */
export function money(amount: number): string {
  return (Number.isFinite(amount) ? amount : 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** "Madhya Pradesh (23)" — the code is what a GST officer reads first. */
export function stateWithCode(state: string): string {
  const clean = real(state);
  if (!clean) return '';
  const code = stateCodeFor(clean);
  return code ? `${clean} (${code})` : clean;
}

/**
 * The stylesheet, shared verbatim.
 *
 * The pagination rules are the load-bearing part: a document long enough to run
 * past one A4 page breaks badly on browser defaults — column headings appear
 * only on page one, a row gets sliced through the middle, and the totals block
 * can be orphaned. Hence `table-header-group` and `break-inside: avoid`.
 */
export const DOCUMENT_STYLES = `
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

  /* Pagination — see the note above. */
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
`;

/**
 * The shop's own block at the top of the document.
 *
 * The logo is only embedded when the caller managed to read it: a stored path
 * can outlive its file across a restore, and a broken image on a document
 * handed to a customer looks like a fault.
 */
export function shopHeaderHtml(business: BusinessDetails, logoDataUri: string | null): string {
  const address = [
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

  const logo = logoDataUri
    ? `<img class="logo" src="${escapeHtml(logoDataUri)}" alt="">`
    : '';

  return `
    <div class="head">
      ${logo}
      <div style="flex:1">
        <div class="shop-name">${escapeHtml(real(business.name))}</div>
        <div class="muted">${address}</div>
        ${contact ? `<div class="muted">${contact}</div>` : ''}
        ${real(business.gstin) ? `<div class="gstin">GSTIN: ${escapeHtml(real(business.gstin))}</div>` : ''}
        ${
          real(business.state)
            ? `<div class="muted">State: ${escapeHtml(stateWithCode(business.state))}</div>`
            : ''
        }
      </div>
    </div>`;
}
