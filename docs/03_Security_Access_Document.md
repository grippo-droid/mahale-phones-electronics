# Security & Access Document
## Mahale Phones and Electronics — Inventory & Billing App

**Version:** 1.0
**Companion to:** PRD_Mahale_Phones_Electronics_App.md

---

## 1. Context

This app is offline, single-user, and stores data only on the owner's phone. There is no login system, no server, and no network transmission of business data in v1. Security concerns are therefore scoped narrowly to: protecting local data on the device, and safe handling of backups.

## 2. Data Stored

- **Business data:** inventory (product names, prices, stock, GST rates, HSN codes).
- **Customer data:** name, phone number, optional address, optional GSTIN — captured per bill.
- **Financial data:** bill amounts, GST breakdowns, invoice history.
- **Generated files:** PDF bills stored in local app file storage.

None of this is classified as highly sensitive (no payment card data, no passwords, no government ID numbers beyond optional business GSTIN), but customer phone numbers and names are personal data and should be handled reasonably carefully.

## 3. App Access Control

- **No login/PIN in v1** — the app opens directly, since it's assumed the phone itself is the access boundary (the phone owner is the only user).
- **Recommended optional addition:** a simple app-level PIN or biometric lock (Face/Fingerprint unlock via `expo-local-authentication`) so that if the phone is picked up unlocked by someone else, the business/customer data isn't immediately exposed. This is a small addition — flagged here as a recommendation, not a hard requirement, since it adds a small amount of friction to daily use.

## 4. Local Data Storage

- SQLite database file stored in the app's private storage sandbox (not accessible to other apps by default on Android).
- **Not encrypted by default.** If the phone itself is lost, stolen, or accessed while unlocked, the raw database file is technically readable by someone with sufficient technical access to the device.
- **Recommendation:** if this matters to you (e.g., competitor sensitivity, customer privacy expectations), we can add SQLite encryption (e.g., via `expo-sqlite` with SQLCipher) — a modest amount of extra setup, worth deciding on before launch since retrofitting encryption onto existing data later is more work.

## 5. Backup File Handling

- Backup files (exported database) are **not encrypted** by default — treat a backup file with the same care as the phone itself, since it contains the same data.
- If backups are stored in Google Drive or shared via WhatsApp, that data is now subject to those platforms' own storage/security practices — outside this app's control. Recommend the owner treats backup files like any other sensitive business document (don't share the file itself with anyone outside the family/business).

## 6. Permissions Required by the App

- **Bluetooth** — to connect to the thermal printer.
- **Storage / Media** — to save and share generated PDF bills.
- **No camera, location, contacts, or microphone access needed** — the app should not request these; keeping permissions minimal reduces both risk and the number of permission prompts your father has to approve.

## 7. What This App Does NOT Do (By Design)

- Does not transmit business or customer data to any server.
- Does not use analytics or tracking SDKs.
- Does not require an account, email, or phone number from the owner to use the app itself.
- Does not share data with third parties.

## 8. Recommendations Summary (Decide Before Build)

| Item | Recommendation | Decision Needed |
|---|---|---|
| App-level PIN/biometric lock | Optional, low effort | Yes/No |
| SQLite encryption at rest | Optional, moderate effort | Yes/No |
| Backup file handling guidance | Document for owner, no code needed | Owner practice |

These are genuinely optional for a small single-shop app — the PRD's v1 scope does not require them — but worth a deliberate decision rather than an oversight.
