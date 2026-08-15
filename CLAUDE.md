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
  bill/new.tsx            create a bill
  bill/[id].tsx           view / re-share / re-print a past bill
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

## Open decisions (from the planning docs)

- Exact registered business name, GSTIN, address, and invoice numbering convention
- Bluetooth thermal printer model (blocks T4.5 / T4.7)
- Low-stock threshold: global default or per-product
- Whether to import an existing inventory spreadsheet at launch
- English-only vs. bilingual (Hindi/Marathi) UI
- Optional app-level PIN/biometric lock (T7.6) and SQLite encryption at rest (T7.7)

If something in the documents is ambiguous, ask the owner rather than guessing.
