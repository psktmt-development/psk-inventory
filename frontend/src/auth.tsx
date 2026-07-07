import { createContext, useContext, useState, type ReactNode } from 'react';
import { api } from './api';

export type Role = 'Admin' | 'Accounts' | 'Sales' | 'Warehouse' | 'Viewer';
export interface User {
  user_id: number;
  name: string;
  email: string;
  role: Role;
  linked_sales_person_id: number | null;
}

interface AuthCtx {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  can: (...roles: Role[]) => boolean;
}

const Ctx = createContext<AuthCtx>(null as any);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem('psk_user');
    return raw ? JSON.parse(raw) : null;
  });

  const login = async (email: string, password: string) => {
    const { data } = await api.post('/auth/login', { email, password });
    localStorage.setItem('psk_token', data.token);
    localStorage.setItem('psk_user', JSON.stringify(data.user));
    setUser(data.user);
  };

  const logout = () => {
    localStorage.removeItem('psk_token');
    localStorage.removeItem('psk_user');
    setUser(null);
  };

  // Admin can do everything; otherwise role must be in the allowed list.
  const can = (...roles: Role[]) => !!user && (user.role === 'Admin' || roles.includes(user.role));

  return <Ctx.Provider value={{ user, login, logout, can }}>{children}</Ctx.Provider>;
}
