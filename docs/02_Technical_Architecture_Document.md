# Technical Architecture Document
## Mahale Phones and Electronics — Inventory & Billing App

**Version:** 1.0
**Companion to:** PRD_Mahale_Phones_Electronics_App.md

---

## 1. High-Level Architecture

A single offline-first React Native (Expo) app. No backend server in v1 — all data lives locally on the phone in SQLite. No network calls required for core functionality.

```
┌─────────────────────────────────────────┐
│              React Native App             │
│  ┌───────────────────────────────────┐   │
│  │         UI Screens (React)         │   │
│  │  Dashboard / Inventory / Billing /  │   │
│  │  Bill History / Settings            │   │
│  └───────────────┬─────────────────────┘   │
│                  │                          │
│  ┌───────────────▼─────────────────────┐   │
│  │      App State (React Context /     │   │
│  │      Zustand — see Section 4)        │   │
│  └───────────────┬─────────────────────┘   │
│                  │                          │
│  ┌───────────────▼─────────────────────┐   │
│  │   Data Access Layer (repository      │   │
│  │   functions: products.js, bills.js)  │   │
│  └───────────────┬─────────────────────┘   │
│                  │                          │
│  ┌───────────────▼─────────────────────┐   │
│  │       SQLite (expo-sqlite)           │   │
│  └───────────────────────────────────────┘   │
│                                              │
│  ┌───────────────────────────────────┐   │
│  │  PDF Generator (expo-print)         │   │
│  │  Share Sheet (expo-sharing)         │   │
│  │  Bluetooth Printer (ESC/POS lib)    │   │
│  │  File Backup/Restore (expo-file-    │   │
│  │  system + Google Drive share)       │   │
│  └───────────────────────────────────┘   │
└─────────────────────────────────────────┘
```

## 2. Folder Structure (proposed)

```
mahale-app/
├── app/                      # Expo Router screens
│   ├── (tabs)/
│   │   ├── dashboard.tsx
│   │   ├── inventory.tsx
│   │   ├── billing.tsx
│   │   └── history.tsx
│   ├── inventory/
│   │   ├── add.tsx
│   │   └── [id].tsx          # edit product
│   ├── bill/
│   │   ├── new.tsx
│   │   └── [id].tsx          # view/reprint a past bill
│   └── settings.tsx
├── db/
│   ├── schema.ts              # table definitions + migrations
│   ├── init.ts                 # DB setup on app start
│   ├── products.ts             # product CRUD functions
│   ├── bills.ts                 # bill CRUD functions
│   └── backup.ts                # export/import DB
├── components/
│   ├── ProductCard.tsx
│   ├── BillItemRow.tsx
│   ├── GstSummary.tsx
│   └── LowStockBadge.tsx
├── lib/
│   ├── gst.ts                   # GST calculation logic
│   ├── pdf.ts                   # bill → PDF generation
│   ├── printer.ts                # Bluetooth ESC/POS logic
│   └── invoiceNumber.ts          # invoice numbering logic
├── constants/
│   └── business.ts               # business details (GSTIN, address, etc.)
├── assets/
│   └── logo.png
└── app.json                       # Expo config
```

## 3. Database Schema & Migrations

- Managed through `expo-sqlite`, with a lightweight versioned migration system (a `schema_version` table + numbered migration scripts) so future schema changes (e.g., adding multi-user support) don't require reinstalling the app.
- Tables: `products`, `bills`, `bill_items` (see PRD Section 7 for fields).
- Indexes: on `products.name` and `products.category` (for search/filter), on `bills.date` and `bills.invoice_number` (for history search).

## 4. State Management

- **Local component state** for form inputs (add/edit product, new bill).
- **Zustand** (lightweight, simpler than Redux) for shared app state that multiple screens need: current cart/bill-in-progress, low-stock count for dashboard badge, business settings.
- No need for server state libraries (React Query etc.) since there's no network layer in v1 — data reads/writes go straight to SQLite through the repository functions in `db/`.

## 5. Key Technical Flows

### 5.1 Creating a Bill
1. User selects products + quantities on the Billing screen (state held in Zustand cart).
2. `lib/gst.ts` calculates CGST/SGST or IGST per line item and totals, based on business state vs. customer state.
3. On "Generate Bill": write to `bills` + `bill_items` tables, decrement `products.stock_qty`, generate invoice number via `lib/invoiceNumber.ts`.
4. `lib/pdf.ts` renders an HTML template (business header, item table, GST breakdown) via `expo-print`, saving the PDF to local file storage; the file path is saved on the bill record.
5. User is offered Share (WhatsApp/any app via `expo-sharing`) or Print (via `lib/printer.ts`).

### 5.2 Bluetooth Printing
- Uses an ESC/POS-compatible library to pair with and send raw print commands to a Bluetooth thermal printer.
- Printer pairing/selection happens once in Settings; the chosen printer is remembered for future bills.
- **Note:** exact library choice should be finalized once you have the actual printer model, since ESC/POS command support varies slightly by manufacturer.

### 5.3 Backup / Restore
- Backup: copies the SQLite database file (plus a manifest) into a single exportable file, which the user shares via the Android share sheet (e.g., to Google Drive, email, or a USB-connected file manager).
- Restore: user selects a previously exported backup file; app validates it, then replaces the local database.

## 6. Offline Guarantee

- Zero network calls in any core flow (inventory, billing, PDF, print, backup-to-file).
- The only optional network usage is if the user chooses to back up to Google Drive (their choice, their account) — this is not required for the app to function.

## 7. Build & Distribution

### 7.1 Local Development
- `npx expo start`, tested live via Expo Go on the developer's own phone (same WiFi as the dev machine).
- An Android emulator (via Android Studio) can substitute if no spare Android phone is available.

### 7.2 Remote Review Workflow (Owner is in a different city)

Since the business owner (app's end user) is not physically near the developer, testing/review happens in two stages before any "final" handoff:

**Stage A — Fast iterative review via EAS Update + Expo Go:**
- Run `eas update` to publish the current app to Expo's cloud servers.
- Share the generated link/QR code with the owner (over the internet — no shared WiFi required).
- Owner opens it in Expo Go on their own phone to review UI, screens, navigation, and flow.
- **Limitation:** Bluetooth thermal printing likely won't work in this mode, since Expo Go's sandbox doesn't include custom native printer modules. Fine for reviewing everything else.
- Use this for quick, frequent feedback rounds early in development.

**Stage B — Preview APK builds (real native build, no Expo Go needed):**
- Use a `preview` build profile in `eas.json` (separate from `production`) to generate a real installable APK via EAS Build.
- Share the APK file directly (WhatsApp/Drive/email); owner installs it like a normal app.
- This build supports all native features properly, including Bluetooth printing — use this once core features are stable and the owner needs to test the *real* experience (especially billing + printing).
- Multiple preview builds can be sent over time; none of these are the "final" release.

**Stage C — Production build:**
- Once the owner has reviewed and approved via Stages A/B, run the `production` build profile to generate the official release APK.
- This is the version handed over for actual daily business use.

### 7.3 `eas.json` should define at least these profiles:
```json
{
  "build": {
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" }
    },
    "production": {
      "android": { "buildType": "apk" }
    }
  }
}
```

### 7.4 Updating After Handoff
- For future change requests after the app is in daily use: make the change, test locally, produce a new APK (bump the version number in `app.json` each time), and send the new APK the same way.
- Android installs the new APK as an update over the old one; local SQLite data is preserved as long as the package name (`android.package` in `app.json`) doesn't change.
- If change requests become frequent, `eas update` can push many code changes to the owner's existing installed app without a full new APK each time (an "over-the-air" update) — worth adopting once the app is past initial build and into a maintenance/iteration phase.

## 8. Git Workflow

- Repository name: **`mahale-electronics-app`**
- **Every commit and push requires explicit approval from the developer before execution.** This is enforced two ways:
  1. A rule in `CLAUDE.md`: *"NEVER run `git commit` or `git push` without asking first. Stage changes, summarize what will be committed, and ask before proceeding."*
  2. Enforced via `.claude/settings.json`:
     ```json
     {
       "permissions": {
         "allow": [
           "Edit", "Write", "Read", "Glob", "Grep",
           "Bash(git status*)", "Bash(git diff*)", "Bash(git log*)"
         ],
         "ask": [
           "Bash(git commit*)",
           "Bash(git push*)"
         ],
         "deny": [
           "Bash(git push --force*)",
           "Bash(git reset --hard*)"
         ]
       }
     }
     ```
- Destructive git operations (force-push, hard reset) are explicitly denied outright, not just gated behind approval.
- Commit granularity: one commit per completed ticket/feature (see Feature Ticket List) rather than large multi-feature commits, to keep history readable and reviewable.

## 9. Future Extension Path (Not Built Now)

If multi-user/cloud sync is added later:
- The repository layer (`db/products.ts`, `db/bills.ts`) is designed so its functions could be swapped or extended to sync with a remote API without rewriting UI screens.
- Local SQLite would become a local cache/offline queue rather than the sole source of truth.
- This is why the data access layer is kept separate from UI components now — it's the seam where sync logic would plug in later.
