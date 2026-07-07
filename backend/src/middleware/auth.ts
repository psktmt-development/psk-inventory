import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { HttpError } from './errors.js';

export type Role = 'Admin' | 'Accounts' | 'Sales' | 'Warehouse' | 'Viewer';

export interface AuthUser {
  user_id: number;
  name: string;
  email: string;
  role: Role;
  linked_sales_person_id: number | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, config.jwtSecret, { expiresIn: config.jwtExpiresIn as any });
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw new HttpError(401, 'Missing bearer token');
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret) as AuthUser & { iat: number; exp: number };
    req.user = {
      user_id: payload.user_id,
      name: payload.name,
      email: payload.email,
      role: payload.role,
      linked_sales_person_id: payload.linked_sales_person_id ?? null,
    };
    next();
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }
}

/** Restrict a route to the given roles (Admin always allowed). */
export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const role = req.user?.role;
    if (!role) throw new HttpError(401, 'Not authenticated');
    if (role === 'Admin' || roles.includes(role)) return next();
    throw new HttpError(403, `Requires role: ${roles.join(', ')}`);
  };
}
