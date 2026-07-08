import type { PoolClient } from 'pg';
import { query } from '../db/pool.js';

let cachedId: number | null = null;

/**
 * The single default product (12 mm).
 *
 * Size selection was removed app-wide — every booking lot and sale line is the
 * default product. We still keep the `products` table and the `product_id`
 * foreign keys so the factory-lock trigger and FIFO allocation keep working; the
 * app just never asks the user to pick a size and always uses this one product.
 */
export async function getDefaultProductId(client?: PoolClient): Promise<number> {
  if (cachedId != null) return cachedId;
  const run = client ? (t: string) => client.query(t) : (t: string) => query(t);
  const { rows } = await run(
    `SELECT product_id FROM products ORDER BY (size_mm = 12) DESC, product_id ASC LIMIT 1`,
  );
  if (!rows[0]) throw new Error('No product configured — seed a 12 mm product first.');
  const id = rows[0].product_id as number;
  cachedId = id;
  return id;
}

// The standard TMT bar sizes (mm) selectable across the app.
export const STANDARD_SIZES = [8, 10, 12, 16, 20, 25, 32] as const;

/**
 * Resolve the product_id for a given bar size, creating the product row on first
 * use. `size_mm` is UNIQUE, so ON CONFLICT makes this a safe get-or-create.
 */
export async function getProductIdForSize(size: number, client?: PoolClient): Promise<number> {
  if (!STANDARD_SIZES.includes(size as (typeof STANDARD_SIZES)[number]))
    throw new Error(`Unsupported size ${size} mm`);
  const run = client
    ? (t: string, p: unknown[]) => client.query(t, p)
    : (t: string, p: unknown[]) => query(t, p);
  const { rows } = await run(
    `INSERT INTO products (size_mm, unit) VALUES ($1, 'MT')
       ON CONFLICT (size_mm) DO UPDATE SET size_mm = EXCLUDED.size_mm
     RETURNING product_id`,
    [size],
  );
  return rows[0].product_id as number;
}
