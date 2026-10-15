/*
# Customer Coupon Management System

## Purpose
Creates the complete database schema for a simple customer coupon management app:
- Store customers (name + mobile only)
- Record payments
- Automatically generate globally-unique coupon numbers for every ₹20,000 in cumulative payments
- Track remaining carry-forward balance per customer

## Tables Created
1. **customers** — stores customer name and mobile number (unique mobile)
2. **payments** — stores each payment with amount, idempotency key, and coupon count
3. **coupons** — stores individual coupon numbers (globally unique, never reused)

## Security (RLS)
- All tables use single-tenant (no auth) model: TO anon, authenticated
- CRUD policies allow the frontend to read/write all data
- The coupon-generation function is SECURITY DEFINER so it can safely insert coupons

## Coupon Logic
- Every ₹20,000 in cumulative payments (previous balance + new payment) earns one coupon
- New Coupons = Floor((previous_balance + payment_amount) / 20000)
- Remaining Balance = (previous_balance + payment_amount) % 20000
- Coupon numbers are sequential integers starting at 1, globally unique, never reused

## Important Notes
1. The `process_payment` function is SECURITY DEFINER — it runs with elevated privileges to
   safely allocate coupon numbers from a global sequence.
2. An idempotency key on payments prevents duplicate submissions.
3. Coupon numbers come from a dedicated SEQUENCE so they are never reused even if a
   payment is later corrected or deleted.
*/

-- ============================================================
-- 1. COUPON NUMBER SEQUENCE (globally unique, never reused)
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS coupon_number_seq START 1 INCREMENT 1;

-- ============================================================
-- 2. CUSTOMERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  mobile text NOT NULL UNIQUE,
  remaining_balance bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_customers" ON customers;
CREATE POLICY "anon_select_customers" ON customers FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_customers" ON customers;
CREATE POLICY "anon_insert_customers" ON customers FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_customers" ON customers;
CREATE POLICY "anon_update_customers" ON customers FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_customers" ON customers;
CREATE POLICY "anon_delete_customers" ON customers FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_customers_mobile ON customers(mobile);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

-- ============================================================
-- 3. PAYMENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount bigint NOT NULL CHECK (amount > 0),
  coupons_earned int NOT NULL DEFAULT 0,
  balance_after bigint NOT NULL DEFAULT 0,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_payments" ON payments;
CREATE POLICY "anon_select_payments" ON payments FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_payments" ON payments;
CREATE POLICY "anon_insert_payments" ON payments FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_payments" ON payments;
CREATE POLICY "anon_update_payments" ON payments FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_payments" ON payments;
CREATE POLICY "anon_delete_payments" ON payments FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_payments_customer_id ON payments(customer_id);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON payments(created_at DESC);

-- ============================================================
-- 4. COUPONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_number bigint NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_select_coupons" ON coupons;
CREATE POLICY "anon_select_coupons" ON coupons FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_coupons" ON coupons;
CREATE POLICY "anon_insert_coupons" ON coupons FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_coupons" ON coupons;
CREATE POLICY "anon_update_coupons" ON coupons FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_coupons" ON coupons;
CREATE POLICY "anon_delete_coupons" ON coupons FOR DELETE
  TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_coupons_customer_id ON coupons(customer_id);
CREATE INDEX IF NOT EXISTS idx_coupons_payment_id ON coupons(payment_id);

-- ============================================================
-- 5. PROCESS PAYMENT FUNCTION (SECURITY DEFINER)
--    Atomically: inserts payment, calculates coupons, updates
--    balance, and generates globally-unique coupon numbers.
-- ============================================================
CREATE OR REPLACE FUNCTION process_payment(
  p_customer_id uuid,
  p_amount bigint,
  p_idempotency_key text
) RETURNS TABLE (
  payment_id uuid,
  amount bigint,
  coupons_earned int,
  balance_after bigint,
  coupon_numbers bigint[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_id uuid;
  v_prev_balance bigint;
  v_total bigint;
  v_new_coupons int;
  v_new_balance bigint;
  v_coupon_num bigint;
  v_coupon_numbers bigint[] := ARRAY[]::bigint[];
  v_pay_id uuid;
  v_existing_amount bigint;
  v_existing_coupons int;
  v_existing_balance bigint;
  v_existing_coupon_nums bigint[];
  i int;
BEGIN
  -- Idempotency check: if this key already exists, return the original result
  SELECT id INTO v_existing_id FROM payments WHERE idempotency_key = p_idempotency_key LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    SELECT
      p.amount,
      p.coupons_earned,
      p.balance_after,
      COALESCE(array_agg(c.coupon_number ORDER BY c.coupon_number) FILTER (WHERE c.coupon_number IS NOT NULL), ARRAY[]::bigint[])
    INTO
      v_existing_amount,
      v_existing_coupons,
      v_existing_balance,
      v_existing_coupon_nums
    FROM payments p
    LEFT JOIN coupons c ON c.payment_id = p.id
    WHERE p.id = v_existing_id
    GROUP BY p.id;

    RETURN QUERY SELECT v_existing_id, v_existing_amount, v_existing_coupons, v_existing_balance, v_existing_coupon_nums;
    RETURN;
  END IF;

  -- Get current balance (with row lock to prevent race conditions)
  SELECT remaining_balance INTO v_prev_balance
  FROM customers
  WHERE id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer not found';
  END IF;

  -- Calculate coupons and new balance
  v_total := v_prev_balance + p_amount;
  v_new_coupons := floor(v_total / 20000)::int;
  v_new_balance := v_total % 20000;

  -- Insert the payment record
  INSERT INTO payments (customer_id, amount, coupons_earned, balance_after, idempotency_key)
  VALUES (p_customer_id, p_amount, v_new_coupons, v_new_balance, p_idempotency_key)
  RETURNING id INTO v_pay_id;

  -- Generate coupon numbers from the global sequence
  FOR i IN 1..v_new_coupons LOOP
    v_coupon_num := nextval('coupon_number_seq');
    INSERT INTO coupons (coupon_number, customer_id, payment_id)
    VALUES (v_coupon_num, p_customer_id, v_pay_id);
    v_coupon_numbers := array_append(v_coupon_numbers, v_coupon_num);
  END LOOP;

  -- Update customer's remaining balance
  UPDATE customers SET remaining_balance = v_new_balance WHERE id = p_customer_id;

  RETURN QUERY SELECT v_pay_id, p_amount, v_new_coupons, v_new_balance, v_coupon_numbers;
END;
$$;

-- Grant execute to anon and authenticated
GRANT EXECUTE ON FUNCTION process_payment(uuid, bigint, text) TO anon, authenticated;

-- Grant sequence usage so the SECURITY DEFINER function can call nextval
GRANT USAGE, SELECT ON SEQUENCE coupon_number_seq TO anon, authenticated;
