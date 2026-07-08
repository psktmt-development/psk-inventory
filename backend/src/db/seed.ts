import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import bcrypt from 'bcryptjs';
import { parse } from 'csv-parse/sync';
import { pool, withTransaction } from './pool.js';
import { fifoAllocate } from '../services/allocation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', '..', 'data');

/** Load rows from data/<name>.csv if it exists, else return the fallback. */
function fromCsvOrDefault<T>(name: string, fallback: T[]): T[] {
  const file = join(dataDir, `${name}.csv`);
  if (existsSync(file)) {
    const rows = parse(readFileSync(file, 'utf8'), { columns: true, skip_empty_lines: true, trim: true });
    console.log(`  · loaded ${rows.length} rows from data/${name}.csv`);
    return rows as T[];
  }
  return fallback;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

async function main() {
  console.log('Seeding master data…');
  await withTransaction(async (c) => {
    // wipe transactional + master rows (keep schema)
    await c.query(`TRUNCATE dealer_payments, dispatch_details, sale_allocations, sale_items, sales,
      supplier_payments, booking_items, bookings, users, dealers, sales_people, products, factories RESTART IDENTITY CASCADE`);

    // Single default product — size selection removed app-wide, everything is 12 mm
    await c.query(`INSERT INTO products (size_mm, unit) VALUES (12,'MT')`);

    // Factories
    const factories = fromCsvOrDefault('factories', [
      { name: 'Birla', contact_person: 'R. Sharma', phone: '9820011111', gst_number: '27AAAAA0000A1Z5', address: 'Mumbai' },
      { name: 'Ultra', contact_person: 'S. Rao', phone: '9820022222', gst_number: '27BBBBB0000B1Z5', address: 'Pune' },
      { name: 'Radha Jindal', contact_person: 'M. Jindal', phone: '9820033333', gst_number: '27CCCCC0000C1Z5', address: 'Nagpur' },
      { name: 'Sugna', contact_person: 'K. Naidu', phone: '9820044444', gst_number: '27DDDDD0000D1Z5', address: 'Hyderabad' },
      { name: 'Keshree', contact_person: 'A. Keshree', phone: '9820055555', gst_number: '27EEEEE0000E1Z5', address: 'Raipur' },
    ]);
    for (const f of factories) {
      await c.query(
        `INSERT INTO factories (name, contact_person, phone, address, gst_number) VALUES ($1,$2,$3,$4,$5)`,
        [f.name, f.contact_person ?? null, f.phone ?? null, f.address ?? null, f.gst_number ?? null],
      );
    }

    // Sales people (area-wise)
    const salesPeople = fromCsvOrDefault('sales_people', [
      { name: 'Anil Kumar', phone: '9000000001', area: 'North Zone' },
      { name: 'Ravi Verma', phone: '9000000002', area: 'South Zone' },
      { name: 'Sunil Patil', phone: '9000000003', area: 'West Zone' },
    ]);
    for (const s of salesPeople) {
      await c.query(`INSERT INTO sales_people (name, phone, area) VALUES ($1,$2,$3)`, [s.name, s.phone ?? null, s.area ?? null]);
    }

    // Dealers (fixed area → sales-person mapping)
    const dealers = fromCsvOrDefault<{
      name: string; contact_person?: string; phone?: string; address?: string;
      area?: string; sales_person_id?: number | string;
    }>('dealers', [
      { name: 'Sri Ganesh Traders', contact_person: 'Ganesh', phone: '9111100001', area: 'North Zone', sales_person_id: 1 },
      { name: 'Maruti Steels', contact_person: 'Mahesh', phone: '9111100002', area: 'North Zone', sales_person_id: 1 },
      { name: 'Lakshmi Iron', contact_person: 'Lakshmi', phone: '9111100003', area: 'South Zone', sales_person_id: 2 },
      { name: 'Konark Hardware', contact_person: 'Rohit', phone: '9111100004', area: 'South Zone', sales_person_id: 2 },
      { name: 'Deccan Build Mart', contact_person: 'Prakash', phone: '9111100005', area: 'West Zone', sales_person_id: 3 },
    ]);
    for (const d of dealers) {
      await c.query(
        `INSERT INTO dealers (name, contact_person, phone, address, area, sales_person_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [d.name, d.contact_person ?? null, d.phone ?? null, d.address ?? null, d.area ?? null,
         d.sales_person_id ? Number(d.sales_person_id) : null],
      );
    }

    // Users (one per role)
    const users: [string, string, string, string, number | null][] = [
      ['Admin User', 'admin@psk.com', 'admin123', 'Admin', null],
      ['Accounts User', 'accounts@psk.com', 'accounts123', 'Accounts', null],
      ['Sales User', 'sales@psk.com', 'sales123', 'Sales', 1],
      ['Warehouse User', 'warehouse@psk.com', 'ware123', 'Warehouse', null],
      ['Viewer User', 'viewer@psk.com', 'viewer123', 'Viewer', null],
    ];
    for (const [name, email, pw, role, sp] of users) {
      await c.query(
        `INSERT INTO users (name, email, password_hash, role, linked_sales_person_id) VALUES ($1,$2,$3,$4,$5)`,
        [name, email, await bcrypt.hash(pw, 10), role, sp],
      );
    }
  });

  console.log('Seeding bookings (lots)…');
  // helper maps
  const { rows: prods } = await pool.query(`SELECT product_id, size_mm FROM products`);
  // Size selection removed — every blueprint size maps to the single default product.
  const size = (_mm: number) => prods[0].product_id;

  // Booking blueprints: [factoryId, adminUser=1, date, [ [sizeMm, qty, rate, status, receivedDaysAgo] ] ]
  const bookings: [number, string, [number, number, number, string, number | null][]][] = [
    [1, daysAgo(40), [[12, 100, 52000, 'Available', 35], [16, 60, 51500, 'Available', 30], [20, 40, 51000, 'Under-Loading', null]]],
    [2, daysAgo(30), [[10, 80, 50500, 'Available', 25], [12, 120, 50800, 'Available', 22]]],
    [3, daysAgo(25), [[16, 70, 51200, 'Available', 18], [25, 30, 52500, 'Booked', null]]],
    [4, daysAgo(15), [[8, 50, 50000, 'Available', 10], [12, 90, 50600, 'Under-Loading', null]]],
    [5, daysAgo(8), [[20, 60, 51800, 'Available', 4], [32, 25, 53000, 'Booked', null]]],
  ];

  for (const [factoryId, date, items] of bookings) {
    await withTransaction(async (c) => {
      const { rows: b } = await c.query(
        `INSERT INTO bookings (factory_id, booking_date, created_by) VALUES ($1,$2,1) RETURNING booking_id`,
        [factoryId, date],
      );
      for (const [mm, qty, rate, , recvAgo] of items) {
        // All booked stock is immediately Available for sale; received_date drives FIFO order.
        await c.query(
          `INSERT INTO booking_items (booking_id, factory_id, product_id, booked_qty, purchase_rate, status, received_date)
           VALUES ($1,$2,$3,$4,$5,'Available',$6)`,
          [
            b[0].booking_id, factoryId, size(mm), qty, rate,
            recvAgo != null ? daysAgo(recvAgo) : date,
          ],
        );
      }
    });
  }

  console.log('Seeding sales (FIFO allocation)…');
  // [dealerId, paymentType, invoice, dateDaysAgo, [ [factoryId, sizeMm, qty, rate] ]]
  const salesPlan: [number, 'Direct' | 'Credit', string, number, [number, number, number, number][]][] = [
    [1, 'Credit', 'PSK-1001', 20, [[1, 12, 30, 54000], [1, 16, 15, 53500]]],
    [3, 'Direct', 'PSK-1002', 15, [[2, 12, 40, 53000]]],
    [5, 'Credit', 'PSK-1003', 10, [[3, 16, 20, 53800], [4, 8, 10, 52500]]],
    [2, 'Direct', 'PSK-1004', 5, [[2, 10, 25, 52800]]],
    [4, 'Credit', 'PSK-1005', 2, [[5, 20, 15, 54200]]],
  ];

  const saleIds: number[] = [];
  for (const [dealerId, ptype, invoice, dAgo, items] of salesPlan) {
    const saleId = await withTransaction(async (c) => {
      const { rows: d } = await c.query(`SELECT sales_person_id FROM dealers WHERE dealer_id=$1`, [dealerId]);
      const { rows: s } = await c.query(
        `INSERT INTO sales (dealer_id, sales_person_id, sale_date, sale_invoice_no, payment_type, credit_days, credit_date, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,
                 CASE WHEN $6::int IS NOT NULL THEN $3::date + $6::int ELSE NULL END, 3) RETURNING sale_id`,
        [dealerId, d[0].sales_person_id, daysAgo(dAgo), invoice, ptype, ptype === 'Credit' ? 30 : null],
      );
      const sid = s[0].sale_id;
      for (const [factoryId, mm, qty, rate] of items) {
        const { rows: si } = await c.query(
          `INSERT INTO sale_items (sale_id, factory_id, product_id, sale_qty, sale_rate, purchase_invoice_no) VALUES ($1,$2,$3,$4,$5,$6) RETURNING sale_item_id`,
          [sid, factoryId, size(mm), qty, rate, `PINV-${factoryId}-${sid}`],
        );
        await fifoAllocate(c, si[0].sale_item_id, factoryId, size(mm), qty);
      }
      return sid;
    });
    saleIds.push(saleId);
  }

  console.log('Seeding dispatch + payments…');
  await withTransaction(async (c) => {
    // Dispatch first two sales; deliver the first
    await c.query(
      `INSERT INTO dispatch_details (sale_id, truck_number, driver_name, driver_phone, dispatch_date, delivery_location, delivery_status, delivered_date)
       VALUES ($1,'MH12AB1234','Ramesh','9500000001',$2,'North Zone Yard','Delivered',$3)`,
      [saleIds[0], daysAgo(18), daysAgo(16)],
    );
    await c.query(`UPDATE sales SET status='Delivered' WHERE sale_id=$1`, [saleIds[0]]);
    await c.query(
      `INSERT INTO dispatch_details (sale_id, truck_number, driver_name, driver_phone, dispatch_date, delivery_location, delivery_status)
       VALUES ($1,'MH14CD5678','Suresh','9500000002',$2,'South Zone Yard','In-Transit')`,
      [saleIds[1], daysAgo(12)],
    );
    await c.query(`UPDATE sales SET status='Dispatched' WHERE sale_id=$1`, [saleIds[1]]);

    // Dealer payments (partial + full)
    await c.query(`INSERT INTO dealer_payments (dealer_id, sale_id, amount, payment_date, payment_mode, reference_number, created_by)
                   VALUES (1,$1,1000000,$2,'Bank Transfer','UTR12345',2)`, [saleIds[0], daysAgo(14)]);
    await c.query(`INSERT INTO dealer_payments (dealer_id, sale_id, amount, payment_date, payment_mode, reference_number, created_by)
                   SELECT 3,$1,total_amount,$2,'UPI','UPI98765',2 FROM sales WHERE sale_id=$1`, [saleIds[1], daysAgo(10)]);

    // Supplier payments
    await c.query(`INSERT INTO supplier_payments (factory_id, booking_id, amount, payment_date, payment_mode, reference_number, created_by)
                   VALUES (1,1,3000000,$1,'Bank Transfer','SUP-001',2)`, [daysAgo(20)]);
    await c.query(`INSERT INTO supplier_payments (factory_id, booking_id, amount, payment_date, payment_mode, reference_number, created_by)
                   VALUES (2,2,2500000,$1,'Cheque','CHQ-551',2)`, [daysAgo(12)]);
  });

  console.log('✔ Seed complete.');
  await pool.end();
}

main().catch(async (e) => {
  console.error('✖ Seed failed:', e);
  await pool.end();
  process.exitCode = 1;
});
