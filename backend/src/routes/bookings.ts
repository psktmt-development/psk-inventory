import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/pool.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getProductIdForSize } from '../services/product.js';

export const bookingsRouter = Router();
bookingsRouter.use(requireAuth);

const bookingWrite = requireRole('Warehouse', 'Accounts');

const createSchema = z.object({
  factory_id: z.number().int(),
  booking_date: z.string().optional(),
  brand: z.string().optional().nullable(),
  items: z
    .array(
      z.object({
        size_mm: z.number().int(),
        booked_qty: z.number().positive(),
        purchase_rate: z.number().nonnegative().default(0),
      }),
    )
    .min(1),
});

// List bookings with item roll-up
bookingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(`
      SELECT b.booking_id, b.booking_date, b.factory_id, f.name AS factory_name, b.created_at,
             COUNT(bi.booking_item_id)::int AS item_count,
             COALESCE(SUM(bi.booked_qty),0) AS total_booked,
             COALESCE(SUM(bi.balance_qty),0) AS total_balance,
             COALESCE(SUM(bi.booked_qty*bi.purchase_rate)/NULLIF(SUM(bi.booked_qty),0),0) AS avg_rate,
             COALESCE(SUM(bi.booked_qty*bi.purchase_rate),0) AS payable,
             COALESCE((SELECT SUM(sp.amount) FROM supplier_payments sp WHERE sp.booking_id = b.booking_id),0) AS paid
        FROM bookings b
        JOIN factories f ON f.factory_id = b.factory_id
        LEFT JOIN booking_items bi ON bi.booking_id = b.booking_id
       GROUP BY b.booking_id, f.name
       ORDER BY b.booking_date DESC, b.booking_id DESC`);
    res.json(rows);
  }),
);

// Booking detail with its lots
bookingsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { rows: header } = await query(
      `SELECT b.*, f.name AS factory_name FROM bookings b JOIN factories f ON f.factory_id=b.factory_id WHERE b.booking_id=$1`,
      [req.params.id],
    );
    if (!header[0]) throw new HttpError(404, 'Booking not found');
    const { rows: items } = await query(
      `SELECT bi.*, p.size_mm FROM booking_items bi JOIN products p ON p.product_id=bi.product_id
        WHERE bi.booking_id=$1 ORDER BY bi.booking_item_id`,
      [req.params.id],
    );
    res.json({ ...header[0], items });
  }),
);

// Create a booking with one or more size line-items
bookingsRouter.post(
  '/',
  bookingWrite,
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body);
    const result = await withTransaction(async (client) => {
      const { rows: b } = await client.query(
        `INSERT INTO bookings (factory_id, booking_date, brand, created_by) VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4) RETURNING *`,
        [body.factory_id, body.booking_date ?? null, body.brand ?? null, req.user!.user_id],
      );
      const booking = b[0];
      const items = [];
      for (const it of body.items) {
        const productId = await getProductIdForSize(it.size_mm, client);
        // Booked stock is immediately Available for sale; received_date = booking date drives FIFO order.
        const { rows } = await client.query(
          `INSERT INTO booking_items
             (booking_id, factory_id, product_id, booked_qty, purchase_rate, status, received_date)
           VALUES ($1,$2,$3,$4,$5,'Available',$6) RETURNING *`,
          [
            booking.booking_id,
            body.factory_id,
            productId,
            it.booked_qty,
            it.purchase_rate,
            booking.booking_date,
          ],
        );
        items.push(rows[0]);
      }
      return { ...booking, items };
    });
    res.status(201).json(result);
  }),
);
