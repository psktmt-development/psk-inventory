-- =====================================================================
-- PSK TMT Bar Trading — schema, constraints & lot-rule triggers
-- Idempotent-ish: run migrate.ts with --drop to rebuild from scratch.
-- =====================================================================

-- ---------- ENUM TYPES ----------
DO $$ BEGIN
  CREATE TYPE user_role        AS ENUM ('Admin','Accounts','Sales','Warehouse','Viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE booking_status   AS ENUM ('Booked','Under-Loading','Available','Closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE payment_type     AS ENUM ('Direct','Credit');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE sale_status      AS ENUM ('Pending','Dispatched','Delivered','Cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE payment_status   AS ENUM ('Pending','Partially Paid','Paid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE payment_mode     AS ENUM ('Cash','Bank Transfer','Cheque','UPI');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE delivery_status  AS ENUM ('In-Transit','Delivered');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- MASTER DATA ----------
CREATE TABLE IF NOT EXISTS factories (
  factory_id      SERIAL PRIMARY KEY,
  name            VARCHAR(120) NOT NULL UNIQUE,
  contact_person  VARCHAR(120),
  phone           VARCHAR(30),
  address         TEXT,
  gst_number      VARCHAR(20),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  product_id      SERIAL PRIMARY KEY,
  size_mm         INTEGER NOT NULL UNIQUE,          -- 8/10/12/16/20/25/32
  unit            VARCHAR(10) NOT NULL DEFAULT 'MT',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_people (
  sales_person_id SERIAL PRIMARY KEY,
  name            VARCHAR(120) NOT NULL,
  phone           VARCHAR(30),
  area            VARCHAR(120),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dealers (
  dealer_id           SERIAL PRIMARY KEY,
  name                VARCHAR(160) NOT NULL,
  contact_person      VARCHAR(120),
  phone               VARCHAR(30),
  address             TEXT,
  area                VARCHAR(120),
  sales_person_id     INTEGER REFERENCES sales_people(sales_person_id),  -- fixed area mapping
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  user_id                 SERIAL PRIMARY KEY,
  name                    VARCHAR(120) NOT NULL,
  email                   VARCHAR(160) NOT NULL UNIQUE,
  password_hash           VARCHAR(200) NOT NULL,
  role                    user_role NOT NULL DEFAULT 'Viewer',
  linked_sales_person_id  INTEGER REFERENCES sales_people(sales_person_id),
  is_active               BOOLEAN NOT NULL DEFAULT true,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- BOOKINGS ----------
CREATE TABLE IF NOT EXISTS bookings (
  booking_id    SERIAL PRIMARY KEY,
  factory_id    INTEGER NOT NULL REFERENCES factories(factory_id),
  booking_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  brand         VARCHAR(120),
  created_by    INTEGER REFERENCES users(user_id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS booking_items (
  booking_item_id     SERIAL PRIMARY KEY,
  booking_id          INTEGER NOT NULL REFERENCES bookings(booking_id) ON DELETE CASCADE,
  factory_id          INTEGER NOT NULL REFERENCES factories(factory_id), -- denormalised for the factory-lock check
  product_id          INTEGER NOT NULL REFERENCES products(product_id),
  booked_qty          NUMERIC(14,3) NOT NULL CHECK (booked_qty > 0),
  purchase_rate       NUMERIC(14,2) NOT NULL DEFAULT 0,
  status              booking_status NOT NULL DEFAULT 'Available',  -- booked stock is immediately sellable
  dispatched_date     DATE,
  received_date       DATE,
  balance_qty         NUMERIC(14,3) NOT NULL DEFAULT 0,   -- booked_qty - sum(allocations); maintained by trigger
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (balance_qty >= 0),
  CHECK (balance_qty <= booked_qty)
);
CREATE INDEX IF NOT EXISTS idx_bi_fifo ON booking_items (factory_id, product_id, status, received_date, booking_item_id);

-- ---------- SUPPLIER PAYMENTS ----------
CREATE TABLE IF NOT EXISTS supplier_payments (
  payment_id       SERIAL PRIMARY KEY,
  factory_id       INTEGER NOT NULL REFERENCES factories(factory_id),
  booking_id       INTEGER REFERENCES bookings(booking_id),   -- nullable: general settlement
  amount           NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_mode     payment_mode NOT NULL DEFAULT 'Bank Transfer',
  reference_number VARCHAR(80),
  created_by       INTEGER REFERENCES users(user_id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- SALES ----------
CREATE TABLE IF NOT EXISTS sales (
  sale_id         SERIAL PRIMARY KEY,
  dealer_id       INTEGER NOT NULL REFERENCES dealers(dealer_id),
  sales_person_id INTEGER REFERENCES sales_people(sales_person_id),  -- auto-filled from dealer
  sale_date       DATE NOT NULL DEFAULT CURRENT_DATE,
  sale_invoice_no VARCHAR(60),
  payment_type    payment_type NOT NULL DEFAULT 'Direct',
  credit_days     INTEGER,                           -- credit period fixed on THIS sale order (Credit only)
  credit_date     DATE,                              -- due date = sale_date + credit_days (Credit only)
  status          sale_status NOT NULL DEFAULT 'Pending',
  total_amount    NUMERIC(14,2) NOT NULL DEFAULT 0,   -- derived from sale_items
  amount_received NUMERIC(14,2) NOT NULL DEFAULT 0,   -- derived from dealer_payments
  balance_due     NUMERIC(14,2) NOT NULL DEFAULT 0,   -- total_amount - amount_received
  payment_stat    payment_status NOT NULL DEFAULT 'Pending',
  created_by      INTEGER REFERENCES users(user_id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sales_dealer ON sales (dealer_id);

CREATE TABLE IF NOT EXISTS sale_items (
  sale_item_id  SERIAL PRIMARY KEY,
  sale_id       INTEGER NOT NULL REFERENCES sales(sale_id) ON DELETE CASCADE,
  factory_id    INTEGER NOT NULL REFERENCES factories(factory_id),
  product_id    INTEGER NOT NULL REFERENCES products(product_id),
  size_mm       INTEGER,             -- size label: stock is sizeless, sales are recorded size-wise
  sale_qty      NUMERIC(14,3) NOT NULL CHECK (sale_qty > 0),
  sale_rate     NUMERIC(14,2),       -- optional sale price; filled/adjusted later
  purchase_rate NUMERIC(14,2),       -- optional actual size-wise purchase cost; filled/adjusted later
  purchase_invoice_no VARCHAR(60),  -- brand's purchase invoice: we buy from the factory when the sale order comes
  line_total    NUMERIC(14,2) GENERATED ALWAYS AS (sale_qty * sale_rate) STORED
);
CREATE INDEX IF NOT EXISTS idx_si_sale ON sale_items (sale_id);

CREATE TABLE IF NOT EXISTS sale_allocations (
  allocation_id   SERIAL PRIMARY KEY,
  sale_item_id    INTEGER NOT NULL REFERENCES sale_items(sale_item_id) ON DELETE CASCADE,
  booking_item_id INTEGER NOT NULL REFERENCES booking_items(booking_item_id),
  allocated_qty   NUMERIC(14,3) NOT NULL CHECK (allocated_qty > 0)
);
CREATE INDEX IF NOT EXISTS idx_alloc_bi ON sale_allocations (booking_item_id);
CREATE INDEX IF NOT EXISTS idx_alloc_si ON sale_allocations (sale_item_id);

-- ---------- DISPATCH ----------
CREATE TABLE IF NOT EXISTS dispatch_details (
  dispatch_id       SERIAL PRIMARY KEY,
  sale_id           INTEGER NOT NULL REFERENCES sales(sale_id) ON DELETE CASCADE,
  truck_number      VARCHAR(30),
  driver_name       VARCHAR(120),
  driver_phone      VARCHAR(30),
  dispatch_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  delivery_location TEXT,
  delivery_status   delivery_status NOT NULL DEFAULT 'In-Transit',
  delivered_date    DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dispatch_sale ON dispatch_details (sale_id);

-- ---------- DEALER PAYMENTS ----------
CREATE TABLE IF NOT EXISTS dealer_payments (
  payment_id       SERIAL PRIMARY KEY,
  dealer_id        INTEGER NOT NULL REFERENCES dealers(dealer_id),
  sale_id          INTEGER NOT NULL REFERENCES sales(sale_id),
  amount           NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  payment_date     DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_mode     payment_mode NOT NULL DEFAULT 'Bank Transfer',
  reference_number VARCHAR(80),
  created_by       INTEGER REFERENCES users(user_id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dp_sale ON dealer_payments (sale_id);

-- =====================================================================
-- TRIGGERS — enforce the lot rules at the database layer
-- =====================================================================

-- Keep booking_item.balance_qty in sync AND enforce factory-lock,
-- available-only and non-negative stock on every allocation change.
CREATE OR REPLACE FUNCTION trg_alloc_enforce() RETURNS TRIGGER AS $$
DECLARE
  bi           booking_items%ROWTYPE;
  si_factory   INTEGER;
  si_product   INTEGER;
  new_balance  NUMERIC(14,3);
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT * INTO bi FROM booking_items WHERE booking_item_id = NEW.booking_item_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Booking item % not found', NEW.booking_item_id; END IF;

    SELECT factory_id, product_id INTO si_factory, si_product
      FROM sale_items WHERE sale_item_id = NEW.sale_item_id;

    -- RULE 1: factory + size must match the sale line (no cross-brand substitution)
    IF bi.factory_id <> si_factory OR bi.product_id <> si_product THEN
      RAISE EXCEPTION 'Factory-lock violation: booking item % (factory %, product %) does not match sale item (factory %, product %)',
        NEW.booking_item_id, bi.factory_id, bi.product_id, si_factory, si_product;
    END IF;

    -- RULE 3: only Available lots may be allocated
    IF bi.status <> 'Available' THEN
      RAISE EXCEPTION 'Cannot allocate against booking item % with status % (must be Available)', bi.booking_item_id, bi.status;
    END IF;

    -- RULE 8: never negative stock
    new_balance := bi.balance_qty - NEW.allocated_qty;
    IF new_balance < 0 THEN
      RAISE EXCEPTION 'Over-allocation: booking item % has % available, tried to allocate %', bi.booking_item_id, bi.balance_qty, NEW.allocated_qty;
    END IF;

    UPDATE booking_items
       SET balance_qty = new_balance,
           status = CASE WHEN new_balance = 0 THEN 'Closed'::booking_status ELSE status END
     WHERE booking_item_id = NEW.booking_item_id;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    -- return stock; reopen a Closed lot back to Available
    UPDATE booking_items
       SET balance_qty = balance_qty + OLD.allocated_qty,
           status = CASE WHEN status = 'Closed' THEN 'Available'::booking_status ELSE status END
     WHERE booking_item_id = OLD.booking_item_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS alloc_enforce ON sale_allocations;
CREATE TRIGGER alloc_enforce
  BEFORE INSERT OR DELETE ON sale_allocations
  FOR EACH ROW EXECUTE FUNCTION trg_alloc_enforce();

-- Initialise balance_qty = booked_qty on new booking items.
CREATE OR REPLACE FUNCTION trg_bi_init_balance() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.balance_qty = 0 THEN NEW.balance_qty := NEW.booked_qty; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bi_init_balance ON booking_items;
CREATE TRIGGER bi_init_balance
  BEFORE INSERT ON booking_items
  FOR EACH ROW EXECUTE FUNCTION trg_bi_init_balance();

-- Recompute sale.total_amount whenever sale_items change.
CREATE OR REPLACE FUNCTION trg_recompute_sale_total() RETURNS TRIGGER AS $$
DECLARE sid INTEGER;
BEGIN
  sid := COALESCE(NEW.sale_id, OLD.sale_id);
  UPDATE sales s
     SET total_amount = COALESCE((SELECT SUM(line_total) FROM sale_items WHERE sale_id = sid), 0),
         balance_due  = COALESCE((SELECT SUM(line_total) FROM sale_items WHERE sale_id = sid), 0) - s.amount_received
   WHERE s.sale_id = sid;
  UPDATE sales s
     SET payment_stat = CASE
           WHEN s.amount_received <= 0 THEN 'Pending'::payment_status
           WHEN s.amount_received >= s.total_amount THEN 'Paid'::payment_status
           ELSE 'Partially Paid'::payment_status END
   WHERE s.sale_id = sid;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS recompute_sale_total ON sale_items;
CREATE TRIGGER recompute_sale_total
  AFTER INSERT OR UPDATE OR DELETE ON sale_items
  FOR EACH ROW EXECUTE FUNCTION trg_recompute_sale_total();

-- Recompute sale.amount_received / balance_due / payment_stat on payment changes.
CREATE OR REPLACE FUNCTION trg_recompute_sale_payment() RETURNS TRIGGER AS $$
DECLARE sid INTEGER;
BEGIN
  sid := COALESCE(NEW.sale_id, OLD.sale_id);
  UPDATE sales s
     SET amount_received = COALESCE((SELECT SUM(amount) FROM dealer_payments WHERE sale_id = sid), 0),
         balance_due     = s.total_amount - COALESCE((SELECT SUM(amount) FROM dealer_payments WHERE sale_id = sid), 0)
   WHERE s.sale_id = sid;
  UPDATE sales s
     SET payment_stat = CASE
           WHEN s.amount_received <= 0 THEN 'Pending'::payment_status
           WHEN s.amount_received >= s.total_amount THEN 'Paid'::payment_status
           ELSE 'Partially Paid'::payment_status END
   WHERE s.sale_id = sid;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS recompute_sale_payment ON dealer_payments;
CREATE TRIGGER recompute_sale_payment
  AFTER INSERT OR UPDATE OR DELETE ON dealer_payments
  FOR EACH ROW EXECUTE FUNCTION trg_recompute_sale_payment();
