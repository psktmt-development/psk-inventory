import { Router } from 'express';
import { query } from '../db/pool.js';
import { asyncHandler } from '../middleware/errors.js';
import { requireAuth } from '../middleware/auth.js';

export const dashboardsRouter = Router();
dashboardsRouter.use(requireAuth);

// 1. Stock Summary — available stock per factory (stock is sizeless: one pool
//    per factory). Feeds the sale form's per-factory availability check.
dashboardsRouter.get(
  '/stock-summary',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(`
      SELECT f.factory_id, f.name AS factory_name,
             COALESCE(SUM(bi.balance_qty) FILTER (WHERE bi.status='Available'),0)      AS available_qty,
             COALESCE(SUM(bi.balance_qty) FILTER (WHERE bi.status IN ('Booked','Under-Loading','Available')),0) AS total_balance
        FROM factories f
        LEFT JOIN booking_items bi ON bi.factory_id=f.factory_id
       GROUP BY f.factory_id, f.name
      HAVING COALESCE(SUM(bi.balance_qty),0) > 0
       ORDER BY f.name`);
    res.json(rows);
  }),
);

// 1b. Opening Stock — every factory (incl. zero): Booking / Order / Under Loading /
//     Balance. Booking + Balance are sizeless (per factory); the size breakup is on
//     the sold side only (from the sale line's size_mm label).
dashboardsRouter.get(
  '/opening-stock',
  asyncHandler(async (_req, res) => {
    // Per-factory booking totals (stock is sizeless).
    const { rows: booked } = await query(`
      SELECT f.factory_id, f.name AS factory_name,
             COALESCE(SUM(bi.booked_qty),0)  AS booked_qty,
             COALESCE(SUM(bi.balance_qty),0) AS balance_qty
        FROM factories f
        LEFT JOIN booking_items bi ON bi.factory_id = f.factory_id
       GROUP BY f.factory_id, f.name
       ORDER BY f.name`);

    // Sold quantities per factory + size label (size lives only on the sale line now).
    const { rows: sold } = await query(`
      SELECT si.factory_id, si.size_mm,
             SUM(si.sale_qty) AS sold_qty,
             SUM(si.sale_qty) FILTER (WHERE EXISTS (SELECT 1 FROM dispatch_details dd WHERE dd.sale_id = s.sale_id)) AS under_loading_qty
        FROM sale_items si
        JOIN sales s ON s.sale_id = si.sale_id
       WHERE s.status <> 'Cancelled'
       GROUP BY si.factory_id, si.size_mm`);

    const soldByFactory = new Map<number, any[]>();
    for (const r of sold) {
      if (!soldByFactory.has(r.factory_id)) soldByFactory.set(r.factory_id, []);
      soldByFactory.get(r.factory_id)!.push({
        size_mm: r.size_mm,
        sold_qty: Number(r.sold_qty),
        under_loading_qty: Number(r.under_loading_qty ?? 0),
      });
    }

    const factories = booked.map((f) => {
      const sizes = (soldByFactory.get(f.factory_id) ?? []).sort((a, b) => (a.size_mm ?? 999) - (b.size_mm ?? 999));
      const sold_qty = sizes.reduce((t, x) => t + x.sold_qty, 0);
      const under_loading_qty = sizes.reduce((t, x) => t + x.under_loading_qty, 0);
      return {
        factory_id: f.factory_id, factory_name: f.factory_name,
        booked_qty: Number(f.booked_qty), balance_qty: Number(f.balance_qty),
        sold_qty, under_loading_qty, sizes,
      };
    });
    const totals = factories.reduce((t, f) => ({
      booked_qty: t.booked_qty + f.booked_qty,
      sold_qty: t.sold_qty + f.sold_qty,
      under_loading_qty: t.under_loading_qty + f.under_loading_qty,
      balance_qty: t.balance_qty + f.balance_qty,
    }), { booked_qty: 0, sold_qty: 0, under_loading_qty: 0, balance_qty: 0 });
    res.json({ factories, totals });
  }),
);

// 2b. Sauda Ledger — one factory: purchase lots (left) + sales drawn from it (right), date-ordered.
dashboardsRouter.get(
  '/sauda-ledger',
  asyncHandler(async (req, res) => {
    const factoryId = req.query.factory_id ? Number(req.query.factory_id) : null;
    const productId = req.query.product_id ? Number(req.query.product_id) : null;
    if (!factoryId) return res.json({ factory: null, purchases: [], sales: [], totals: { booking_qty: 0, sale_qty: 0, balance: 0 } });

    const { rows: fac } = await query(`SELECT factory_id, name FROM factories WHERE factory_id=$1`, [factoryId]);

    // Purchases = booking lots for this factory (optionally one size), in FIFO/booking order.
    const { rows: purchases } = await query(
      `SELECT bi.booking_item_id, b.booking_date AS date, p.size_mm,
              bi.booked_qty AS booking_qty, bi.purchase_rate AS pur_rate
         FROM booking_items bi
         JOIN bookings b ON b.booking_id = bi.booking_id
         JOIN products p ON p.product_id = bi.product_id
        WHERE bi.factory_id = $1 AND ($2::int IS NULL OR bi.product_id = $2)
        ORDER BY COALESCE(bi.received_date, b.booking_date), bi.booking_item_id`,
      [factoryId, productId],
    );

    // Sales = one row per sale line sold as this factory's brand (factory-lock guarantees
    // its allocations are all from this factory), in sale-date order.
    const { rows: sales } = await query(
      `SELECT s.sale_date, d.name AS customer_name, p.size_mm,
              si.sale_rate, s.sale_invoice_no, si.purchase_invoice_no, si.sale_qty
         FROM sale_items si
         JOIN sales s ON s.sale_id = si.sale_id
         JOIN dealers d ON d.dealer_id = s.dealer_id
         JOIN products p ON p.product_id = si.product_id
        WHERE si.factory_id = $1 AND ($2::int IS NULL OR si.product_id = $2) AND s.status <> 'Cancelled'
        ORDER BY s.sale_date, s.sale_id, si.sale_item_id`,
      [factoryId, productId],
    );

    const booking_qty = purchases.reduce((t, r) => t + Number(r.booking_qty), 0);
    const sale_qty = sales.reduce((t, r) => t + Number(r.sale_qty), 0);
    res.json({ factory: fac[0] ?? null, purchases, sales, totals: { booking_qty, sale_qty, balance: booking_qty - sale_qty } });
  }),
);

// 2. Factory Ledger — bookings + every allocation drawn against them, with running balance
dashboardsRouter.get(
  '/factory-ledger',
  asyncHandler(async (req, res) => {
    const factoryId = req.query.factory_id ? Number(req.query.factory_id) : null;
    const { rows } = await query(
      `
      SELECT bi.booking_item_id, bi.factory_id, f.name AS factory_name, b.booking_id, b.booking_date,
             p.size_mm, bi.booked_qty, bi.purchase_rate, bi.status,
             bi.dispatched_date, bi.received_date, bi.balance_qty,
             COALESCE(json_agg(
               json_build_object(
                 'allocation_id', a.allocation_id,
                 'sale_id', si.sale_id,
                 'sale_invoice_no', s.sale_invoice_no,
                 'sale_date', s.sale_date,
                 'dealer_name', d.name,
                 'allocated_qty', a.allocated_qty,
                 'sale_rate', si.sale_rate
               ) ORDER BY a.allocation_id
             ) FILTER (WHERE a.allocation_id IS NOT NULL), '[]') AS allocations
        FROM booking_items bi
        JOIN bookings b ON b.booking_id=bi.booking_id
        JOIN factories f ON f.factory_id=bi.factory_id
        JOIN products p ON p.product_id=bi.product_id
        LEFT JOIN sale_allocations a ON a.booking_item_id=bi.booking_item_id
        LEFT JOIN sale_items si ON si.sale_item_id=a.sale_item_id
        LEFT JOIN sales s ON s.sale_id=si.sale_id
        LEFT JOIN dealers d ON d.dealer_id=s.dealer_id
       WHERE ($1::int IS NULL OR bi.factory_id=$1)
       GROUP BY bi.booking_item_id, f.name, b.booking_id, b.booking_date, p.size_mm
       ORDER BY f.name, b.booking_date, bi.booking_item_id`,
      [factoryId],
    );
    res.json(rows);
  }),
);

// 3. Sales Dashboard
dashboardsRouter.get(
  '/sales',
  asyncHandler(async (req, res) => {
    const from = (req.query.from as string) || '1900-01-01';
    const to = (req.query.to as string) || '2999-12-31';
    const params = [from, to];
    const [byArea, bySalesPerson, byPaymentType, funnel, trend] = await Promise.all([
      query(`SELECT d.area, COUNT(DISTINCT s.sale_id)::int AS orders, COALESCE(SUM(s.total_amount),0) AS amount
               FROM sales s JOIN dealers d ON d.dealer_id=s.dealer_id
              WHERE s.sale_date BETWEEN $1 AND $2 AND s.status<>'Cancelled'
              GROUP BY d.area ORDER BY amount DESC`, params),
      query(`SELECT sp.name AS sales_person, COUNT(DISTINCT s.sale_id)::int AS orders, COALESCE(SUM(s.total_amount),0) AS amount
               FROM sales s LEFT JOIN sales_people sp ON sp.sales_person_id=s.sales_person_id
              WHERE s.sale_date BETWEEN $1 AND $2 AND s.status<>'Cancelled'
              GROUP BY sp.name ORDER BY amount DESC`, params),
      query(`SELECT s.payment_type, COUNT(*)::int AS orders, COALESCE(SUM(s.total_amount),0) AS amount
               FROM sales s WHERE s.sale_date BETWEEN $1 AND $2 AND s.status<>'Cancelled'
              GROUP BY s.payment_type`, params),
      query(`SELECT s.status, COUNT(*)::int AS orders, COALESCE(SUM(s.total_amount),0) AS amount
               FROM sales s WHERE s.sale_date BETWEEN $1 AND $2 GROUP BY s.status`, params),
      query(`SELECT to_char(s.sale_date,'YYYY-MM') AS month, COALESCE(SUM(s.total_amount),0) AS amount
               FROM sales s WHERE s.status<>'Cancelled' GROUP BY month ORDER BY month`, []),
    ]);
    res.json({
      byArea: byArea.rows,
      bySalesPerson: bySalesPerson.rows,
      byPaymentType: byPaymentType.rows,
      funnel: funnel.rows,
      trend: trend.rows,
    });
  }),
);

// 4. Dispatch Tracking
dashboardsRouter.get(
  '/dispatch',
  asyncHandler(async (_req, res) => {
    const [funnel, inTransit] = await Promise.all([
      query(`SELECT status, COUNT(*)::int AS orders FROM sales GROUP BY status`),
      query(`SELECT dd.delivery_status, COUNT(*)::int AS count FROM dispatch_details dd GROUP BY dd.delivery_status`),
    ]);
    const pending = await query(`SELECT COUNT(*)::int AS c FROM sales WHERE status='Pending'`);
    res.json({ saleStatus: funnel.rows, deliveryStatus: inTransit.rows, pendingCount: pending.rows[0].c });
  }),
);

// 5. Payments Dashboard
dashboardsRouter.get(
  '/payments',
  asyncHandler(async (_req, res) => {
    // Per-dealer receivables rolled up across all their (non-cancelled) orders.
    const dealerOutstanding = await query(`
      SELECT d.dealer_id, d.name AS dealer_name,
             COALESCE(SUM(s.total_amount)    FILTER (WHERE s.status<>'Cancelled'),0) AS total,
             COALESCE(SUM(s.amount_received) FILTER (WHERE s.status<>'Cancelled'),0) AS paid,
             COALESCE(SUM(s.balance_due)     FILTER (WHERE s.status<>'Cancelled'),0) AS due,
             -- earliest still-owed credit due date = the most urgent to collect
             MIN(s.credit_date) FILTER (WHERE s.status<>'Cancelled' AND s.balance_due > 0 AND s.credit_date IS NOT NULL) AS due_date,
             COALESCE(SUM(s.balance_due) FILTER (WHERE s.status<>'Cancelled' AND s.credit_date IS NOT NULL AND s.credit_date < CURRENT_DATE),0) AS overdue
        FROM dealers d LEFT JOIN sales s ON s.dealer_id=d.dealer_id
       GROUP BY d.dealer_id
      HAVING COALESCE(SUM(s.balance_due) FILTER (WHERE s.status<>'Cancelled'),0) > 0.005
       ORDER BY due DESC`);

    // Factory payable = booked value − supplier payments, aged by booking date
    const factoryPayable = await query(`
      WITH booked AS (
        SELECT b.factory_id,
               SUM(bi.booked_qty*bi.purchase_rate) AS booked_value,
               SUM(bi.booked_qty*bi.purchase_rate) FILTER (WHERE b.booking_date >= CURRENT_DATE-30) AS d0_30,
               SUM(bi.booked_qty*bi.purchase_rate) FILTER (WHERE b.booking_date < CURRENT_DATE-30 AND b.booking_date >= CURRENT_DATE-60) AS d31_60,
               SUM(bi.booked_qty*bi.purchase_rate) FILTER (WHERE b.booking_date < CURRENT_DATE-60) AS d60_plus
          FROM bookings b JOIN booking_items bi ON bi.booking_id=b.booking_id
         GROUP BY b.factory_id
      ), paid AS (
        SELECT factory_id, SUM(amount) AS paid FROM supplier_payments GROUP BY factory_id
      )
      SELECT f.factory_id, f.name AS factory_name,
             COALESCE(bk.booked_value,0) AS booked_value,
             COALESCE(pd.paid,0) AS paid,
             COALESCE(bk.booked_value,0)-COALESCE(pd.paid,0) AS payable,
             COALESCE(bk.d0_30,0) AS age_0_30, COALESCE(bk.d31_60,0) AS age_31_60, COALESCE(bk.d60_plus,0) AS age_60_plus
        FROM factories f
        LEFT JOIN booked bk ON bk.factory_id=f.factory_id
        LEFT JOIN paid pd ON pd.factory_id=f.factory_id
       ORDER BY payable DESC`);

    const trend = await query(`
      SELECT to_char(payment_date,'YYYY-MM') AS month,
             SUM(amount) FILTER (WHERE src='in') AS received,
             SUM(amount) FILTER (WHERE src='out') AS paid
        FROM (SELECT payment_date, amount, 'in' AS src FROM dealer_payments
              UNION ALL SELECT payment_date, amount, 'out' FROM supplier_payments) t
       GROUP BY month ORDER BY month`);

    res.json({ dealerOutstanding: dealerOutstanding.rows, factoryPayable: factoryPayable.rows, trend: trend.rows });
  }),
);

// 6. Executive Summary
dashboardsRouter.get(
  '/executive',
  asyncHandler(async (_req, res) => {
    const pipeline = await query(`
      SELECT f.factory_id, f.name AS factory_name,
             COALESCE(bk.booked_qty,0)       AS booked_qty,
             COALESCE(sl.sold_qty,0)         AS sold_qty,
             COALESCE(sl.under_loading_qty,0) AS under_loading_qty,
             COALESCE(bk.balance_qty,0)      AS balance_qty,
             COALESCE(bk.pipeline_value,0)   AS pipeline_value
        FROM factories f
        LEFT JOIN (
          SELECT factory_id,
                 SUM(booked_qty)  AS booked_qty,
                 SUM(balance_qty) AS balance_qty,
                 SUM(balance_qty*purchase_rate) FILTER (WHERE status IN ('Available','Under-Loading')) AS pipeline_value
            FROM booking_items GROUP BY factory_id
        ) bk ON bk.factory_id = f.factory_id
        LEFT JOIN (
          SELECT si.factory_id,
                 SUM(si.sale_qty) AS sold_qty,
                 SUM(si.sale_qty) FILTER (WHERE EXISTS (SELECT 1 FROM dispatch_details dd WHERE dd.sale_id = s.sale_id)) AS under_loading_qty
            FROM sale_items si JOIN sales s ON s.sale_id = si.sale_id
           WHERE s.status <> 'Cancelled'
           GROUP BY si.factory_id
        ) sl ON sl.factory_id = f.factory_id
       ORDER BY COALESCE(bk.balance_qty,0) DESC, f.factory_id`);
    const totals = await query(`
      SELECT
        (SELECT COALESCE(SUM(balance_due),0) FROM sales WHERE status<>'Cancelled') AS receivables,
        (SELECT COALESCE(SUM(bi.booked_qty*bi.purchase_rate),0) FROM booking_items bi) -
        (SELECT COALESCE(SUM(amount),0) FROM supplier_payments) AS payables,
        (SELECT COALESCE(SUM(balance_qty*purchase_rate),0) FROM booking_items WHERE status IN ('Available','Under-Loading')) AS pipeline_value,
        (SELECT COALESCE(SUM(total_amount),0) FROM sales WHERE status<>'Cancelled') AS total_sales`);
    res.json({ pipeline: pipeline.rows, totals: totals.rows[0] });
  }),
);
