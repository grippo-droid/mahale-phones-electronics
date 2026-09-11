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

- **Storage / Media** — to save and share generated PDF bills.
- **Photos** — to choose the shop logo that prints on the bill (T4.1). Chosen from the gallery only; the app never opens the camera.
- **Contacts (read only)** — to fill in a customer's name and number while making a bill or a quotation (T9.1). See the reversal below.
- **No Bluetooth.** An earlier draft listed it for a thermal printer. Thermal printing is out of scope — bills go to the customer as a PDF over WhatsApp, and a printed copy goes through Android's own print sheet, which needs no permission from this app.
- **No camera, location or microphone.** `expo-image-picker` adds `RECORD_AUDIO` and `CAMERA` by default because it assumes video capture; both are switched off in `app.json` and blocked, so no other package can reintroduce them.

### 6.1 Contacts — a reversal of an earlier decision, made deliberately

This document previously said: *"No camera, location, contacts, or microphone access needed — the app should not request these."* Contacts is now requested. That is a change of mind by the owner, not an oversight, and it is recorded here rather than edited away.

**What changed the answer.** Typing a customer's name and ten-digit number by hand at a counter, for a customer who is already in the owner's phone, is the slowest part of raising a bill and the easiest place to get a digit wrong — and a wrong number is the one error that cannot be fixed later, because the bill has already gone to the wrong person or nowhere at all.

**What the permission actually covers.**

- **Read only.** `expo-contacts`' config plugin adds `READ_CONTACTS` **and** `WRITE_CONTACTS` unconditionally, and offers no option to disable the second. `WRITE_CONTACTS` is therefore listed in `android.blockedPermissions`, which emits `tools:node="remove"` and takes it out of the merged manifest. The app has no code path that creates, edits or deletes a contact. Verify with `npx expo config --type introspect`, never by reading `app.json`.
- **Three fields.** Only the given name, family name and phone numbers are requested. Addresses, emails, photographs, birthdays and notes are never read.
- **Nothing is stored.** No contact is written to SQLite, so no contact can reach a backup file, and the backup format is unchanged. The only thing that persists is the name and number the owner picked, on the bill they were already making — exactly what they would have typed.
- **Nothing leaves the phone.** Unchanged from Section 7: there is no server and no analytics.

**How it is asked for.** Not on first launch, and not on a screen of its own. The first time the owner types at least two characters into a customer's name, the app shows its own short explanation of why a billing app wants the address book — which Android's system dialog does not say — and only then triggers the system prompt.

**How a "no" is treated.** As final. Android stops presenting its dialog after a refusal, so the app never asks again; the type-ahead simply does not appear, and the field behaves exactly as it did before this feature existed. There is no error, no banner and no second prompt. The only way back is a row in Settings that opens Android's own permission screen, which the owner has to go looking for.

**The trade being accepted.** A billing app that can read the owner's personal address book is a larger surface than one that cannot, and anyone with access to the unlocked phone can already read those contacts through the Contacts app itself. What this adds is that the same data is reachable from inside this app's process. Given there is no network permission being used to move data anywhere, and nothing is copied into the database, the realistic exposure is unchanged. It is recorded because it is a real widening of what the app can see, and because Section 4's note about an unencrypted database is the reason to keep an eye on what else gets stored.

## 7. What This App Does NOT Do (By Design)

- Does not transmit business or customer data to any server.
- Does not use analytics or tracking SDKs.
- Does not require an account, email, or phone number from the owner to use the app itself.
- Does not share data with third parties.

## 8. Recommendations Summary (Decide Before Build)

| Item | Recommendation | Decision |
|---|---|---|
| App-level PIN/biometric lock | Optional, low effort | **No — descoped for v1** (T7.6) |
| SQLite encryption at rest | Optional, moderate effort | **No — descoped for v1** (T7.7) |
| Backup file handling guidance | Document for owner, no code needed | Owner practice |
| Contacts access for customer autocomplete | Read-only, optional, degrades to nothing | **Yes — added in T9.1**, reversing Section 6's original "no contacts" line |

These are genuinely optional for a small single-shop app — the PRD's v1 scope does not require them — but worth a deliberate decision rather than an oversight.
