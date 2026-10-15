import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type {
  Customer,
  Payment,
  Coupon,
  PaymentWithCoupons,
  CustomerWithDetails,
  CustomerSummary,
} from '@/lib/supabase';
import { formatRupees, formatDateTime, formatDate, formatCouponNumber, generateIdempotencyKey } from '@/lib/utils';
import {
  UserPlus,
  Wallet,
  Search,
  Users,
  IndianRupee,
  Ticket,
  ArrowLeft,
  Check,
  AlertCircle,
  Phone,
  Loader2,
  X,
  ClipboardList,
  ChevronRight,
  Trash2,
  Printer,
} from 'lucide-react';

type View = 'home' | 'addCustomer' | 'addPayment' | 'searchCustomer' | 'allCustomers';

type DashboardTotals = {
  totalCustomers: number;
  totalPayments: number;
  totalCoupons: number;
};

export default function App() {
  const [view, setView] = useState<View>('home');
  const [totals, setTotals] = useState<DashboardTotals>({
    totalCustomers: 0,
    totalPayments: 0,
    totalCoupons: 0,
  });

  const fetchTotals = useCallback(async () => {
    const [custRes, payRes, couponRes] = await Promise.all([
      supabase.from('customers').select('id', { count: 'exact', head: true }),
      supabase.from('payments').select('amount', { count: 'exact' }),
      supabase.from('coupons').select('id', { count: 'exact', head: true }),
    ]);

    const totalPayments = (payRes.data ?? []).reduce((sum, p: Pick<Payment, 'amount'>) => sum + p.amount, 0);

    setTotals({
      totalCustomers: custRes.count ?? 0,
      totalPayments,
      totalCoupons: couponRes.count ?? 0,
    });
  }, []);

  useEffect(() => {
    fetchTotals();
  }, [fetchTotals]);

  return (
    <div className="min-h-screen bg-white">
      {view === 'home' && <HomeView totals={totals} onNavigate={setView} />}
      {view === 'addCustomer' && <AddCustomerView onBack={() => setView('home')} onSaved={fetchTotals} />}
      {view === 'addPayment' && <AddPaymentView onBack={() => setView('home')} onSaved={fetchTotals} />}
      {view === 'searchCustomer' && <SearchCustomerView onBack={() => setView('home')} onDeleted={fetchTotals} />}
      {view === 'allCustomers' && <AllCustomersView onBack={() => setView('home')} onSelectCustomer={() => setView('searchCustomer')} />}
    </div>
  );
}

/* ============================================================
   HOME VIEW
   ============================================================ */
function HomeView({
  totals,
  onNavigate,
}: {
  totals: DashboardTotals;
  onNavigate: (v: View) => void;
}) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 sm:py-12">
      <header className="mb-6 sm:mb-8 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-600 rounded-2xl mb-4">
          <Ticket className="w-8 h-8 text-white" />
        </div>
        <h1 className="text-2xl sm:text-4xl font-bold text-gray-900">Coupon Manager</h1>
        <p className="text-base sm:text-lg text-gray-500 mt-2">Manage customers, payments & coupons</p>
      </header>

      <div className="space-y-4 mb-8">
        <ActionButton
          icon={<UserPlus className="w-7 h-7" />}
          label="Add Customer"
          onClick={() => onNavigate('addCustomer')}
        />
        <ActionButton
          icon={<Wallet className="w-7 h-7" />}
          label="Add Payment"
          onClick={() => onNavigate('addPayment')}
        />
        <ActionButton
          icon={<Search className="w-7 h-7" />}
          label="Search Customer"
          onClick={() => onNavigate('searchCustomer')}
        />
        <ActionButton
          icon={<ClipboardList className="w-7 h-7" />}
          label="All Customers & Coupons"
          onClick={() => onNavigate('allCustomers')}
        />
      </div>

      <div className="space-y-4">
        <SummaryCard
          icon={<Users className="w-6 h-6" />}
          label="Total Customers"
          value={totals.totalCustomers.toString()}
        />
        <SummaryCard
          icon={<IndianRupee className="w-6 h-6" />}
          label="Total Payments Received"
          value={formatRupees(totals.totalPayments)}
        />
        <SummaryCard
          icon={<Ticket className="w-6 h-6" />}
          label="Total Coupons Generated"
          value={totals.totalCoupons.toString()}
        />
      </div>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xl font-semibold py-5 px-6 rounded-xl transition-colors shadow-sm"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-4 bg-gray-50 border border-gray-200 rounded-xl py-5 px-6">
      <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-lg text-blue-600 shrink-0">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-base text-gray-500">{label}</p>
        <p className="text-2xl font-bold text-gray-900 truncate">{value}</p>
      </div>
    </div>
  );
}

/* ============================================================
   ADD CUSTOMER VIEW
   ============================================================ */
function AddCustomerView({ onBack, onSaved }: { onBack: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    const trimmedName = name.trim();
    const trimmedMobile = mobile.trim();

    if (!trimmedName || !trimmedMobile) {
      setError('Both name and mobile number are required.');
      return;
    }

    setLoading(true);
    const { error: insertError } = await supabase
      .from('customers')
      .insert({ name: trimmedName, mobile: trimmedMobile });

    setLoading(false);

    if (insertError) {
      if (insertError.code === '23505') {
        setError('This mobile number already exists. Please use a different number.');
      } else {
        setError('Could not save customer. Please try again.');
      }
      return;
    }

    setSuccess(true);
    onSaved();
    setTimeout(() => {
      setSuccess(false);
      setName('');
      setMobile('');
      onBack();
    }, 1500);
  }

  return (
    <PageWrapper title="Add Customer" onBack={onBack}>
      {success ? (
        <SuccessMessage message="Customer saved successfully!" />
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <LargeInput
            label="Customer Name"
            value={name}
            onChange={setName}
            placeholder="Enter customer name"
            required
          />
          <LargeInput
            label="Mobile Number"
            value={mobile}
            onChange={setMobile}
            placeholder="Enter mobile number"
            type="tel"
            required
          />
          {error && <ErrorMessage message={error} />}
          <SaveButton loading={loading} label="Save Customer" />
        </form>
      )}
    </PageWrapper>
  );
}

/* ============================================================
   ADD PAYMENT VIEW
   ============================================================ */
function AddPaymentView({ onBack, onSaved }: { onBack: () => void; onSaved: () => void }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [receiptNumber, setReceiptNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [successData, setSuccessData] = useState<{
    receiptNumber: number;
    coupons: number;
    balance: number;
    couponNumbers: number[];
  } | null>(null);

  async function handleSearch(query: string) {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    const { data } = await supabase
      .from('customers')
      .select('*')
      .or(`name.ilike.%${query.trim()}%,mobile.ilike.%${query.trim()}%`)
      .limit(10);

    setSearchResults(data ?? []);
    setSearching(false);
  }

  function selectCustomer(c: Customer) {
    setSelectedCustomer(c);
    setSearchQuery('');
    setSearchResults([]);
    setError('');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!selectedCustomer) {
      setError('Please select a customer first.');
      return;
    }

    const receipt = parseInt(receiptNumber, 10);
    if (!receiptNumber || isNaN(receipt) || receipt <= 0) {
      setError('Please enter a valid receipt number.');
      return;
    }

    const amt = parseInt(amount, 10);
    if (!amount || isNaN(amt) || amt <= 0) {
      setError('Please enter a valid positive payment amount.');
      return;
    }

    setLoading(true);
    const { data, error: rpcError } = await supabase.rpc('process_payment', {
      p_customer_id: selectedCustomer.id,
      p_amount: amt,
      p_idempotency_key: generateIdempotencyKey(),
      p_receipt_number: receipt,
    });

    setLoading(false);

    if (rpcError || !data || data.length === 0) {
      setError(rpcError?.code === '23505' ? 'That receipt number already exists. Please enter a different number.' : 'Could not save payment. Please try again.');
      return;
    }

    const result = data[0];
    setSuccessData({
      receiptNumber: result.receipt_number,
      coupons: result.coupons_earned,
      balance: result.balance_after,
      couponNumbers: result.coupon_numbers ?? [],
    });
    setSuccess(true);
    onSaved();
  }

  function resetAndBack() {
    setSuccess(false);
    setSuccessData(null);
    setSelectedCustomer(null);
    setReceiptNumber('');
    setAmount('');
    onBack();
  }

  return (
    <PageWrapper title="Add Payment" onBack={onBack}>
      {success && successData ? (
        <div className="space-y-4">
          <SuccessMessage message="Payment saved successfully!" />
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-lg text-gray-600">Receipt No.</span>
              <span className="text-2xl font-bold text-blue-600">{successData.receiptNumber}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-lg text-gray-600">Coupons Earned</span>
              <span className="text-2xl font-bold text-blue-600">{successData.coupons}</span>
            </div>
            {successData.couponNumbers.length > 0 && (
              <div>
                <p className="text-sm text-gray-500 mb-2">Coupon Numbers</p>
                <div className="flex flex-wrap gap-2">
                  {successData.couponNumbers.map((n) => (
                    <span
                      key={n}
                      className="bg-white border-2 border-blue-600 text-blue-600 font-bold text-lg px-4 py-1 rounded-lg"
                    >
                      {formatCouponNumber(n)}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-between items-center pt-2 border-t border-blue-200">
              <span className="text-lg text-gray-600">Remaining Balance</span>
              <span className="text-2xl font-bold text-gray-900">{formatRupees(successData.balance)}</span>
            </div>
          </div>
          <button
            onClick={resetAndBack}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xl font-semibold py-4 rounded-xl transition-colors"
          >
            Done
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Customer search */}
          <div>
            <label className="block text-lg font-semibold text-gray-700 mb-2">Select Customer</label>
            {selectedCustomer ? (
              <div className="flex items-center justify-between bg-blue-50 border-2 border-blue-200 rounded-xl py-4 px-5">
                <div>
                  <p className="text-xl font-bold text-gray-900">{selectedCustomer.name}</p>
                  <p className="text-base text-gray-500 flex items-center gap-1">
                    <Phone className="w-4 h-4" />
                    {selectedCustomer.mobile}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedCustomer(null)}
                  className="text-gray-400 hover:text-red-500 p-2"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => handleSearch(e.target.value)}
                  placeholder="Search by name or mobile number"
                  className="w-full text-lg border-2 border-gray-300 rounded-xl py-4 px-5 focus:border-blue-600 focus:outline-none"
                />
                {searching && (
                  <p className="text-gray-400 text-sm mt-2 flex items-center gap-1">
                    <Loader2 className="w-4 h-4 animate-spin" /> Searching...
                  </p>
                )}
                {searchResults.length > 0 && (
                  <div className="mt-2 border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
                    {searchResults.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => selectCustomer(c)}
                        className="w-full text-left px-5 py-4 hover:bg-blue-50 transition-colors"
                      >
                        <p className="text-lg font-semibold text-gray-900">{c.name}</p>
                        <p className="text-base text-gray-500 flex items-center gap-1">
                          <Phone className="w-4 h-4" />
                          {c.mobile}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
                {searchQuery.trim() && !searching && searchResults.length === 0 && (
                  <p className="text-gray-400 text-sm mt-2">No customers found.</p>
                )}
              </>
            )}
          </div>

          <LargeInput
            label="Receipt Number"
            value={receiptNumber}
            onChange={setReceiptNumber}
            placeholder="Enter receipt number"
            type="number"
            required
          />

          {/* Payment amount */}
          <LargeInput
            label="Payment Amount (₹)"
            value={amount}
            onChange={setAmount}
            placeholder="Enter payment amount"
            type="number"
            required
          />

          {error && <ErrorMessage message={error} />}
          <SaveButton loading={loading} label="Save Payment" disabled={!selectedCustomer} />
        </form>
      )}
    </PageWrapper>
  );
}

/* ============================================================
   SEARCH CUSTOMER VIEW
   ============================================================ */
function SearchCustomerView({ onBack, onDeleted }: { onBack: () => void; onDeleted: () => void }) {
  const [query, setQuery] = useState('');
  const [receiptQuery, setReceiptQuery] = useState('');
  const [receiptError, setReceiptError] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [searching, setSearching] = useState(false);
  const [receiptSearching, setReceiptSearching] = useState(false);
  const [selected, setSelected] = useState<CustomerWithDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);

  async function handleSearch(q: string) {
    setQuery(q);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    const { data } = await supabase
      .from('customers')
      .select('*')
      .or(`name.ilike.%${q.trim()}%,mobile.ilike.%${q.trim()}%`)
      .limit(10);
    setResults(data ?? []);
    setSearching(false);
  }

  async function findByReceiptNumber() {
    const receiptNumber = Number.parseInt(receiptQuery.trim(), 10);
    setReceiptError('');

    if (!receiptQuery.trim() || !Number.isInteger(receiptNumber) || receiptNumber <= 0) {
      setReceiptError('Enter a valid receipt number.');
      return;
    }

    setReceiptSearching(true);
    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('customer_id')
      .eq('receipt_number', receiptNumber)
      .maybeSingle();

    if (paymentError || !payment) {
      setReceiptSearching(false);
      setReceiptError('No customer was found for that receipt number.');
      return;
    }

    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('*')
      .eq('id', payment.customer_id)
      .maybeSingle();

    setReceiptSearching(false);
    if (customerError || !customer) {
      setReceiptError('No customer was found for that receipt number.');
      return;
    }

    setReceiptQuery('');
    await selectCustomer(customer);
  }

  async function selectCustomer(c: Customer) {
    setLoadingDetails(true);
    setQuery('');
    setReceiptQuery('');
    setReceiptError('');
    setResults([]);

    const { data: payments } = await supabase
      .from('payments')
      .select('*')
      .eq('customer_id', c.id)
      .order('created_at', { ascending: false });

    const { data: coupons } = await supabase
      .from('coupons')
      .select('*')
      .eq('customer_id', c.id)
      .order('coupon_number', { ascending: true });

    const allPayments = payments ?? [];
    const allCoupons = coupons ?? [];

    const paymentsWithCoupons: PaymentWithCoupons[] = allPayments.map((p) => ({
      ...p,
      coupons: allCoupons.filter((co) => co.payment_id === p.id),
    }));

    const totalPaid = allPayments.reduce((sum, p) => sum + p.amount, 0);

    setSelected({
      ...c,
      total_paid: totalPaid,
      payment_count: allPayments.length,
      coupon_count: allCoupons.length,
      coupon_numbers: allCoupons.map((co) => co.coupon_number),
      payments: paymentsWithCoupons,
    });
    setLoadingDetails(false);
  }

  if (selected) {
    return <CustomerDetailView customer={selected} onBack={() => setSelected(null)} onHome={onBack} onDeleted={() => { onDeleted(); onBack(); }} />;
  }

  return (
    <PageWrapper title="Search Customer" onBack={onBack}>
      <div className="space-y-5">
        <div>
          <label className="block text-lg font-semibold text-gray-700 mb-2">Search by name or mobile</label>
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-6 h-6 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Enter customer name or mobile number"
              className="w-full text-lg border-2 border-gray-300 rounded-xl py-4 pl-14 pr-5 focus:border-blue-600 focus:outline-none"
              autoFocus
            />
          </div>
        </div>

        <div className="border-t border-gray-200 pt-5">
          <label className="block text-lg font-semibold text-gray-700 mb-2">Find by receipt number</label>
          <div className="flex gap-3">
            <input
              type="number"
              min="1"
              value={receiptQuery}
              onChange={(e) => {
                setReceiptQuery(e.target.value);
                setReceiptError('');
              }}
              placeholder="Enter receipt number"
              className="min-w-0 flex-1 text-lg border-2 border-gray-300 rounded-xl py-4 px-5 focus:border-blue-600 focus:outline-none"
            />
            <button
              type="button"
              onClick={findByReceiptNumber}
              disabled={receiptSearching}
              className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white font-semibold px-5 rounded-xl transition-colors"
            >
              {receiptSearching ? <Loader2 className="w-5 h-5 animate-spin" /> : <Search className="w-5 h-5" />}
              Find
            </button>
          </div>
          {receiptError && <p className="text-red-600 text-sm mt-2">{receiptError}</p>}
        </div>

        {searching && (
          <p className="text-gray-400 flex items-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Searching...
          </p>
        )}

        {!searching && query.trim() && results.length === 0 && (
          <p className="text-gray-400 text-lg">No customers found.</p>
        )}

        <div className="divide-y divide-gray-100 border border-gray-200 rounded-xl overflow-hidden">
          {results.map((c) => (
            <button
              key={c.id}
              onClick={() => selectCustomer(c)}
              className="w-full text-left px-5 py-4 hover:bg-blue-50 transition-colors"
            >
              <p className="text-lg font-semibold text-gray-900">{c.name}</p>
              <p className="text-base text-gray-500 flex items-center gap-1">
                <Phone className="w-4 h-4" />
                {c.mobile}
              </p>
            </button>
          ))}
        </div>

        {loadingDetails && (
          <p className="text-gray-400 flex items-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Loading details...
          </p>
        )}
      </div>
    </PageWrapper>
  );
}

/* ============================================================
   CUSTOMER DETAIL VIEW
   ============================================================ */
function CustomerDetailView({
  customer,
  onBack,
  onHome,
  onDeleted,
}: {
  customer: CustomerWithDetails;
  onBack: () => void;
  onHome: () => void;
  onDeleted: () => void;
}) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [printCoupon, setPrintCoupon] = useState<Coupon | null>(null);
  const [printPaymentDate, setPrintPaymentDate] = useState<string | null>(null);

  async function handleDelete() {
    setDeleting(true);
    setDeleteError('');
    const { error } = await supabase.from('customers').delete().eq('id', customer.id);
    setDeleting(false);
    if (error) {
      setDeleteError('Could not delete customer. Please try again.');
      return;
    }
    onDeleted();
  }

  if (printCoupon) {
    return (
      <PrintCouponView
        coupon={printCoupon}
        paymentDate={printPaymentDate ?? printCoupon.created_at}
        customerName={customer.name}
        customerMobile={customer.mobile}
        onBack={() => setPrintCoupon(null)}
      />
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 sm:py-12">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-blue-600 text-base sm:text-lg font-semibold mb-4 sm:mb-6 hover:underline"
      >
        <ArrowLeft className="w-5 h-5" /> Back to Search
      </button>

      {/* Customer header */}
      <div className="bg-blue-600 rounded-2xl p-5 sm:p-6 text-white mb-6">
        <h2 className="text-xl sm:text-2xl font-bold">{customer.name}</h2>
        <p className="text-lg text-blue-100 flex items-center gap-1 mt-1">
          <Phone className="w-5 h-5" />
          {customer.mobile}
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-6">
        <DetailCard label="Total Amount Paid" value={formatRupees(customer.total_paid)} />
        <DetailCard label="Total Payments" value={customer.payment_count.toString()} />
        <DetailCard label="Total Coupons" value={customer.coupon_count.toString()} />
        <DetailCard
          label="Remaining Balance"
          value={formatRupees(customer.remaining_balance)}
        />
      </div>

      {/* Coupon numbers with print buttons */}
      {customer.coupon_numbers.length > 0 && (
        <div className="mb-6">
          <h3 className="text-lg sm:text-xl font-bold text-gray-900 mb-3">All Coupon Numbers</h3>
          <div className="space-y-2">
            {customer.coupon_numbers.map((n) => {
              const couponObj = customer.payments
                .flatMap((p) => p.coupons)
                .find((co) => co.coupon_number === n);
              const linkedPayment = customer.payments.find((p) =>
                p.coupons.some((co) => co.coupon_number === n)
              );
              return (
                <div
                  key={n}
                  className="flex items-center justify-between bg-blue-50 border-2 border-blue-200 rounded-lg px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-blue-600 font-bold text-xl">{formatCouponNumber(n)}</span>
                    {linkedPayment && (
                      <span className="text-xs text-gray-400">Receipt #{linkedPayment.receipt_number}</span>
                    )}
                  </div>
                  {couponObj && (
                    <button
                      onClick={() => {
                        setPrintCoupon(couponObj);
                        setPrintPaymentDate(linkedPayment?.created_at ?? couponObj.created_at);
                      }}
                      className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-3 py-2 rounded-lg transition-colors"
                    >
                      <Printer className="w-4 h-4" /> Print
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Payment history */}
      <div>
        <h3 className="text-lg sm:text-xl font-bold text-gray-900 mb-3">Payment History</h3>
        {customer.payments.length === 0 ? (
          <p className="text-gray-400 text-lg">No payments yet.</p>
        ) : (
          <div className="space-y-3">
            {customer.payments.map((p) => (
              <div key={p.id} className="border border-gray-200 rounded-xl p-4 sm:p-5">
                <div className="flex justify-between items-start gap-3 mb-2">
                  <div className="min-w-0">
                    <p className="text-xl sm:text-2xl font-bold text-gray-900">{formatRupees(p.amount)}</p>
                    <p className="text-sm text-gray-400">{formatDateTime(p.created_at)}</p>
                    <p className="text-sm text-blue-600 font-semibold mt-1">Receipt No. {p.receipt_number}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="inline-block bg-blue-100 text-blue-600 font-semibold px-3 py-1 rounded-lg text-sm">
                      {p.coupons_earned} {p.coupons_earned === 1 ? 'coupon' : 'coupons'}
                    </span>
                    <p className="text-sm text-gray-400 mt-1">
                      Balance: {formatRupees(p.balance_after)}
                    </p>
                  </div>
                </div>
                {p.coupons.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <p className="text-sm text-gray-500 mb-2">Coupon Numbers</p>
                    <div className="flex flex-wrap gap-2">
                      {p.coupons.map((co) => (
                        <span
                          key={co.id}
                          className="bg-blue-600 text-white font-bold px-3 py-1 rounded-lg"
                        >
                          {formatCouponNumber(co.coupon_number)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {deleteError && (
        <div className="mt-4">
          <ErrorMessage message={deleteError} />
        </div>
      )}

      {/* Delete customer section */}
      {showDeleteConfirm ? (
        <div className="mt-6 bg-red-50 border-2 border-red-200 rounded-xl p-5">
          <p className="text-lg font-semibold text-red-700 mb-2">Delete this customer?</p>
          <p className="text-base text-red-600 mb-4">
            This will permanently remove {customer.name}, all their payments, and all their coupons. This cannot be undone.
          </p>
          <div className="flex gap-3">
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="flex-1 flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 disabled:bg-gray-300 text-white text-lg font-semibold py-3 rounded-xl transition-colors"
            >
              {deleting ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> Deleting...</>
              ) : (
                <><Trash2 className="w-5 h-5" /> Yes, Delete</>
              )}
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-700 text-lg font-semibold py-3 rounded-xl transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowDeleteConfirm(true)}
          className="w-full mt-6 flex items-center justify-center gap-2 bg-white border-2 border-red-300 hover:bg-red-50 text-red-600 text-lg font-semibold py-4 rounded-xl transition-colors"
        >
          <Trash2 className="w-5 h-5" /> Delete Customer
        </button>
      )}

      <button
        onClick={onHome}
        className="w-full mt-3 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-lg sm:text-xl font-semibold py-4 rounded-xl transition-colors"
      >
        <ArrowLeft className="w-5 h-5" /> Home
      </button>
    </div>
  );
}

/* ============================================================
   PRINT COUPON VIEW — A4 landscape, two matching copies
   ============================================================ */
function PrintCouponView({
  coupon,
  paymentDate,
  customerName,
  customerMobile,
  onBack,
}: {
  coupon: Coupon;
  paymentDate: string;
  customerName: string;
  customerMobile: string;
  onBack: () => void;
}) {
  const copies = ['OFFICE COPY', 'CUSTOMER COPY'];

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="no-print max-w-2xl mx-auto px-4 py-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-blue-600 text-base sm:text-lg font-semibold mb-4 hover:underline"
        >
          <ArrowLeft className="w-5 h-5" /> Back to Customer
        </button>
        <button
          onClick={() => window.print()}
          className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-xl font-semibold py-4 rounded-xl transition-colors mb-4"
        >
          <Printer className="w-6 h-6" /> Print Coupon
        </button>
        <p className="text-center text-gray-400 text-sm">Prints two matching copies on one A4 landscape sheet.</p>
      </div>

      <div className="print-area">
        <div className="coupon-sheet">
          {copies.map((copy) => (
            <section className="coupon-copy" key={copy}>
              <img className="coupon-watermark" src="/images/image.png" alt="" aria-hidden="true" />
              <div className="coupon-content">
                <header className="coupon-header">
                  <img className="coupon-logo" src="/images/image.png" alt="Jagannath Store logo" />
                  <div>
                    <h1>M/s. JAGANNATH STORE</h1>
                    <p>AT./P.O.-ATTABIRA,DIST-BARGARH(ODISHA),PIN-768027</p>
                    <p>Mob: 9437201099 / 9778287200</p>
                    <p>e-mail: jagannathatb.telecom@gmail.com</p>
                  </div>
                </header>
                <div className="coupon-copy-label">{copy}</div>
                <div className="coupon-fields">
                  <div><span>Coupon Number</span><strong>{formatCouponNumber(coupon.coupon_number)}</strong></div>
                  <div><span>Customer Name</span><strong>{customerName}</strong></div>
                  <div><span>Mobile Number</span><strong>{customerMobile}</strong></div>
                  <div><span>Payment Date</span><strong>{formatDate(paymentDate)}</strong></div>
                  
                </div>
                <div className="coupon-signature"><span>Signature</span><div /></div>
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   ALL CUSTOMERS VIEW — summary of every customer with coupons
   ============================================================ */
function AllCustomersView({
  onBack,
  onSelectCustomer,
}: {
  onBack: () => void;
  onSelectCustomer: () => void;
}) {
  const [customers, setCustomers] = useState<CustomerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: custData }, { data: payData }, { data: couponData }] = await Promise.all([
        supabase.from('customers').select('*').order('name', { ascending: true }),
        supabase.from('payments').select('customer_id, amount'),
        supabase.from('coupons').select('customer_id, coupon_number').order('coupon_number', { ascending: true }),
      ]);

      const allCustomers = custData ?? [];
      const allPayments = payData ?? [];
      const allCoupons = couponData ?? [];

      const summaries: CustomerSummary[] = allCustomers.map((c) => {
        const custPayments = allPayments.filter((p) => p.customer_id === c.id);
        const custCoupons = allCoupons.filter((co) => co.customer_id === c.id);
        return {
          ...c,
          total_paid: custPayments.reduce((sum, p) => sum + p.amount, 0),
          payment_count: custPayments.length,
          coupon_count: custCoupons.length,
          coupon_numbers: custCoupons.map((co) => co.coupon_number),
        };
      });

      setCustomers(summaries);
      setLoading(false);
    })();
  }, []);

  return (
    <PageWrapper title="All Customers" onBack={onBack}>
      {loading ? (
        <p className="text-gray-400 flex items-center gap-2 text-lg">
          <Loader2 className="w-5 h-5 animate-spin" /> Loading customers...
        </p>
      ) : customers.length === 0 ? (
        <p className="text-gray-400 text-lg">No customers yet. Add your first customer to get started.</p>
      ) : (
        <div className="space-y-3">
          {customers.map((c) => (
            <div key={c.id} className="border border-gray-200 rounded-xl overflow-hidden">
              {/* Customer row — tap to expand */}
              <button
                onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                className="w-full text-left px-4 py-4 sm:px-5 hover:bg-blue-50 transition-colors flex items-center justify-between gap-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-bold text-gray-900 truncate">{c.name}</p>
                  <p className="text-base text-gray-500 flex items-center gap-1">
                    <Phone className="w-4 h-4 shrink-0" />
                    <span className="truncate">{c.mobile}</span>
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <div className="text-right">
                    <span className="inline-block bg-blue-100 text-blue-600 font-bold px-3 py-1 rounded-lg text-sm">
                      {c.coupon_count} {c.coupon_count === 1 ? 'coupon' : 'coupons'}
                    </span>
                    <p className="text-sm text-gray-400 mt-1">{formatRupees(c.total_paid)}</p>
                  </div>
                  <ChevronRight
                    className={`w-5 h-5 text-gray-400 transition-transform shrink-0 ${
                      expandedId === c.id ? 'rotate-90' : ''
                    }`}
                  />
                </div>
              </button>

              {/* Expanded details */}
              {expandedId === c.id && (
                <div className="px-4 sm:px-5 pb-5 pt-1 border-t border-gray-100 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <MiniStat label="Total Paid" value={formatRupees(c.total_paid)} />
                    <MiniStat label="Payments" value={c.payment_count.toString()} />
                    <MiniStat label="Coupons" value={c.coupon_count.toString()} />
                    <MiniStat label="Balance" value={formatRupees(c.remaining_balance)} />
                  </div>

                  {c.coupon_numbers.length > 0 ? (
                    <div>
                      <p className="text-sm text-gray-500 mb-2 font-semibold">Coupon Numbers</p>
                      <div className="flex flex-wrap gap-2">
                        {c.coupon_numbers.map((n) => (
                          <span
                            key={n}
                            className="bg-blue-600 text-white font-bold px-3 py-1.5 rounded-lg text-base"
                          >
                            {formatCouponNumber(n)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-gray-400 text-base">No coupons earned yet.</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </PageWrapper>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-3 text-center">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-lg font-bold text-gray-900">{value}</p>
    </div>
  );
}

function DetailCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
      <p className="text-base text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
    </div>
  );
}

/* ============================================================
   SHARED UI COMPONENTS
   ============================================================ */
function PageWrapper({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-6 sm:py-12">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-blue-600 text-base sm:text-lg font-semibold mb-4 sm:mb-6 hover:underline"
      >
        <ArrowLeft className="w-5 h-5" /> Back
      </button>
      <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-6 sm:mb-8">{title}</h1>
      {children}
    </div>
  );
}

function LargeInput({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  required = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label className="block text-lg font-semibold text-gray-700 mb-2">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full text-lg border-2 border-gray-300 rounded-xl py-4 px-5 focus:border-blue-600 focus:outline-none transition-colors"
      />
    </div>
  );
}

function SaveButton({
  loading,
  label,
  disabled = false,
}: {
  loading: boolean;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 text-white text-xl font-semibold py-5 rounded-xl transition-colors"
    >
      {loading ? (
        <>
          <Loader2 className="w-6 h-6 animate-spin" /> Saving...
        </>
      ) : (
        label
      )}
    </button>
  );
}

function SuccessMessage({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-3 bg-green-50 border-2 border-green-200 rounded-xl py-5 px-6">
      <div className="flex items-center justify-center w-10 h-10 bg-green-500 rounded-full shrink-0">
        <Check className="w-6 h-6 text-white" />
      </div>
      <p className="text-lg font-semibold text-green-700">{message}</p>
    </div>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-3 bg-red-50 border-2 border-red-200 rounded-xl py-4 px-5">
      <AlertCircle className="w-6 h-6 text-red-500 shrink-0" />
      <p className="text-base text-red-600">{message}</p>
    </div>
  );
}
