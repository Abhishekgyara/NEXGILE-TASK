import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Eye, Plus, Zap } from 'lucide-react';
import { Button, Card, Column, ConfirmDialog, DataTable, FilterSelect, Modal, SearchInput, Badge, useDebounced } from '@/components/ui';
import { useStore } from '@/lib/store';
import { dateTime, moneyMinor } from '@/lib/format';
import type { Refund, RefundRequestInput } from '@/lib/types';

const CURRENCIES = ['USD', 'EUR', 'GBP'] as const;

export function RefundOperationsPage() {
  const { world, simulateRefundProcessing } = useStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [currencyFilter, setCurrencyFilter] = useState('ALL');
  const [createOpen, setCreateOpen] = useState(false);
  const [detail, setDetail] = useState<Refund | null>(null);
  const [confirmRefund, setConfirmRefund] = useState<Refund | null>(null);

  const selectedId = searchParams.get('refund');
  const selected = useMemo(() => world.refunds.find((r) => r.id === selectedId) ?? null, [world, selectedId]);

  const filtered = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    return world.refunds.filter((r) => {
      if (q && !r.id.toLowerCase().includes(q) && !r.customerId.toLowerCase().includes(q) && !r.orderId.toLowerCase().includes(q)) return false;
      if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
      if (currencyFilter !== 'ALL' && r.currency !== currencyFilter) return false;
      return true;
    });
  }, [world, debounced, statusFilter, currencyFilter]);

  const columns: Column<Refund>[] = [
    { key: 'id', header: 'Refund ID', render: (r) => <span className="font-medium text-slate-800">{r.id}</span>, sortValue: (r) => r.id },
    { key: 'customer', header: 'Customer', render: (r) => r.customerId, sortValue: (r) => r.customerId },
    { key: 'order', header: 'Order', render: (r) => r.orderId },
    { key: 'amount', header: 'Amount', align: 'right', render: (r) => moneyMinor(r.amountMinor, r.currency), sortValue: (r) => r.amountMinor },
    { key: 'currency', header: 'Currency', render: (r) => r.currency },
    { key: 'provider', header: 'Provider Status', render: (r) => <Badge value={r.providerStatus} /> },
    { key: 'ledger', header: 'Ledger Status', render: (r) => <Badge value={r.ledgerStatus} /> },
    { key: 'worker', header: 'Worker', render: (r) => r.workerId ?? '—' },
    { key: 'retries', header: 'Retries', align: 'right', render: (r) => <span className={r.retryCount > 0 ? 'text-amber-600 font-medium' : ''}>{r.retryCount}</span>, sortValue: (r) => r.retryCount },
    { key: 'created', header: 'Created At', render: (r) => <span className="text-slate-500 text-xs">{dateTime(r.createdAt)}</span>, sortValue: (r) => r.createdAt },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (r) => (
        <div className="flex justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
          <Button size="sm" variant="ghost" onClick={() => setDetail(r)} aria-label="View details"><Eye size={14} /></Button>
          {r.status === 'PENDING' ? (
            <Button size="sm" variant="secondary" onClick={() => setConfirmRefund(r)}><Zap size={13} /> Process</Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Refund Operations</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage refund requests, provider settlements, and ledger records.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}><Plus size={15} /> Create Refund Request</Button>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-slate-100">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by refund, customer, or order ID…" />
          <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={[
            { value: 'ALL', label: 'All statuses' },
            { value: 'PENDING', label: 'Pending' },
            { value: 'PROCESSING', label: 'Processing' },
            { value: 'PAID', label: 'Paid' },
            { value: 'FAILED', label: 'Failed' },
          ]} />
          <FilterSelect label="Currency" value={currencyFilter} onChange={setCurrencyFilter} options={[
            { value: 'ALL', label: 'All currencies' },
            ...CURRENCIES.map((c) => ({ value: c, label: c })),
          ]} />
          <span className="ml-auto text-xs text-slate-500">{filtered.length} of {world.refunds.length} refunds</span>
        </div>
        <DataTable columns={columns} rows={filtered} rowKey={(r) => r.id} pageSize={12} onRowClick={(r) => setDetail(r)} />
      </Card>

      <CreateRefundModal open={createOpen} onClose={() => setCreateOpen(false)} />

      {detail ? (
        <Modal open onClose={() => setDetail(null)} title={`Refund ${detail.id} — full event history`} wide footer={<Button variant="secondary" onClick={() => setDetail(null)}>Close</Button>}>
          <RefundDetail refund={detail} />
        </Modal>
      ) : null}

      {selected ? (
        <Modal open onClose={() => setSearchParams({})} title={`Refund ${selected.id} — deep link`} wide footer={<Button variant="secondary" onClick={() => setSearchParams({})}>Close</Button>}>
          <RefundDetail refund={selected} />
        </Modal>
      ) : null}

      <ConfirmDialog
        open={confirmRefund !== null}
        onClose={() => setConfirmRefund(null)}
        title="Simulate refund processing"
        message={`Process ${confirmRefund?.id} end to end: the provider will settle ${confirmRefund ? moneyMinor(confirmRefund.amountMinor, confirmRefund.currency) : ''} and the ledger entry will be posted. No real money moves in simulation mode.`}
        confirmLabel="Process refund"
        tone="primary"
        onConfirm={() => {
          if (confirmRefund) {
            simulateRefundProcessing(confirmRefund.id);
            setConfirmRefund(null);
          }
        }}
      />
    </div>
  );
}

function RefundDetail({ refund }: { refund: Refund }) {
  const { world } = useStore();
  const logs = world.workerLogs.filter((l) => l.refundId === refund.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const txs = world.providerTransactions.filter((t) => t.refundId === refund.id);
  const entries = world.ledgerEntries.filter((l) => l.refundId === refund.id);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Amount', value: moneyMinor(refund.amountMinor, refund.currency) },
          { label: 'Status', value: refund.status },
          { label: 'Worker', value: refund.workerId ?? '—' },
          { label: 'Retries', value: String(refund.retryCount) },
        ].map((s) => (
          <div key={s.label} className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-wide text-slate-500">{s.label}</p>
            <p className="text-sm font-semibold text-slate-800 mt-0.5">{s.value}</p>
          </div>
        ))}
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Provider settlement records</h4>
        {txs.length === 0 ? (
          <p className="text-xs text-slate-500">No provider settlement recorded for this refund.</p>
        ) : (
          <div className="space-y-2">
            {txs.map((t) => (
              <div key={t.id} className="rounded-lg border border-slate-200 px-3 py-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-slate-700">{t.id}</span>
                <Badge value={t.status} />
                <span className="tabular font-medium">{moneyMinor(t.amountMinor, t.currency)}</span>
                <span className="text-slate-400">{t.settlementId}</span>
                <span className="text-slate-400 ml-auto">{dateTime(t.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Ledger entries</h4>
        {entries.length === 0 ? (
          <p className="text-xs text-rose-600">No ledger entry posted — this refund is provider-only.</p>
        ) : (
          <div className="space-y-2">
            {entries.map((l) => (
              <div key={l.id} className="rounded-lg border border-slate-200 px-3 py-2 flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-slate-700">{l.id}</span>
                <Badge value={l.status} />
                <span className="tabular font-medium">{moneyMinor(l.amountMinor, l.currency)}</span>
                <span className="text-slate-400 ml-auto">Recorded {dateTime(l.createdAt)}</span>
                {l.updatedAt ? <span className="text-blue-600">Corrected {dateTime(l.updatedAt)}</span> : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Worker event timeline</h4>
        <ol className="relative border-l-2 border-slate-200 ml-2 space-y-3">
          {logs.map((log) => (
            <li key={log.id} className="ml-4">
              <span className={`absolute -left-[5px] mt-1.5 h-2 w-2 rounded-full ${log.level === 'ERROR' ? 'bg-rose-500' : log.level === 'WARN' ? 'bg-amber-500' : 'bg-blue-500'}`} />
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-slate-700">{log.event}</span>
                <Badge value={log.level} />
                <span className="text-[10px] text-slate-400">{log.workerId} · {dateTime(log.createdAt)}</span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">{log.message}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

function CreateRefundModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { world, createRefund, pushToast } = useStore();
  const [form, setForm] = useState<RefundRequestInput>({ customerId: '', orderId: '', amount: '', currency: 'USD' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const customerOrders = world.orders.filter((o) => o.customerId === form.customerId);
  const selectedOrder = customerOrders.find((order) => order.id === form.orderId);

  const submit = async () => {
    setError(null);
    if (!form.customerId || !selectedOrder) {
      setError('Choose a customer and one of their orders before creating a refund.');
      return;
    }
    if (!/^\d+(?:\.\d{1,2})?$/.test(form.amount.trim())) {
      setError('Enter a positive amount with up to 2 decimal places.');
      return;
    }
    const amountMinor = Math.round(Number(form.amount) * 100);
    if (amountMinor <= 0) {
      setError('Refund amount must be greater than zero.');
      return;
    }
    if (amountMinor > selectedOrder.amountMinor) {
      setError(`Refund amount cannot exceed the order total of ${moneyMinor(selectedOrder.amountMinor, selectedOrder.currency)}.`);
      return;
    }

    setBusy(true);
    try {
      const result = await createRefund({ ...form, currency: selectedOrder.currency });
      if (!result.ok) {
        setError(result.error ?? 'Could not create the refund request.');
        return;
      }
      pushToast('success', `Refund request ${result.refund?.id} created and queued for processing`);
      setForm({ customerId: '', orderId: '', amount: '', currency: 'USD' });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create refund request" footer={
      <>
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={submit} loading={busy}>Create request</Button>
      </>
    }>
      <div className="space-y-4">
        <Field label="Customer ID">
          <select
            value={form.customerId}
            onChange={(e) => {
              setError(null);
              setForm((f) => ({ ...f, customerId: e.target.value, orderId: '' }));
            }}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select a customer…</option>
            {world.customers.map((customer) => (
              <option key={customer.id} value={customer.id}>{customer.id} — {customer.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Order ID">
          <select
            value={form.orderId}
            onChange={(e) => {
              const order = customerOrders.find((item) => item.id === e.target.value);
              setError(null);
              setForm((current) => ({
                ...current,
                orderId: e.target.value,
                currency: order?.currency ?? current.currency,
                amount: '',
              }));
            }}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={!form.customerId}
          >
            <option value="">
              {!form.customerId ? 'Select a customer first' : customerOrders.length ? 'Select an order…' : 'No orders for this customer'}
            </option>
            {customerOrders.map((o) => (
              <option key={o.id} value={o.id}>{o.id} — {moneyMinor(o.amountMinor, o.currency)}</option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount">
            <input
              value={form.amount}
              onChange={(e) => {
                setError(null);
                setForm((f) => ({ ...f, amount: e.target.value }));
              }}
              placeholder="0.00"
              inputMode="decimal"
              max={selectedOrder ? (selectedOrder.amountMinor / 100).toFixed(2) : undefined}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={!selectedOrder}
            />
          </Field>
          <Field label="Currency">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              {selectedOrder?.currency ?? 'Selected order currency'}
            </div>
          </Field>
        </div>
        {selectedOrder ? (
          <p className="text-xs text-slate-500">
            Refunds must use {selectedOrder.currency} and cannot exceed the order total of {moneyMinor(selectedOrder.amountMinor, selectedOrder.currency)}.
          </p>
        ) : null}
        {form.customerId && customerOrders.length === 0 ? (
          <p className="text-xs text-amber-700">This customer has no orders yet. Add an order from the Customers page first.</p>
        ) : null}
        {error ? <p role="alert" className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p> : null}
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
      {children}
    </label>
  );
}
