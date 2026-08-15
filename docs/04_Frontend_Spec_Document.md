# Frontend Spec Document
## Mahale Phones and Electronics — Inventory & Billing App

**Version:** 1.0
**Companion to:** PRD_Mahale_Phones_Electronics_App.md

---

## 1. Navigation Structure

Bottom tab navigation (thumb-friendly for one-handed phone use in a shop counter setting):

```
[ Dashboard ] [ Inventory ] [ Billing ] [ History ] [ Settings ]
```

Each tab is a top-level screen; deeper actions (add product, view a bill) push a new screen on top.

## 2. Screens

### 2.1 Dashboard (home screen)
- Quick stats at top: today's sales total, number of bills today, low-stock item count.
- "New Bill" — large, prominent primary button (most frequent action).
- Recent bills list (last 5), tap to view/reprint.
- Low-stock alert banner if any items are below threshold, tap to jump to filtered inventory view.

### 2.2 Inventory
- Searchable, filterable list of all products (filter by category: CCTV / RO / Tube Light / Bulb / Other).
- Each row: product name, category tag, stock qty (highlighted red if low), price.
- Floating "+" button to add a new product.
- Tap a product to view/edit details or adjust stock manually.

### 2.3 Add/Edit Product
- Simple form: name, category (dropdown), stock quantity, unit price, GST rate (dropdown of standard slabs: 0/5/12/18/28%), HSN code, optional brand/model, optional low-stock threshold.
- Save button, with basic validation (required fields, numeric checks).

### 2.4 Billing (New Bill)
- Step 1: search/select products, set quantity per item (running cart list shown).
- Step 2: enter customer details (name, phone required; address, GSTIN optional).
- Live-updating summary panel: subtotal, GST breakdown (CGST/SGST or IGST depending on customer state), grand total.
- "Generate Bill" button — creates the bill, generates PDF, and moves to the Bill Result screen.

### 2.5 Bill Result / Preview
- Shows the generated bill as a PDF preview.
- Two clear action buttons: **Share** (WhatsApp/any app) and **Print** (Bluetooth printer).
- "Done" returns to Dashboard.

### 2.6 History
- Chronological list of all past bills (most recent first).
- Search by customer name, phone, or invoice number; filter by date range.
- Tap any bill to reopen the Bill Result screen (re-share/re-print).

### 2.7 Settings
- Business details (name, GSTIN, address, state, phone, bank details, logo) — editable here, used on every bill.
- Invoice numbering format/starting number.
- Bluetooth printer pairing/selection.
- Backup / Restore data.
- (Optional, if added) App lock (PIN/biometric) toggle.

## 3. Visual Design Direction

- **Style:** clean, high-contrast, minimal — optimized for quick glances at a shop counter, not visual flair. Large tap targets since this may be used quickly, possibly one-handed, sometimes in bright ambient light (shop lighting/sunlight near a door).
- **Color system:**
  - Primary brand color: a strong, trustworthy blue or green (suggest finalizing based on any existing shop signage/branding — check if Mahale Phones and Electronics has an existing logo color).
  - Status colors: green for in-stock/success, amber for low-stock warning, red for out-of-stock/errors.
- **Typography:** large, legible sans-serif (system default is fine — avoid decorative fonts, this is a utility app).
- **Iconography:** simple line icons for nav tabs (home, box/inventory, receipt/billing, clock/history, gear/settings).

## 4. Language Consideration

- Given the shop context, consider whether UI labels should be **English only**, or **English + Hindi/Marathi** toggle, since your father may be more comfortable in one of those. Worth deciding before development — recommend at minimum keeping numerals and currency in familiar Indian formatting (₹, lakh/crore separators if preferred over international comma grouping).

## 5. Accessibility & Usability Notes (First-Time App User)

- Since this is explicitly for a first-time smartphone-app user, prioritize:
  - Obvious, large primary buttons (no hidden gestures required for core actions).
  - Confirmation dialogs before destructive actions (deleting a product, restoring a backup that overwrites data).
  - Clear success/error feedback (e.g., a visible confirmation after a bill is generated, not just a silent screen change).
  - Minimal nested menus — most actions reachable in 2 taps or fewer from the Dashboard.

## 6. Open Decisions

- [ ] Confirm brand colors (existing shop branding, if any)
- [ ] English-only vs. bilingual UI
- [ ] Whether app-level PIN lock (see Security doc) is included, which affects the first-launch flow
