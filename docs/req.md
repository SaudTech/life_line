# Hospital Billing System - Request for Quote


## 1. The Problem

Billing currently runs on an old desktop database file with only a handful of tables (billing, doctors, departments). It is a **flat receipt log**, not a real patient system:

- The patient's name is retyped as free text on every receipt - there is no patient history, and no link between a person's different visits.
- **Data is messy:** the same thing typed many ways (`Inj` / `inj` / `INJ`), duplicated doctors (the same doctor entered more than once), and junk values in fields.
- The file has grown large over several years of daily use, with no reliable search, no clean reports, a real risk of corruption at that size, no proper multi-user support, and no safe backups.

**Goal:** replace this with a fast, reliable, multi-user billing system that runs on the hospital's own machine, keeps clean structured data, and prints proper A4 receipts and invoices in seconds.

---

## 2. What We're Building

A billing and patient-visit system, **used at a busy billing counter many times a day**, that:

- registers patients and remembers them (each patient has a unique auto-generated Patient ID; phone is a shared lookup field, not a unique key),
- handles outpatient (OP) visits, procedures, and in-patient (IP) admission→discharge,
- prints clean, customisable **A4** receipts and invoices,
- enforces roles and a discount-approval process,
- runs **locally on-site** (no dependency on internet or a monthly cloud fee to operate day-to-day), and
- is built **multi-branch-ready** while starting with a single location.

This is a **counter tool used with real money on every screen, dozens of times an hour at peak.** Speed and correctness matter far more than visual polish or extra features. Please weigh your proposed approach accordingly.

---

## 3. Core Concepts (glossary)

- **OP (Out-Patient):** a patient who visits, sees a doctor, and leaves the same day. No bed. The most common case (~two-thirds of activity).
- **IN (Admission):** admitting a patient who needs to stay (a bed). An advance is taken at admission.
- **OUT (Discharge):** sending an admitted patient home, with a final itemised bill.
- **Consultation:** a paid doctor visit that stays valid for a set number of days. Return visits to the *same doctor* within that window are free and recorded under the same consultation.
- **OP Procedure:** a service/item (IV, injection, etc.) billed to a patient who already has an active consultation.
- **Discount:** a reduction on a bill that requires Supervisor approval.
- **Patient / Patient ID:** every patient is a distinct person with a **unique, auto-generated Patient ID** (MRN-style). This ID - not the phone - identifies the patient.
- **Phone (shared):** a contact number used to find patients. **One phone can belong to several patients** (e.g. a mother and her child), so a phone search can return more than one person.

---

## 4. User Roles

Four roles, from most limited to full control. Each higher role can do everything below it. Roles must be **enforced on the server**, not just hidden in the UI.

| Role | Can do |
|---|---|
| **OP Desk** | Outpatient billing only: register patients, consultations, procedures, payment, print, and reprint their *own* receipts. **Cannot admit (IN) or discharge (OUT).** |
| **OP + IP Desk** | Everything OP Desk does, plus admit (IN) and discharge (OUT) in-patients. |
| **Supervisor** | Everything the desks do, plus approve discounts (PIN or on-screen), view any discounted bill's details, and change their own PIN. |
| **Admin** | Full control: manage doctors, services/items, users, the invoice layout, and see all reports. |

---

## 5. Required Features

- **Patient registration** - name, age, phone, area. Each patient gets a **unique auto-generated Patient ID** that identifies them permanently. Phone is required as a contact/lookup field but is **not unique** - several patients (e.g. a mother and child) can share one phone, and a phone search lists all of them to pick from or add a new one.
- **Consultations** - a paid visit valid for the doctor's set number of days; free same-doctor revisits within that window (see Billing Rules).
- **OP procedures & items** - bill IVs, injections, and other items against an existing consultation.
- **In-patient billing** - admission with advance payment; itemised discharge bill; automatic payable balance.
- **Discount control** - Supervisor PIN for instant approval, or a "Pending Approval" queue the Supervisor approves/declines.
- **A4 receipts & invoices** - clean printing, with a layout an Admin can design and edit (logo, header, fields, wording) without a developer.
- **Reprint & search** - find and reprint past receipts. OP Desk users see only their own; Supervisor/Admin see all.
- **Daily dashboard** - each user's own activity for today / last 7 days, printable (useful for end-of-day cash handover).
- **Role-based access** - Admin, Supervisor, OP Desk, OP + IP Desk.
- **Multiple counters** - several billing desks work at once over the local network.
- **Runs locally** - on the hospital's own machine; automatic daily backups.

---

## 6. Billing Rules (must be exact)

These are the rules the system's money logic must implement precisely and cover with automated tests - this is the part most likely to cause disputes or errors if approximated.

### Consultation
- Each **doctor** has a **fee** and a **validity period (in days)** - both are per-doctor.
- Creating a consultation charges that doctor's fee and sets `valid_until = today + doctor.validity_days`.
- If the patient returns to the **same doctor** on or before `valid_until`: **no new fee**; the visit is recorded under the same consultation.
- A visit to a **different doctor** is always a **new consultation and fee**.

### OP Procedure
- Requires an **active consultation** for the patient.
- Adds one or more billed lines (service/item, quantity, price) and prints. No new consultation fee.

### In-Patient (Admission → Discharge)
- On admission: record an **advance payment**.
- On discharge: bill lists the **room charge** and **other expenses as itemised lines** (item, quantity, total).
- **Payable balance = (room + itemised expenses) − advance.**
- If the advance exceeds the total, the result is a **refund** (must be handled explicitly, not ignored).

### Discount
- A discount on any bill requires Supervisor approval.
- **Instant path:** operator enters the Supervisor's **PIN** → bill finalises immediately.
- **Queue path:** no PIN → bill is saved as **"Pending Approval"** (cannot finalise/settle) → appears on the Supervisor's screen → Supervisor reviews full details and **Approves or Declines**.

Money must never be handled as floating point in the implementation - flag in your proposal how you'd handle this (integer minor units, decimal type, etc.).

---

## 7. How It's Used (daily flows)

### One-time setup (Admin)
Add doctors (with fees + validity days) → add the services/items list → design the receipt layout → create staff accounts and assign roles. System is ready.

### Daily use
- **New OP visit:** search by phone → **pick the right patient if the phone has several**, or register a new one (gets a new Patient ID) → pick doctor (consultation created) → add any items → take payment → print A4 receipt.
- **Revisit (same doctor, within validity):** find patient → visit recorded under the same consultation, no new fee → print.
- **OP procedure:** find patient with an active consultation → add items/procedures → take payment → print.
- **Admit (IN):** find or register patient → admit and record advance → print advance receipt.
- **Discharge (OUT):** open the admitted patient → add room charge and itemised expenses → system subtracts advance → collect balance → print A4 discharge invoice.
- **Discount (any bill):** enter Supervisor PIN for instant approval, or send for on-screen Approve/Decline.

---

## 8. Deployment Constraints

- Must run **on the hospital's own server PC**, reachable by billing counters over the **local network (LAN)** - not dependent on internet access for day-to-day operation.
- Data must survive crashes/reboots and support **multiple concurrent counters** writing at once without corruption or lost bills.
- **Optional remote access** for off-site staff may be added later - not required for v1, but the architecture shouldn't rule it out.
- **Daily automated backups**, plus a documented restore process.
- We are open to your recommendation on stack/hosting for the local deployment - if you have a strong opinion on a different approach than a locally-run web app, tell us the tradeoffs.

---

## 9. Data We'd Provide

- The full **doctor list** with fees and revisit-validity days.
- The existing **services/items list** and pricing.

---

## 10. Scope

### Must have (v1)
Single-location setup, patient registration, OP consultations + procedures, IN/OUT admission with itemised discharge, discount approval workflow, A4 receipts & invoices with an editable layout, per-user daily dashboards, role-based access (4 roles above), doctors/services/users management, basic daily reports.

### Nice to have / phase 2 (quote separately if possible) NOT LOOKING FOR THIS NOW 
Patient history lookup by phone (a phone lists all patients on it; pick the person to see their past visits & invoices), a second branch/location with cross-branch reports, migration of the historical records from the old system.

### Out of scope (do not quote unless asked)
Thermal printing, room/bed availability tracking, pharmacy/medicine stock, laboratory/tests, appointment booking, insurance/TPA claims, accounting integration, emailing receipts.

---

## 11. What We'd Like in Your Quote

- Your proposed **tech stack** and why, given the local-deployment/no-internet-dependency constraint.
- A **breakdown of cost and timeline** by the phases above (v1 must-haves vs. phase 2 items)
