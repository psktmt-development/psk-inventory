import axios from 'axios';

// Same-origin '/api' by default (local dev via Vite proxy). In production set
// VITE_API_URL to the backend's public URL, e.g. https://psk-backend.vercel.app/api
export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL ?? '/api' });

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('psk_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401 && !location.pathname.startsWith('/login')) {
      localStorage.removeItem('psk_token');
      localStorage.removeItem('psk_user');
      location.href = '/login';
    }
    return Promise.reject(err);
  },
);

export const apiError = (e: any): string =>
  e?.response?.data?.error ?? e?.message ?? 'Request failed';

// ---- shared money / number formatting (Indian numbering system) ----

// Exact rupees with Indian comma grouping, e.g. ₹69,96,132 — use in tables.
export const inr = (n: number | string | null | undefined) =>
  n == null ? '—' : `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

// Human-readable rupees in Lakh/Crore, e.g. ₹69.96 L, ₹1.24 Cr — use in summary cards.
export const inrShort = (n: number | string | null | undefined) => {
  if (n == null) return '—';
  const x = Number(n), a = Math.abs(x);
  if (a >= 1e7) return `₹${(x / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`;
  if (a >= 1e5) return `₹${(x / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 2 })} L`;
  return `₹${x.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

// Compact number for chart axes (no ₹), e.g. 70L, 1.2Cr, 5K.
export const compactINR = (n: number | string | null | undefined) => {
  const x = Number(n ?? 0), a = Math.abs(x);
  if (a >= 1e7) return `${(x / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 1 })}Cr`;
  if (a >= 1e5) return `${(x / 1e5).toLocaleString('en-IN', { maximumFractionDigits: 1 })}L`;
  if (a >= 1e3) return `${(x / 1e3).toLocaleString('en-IN', { maximumFractionDigits: 0 })}K`;
  return String(x);
};

// Plain number with Indian grouping + fixed decimals, e.g. 1,63,080.00
export const num = (n: number | string | null | undefined, dp = 2) =>
  n == null ? '—' : Number(n).toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });

// Quantity in MT with Indian grouping, up to 2 decimals, e.g. 1,63,080.08 MT.
export const mt = (n: number | string | null | undefined) =>
  n == null ? '—' : `${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })} MT`;

// Format a date as DD-MM-YYYY. Accepts a 'YYYY-MM-DD' string (or ISO/Date) and
// reads the calendar parts directly to avoid any timezone shifting.
export const fmtDate = (d: string | Date | null | undefined): string => {
  if (!d) return '—';
  const s = typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
  const [y, m, day] = s.split('-');
  return y && m && day ? `${day}-${m}-${y}` : String(d);
};

// Consistent, accessible categorical palette (used across all charts)
export const PALETTE = ['#2563eb', '#16a34a', '#f59e0b', '#db2777', '#7c3aed', '#0891b2', '#dc2626'];
export const STATUS_COLORS: Record<string, string> = {
  Pending: '#f59e0b',
  Dispatched: '#2563eb',
  Delivered: '#16a34a',
  Cancelled: '#9ca3af',
  Booked: '#9ca3af',
  'Under-Loading': '#f59e0b',
  Available: '#16a34a',
  Closed: '#6b7280',
  Paid: '#16a34a',
  'Partially Paid': '#f59e0b',
  Direct: '#2563eb',
  Credit: '#db2777',
};
