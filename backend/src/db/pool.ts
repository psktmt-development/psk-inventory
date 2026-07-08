import pg from 'pg';
import { config } from '../config.js';

// Return NUMERIC as JS number (safe for the magnitudes in this domain).
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

// Return DATE (OID 1082) as the raw 'YYYY-MM-DD' string. The default parser turns
// it into a JS Date at the server's local midnight, which then shifts back a day
// when JSON-serialised to UTC (e.g. IST +5:30 → previous day). Keeping it a string
// preserves the exact calendar date the user picked.
pg.types.setTypeParser(1082, (v) => v);

// Remote managed Postgres (Supabase, Neon, etc.) requires SSL; local dev does not.
// rejectUnauthorized:false keeps it working through connection poolers whose cert
// chain isn't in the default trust store.
function needsSsl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host !== 'localhost' && host !== '127.0.0.1';
  } catch {
    return false;
  }
}

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: needsSsl(config.databaseUrl) ? { rejectUnauthorized: false } : undefined,
});

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
