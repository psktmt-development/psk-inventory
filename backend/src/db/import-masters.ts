import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import bcrypt from 'bcryptjs';
import { parse } from 'csv-parse/sync';
import { pool, withTransaction } from './pool.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', '..', 'data');

function readCsv(name: string): any[] {
  const file = join(dataDir, `${name}.csv`);
  if (!existsSync(file)) throw new Error(`Missing data/${name}.csv`);
  return parse(readFileSync(file, 'utf8'), { columns: true, skip_empty_lines: true, trim: true });
}

// Default logins — recreated only if missing, so an import never locks anyone out.
const DEFAULT_USERS: [string, string, string, string][] = [
  ['Admin User', 'admin@psk.com', 'admin123', 'Admin'],
  ['Accounts User', 'accounts@psk.com', 'accounts123', 'Accounts'],
  ['Sales User', 'sales@psk.com', 'sales123', 'Sales'],
  ['Warehouse User', 'warehouse@psk.com', 'ware123', 'Warehouse'],
  ['Viewer User', 'viewer@psk.com', 'viewer123', 'Viewer'],
];

/**
 * Load the real factories, sales team and dealers from data/*.csv.
 *
 * Truncation here is done SURGICALLY so it never cascades into `users`
 * (users.linked_sales_person_id references sales_people — a plain
 * `TRUNCATE sales_people CASCADE` would wipe users and every created_by row).
 * We null that link first, clear only the intended tables, and always
 * re-ensure the default logins exist.
 */
async function main() {
  const factories = existsSync(join(dataDir, 'factories.csv')) ? readCsv('factories') : null;
  const salespeople = readCsv('sales_people');
  const dealers = readCsv('dealers');
  console.log(`Importing ${factories ? factories.length + ' factories, ' : ''}${salespeople.length} sales people, ${dealers.length} dealers…`);

  await withTransaction(async (c) => {
    // 1. Clear the sales-side transactions (self-contained chain; does not touch users).
    await c.query(`TRUNCATE dealer_payments, dispatch_details, sale_allocations, sale_items, sales RESTART IDENTITY CASCADE`);

    // 2. Detach users from sales_people so replacing sales_people won't cascade into users.
    await c.query(`UPDATE users SET linked_sales_person_id = NULL`);

    // 3. Replace dealers, then sales_people (dealers reference sales_people).
    await c.query(`TRUNCATE dealers RESTART IDENTITY CASCADE`);
    await c.query(`TRUNCATE sales_people RESTART IDENTITY CASCADE`);

    // 4. Optionally replace factories — this intentionally clears bookings/stock too,
    //    but the cascade stays within factory-linked tables (never reaches users).
    if (factories) {
      await c.query(`TRUNCATE supplier_payments, booking_items, bookings, factories RESTART IDENTITY CASCADE`);
      for (const f of factories) {
        await c.query(`INSERT INTO factories (name, contact_person, phone, address, gst_number) VALUES ($1,$2,$3,$4,$5)`,
          [f.name, f.contact_person || null, f.phone || null, f.address || null, f.gst_number || null]);
      }
    } else {
      // Keep factories/bookings; restore lot balances the txn truncation didn't (trigger doesn't fire on TRUNCATE).
      await c.query(`UPDATE booking_items SET balance_qty = booked_qty,
                        status = CASE WHEN status = 'Closed' THEN 'Available'::booking_status ELSE status END`);
    }

    // 5. sales_people — CSV order becomes ids 1..N (dealers reference these ids).
    for (const s of salespeople) {
      await c.query(`INSERT INTO sales_people (name, phone, area) VALUES ($1,$2,$3)`,
        [s.name, s.phone || null, s.area || null]);
    }
    for (const d of dealers) {
      await c.query(
        `INSERT INTO dealers (name, contact_person, phone, address, area, sales_person_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [d.name, d.contact_person || null, d.phone || null, d.address || null, d.area || null,
         d.sales_person_id ? Number(d.sales_person_id) : null],
      );
    }

    // 6. Ensure default logins exist (no-op if already present).
    for (const [name, email, pw, role] of DEFAULT_USERS) {
      await c.query(
        `INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4)
         ON CONFLICT (email) DO NOTHING`,
        [name, email, await bcrypt.hash(pw, 10), role],
      );
    }
    // Re-link the Sales demo user to the first sales person for scoped views.
    await c.query(`UPDATE users SET linked_sales_person_id = 1 WHERE email='sales@psk.com' AND linked_sales_person_id IS NULL`);
  });

  const [{ rows: f }, { rows: sp }, { rows: d }, { rows: u }] = await Promise.all([
    pool.query(`SELECT COUNT(*)::int c FROM factories`),
    pool.query(`SELECT COUNT(*)::int c FROM sales_people`),
    pool.query(`SELECT COUNT(*)::int c FROM dealers`),
    pool.query(`SELECT COUNT(*)::int c FROM users`),
  ]);
  console.log(`✔ Imported. factories=${f[0].c} sales_people=${sp[0].c} dealers=${d[0].c} users=${u[0].c}`);
  await pool.end();
}

main().catch(async (e) => { console.error('✖ Import failed:', e); await pool.end(); process.exitCode = 1; });
