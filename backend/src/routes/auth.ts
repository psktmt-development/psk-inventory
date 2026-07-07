import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db/pool.js';
import { asyncHandler, HttpError } from '../middleware/errors.js';
import { requireAuth, signToken, type AuthUser } from '../middleware/auth.js';

export const authRouter = Router();

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const { rows } = await query(
      `SELECT user_id, name, email, password_hash, role, linked_sales_person_id, is_active
         FROM users WHERE lower(email) = lower($1)`,
      [email],
    );
    const u = rows[0];
    if (!u || !u.is_active) throw new HttpError(401, 'Invalid credentials');
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) throw new HttpError(401, 'Invalid credentials');
    const user: AuthUser = {
      user_id: u.user_id,
      name: u.name,
      email: u.email,
      role: u.role,
      linked_sales_person_id: u.linked_sales_person_id,
    };
    res.json({ token: signToken(user), user });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: req.user });
  }),
);
