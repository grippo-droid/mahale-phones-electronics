# Mahale Phones and Electronics — Inventory & Billing App

Offline-first Android app for an electronics retail shop (CCTV cameras, RO water
purifiers, tube lights, bulbs). It manages inventory and generates GST-compliant
bills. Built with React Native + Expo, all data local in SQLite, no backend.

The end user is the shop owner — a non-technical, first-time app user. Simplicity
and large, obvious tap targets matter more than visual flair.

---

## Git rules — read before every commit

**NEVER run `git commit` or `git push` without asking first.** Stage the changes,
summarise what will be committed, and wait for explicit approval before running
either command. This applies for the entire project, every time, no exceptions.

**Commit messages must read as if written by the repo owner.** Plain, factual,
imperative mood — e.g. `Add product inventory CRUD screens`, `Implement GST
calculation for CGST/SGST split`.

**Never mention Claude Code, Claude, AI assistance, or AI generation anywhere in
this repository** — not in commit messages, PR titles or descriptions, code
comments, or documentation. Do not add `Co-Authored-By` trailers naming an AI, and
do not add "Generated with …" footers. The commit history must read as though it
was written entirely by the repo owner.

Force-push and hard-reset are denied outright in `.claude/settings.json`, not just
gated behind approval.

**Commit granularity:** one commit per completed ticket from the Feature Ticket
List — not large multi-feature commits. Work tickets in order; after each one,
stop and let the owner test it before starting the next.

Remote: `https://github.com/grippo-droid/mahale-phones-electronics.git`

---

## Planning documents

The full spec lives in `docs/`. Read the relevant one before building a feature.

| Document | Covers |
|---|---|
| `docs/PRD_Mahale_Phones_Electronics_App.md` | Scope, features, data model, business placeholders |
| `docs/02_Technical_Architecture_Document.md` | Folder structure, schema, state, build & git workflow |
| `docs/03_Security_Access_Document.md` | Local data handling, backups, permissions |
| `docs/04_Frontend_Spec_Document.md` | Navigation, screens, visual direction, usability |
| `docs/05_Feature_Ticket_List.md` | The ticket backlog, worked in order (Phase 0 → 8) |

Follow the Technical Architecture Document's folder structure, schema and state
management approach exactly. Do not substitute a different library or pattern
without flagging it to the owner first and explaining why.

---

## Tech stack

- **Expo SDK 57** (managed workflow), React Native 0.86, React 19.2, TypeScript
- **Expo Router** for file-based navigation (`app/`), typed routes enabled
- **expo-sqlite** — local database, the sole source of truth
- **zustand** — shared app state (bill-in-progress cart, low-stock count, settings)
- **expo-print** → PDF, **expo-sharing** → Android share sheet, **expo-file-system** → backups
- **Bluetooth ESC/POS printing** — library chosen in T4.5, once the shop's printer model is known
- **EAS Build** → APK, installed directly (no Play Store in v1)

Expo SDK 57 changed several APIs. Check the versioned docs at
<https://docs.expo.dev/versions/v57.0.0/> before writing code against an Expo module.

## Folder structure

```
app/                      Expo Router screens
  (tabs)/                 dashboard, inventory, billing, history, settings
  inventory/add.tsx       add product
  inventory/[id].tsx      edit product
  bill/new.tsx            redirects to the Billing tab, which hosts the flow
  bill/[id].tsx           view / re-share / re-print a past bill
store/                    zustand stores (cart.ts = the bill in progress)
db/                       data access layer — the seam for future cloud sync
  schema.ts               table definitions + migrations
  init.ts                 DB setup on app start
  products.ts             product CRUD
  bills.ts                bill CRUD (transactional)
  backup.ts               export / import DB
components/               reusable UI (ProductCard, BillItemRow, GstSummary, LowStockBadge)
lib/                      gst.ts, pdf.ts, printer.ts, invoiceNumber.ts
constants/                business.ts (shop details), theme.ts (colours, spacing, type)
docs/                     the five planning documents
```

Screens must not talk to SQLite directly — they go through the repository
functions in `db/`. That separation is deliberate: it is where cloud sync would
plug in later without rewriting the UI.

`store/` is not in the Architecture doc's folder list — the doc mandates zustand
but does not say where stores live, so this follows the usual Expo convention.

## Commands

| Command | Purpose |
|---|---|
| `npm start` | Start Metro; open in Expo Go |
| `npm run android` | Start and open on a connected Android device/emulator |
| `npx tsc --noEmit` | Type-check |
| `npm run lint` | Lint |
| `eas build --profile preview --platform android` | Installable test APK |
| `eas build --profile production --platform android` | Release APK |

---

## Business details are placeholders

`constants/business.ts` holds the shop's GSTIN, address, state, phone, bank
details and invoice number format. **Every one of these is a placeholder** taken
from PRD Section 8 and marked with the string `PLACEHOLDER`. Grep for
`PLACEHOLDER` to find everywhere real data is still needed. The business state in
particular drives whether a bill is CGST/SGST or IGST, so bills are not correct
until it is filled in.

The brand colour in `constants/theme.ts` is also a placeholder, pending
confirmation of the shop's existing signage/branding.

## Decisions already made (do not re-litigate)

- **Categories** are a fixed dropdown of six: CCTV, RO, Tube Light, Bulb,
  Wiring & Electrical, Other. Free-text entry was rejected — it lets "cctv" and
  "CCTV" become two categories. The Inventory *filter* additionally shows any
  category actually present in the data, so products in a retired category never
  become unreachable.
- **Brand colour** is `#1565C0`, confirmed and final.
- **Low-stock threshold** is nullable per product, falling back to a global
  default held in `app_settings`.
- **Overselling is allowed.** The repository lets stock go negative; the UI warns
  at billing time. Negative stock is its own visual state ("Oversold"), distinct
  from out-of-stock, because it means the recorded count is wrong.
- **Prices carry a per-product GST basis.** `products.price_includes_gst` decides
  whether the entered price already contains GST (MRP-style, customer pays that
  figure) or has GST added on top. The product form shows both figures live.
- **Bill totals round to the nearest rupee**, with the difference shown as a
  visible "Round Off" line on the invoice. Needed because reverse-calculating
  tax out of an MRP lands up to a paisa away from the marked price — ten bulbs
  marked ₹90 compute to ₹899.99. Storage is `bills.round_off` (migration 004,
  lands with T3.6); the calculation is
  `calculateBill(..., { roundToNearestRupee: true })`.
- **`products.purchase_price` is strictly internal** (migration 003). It exists
  so the owner can judge a selling price against what he paid. It must NEVER
  appear on a bill, invoice PDF, thermal print, or anything shared out of the
  app. `bill_items` has no column for it, so a bill has nowhere to carry it —
  keep it that way. Profit is measured against the PRE-TAX selling price,
  because GST collected is not the shop's money.
- **HSN code is optional at save time, with a visible warning.** Products missing
  an HSN code are flagged in the Inventory list, AND the warning must surface
  again at bill-generation time in Phase 4 — an incomplete HSN reaches the
  customer's invoice, so it cannot only be flagged where stock is managed.
- **Invoice numbers are reserved inside the bill's own transaction.** An invoice
  number is a legal record: it must never be reused, and a number must never be
  handed out for a bill that then fails to save. `createBill` takes either an
  explicit `invoice_number` or a `generateInvoiceNumber` callback, and calls the
  callback with the transaction handle — so the counter and the bill commit or
  roll back together. Pass `invoiceNumberGenerator()` from `lib/invoiceNumber.ts`.
  It is injected rather than imported by `db/bills.ts` to avoid an import cycle
  and to keep the numbering rules in one module.
- **The invoice format must carry a token matching its reset period.** Validation
  rejects `{YYYY}` with a financial-year reset, because the sequence restarts on
  1 April while `{YYYY}` only changes on 1 January — two bills in the same
  calendar year but different financial years would both render `MPE/2026/0001`.
  Hence the placeholder default is `MPE/{FY}/{SEQ}`, not `MPE/{YYYY}/{SEQ}`.
- **Invoice counters are stored one row per period** (`invoice_seq:fy-2026-27` in
  `app_settings`), not a single counter plus a "current period" marker, so a bill
  backdated across 1 April resumes the closed year instead of restarting it.
- **`invoiceNumberToFileName()` lives in `lib/invoiceNumber.ts`**, not in the PDF
  module. Indian invoice numbers contain slashes, which are path separators — the
  mapping to a safe filename must have exactly one definition. Use it in T4.2.
- **The billing flow lives on the Billing tab, not a pushed screen.** The tab bar
  stays reachable mid-bill, because checking a price on the Inventory tab during
  a sale is normal at a counter — and the cart is in zustand so that round trip
  costs nothing. `app/bill/new.tsx` is kept as a redirect so the documented route
  and T5.2's "New Bill" button still work.
- **A cart line is a price snapshot, not a live view of the product.** Name,
  price, GST rate and HSN are copied in when the item is added, and are what
  `bill_items` stores. Editing a product mid-bill must not silently reprice a
  line the customer has already been quoted. Stock is the deliberate exception —
  it is NOT held in the cart, because it moves as other sales and adjustments
  land; the screen reads it live via `getProductsByIds` on focus.
- **Oversell is reported inline on the cart line, never as a modal.** A dialog on
  every oversold line trains the user to dismiss it unread, and it hides the cart
  it is describing. Negative stock is a fact about the records, not a decision to
  confirm. A blocking confirmation belongs where an edit is deliberate — see
  `StockAdjuster` — not where a condition is merely reported. If a consolidated
  confirmation is ever wanted, T3.6's "Generate Bill" is the place for it.
- **The running total is only *nearly* invariant to the place of supply, so the
  real supply type is used the moment it is known.** In exact arithmetic CGST +
  SGST at half the rate each equals IGST at the full rate. The implementation is
  not exact: CGST and SGST must come out precisely equal, so each is rounded to
  paise independently at half the rate, and twice a rounded half is not always
  the rounded whole. The two routes land a paisa or two apart, which after
  rounding to the rupee flips the grand total by ₹1 on roughly **one cart in a
  hundred** (measured, not estimated — see the t34 suite). So `resolveSupplyType`
  drives both the bar total and the line totals as soon as the customer's state
  is set, and the stand-in used before that is labelled "approx. until state is
  set" rather than shown as the price. The T3.3 note that claimed plain
  invariance was wrong.
- **Customer state and GSTIN are picked and checked, never trusted as typed.**
  The state comes from a fixed list (`constants/states.ts`) because a typo
  decides CGST/SGST versus IGST. A customer's GSTIN carries its own state in its
  first two digits, so a valid GSTIN that disagrees with the picked state is
  surfaced as a warning with a one-tap fix — the two cannot both be right.
- **A bad GSTIN warns; it never blocks the sale.** Only name, phone and state
  block, because `bills` declares those NOT NULL and state drives the tax heads.
  A GSTIN failing its check digit, or contradicting the state, is real
  information but not grounds to refuse to record a sale — the shop cannot stop
  billing a customer because the number on their card was misread, and a blocked
  sale with a queue waiting is worse than an invoice needing a correction.
  `lib/gstin.ts` implements the published check-digit algorithm; it rejects every
  possible single-character typo (verified exhaustively, 490 mutations).
- **`resolveSupplyType` returns null rather than defaulting.** When the
  customer's state is blank, or the shop's own state is still `PLACEHOLDER`, no
  supply type is returned. A default would print a CGST/SGST breakdown that
  looks authoritative and could be wrong; showing nothing is the honest state.
  The unset shop state also raises a warning on the bill being built, not just
  in Settings.
- **Both billing steps are reachable at any time.** The step switch does not
  gate step 2 behind step 1 — a customer often gives their name before the last
  item is on the bill, and forcing an order onto that means going back and forth.

## Open decisions (from the planning docs)

- Exact registered business name, GSTIN, and address
- Invoice numbering: the real format, whether the sequence resets each financial
  year, and the starting number (raise it if a paper bill book is part-used, or
  the app will reissue numbers the customer already holds). Defaults today are
  `MPE/{FY}/{SEQ}`, financial-year reset, starting at 1 — all `PLACEHOLDER` in
  `constants/business.ts`. The owner is confirming these with the shop before T3.6.
- Bluetooth thermal printer model (blocks T4.5 / T4.7)
- Low-stock threshold: global default or per-product
- Whether to import an existing inventory spreadsheet at launch
- English-only vs. bilingual (Hindi/Marathi) UI
- Optional app-level PIN/biometric lock (T7.6) and SQLite encryption at rest (T7.7)

If something in the documents is ambiguous, ask the owner rather than guessing.
