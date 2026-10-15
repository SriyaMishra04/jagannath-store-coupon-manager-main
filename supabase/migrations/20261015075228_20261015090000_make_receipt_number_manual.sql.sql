/*
# Make receipt numbers manually entered

## Purpose
New payments will use a receipt number entered by the operator instead of an automatically generated number.
Existing payment rows and their receipt numbers are preserved exactly as they are.

## Modified Database Objects
1. `payments.receipt_number`
- Remains a required bigint column.
- Its existing unique constraint continues to prevent duplicate receipt numbers.
- No existing values are changed or deleted.

2. `process_payment`
- Replaced with a four-argument version that accepts `p_receipt_number`.
- Validates that the entered receipt number is positive.
- Saves the entered receipt number with the payment.
- Keeps the existing atomic balance and coupon-number logic unchanged.
- Does not allocate a receipt number from the old sequence.

## Security
- The existing SECURITY DEFINER execution model and grants are retained.
- The function keeps a fixed `search_path` of `public`.

## Important Notes
1. Existing receipt numbers remain available for search.
2. Duplicate receipt numbers are rejected by the existing unique constraint.
3. Coupon numbers continue using `coupon_number_seq` and are generated only when payment totals qualify.
*/

DROP FUNCTION IF EXISTS process_payment(uuid, bigint, text);

CREATE OR REPLACE FUNCTION process_payment(
  p_customer_id uuid,
  p_amount bigint,
  p_idempotency_key text,
  p_receipt_number bigint
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
  v_existing_amount bigint;
  v_existing_receipt bigint;
  v_existing_coupons int;
  v_existing_balance bigint;
  v_existing_coupon_nums bigint[];
  i int;
BEGIN
  IF p_receipt_number IS NULL OR p_receipt_number <= 0 THEN
    RAISE EXCEPTION 'Receipt number must be positive';
  END IF;

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

  INSERT INTO payments (customer_id, amount, coupons_earned, balance_after, idempotency_key, receipt_number)
  VALUES (p_customer_id, p_amount, v_new_coupons, v_new_balance, p_idempotency_key, p_receipt_number)
  RETURNING id INTO v_pay_id;

  FOR i IN 1..v_new_coupons LOOP
    v_coupon_num := nextval('coupon_number_seq');
    INSERT INTO coupons (coupon_number, customer_id, payment_id)
    VALUES (v_coupon_num, p_customer_id, v_pay_id);
    v_coupon_numbers := array_append(v_coupon_numbers, v_coupon_num);
  END LOOP;

  UPDATE customers SET remaining_balance = v_new_balance WHERE id = p_customer_id;

  RETURN QUERY SELECT v_pay_id, p_receipt_number, p_amount, v_new_coupons, v_new_balance, v_coupon_numbers;
END;
$$;

GRANT EXECUTE ON FUNCTION process_payment(uuid, bigint, text, bigint) TO anon, authenticated;