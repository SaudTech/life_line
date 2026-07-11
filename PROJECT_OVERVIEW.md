# Life Line Hospital - Management System

The single reference for what this system is, why it exists, and how every part works. Read this first. For engineering conventions and coding standards, see `DEVELOPMENT_RULES.md`.

---

## 1. The Problem

Life Line Hospital currently runs its entire patient billing on a **Microsoft Access file**. Analysis of their live database showed what it really is:

- **3 tables only** - Billing, Doctors, Departments.
- **~174,000 billing rows** over 3.3 years, growing ~50,000/year.
- **~144 receipts a day** (peaks around 260), roughly ₹5 crore of billing recorded over that period.
- It is a **flat receipt log**, not a patient system: the patient's name is retyped as free text on every receipt. There is no patient history, no link between a person's visits.
- **Data is messy:** the same thing typed many ways (`Inj` / `inj` / `INJ`), duplicated doctors (one doctor entered 3 times), and junk values in fields.

**Consequences:** no reliable search, no history, no clean reports, high risk of corruption at that size, no real multi-user support, and no safe backups.

**Goal:** replace this with a fast, reliable, multi-user billing system that runs on the hospital's own machine, keeps clean structured data, and prints proper A4 receipts and invoices in seconds.

---

## 2. What We're Building

A billing and patient-visit system, **used at a counter ~144 times a day**, that:

- registers patients and remembers them (each patient has a unique auto-generated Patient ID; phone is a shared lookup field),
- handles outpatient (OP) visits, procedures, and in-patient (IP) admission→discharge,
- prints clean, customisable **A4** receipts and invoices,
- enforces roles and a discount-approval process,
- runs **locally** (no monthly cloud fees, works without internet), and
- is built **multi-branch-ready** while starting with a single location.

Because it's a counter tool, **speed and certainty are the product.** See `DEVELOPMENT_RULES.md` for how that shapes the code and UI.

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

Four roles, from most limited to full control. Each higher role can do everything below it. Roles are **enforced on the server**, not just hidden in the UI.

| Role | Can do |
|---|---|
| **OP Desk** | Outpatient billing only: register patients, consultations, procedures, payment, print, and reprint their *own* receipts. **Cannot admit (IN) or discharge (OUT).** |
| **OP + IP Desk** | Everything OP Desk does, plus admit (IN) and discharge (OUT) in-patients. |
| **Supervisor** | Everything the desks do, plus approve discounts (PIN or on-screen), view any discounted bill's details, and change their own PIN. |
| **Admin** | Full control: manage doctors, services/items, users, the invoice layout, and see all reports. |

---

## 5. Features

- **Patient registration** - name, age, phone, area. Each patient gets a **unique auto-generated Patient ID** that identifies them permanently. Phone is required as a contact/lookup field but is **not unique** - several patients (e.g. a mother and child) can share one phone, and a phone search lists all of them to pick from or add a new one.
- **Consultations** - a paid visit valid for the doctor's set number of days; free same-doctor revisits within that window (see Billing Rules).
- **OP procedures & items** - bill IVs, injections, and other items against an existing consultation.
- **In-patient billing** - admission with advance payment; itemised discharge bill; automatic payable balance.
- **Discount control** - Supervisor PIN for instant approval, or a "Pending Approval" queue the Supervisor approves/declines.
- **A4 receipts & invoices** - clean printing, with a layout the Admin can design and edit (logo, header, fields, wording).
- **Reprint & search** - find and reprint past receipts. OP Desk users see only their own; Supervisor/Admin see all.
- **Daily dashboard** - each user's own activity for today / last 7 days, printable (useful for end-of-day cash handover).
- **Role-based access** - Admin, Supervisor, OP Desk, OP + IP Desk.
- **Multiple counters** - several billing desks work at once over the local network.
- **Runs locally** - on the hospital's own machine; automatic daily backups.
- **Multi-branch ready** - `location_id` on every record so a second branch is an *add*, not a rewrite (no branch features built yet).

---

## 6. Billing Rules (the exact logic)

These are the rules that must be **pure, tested functions** (see `DEVELOPMENT_RULES.md` §2-3).

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

---

## 7. How It's Used (flows)

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

## 8. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Application (UI + API) | **Next.js** (API routes as the backend) | One self-hosted app, fewer moving parts to run and support. |
| Database | **PostgreSQL (local)** | Reliable, transactional, safe with money; runs on-site, no monthly fees, works offline. |
| Invoice/receipt designer | **pdfme** | Admin-editable A4 layouts without a developer. |
| Keep-alive | **PM2** | Auto-restart on crash/reboot; auto-start on boot. |
| Testing | **Vitest** (+ Playwright later) | Unit/integration now; E2E on the core flow once stable. |
| Backups | **Scheduled script** | Daily automatic backup, plus periodic manual verification. |

**No Docker/Kubernetes.** Reproducibility comes from pinned Node/Postgres versions + `npm ci` + a setup script. Docker is deferred until multi-clinic deployment makes it worth it.

---

## 9. Deployment & Infrastructure

- Runs **on the hospital's server PC**; billing counters reach it over the **local network (LAN)**.
- **Single Postgres connection pool**, reused across requests, keepalive on. No per-request reconnects.
- **Optional remote access (Tailscale)** can be added later for off-site staff without exposing the PC - built after local is working, no code changes.
- **During development/setup:** the developer needs stable internet + remote access to the server PC. Day-to-day running does not depend on the internet.
- **Backups:** daily automated script; a copy on an external drive is recommended; verify restores periodically.
- **UPS recommended** on the server PC so a power blip doesn't halt every counter.

---

## 10. Data Model (proposed starting point)

High-level core tables. `location_id` on every operational table from day one. Money stored as integer minor units (paise) or decimal - never float.

- **locations** - `id, name`. (One row for now.)
- **users** - `id, name, phone (unique - staff sign in with it), password_hash, role, pin_hash (supervisors), location_id`. Unlike patients, a staff phone **is** unique.
- **doctors** - `id, name, department, fee, revisit_validity_days, location_id`.
- **services** - `id, name, price, location_id`. (Procedures/items list.)
- **patients** - `id (PK), patient_code (unique, auto-generated - the MRN shown to users), name, age, phone, area, location_id`. **Phone is indexed but NOT unique** - multiple patients may share a phone. All consultations, bills, and admissions reference the patient by `id`.
- **consultations** - `id, patient_id, doctor_id, fee_charged, created_at, valid_until, location_id`.
- **visits** - `id, consultation_id, visited_at`. (Revisits under a consultation.)
- **bills** - `id, bill_number, patient_id, type (consultation | procedure | ip), subtotal, discount, discount_approved_by, status (final | pending_approval | void), payment_mode, created_by, created_at, location_id`.
- **bill_items** - `id, bill_id, service_id, description, quantity, unit_price, line_total`.
- **admissions** - `id, patient_id, admitted_at, discharged_at, advance_paid, room_charge, status, location_id`.
- **admission_expenses** - `id, admission_id, item, quantity, total`.
- **audit_log** - `id, user_id, action, entity, entity_id, at`.

Indexes at minimum on: `patients.phone`, `bills.created_at`, and `location_id` across tables. Wrap multi-step writes (admission+advance, discharge+bill) in transactions.

---

## 11. Scope

### Phase 1 - Now
Multi-location foundation (one branch), patient registration, OP consultations + procedures, IN/OUT with itemised discharge, discount approval, A4 receipts & invoices with editable layout, per-user dashboards, role-based access, doctors/services/users management, basic daily reports.

### Phase 2 - Later
Patient history lookup by phone (a phone lists all patients on it; pick the person to see their past visits & invoices), cross-branch combined reports (once a 2nd branch exists), and migration of the ~174,000 old Access records if the client wants them in-system.

### Out of scope (for now)
Thermal printing, room/bed availability tracking, pharmacy/medicine stock, laboratory/tests, appointment booking, insurance/TPA claims, accounting integration, emailing receipts. The data model leaves the door open; none of these are built until requested.

---

## 12. Expectations (client-side)

- The **server PC stays powered on** during clinic hours, on a stable network, with all counters on the same LAN.
- **Remote access + internet for the developer** during development and setup.
- The **doctor list** with fees and revisit-validity days, to load into the system.
- A **backup location** (the PC, plus ideally an external drive).

---

*One-line summary: replace a messy single-file Access receipt log with a fast, local, multi-user billing system - clean data, tested money logic, A4 printing, role-based access - that feels instant at the counter and is built to grow.*
