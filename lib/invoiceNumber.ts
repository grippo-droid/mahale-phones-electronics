import type { SQLiteDatabase } from 'expo-sqlite';

import { BUSINESS_DETAILS } from '@/constants/business';
import { invoiceNumberExists } from '@/db/bills';
import {
  SETTING_KEYS,
  getInvoiceCounter,
  getSetting,
  setInvoiceCounter,
  setSetting,
} from '@/db/settings';

/**
 * Sequential invoice numbers (T3.2).
 *
 * ============================================================================
 * An invoice number is a legal record. Under GST rules a number must not be
 * REUSED (two bills sharing one number) and the series must not be broken by
 * numbers that were handed out but never issued.
 *
 * Both guarantees come from where the counter is written, not from care at the
 * call site: `reserveInvoiceNumber` reads and advances the counter using the
 * same database handle it is given, so when it is called inside the transaction
 * that writes the bill:
 *
 *   - a bill that fails to save rolls the counter back with it, so no number is
 *     burnt on a bill that does not exist;
 *   - no second bill can read the counter mid-flight, because the transaction is
 *     exclusive.
 *
 * `createBill` does exactly that when no invoice number is supplied, which is
 * the path the Billing screen uses. Calling this function outside a transaction
 * and then saving separately would reintroduce both faults.
 * ============================================================================
 *
 * Deleting a bill still leaves a gap. That is correct: a cancelled invoice keeps
 * its number in the books rather than being handed to somebody else.
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * When the running number goes back to the start.
 *
 * `financial-year` follows the Indian convention — the year runs 1 April to
 * 31 March, so a bill dated 20 March 2027 belongs to 2026-27 and the first bill
 * of 1 April 2027 starts 2027-28 at number one.
 */
export type InvoiceResetPolicy = 'financial-year' | 'calendar-year' | 'never';

export const INVOICE_RESET_POLICIES: InvoiceResetPolicy[] = [
  'financial-year',
  'calendar-year',
  'never',
];

export type InvoiceNumberConfig = {
  /** Token string, e.g. `MPE/{FY}/{SEQ}`. See INVOICE_FORMAT_TOKENS. */
  format: string;
  resetPolicy: InvoiceResetPolicy;
  /**
   * The number the very first bill gets. Set above 1 when the shop is part-way
   * through a paper bill book and the app must carry on from it rather than
   * reissuing numbers the customer already has.
   */
  startNumber: number;
};

export const DEFAULT_INVOICE_NUMBER_CONFIG: InvoiceNumberConfig = {
  format: BUSINESS_DETAILS.invoiceNumberFormat,
  resetPolicy: BUSINESS_DETAILS.invoiceResetPolicy,
  startNumber: BUSINESS_DETAILS.invoiceStartNumber,
};

/** Documentation for the Settings screen (T4.1), so the tokens are discoverable. */
export const INVOICE_FORMAT_TOKENS: { token: string; meaning: string; example: string }[] = [
  { token: '{FY}', meaning: 'Financial year (1 April – 31 March)', example: '2026-27' },
  { token: '{FYYYY}', meaning: 'Financial year, starting year only', example: '2026' },
  { token: '{YYYY}', meaning: 'Calendar year', example: '2026' },
  { token: '{YY}', meaning: 'Calendar year, last two digits', example: '26' },
  { token: '{MM}', meaning: 'Month', example: '08' },
  { token: '{DD}', meaning: 'Day', example: '16' },
  { token: '{SEQ}', meaning: 'Running number, 4 digits', example: '0001' },
  { token: '{SEQ:6}', meaning: 'Running number, chosen width', example: '000001' },
];

const DEFAULT_SEQ_WIDTH = 4;
const MAX_SEQ_WIDTH = 12;

/** Matches one token. Longest alternatives first, so `{FYYYY}` never reads as `{FY}`. */
const TOKEN_PATTERN = /\{(FYYYY|FY|YYYY|YY|MM|DD|SEQ(?::(\d+))?)\}/g;

/** Matches anything brace-wrapped, so unknown tokens can be reported rather than printed. */
const ANY_BRACED_PATTERN = /\{[^}]*\}/g;

// ---------------------------------------------------------------------------
// Periods
// ---------------------------------------------------------------------------

export type InvoicePeriod = {
  /** Stable storage key for this period's counter. */
  key: string;
  /** Human wording for messages, e.g. "2026-27". */
  label: string;
};

/** Financial years start in April; before that the date belongs to the previous one. */
export function financialYearStart(date: Date): number {
  return date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
}

/** `2026-27` for any date between 1 April 2026 and 31 March 2027. */
export function financialYearLabel(date: Date): string {
  const start = financialYearStart(date);
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function periodFor(date: Date, policy: InvoiceResetPolicy): InvoicePeriod {
  switch (policy) {
    case 'financial-year':
      return { key: `fy-${financialYearLabel(date)}`, label: financialYearLabel(date) };
    case 'calendar-year':
      return { key: `cy-${date.getFullYear()}`, label: String(date.getFullYear()) };
    case 'never':
      return { key: 'all', label: 'all bills' };
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Fills a format string in. Unknown tokens are left alone; validation rejects them. */
export function renderInvoiceNumber(format: string, sequence: number, date: Date): string {
  return format.replace(TOKEN_PATTERN, (_match, token: string, width?: string) => {
    if (token.startsWith('SEQ')) {
      const pad = width ? Number.parseInt(width, 10) : DEFAULT_SEQ_WIDTH;
      // padStart never truncates, so a sequence that outgrows its width simply
      // gets longer — it cannot wrap around and collide with an earlier number.
      return String(sequence).padStart(pad, '0');
    }

    switch (token) {
      case 'FY':
        return financialYearLabel(date);
      case 'FYYYY':
        return String(financialYearStart(date));
      case 'YYYY':
        return String(date.getFullYear());
      case 'YY':
        return String(date.getFullYear() % 100).padStart(2, '0');
      case 'MM':
        return String(date.getMonth() + 1).padStart(2, '0');
      case 'DD':
        return String(date.getDate()).padStart(2, '0');
      default:
        return _match;
    }
  });
}

/**
 * A filename-safe version of an invoice number, for the PDF written in T4.2.
 *
 * Indian invoice numbers conventionally contain slashes (`MPE/2026-27/0001`),
 * which are path separators — using one directly as a filename would write into
 * a directory that does not exist, or silently truncate. This lives here rather
 * than in the PDF module so the two cannot disagree about the mapping.
 */
export function invoiceNumberToFileName(invoiceNumber: string): string {
  return invoiceNumber
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export type InvoiceFormatValidation = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

/**
 * Checks a format against a reset policy.
 *
 * The rule that matters most is that a resetting sequence needs a matching
 * period token in the format. `MPE/{YYYY}/{SEQ}` with a financial-year reset can
 * genuinely produce the same number twice: the sequence restarts on 1 April
 * while `{YYYY}` does not change until 1 January, so two different bills in the
 * same calendar year can both render `MPE/2026/0001`. That is a duplicate
 * invoice number, which is exactly what must never happen.
 */
export function validateInvoiceFormat(
  format: string,
  resetPolicy: InvoiceResetPolicy
): InvoiceFormatValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!format?.trim()) {
    return { valid: false, errors: ['Invoice format cannot be empty.'], warnings };
  }

  const known: string[] = format.match(TOKEN_PATTERN) ?? [];
  const braced: string[] = format.match(ANY_BRACED_PATTERN) ?? [];
  const unknown = braced.filter((piece) => !known.includes(piece));

  for (const piece of unknown) {
    errors.push(`"${piece}" is not a recognised token.`);
  }

  const hasSeq = known.some((token) => token.startsWith('{SEQ'));
  if (!hasSeq) {
    errors.push('Format must include {SEQ}, the running number, or every bill gets the same number.');
  }

  for (const token of known) {
    const width = /^\{SEQ:(\d+)\}$/.exec(token);
    if (width) {
      const value = Number.parseInt(width[1], 10);
      if (value < 1 || value > MAX_SEQ_WIDTH) {
        errors.push(`{SEQ:${value}} is out of range — width must be between 1 and ${MAX_SEQ_WIDTH}.`);
      }
    }
  }

  const hasFinancialYear = known.includes('{FY}') || known.includes('{FYYYY}');
  const hasCalendarYear = known.includes('{YYYY}') || known.includes('{YY}');

  if (resetPolicy === 'financial-year' && !hasFinancialYear) {
    errors.push(
      'The number restarts every financial year, so the format needs {FY} or {FYYYY}. ' +
        'Without it two bills in different financial years can end up with the same number.'
    );
  }

  if (resetPolicy === 'calendar-year' && !hasCalendarYear) {
    errors.push(
      'The number restarts every calendar year, so the format needs {YYYY} or {YY}. ' +
        'Without it two bills in different years can end up with the same number.'
    );
  }

  if (resetPolicy === 'financial-year' && hasCalendarYear && !hasFinancialYear) {
    // Unreachable while the error above stands, but kept so the message survives
    // if the rules are ever loosened.
    warnings.push('{YYYY} changes on 1 January but the number restarts on 1 April.');
  }

  if (/[\\/:*?"<>|]/.test(format)) {
    warnings.push(
      'Slashes and similar characters are fine on the invoice; the saved PDF replaces them with dashes.'
    );
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function validateInvoiceNumberConfig(config: InvoiceNumberConfig): InvoiceFormatValidation {
  const result = validateInvoiceFormat(config.format, config.resetPolicy);
  const errors = [...result.errors];

  if (!Number.isInteger(config.startNumber) || config.startNumber < 1) {
    errors.push('Starting number must be a whole number of 1 or more.');
  }

  if (!INVOICE_RESET_POLICIES.includes(config.resetPolicy)) {
    errors.push(`"${config.resetPolicy}" is not a valid reset setting.`);
  }

  return { valid: errors.length === 0, errors, warnings: result.warnings };
}

// ---------------------------------------------------------------------------
// Stored settings
// ---------------------------------------------------------------------------

/**
 * Invoice numbering settings, falling back to the first-run defaults in
 * `constants/business.ts` for anything the owner has not set in Settings.
 */
export async function getInvoiceNumberConfig(db: SQLiteDatabase): Promise<InvoiceNumberConfig> {
  const [format, policy, start] = await Promise.all([
    getSetting(SETTING_KEYS.invoiceNumberFormat, db),
    getSetting(SETTING_KEYS.invoiceResetPolicy, db),
    getSetting(SETTING_KEYS.invoiceStartNumber, db),
  ]);

  const parsedStart = start === null ? Number.NaN : Number.parseInt(start, 10);

  return {
    format: format?.trim() || DEFAULT_INVOICE_NUMBER_CONFIG.format,
    resetPolicy: isResetPolicy(policy) ? policy : DEFAULT_INVOICE_NUMBER_CONFIG.resetPolicy,
    startNumber:
      Number.isInteger(parsedStart) && parsedStart >= 1
        ? parsedStart
        : DEFAULT_INVOICE_NUMBER_CONFIG.startNumber,
  };
}

/**
 * Saves invoice numbering settings after checking them.
 *
 * Validated here as well as in the Settings UI: an unusable format would only be
 * discovered at the counter with a customer waiting, and a format that disagrees
 * with the reset setting can produce a duplicate invoice number.
 */
export async function setInvoiceNumberConfig(
  config: InvoiceNumberConfig,
  db: SQLiteDatabase
): Promise<void> {
  const validation = validateInvoiceNumberConfig(config);
  if (!validation.valid) throw new Error(validation.errors.join(' '));

  await setSetting(SETTING_KEYS.invoiceNumberFormat, config.format.trim(), db);
  await setSetting(SETTING_KEYS.invoiceResetPolicy, config.resetPolicy, db);
  await setSetting(SETTING_KEYS.invoiceStartNumber, String(config.startNumber), db);
}

function isResetPolicy(value: string | null): value is InvoiceResetPolicy {
  return value !== null && (INVOICE_RESET_POLICIES as string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * How many taken numbers to step over before giving up.
 *
 * The counter normally tracks the bills exactly. It can fall behind only if a
 * database is restored from a backup written before some bills existed, in which
 * case stepping forward recovers; a run this long means something else is wrong
 * and inventing more numbers would make it worse.
 */
const MAX_COLLISION_PROBES = 1000;

export type ReservedInvoiceNumber = {
  invoiceNumber: string;
  sequence: number;
  period: InvoicePeriod;
};

async function nextFor(
  db: SQLiteDatabase,
  date: Date,
  config: InvoiceNumberConfig
): Promise<ReservedInvoiceNumber> {
  const validation = validateInvoiceNumberConfig(config);
  if (!validation.valid) {
    throw new Error(`Invoice number format is not usable: ${validation.errors.join(' ')}`);
  }

  const period = periodFor(date, config.resetPolicy);
  const lastUsed = await getInvoiceCounter(period.key, db);

  let sequence: number;
  if (lastUsed !== null) {
    sequence = lastUsed + 1;
  } else {
    // A period with no counter yet starts at 1, except the very first period the
    // shop ever bills in — that one honours the configured starting number so
    // the app can continue an existing paper series instead of repeating it.
    const anyBills = await hasAnyBills(db);
    sequence = anyBills ? 1 : config.startNumber;
  }

  for (let probe = 0; probe < MAX_COLLISION_PROBES; probe += 1) {
    const invoiceNumber = renderInvoiceNumber(config.format, sequence, date);
    if (!(await invoiceNumberExists(invoiceNumber, db))) {
      return { invoiceNumber, sequence, period };
    }
    sequence += 1;
  }

  throw new Error(
    `Could not find an unused invoice number after ${MAX_COLLISION_PROBES} tries. ` +
      'Check the invoice format in Settings.'
  );
}

/**
 * Takes the next invoice number and advances the counter.
 *
 * MUST be called with the transaction handle that also writes the bill — see the
 * note at the top of this file. `createBill` does this for you; prefer letting it
 * generate the number over calling this directly.
 */
export async function reserveInvoiceNumber(
  db: SQLiteDatabase,
  date: Date = new Date(),
  config?: InvoiceNumberConfig
): Promise<ReservedInvoiceNumber> {
  const resolved = config ?? (await getInvoiceNumberConfig(db));
  const next = await nextFor(db, date, resolved);
  await setInvoiceCounter(next.period.key, next.sequence, db);
  return next;
}

/**
 * Ready to hand to `createBill`'s `generateInvoiceNumber`, which calls it with
 * the transaction that writes the bill:
 *
 *   createBill({ ...fields, generateInvoiceNumber: invoiceNumberGenerator(date) })
 */
export function invoiceNumberGenerator(
  date: Date = new Date(),
  config?: InvoiceNumberConfig
): (txn: SQLiteDatabase) => Promise<string> {
  return async (txn) => (await reserveInvoiceNumber(txn, date, config)).invoiceNumber;
}

/**
 * The number the next bill would get, without taking it.
 *
 * For showing on the Billing screen before the bill is saved (T3.5). It is a
 * preview: the number is only committed when the bill is.
 */
export async function peekNextInvoiceNumber(
  db: SQLiteDatabase,
  date: Date = new Date(),
  config?: InvoiceNumberConfig
): Promise<string> {
  const resolved = config ?? (await getInvoiceNumberConfig(db));
  const next = await nextFor(db, date, resolved);
  return next.invoiceNumber;
}

/** Sample output for the Settings screen, so a format can be checked before saving. */
export function previewInvoiceNumber(
  config: InvoiceNumberConfig,
  date: Date = new Date()
): string | null {
  if (!validateInvoiceNumberConfig(config).valid) return null;
  return renderInvoiceNumber(config.format, config.startNumber, date);
}

async function hasAnyBills(db: SQLiteDatabase): Promise<boolean> {
  const row = await db.getFirstAsync<{ found: number }>('SELECT 1 AS found FROM bills LIMIT 1');
  return row !== null;
}
