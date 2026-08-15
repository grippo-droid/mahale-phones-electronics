/**
 * GST calculation (T3.1).
 *
 * The single authority on what a customer is charged. Kept free of React and
 * SQLite so it can be reasoned about and tested on its own — every rupee the
 * shop bills passes through here.
 *
 * Two rules drive the whole module:
 *
 *   1. Place of supply decides the tax heads. Same state as the business means
 *      CGST + SGST, each at half the product's rate. A different state means a
 *      single IGST at the full rate. The customer is charged the same total
 *      either way; only the split differs.
 *
 *   2. Money is rounded to paise at each line, and lines are summed from those
 *      rounded figures. Summing unrounded values and rounding once at the end
 *      produces a total that does not match the printed line items — which is
 *      what a customer notices and queries.
 */

export type SupplyType = 'intra-state' | 'inter-state';

export type GstLineInput = {
  /** The price as entered for the product. */
  unitPrice: number;
  qty: number;
  /** Whole percentage: 18 means 18%. */
  gstRate: number;
  /** When true, `unitPrice` already contains the GST. */
  priceIncludesGst: boolean;
};

export type GstLine = {
  /** Pre-tax price for one unit — what the invoice shows as the rate. */
  unitPriceExclusive: number;
  /** What one unit costs the customer, tax included. */
  unitPriceInclusive: number;
  /** Pre-tax value of the whole line. */
  taxableValue: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalTax: number;
  /** Taxable value plus tax — what the customer pays for this line. */
  lineTotal: number;
  gstRate: number;
  qty: number;
};

export type GstTotals = {
  subtotal: number;
  cgstTotal: number;
  sgstTotal: number;
  igstTotal: number;
  totalTax: number;
  /** Exact sum of the line totals, to the paisa. */
  grandTotalBeforeRounding: number;
  /** Adjustment applied to reach `grandTotal`; 0 when rounding is off. */
  roundOff: number;
  grandTotal: number;
};

export type GstResult = {
  supplyType: SupplyType;
  lines: GstLine[];
  totals: GstTotals;
};

export type GstOptions = {
  /**
   * Round the grand total to a whole rupee, exposing the difference as
   * `roundOff` for the invoice's "Round Off" line.
   */
  roundToNearestRupee?: boolean;
};

// ---------------------------------------------------------------------------
// Place of supply
// ---------------------------------------------------------------------------

/**
 * Compares state names tolerantly — case, surrounding spaces, repeated spaces
 * and full stops all vary in practice ("Maharashtra" / "maharashtra " /
 * "M.P."). A false "inter-state" reading charges IGST where CGST+SGST is due,
 * so this leans on normalisation rather than exact equality.
 *
 * Callers should still pick states from a fixed list wherever possible (T3.4).
 */
export function isInterStateSupply(businessState: string, customerState: string): boolean {
  return normaliseState(businessState) !== normaliseState(customerState);
}

export function supplyTypeFor(businessState: string, customerState: string): SupplyType {
  return isInterStateSupply(businessState, customerState) ? 'inter-state' : 'intra-state';
}

function normaliseState(state: string): string {
  return state.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// Price basis
// ---------------------------------------------------------------------------

/**
 * Splits a price into its pre-tax and tax-inclusive halves.
 *
 * Used by the product form to show both figures live, so whoever enters a price
 * can see what the customer will actually pay before saving.
 */
export function splitPrice(
  unitPrice: number,
  gstRate: number,
  priceIncludesGst: boolean
): { exclusive: number; inclusive: number; taxPerUnit: number } {
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return { exclusive: 0, inclusive: 0, taxPerUnit: 0 };
  }

  const rate = clampRate(gstRate);
  const factor = 1 + rate / 100;

  const exclusive = priceIncludesGst ? round2(unitPrice / factor) : round2(unitPrice);
  const inclusive = priceIncludesGst ? round2(unitPrice) : round2(unitPrice * factor);

  return { exclusive, inclusive, taxPerUnit: round2(inclusive - exclusive) };
}

// ---------------------------------------------------------------------------
// Line calculation
// ---------------------------------------------------------------------------

export function calculateLine(input: GstLineInput, supplyType: SupplyType): GstLine {
  const rate = clampRate(input.gstRate);
  const qty = Number.isFinite(input.qty) ? input.qty : 0;
  const unitPrice = Number.isFinite(input.unitPrice) && input.unitPrice > 0 ? input.unitPrice : 0;

  // Derive the taxable value from the full line rather than from a rounded
  // per-unit figure: rounding once per unit and then multiplying multiplies the
  // rounding error by the quantity.
  const grossLine = unitPrice * qty;
  const taxableValue = input.priceIncludesGst
    ? round2(grossLine / (1 + rate / 100))
    : round2(grossLine);

  let cgstAmount = 0;
  let sgstAmount = 0;
  let igstAmount = 0;

  if (supplyType === 'intra-state') {
    // Each half is computed at half the rate and rounded independently, so CGST
    // and SGST are always exactly equal — they are required by law to be.
    const half = round2((taxableValue * (rate / 2)) / 100);
    cgstAmount = half;
    sgstAmount = half;
  } else {
    igstAmount = round2((taxableValue * rate) / 100);
  }

  const totalTax = round2(cgstAmount + sgstAmount + igstAmount);
  const lineTotal = round2(taxableValue + totalTax);
  const split = splitPrice(unitPrice, rate, input.priceIncludesGst);

  return {
    unitPriceExclusive: split.exclusive,
    unitPriceInclusive: split.inclusive,
    taxableValue,
    cgstAmount,
    sgstAmount,
    igstAmount,
    totalTax,
    lineTotal,
    gstRate: rate,
    qty,
  };
}

// ---------------------------------------------------------------------------
// Whole bill
// ---------------------------------------------------------------------------

export function calculateBill(
  inputs: GstLineInput[],
  supplyType: SupplyType,
  options: GstOptions = {}
): GstResult {
  const lines = inputs.map((input) => calculateLine(input, supplyType));

  const subtotal = sum(lines.map((line) => line.taxableValue));
  const cgstTotal = sum(lines.map((line) => line.cgstAmount));
  const sgstTotal = sum(lines.map((line) => line.sgstAmount));
  const igstTotal = sum(lines.map((line) => line.igstAmount));
  const totalTax = round2(cgstTotal + sgstTotal + igstTotal);
  const grandTotalBeforeRounding = round2(subtotal + totalTax);

  const grandTotal = options.roundToNearestRupee
    ? Math.round(grandTotalBeforeRounding)
    : grandTotalBeforeRounding;
  const roundOff = round2(grandTotal - grandTotalBeforeRounding);

  return {
    supplyType,
    lines,
    totals: {
      subtotal,
      cgstTotal,
      sgstTotal,
      igstTotal,
      totalTax,
      grandTotalBeforeRounding,
      roundOff,
      grandTotal,
    },
  };
}

/**
 * Tax grouped by rate — GST invoices show a rate-wise summary rather than one
 * combined figure, since a bill can mix 12% and 18% items.
 */
export type GstRateSummary = {
  gstRate: number;
  taxableValue: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
};

export function summariseByRate(lines: GstLine[]): GstRateSummary[] {
  const byRate = new Map<number, GstRateSummary>();

  for (const line of lines) {
    const existing = byRate.get(line.gstRate) ?? {
      gstRate: line.gstRate,
      taxableValue: 0,
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: 0,
    };

    byRate.set(line.gstRate, {
      gstRate: line.gstRate,
      taxableValue: round2(existing.taxableValue + line.taxableValue),
      cgstAmount: round2(existing.cgstAmount + line.cgstAmount),
      sgstAmount: round2(existing.sgstAmount + line.sgstAmount),
      igstAmount: round2(existing.igstAmount + line.igstAmount),
    });
  }

  return [...byRate.values()].sort((a, b) => a.gstRate - b.gstRate);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Rounds to paise, half away from zero. */
export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  // Scaling before rounding avoids the binary-float case where a value such as
  // 1.005 is held as 1.00499999999999989 and would otherwise round down.
  const scaled = value * 100;
  const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled) + Number.EPSILON * Math.abs(scaled));
  return rounded / 100;
}

function sum(values: number[]): number {
  return round2(values.reduce((total, value) => total + value, 0));
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate) || rate < 0) return 0;
  return rate > 100 ? 100 : rate;
}
