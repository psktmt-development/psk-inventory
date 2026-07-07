import pg from 'pg';
import { config } from '../config.js';

// Return NUMERIC as JS number (safe for the magnitudes in this domain).
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

export type QueryParams = ReadonlyArray<unknown>;

export async function query<T extends pg.QueryResultRow = any>(text: string, params?: QueryParams) {
  return pool.query<T>(text, params as unknown[]);
}

/** Run a set of statements inside a single transaction. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
