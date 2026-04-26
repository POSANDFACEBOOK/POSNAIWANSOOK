-- CRM System Migration for Foodcost
-- Run this in Supabase SQL Editor to enable CRM features
-- ─────────────────────────────────────────────────────

-- 1. customers: customer database with loyalty
CREATE TABLE IF NOT EXISTS public.customers (
  id BIGSERIAL PRIMARY KEY,
  branch_id BIGINT REFERENCES public.branches(id) ON DELETE CASCADE,
  name TEXT,
  phone TEXT,
  email TEXT,
  birthday DATE,
  allergies TEXT,
  fav_seat TEXT,
  notes TEXT,
  points INTEGER DEFAULT 0,
  visit_count INTEGER DEFAULT 0,
  total_spent NUMERIC DEFAULT 0,
  last_visit TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_customers_branch ON public.customers(branch_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON public.customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_visit_count ON public.customers(visit_count DESC);
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_customers" ON public.customers FOR ALL USING (true) WITH CHECK (true);

-- 2. loyalty_logs: every points earn/redeem transaction
CREATE TABLE IF NOT EXISTS public.loyalty_logs (
  id BIGSERIAL PRIMARY KEY,
  customer_id BIGINT REFERENCES public.customers(id) ON DELETE CASCADE,
  branch_id BIGINT REFERENCES public.branches(id) ON DELETE SET NULL,
  order_id BIGINT,
  points INTEGER NOT NULL,
  type TEXT, -- earn, redeem, adjust_add, adjust_sub
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_loyalty_logs_customer ON public.loyalty_logs(customer_id, created_at DESC);
ALTER TABLE public.loyalty_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_loyalty_logs" ON public.loyalty_logs FOR ALL USING (true) WITH CHECK (true);

-- 3. vouchers: discount coupons
CREATE TABLE IF NOT EXISTS public.vouchers (
  id BIGSERIAL PRIMARY KEY,
  branch_id BIGINT REFERENCES public.branches(id) ON DELETE CASCADE,
  customer_id BIGINT REFERENCES public.customers(id) ON DELETE SET NULL,
  code TEXT NOT NULL,
  name TEXT,
  discount_type TEXT, -- percent, amount
  discount_value NUMERIC DEFAULT 0,
  min_purchase NUMERIC DEFAULT 0,
  expires_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ,
  used_order_id BIGINT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vouchers_branch ON public.vouchers(branch_id);
CREATE INDEX IF NOT EXISTS idx_vouchers_code ON public.vouchers(code);
ALTER TABLE public.vouchers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_vouchers" ON public.vouchers FOR ALL USING (true) WITH CHECK (true);

-- 4. reservations: table reservations / queue
CREATE TABLE IF NOT EXISTS public.reservations (
  id BIGSERIAL PRIMARY KEY,
  branch_id BIGINT REFERENCES public.branches(id) ON DELETE CASCADE,
  customer_id BIGINT REFERENCES public.customers(id) ON DELETE SET NULL,
  name TEXT,
  phone TEXT,
  party_size INTEGER DEFAULT 1,
  reserved_at TIMESTAMPTZ NOT NULL,
  status TEXT DEFAULT 'pending', -- pending, confirmed, seated, completed, cancelled, noshow
  note TEXT,
  table_id BIGINT REFERENCES public.tables(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reservations_branch ON public.reservations(branch_id, reserved_at DESC);
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_reservations" ON public.reservations FOR ALL USING (true) WITH CHECK (true);

-- 5. feedback: customer reviews
CREATE TABLE IF NOT EXISTS public.feedback (
  id BIGSERIAL PRIMARY KEY,
  branch_id BIGINT REFERENCES public.branches(id) ON DELETE CASCADE,
  customer_id BIGINT REFERENCES public.customers(id) ON DELETE SET NULL,
  order_id BIGINT,
  table_id BIGINT REFERENCES public.tables(id) ON DELETE SET NULL,
  table_number INTEGER,
  name TEXT,
  rating INTEGER,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feedback_branch ON public.feedback(branch_id, created_at DESC);
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_all_feedback" ON public.feedback FOR ALL USING (true) WITH CHECK (true);

-- 6. orders: add CRM-related columns
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_id BIGINT REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS customer_name TEXT,
  ADD COLUMN IF NOT EXISTS points_earned INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS points_redeemed INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS voucher_code TEXT,
  ADD COLUMN IF NOT EXISTS voucher_id BIGINT REFERENCES public.vouchers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_orders_customer ON public.orders(customer_id);
