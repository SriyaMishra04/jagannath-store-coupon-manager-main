import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export type Customer = {
  id: string;
  name: string;
  mobile: string;
  remaining_balance: number;
  created_at: string;
};

export type Payment = {
  id: string;
  customer_id: string;
  amount: number;
  coupons_earned: number;
  balance_after: number;
  receipt_number: number;
  idempotency_key: string | null;
  created_at: string;
};

export type Coupon = {
  id: string;
  coupon_number: number;
  customer_id: string;
  payment_id: string;
  created_at: string;
};

export type PaymentWithCoupons = Payment & {
  coupons: Coupon[];
};

export type CustomerWithDetails = Customer & {
  total_paid: number;
  payment_count: number;
  coupon_count: number;
  coupon_numbers: number[];
  payments: PaymentWithCoupons[];
};

export type CustomerSummary = Customer & {
  total_paid: number;
  payment_count: number;
  coupon_count: number;
  coupon_numbers: number[];
};

export type ProcessPaymentResult = {
  payment_id: string;
  receipt_number: number;
  amount: number;
  coupons_earned: number;
  balance_after: number;
  coupon_numbers: number[];
};
