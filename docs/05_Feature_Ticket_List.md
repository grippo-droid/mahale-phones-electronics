# Feature Ticket List
## Mahale Phones and Electronics — Inventory & Billing App

**Version:** 1.0
**Companion to:** PRD, Technical Architecture, Security & Access, and Frontend Spec documents.

**How to use this:** Hand these one at a time, roughly in order. Each ticket is scoped to be independently buildable and testable. Check off as completed.

**Status:** 34 of 57 tickets. Phases 0–3 complete; Phase 4 complete except
Bluetooth printing (T4.5–T4.7, blocked); Phase 5 started at T5.1.

The app takes a sale end to end — search stock, build a cart, capture the
customer, compute GST, write a numbered bill that decrements inventory, then
render it as a GST invoice to share on WhatsApp or print.

**Waiting on the shop owner** (all enterable in Settings — no code change):

- **Invoice numbering** — the real format, the reset policy and the starting
  number. Today's defaults (`MPE/{FY}/{SEQ}`, financial-year reset, starting at
  1) are placeholders. The starting number matters most: if a paper bill book is
  part-used, starting at 1 reissues numbers customers already hold, and any bill
  raised before it is set keeps its number permanently.
- **Remaining business details** — registered name, address, phone, email and
  bank details. These print on the invoice, which currently has blank gaps where
  they belong. GSTIN and state are confirmed.
- **The Bluetooth thermal printer model** — blocks T4.5 and T4.7.

---

## Phase 0 — Project Setup

- [x] **T0.1** — Initialize Expo project (React Native, TypeScript, Expo Router).
- [x] **T0.2** — Set up folder structure per Technical Architecture Document.
- [x] **T0.3** — Install core dependencies: `expo-sqlite`, `expo-print`, `expo-sharing`, `expo-file-system`, `zustand`.
- [x] **T0.4** — Set up bottom tab navigation (Dashboard / Inventory / Billing / History / Settings) with placeholder screens.
- [x] **T0.5** — Confirm app runs via `npx expo start` and loads on phone via Expo Go.
- [x] **T0.6** — Create repo `mahale-electronics-app`, connect local project to it. *(Created as `mahale-phones-electronics`, matching the shop name.)*
- [x] **T0.7** — Add `.claude/settings.json` with git permission rules (ask before commit/push, deny force-push/hard-reset — see Technical Architecture Section 8).
- [x] **T0.8** — Add `CLAUDE.md` with project context (link/summarize the 5 docs) and the git approval rule in plain language.
- [x] **T0.9** — Set up `eas.json` with `preview` and `production` build profiles (see Technical Architecture Section 7.3).

## Phase 1 — Database Layer

- [x] **T1.1** — Define SQLite schema: `products`, `bills`, `bill_items` tables (per PRD Section 7).
- [x] **T1.2** — Build DB initialization + migration system (`db/init.ts`, versioned migrations).
- [x] **T1.3** — Build `db/products.ts`: create, read, update, delete, search/filter functions.
- [x] **T1.4** — Build `db/bills.ts`: create bill + bill_items (transactional), read, search/filter functions.
- [x] **T1.5** — Write basic manual test data / seed script to verify DB layer works before UI exists.

## Phase 2 — Inventory Management

- [x] **T2.1** — Build Inventory list screen: display all products, search bar, category filter.
- [x] **T2.2** — Build low-stock visual indicator (red highlight) based on threshold.
- [x] **T2.3** — Build Add Product screen (form + validation + save to DB).
- [x] **T2.4** — Build Edit Product screen (load existing product, update, save).
- [x] **T2.5** — Build Delete Product flow (with confirmation dialog).
- [x] **T2.6** — Wire up stock quantity manual adjustment (e.g., restock without a bill).

## Phase 3 — GST & Billing Logic

- [x] **T3.1** — Build `lib/gst.ts`: CGST/SGST vs IGST calculation logic based on business state vs customer state, given item GST rates.
- [x] **T3.2** — Build `lib/invoiceNumber.ts`: auto-generate sequential invoice numbers per configured format.
- [x] **T3.3** — Build Billing screen: product search/select, quantity input, running cart (Zustand state).
- [x] **T3.4** — Build customer details capture step (name, phone required; address, GSTIN optional).
- [x] **T3.5** — Build live GST/total summary panel on Billing screen.
- [x] **T3.6** — Wire up "Generate Bill": write bill + bill_items to DB, decrement product stock.

## Phase 4 — Bill Output (PDF, Share, Print)

- [x] **T4.1** — Build business details config (Settings screen fields: name, GSTIN, address, state, phone, bank details, logo, invoice format) stored locally.
- [x] **T4.2** — Build `lib/pdf.ts`: HTML bill template → PDF via `expo-print`, using business details + bill data.
- [x] **T4.3** — Build Bill Result/Preview screen: show generated PDF.
- [x] **T4.4** — Wire up Share action via `expo-sharing`.
- [ ] **T4.5** — Research + integrate Bluetooth ESC/POS print library (`lib/printer.ts`); build printer pairing flow in Settings. *(BLOCKED — needs the shop's printer model. Phase 5 taken first.)*
- [ ] **T4.6** — Wire up Print action from Bill Result screen.
- [ ] **T4.7** — Test print output against actual shop printer model once available; adjust ESC/POS formatting as needed.

## Phase 5 — Dashboard & History

- [x] **T5.1** — Build Dashboard: today's sales total, bill count, low-stock count (computed from DB). *(The Dashboard tab currently holds the temporary T1.5 database verification panel, which this ticket replaces.)*
- [x] **T5.2** — Build "New Bill" primary action button → routes to Billing screen.
- [x] **T5.3** — Build recent bills list on Dashboard (last 5).
- [x] **T5.4** — Build low-stock alert banner with tap-through to filtered Inventory view.
- [ ] **T5.5** — Build History screen: full chronological bill list, search by customer/phone/invoice number, date range filter.
- [ ] **T5.6** — Wire up tapping a past bill to reopen Bill Result screen (re-share/re-print).

## Phase 6 — Backup & Restore

- [ ] **T6.1** — Build `db/backup.ts`: export SQLite DB + manifest to a single shareable file.
- [ ] **T6.2** — Build "Backup Data" action in Settings, using share sheet (Drive, email, etc.).
- [ ] **T6.3** — Build "Restore Data" flow: file picker, validation, DB replacement (with confirmation warning).

## Phase 7 — Polish & Non-Functional

- [ ] **T7.1** — Add empty states (e.g., "No products yet — tap + to add your first item").
- [ ] **T7.2** — Add confirmation dialogs for destructive actions (delete product, restore backup).
- [ ] **T7.3** — Add success/error toasts or banners for key actions (bill generated, product saved, backup complete).
- [ ] **T7.4** — Visual pass: apply color system, spacing, and typography per Frontend Spec.
- [ ] **T7.5** — Test performance with a large seeded dataset (e.g., 3,000 products, 5,000 bills) to confirm no slowdowns.
- [ ] **T7.6** — (If decided) Implement app-level PIN/biometric lock per Security & Access Document.
- [ ] **T7.7** — (If decided) Implement SQLite encryption at rest per Security & Access Document.

## Phase 8 — Remote Review & Delivery

- [ ] **T8.1** — Publish an `eas update` after core UI (Phases 1-5) is in place; share the link/QR with the owner for early UI/flow feedback via Expo Go (see Technical Architecture Section 7.2, Stage A).
- [ ] **T8.2** — Incorporate owner feedback from Stage A review.
- [ ] **T8.3** — Build a `preview` profile APK once billing + printing are working; send directly to owner to test the real experience, especially Bluetooth printing (Stage B).
- [ ] **T8.4** — Incorporate owner feedback from Stage B review; repeat preview builds as needed until owner approves.
- [ ] **T8.5** — Once approved, build the `production` profile APK (final release).
- [ ] **T8.6** — Test-install the production APK on an actual phone; walk through full end-to-end flow: add product → create bill → share/print → check history → backup.
- [ ] **T8.7** — Deliver final production APK to owner for daily use.
- [ ] **T8.8** — Document the update process (Technical Architecture Section 7.4) so future change requests follow: make change → test → bump version → new APK → send.

---

**Note on sequencing:** Phases 1-4 form the core usable app (inventory + billing + bill output). Phases 5-6 add convenience and safety. Phase 7 is polish. It's reasonable to get Phases 1-4 working end-to-end first, test it with your father, then continue — rather than building everything before any real-world feedback.
