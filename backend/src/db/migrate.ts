import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DROP_SQL = `
DROP TABLE IF EXISTS dealer_payments, dispatch_details, sale_allocations, sale_items, sales,
  supplier_payments, booking_items, bookings, users, dealers, sales_people, products, factories CASCADE;
DROP TYPE IF EXISTS user_role, booking_status, payment_type, sale_status, payment_status, payment_mode, delivery_status CASCADE;
`;

async function main() {
  const drop = process.argv.includes('--drop');
  try {
    if (drop) {
      console.log('Dropping existing objects…');
      await pool.query(DROP_SQL);
    }
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
    console.log('Applying schema…');
    await pool.query(schema);
    console.log('✔ Migration complete.');
  } catch (err) {
    console.error('✖ Migration failed:', err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
