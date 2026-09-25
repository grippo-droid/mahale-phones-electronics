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

// ---------------------------------------------------------------------------
// Discount
// ---------------------------------------------------------------------------

export type DiscountType = 'percent' | 'amount';

/** An optional reduction on one line. `value` is 10 for 10%, or 100 for ₹100. */
export type LineDiscount = {
  type: DiscountType;
  value: number;
};

/**
 * What a discount actually takes off a line, in rupees.
 *
 * Applied to the LINE, never per unit. A flat "₹100 off" on a line of three
 * means ₹100, not ₹300 — and a percentage taken per unit and then multiplied
 * multiplies its rounding error by the quantity, which is the same reason
 * `calculateLine` derives the taxable value from the whole line rather than
 * from a rounded per-unit figure. The two routes differ: ₹333.33 × 3 with 10%
 * off comes to 1,061.99 per line and 1,062.00 per unit.
 *
 * Clamped to the line's own value. A discount bigger than the line would make
 * the taxable value negative, and negative GST is not a thing that can appear
 * on a tax invoice — so the item becomes free and the screen says so, rather
 * than the figure being refused or a nonsense one being stored. Warn, never
 * block: the same rule as overselling stock and overpaying a bill.
 */
export function discountAmountFor(lineGross: number, discount: LineDiscount | null | undefined): number {
  if (!discount) return 0;
  if (!Number.isFinite(discount.value) || discount.value <= 0) return 0;
  if (!Number.isFinite(lineGross) || lineGross <= 0) return 0;

  const raw =
    discount.type === 'percent'
      ? round2((lineGross * Math.min(discount.value, 100)) / 100)
      : round2(discount.value);

  return Math.min(raw, round2(lineGross));
}

/** True when the discount asked for was more than the line could give. */
export function isDiscountClamped(
  lineGross: number,
  discount: LineDiscount | null | undefined
): boolean {
  if (!discount || !Number.isFinite(discount.value) || discount.value <= 0) return false;
  if (discount.type === 'percent') return discount.value > 100;
  return round2(discount.value) > round2(lineGross);
}

/**
 * The stored `discount_type` / `discount_value` pair, back as a discount.
 *
 * One definition, because both a bill line and a quotation line are read back
 * into a cart and a second copy of this decode would be free to disagree.
 * Anything unrecognised reads as no discount — a hand-edited database or a
 * backup from a future build must not put an unknown rule on a bill.
 */
export function storedDiscount(
  type: string | null | undefined,
  value: number | null | undefined
): LineDiscount | null {
  if (type !== 'percent' && type !== 'amount') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return { type, value };
}

export type GstLineInput = {
  /** The price as entered for the product, BEFORE any discount. */
  unitPrice: number;
  qty: number;
  /** Whole percentage: 18 means 18%. */
  gstRate: number;
  /** When true, `unitPrice` already contains the GST. */
  priceIncludesGst: boolean;
  /**
   * Optional reduction on this line (T9.6).
   *
   * Applied to the line BEFORE tax: discounted, then taxed. That ordering is
   * the standard one and it is also the only one that makes the printed rate
   * honest — the invoice shows `taxableValue / qty`, so the customer sees the
   * discounted price as the rate they were charged.
   */
  discount?: LineDiscount | null;
};

export type GstLine = {
  /**
   * Pre-tax price for one unit as ENTERED, before any discount.
   *
   * Not what the invoice prints when a discount applies — that comes from
   * `taxableValue / qty`, which is the discounted rate. This is kept because
   * the product form shows both halves of an entered price live.
   */
  unitPriceExclusive: number;
  /** What one unit costs the customer before a discount, tax included. */
  unitPriceInclusive: number;
  /** Rupees taken off this line, or 0. Never more than the line was worth. */
  discountAmount: number;
  /** The line before any discount, pre-tax where the price excludes GST. */
  grossBeforeDiscount: number;
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

  // Discounted, then taxed. The discount is measured against the rounded line
  // so that "10% off" is 10% of a figure the owner can see, but the SUBTRACTION
  // happens against the unrounded gross and only when there is a discount —
  // so a line without one produces exactly the bytes it did before this
  // existed, and no old bill's arithmetic moves.
  const discountAmount = discountAmountFor(round2(grossLine), input.discount);
  const netLine = discountAmount > 0 ? round2(grossLine - discountAmount) : grossLine;

  const taxableValue = input.priceIncludesGst
    ? round2(netLine / (1 + rate / 100))
    : round2(netLine);

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
    discountAmount,
    grossBeforeDiscount: round2(grossLine),
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
