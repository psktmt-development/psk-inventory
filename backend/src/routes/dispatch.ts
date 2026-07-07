import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/pool.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const dispatchRouter = Router();
dispatchRouter.use(requireAuth);

// Dispatch is entered during the sale (Sales/Accounts) or later by Warehouse.
const dispatchWrite = requireRole('Warehouse', 'Sales', 'Accounts');

const createSchema = z.object({
  sale_id: z.number().int(),
  truck_number: z.string().optional().nullable(),
  driver_name: z.string().optional().nullable(),
  driver_phone: z.string().optional().nullable(),
  dispatch_date: z.string().optional().nullable(),
  delivery_location: z.string().optional().nullable(),
});

// Tracking board
dispatchRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(`
      SELECT dd.*, s.status AS sale_status, s.sale_invoice_no, d.name AS dealer_name, d.area
        FROM dispatch_details dd
        JOIN sales s ON s.sale_id = dd.sale_id
        JOIN dealers d ON d.dealer_id = s.dealer_id
       ORDER BY dd.dispatch_date DESC, dd.dispatch_id DESC`);
    res.json(rows);
  }),
);

// Create dispatch → moves the sale Pending → Dispatched (RULE 6)
dispatchRouter.post(
  '/',
  dispatchWrite,
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const out = await withTransaction(async (client) => {
      const { rows: s } = await client.query(
        `SELECT s.*, d.address AS dealer_address FROM sales s JOIN dealers d ON d.dealer_id=s.dealer_id WHERE s.sale_id=$1 FOR UPDATE`,
        [body.sale_id],
      );
      if (!s[0]) throw new HttpError(404, 'Sale not found');
      if (s[0].status === 'Cancelled') throw new HttpError(400, 'Cannot dispatch a cancelled sale');
      const { rows: dd } = await client.query(
        `INSERT INTO dispatch_details (sale_id, truck_number, driver_name, driver_phone, dispatch_date, delivery_location, delivery_status)
         VALUES ($1,$2,$3,$4,COALESCE($5,CURRENT_DATE),COALESCE($6,$7),'In-Transit') RETURNING *`,
        [body.sale_id, body.truck_number ?? null, body.driver_name ?? null, body.driver_phone ?? null, body.dispatch_date ?? null, body.delivery_location ?? null, s[0].dealer_address],
      );
      await client.query(`UPDATE sales SET status='Dispatched' WHERE sale_id=$1 AND status='Pending'`, [body.sale_id]);
      return dd[0];
    });
    res.status(201).json(out);
  }),
);

// Mark delivered → sale Delivered
dispatchRouter.patch(
  '/:id/deliver',
  dispatchWrite,
  asyncHandler(async (req, res) => {
    const delivered_date = (req.body?.delivered_date as string) ?? new Date().toISOString().slice(0, 10);
    const out = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE dispatch_details SET delivery_status='Delivered', delivered_date=$2 WHERE dispatch_id=$1 RETURNING *`,
        [req.params.id, delivered_date],
      );
      if (!rows[0]) throw new HttpError(404, 'Dispatch not found');
      await client.query(`UPDATE sales SET status='Delivered' WHERE sale_id=$1`, [rows[0].sale_id]);
      return rows[0];
    });
    res.json(out);
  }),
);
