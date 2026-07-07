import type { PoolClient } from 'pg';

export interface AllocationResult {
  booking_item_id: number;
  booking_id: number;
  allocated_qty: number;
  received_date: string | null;
  purchase_rate: number;
}

/**
 * FIFO-allocate `qty` of (factory, product) against Available booking lots.
 *
 * - Draws from the oldest `received_date` first (RULE 2 / FIFO).
 * - Only touches lots of the SAME factory + product (RULE 1 — no cross-brand).
 * - Only Available lots (RULE 3); the DB trigger is the final guard.
 * - Splits across multiple lots when one lot's balance is insufficient.
 * - Raises if the factory+size does not have enough Available stock — it will
 *   NOT fall back to another factory.
 *
 * Must be called inside a transaction; rows are locked FOR UPDATE.
 */
export async function fifoAllocate(
  client: PoolClient,
  saleItemId: number,
  factoryId: number,
  productId: number,
  qty: number,
): Promise<AllocationResult[]> {
  const { rows: lots } = await client.query(
    `SELECT booking_item_id, booking_id, balance_qty, received_date, purchase_rate
       FROM booking_items
      WHERE factory_id = $1 AND product_id = $2 AND status = 'Available' AND balance_qty > 0
      ORDER BY received_date ASC NULLS LAST, booking_item_id ASC
      FOR UPDATE`,
    [factoryId, productId],
  );

  const available = lots.reduce((s, l) => s + Number(l.balance_qty), 0);
  if (available + 1e-9 < qty) {
    throw new AllocationError(
      `Insufficient stock for factory #${factoryId}, product #${productId}: ` +
        `need ${qty} MT but only ${available} MT is Available. No cross-brand substitution is allowed.`,
    );
  }

  const results: AllocationResult[] = [];
  let remaining = qty;
  for (const lot of lots) {
    if (remaining <= 1e-9) break;
    const take = Math.min(remaining, Number(lot.balance_qty));
    if (take <= 0) continue;
    await client.query(
      `INSERT INTO sale_allocations (sale_item_id, booking_item_id, allocated_qty) VALUES ($1, $2, $3)`,
      [saleItemId, lot.booking_item_id, take],
    );
    results.push({
      booking_item_id: lot.booking_item_id,
      booking_id: lot.booking_id,
      allocated_qty: take,
      received_date: lot.received_date,
      purchase_rate: Number(lot.purchase_rate),
    });
    remaining -= take;
  }
  return results;
}

export class AllocationError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'AllocationError';
  }
}
