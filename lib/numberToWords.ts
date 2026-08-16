/**
 * Amounts in words, Indian style (T4.2).
 *
 * A GST invoice carries the total written out, and it is the line a customer
 * checks against the figure. It groups the Indian way — crore, lakh, thousand —
 * not the Western thousand/million, so 1,50,000 reads "One Lakh Fifty Thousand"
 * and never "One Hundred Fifty Thousand".
 *
 * Kept separate from `lib/format.ts` because it is a different problem: that
 * module formats digits for the screen, this one spells a legal figure.
 */

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const TENS = [
  '',
  '',
  'Twenty',
  'Thirty',
  'Forty',
  'Fifty',
  'Sixty',
  'Seventy',
  'Eighty',
  'Ninety',
];

/** Spells a number below 100. */
function underHundred(value: number): string {
  if (value < 20) return ONES[value];
  const tens = Math.floor(value / 10);
  const ones = value % 10;
  return ones === 0 ? TENS[tens] : `${TENS[tens]} ${ONES[ones]}`;
}

/** Spells a number below 1000. */
function underThousand(value: number): string {
  const hundreds = Math.floor(value / 100);
  const rest = value % 100;

  const parts: string[] = [];
  if (hundreds > 0) parts.push(`${ONES[hundreds]} Hundred`);
  if (rest > 0) parts.push(underHundred(rest));
  return parts.join(' ');
}

/**
 * Spells a whole number using Indian place values.
 *
 * Beyond a crore the groups repeat — 100 crore is "One Hundred Crore" — which
 * is the convention rather than introducing a further unit.
 */
export function numberToWords(value: number): string {
  if (!Number.isFinite(value)) return '';

  const whole = Math.floor(Math.abs(value));
  if (whole === 0) return 'Zero';

  const crore = Math.floor(whole / 10000000);
  const lakh = Math.floor((whole % 10000000) / 100000);
  const thousand = Math.floor((whole % 100000) / 1000);
  const rest = whole % 1000;

  const parts: string[] = [];
  if (crore > 0) parts.push(`${numberToWords(crore)} Crore`);
  if (lakh > 0) parts.push(`${underThousand(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${underThousand(thousand)} Thousand`);
  if (rest > 0) parts.push(underThousand(rest));

  const words = parts.join(' ');
  return value < 0 ? `Minus ${words}` : words;
}

/**
 * The full line as it appears on an invoice.
 *
 * Paise are included only when there are any — bills round to the rupee, so the
 * usual case is a whole amount and "and Zero Paise" would just be noise.
 *
 * Rounding to paise before splitting matters: a grand total held as
 * 899.9999999 would otherwise spell 89 paise instead of 90.
 */
export function rupeesInWords(amount: number): string {
  if (!Number.isFinite(amount)) return '';

  const negative = amount < 0;
  const totalPaise = Math.round(Math.abs(amount) * 100);
  const rupees = Math.floor(totalPaise / 100);
  const paise = totalPaise % 100;

  const parts: string[] = [];
  parts.push(`${numberToWords(rupees)} ${rupees === 1 ? 'Rupee' : 'Rupees'}`);
  if (paise > 0) {
    parts.push(`and ${numberToWords(paise)} ${paise === 1 ? 'Paisa' : 'Paise'}`);
  }

  const words = `${parts.join(' ')} Only`;
  return negative ? `Minus ${words}` : words;
}
