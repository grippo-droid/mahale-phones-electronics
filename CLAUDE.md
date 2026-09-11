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
- **expo-contacts** — read-only address-book lookup for the customer's name
  and number (added in T9.1). `WRITE_CONTACTS` is blocked in `app.json`.
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

## The test harness is a stand-in, and its gaps are where the bugs live

Tests run in a scratchpad harness: the TypeScript in `db/`, `lib/`, `constants/`
and `store/` compiled to CommonJS, with hand-written shims for `expo-sqlite`
(over `node:sqlite`), `expo-file-system`, `expo-print` and `zustand`. It is
fast, needs no device, and has caught a great deal.

**Every bug that has reached the owner's phone got there through a place where
the shim was kinder than the real library.** Three times now, and the shape is
always the same: the suite is green, the code is wrong, and the harness simply
never modelled the thing that breaks.

- **The WAL header.** `node:sqlite` has no deserialize, so the shim wrote the
  bytes to a file and opened that — where a WAL header is harmless. It also ran
  the test database as `:memory:`, so WAL never engaged and every backup the
  suite produced carried a rollback header. The bug was unreproducible by
  construction.
- **`withExclusiveTransactionAsync`.** The shim ran the callback on the same
  connection, which is the sane implementation. The real one opens a SECOND
  connection by `databasePath` — which for a deserialized backup is the literal
  `':memory:'`, i.e. a different, empty database. Migrations ran against
  nothing. Restoring an older backup failed on the owner's phone while the
  suite stayed green.

**So the rule: when a bug is found on the device, fix the HARNESS first.** Make
the shim behave the way the real library does, watch the suite go red for the
real reason, and only then fix the code. Both times this immediately surfaced
something else — the WAL fix exposed a subarray-aliasing bug, and the
transaction fix exposed a test that had been spying on the wrong connection. A
green suite after a device bug means the harness is still lying.

**Known gaps, as of migration 009.** These are not covered, and a passing suite
says nothing about them:

- **No real in-memory database.** `node:sqlite` cannot deserialize, so the shim
  writes bytes to a temp file and then reports `databasePath` as `':memory:'` —
  faithful in the property that matters for transactions, not in general.
- **No native connection cache.** `SQLiteModule.kt` reference-counts
  connections by path (`addRef`/`release`), which is what made a close-and-swap
  restore silently do nothing. The shim has no equivalent.
- **No filesystem.** `expo-file-system` is stubbed to throw, so backup writing,
  sharing, the safety copy and PDF files are exercised only through their pure
  parts.
- **No renderer.** Screen behaviour is checked by reading source, which catches
  wiring being removed and nothing else. Anything about touch handling — the
  nested `Pressable` on the paid tag, for instance — has to be checked on a
  real build.
- **No concurrency.** `node:sqlite` is synchronous on one connection, so races
  serialise. A test asserting "only one of two concurrent writes won" passes
  whether or not the guard exists; say so rather than implying coverage.

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
- **The customer's name field reads the address book; nothing else does, and
  nothing is kept** (T9.1). Type two characters and matching contacts appear
  beneath the field; picking one fills the name AND the number, because filling
  only the name would leave the more error-prone of the two still to be typed.
  The field stays free text — most walk-in customers are in nobody's contacts,
  and a shop cannot be made to add someone to the address book before it can
  bill them.
- **`expo-contacts`' config plugin adds `WRITE_CONTACTS` as well as
  `READ_CONTACTS`, and has no option to stop it.** Its only option is
  `contactsPermission`, an iOS usage string. So `app.json` lists
  `android.blockedPermissions: ["android.permission.WRITE_CONTACTS"]`, which
  emits `tools:node="remove"`. This is the `RECORD_AUDIO` trap again — a plugin
  asking for more than the app uses — and the same rule applies: **check with
  `npx expo config --type introspect`, never by reading `app.json`.** What to
  look for is that `android.permissions` holds `READ_CONTACTS` and that
  `WRITE_CONTACTS` appears only under `android.blockedPermissions`.
- **A contact's number is reduced with `phoneDigits` before it reaches the
  field, and that is a correctness fix rather than tidiness.**
  `normaliseCustomer` stores the phone as typed and History searches it with
  LIKE, so a bill filled with "+91 98263 51449" would not be found by searching
  "9826351449" — and one customer's spend would split across two formats, which
  is exactly the History feature the owner uses. Filling with the digits puts
  the same thing in the field that hand-typing would. A negative control fills
  the raw number and seven checks fail.
- **A refusal is permanent, and the app never asks twice.** `accessFor` maps
  Android's answer to `ready` / `ask` / `unavailable`, with no fourth state for
  "denied but worth another go". Android stops presenting its dialog after a
  denial, so an app that keeps requesting only produces a control that appears
  to do nothing. The way back is a row in Settings that opens Android's own
  permission screen — there because the owner has to go looking for it, which
  is what keeps it from being a nag. That row is hidden entirely until Android
  has actually been asked once: a row about a permission nobody has been asked
  for would be the app raising it unprompted.
- **The explanation shown before Android's dialog is informational, not a
  confirmation.** "Not now" is a real answer and costs nothing. It is needed
  because the system dialog says only that an app wants Contacts, never why a
  billing app would — and that gap is the difference between a reasonable
  request and an alarming one.
- **"Not now" is remembered in memory only, for the life of the app process.**
  It is a postponement rather than an answer, and the real answer lives with
  Android. Asking once more the next time the app is opened is not nagging;
  asking again on the next bill would be. Deliberately NOT stored in
  `app_settings` — a stored copy would be a second record of a fact Android
  already owns, free to disagree with it after a change made in Android
  Settings while the app was open. Same reasoning as `converted_bill_id`.
- **The suggestion list renders in normal flow, never as a floating dropdown.**
  Both forms that use it sit inside a `ScrollView`, which clips an
  absolutely-positioned overlay on Android. Pushing the form down also cannot
  cover the field being typed into.
- **A contact with three numbers becomes three rows, not a sub-picker.**
  Picking is then one tap, and there is no second state to design, dismiss or
  get stuck in. The name repeats down the rows, which is what makes them read
  as one person.
- **What the harness can and cannot say about this.** The address book, the
  permission dialog and the list rendering are all device-only. The reader is
  injected (`ContactsReader`, the same seam as `RestoreIo`) so the parts where
  bugs actually live are reachable without one: the number that lands in the
  field, the permission ladder, and the flattening. A green `contacts` suite
  says nothing about whether the type-ahead appears on a phone — that has to be
  looked at.
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
- **Every screen with category chips re-queries its product list on focus.**
  Billing and the quotation editor originally keyed that query only on the chip
  and the search term, so leaving with a chip selected, adding a product, and
  coming back re-queried nothing — none of the dependencies had changed, and the
  list quietly no longer matched inventory. Inventory already reloaded on focus
  and does not have the bug. The query is a callback, guarded by a request id so
  a slower earlier reply cannot overwrite a newer one.
- **`useFocusEffect` is the ONLY loader on every list screen, and a plain
  `useEffect` beside it is a second query rather than a safety net.** It re-runs
  whenever its callback changes while the screen is focused, so a keystroke, a
  chip or a toggle already goes through it. History worked this out first; the
  fix above then added a focus handler to Inventory, Billing and the quotation
  editor while leaving each screen's original effect in place, so all three ran
  every query twice. T7.4 deleted them.
  
  Two of those effects had also been wrapped in `await Promise.resolve()` to get
  past `react-hooks/set-state-in-effect` — which silenced the rule and kept the
  duplicate. A lint rule pointing at a real defect is not a thing to reschedule
  around. Guarded by the `effects` suite, since lint cannot see a duplicate.
- **State that follows a prop or a route parameter is adjusted during render,
  not in an effect.** Four of the six `set-state-in-effect` errors were this
  shape: the quantity field following the stepper, Settings' draft following a
  restore, Inventory's filter following the Dashboard's banner. React re-runs
  the component before committing, so the stale value is never painted — where
  an effect shows it for a frame and then replaces it. Each keeps a small
  "last seen" state and compares, which is React's own documented pattern. The
  fifth was not state at all: a route parameter that will not parse is an
  answer, so `bill/[id]` derives it.
- **A newly added product appears in ALPHABETICAL position, not at the top.**
  `listProducts` orders by name, so under "All" with thirty-odd products a new
  one lands mid-list and off-screen, while under its own category chip the list
  is short enough that it is visible. That looks exactly like a stale list and
  is not one — the header count moves immediately. Worth remembering before
  chasing a cache that does not exist. What it argues for is the save
  confirmation in T7.3, not a refetch change.
- **A screen-level failure is `components/ErrorBanner.tsx`, everywhere.** The
  same message had grown four treatments across eight places: a tinted box with
  an icon on the Dashboard and History, an icon and no box on Quotations, a bare
  line of red text on Inventory, Billing, Settings and both quotation screens.
  Red text alone on a white screen does not read as a message — it reads as the
  layout having broken — and nothing told the owner these were the same kind of
  thing. It is deliberately not the shape of `Toast`: a banner sits in the
  layout and stays until the condition clears, because a failure that needs
  acting on must not disappear on its own. Margins stay with the screen, since
  some sit inside a padded scroll view and some do not.
- **Tints live in the palette with the colour they tint** (`brandTint`,
  `inStockTint`, `lowStockTint`, `outOfStockTint`, plus two pressed variants).
  They were seven literals across four files, two of them ambers one shade apart
  — `#FFF6E5` on the Dashboard's low-stock banner and `#FFF4E5` on the product
  form's warning. A tint is a colour decision like any other.
- **T7.4 was a light tidy, not a full pass against the Frontend Spec, and that
  was the owner's call.** What was fixed was drift and breakage: the error
  banner, the tints, the missing route titles, two full-screen spinners left at
  the default small size, and the six lint errors. What is still open, so it is
  not rediscovered as news:

    - There is no radius scale. `8` is used 45 times, `12` twelve times and `10`
      ten times, and the three are not telling anything apart.
    - There is no weight scale either; `'700'` and `'600'` are picked per style.
    - No screen has been read line by line against `docs/04_Frontend_Spec_Document.md`.
    - Nothing has been checked at a large system font size or in dark mode.

  None of that is broken today. It is the work a real visual pass would be, and
  it should be scoped deliberately rather than folded into another ticket.
- **A pushed route needs an entry in the root `Stack` even when the screen sets
  its own title.** `quotation/new` and `quotation/[id]` had none, and a dynamic
  route with no entry falls back to the route name — so the header read "[id]"
  while a quotation loaded, and stayed that way if it had been deleted. The
  screen's own `Stack.Screen` only lands once it knows what it is showing.
- **On Billing, a category chip and a typed search both mean "browsing".** They
  combine in the query, and one control (`backToBill`) clears both. Leaving the
  user to work out that two separate things need clearing to see the bill again
  would be needless.
- **Editing a bill keeps its invoice number and its date** (migration 008).
  The number is the customer's reference and may already be on a printed copy;
  the date decides which GST return period the sale falls in, so moving it would
  refile the sale in a different month. Only the contents change.
- **Stock is adjusted by the DIFFERENCE, one statement per product.** Not "add
  the old quantities back, then take the new ones off": that passes through a
  value which is briefly wrong, and a failure between the two halves would leave
  stock inflated by a whole bill. Billing one more unit takes one more off the
  shelf, one fewer puts one back, a removed line returns all of it, an added
  line takes all of it, and a line whose product was deleted moves nothing. A
  negative control replaces the delta with the new quantity and the suite fails
  on four separate figures.
- **An edit clears `pdf_path`, and the caller deletes the file.** The stored PDF
  is named by invoice number and still holds the PRE-EDIT figures, so
  `existingBillPdf` would find it and reshare it — handing the customer a
  document that disagrees with the shop's record under the same number, which is
  the single thing `lib/pdf.ts` exists to prevent.
- **The version being replaced is written to `bill_edits` first**, as a JSON
  snapshot rather than normalised rows. It is never queried, only read back
  whole if a dispute arises, and a second copy of `bill_items` would have to be
  migrated forward forever alongside the real one.
- **Deletion is soft: `bills.deleted_at`.** The invoice number stays consumed,
  because reissuing it would hand two customers the same reference — worse than
  the gap a deletion leaves in the sequence — and the customer may still hold
  the printed copy. Every read meaning "the shop's sales" excludes deleted rows
  through `buildBillFilter`, which is what keeps a History page and its own
  summary describing the same set. `getSalesSummary`, `countBills` and
  `listFrequentlySold` exclude them separately. **`invoiceNumberExists` must NOT**
  — it exists to stop reuse, and a deleted bill's number is still issued.
- **Whether stock returns on delete is asked every time, with no default.** Both
  answers are ordinary: a bill entered by mistake never left the shelf, so its
  stock should come back; a bill deleted because the goods went out unbilled
  should put nothing back. A default would be wrong about half the time,
  silently. Deleting twice is a no-op, so stock cannot be restored twice.
- **A soft-deleted bill keeps a converted quotation's link intact.** Under a
  hard delete, `converted_bill_id`'s `ON DELETE SET NULL` would quietly make the
  quotation convertible again — a second bill from a quotation already billed.
- **`idx_bills_live_date` is `(deleted_at, date DESC)`, and the order matters.**
  Migration 008 first added an index on `deleted_at` alone, which undid T7.5:
  `deleted_at` is NULL for almost every row, so the index is nearly useless, but
  SQLite still chose it for the equality test and then walked every live bill —
  "frequently sold" went straight back to costing the shop's entire history.
  With `date` as the second column the same index satisfies `deleted_at = NULL`
  AND the date range, and the cost stays tied to the window. Measured flat at
  ~2 ms from 2,300 to 689,000 rows. The T7.5 guard now asserts the **date bound
  drives**, not an index name — a name check would have passed on the bad index.
- **A converted quotation is still editable, and editing it never touches the
  bill** (migration 009). From the moment a bill exists the two are separate
  documents: the bill records a sale that happened, the quotation is the offer
  that led to it. Correcting a typo on the offer must not reach into a tax
  record, and refusing to correct it would leave the offer permanently wrong.
  The quotation screen names the bill it became and says the change will not
  follow, so the split is visible rather than surprising. The UPDATE
  deliberately omits `converted_bill_id` — a negative control clears it and the
  suite catches that the quotation would become convertible a second time.
- **Deleting a quotation is a REAL delete, the opposite of a bill's.** An
  invoice number must stay consumed forever, so a bill's row survives; a
  quotation reference is meant to be reusable and `reference_number` is UNIQUE,
  so the row has to go for the number to come back. That is not an
  inconsistency between the two — it is the same principle (the number decides)
  reaching opposite conclusions, because a quotation is an offer and not a tax
  record.
- **Only a TRAILING quotation reference is reclaimed.** After a delete the
  counter is set to the highest reference still in use, so deleting the newest
  frees its number while deleting an older one leaves that gap. Deleting a run
  out of order still reclaims the whole run, because the counter is recomputed
  rather than decremented. Reusing an arbitrary gap was rejected: numbers would
  be issued out of order so a reference would stop implying age, and a reissued
  Q-0003 could collide with a Q-0003 PDF a different customer is still holding.
  The just-issued number is the one least likely to have been sent anywhere.
  With nothing left at all the counter row is deleted, so the series restarts
  at Q-0001.
- **`substr(reference_number, 3)` is safe to parse because
  `renderQuotationNumber` is the only thing that ever writes a reference.**
  `Q-` is two characters, so the rest is exactly the digits it wrote.
- **Deleting a quotation asks only for confirmation, never about stock.** A
  quotation never moved any — that is the whole point of it. Where a bill's
  delete has a real question to put, this one has nothing to ask, so it is two
  buttons rather than three.
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
- **Settlement is a LEDGER, not a flag** (`bill_payments`, migration 010).
  One row per payment received, and the status is COMPUTED from those rows —
  `unknown` / `unpaid` / `partial` / `paid`. A customer paying half now and half
  next week is ordinary, and `bills.paid` had two states for a situation with
  three. Nothing stores the status: a stored copy would be free to disagree with
  the rows the moment an entry is edited or deleted, the same reason
  `converted_bill_id` is the only record of a conversion.
- **`bills.paid` is left in place and no longer read.** Not a second source of
  truth once nothing consults it, and keeping the column means an older backup
  restores into this schema unchanged and is then migrated forward by exactly
  migration 010.
- **`bill_payments.paid_on` is NULLABLE, and that nullability is the whole of
  what the migration knows.** A bill already marked paid recorded a real fact:
  settled, in full. The AMOUNT is therefore knowable — the grand total — but the
  DATE was never recorded anywhere, and inventing one would print a date on a
  customer's reprinted invoice that nobody ever entered. NULL means "recorded
  before the ledger existed"; the ledger shows "Date not recorded" and the PDF
  leaves that column empty. Nothing is backfilled for `paid = 0` or NULL — NULL
  has always meant "never recorded" here, and a zero-payment ledger would be the
  same invention in the other direction. Two negative controls cover both.
- **Every comparison is in whole paise, as integers** (`toPaise`, `sumPaise`).
  Money is REAL, and summing REALs does not land where arithmetic says: a ₹648
  bill settled with ₹512.17 + ₹135.83 comes out strictly BELOW ₹648 and reads
  "Part paid" for ever, a ten-thousandth of a paisa short, with nothing on
  screen to explain it and no way for the owner to clear it.

  Worth knowing how that test nearly shipped vacuous: the first version used
  `0.1 + 0.2` and thirds of 1000, and a negative control removing the rounding
  still passed — those cases happen to err UPWARD. A float example is not
  automatically a float test; the case has to be one that actually lands short.
- **Every write to the ledger clears `bills.pdf_path`, inside the repository.**
  From T9.3 the stored file prints the payments, so one left on disk would be
  found by `existingBillPdf` and reshared — a document disagreeing with the
  shop's record under the same invoice number, which is the one thing
  `lib/pdf.ts` exists to prevent. It is in `db/payments.ts` rather than at the
  call sites because there are four ways to change a ledger (record, edit,
  delete, the one-tap shortcut) and a rule remembered at four call sites is one
  that will be missed at one. The repository returns the invoice number; the
  CALLER deletes the file, because the repository has no business touching the
  filesystem.
- **The one-tap tag only ever moves a bill TOWARDS settled.** It records one
  entry for whatever is still owed. There is no un-pay: that would mean deleting
  payment rows, and there is no honest answer to which of several instalments a
  stray tap should remove. On a settled bill the tap opens the ledger instead,
  which is what someone tapping a Paid tag actually wants. `tagTapAction` is a
  function rather than a branch in a handler so it is reachable from a test.
- **Cash opens its ledger with one full-amount entry; credit opens empty.** That
  is the old convenience preserved — a cash sale is money in hand and needs no
  second action — and it is only a starting point, fully editable. Driven by
  `input.paid`, NOT by the payment type, because the type merely supplies that
  flag's default and the owner can override it before saving. A NULL `paid`
  writes nothing: an empty ledger is exactly "nothing recorded". Written inside
  `createBill`'s own transaction, like the invoice number.
- **"Part paid" is amber like "Not Paid", but tinted and outlined rather than
  filled.** Some money is still owed, so it belongs to the same family — red
  stays for things that are wrong. Two SOLID ambers side by side in a list are
  not tellable apart, which is why the fill differs. Grey outline remains "Not
  recorded".
- **A new table has to be added to the backup manifest counts**
  (`BackupCounts.billPayments`), OPTIONAL and guarded with `!== undefined` in
  the verification, exactly as `quotations` is. Miss the count and the restore
  silently stops verifying that table; make it required and every older backup
  fails the verify step, because "absent" is not "none".
- **The ledger is per bill and survives a soft delete.** Anything that ever sums
  what the shop has COLLECTED must exclude deleted bills the way
  `getSalesSummary` already does — the ledger rows themselves carry no such
  filter.
- **Editing a bill can move `grand_total` under a fixed ledger** and flip its
  status without anyone touching a payment. That is correct: the status is a
  fact about the two figures. `bill_edits` snapshots deliberately do NOT include
  payments — what was received is not part of what was billed.
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
- **The paid tag is tappable on History and the Dashboard, read-only on the
  bill screen** (T5.10). Both lists are where the owner works through bills with
  payments in hand; a bill opened on its own is being read rather than
  processed. It is shown on all three, so no screen displays a bill without
  saying whether it was paid. An earlier version of this note argued the
  Dashboard's copy should stay read-only to avoid mis-taps while scrolling —
  that was wrong about how the screen is used, and the tag is a small target
  with its own press state rather than a row-wide one.
- **A tappable tag has to look tappable, and an icon is what does that.** Beside
  a genuinely read-only Cash/Credit pill, an identical-looking status pill reads
  as decoration. The interactive one carries a small arrows icon and a press
  state; the icon is the half that works before anyone touches it, since a press
  state is only discoverable by pressing. A negative control removed the icon
  from the filled pill and initially PASSED, because the assertion was an OR
  across both pill variants and the rare outlined one still had its own — the
  check is now per variant.
- **No confirmation on the toggle.** One tap is undone by another, and a dialog
  on a reversible one-tap change is exactly what teaches someone to dismiss
  dialogs unread — which then costs on the confirmations that matter, like
  deleting a bill or restoring a backup.
- **The tag is a nested Pressable inside a row that navigates.** The inner one
  takes the touch, so tapping the tag does not also open the bill. History's
  overflow button already relies on the same nesting, so the two stand or fall
  together — worth confirming on a real build rather than assuming, since the
  harness has no renderer to exercise it.
- **The Dashboard's month total is NOT adjusted when a bill is marked paid.** It
  counts what was billed, not what has been collected, so a bill changing hands
  does not change what was sold that month.
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
- **No PIN lock and no encryption at rest in v1 — descoped, not deferred**
  (T7.6, T7.7). The Security & Access Document offers both as recommendations
  rather than requirements, and its decision table now records the answer. The
  phone's own lock screen is the access boundary; a second lock on a till app
  opened dozens of times a day buys little and costs friction every time.

  One caveat, recorded so it is not a surprise later: retrofitting encryption
  onto a database that already holds the shop's data is more work than starting
  with it, so reversing this after launch costs more than it would have today.
  That is a known, accepted trade rather than an oversight. Do not re-raise
  either as outstanding work.
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
- **"New Quotation" abandons an edit but keeps a draft** (`beginNew`). The
  quotation store outlives the editor screen, exactly as the billing cart does,
  so backing out of an edit left `editingQuotationId` set — and the button then
  reopened that edit, with the title still reading "Edit Quotation", so saving
  overwrote the quotation the owner thought they had walked away from. The lines
  of an abandoned edit belong to that quotation, not to a new one, so they go
  with it; a draft with no quotation behind it is kept, and the button says
  "Continue quotation" rather than lying about what it will do. The Dashboard
  already did this for bills with "New Bill" / "Continue bill".
- **That decision lives in the store, not in the screen.** It was first written
  inline in the button's handler, where the harness cannot reach it — a negative
  control removed the guard and every check still passed, because the test had
  re-implemented the logic rather than calling it. Logic worth testing goes
  somewhere testable.
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
- **Confirmations are a banner, and the banner replaced dialogs rather than
  adding to them** (T7.3). A message saying something SUCCEEDED carries no
  decision, so it is the least deserving of a modal — dismissing it is pure
  friction. The restore success `Alert` and the reset's "Done" modal step are
  both gone; their wording moved into the banner, counts included.
- **The banner lives in a store, not in screen state, because several actions
  report on a DIFFERENT screen from the one that started them.** Adding a
  product navigates back to Inventory, generating a bill goes to the bill,
  saving a quotation goes to the quotation — local state would be unmounted
  before it could say anything. It is mounted once in `app/_layout.tsx`.
- **It never takes a touch** (`pointerEvents: 'none'`) and sits above the tab
  bar, so it can appear over the Billing summary bar or the Inventory "+" button
  without swallowing a tap meant for them. Nothing to dismiss, which is what
  makes it not a dialog.
- **The dismiss timer is keyed to the toast's id.** Two saves in quick
  succession replace one another, and the first one's timer must not clear the
  second off the screen a moment after it appeared — a negative control removes
  the id check and catches exactly that.
- **"Saved — Hikvision Dome" names the product on purpose.** The Inventory list
  is alphabetical, so a new product lands mid-list rather than at the top and is
  genuinely hard to find among thirty others. The name is what confirms the save
  actually happened; a bare "Saved" would leave the owner hunting.
- **The backup banner says the file was made and stops there.** The share sheet
  never reports whether the transfer succeeded, so anything warmer would claim
  more than the app can know — the same reason the status line reads "Last
  backup" and never "your data is safe".
- **Nothing that needs acting on goes in the banner.** It disappears on its own,
  so anything important enough to miss does not belong there. Errors that need a
  decision stay inline on the screen that owns them.
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

If something in the documents is ambiguous, ask the owner rather than guessing.
