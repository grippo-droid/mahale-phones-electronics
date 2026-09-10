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
  backup.ts               export / import DB, and the restore rollback
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
- `pincode` — `450331`. Held blank until the owner supplied it rather than
  guessed from the city: a wrong pincode on a GST invoice is worse than a
  blank one, and a `PLACEHOLDER` prints as an empty gap.

**Every required business detail is now real.** What remains as `PLACEHOLDER`
is the three optional bank fields and the logo, all of which are meant to be
optional and all of which print as nothing. Note that
`hasPlaceholderBusinessDetails()` therefore still returns true — it is not
consumed anywhere, so that costs nothing today, but it is not a usable "is the
shop set up?" check while optional fields are counted.

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
- **Invoice numbering is settled: `MPE/{FY}/{SEQ}`, financial-year reset,
  starting at 151.** The paper book reached 150, so the app continues the series
  rather than restarting it. `{SEQ}` pads to four digits, giving
  `MPE/2026-27/0151`. From 1 April the sequence restarts and the year token
  moves with it — `MPE/2027-28/0001` — and a bill backdated into the closed year
  resumes that year instead, because the counter is stored per period.
- **The starting number is honoured only for the shop's very first bill**, and
  that is the one thing to be careful with when handing out a test build.
  `reserveInvoiceNumber` falls back to `startNumber` only when `hasAnyBills` is
  false; after any bill exists, the stored counter takes over and changing the
  setting does nothing to the series. So a phone that has already raised a test
  bill will number the next one `MPE/2026-27/0001`, not `0151` — verified by
  test. The fix is to clear the data before real billing starts, not to edit the
  setting. Separately, saving anything in Settings writes all three invoice
  values into `app_settings`, after which the `constants/business.ts` defaults
  are no longer consulted on that install.
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
- **`expo-image-picker` is configured with `microphonePermission: false` and
  `cameraPermission: false`.** Left at their defaults the plugin adds
  `RECORD_AUDIO` to the manifest — it assumes video recording — and the first
  preview APK shipped asking a billing app for the microphone. Removing the
  materialised `permissions` array from `app.json` does nothing; the plugin
  puts it back at config-resolve time. Setting the option to `false` both skips
  it and calls `withBlockedPermissions`, so no other package can add it either.
  The app only ever calls `launchImageLibraryAsync`, so neither is needed.
  Check with `npx expo config --type introspect`, not by reading `app.json`.
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
- **The windowed "frequently sold" query pins its join order with `CROSS JOIN`,
  and that is a performance fix, not a style choice.** Written as an ordinary
  join, SQLite scans every row in `bill_items` and tests each against the date
  filter, because with no statistics it cannot know the 90-day window is small.
  That makes the Billing tab cost the shop's ENTIRE history on a screen that
  only ever wants a quarter of it. Measured with the window held fixed at 2,304
  items, it ran 1.8 ms at 2,304 total rows and 155 ms at 689,000 — on a desktop;
  a phone is several times slower again. `CROSS JOIN` is SQLite's documented way
  to say "keep these tables in this order", so `idx_bills_date` drives and only
  the window is read; cost then stays flat at ~2 ms however much history piles
  up. `ANALYZE` fixes the plan too, but nothing in this app runs it and its
  statistics go stale as the shop bills; pinning the order needs neither. The
  all-time branch deliberately keeps the ordinary join — with no window every
  row is wanted, and scanning `bill_items` really is cheapest there.
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
- **A quotation is its own table, not a flag on `bills`** (migration 007). It
  takes no invoice number and must never advance that counter — ten quotations
  and no sales has to leave the invoice series untouched. It moves no stock. It
  carries no CGST/SGST/IGST split. And it can simply expire, where a bill is a
  permanent record of something that happened. Behind a nullable column on
  `bills`, every query about sales would have to remember to exclude the rows
  that were not sales.
- **Quotation references are `Q-0001`, one unbroken series, and never reset.**
  The invoice series restarts each 1 April because GST returns are filed by
  financial year; a quotation appears on no return and has no statutory period,
  so it has nothing to restart for. One series also means a reference can never
  be mistaken for an invoice number. Its counter is a single `quotation_seq` row,
  reserved inside the write transaction exactly as an invoice number is.
- **A quotation shows ONE GST figure, and is totalled as an inter-state
  supply.** Which heads apply is decided by the customer's state at the time of
  sale, which a quotation does not collect — so a split here would be invented.
  Of the two routes to a single figure, inter-state is the exact one: intra-state
  rounds half the rate twice and lands a paisa away (see `resolveSupplyType`).
  The bill made from it recomputes with the real supply type and can therefore
  differ by up to a rupee — the same one-cart-in-a-hundred effect already
  documented, and part of why converting opens an editable cart.
- **Converting loads the quotation into the billing cart; it does not write a
  bill.** The bill is then generated on the Billing screen like any other —
  same customer step, same oversell confirmation, same numbering. Two code
  paths that both write bills would be two to keep in step, and the rarer would
  be the less tested. It also means the prices can be checked first, which
  matters most on exactly the quotations carrying the age warning.
- **The bill is dated the day of conversion, never the quotation's date.** The
  date decides the GST return period: a quotation made in March and accepted in
  April is an April sale, and inheriting the old date files it in the wrong
  quarter. That is a reporting error, not a cosmetic one.
- **The bill and the "converted" mark commit together, through `afterInsert`.**
  `createBill` owns its transaction and SQLite will not nest one, so the hook is
  injected — the same pattern already used for `generateInvoiceNumber`, and for
  the same reason. Written as two sequential statements, a failure between them
  would leave a bill nothing points at and a quotation still convertible.
- **The double-conversion guard is `WHERE ... AND converted_bill_id IS NULL`
  with a `changes` check, not a test in the caller.** The read-then-write in
  `convertQuotationToBill` catches the ordinary case; only the WHERE clause
  survives two taps racing. Note the harness CANNOT drive that race —
  `node:sqlite` is synchronous on one connection, so conversions serialise and a
  behavioural assertion passes with the guard removed. That was found by a
  negative control and the test now asserts the issued SQL carries the clause,
  which is weaker and honest about being so.
- **`converted_bill_id` is the only record of whether a quotation converted.**
  A separate boolean would be a second copy of the same fact, free to disagree
  with the link.
- **Quotations are stale at 20 days and the document says the same.**
  `QUOTATION_STALE_DAYS` badges the list; `QUOTATION_VALID_DAYS` prints on the
  PDF. They must not disagree about when a price stops being dependable. The
  badge is amber — the Low stock / Not Paid amber — because an ageing quotation
  is worth attention, not a fault. Red stays for things that are wrong.
- **The shop's chrome on printed documents lives in `lib/documentChrome.ts`,**
  shared by the invoice and the quotation. Branding drifting between a
  customer's quotation and the invoice that follows it is exactly what nobody
  notices until a customer asks whether they came from the same shop. What each
  document does NOT share is its title, columns and totals — and the quotation
  is titled "Quotation", never "Tax Invoice", so it can never be presented as
  proof of a sale.
- **`quotationToCartLines` gives a deleted product a NEGATIVE stand-in id**, so
  the cart can still key lines by id, and `buildNewBill` maps anything not
  positive back to NULL. `bill_items.product_id` is a foreign key: the stand-in
  must never reach it, and NULL is already what "no product behind this line"
  means there — it is also what stops `createBill` reducing stock that is gone.
- **Payment is two fields, not one: how the sale was agreed, and where the
  money is.** `bills.payment_type` ('Cash' | 'Credit') and `bills.paid`
  (1/0/NULL), migration 006. A credit bill gets paid a fortnight later without
  ceasing to be a credit sale, and a cash bill occasionally goes out unpaid.
  Collapsing them into one field would make the commonest action — marking a
  credit bill paid — impossible to express. The type supplies the *default*
  status and nothing more.
- **Picking a payment type re-applies that type's default status**, including
  over a status set by hand. That overwrite is deliberate and nearly always
  harmless, because the two defaults are the two states: an override survives
  whenever it agrees with the new type's default, and changing the type is
  itself a statement about how the sale is being settled.
- **Payment type is required, and is enforced the way an incomplete customer
  is** — reveal every outstanding error and switch to the step holding them.
  The "Generate Bill" button stays enabled, per the rule above: a greyed-out
  button that does not say why is the worst thing to hand a first-time user.
  The picker lives on the customer step because it is a fact about the deal
  being struck with this person, not about what is on the bill.
- **Both columns are nullable with no default, and old bills are not
  backfilled.** NULL means "never recorded", which is the truth for every bill
  raised before migration 006. Defaulting them to Cash/Paid would invent a fact
  about money — a negative control does exactly that and shows an old bill
  turning into a settled cash sale nobody entered.
- **`unknown` is not `unpaid`, and the UI keeps them apart.** A missing status
  renders as an outlined "Not recorded" pill rather than a filled one, so it
  reads as an absence rather than a state. It stays tappable where a toggle is
  offered, so an old bill can be classified instead of being locked out of the
  feature forever; the first tap marks it paid, since a bill being classified at
  all is nearly always one that has since been settled.
- **The tags reuse `LowStockBadge`'s shape, and split the colour families.**
  Type is a neutral fact (grey Cash, blue Credit); status is what the owner
  scans a list for (green Paid, amber Not Paid). Not Paid is amber rather than
  red because an unpaid credit bill is ordinary business to chase, not a fault —
  red stays reserved for things that are wrong, like oversold stock.
- **The paid toggle is on History only.** That is where the owner works through
  several bills with payments in hand. The Dashboard's copy is read-only because
  that screen is for glancing at and a toggle under the thumb would be hit while
  scrolling; the bill screen's is read-only because a bill opened on its own is
  being read, not processed. It is shown there all the same, so no screen
  displays a bill without saying whether it was paid.
- **The toggle updates the screen first and writes after, and puts the old
  value back if the write fails.** Waiting for SQLite would put a visible lag on
  a tap that should feel like a switch. Failing silently is worse: money is
  exactly the wrong thing to be optimistic about and quiet, so a failure
  restores the tag and says which bill did not change.
- **The unit on a bill line belongs to the sale, not to the product.** The same
  cable goes out by the meter to one customer and by the box to another, so
  `bill_items.unit` is per line (migration 005) and `products` has no unit
  column. A fixed four — Meter, Box, Pieces, Feet — in `lib/units.ts`, for the
  reason categories are fixed: free text lets "pcs", "Pcs" and "pieces" become
  three units on one shop's bills, and a GST invoice is the wrong place to find
  that out.
- **The unit column is nullable, has no default, and nothing is backfilled.**
  NULL means no unit was chosen, which is the truth for every bill raised before
  the column existed and for any line the owner leaves alone. A default of
  'Pieces' would reprint years-old invoices with a claim nobody made at the time
  — a negative control covers exactly this, and shows an old line turning from
  "9" into "9 Pcs". `formatQuantityWithUnit` prints the bare number whenever the value
  is not one of the four, so a hand-edited database or a backup from a future
  build cannot put an unknown word on an invoice either.
- **The long form is stored; the short form is printed.** `Meter` in the
  database and in the selector where there is room to be unambiguous, `Mtr` in
  the invoice's narrow quantity column. One mapping, in `lib/units.ts`, so the
  PDF and the on-screen bill cannot drift apart.
- **Adding the column bumps the schema to 5, which the backup format handles
  without any change to itself.** `FORMAT_VERSION` is the container — magic
  line, manifest, payload — and it is untouched; the manifest's `schemaVersion`
  is what moves. An older backup still restores, because a restore migrates the
  incoming database forward before copying it in. The one real consequence is
  the intended one: a backup written by this build is refused by an older
  install, with the message that already existed for that case. None of the WAL
  header handling is affected — that works on bytes 18 and 19 of the file, which
  have nothing to do with the schema.
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
- **Nobody writes a SQL `ESCAPE` clause by hand any more — `lib/likeSearch.ts`
  builds it.** `likeClause(expressions)` returns the parenthesised OR of LIKE
  tests, `likeTerm(search)` returns the escaped, `%`-wrapped parameter, and
  `LIKE_ESCAPE_SQL` is the bare clause for the `app_settings` key-prefix queries
  where the pattern is a constant rather than a user's term. `db/bills.ts`,
  `db/products.ts`, `db/quotations.ts`, `db/settings.ts` and `db/reset.ts` all
  go through it, so the escape character occurs exactly once in the codebase.
  An ESLint `no-restricted-syntax` rule refuses `ESCAPE '` in any other file —
  verified by mutating each repository in turn and watching it fire.
  
  This is a structural fix for a bug shipped twice. The correct code LOOKS
  wrong: the escape character is one backslash, written `'\\'` in TypeScript,
  so the correct clause reads as under-escaped and the instinctive "fix" doubles
  it — which emits two characters and makes SQLite reject the whole statement.
  It then fails only when a search term is present, so every other query against
  the table works and it ships green. `db/bills.ts` carried it from T1.4 until
  History first passed a search term; `db/quotations.ts` reintroduced it in T5.7.
- **`npm run lint` is `eslint .`, not `expo lint`.** `expo lint` never covered
  `db/` or `lib/` — the two directories holding every piece of data logic — which
  is why the lint baseline had only ever reported screens and components, and
  why a rule aimed at the repositories would have been decorative. The hooks
  rules are turned off for those two directories: they contain no React, and
  `useRollbackJournal` in `db/backup.ts` is a pure function whose name begins
  with "use" in the English sense, which the rule reads as a misplaced hook.
- **The old note, kept because the reasoning still applies:** the `ESCAPE`
  clause needs a doubled backslash in source, and the character has one
  definition. `ESCAPE ''` written with a single backslash inside a template
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
- **A restore copies rows through `ATTACH`; it never replaces the database
  file.** The obvious implementation — close the connection, overwrite
  `mahale.db`, reopen — *silently does nothing on this platform*, and shipped
  doing exactly that: the restore reported success and the data was unchanged.
  `SQLiteModule.kt` reference-counts connections. Its constructor looks for an
  already-open database on the same path and, if it finds one, calls `addRef()`
  and returns the existing handle — a cache kept expressly "for fast refresh",
  which is the Expo Go dev case. `closeAsync` mirrors it: `release()`, and only
  a true close at zero. So closing need not close anything. The old `sqlite3*`
  stays open on the old inode, deleting the file only unlinks the name, and
  reopening hands back that same cached handle still reading the deleted file.
  Nothing throws. Nothing changes. **Never close and swap the database file.**
- **A restore goes nowhere near the filesystem.** The staged-file-and-`ATTACH`
  version failed too, for a second reason: `ATTACH` needs a plain filesystem
  path, and under Expo Go the document directory is scoped by experience id —
  `.../ExperienceData/%40anonymous%2F<slug>/`. Whether that escaping belongs to
  the URI or is part of the directory's real name on disk decides whether the
  string should be decoded, and that cannot be determined from the docs.
  `decodeURI` also leaves `%2F` alone by definition, so the first attempt at
  decoding produced a path with a literal `%2F` in it.
  
  So no path is built at all. `deserializeDatabaseAsync` opens the backup's
  bytes — already in memory, just read and checksummed — as a database of
  their own, and `backupDatabaseAsync` (SQLite's Online Backup API) copies one
  open connection over another. No file, no path, no close. **Do not
  reintroduce a staging file, an `ATTACH`, or any URI-to-path conversion.**
- **The backup's WAL flag is cleared before its bytes are deserialised.** The
  live database runs in WAL mode, journal mode is recorded in a database's own
  header, and `wal_checkpoint(TRUNCATE)` flushes the log without changing the
  mode — so every backup this app has ever written carries a WAL header. A
  restore deserialises those bytes into an **in-memory** database, and SQLite
  cannot run one of those in WAL mode: WAL needs a `-wal` file beside a database
  that by construction has no path. The first statement fails SQLITE_CANTOPEN,
  surfacing as *"unable to open database file"* — which reads like a missing
  file and is really a mode that cannot be honoured. `useRollbackJournal` sets
  header bytes 18 and 19 to 1, which is what SQLite itself writes when leaving
  WAL mode, and is safe because the checkpoint already put every committed page
  in the main file. Doing it at read time rather than at write time also repairs
  the backups already in the owner's Drive.
- **`useRollbackJournal` copies; it must never patch in place.**
  `decodeBackup` returns the payload as a `subarray` — a *view* over the bytes
  read from the file. Patched in place, the edit reaches back through the view
  into the backup itself, and since the checksum covers those same bytes the
  next read rejects that file as damaged. An undo would quietly destroy the copy
  it was restoring. Found by restoring one file twice.
- **WAL is re-asserted on the live connection after the copy.** A page-for-page
  backup includes page 1, where the journal mode lives, and whether the API
  carries the source's mode across or preserves the destination's is not
  something the docs settle. Rather than depend on the answer, `copyIn` simply
  asks for WAL again — costless if it was never lost, best-effort because the
  data is already in by then and a performance setting is not worth failing a
  good restore over.
- **The incoming copy is migrated before it is copied in**, with foreign keys
  off, so an older backup is brought forward. It is closed in a `finally` —
  left open it is a whole second copy of the shop held in memory — and a
  failure to close does not fail an otherwise successful restore.
- **Every restore failure carries the step it failed at** (`RestoreStep`), named
  in plain words in the message. Both failures of this feature on the phone
  first showed as "the restore did not work", and narrowing each one down cost
  a round trip. `ownerMessage` also logs every error including the ones shown
  verbatim, because a `RestoreFailedError`'s `cause` is the only record of what
  actually went wrong.
- **A restore never closes the live connection at all**, which is what made the
  earlier "Database not initialised yet" failure possible: a refused write
  skipped the reopen and left the app with no database until it was
  force-quit. There is nothing to reopen now.
- **A restore is verified against the manifest, not against "the database
  still opens".** The first implementation checked only that the tables could
  be queried afterwards — which a restore that changed nothing passes. The row
  counts are now compared with the backup's own manifest, so a restore that
  did not restore fails loudly instead of being discovered months later. There
  are two outcomes left: `untouched` (the transaction rolled back, nothing
  changed) and `mismatch` (it committed but the result disagrees with the
  file).
- **`runMigrations` is exported from `db/init.ts`** so a restore can bring an
  older backup forward before its rows are copied, making the two schemas match.
- **The restore steps are injected (`RestoreIo`) so the recovery path is
  testable.** Every step touches the filesystem or the live connection, neither
  of which exists in a test, but the ordering and the failure handling are the
  whole safety of the operation. Untested rollback code is code that has never
  run. The suite drives it through a fake and asserts the order, both rollback
  paths, and that a failure before the close touches nothing.
- **The confirmation compares the backup with the phone.** "Replace all your
  data?" is a question nobody can answer safely. It names the backup's date,
  shop name and counts beside the current counts, and says that bills raised
  since the backup go too. The same warning is shown before Restore is tapped,
  not only after — someone reaching for Restore wants their data back and does
  not always realise what is on the phone goes in its place.
- **"Undo last restore" is what makes the safety copy real.** Every restore
  writes the current data to `restore-safety/before-restore.mpebak` first, and
  for one release nothing could read it back: the file sits outside `backups/`
  so pruning cannot take it, which also keeps it out of `listBackups`, and the
  only other way into a restore is the system file picker — which does not show
  the app's own scoped directory. A safety net that cannot be reached from the
  screen is not a safety net. `findSafetyCopy()` returns the file or null, and
  the button is rendered only when it is there, so a phone that has never
  restored is not offered a way to undo nothing.
- **The undo is the same operation on a different file.** `confirmAndRestore`
  takes the uri and a `'file' | 'undo'` mode that changes the wording and
  nothing else. Giving the undo its own copy of the confirmation would be two
  restore paths to keep in step, the more dangerous of them reached least often
  and so tested least.
- **The confirmation no longer says "this cannot be undone",** because it can.
  It says a copy of the current data is saved first. A warning that overstates
  is one the owner learns to discount, and that costs more than it buys on the
  next warning that is true.
- **`restoreBackup` reads the whole file before `performRestore` touches
  anything**, and that ordering is load-bearing for the undo specifically: the
  file being restored IS the one `keepSafetyCopy` immediately overwrites. Read
  lazily, the undo would restore the data it was meant to replace. Do not make
  the read lazy; a negative control covers it.
- **The file is validated again at restore time, not just at preview.** The two
  are separated by however long the owner spends reading the confirmation, and
  the second is the step that cannot be undone.
- **After a restore the settings store is reloaded and the cart is cleared.**
  The database underneath the app is a different one: the store holds the old
  shop's details, and the cart holds product ids that may now belong to nothing.
- **An older backup is restored and migrated forward, not refused.** `db/init.ts`
  migrates on open, which is exactly what a restored older database needs. Only a
  *newer* schema is refused, matching the rule already applied to the live
  database.
- **The database path comes from the live connection (`databasePath`), not from
  rebuilding it out of `defaultDatabaseDirectory` and the database name.** The
  rebuilt path would be a second definition of where the file is, free to drift
  from wherever expo-sqlite actually put it.
- **"Reset shop data" clears the invoice counters as well as the rows, and
  that is the whole point of it.** `reserveInvoiceNumber` reads
  `invoice_seq:<period>` from `app_settings` BEFORE it falls back to the
  configured starting number, so deleting only products, bills and bill_items
  leaves the series continuing from wherever testing got to. The next "first"
  bill would be `MPE/2026-27/0154`, not `0151` — verified by a negative control
  that removes the counter delete and watches exactly that happen. Clearing
  bills without clearing counters is not a partial reset; it is a broken one.
  One transaction, so a failure part-way leaves the shop as it was.
- **The reset keeps the shop's details on purpose.** Name, GSTIN, address, the
  invoice format and the low-stock default are configuration, not data. Losing
  them means retyping a GSTIN by hand, which is its own source of error.
  Everything it removes is a row the owner created and can recreate. The
  `LIKE 'invoice\_seq:%' ESCAPE '\'` is escaped for the same reason the search
  in `db/bills.ts` is: an unescaped `_` is a single-character wildcard, and
  would match a future key like `invoiceXseq:`.
- **The confirmation is a Modal with a typed word, not `Alert.prompt`.**
  `Alert.prompt` is iOS-only and does nothing at all on Android — it would have
  shipped as a reset button that silently never asks. The modal also offers
  "Back up first" inline, because the moment someone is about to erase the shop
  is when a backup is worth most, and sending them to another section to find
  it is how it does not happen. The cart is cleared afterwards: it holds product
  ids that now point at nothing, and a half-built bill surviving a reset fails
  at "Generate Bill" with a deleted-product warning on every line, which reads
  as the app being broken rather than as the reset having worked.
- **`android:allowBackup` is `false`.** Expo defaults it to true, which lets
  Android copy the app's internal storage — the SQLite database included — to
  the owner's Google account and restore it automatically on reinstall. That
  makes a reinstall an unreliable way to start clean: it can look like a fresh
  install and quietly bring back the old bills and the old invoice counter. The
  app already has an explicit backup and restore the owner controls, so silent
  duplication mostly adds a way for stale data to reappear unannounced, and
  Security & Access already treats a backup as being as sensitive as the phone.
  Verify with `npx expo config --type introspect`, not by reading `app.json`.
- **Internal error messages never reach the screen.** `getDatabase()` throws
  "Database not initialised yet — await initDatabase() first", which is a note
  to a developer; on a counter it just looks like the app has broken. Settings
  routes every message it displays through `ownerMessage`, which passes
  `BackupFormatError` and `RestoreFailedError` through unchanged — those are
  written to be read — and replaces anything else with a plain sentence, logging
  the original so it is still visible in Metro. A test asserts that no catch
  builds its text out of a raw error again.
- **`expo-file-system`'s `File.pickFileAsync` is the file picker** — SDK 57 has
  one built in, so no `expo-document-picker` dependency was added.

## Open decisions (from the planning docs)

- Bank details for the bill footer — the owner has said these are not needed,
  so the fields stay as placeholders and print as blank gaps. Not an open
  question so much as a settled "no"; every required detail is confirmed.
- Low-stock threshold: global default or per-product
- Whether to import an existing inventory spreadsheet at launch
- English-only vs. bilingual (Hindi/Marathi) UI
- Optional app-level PIN/biometric lock (T7.6) and SQLite encryption at rest (T7.7)

If something in the documents is ambiguous, ask the owner rather than guessing.
