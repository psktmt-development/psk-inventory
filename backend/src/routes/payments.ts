import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/pool.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const paymentsRouter = Router();
paymentsRouter.use(requireAuth);

const paymentsWrite = requireRole('Accounts');
const MODES = ['Cash', 'Bank Transfer', 'Cheque', 'UPI'] as const;

// ---------------- Supplier payments (to factories) ----------------
const supplierSchema = z.object({
  factory_id: z.number().int(),
  booking_ids: z.array(z.number().int()).optional(),
  amount: z.number().positive(),
  payment_date: z.string().optional(),
  payment_mode: z.enum(MODES),
  reference_number: z.string().optional().nullable(),
});

// A booking's outstanding = booked value − payments already applied to it.
const OUTSTANDING_SQL = `
  SELECT b.booking_id, b.booking_date, b.brand,
         COALESCE(SUM(bi.booked_qty * bi.purchase_rate), 0) AS booked_value,
         COALESCE((SELECT SUM(amount) FROM supplier_payments sp WHERE sp.booking_id = b.booking_id), 0) AS paid,
         COALESCE(SUM(bi.booked_qty * bi.purchase_rate), 0)
           - COALESCE((SELECT SUM(amount) FROM supplier_payments sp WHERE sp.booking_id = b.booking_id), 0) AS outstanding
    FROM bookings b
    JOIN booking_items bi ON bi.booking_id = b.booking_id`;

paymentsRouter.get(
  '/supplier',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(`
      SELECT sp.*, f.name AS factory_name FROM supplier_payments sp
        JOIN factories f ON f.factory_id = sp.factory_id
       ORDER BY sp.payment_date DESC, sp.payment_id DESC`);
    res.json(rows);
  }),
);

// Pending (unpaid) bookings for a factory, oldest first (FIFO) — the payable "invoices".
paymentsRouter.get(
  '/supplier/pending',
  asyncHandler(async (req, res) => {
    const factoryId = Number(req.query.factory_id);
    if (!factoryId) throw new HttpError(400, 'factory_id is required');
    const { rows } = await query(
      `${OUTSTANDING_SQL}
        WHERE b.factory_id = $1
        GROUP BY b.booking_id
       HAVING COALESCE(SUM(bi.booked_qty * bi.purchase_rate), 0)
                - COALESCE((SELECT SUM(amount) FROM supplier_payments sp WHERE sp.booking_id = b.booking_id), 0) > 0.005
       ORDER BY b.booking_date ASC, b.booking_id ASC`,
      [factoryId],
    );
    res.json(rows);
  }),
);

paymentsRouter.post(
  '/supplier',
  paymentsWrite,
  asyncHandler(async (req, res) => {
    const b = supplierSchema.parse(req.body);
    const ids = b.booking_ids ?? [];

    const created = await withTransaction(async (client) => {
      const insert = (bookingId: number | null, amount: number) =>
        client.query(
          `INSERT INTO supplier_payments (factory_id, booking_id, amount, payment_date, payment_mode, reference_number, created_by)
           VALUES ($1,$2,$3,COALESCE($4,CURRENT_DATE),$5,$6,$7) RETURNING *`,
          [b.factory_id, bookingId, amount, b.payment_date ?? null, b.payment_mode, b.reference_number ?? null, req.user!.user_id],
        );

      // No invoices selected → a single general settlement row (no booking link).
      if (ids.length === 0) {
        const { rows } = await insert(null, b.amount);
        return rows;
      }

      // Selected invoices, oldest first — allocate the amount FIFO across them.
      const { rows: pend } = await client.query(
        `${OUTSTANDING_SQL}
          WHERE b.factory_id = $1 AND b.booking_id = ANY($2::int[])
          GROUP BY b.booking_id
         ORDER BY b.booking_date ASC, b.booking_id ASC`,
        [b.factory_id, ids],
      );
      const totalOutstanding = pend.reduce((s, r) => s + Number(r.outstanding), 0);
      if (b.amount > totalOutstanding + 1e-6) {
        throw new HttpError(400, `Amount ₹${b.amount} exceeds the selected invoices' outstanding ₹${totalOutstanding.toFixed(2)}.`);
      }

      const out: any[] = [];
      let remaining = b.amount;
      for (const p of pend) {
        if (remaining <= 1e-9) break;
        const pay = Math.min(remaining, Number(p.outstanding));
        if (pay <= 1e-9) continue;
        const { rows } = await insert(p.booking_id, pay);
        out.push(rows[0]);
        remaining -= pay;
      }
      return out;
    });

    res.status(201).json(created);
  }),
);

// ---------------- Dealer payments (from dealers) ----------------
const dealerSchema = z.object({
  dealer_id: z.number().int(),
  sale_id: z.number().int(),
  amount: z.number().positive(),
  payment_date: z.string().optional(),
  payment_mode: z.enum(MODES),
  reference_number: z.string().optional().nullable(),
});

paymentsRouter.get(
  '/dealer',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(`
      SELECT dp.*, d.name AS dealer_name, s.sale_invoice_no FROM dealer_payments dp
        JOIN dealers d ON d.dealer_id = dp.dealer_id
        JOIN sales s ON s.sale_id = dp.sale_id
       ORDER BY dp.payment_date DESC, dp.payment_id DESC`);
    res.json(rows);
  }),
);

paymentsRouter.post(
  '/dealer',
  paymentsWrite,
  asyncHandler(async (req, res) => {
    const b = dealerSchema.parse(req.body);
    // Guard: don't overpay a sale (parent totals are recomputed by trigger after insert).
    const { rows: sale } = await query(`SELECT balance_due FROM sales WHERE sale_id=$1`, [b.sale_id]);
    if (!sale[0]) throw new HttpError(404, 'Sale not found');
    if (b.amount > Number(sale[0].balance_due) + 1e-9) {
      throw new HttpError(400, `Amount ₹${b.amount} exceeds the sale's balance due ₹${sale[0].balance_due}`);
    }
    const { rows } = await query(
      `INSERT INTO dealer_payments (dealer_id, sale_id, amount, payment_date, payment_mode, reference_number, created_by)
       VALUES ($1,$2,$3,COALESCE($4,CURRENT_DATE),$5,$6,$7) RETURNING *`,
      [b.dealer_id, b.sale_id, b.amount, b.payment_date ?? null, b.payment_mode, b.reference_number ?? null, req.user!.user_id],
    );
    res.status(201).json(rows[0]);
  }),
);
