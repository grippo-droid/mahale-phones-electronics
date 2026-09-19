# Feature Ticket List
## Mahale Phones and Electronics — Inventory & Billing App

**Version:** 1.0
**Companion to:** PRD, Technical Architecture, Security & Access, and Frontend Spec documents.

**How to use this:** Hand these one at a time, roughly in order. Each ticket is scoped to be independently buildable and testable. Check off as completed.

**Status:** 49 of 61 live tickets done. Phases 0–6 complete; Phase 7 is the
remainder. Seven tickets were added after the original plan, all at the owner's
request and all done: T3.7 and T3.8 (category chips, frequently sold), T3.9
(units on bill lines), T5.6 (payment type and paid status), T5.7 (quotations),
T5.8 and T5.9 (editing and deleting bills and quotations), T5.10 (tappable paid
status) and T6.4 (reset shop data). Three Bluetooth printing tickets are dropped
and two security tickets descoped — see below and Phase 7.

The app takes a sale end to end — search stock, build a cart, capture the
customer, compute GST, write a numbered bill that decrements inventory, then
render it as a GST invoice to share on WhatsApp or print.

**Bluetooth thermal printing is out of scope.** T4.5–T4.7 are dropped, not
deferred. The owner confirmed the shop bills over WhatsApp: the customer gets
the PDF on their phone, which is already built and working (T4.2–T4.4). A
thermal printer would add a native dependency, a pairing flow, a second bill
layout in ESC/POS and a class of failure — unpaired, out of paper, out of
range — at the exact moment a customer is waiting. Nothing in the app depends
on them, so this removes a dependency rather than leaving a gap. A printed copy
is still available: "Open printable bill" renders the real PDF through the
Android print sheet, which drives any printer Android can already see.

**Nothing is waiting on the shop owner.** Every business detail is settled:

- **Invoice numbering is `MPE/{FY}/{SEQ}` with a financial-year reset, starting
  at 151** — the paper book reached 150. Set in `constants/business.ts`. The
  starting number only applies to a database that has never held a bill; after
  any bill exists the stored counter takes over, so a phone used for testing
  needs "Reset shop data" before real billing begins.
- **Pincode `450331`.** Name, GSTIN, state, address, phone and email were
  already confirmed.
- **Bank details are not wanted** on the bill footer, by the owner's decision.
  Those fields stay as placeholders and print as blank gaps.

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
- [x] **T3.7** — Add category filter chips to the Billing screen, so products can be browsed by category instead of always typing a search. *(Added after Phase 5 began, at the owner's request.)*
- [x] **T3.8** — Add a "Frequently sold" section shown by default on the Billing screen: top 12 products by units sold over the last 90 days, falling back to all-time and then to all products grouped by category when there is not enough sales history. Out-of-stock items are included, with their stock shown.
- [x] **T3.9** — Add a Unit field to bill lines: a fixed choice of Meter, Box, Pieces or Feet, picked per line on the Billing screen and printed beside the quantity on the invoice and the on-screen bill ("5 Mtr", "2 Box", "10 Pcs", "3 Feet"). Per bill line rather than per product, and optional — bills raised before it existed, and lines where none was chosen, print the bare quantity exactly as they always did. *(Added after Phase 7 began, at the owner's request. Migration 005; no change to the backup file format.)*

## Phase 4 — Bill Output (PDF, Share, Print)

- [x] **T4.1** — Build business details config (Settings screen fields: name, GSTIN, address, state, phone, bank details, logo, invoice format) stored locally.
- [x] **T4.2** — Build `lib/pdf.ts`: HTML bill template → PDF via `expo-print`, using business details + bill data.
- [x] **T4.3** — Build Bill Result/Preview screen: show generated PDF.
- [x] **T4.4** — Wire up Share action via `expo-sharing`.
- ~~**T4.5** — Research + integrate Bluetooth ESC/POS print library (`lib/printer.ts`); build printer pairing flow in Settings.~~ *(OUT OF SCOPE — the shop bills over WhatsApp.)*
- ~~**T4.6** — Wire up Print action from Bill Result screen.~~ *(OUT OF SCOPE. "Open printable bill" already renders the PDF through the Android print sheet.)*
- ~~**T4.7** — Test print output against actual shop printer model; adjust ESC/POS formatting as needed.~~ *(OUT OF SCOPE.)*

## Phase 5 — Dashboard & History

- [x] **T5.1** — Build Dashboard: today's sales total, bill count, low-stock count (computed from DB). *(The Dashboard tab currently holds the temporary T1.5 database verification panel, which this ticket replaces.)*
- [x] **T5.2** — Build "New Bill" primary action button → routes to Billing screen.
- [x] **T5.3** — Build recent bills list on Dashboard (last 5).
- [x] **T5.4** — Build low-stock alert banner with tap-through to filtered Inventory view.
- [x] **T5.5** — Build History screen: full chronological bill list, search by customer/phone/invoice number, date range filter. *(The date range is offered as presets — All / Today / Last 7 days / This month / Last month. `listBills` takes an arbitrary from/to, so a custom picker is an addition rather than a rewrite.)*
- [x] **T5.6** — Wire up tapping a past bill to reopen Bill Result screen (re-share/re-print). *(No separate work: the Bill Result screen and its route were built in T4.3/T4.4, and both the Dashboard's recent list and the History rows push to it.)*

- [x] **T5.6** — Add payment tracking to bills: a required Cash/Credit choice when the bill is generated, and a separate Paid/Not Paid status defaulting from it (Cash → Paid, Credit → Not Paid) but editable at any time. Both shown as tags on the Dashboard's recent bills, in History and on the bill itself, using the same badge pattern as Low Stock/Oversold. Paid/Not Paid can be toggled straight from History without opening the bill. *(Added after Phase 7 began, at the owner's request. Migration 006; both columns nullable and not backfilled, so bills raised earlier show no tags rather than a guessed status.)*

- [x] **T5.7** — Add Quotations: their own tab, their own `Q-0001` numbering (separate from invoices and never reset), the same item flow as Billing including units, a customer name and phone with no GSTIN, and a shareable PDF titled "Quotation". No stock movement and no effect on the invoice sequence. Quotations 20+ days old and not yet converted carry an amber "prices may have changed" badge. "Convert to Bill" loads the quotation into the billing cart at its quoted prices; the resulting bill is dated the day of conversion and takes the next real invoice number, and the quotation is kept, marked converted and linked to it. A quotation cannot be converted twice. *(Added after Phase 7 began, at the owner's request. Migration 007; the backup manifest gains an optional `quotations` count, and "Reset shop data" clears quotations and their counter too.)*

- [x] **T5.8** — Add Edit and Delete to a bill, from the bill screen and from History. Editing reopens it in the billing flow — items, quantities, amounts and units — keeping the original invoice number and date, recalculating GST and totals on save, adjusting stock by the difference, and keeping the replaced version in an internal edit history. Deleting removes it from History and the totals, asking each time whether the items should go back into stock. *(Added after Phase 7 began, at the owner's request. Migration 008; deletion is soft so the invoice number stays consumed and can never be reissued.)*

- [x] **T5.9** — Add Edit and Delete for quotations, from the quotation screen and from the Quotes list, mirroring T5.8. Editing keeps the Q-number, recalculates totals and keeps the replaced version; a converted quotation stays editable and its bill is untouched, with a note on screen naming that bill. Deleting removes the quotation outright — no stock question, since a quotation never moves any — and frees its Q-number if it was the most recently issued. *(Added after Phase 7 began, at the owner's request. Migration 009; deletion is real rather than soft, because the reference has to be reusable and `reference_number` is UNIQUE — the opposite conclusion to a bill's, from the same principle.)*

- [x] **T5.10** — Make the Paid/Not Paid tag tappable to toggle status, on History and on the Dashboard's recent bills. One tap, updated in place, no confirmation — it is reversible by tapping again. The tag carries a small icon and a press state so it does not look like the read-only Cash/Credit tag beside it, and it is a nested control so tapping it does not also open the bill. The bill screen's copy stays read-only. *(Added after Phase 7 began, at the owner's request. Extends T5.6; no schema change.)*

## Phase 6 — Backup & Restore

- [x] **T6.1** — Build `db/backup.ts`: export SQLite DB + manifest to a single shareable file. *(Reads the format as well as writing it, so T6.3 restores something already known to parse.)*
- [x] **T6.2** — Build "Backup Data" action in Settings, using share sheet (Drive, email, etc.). *(Includes the reminder added at the owner's request: a "Backed up N days ago" line in Settings and a Dashboard nudge once a backup is more than 14 days old.)*
- [x] **T6.3** — Build "Restore Data" flow: file picker, validation, DB replacement (with confirmation warning). *(Opens the backup bytes as a database and copies them over the live connection with SQLite’s own backup API — no file is replaced and no path is built, both of which failed on the phone. The result is checked against the backup manifest. Every restore saves the current data first, and “Undo last restore” puts that copy back.)*

- [x] **T6.4** — Add "Reset shop data" to Settings: clears products, bills, bill lines and the invoice counters in one transaction, behind a typed confirmation with a "back up first" button. Keeps the shop's own details. *(Added after Phase 7 began, so the app can be tested freely and then put back to a genuine first-run state before the first real invoice. Clearing the counters is the part that matters — without it the numbering carries on from wherever testing got to. `android:allowBackup` set to false in the same change, so a reinstall cannot silently restore the old database from Google's backup.)*

## Phase 7 — Polish & Non-Functional

- [x] **T7.1** — Add empty states (e.g., "No products yet — tap + to add your first item"). *(Audited rather than built: already present on Inventory, History, Quotations, the quotation editor, the Dashboard's recent bills and an empty bill on Billing. The three filtered lists also distinguish "nothing here" from "nothing matching this", and name the filter in force, because the usual reason something cannot be found is a filter left on from last time.)*
- [x] **T7.2** — Add confirmation dialogs for destructive actions (delete product, restore backup). *(Audited: already present on deleting a product, removing the logo, clearing the bill, deleting a bill, deleting a quotation, resetting shop data, restoring a backup and setting stock by hand — plus the oversell and deleted-product confirmations at "Generate Bill". One genuine gap found and fixed: backing out of a quotation edit left the editor in edit mode, so "New Quotation" reopened it and saving silently overwrote the quotation the owner had walked away from. `beginNew()` abandons an edit and keeps a genuine draft, and the button now says "Continue quotation" when there is one — matching the Dashboard's "New Bill" / "Continue bill".)*
- [x] **T7.3** — Add success/error toasts or banners for key actions (bill generated, product saved, backup complete). *(A brief banner above the tab bar, never a dialog: it takes no touch and goes on its own. Covers adding a product — named, since the list is alphabetical and a new one is hard to spot — saving a bill, saving a quotation, taking a backup, restoring and resetting. It replaced two dialogs rather than adding to them: the restore success Alert and the reset's "Done" modal step.)*
- [x] **T7.4** — Visual pass: apply color system, spacing, and typography per Frontend Spec. *(Scoped by the owner as a light tidy rather than a full audit against the Frontend Spec: fix what is genuinely broken or inconsistent, do not chase compliance for its own sake. Six `set-state-in-effect` errors cleared, which took the lint baseline to zero and removed a duplicate product query on three screens. Four different treatments of a screen-level error replaced by one `ErrorBanner`. Seven tint literals moved into the palette, including two ambers a shade apart. The quotation routes now carry titles, so the header no longer reads "[id]" while one loads. Deeper visual work is still open — see the note in CLAUDE.md.)*
- [x] **T7.5** — Test performance with a large seeded dataset (e.g., 3,000 products, 5,000 bills) to confirm no slowdowns. *(Every screen's queries measured at that size; all but one were under a millisecond. "Frequently sold" on the Billing tab was scanning the whole `bill_items` table on every visit, so its cost grew with the shop's entire history rather than with the 90 days it reads — 1.8 ms at 2,300 rows, 155 ms at 689,000. Fixed by pinning the join order so the date index drives; flat at ~2 ms at every size.)*
- **T7.6 — DESCOPED for v1.** App-level PIN/biometric lock. Decided against by the owner; not deferred, not blocked. The Security & Access Document offered it as a recommendation rather than a requirement, and the phone's own lock is the access boundary. Do not re-raise this as outstanding work.
- **T7.7 — DESCOPED for v1.** SQLite encryption at rest. Decided against by the owner, on the same basis. Note the Security doc's caveat, recorded here so it is not a surprise later: retrofitting encryption onto a database that already holds the shop's data is more work than starting with it, so reversing this decision after launch costs more than it would today.

## Phase 8 — Remote Review & Delivery

- [ ] **T8.1** — Publish an `eas update` after core UI (Phases 1-5) is in place; share the link/QR with the owner for early UI/flow feedback via Expo Go (see Technical Architecture Section 7.2, Stage A).
- [ ] **T8.2** — Incorporate owner feedback from Stage A review.
- [ ] **T8.3** — Build a `preview` profile APK once billing and bill output are working; send directly to owner to test the real experience, especially sharing a bill to WhatsApp and the logo picker, which Expo Go cannot exercise (Stage B).
- [ ] **T8.4** — Incorporate owner feedback from Stage B review; repeat preview builds as needed until owner approves.
- [ ] **T8.5** — Once approved, build the `production` profile APK (final release).
- [ ] **T8.6** — Test-install the production APK on an actual phone; walk through full end-to-end flow: add product → create bill → share/print → check history → backup.
- [ ] **T8.7** — Deliver final production APK to owner for daily use.
- [ ] **T8.8** — Document the update process (Technical Architecture Section 7.4) so future change requests follow: make change → test → bump version → new APK → send.

---

## Phase 9 — Owner Requests (raised after Phase 7 closed)

Features the owner asked for once the app was in his hands. Numbered separately
so Phase 8's delivery sequence is not renumbered around them.

- [x] **T9.1** — Fill a customer's name and phone from the phone's address book, on Billing and on the quotation editor. *(Type-ahead beneath the Name field, the same shape as the product search — not a picker screen. Picking a suggestion fills the name and the number together. The field stays free text throughout: the feature is an assist and never a requirement, and it disappears entirely when the permission is refused. A contact with several numbers becomes one row per number rather than a sub-picker. Read-only access: `expo-contacts` adds `WRITE_CONTACTS` unconditionally and it is blocked in `app.json`. Nothing from the address book is stored, so nothing reaches a backup. A refusal is permanent — Android stops asking, so the app does too — with a row in Settings as the only way back. Reverses the Security doc's original "no contacts" line; recorded there as a reversal.)*
- [x] **T9.2** — Replace the Paid/Not Paid flag with a payment ledger: one row per payment, status computed from the rows. *(`bill_payments`, migration 010. Four states — nothing recorded, Not Paid, Part paid, Paid — shown on the Dashboard, History and the bill. Entries are recorded, corrected and removed from the bill screen; overpayment warns and never blocks, like overselling. Comparisons are in whole paise, because summing REAL rupees can leave a bill a fraction short and stranded on "Part paid" for ever. A bill already marked paid is backfilled with one full-amount entry carrying NO date: the amount was knowable, the date never was. Cash bills open with a full entry and credit bills with none, both editable. The one-tap tag settles the balance in one entry and never un-pays; on a settled bill it opens the ledger.)*
- [x] **T9.3** — Print the payment history and status on the invoice PDF, as a dated block below the invoice body, only when at least one payment exists. *(A deliberate reversal: payment status had never appeared on the invoice. It is kept apart from the tax invoice rather than folded in, because it is the one part of the document that can change after issue — own heading and border below the signature, carrying the date it was drawn, so two copies made at different times do not silently contradict each other. An empty ledger prints nothing at all, so an unpaid bill renders exactly as before. A backfilled entry with no recorded date prints a dash rather than the bill's date, which would be a date on the customer's copy nobody entered.)*
- [x] **T9.4** — Add a not-found product to Inventory from inside a bill or a quotation, without losing what is in progress. *(When a search finds nothing, a button offers to add what was typed. It opens the real Add Product form — every field, nothing shortened, since a product created mid-sale is a real product and a cut-down form would leave its HSN code off the invoice it is about to appear on. The bill survives the trip because the cart lives in the store and the screen stays mounted underneath. On return the owner is asked how many, which is deliberately unlike tapping an existing product — that still lands at one and is adjusted with the stepper. The button is offered only when something was typed, because that text is what names the product.)*

---

**Note on sequencing:** Phases 1-4 form the core usable app (inventory + billing + bill output). Phases 5-6 add convenience and safety. Phase 7 is polish. It's reasonable to get Phases 1-4 working end-to-end first, test it with your father, then continue — rather than building everything before any real-world feedback.
