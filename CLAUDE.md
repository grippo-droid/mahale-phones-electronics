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
- **expo-image-picker** — choosing the shop logo in Settings (added in T4.1)
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
store/                    zustand stores
  cart.ts                 the bill in progress (lines + customer)
  settings.ts             the shop's own details, hydrated from app_settings
db/                       data access layer — the seam for future cloud sync
  schema.ts               table definitions + migrations
  init.ts                 DB setup on app start
  products.ts             product CRUD
  bills.ts                bill CRUD (transactional)
  backup.ts               export / import DB
components/               reusable UI (ProductCard, BillItemRow, GstSummary, LowStockBadge)
lib/                      gst.ts, pdf.ts, invoiceNumber.ts, billDraft.ts,
                          customer.ts, gstin.ts, logo.ts, format.ts,
                          categories.ts, dateRanges.ts, numberToWords.ts
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
details and invoice number format. **Most of these are still placeholders** taken
from PRD Section 8 and marked with the string `PLACEHOLDER`. Grep for
`PLACEHOLDER` to find everywhere real data is still needed.

**Confirmed by the owner (no longer placeholders):**

- `gstin` — `23ALYPM5121B1ZA`. Check digit verified with `lib/gstin.ts`.
- `state` — `Madhya Pradesh`, derived from the GSTIN's first two digits (`23`)
  rather than answered separately, so the two cannot disagree. This is what
  decides CGST/SGST vs IGST, so bills now compute the correct split.
- `name` — `Mahale Phones And Electronics`. Taken from the shop's own printed
  bill, capital "And" included; it is left exactly as given rather than tidied,
  because it is the name on his paperwork.
- `addressLine1` / `addressLine2` / `city` — `Shop No. 7, ARCO Complex` /
  `Shanwara` / `Burhanpur`. The owner gave this as one line ("Shop no. 7 ARCO
  COMPLEX Shanwara Burhanpur MP"); splitting it across the three fields the
  invoice prints separately is a judgement, not something he stated. The
  trailing "MP" is dropped as a duplicate of the state field.
- `phone` — `9826351449`. `email` — `mahale71phones@gmail.com`.
- The **pincode is still missing** and is deliberately not guessed from the
  city. A wrong pincode on a GST invoice is worse than a blank one, and a
  `PLACEHOLDER` prints as an empty gap.

`businessStateGstinMismatch()` re-checks that pairing, and the Settings screen
runs it live — both fields are editable there and can be made to contradict each
other.

**From T4.1, `constants/business.ts` is the first-run defaults only.** The live
values are rows in `app_settings`, read through `db/settings.ts` and held in
`store/settings.ts`. Anything that prints on a bill must read the store, never
the constants file — the constants are what a fresh install starts from, not
what the shop currently has. Settings living in the database also means a Phase
6 backup carries them, so restoring onto a new phone does not lose the GSTIN.

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
  shipped with T3.6); the calculation is
  `calculateBill(..., { roundToNearestRupee: true })`. It is stored rather than
  recomputed on read because it is a printed line on a legal document: the bill
  must reproduce years later even if the rounding rule ever changes.
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
- **The GST summary panel lives on the customer step, not the items step.** The
  CGST/SGST-vs-IGST split is decided by the customer's state, so picking the
  state and watching the split appear belong on one screen. The panel shows the
  rate-wise table only once the supply type is real — a rate-wise table is the
  most authoritative-looking thing on the screen and the worst thing to render
  from a guess. Before that it shows the taxable value and an explicitly
  approximate grand total.
- **A stored empty string is a decision; a missing row is not.** In
  `getBusinessDetails`, a field that has never been written (NULL) falls back to
  the `constants/business.ts` default, but one written as `''` stays empty.
  Otherwise clearing an optional field such as the bank name would silently
  restore the placeholder on the next read.
- **An invalid invoice format blocks the save; a GSTIN mismatch only warns.**
  The asymmetry is deliberate. A format whose token cannot tell two periods
  apart will hand the same number to two customers, and a duplicate invoice
  number is not a thing to warn about and allow. A GSTIN/state disagreement is
  serious but recoverable, and the owner may be mid-edit with one of the two
  already correct.
- **Never `File.move()` or `File.copy()` a file another module wrote.**
  `expo-file-system`'s `move`/`copy` validate READ permission on the *source*
  against the app's scoped paths (`FileSystemPath.kt`). `expo-print` writes its
  output to the **host** app's cache directory, which under Expo Go is outside
  this experience's sandbox — so moving it fails with *"Missing 'READ'
  permission for accessing the file"*. `generateBillPdf` therefore asks
  `printToFileAsync` for `base64` (encoded natively inside expo-print, so it
  never crosses the boundary) and writes the bytes into the document directory
  itself, via `base64ToBytes`. Picking a logo is fine with `copy()` because the
  source is a URI the system has granted access to.
- **Printing takes HTML; sharing takes a file.** The two actions on the Bill
  Result screen deliberately take different routes. Printing renders HTML
  through the print sheet (see the crash note below). Sharing needs something on
  disk to hand another app, so it calls `generateBillPdf`, records the path with
  `setBillPdfPath`, and reuses it on a second share — `expo-sharing` passes the
  file through a FileProvider, so it never hits the `{ uri }` bug.
- **The invoice template sets its own pagination rules.** A bill long enough to
  run past one A4 page breaks badly on browser defaults: column headings appear
  only on page one, a row gets sliced through the middle, and the totals block
  can be orphaned. Hence `thead { display: table-header-group }` and
  `page-break-inside: avoid` (with the modern `break-inside` spelling) on rows,
  the totals block and the signature block.
- **Never call `Print.printAsync({ uri })` on Android — use `{ html }`.** The
  `uri` branch of expo-print's `PrintModule.kt` resumes its coroutine as soon as
  the job is handed to the system `PrintManager` (line ~70), and then resumes it
  a *second* time from `PrintDocumentAdapter.printFailed` if anything goes wrong
  during `onWrite`. Resuming an already-resumed continuation throws
  `IllegalStateException: Already resumed` on a background thread — an uncaught
  **native crash**, not a JS error, so nothing appears in Metro. The `{ html }`
  branch goes through `PrintPDFRenderTask` and resumes exactly once. Output is
  identical, since `generateBillPdf` renders the same HTML. Use `buildBillHtml`.
- **The Bill Result screen draws the bill natively; the PDF is one tap away.**
  Android's WebView cannot display a PDF on its own, and the app is
  offline-first so a remote viewer is out. Rather than add a PDF-rendering
  dependency, the screen draws the same stored rows the PDF is built from — it
  appears instantly, needs no network, and is readable on a phone without
  pinching at an A4 page. "Open printable bill" calls `Print.printAsync({ uri })`,
  and the Android print sheet renders the real PDF, so that is where printed
  layout gets checked. Both surfaces read `bills`/`bill_items`, so they cannot
  disagree.
- **The PDF is generated on demand, not on arrival.** The owner reaches this
  screen wanting to see that the bill saved, not to wait on a render. The
  figures are on screen immediately; the file is made when it is asked for, and
  its path is recorded on the bill so History never re-renders it.
- **A PDF failure must not read as a bill failure.** The bill is already
  committed by the time this screen exists. A render error says so explicitly —
  "the bill is saved, but its PDF could not be made" — rather than showing
  anything that suggests the sale did not record.
- **The PDF renders from the STORED bill, never recalculating.** `lib/pdf.ts`
  reads `bills` and `bill_items` and prints those figures as they are. The
  customer's copy and the shop's record have to be the same document, and the
  way they stop being the same is a template that recomputes. This is also why
  it has its own `summariseStoredItems` instead of reusing `summariseByRate`
  from `lib/gst.ts` — that one works on freshly calculated lines.
- **Which tax heads to print is read from the stored amounts, not the states.**
  If the shop's state is later corrected in Settings, a reprint of an old bill
  must still show what the customer was actually charged. The one exception is a
  bill of entirely 0%-rated goods, which carries no tax under any head; that
  falls back to comparing states, which is safe because only the column heading
  differs.
- **A `PLACEHOLDER` value prints as an empty gap.** An invoice reading
  `PLACEHOLDER_CITY` looks like a system fault; a gap looks like missing data,
  which is what it is.
- **The logo is embedded as a `data:` URI, never linked by path.** `expo-print`
  renders through a WebView, and a `file://` image is not reliably loadable
  there. `renderBillHtml` therefore takes the bytes and stays pure/synchronous;
  `generateBillPdf` does the reading. A failed read yields no logo rather than
  a failed bill.
- **All free text is escaped into the template.** Customer names and addresses
  are typed at a counter and land in HTML — "Sharma & Sons" alone would break
  the markup.
- **A picked logo is copied out of the cache, never referenced there.**
  `expo-image-picker` returns a URI in the app's cache directory, which Android
  clears under storage pressure and "Clear cache" wipes outright. A path stored
  there works perfectly in testing and then silently vanishes months later,
  taking the logo off every bill printed afterwards with no error to explain it.
  `lib/logo.ts` copies into the document directory, which is documented as safe
  from the system deleting it. The saved filename carries a timestamp because
  React Native caches images by URI — a fixed name would leave the old logo on
  screen after a replacement.
- **The logo saves on selection, not with the form's Save button.** It is a file
  copy rather than a text field, and pairing it with the button would mean a
  picked image is silently lost by leaving the screen.
- **SDK 57 file-system API:** use the `File` / `Directory` / `Paths` classes.
  The old `copyAsync` / `deleteAsync` helpers still exist as names but **throw at
  runtime** — they moved to `expo-file-system/legacy`.
- **Business details are hydrated once, before any screen renders.**
  `app/_layout.tsx` awaits `useSettingsStore.load()` as part of the same gate
  that waits for the database. `hydrated` stays false if the load fails, so a
  caller can tell "these are the shop's details" from "these are the compiled
  placeholders" — the difference between a correct bill header and one reading
  `PLACEHOLDER_ADDRESS_LINE_1`.
- **A scrolling list in a flex column needs `flex: 1`, or it overflows.** A
  `FlatList`/`ScrollView` with no flex sizes itself to its content and grows
  past the column, which put rows underneath the Billing screen's pinned
  summary bar. Every list on that screen carries `styles.list` (`flex: 1`) and
  `styles.listContent` (bottom padding to clear the bar and the buttons below
  it). A horizontal `ScrollView` in a column needs `flexGrow: 0` for the
  mirror-image reason — otherwise it claims vertical space it does not need.
- **"Frequently sold" is ranked by UNITS, over 90 days, top 12.** Units rather
  than bill count: the list exists to save taps at a counter, and that is
  decided by what moves in volume — ten bulbs on one bill beats one camera on
  ten bills. Ranking by bill count would promote big-ticket items, which are
  exactly the ones worth searching for deliberately. 90 days rather than 30
  (one festival week would dominate) or all-time (whatever sold in the first
  month would stay pinned forever).
- **The quick list has a fallback ladder, and always says which rung it is on.**
  90 days if at least 5 distinct products sold in it; otherwise all-time if
  anything ever sold; otherwise the catalogue grouped by category. An empty
  "Frequently sold" heading on a new shop would be worse than not having the
  feature. The caption names the basis, so a ranking is never presented without
  saying what it is a ranking of.
- **It is computed from `bill_items`, never from a counter on `products`.** No
  extra bookkeeping to keep in step, and it survives a backup restore. A
  `bill_items` row whose product was deleted has a NULL `product_id` and is
  dropped by the join — a product that no longer exists cannot be offered,
  while the bill it appeared on stays intact.
- **Out-of-stock products stay in the quick list, showing their stock.**
  Overselling is allowed everywhere else; hiding a product because the recorded
  count says zero would contradict that. The stock figure makes the tap an
  informed one.
- **The category chip list has one definition, in `lib/categories.ts`.** Both
  Inventory and Billing show it, and two copies of the rule would drift. The
  rule itself is the interesting part: the chips are the fixed list **plus any
  category actually present in the data**, because filtering has to cover what
  is really stored — a product in a retired or renamed category would otherwise
  be invisible under every chip including its own, and so unbillable.
- **The chip row is also rendered in one place, `components/CategoryChips.tsx`.**
  T3.7 shared which chips to show but left both screens drawing them, and the
  copies drifted exactly as expected: the T3.8 layout fix landed on Billing and
  left Inventory's last chip clipped. Sharing the rule without sharing the
  rendering was half a job.
- **On Billing, a category chip and a typed search both mean "browsing".** They
  combine in the query, and one control (`backToBill`) clears both. Leaving the
  user to work out that two separate things need clearing to see the bill again
  would be needless.
- **`lib/billDraft.ts` is the only thing that turns a cart into a bill.** It is
  a pure function, so what gets written is checkable without a screen or a
  database, and both the totals shown and the totals stored come from the same
  `calculateBill` call. A bill whose line items do not add up to its own total
  cannot be defended to a customer or an inspector, and the way that happens is
  the screen totalling one way and the repository another.
- **Oversell gets exactly one confirmation, at "Generate Bill".** The per-line
  warnings are statements of fact and stay inline (see above). The button is the
  single point where recorded stock actually changes, so it is the one place a
  decision is being made — one consolidated dialog listing every affected line,
  never one dialog per row. A deleted product gets its own separate prompt,
  because it is a different problem: there is no stock to reduce at all.
- **The cart is cleared only after `createBill` returns.** If the write throws,
  the cart is still intact and the sale can be retried rather than retyped at a
  counter with a customer waiting.
- **The "Generate Bill" button is never greyed out.** Pressed on an incomplete
  form it switches to the customer step and reveals every outstanding error at
  once. A disabled button that does not say why is the most confusing thing to
  hand a first-time user.
- **The missing-HSN warning surfaces on the summary panel.** This closes the
  Phase 2 carry-over: an absent HSN is an inventory annoyance on the Inventory
  tab, but on the summary panel it is about to be printed on a customer's GST
  invoice. It is read from the cart line's HSN **snapshot**, not re-queried from
  the product, because the snapshot is what `bill_items` stores and therefore
  what actually reaches the invoice. It warns; it never blocks.
- **The `ESCAPE` clause needs a doubled backslash, and the character has one
  definition.** `ESCAPE ''` written with a single backslash inside a template
  literal compiles to `ESCAPE ''`, and SQLite rejects the entire query —
  *"ESCAPE expression must be a single character"*. `db/bills.ts` shipped that
  way from T1.4 and nothing noticed, because nothing passed `listBills` a search
  term until the History screen did. `LIKE_ESCAPE` now holds the character once,
  used by both the SQL and `escapeLike`, so the two cannot disagree. The
  escaping itself matters: a customer called "100% Traders" would otherwise
  match every bill in the shop.
- **History's count and total describe the whole filter, never the loaded
  page.** `summariseBills` runs the same WHERE clause as an aggregate, built by
  the same `buildBillFilter` as `listBills`. Adding up the rows in memory would
  give a figure that climbs as the list is scrolled — worse than showing
  nothing, because it looks authoritative and is wrong until the last page
  loads. It is also what makes searching a phone number and reading off what
  that customer has spent actually work. It deliberately ignores `limit` and
  `offset`.
- **The date filter is presets, not a two-date picker.** All / Today / Last 7
  days / This month / Last month. A spinner picker is two fiddly dialogs to
  answer a question that is nearly always one of those five, and it would mean
  a new native dependency. The month presets are not arbitrary: GST returns are
  filed per calendar month, so "Last month" is exactly the set of bills that
  goes on the return. `listBills` still takes an arbitrary `from`/`to`, so a
  custom range is an addition rather than a rewrite.
- **"Last 7 days" rather than "This week".** A calendar week needs a start day
  and there is no answer that is right everywhere — Monday is the business
  convention, Sunday is what `en-IN` says. A rolling seven days has no
  convention to get wrong.
- **Month ranges are anchored to day 1, never to today's day-of-month.**
  Subtracting a month while keeping the day is the classic date bug: on 31
  March it lands on 3 March. `resolveRange` builds `new Date(y, m - 1, 1)` and
  finds the end with day 0 of the next month, which needs no month-length table
  and handles February in a leap year.
- **History rows are grouped under a sticky day heading.** The day is what the
  owner searches by, and a heading says it once instead of every row repeating
  it. The heading carries an explicit opaque background — a sticky header that
  is transparent lets rows scroll through its text. Grouping works by collapsing
  *consecutive* same-day rows, which is only correct because `listBills` orders
  by date; the test asserts no day ever gets two headings.
- **The full-screen spinner on History is for the first load only.** Changing a
  filter keeps the old list on screen until the new one arrives. These are local
  SQLite reads over a few hundred rows, so blanking the list to a spinner on
  every keystroke of a debounced search would be all flicker and no information.
- **Every History query carries a request id, and stale replies are dropped.**
  Type "ram" and clear it, and two queries are in flight; whichever is slower
  wins. Without the guard the emptied search box can end up showing Ramesh's
  bills, which reads as the search being broken. The same id also stops a
  page-two response from being appended to a list that a filter change has
  already replaced.
- **`useFocusEffect` is History's only loader.** It fires on first focus and
  again whenever the search term or date range changes, so a second `useEffect`
  is not redundancy but a double fetch. Reloading on every visit does reset
  paging — the cost is losing your place if you were scrolled deep into last
  year — but the far commoner case is raising a bill and coming here to check it
  saved, and a History screen that does not show the bill just made is the worse
  of the two failures.
- **Bluetooth thermal printing is out of scope, not deferred.** The shop bills
  over WhatsApp: the customer gets the PDF on their phone, which T4.2–T4.4
  already deliver. A thermal printer would add a native dependency, a pairing
  flow in Settings, a second bill layout in ESC/POS, and a class of failure —
  unpaired, out of paper, out of range — arriving at the moment a customer is
  waiting to be handed something. `lib/printer.ts` is not a gap in the folder
  structure; it is a file that will not exist. A printed copy is still one tap
  away: "Open printable bill" renders the real PDF through the Android print
  sheet, which drives whatever printer Android can already see. Do not re-raise
  this as an open item or a blocked ticket.
- **A backup is the raw SQLite file behind a two-line text header.** Magic line,
  manifest as one line of JSON, then the database byte for byte. No zip (a new
  dependency for a container with two members) and no base64 (a third larger,
  and unopenable by anything but this app). What the format buys: the first two
  lines can be read by opening the file in any text editor — which matters when
  the owner is in another city and something has gone wrong — and the rest is a
  real database a desktop tool can open if this app ever cannot.
- **`db/backup.ts` both writes and reads the format.** A format that is only
  ever written is not known to be readable, and discovering otherwise during
  T6.3's restore, with the owner's only copy as the test case, is too late. The
  test round-trips it: serialise, encode, decode, write the payload out and
  reopen it with a different SQLite engine to read the shop back.
- **Backups use `serializeAsync`, not a file copy.** The connection runs in WAL
  mode, so a copy of the `.db` file can miss commits still sitting in the log.
  SQLite's own serialize call gives a consistent snapshot; the
  `wal_checkpoint(TRUNCATE)` before it is belt and braces.
- **The checksum is FNV-1a and is not a signature.** It catches a truncated or
  damaged file — an interrupted share, a cloud sync that mangled bytes — which
  is the realistic failure. It proves nothing about who wrote the file, and
  cannot: anyone editing a backup can recompute it. That is consistent with
  Security & Access 5, which already says a backup is as sensitive as the phone
  and is not encrypted.
- **Every rejection is worded for the shop owner, and is a `BackupFormatError`.**
  "Unexpected token < in JSON" tells them nothing about what to do next. The
  checks run in the order that gives the most useful message: is it ours, can we
  read this version, is the manifest intact, are all the bytes there, are they
  undamaged, is it actually a database, is its schema one this build understands.
  Restoring is the one unrecoverable thing this app can do, so anything doubtful
  is refused before T6.3 ever sees it.
- **Pruning never deletes the backup just written.** Only the newest three local
  copies are kept, and "newest" means newest *by filename* — which carries the
  phone's clock. A device with a wrong date, or one set back, writes a name that
  sorts last, and naive pruning would delete the file it had just created,
  reporting success with nothing to share. The just-written file is excluded
  unconditionally rather than trusted to sort first. The local copies are only a
  convenience for retrying a failed share; the real backup is the copy the owner
  sends to Drive.
- **UTF-8 is encoded by hand in `db/backup.ts`.** The manifest carries a byte
  count that the decoder checks, so the encoding has to be the same everywhere
  rather than whatever the runtime provides. Unpaired surrogates become U+FFFD
  instead of producing invalid UTF-8. Verified against Node's encoder for every
  non-surrogate code point below U+10000.
- **`expo-file-system` can pick files in SDK 57** — `File.pickFileAsync`. T6.3
  needs no `expo-document-picker` dependency.
- **"Last backed up" means a file was created, not that it reached Drive.**
  Android's share sheet reports that it was dismissed, never whether the
  transfer succeeded, so the app cannot know. A timestamp claiming more than it
  can prove is worse than none — it is exactly the reassurance that stops
  someone checking. Hence the wording is "Last backup", never "your data is
  safe", and the Settings section says plainly that a backup kept on the phone
  is lost with the phone. A test asserts that reassuring wording stays out.
- **A failed share is never reported as a failed backup.** The file is on disk
  either way and `listBackups` keeps it for a retry, so the two steps report
  separately: "the backup could not be made" returns before sharing is
  attempted, while a sharing failure says the backup itself succeeded. The early
  return is enforced by the compiler rather than by convention — `made` is
  declared before the `try`, so using it after a catch that does not return is
  "used before being assigned".
- **The Dashboard nudge is gated on there being something to lose.** A fresh
  install has never been backed up and so is technically overdue, but nagging
  about an empty database is the fastest way to teach someone to ignore the next
  banner. It needs at least one product or one bill — products count, because an
  evening spent entering three hundred items is worth protecting before the
  first sale. "Any bill" is read from the recent-bills query already on the
  screen, not from the month total: a shop whose last sale was in December still
  has everything to lose in January.
- **Backup age is counted in calendar days, not elapsed hours.** A backup at
  11pm reads as "yesterday" at 1am, matching how bills are dated everywhere
  else. A timestamp in the future — a phone whose clock moved — reads as today
  rather than as an enormous overdue figure.
- **`last_backup_at` lives in `app_settings`, so it travels in the backup.**
  That is right: a restored phone genuinely was backed up on that date. It
  necessarily records the backup *before* the one being restored, since a file
  cannot contain its own creation time — which errs towards nagging, the safe
  direction.

## Open decisions (from the planning docs)

- The shop's pincode. Name, GSTIN, state, address, phone and email are all
  confirmed — see `constants/business.ts`.
- Invoice numbering: the **format only**. The starting number is settled at 151
  (the paper book reached 150) but is not to be written until the format is
  chosen — the owner asked for it to be held. The choice is between plain
  sequential (`{SEQ:1}` with reset `never`, giving 151, 152, …) and the
  structured format (`MPE/{FY}/{SEQ}` with a financial-year reset, giving
  `MPE/2026-27/0151`). Both validate today. Note that `{SEQ}` alone pads to four
  digits — `0151` — so plain continuation of the paper series needs `{SEQ:1}`.
- Low-stock threshold: global default or per-product
- Whether to import an existing inventory spreadsheet at launch
- English-only vs. bilingual (Hindi/Marathi) UI
- Optional app-level PIN/biometric lock (T7.6) and SQLite encryption at rest (T7.7)

If something in the documents is ambiguous, ask the owner rather than guessing.
