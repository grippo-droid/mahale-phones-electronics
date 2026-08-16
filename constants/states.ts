/**
 * Indian states and union territories, with their GST state codes (T3.4).
 *
 * Two jobs:
 *
 *   1. The customer's state is chosen from this list rather than typed. A typo
 *      here is not cosmetic — the state decides CGST/SGST versus IGST, so
 *      "Maharastra" against a business in "Maharashtra" would put IGST on a
 *      local sale and make the invoice wrong.
 *
 *   2. The first two digits of a GSTIN are the state code. Having the codes here
 *      lets a customer's GSTIN be cross-checked against the state they picked.
 *
 * Codes are from the GST state code list. Two entries are legacy: 25 (Daman and
 * Diu) and 28 (undivided Andhra Pradesh) were retired when territories merged
 * and Telangana was formed. They are kept so an older GSTIN still parses, but
 * they are not offered when picking a state — see ACTIVE_STATES.
 */

export type IndianState = {
  /** Two-digit GST state code, as it appears at the start of a GSTIN. */
  code: string;
  name: string;
  /** Retired code: still recognised on an existing GSTIN, never offered anew. */
  legacy?: boolean;
};

export const INDIAN_STATES: IndianState[] = [
  { code: '01', name: 'Jammu and Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '25', name: 'Daman and Diu', legacy: true },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '28', name: 'Andhra Pradesh (undivided)', legacy: true },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman and Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
  { code: '97', name: 'Other Territory' },
];

/** The states offered when picking one, sorted by name for a scrolling list. */
export const ACTIVE_STATES: IndianState[] = INDIAN_STATES.filter(
  (state) => !state.legacy
).sort((a, b) => a.name.localeCompare(b.name));

/**
 * Matches the tolerance in `lib/gst.ts` — the same name can arrive with odd
 * spacing, casing or full stops depending on where it was typed.
 */
function normalise(name: string): string {
  return name.trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
}

export function findStateByName(name: string): IndianState | null {
  if (!name) return null;
  const target = normalise(name);
  return INDIAN_STATES.find((state) => normalise(state.name) === target) ?? null;
}

export function findStateByCode(code: string): IndianState | null {
  if (!code) return null;
  const target = code.trim();
  return INDIAN_STATES.find((state) => state.code === target) ?? null;
}

/** The GST state code for a state name, or null if the name is not recognised. */
export function stateCodeFor(name: string): string | null {
  return findStateByName(name)?.code ?? null;
}
