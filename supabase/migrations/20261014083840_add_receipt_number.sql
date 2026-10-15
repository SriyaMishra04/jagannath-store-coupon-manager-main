/*
# Add receipt number to payments

## Purpose
Every payment now gets a globally unique receipt number (1, 2, 3...) generated
automatically by the database.

## Changes
1. New sequence `receipt_number_seq`.
2. New column `receipt_number` on payments (bigint, unique, not null).
3. Backfill existing payments with receipt numbers.
4. `process_payment` function replaced to allocate and return receipt_number.

## Security
- No RLS changes. SECURITY DEFINER function retains sequence access.
*/

CREATE SEQUENCE IF NOT EXISTS receipt_number_seq START 1 INCREMENT 1;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS receipt_number bigint;

UPDATE payments SET receipt_number = nextval('receipt_number_seq') WHERE receipt_number IS NULL;

ALTER TABLE payments ALTER COLUMN receipt_number SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'payments_receipt_number_key' AND table_name = 'payments'
  ) THEN
    ALTER TABLE payments ADD CONSTRAINT payments_receipt_number_key UNIQUE (receipt_number);
  END IF;
END $$;

GRANT USAGE, SELECT ON SEQUENCE receipt_number_seq TO anon, authenticated;

-- Drop old function (return type changed) and recreate
DROP FUNCTION IF EXISTS process_payment(uuid, bigint, text);

CREATE FUNCTION process_payment(
  p_customer_id uuid,
  p_amount bigint,
  p_idempotency_key text
) RETURNS TABLE (
  payment_id uuid,
  receipt_number bigint,
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
  v_receipt_num bigint;
  v_existing_amount bigint;
  v_existing_receipt bigint;
  v_existing_coupons int;
  v_existing_balance bigint;
  v_existing_coupon_nums bigint[];
  i int;
BEGIN
  SELECT id INTO v_existing_id FROM payments WHERE idempotency_key = p_idempotency_key LIMIT 1;
  IF v_existing_id IS NOT NULL THEN
    SELECT
      p.amount,
      p.receipt_number,
      p.coupons_earned,
      p.balance_after,
      COALESCE(array_agg(c.coupon_number ORDER BY c.coupon_number) FILTER (WHERE c.coupon_number IS NOT NULL), ARRAY[]::bigint[])
    INTO
      v_existing_amount,
      v_existing_receipt,
      v_existing_coupons,
      v_existing_balance,
      v_existing_coupon_nums
    FROM payments p
    LEFT JOIN coupons c ON c.payment_id = p.id
    WHERE p.id = v_existing_id
    GROUP BY p.id;

    RETURN QUERY SELECT v_existing_id, v_existing_receipt, v_existing_amount, v_existing_coupons, v_existing_balance, v_existing_coupon_nums;
    RETURN;
  END IF;

  SELECT remaining_balance INTO v_prev_balance FROM customers WHERE id = p_customer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Customer not found';
  END IF;

  v_total := v_prev_balance + p_amount;
  v_new_coupons := floor(v_total / 20000)::int;
  v_new_balance := v_total % 20000;
  v_receipt_num := nextval('receipt_number_seq');

  INSERT INTO payments (customer_id, amount, coupons_earned, balance_after, idempotency_key, receipt_number)
  VALUES (p_customer_id, p_amount, v_new_coupons, v_new_balance, p_idempotency_key, v_receipt_num)
  RETURNING id INTO v_pay_id;

  FOR i IN 1..v_new_coupons LOOP
    v_coupon_num := nextval('coupon_number_seq');
    INSERT INTO coupons (coupon_number, customer_id, payment_id)
    VALUES (v_coupon_num, p_customer_id, v_pay_id);
    v_coupon_numbers := array_append(v_coupon_numbers, v_coupon_num);
  END LOOP;

  UPDATE customers SET remaining_balance = v_new_balance WHERE id = p_customer_id;

  RETURN QUERY SELECT v_pay_id, v_receipt_num, p_amount, v_new_coupons, v_new_balance, v_coupon_numbers;
END;
$$;

GRANT EXECUTE ON FUNCTION process_payment(uuid, bigint, text) TO anon, authenticated;
