-- Migration: sizeless bookings + size-wise sales (2026-07)
-- Stock becomes a single per-factory pool (one default product). Size moves off
-- the stock model and onto the sale line as a label. All rate fields optional.
-- Idempotent: safe to run more than once.

BEGIN;

-- Size label + optional actual size-wise purchase cost on the sale line.
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS size_mm       INTEGER;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS purchase_rate NUMERIC(14,2);

-- Sale price is now optional (blank until priced). line_total is a generated
-- column (sale_qty * sale_rate); a NULL rate yields a NULL line_total, which the
-- recompute-total trigger's SUM simply ignores (counts as 0).
ALTER TABLE sale_items ALTER COLUMN sale_rate DROP DEFAULT;
ALTER TABLE sale_items ALTER COLUMN sale_rate DROP NOT NULL;

-- Backfill size_mm on any existing sale lines from their product's size, so old
-- rows keep their size label after the switch to the single default product.
UPDATE sale_items si
   SET size_mm = p.size_mm
  FROM products p
 WHERE p.product_id = si.product_id
   AND si.size_mm IS NULL;

COMMIT;
