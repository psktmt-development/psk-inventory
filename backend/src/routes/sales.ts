import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/pool.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { fifoAllocate, type AllocationResult } from '../services/allocation.js';
import { getDefaultProductId } from '../services/product.js';

export const salesRouter = Router();
salesRouter.use(requireAuth);

const saleWrite = requireRole('Sales', 'Accounts');

const saleSchema = z.object({
  dealer_id: z.number().int(),
  sale_date: z.string().optional(),
  sale_invoice_no: z.string().optional().nullable(),
  payment_type: z.enum(['Direct', 'Credit']),
  credit_days: z.number().int().nonnegative().optional().nullable(),
  items: z
    .array(
      z.object({
        factory_id: z.number().int(),
        sale_qty: z.number().positive(),
        sale_rate: z.number().nonnegative(),
        purchase_invoice_no: z.string().optional().nullable(),
      }),
    )
    .min(1),
});

/** Sales role sees only their own dealers; others see all. */
function salesScope(req: any): { clause: string; params: any[] } {
  if (req.user.role === 'Sales' && req.user.linked_sales_person_id) {
    return { clause: 'WHERE s.sales_person_id = $1', params: [req.user.linked_sales_person_id] };
  }
  return { clause: '', params: [] };
}

// List sales
salesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const scope = salesScope(req);
    const { rows } = await query(
      `SELECT s.*, d.name AS dealer_name, d.area, sp.name AS sales_person_name
         FROM sales s
         JOIN dealers d ON d.dealer_id = s.dealer_id
         LEFT JOIN sales_people sp ON sp.sales_person_id = s.sales_person_id
         ${scope.clause}
        ORDER BY s.sale_date DESC, s.sale_id DESC`,
      scope.params,
    );
    res.json(rows);
  }),
);

// Sale detail: items, the lots each line drew from, dispatch, payments
salesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { rows: head } = await query(
      `SELECT s.*, d.name AS dealer_name, d.area, d.address AS dealer_address, sp.name AS sales_person_name
         FROM sales s JOIN dealers d ON d.dealer_id=s.dealer_id
         LEFT JOIN sales_people sp ON sp.sales_person_id=s.sales_person_id
        WHERE s.sale_id=$1`,
      [req.params.id],
    );
    if (!head[0]) throw new HttpError(404, 'Sale not found');
    const { rows: items } = await query(
      `SELECT si.*, f.name AS factory_name, p.size_mm FROM sale_items si
         JOIN factories f ON f.factory_id=si.factory_id
         JOIN products p ON p.product_id=si.product_id
        WHERE si.sale_id=$1 ORDER BY si.sale_item_id`,
      [req.params.id],
    );
    const { rows: allocs } = await query(
      `SELECT a.*, bi.booking_id, bi.received_date, bi.purchase_rate
         FROM sale_allocations a JOIN sale_items si ON si.sale_item_id=a.sale_item_id
         JOIN booking_items bi ON bi.booking_item_id=a.booking_item_id
        WHERE si.sale_id=$1 ORDER BY a.allocation_id`,
      [req.params.id],
    );
    const { rows: dispatch } = await query(`SELECT * FROM dispatch_details WHERE sale_id=$1`, [req.params.id]);
    const { rows: payments } = await query(
      `SELECT * FROM dealer_payments WHERE sale_id=$1 ORDER BY payment_date, payment_id`,
      [req.params.id],
    );
    res.json({ ...head[0], items, allocations: allocs, dispatch, payments });
  }),
);

// Dry-run: FIFO allocation preview, rolled back (for the sale form)
salesRouter.post(
  '/preview',
  saleWrite,
  asyncHandler(async (req, res) => {
    const body = saleSchema.parse(req.body);
    const total = body.items.reduce((s, i) => s + i.sale_qty * i.sale_rate, 0);
    const out = await withTransaction(async (client) => {
      const lines: any[] = [];
      let sufficient = true;
      let error: string | null = null;
      const { rows: si } = await client.query(
        `INSERT INTO sales (dealer_id, payment_type) VALUES ($1,$2) RETURNING sale_id`,
        [body.dealer_id, body.payment_type],
      );
      const saleId = si[0].sale_id;
      const productId = await getDefaultProductId(client);
      for (const it of body.items) {
        const { rows: sir } = await client.query(
          `INSERT INTO sale_items (sale_id, factory_id, product_id, sale_qty, sale_rate, purchase_invoice_no) VALUES ($1,$2,$3,$4,$5,$6) RETURNING sale_item_id`,
          [saleId, it.factory_id, productId, it.sale_qty, it.sale_rate, it.purchase_invoice_no ?? null],
        );
        try {
          const allocs = await fifoAllocate(client, sir[0].sale_item_id, it.factory_id, productId, it.sale_qty);
          lines.push({ ...it, allocations: allocs });
        } catch (e: any) {
          sufficient = false;
          error = e.message;
          lines.push({ ...it, allocations: [], error: e.message });
        }
      }
      throw new PreviewDone({ total, lines, sufficient, error });
    }).catch((e) => {
      if (e instanceof PreviewDone) return e.payload;
      throw e;
    });
    res.json(out);
  }),
);

class PreviewDone extends Error {
  payload: any;
  constructor(payload: any) {
    super('preview');
    this.payload = payload;
  }
}

// Create a sale with FIFO allocation. Credit is date-based: a Credit sale fixes
// `credit_days` on the order, and the due date = sale_date + credit_days.
salesRouter.post(
  '/',
  saleWrite,
  asyncHandler(async (req, res) => {
    const body = saleSchema.parse(req.body);

    const sale = await withTransaction(async (client) => {
      // dealer + fixed sales-person mapping (auto-filled, never from the form)
      const { rows: d } = await client.query(`SELECT * FROM dealers WHERE dealer_id=$1`, [body.dealer_id]);
      if (!d[0]) throw new HttpError(404, 'Dealer not found');
      const salesPersonId = d[0].sales_person_id;

      const creditDays = body.payment_type === 'Credit' ? (body.credit_days ?? null) : null;

      const { rows: sr } = await client.query(
        `INSERT INTO sales (dealer_id, sales_person_id, sale_date, sale_invoice_no, payment_type, credit_days, credit_date, created_by)
         VALUES ($1,$2,COALESCE($3,CURRENT_DATE),$4,$5,$6,
                 CASE WHEN $6::int IS NOT NULL THEN COALESCE($3,CURRENT_DATE) + $6::int ELSE NULL END,
                 $7) RETURNING *`,
        [body.dealer_id, salesPersonId, body.sale_date ?? null, body.sale_invoice_no ?? null, body.payment_type,
         creditDays, req.user!.user_id],
      );
      const saleId = sr[0].sale_id;
      const productId = await getDefaultProductId(client);

      const allLines: { sale_item_id: number; allocations: AllocationResult[] }[] = [];
      for (const it of body.items) {
        const { rows: sir } = await client.query(
          `INSERT INTO sale_items (sale_id, factory_id, product_id, sale_qty, sale_rate, purchase_invoice_no) VALUES ($1,$2,$3,$4,$5,$6) RETURNING sale_item_id`,
          [saleId, it.factory_id, productId, it.sale_qty, it.sale_rate, it.purchase_invoice_no ?? null],
        );
        const allocations = await fifoAllocate(client, sir[0].sale_item_id, it.factory_id, productId, it.sale_qty);
        allLines.push({ sale_item_id: sir[0].sale_item_id, allocations });
      }

      const { rows: fresh } = await client.query(`SELECT * FROM sales WHERE sale_id=$1`, [saleId]);
      return { ...fresh[0], lines: allLines };
    });

    res.status(201).json(sale);
  }),
);

// Cancel a sale — releases allocated stock (trigger returns lots to Available)
salesRouter.patch(
  '/:id/cancel',
  saleWrite,
  asyncHandler(async (req, res) => {
    const sale = await withTransaction(async (client) => {
      const { rows } = await client.query(`SELECT * FROM sales WHERE sale_id=$1 FOR UPDATE`, [req.params.id]);
      if (!rows[0]) throw new HttpError(404, 'Sale not found');
      if (rows[0].status === 'Delivered') throw new HttpError(400, 'Cannot cancel a Delivered sale');
      // Deleting allocations fires the trigger that restores balance_qty & reopens lots.
      await client.query(
        `DELETE FROM sale_allocations WHERE sale_item_id IN (SELECT sale_item_id FROM sale_items WHERE sale_id=$1)`,
        [req.params.id],
      );
      const { rows: upd } = await client.query(
        `UPDATE sales SET status='Cancelled' WHERE sale_id=$1 RETURNING *`,
        [req.params.id],
      );
      return upd[0];
    });
    res.json(sale);
  }),
);
