# Product Requirements Document
## Mahale Phones and Electronics — Inventory & Billing App

**Version:** 1.0
**Status:** Draft — ready for development
**Owner:** [Your name]
**Primary User:** Shop owner (father)

---

## 1. Overview

A mobile app for Mahale Phones and Electronics — an electronics retail shop selling CCTV cameras, RO water purifiers, tube lights, bulbs, and related items. The app lets the owner manage inventory and generate GST-compliant bills, fully offline, on an Android phone.

## 2. Goals

- Replace manual/paper billing with a fast, digital, GST-compliant bill generator.
- Give the owner a real-time view of stock levels across all product categories.
- Work fully offline — no internet dependency for daily operation.
- Be simple enough for a non-technical, first-time app user to operate confidently.
- Be architected so it *can* later support multiple users/devices with cloud sync, without a full rewrite.

## 3. Non-Goals (Out of Scope for v1)

- Multi-user login / cloud sync (planned for a future version, not v1).
- Online hosting or web access.
- Play Store publishing (APK will be installed directly).
- Supplier/purchase-order management.
- Accounting/ledger features beyond bill generation.

## 4. Target Platform

- **Android only** (phone).
- Installed via a directly-shared APK file (no Play Store required for v1).
- Built with **React Native + Expo**, local **SQLite** database.

## 5. Users

- **Primary user:** Shop owner — adds inventory, creates bills, checks stock.
- No other user roles in v1 (single device, single login-less user).

## 6. Core Features (MVP Scope)

### 6.1 Inventory Management
- Add / edit / delete products.
- Fields per product:
  - Product name
  - Category (CCTV, RO, Tube Light, Bulb, Other — extensible list)
  - Stock quantity
  - Unit price
  - GST rate (%)
  - HSN code
  - Optional: brand, model number, low-stock threshold
- Stock automatically decreases when a bill is generated.
- Low-stock indicator/alert on dashboard.
- Search/filter inventory by name or category.

### 6.2 Billing
- Create a new bill by selecting items from inventory and quantities.
- Auto-calculate:
  - CGST + SGST (intra-state) or IGST (inter-state), based on business state vs customer state
  - Item-wise and total GST breakdown
  - Grand total
- Capture customer details: name, phone number, optional address, optional GSTIN (for B2B bills).
- Auto-generated invoice number (configurable prefix/starting number).
- Save every bill to a local bill history.

### 6.3 Bill Output
- Generate bill as **PDF**.
- Share via **WhatsApp** (or any app, using Android's native share sheet).
- Print via **Bluetooth thermal printer** (ESC/POS protocol).
- Bill includes: business header (name, GSTIN, address, phone), invoice number, date, customer details, itemized list with HSN codes and GST breakdown, grand total.

### 6.4 Dashboard
- Quick stock overview (total items, low-stock items).
- Recent bills list.
- Today's / this month's sales summary (total billed amount).

### 6.5 Bill History
- View all past bills.
- Search/filter by date, customer, or invoice number.
- Re-open, re-share, or re-print any past bill.

### 6.6 Data Backup
- Manual "Backup Data" option — exports inventory + bill history to a file (e.g., saved to Google Drive or shareable file).
- Manual "Restore Data" option, for switching phones or recovering data.

## 7. Data Model (Draft)

**Products**
| Field | Type |
|---|---|
| id | integer, primary key |
| name | text |
| category | text |
| stock_qty | integer |
| unit_price | decimal |
| gst_rate | decimal |
| hsn_code | text |
| brand (optional) | text |
| low_stock_threshold | integer |

**Bills**
| Field | Type |
|---|---|
| id | integer, primary key |
| invoice_number | text |
| date | datetime |
| customer_name | text |
| customer_phone | text |
| customer_gstin (optional) | text |
| customer_state | text |
| subtotal | decimal |
| cgst_total | decimal |
| sgst_total | decimal |
| igst_total | decimal |
| grand_total | decimal |
| pdf_path | text |

**Bill_Items**
| Field | Type |
|---|---|
| id | integer, primary key |
| bill_id | foreign key → Bills |
| product_id | foreign key → Products |
| product_name_snapshot | text |
| qty | integer |
| unit_price_snapshot | decimal |
| gst_rate_snapshot | decimal |
| line_total | decimal |

*(Snapshots are stored on the bill so historical bills stay accurate even if a product's price changes later.)*

## 8. Business Details Needed (Placeholders for now)

- Business name: Mahale Phones and Electronics *(confirm exact registered name)*
- GSTIN: `[PLACEHOLDER]`
- Business address: `[PLACEHOLDER]`
- Business state: `[PLACEHOLDER]`
- Phone / email: `[PLACEHOLDER]`
- Bank details (optional, for bill footer): `[PLACEHOLDER]`
- Logo: `[PLACEHOLDER — optional]`
- Invoice numbering format: `[PLACEHOLDER, e.g. MPE/2026/0001]`

## 9. Non-Functional Requirements

- **Offline-first:** app must be fully usable with zero internet connectivity.
- **Performance:** bill generation should feel instant (< 1 second) even with thousands of inventory items and bills.
- **Storage:** local SQLite; expected data footprint stays under ~2 GB even after years of heavy use (see storage estimate notes).
- **Reliability:** no data loss on app crash or phone restart.
- **Usability:** simple enough for a first-time smartphone-app user to operate without training.

## 10. Future Considerations (Post-v1, not built now)

- Cloud sync + multi-user login (multiple shop staff, multiple devices).
- Web-based access/dashboard.
- Supplier/purchase tracking.
- Analytics (best-selling products, monthly trends).
- Play Store listing.

## 11. Tech Stack Summary

- **Framework:** React Native + Expo (managed workflow)
- **Local DB:** SQLite (via `expo-sqlite`)
- **PDF generation:** `expo-print` or equivalent
- **Sharing:** Android native share sheet (`expo-sharing`)
- **Bluetooth printing:** ESC/POS-compatible library (to be selected during build, tested against actual printer model)
- **Build/distribution:** EAS Build (Expo) → installable APK, no Play Store dependency for v1

## 11a. Project & Review Workflow

- **Repository:** `mahale-electronics-app` (Git). All commits/pushes require explicit developer approval — no auto-commit (see Technical Architecture Section 8 for enforcement).
- **Owner review process:** since the business owner is in a different city from the developer, review happens in stages rather than a single final handoff — early UI/flow feedback via `eas update` + Expo Go, followed by preview APK builds for testing real features (especially billing + Bluetooth printing), before a final production build. Full detail in Technical Architecture Section 7.2.

## 12. Open Questions

- [ ] Confirm exact registered business name, GSTIN, and address
- [ ] Confirm invoice numbering convention
- [ ] Which Bluetooth thermal printer model will be used (needed for testing printing feature)
- [ ] Should low-stock threshold be global default or per-product?
- [ ] Any existing inventory list (spreadsheet) to import at launch, or start empty?

---

*This PRD is intended as a working brief for development in Claude Code. Update the placeholder fields in Section 8 before or during development.*
