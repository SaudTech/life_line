import { pool } from "@/lib/db";
import type { IsoDay } from "@/lib/consultations/rules";

// Data access for bill correction (void + re-issue) - type-agnostic, so it lives
// in the shared billing/ domain that both consultations and procedures import
// from (DEVELOPMENT_RULES §2, one source of truth). Thin: queries only. The
// decisions (can-void, consultation expiry) are the pure rules in ./void.ts,
// invoked by the action; this layer just guards the write and reads the source
// bill for a re-issue. Mirrors lib/consultations/repository.ts.

export type BillType = "consultation" | "procedure" | "ip";

export interface VoidBillInput {
  billId: string;
  locationId: string;
  voidedBy: string; // the supervisor/admin who authorized it (approver id)
  reason: string;
  // Clinic day to set a voided consultation's valid_until to (computed by the
  // pure rule consultationExpiryOnVoid). Only used when the bill is a
  // consultation bill; ignored otherwise.
  consultationExpiry: IsoDay;
}

export interface VoidedBill {
  billNumber: string;
  type: BillType;
}

// Void a finalized bill - all or nothing in one transaction. The UPDATE is
// GUARDED (status = 'final' AND matching location) so a double-void, a stale
// tab, or a wrong-branch attempt writes NOTHING and returns null - never a
// second void, and never a money column touched (only the void metadata is set;
// the bill stays fully readable and reprintable with its VOID watermark, and its
// number is never reused). When the voided bill is a CONSULTATION with a linked
// consultation, the SAME transaction expires that consultation so a voided
// consultation can't keep handing out free revisits (plan §2b). A procedure bill
// has no such side effect.
export async function voidBill(input: VoidBillInput): Promise<VoidedBill | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query<{
      bill_number: string;
      type: BillType;
      consultation_id: string | null;
    }>(
      `UPDATE bills
          SET status = 'void', voided_by = $1, voided_at = now(), void_reason = $2
        WHERE id = $3 AND status = 'final' AND location_id = $4
      RETURNING bill_number::text, type, consultation_id::text`,
      [input.voidedBy, input.reason, input.billId, input.locationId],
    );
    if (res.rowCount === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    const row = res.rows[0];
    if (row.type === "consultation" && row.consultation_id) {
      await client.query(`UPDATE consultations SET valid_until = $1::date WHERE id = $2`, [
        input.consultationExpiry,
        row.consultation_id,
      ]);
    }
    await client.query("COMMIT");
    return { billNumber: row.bill_number, type: row.type };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Everything needed to pre-fill the create flow when re-issuing a corrected bill
// (plan §Part B). Only a VOIDED, not-yet-replaced bill is a valid source - the
// guard in the query enforces the one-shot re-issue (a voided bill can be
// replaced once). doctorId is set for a consultation bill; lines for a procedure.
export interface ReissueSource {
  billId: string;
  billNumber: string;
  type: "consultation" | "procedure";
  patientId: string;
  patientName: string;
  phone: string | null;
  consultationId: string | null; // the consultation this bill was billed against
  doctorId: string | null; // consultation bills only
  lines: { serviceId: string; quantity: number }[]; // procedure bills only
}

// Read the voided bill a re-issue is correcting, with the detail the flow needs
// to pre-fill. Null when the id doesn't exist, isn't void, or was already
// replaced - the entry point then just opens a normal, empty flow.
export async function getBillForReissue(billId: string): Promise<ReissueSource | null> {
  const { rows } = await pool.query<{
    bill_id: string;
    bill_number: string;
    type: BillType;
    patient_id: string;
    patient_name: string;
    phone: string | null;
    consultation_id: string | null;
    doctor_id: string | null;
  }>(
    `SELECT b.id::text                 AS bill_id,
            b.bill_number::text        AS bill_number,
            b.type,
            p.id::text                 AS patient_id,
            p.name                     AS patient_name,
            p.phone,
            b.consultation_id::text    AS consultation_id,
            cons.doctor_id::text       AS doctor_id
       FROM bills b
       JOIN patients p ON p.id = b.patient_id
       LEFT JOIN consultations cons ON cons.id = b.consultation_id
      WHERE b.id = $1
        AND b.status = 'void'
        AND b.replaced_by_bill_id IS NULL`,
    [billId],
  );
  const row = rows[0];
  if (!row || (row.type !== "consultation" && row.type !== "procedure")) return null;

  let lines: { serviceId: string; quantity: number }[] = [];
  if (row.type === "procedure") {
    const items = await pool.query<{ service_id: string; quantity: number }>(
      `SELECT service_id::text AS service_id, quantity
         FROM bill_items
        WHERE bill_id = $1
        ORDER BY id`,
      [billId],
    );
    lines = items.rows.map((r) => ({ serviceId: r.service_id, quantity: r.quantity }));
  }

  return {
    billId: row.bill_id,
    billNumber: row.bill_number,
    type: row.type,
    patientId: row.patient_id,
    patientName: row.patient_name,
    phone: row.phone,
    consultationId: row.consultation_id,
    doctorId: row.doctor_id,
    lines,
  };
}
