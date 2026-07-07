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
