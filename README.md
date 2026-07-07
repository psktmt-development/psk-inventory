# PSK — TMT Bar Trading Monitoring Dashboard

Full-stack, lot-based inventory & sales monitoring for a TMT steel-bar trading company.

- **backend/** — Node.js + Express + TypeScript REST API, PostgreSQL (node-postgres), JWT auth, RBAC, FIFO lot allocation.
- **frontend/** — React + TypeScript + Vite + Ant Design + Recharts.

## Core concept — lot-based booking

A **Booking** is a commitment with one factory on one date and can contain several sizes. Each size is a **Booking Item** (an independent lot) with its own qty, rate, invoice and running `balance_qty`. Lifecycle: **Booked → Under-Loading → Available → Closed**. Only **Available** lots can be sold. Sales draw down lots **FIFO** (oldest `received_date` first) and can **only** draw from the **same factory + same size** — never a cross-brand substitution.

## Quick start

```bash
# 0. Ensure PostgreSQL is running and create the database
createdb psk_inventory

# 1. Backend
cd backend
cp .env.example .env          # edit DATABASE_URL / JWT_SECRET if needed
npm install
npm run migrate               # create schema + constraints + triggers
npm run seed                  # load masters + a small demo dataset
npm run dev                   # http://localhost:4000

# 2. Frontend (new terminal)
cd frontend
npm install
npm run dev                   # http://localhost:5173
```

### Demo logins (seeded)

| Role      | Email                  | Password    |
|-----------|------------------------|-------------|
| Admin     | admin@psk.com          | admin123    |
| Accounts  | accounts@psk.com       | accounts123 |
| Sales     | sales@psk.com          | sales123    |
| Warehouse | warehouse@psk.com      | ware123     |
| Viewer    | viewer@psk.com         | viewer123   |

## Key business rules (enforced in DB triggers + app services)

1. **Factory lock** — an allocation's booking item must match the sale item's `factory_id` + `product_id`.
2. **FIFO** — allocate oldest `received_date` Available lot first.
3. **Available-only** — cannot allocate against Booked / Under-Loading / Closed lots.
4. **Credit control** — Credit sales past the dealer's `credit_limit` warn and allow override (overage logged).
5. **Partial payments** — many payments per booking/sale; parent totals recomputed on each insert.
6. **Dispatch required** — a sale can't become Dispatched without a dispatch record.
7. **Auto sales-person** — always taken from the dealer's fixed mapping.
8. **Never negative stock** — over-allocation is blocked.

