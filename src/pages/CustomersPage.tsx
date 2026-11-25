import { useMemo, useState } from 'react';
import { Download, Eye, Plus } from 'lucide-react';
import { Badge, Button, Card, CardHeader, Column, DataTable, Modal, SearchInput, useDebounced } from '@/components/ui';
import { useStore } from '@/lib/store';
import { dateTime, moneyMinor, num } from '@/lib/format';
import { buildCustomerCsv } from '@/lib/reports';
import type { CustomerRow, Order, Refund } from '@/lib/types';

export function CustomersPage() {
  const { customerRows, world, pushToast, createCustomer, createOrder, acknowledgeRecoveryPreview } = useStore();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const [selected, setSelected] = useState<CustomerRow | null>(null);
  const [clawbackPreview, setClawbackPreview] = useState<CustomerRow | null>(null);
  const [createCustomerOpen, setCreateCustomerOpen] = useState(false);
  const [createOrderOpen, setCreateOrderOpen] = useState(false);
  const [acknowledgingPreview, setAcknowledgingPreview] = useState(false);

  const totals = useMemo(() => {
    const intended = customerRows.reduce((s, r) => s + r.intendedMinor, 0);
    const paid = customerRows.reduce((s, r) => s + r.paidMinor, 0);
    const dup = customerRows.reduce((s, r) => s + r.duplicateMinor, 0);
    const clawbackCount = customerRows.filter((r) => r.recovery === 'CLAWBACK_REVIEW').length;
    return { intended, paid, dup, clawbackCount };
  }, [customerRows]);

  const filtered = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    if (!q) return customerRows;
    return customerRows.filter((r) => r.id.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q));
  }, [customerRows, debounced]);

  const orders = useMemo(
    () => [...world.orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [world.orders],
  );
  const customerById = useMemo(() => new Map(world.customers.map((customer) => [customer.id, customer.name])), [world.customers]);
  const orderColumns: Column<Order>[] = [
    { key: 'id', header: 'Order ID', render: (order) => <span className="font-medium text-slate-800">{order.id}</span>, sortValue: (order) => order.id },
    { key: 'customer', header: 'Customer', render: (order) => <span>{customerById.get(order.customerId) ?? order.customerId}</span>, sortValue: (order) => customerById.get(order.customerId) ?? order.customerId },
    { key: 'total', header: 'Order Total', align: 'right', render: (order) => moneyMinor(order.amountMinor, order.currency), sortValue: (order) => order.amountMinor },
    { key: 'currency', header: 'Currency', render: (order) => order.currency },
    { key: 'status', header: 'Status', render: (order) => <Badge value={order.status} /> },
    { key: 'created', header: 'Created At', render: (order) => <span className="text-xs text-slate-500">{dateTime(order.createdAt)}</span>, sortValue: (order) => order.createdAt },
  ];

  const columns: Column<CustomerRow>[] = [
    { key: 'id', header: 'Customer ID', render: (r) => <span className="font-medium text-slate-800">{r.id}</span>, sortValue: (r) => r.id },
    { key: 'name', header: 'Name', render: (r) => <span className="text-slate-600">{r.name}</span>, sortValue: (r) => r.name },
    { key: 'refunds', header: 'Refund Requests', align: 'right', render: (r) => num(r.refundCount), sortValue: (r) => r.refundCount },
    { key: 'intended', header: 'Intended Refund (USD)', align: 'right', render: (r) => moneyMinor(r.intendedMinor), sortValue: (r) => r.intendedMinor },
    { key: 'paid', header: 'Provider Payout (USD)', align: 'right', render: (r) => moneyMinor(r.paidMinor), sortValue: (r) => r.paidMinor },
    { key: 'dup', header: 'Duplicate Amount (USD eq.)', align: 'right', render: (r) => r.duplicateMinor > 0 ? <span className="font-semibold text-rose-600">{moneyMinor(r.duplicateMinor)}</span> : <span className="text-slate-400">—</span>, sortValue: (r) => r.duplicateMinor },
    { key: 'recovery', header: 'Recovery Recommendation', render: (r) => <Badge value={r.recovery} /> },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (r) => (
        <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" onClick={() => setSelected(r)} aria-label="View history"><Eye size={14} /></Button>
          {r.duplicateMinor > 0 ? (
            <Button size="sm" variant="secondary" onClick={() => setClawbackPreview(r)}>Dry-run clawback</Button>
          ) : null}
        </div>
      ),
    },
  ];

  const downloadCsv = () => {
    const blob = new Blob([buildCustomerCsv(customerRows)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'customers-recovery.csv';
    a.click();
    URL.revokeObjectURL(url);
    pushToast('success', 'Customer recovery report downloaded as CSV');
  };

  const acknowledgePreview = async () => {
    if (!clawbackPreview) return;
    setAcknowledgingPreview(true);
    const result = await acknowledgeRecoveryPreview(clawbackPreview.id);
    setAcknowledgingPreview(false);
    if (!result.ok) {
      pushToast('error', result.error ?? 'Could not acknowledge the dry-run preview');
      return;
    }
    pushToast('success', `Preview acknowledged at ${dateTime(result.acknowledgedAt ?? '')}. No recovery payment was made.`);
    setClawbackPreview(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Customers</h1>
          <p className="text-sm text-slate-500 mt-0.5">Customer-level refund exposure with dry-run-only recovery recommendations. No real charges are ever initiated.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={downloadCsv}><Download size={15} /> Export CSV</Button>
          <Button variant="secondary" onClick={() => setCreateOrderOpen(true)}><Plus size={15} /> Add order</Button>
          <Button onClick={() => setCreateCustomerOpen(true)}><Plus size={15} /> Add customer</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Card className="card-hover p-5">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Customers with refunds</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900 tabular">{num(customerRows.length)}</p>
        </Card>
        <Card className="card-hover p-5">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Total intended refunds</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900 tabular">{moneyMinor(totals.intended)}</p>
        </Card>
        <Card className="card-hover p-5">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Total provider payout</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900 tabular">{moneyMinor(totals.paid)}</p>
        </Card>
        <Card className="card-hover p-5">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Duplicate exposure</p>
          <p className="mt-2 text-2xl font-semibold text-rose-700 tabular">{moneyMinor(totals.dup)}</p>
          <p className="text-xs text-slate-500 mt-1">{num(totals.clawbackCount)} customers flagged for clawback review</p>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Orders"
          subtitle="Newly added orders appear here and are available when creating refunds."
          action={<span className="text-xs text-slate-500">{orders.length} total</span>}
        />
        <DataTable
          columns={orderColumns}
          rows={orders}
          rowKey={(order) => order.id}
          pageSize={8}
          emptyTitle="No orders yet"
          emptyMessage="Add an order to a customer to make it available for refund requests."
        />
      </Card>

      <Card>
        <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-slate-100">
          <SearchInput value={search} onChange={setSearch} placeholder="Search customers by ID, name, or email…" />
          <span className="ml-auto text-xs text-slate-500">{filtered.length} customers</span>
        </div>
        <DataTable columns={columns} rows={filtered} rowKey={(r) => r.id} pageSize={12} onRowClick={(r) => setSelected(r)} />
      </Card>

      {selected ? <CustomerHistoryModal row={selected} onClose={() => setSelected(null)} /> : null}
      {createCustomerOpen ? (
        <CustomerCreateModal
          onClose={() => setCreateCustomerOpen(false)}
          onCreate={createCustomer}
          onCreated={() => pushToast('success', 'Customer saved to your account')}
        />
      ) : null}
      {createOrderOpen ? (
        <OrderCreateModal
          customers={world.customers}
          onClose={() => setCreateOrderOpen(false)}
          onCreate={createOrder}
          onCreated={() => pushToast('success', 'Order saved to your account')}
        />
      ) : null}

      {clawbackPreview ? (
        <Modal
          open
          onClose={() => setClawbackPreview(null)}
          title={`Clawback preview (dry run) — ${clawbackPreview.id}`}
          footer={
            <>
              <Button variant="secondary" onClick={() => setClawbackPreview(null)}>Close</Button>
              <Button variant="success" onClick={() => void acknowledgePreview()} loading={acknowledgingPreview} disabled={acknowledgingPreview}>Acknowledge dry run</Button>
            </>
          }
        >
          <div className="space-y-4">
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              This is a preview only. RefundGuard never initiates real customer charges or recovery payments.
            </div>
            <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 text-sm">
              <div className="flex justify-between px-4 py-2.5"><span className="text-slate-600">Duplicate payout exposure (USD eq.)</span><span className="font-semibold tabular text-rose-600">{moneyMinor(clawbackPreview.duplicateMinor, 'USD')}</span></div>
              <div className="flex justify-between px-4 py-2.5"><span className="text-slate-600">Recommended action</span><span className="font-medium text-slate-800">{clawbackPreview.recoveryNote}</span></div>
              <div className="flex justify-between px-4 py-2.5"><span className="text-slate-600">Suggested recovery channel</span><span className="text-slate-800">Credit memo against future payouts</span></div>
              <div className="flex justify-between px-4 py-2.5"><span className="text-slate-600">Customer contact</span><span className="text-slate-800">{clawbackPreview.email}</span></div>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function CustomerCreateModal({
  onClose,
  onCreate,
  onCreated,
}: {
  onClose: () => void;
  onCreate: (input: { name: string; email: string; currency: 'USD' | 'EUR' | 'GBP' }) => Promise<{ ok: boolean; error?: string }>;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [currency, setCurrency] = useState<'USD' | 'EUR' | 'GBP'>('USD');
  const [error, setError] = useState('');

  const submit = async () => {
    const result = await onCreate({ name, email, currency });
    if (!result.ok) {
      setError(result.error ?? 'Could not create customer.');
      return;
    }
    onCreated();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Add customer" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => void submit()}>Save customer</Button></>}>
      <div className="space-y-3">
        <Field label="Name"><input value={name} onChange={(event) => setName(event.target.value)} className={formInputClass} /></Field>
        <Field label="Email"><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} className={formInputClass} /></Field>
        <Field label="Currency"><CurrencySelect value={currency} onChange={setCurrency} /></Field>
        {error ? <p className="text-xs text-rose-600">{error}</p> : null}
      </div>
    </Modal>
  );
}

function OrderCreateModal({
  customers,
  onClose,
  onCreate,
  onCreated,
}: {
  customers: Array<{ id: string; name: string; currency: 'USD' | 'EUR' | 'GBP' }>;
  onClose: () => void;
  onCreate: (input: { customerId: string; amount: string; currency: 'USD' | 'EUR' | 'GBP' }) => Promise<{ ok: boolean; error?: string }>;
  onCreated: () => void;
}) {
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const currency = customers.find((customer) => customer.id === customerId)?.currency ?? 'USD';

  const submit = async () => {
    const result = await onCreate({ customerId, amount, currency });
    if (!result.ok) {
      setError(result.error ?? 'Could not create order.');
      return;
    }
    onCreated();
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Add order" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => void submit()} disabled={!customerId}>Save order</Button></>}>
      <div className="space-y-3">
        <Field label="Customer">
          <select value={customerId} onChange={(event) => setCustomerId(event.target.value)} className={formInputClass}>
            {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.id} — {customer.name}</option>)}
          </select>
        </Field>
        <Field label={`Order total (${currency})`}><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} className={formInputClass} placeholder="0.00" /></Field>
        {error ? <p className="text-xs text-rose-600">{error}</p> : null}
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>{children}</label>;
}

function CurrencySelect({ value, onChange }: { value: 'USD' | 'EUR' | 'GBP'; onChange: (value: 'USD' | 'EUR' | 'GBP') => void }) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value as 'USD' | 'EUR' | 'GBP')} className={formInputClass}>
      <option value="USD">USD</option><option value="EUR">EUR</option><option value="GBP">GBP</option>
    </select>
  );
}

const formInputClass = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

function CustomerHistoryModal({ row, onClose }: { row: CustomerRow; onClose: () => void }) {
  const { world } = useStore();
  const refunds = useMemo(() => world.refunds.filter((r) => r.customerId === row.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [world, row.id]);

  const columns: Column<Refund>[] = [
    { key: 'id', header: 'Refund', render: (r) => <span className="font-medium text-slate-700">{r.id}</span> },
    { key: 'order', header: 'Order', render: (r) => r.orderId },
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => moneyMinor(r.amountMinor, r.currency), sortValue: (r) => r.amountMinor },
    { key: 'status', header: 'Status', render: (r) => <Badge value={r.status} /> },
    { key: 'provider', header: 'Provider', render: (r) => <Badge value={r.providerStatus} /> },
    { key: 'ledger', header: 'Ledger', render: (r) => <Badge value={r.ledgerStatus} /> },
    { key: 'created', header: 'Created', render: (r) => <span className="text-xs text-slate-500">{dateTime(r.createdAt)}</span>, sortValue: (r) => r.createdAt },
  ];

  return (
    <Modal open onClose={onClose} title={`${row.id} — ${row.name}`} wide footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Refunds', value: num(row.refundCount) },
            { label: 'Intended (USD)', value: moneyMinor(row.intendedMinor) },
            { label: 'Paid (USD)', value: moneyMinor(row.paidMinor) },
            { label: 'Duplicate (USD eq.)', value: moneyMinor(row.duplicateMinor) },
          ].map((s) => (
            <div key={s.label} className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">{s.label}</p>
              <p className="text-sm font-semibold text-slate-800 mt-0.5 tabular">{s.value}</p>
            </div>
          ))}
        </div>
        {row.duplicateMinor > 0 ? (
          <div className="rounded-lg bg-rose-50 border border-rose-200 px-4 py-3 text-xs text-rose-700">{row.recoveryNote}</div>
        ) : null}
        <DataTable columns={columns} rows={refunds} rowKey={(r) => r.id} pageSize={6} emptyTitle="No refunds" emptyMessage="This customer has no refund requests yet." />
      </div>
    </Modal>
  );
}
