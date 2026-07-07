import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

export const mastersRouter = Router();
mastersRouter.use(requireAuth);

/** Build a small CRUD router for a table. Admin can write; everyone authed can read. */
function crud<T extends z.ZodRawShape>(opts: {
  table: string;
  pk: string;
  createSchema: z.ZodObject<T>;
  columns: string[]; // insertable/updatable columns
  writeRoles?: Parameters<typeof requireRole>;
  listSql?: string; // optional custom SELECT for list/read (joins)
  transform?: (body: any) => Promise<any> | any; // e.g. hash password
  afterWrite?: (row: any, body: any) => Promise<void> | void; // side effects, e.g. reverse relations
}) {
  const r = Router();
  const writeGuard = requireRole(...(opts.writeRoles ?? ['Admin']));
  const selectSql = opts.listSql ?? `SELECT * FROM ${opts.table}`;

  r.get('/', asyncHandler(async (_req, res) => {
    const { rows } = await query(`${selectSql} ORDER BY ${opts.pk}`);
    res.json(rows);
  }));

  r.get('/:id', asyncHandler(async (req, res) => {
    const { rows } = await query(`${selectSql} WHERE ${opts.table}.${opts.pk} = $1`, [req.params.id]);
    if (!rows[0]) throw new HttpError(404, 'Not found');
    res.json(rows[0]);
  }));

  r.post('/', writeGuard, asyncHandler(async (req, res) => {
    const parsed = opts.createSchema.parse(req.body);
    const body = opts.transform ? await opts.transform(parsed) : parsed;
    const cols = opts.columns.filter((c) => body[c] !== undefined);
    const vals = cols.map((c) => body[c]);
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    const { rows } = await query(
      `INSERT INTO ${opts.table} (${cols.join(',')}) VALUES (${placeholders.join(',')}) RETURNING *`,
      vals,
    );
    if (opts.afterWrite) await opts.afterWrite(rows[0], body);
    res.status(201).json(rows[0]);
  }));

  r.put('/:id', writeGuard, asyncHandler(async (req, res) => {
    const parsed = opts.createSchema.partial().parse(req.body);
    const body = opts.transform ? await opts.transform(parsed) : parsed;
    const cols = opts.columns.filter((c) => body[c] !== undefined);
    let row: any;
    if (cols.length > 0) {
      const sets = cols.map((c, i) => `${c} = $${i + 1}`);
      const { rows } = await query(
        `UPDATE ${opts.table} SET ${sets.join(',')} WHERE ${opts.pk} = $${cols.length + 1} RETURNING *`,
        [...cols.map((c) => body[c]), req.params.id],
      );
      row = rows[0];
    } else if (opts.afterWrite) {
      // No own columns changed — allowed when there's a side-effect (e.g. reassigning related rows).
      const { rows } = await query(`SELECT * FROM ${opts.table} WHERE ${opts.pk} = $1`, [req.params.id]);
      row = rows[0];
    } else {
      throw new HttpError(400, 'No fields to update');
    }
    if (!row) throw new HttpError(404, 'Not found');
    if (opts.afterWrite) await opts.afterWrite(row, body);
    res.json(row);
  }));

  r.delete('/:id', writeGuard, asyncHandler(async (req, res) => {
    await query(`DELETE FROM ${opts.table} WHERE ${opts.pk} = $1`, [req.params.id]);
    res.status(204).end();
  }));

  return r;
}

// ---- Factories ----
mastersRouter.use('/factories', crud({
  table: 'factories',
  pk: 'factory_id',
  columns: ['name', 'contact_person', 'phone', 'address', 'gst_number'],
  createSchema: z.object({
    name: z.string().min(1),
    contact_person: z.string().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    gst_number: z.string().optional(),
  }),
}));

// ---- Products ----
mastersRouter.use('/products', crud({
  table: 'products',
  pk: 'product_id',
  columns: ['size_mm', 'unit'],
  createSchema: z.object({ size_mm: z.number().int().positive(), unit: z.string().default('MT') }),
}));

// ---- Sales People ----
mastersRouter.use('/sales-people', crud({
  table: 'sales_people',
  pk: 'sales_person_id',
  columns: ['name', 'phone', 'area'],
  // Each salesman carries the list of dealers currently mapped to them.
  listSql: `SELECT sales_people.*,
              COALESCE((SELECT json_agg(json_build_object('dealer_id', d.dealer_id, 'name', d.name) ORDER BY d.name)
                          FROM dealers d WHERE d.sales_person_id = sales_people.sales_person_id), '[]') AS dealers
              FROM sales_people`,
  createSchema: z.object({
    name: z.string().min(1),
    phone: z.string().optional(),
    area: z.string().optional(),
    dealer_ids: z.array(z.number().int()).optional(),
  }),
  // Reassign the salesman's dealers (reverse side of dealers.sales_person_id).
  afterWrite: async (row, body) => {
    if (body.dealer_ids === undefined) return;
    const spId = row.sales_person_id;
    const ids: number[] = body.dealer_ids ?? [];
    // Drop dealers no longer mapped to this salesman…
    await query(`UPDATE dealers SET sales_person_id = NULL WHERE sales_person_id = $1 AND NOT (dealer_id = ANY($2::int[]))`, [spId, ids]);
    // …and (re)map the selected ones to them.
    if (ids.length) await query(`UPDATE dealers SET sales_person_id = $1 WHERE dealer_id = ANY($2::int[])`, [spId, ids]);
  },
}));

// ---- Dealers ----
mastersRouter.use('/dealers', crud({
  table: 'dealers',
  pk: 'dealer_id',
  columns: ['name', 'contact_person', 'phone', 'address', 'area', 'sales_person_id'],
  listSql: `SELECT dealers.*, sp.name AS sales_person_name FROM dealers
              LEFT JOIN sales_people sp ON sp.sales_person_id = dealers.sales_person_id`,
  createSchema: z.object({
    name: z.string().min(1),
    contact_person: z.string().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    area: z.string().optional(),
    sales_person_id: z.number().int().nullable().optional(),
  }),
}));

// ---- Users (Admin only; hash password) ----
mastersRouter.use('/users', crud({
  table: 'users',
  pk: 'user_id',
  columns: ['name', 'email', 'password_hash', 'role', 'linked_sales_person_id', 'is_active'],
  listSql: `SELECT user_id, name, email, role, linked_sales_person_id, is_active, created_at FROM users`,
  writeRoles: ['Admin'],
  createSchema: z.object({
    name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(4).optional(),
    role: z.enum(['Admin', 'Accounts', 'Sales', 'Warehouse', 'Viewer']),
    linked_sales_person_id: z.number().int().nullable().optional(),
    is_active: z.boolean().optional(),
  }),
  transform: async (body) => {
    if (body.password) {
      body.password_hash = await bcrypt.hash(body.password, 10);
      delete body.password;
    }
    return body;
  },
}));
