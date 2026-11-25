import { useMemo, useState } from 'react';
import { Download, Play, ShieldCheck } from 'lucide-react';
import { Badge, Button, Card, CardHeader, Column, DataTable, FilterSelect, KpiCard, LoadingState } from '@/components/ui';
import { useStore } from '@/lib/store';
import { dateTime, moneyMinor, num, pct } from '@/lib/format';
import { buildReconciliationCsv } from '@/lib/reports';
import type { MatchRow, ReconciliationResult } from '@/lib/types';

export function ReconciliationPage() {
  const { reconciliation, runningReconciliation, runReconciliationAction, baseline, world, pushToast } = useStore();
  const [sideFilter, setSideFilter] = useState('ALL');
  const active: ReconciliationResult = reconciliation ?? baseline;

  const summary = [
    { label: 'Matched Transactions', value: num(active.matchedCount), tone: 'good' as const },
    { label: 'Provider-Only', value: num(active.providerOnlyCount), tone: 'bad' as const },
    { label: 'Ledger-Only', value: num(active.ledgerOnlyCount), tone: 'warn' as const },
    { label: 'Duplicate Settlements', value: num(active.duplicateCount), tone: 'bad' as const },
    { label: 'Amount Mismatches', value: num(active.amountMismatchCount), tone: 'warn' as const },
    { label: 'Currency Mismatches', value: num(active.currencyMismatchCount), tone: 'warn' as const },
  ];

  const rows = useMemo(() => {
    const filtered = sideFilter === 'ALL' ? active.rows : active.rows.filter((r) => r.side === sideFilter);
    return [...filtered].sort((a, b) => Math.abs(b.differenceMinor) - Math.abs(a.differenceMinor));
  }, [active, sideFilter]);

  const expectedMissing = active.rows.filter((r) => r.side === 'PROVIDER_ONLY');
  const seededMissingLedger = active.rows.find((row) => row.refundId === 'REF1004');

  const columns: Column<MatchRow>[] = [
    { key: 'settlement', header: 'Settlement ID', render: (r) => <span className="font-medium text-slate-700">{r.settlementId}</span>, sortValue: (r) => r.settlementId },
    { key: 'refund', header: 'Refund ID', render: (r) => r.refundId ?? '—', sortValue: (r) => r.refundId ?? '' },
    { key: 'provider', header: 'Provider (USD eq.)', align: 'right', render: (r) => moneyMinor(r.providerMinor, 'USD'), sortValue: (r) => r.providerMinor },
    { key: 'ledger', header: 'Ledger (USD eq.)', align: 'right', render: (r) => moneyMinor(r.ledgerMinor, 'USD'), sortValue: (r) => r.ledgerMinor },
    { key: 'diff', header: 'Difference (USD)', align: 'right', render: (r) => <span className={r.differenceMinor !== 0 ? 'font-semibold text-rose-600' : 'text-emerald-600'}>{r.differenceMinor > 0 ? '+' : ''}{moneyMinor(r.differenceMinor, 'USD')}</span>, sortValue: (r) => Math.abs(r.differenceMinor) },
    { key: 'side', header: 'Classification', render: (r) => <Badge value={r.side} /> },
  ];

  const downloadCsv = () => {
    const csv = buildReconciliationCsv(active, world.refunds);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reconciliation-${active.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast('success', 'Reconciliation report downloaded as CSV');
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Reconciliation</h1>
          <p className="text-sm text-slate-500 mt-0.5">Provider settlement records compared against internal ledger records, matched per refund.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={downloadCsv}><Download size={15} /> Export CSV</Button>
          <Button onClick={runReconciliationAction} loading={runningReconciliation}><Play size={15} /> Run Reconciliation</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-4">
        {summary.map((s) => (
          <KpiCard key={s.label} label={s.label} value={s.value} tone={s.tone} />
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2">
          <CardHeader
            title={reconciliation ? `Run result — ${reconciliation.label}` : 'Baseline comparison (initial dataset)'}
            subtitle={reconciliation ? `Executed ${dateTime(reconciliation.ranAt)}` : 'Press Run Reconciliation for a fresh engine pass'}
            action={<Badge value={active.netDiscrepancyMinor === 0 ? 'MATCHED' : 'AMOUNT_MISMATCH'} label={active.netDiscrepancyMinor === 0 ? 'BALANCED' : 'NET GAP'} />}
          />
          <div className="px-5 pb-5 grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div className="rounded-lg bg-navy-900 px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-navy-300">Net discrepancy</p>
              <p className={`text-lg font-semibold tabular ${active.netDiscrepancyMinor === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{moneyMinor(active.netDiscrepancyMinor)}</p>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Provider settlements</p>
              <p className="text-lg font-semibold text-slate-800 tabular">{num(world.providerTransactions.length)}</p>
            </div>
            <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Ledger entries</p>
              <p className="text-lg font-semibold text-slate-800 tabular">{num(world.ledgerEntries.length)}</p>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Seeded failure example"
            subtitle={seededMissingLedger?.side === 'MATCHED' ? 'REF1004 is balanced in the corrected simulation' : 'REF1004 was provider-only in the initial dataset'}
          />
          <div className="px-5 pb-5 text-xs text-slate-600 space-y-2">
            <p>REF1004 originally had a $120.00 provider settlement and no ledger entry. Acknowledging the verified fix adds the corrected USD ledger record to the simulation.</p>
            <p className="flex items-start gap-1.5"><ShieldCheck size={13} className="mt-0.5 text-emerald-600 shrink-0" />Current status: <span className="font-medium">{seededMissingLedger?.side ?? 'not present in this reconciliation run'}.</span></p>
            {expectedMissing.length ? (
              <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
                {expectedMissing.slice(0, 3).map((r) => (
                <div key={r.refundId} className="flex justify-between px-3 py-1.5">
                  <span className="font-medium">{r.refundId}</span>
                  <span className="tabular text-rose-600">{moneyMinor(r.differenceMinor, 'USD')}</span>
                </div>
                ))}
              </div>
            ) : <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700">No provider-only settlements remain in the current simulated view.</p>}
          </div>
        </Card>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-slate-100">
          <FilterSelect label="Classification" value={sideFilter} onChange={setSideFilter} options={[
            { value: 'ALL', label: 'All classifications' },
            { value: 'MATCHED', label: 'Matched' },
            { value: 'PROVIDER_ONLY', label: 'Provider-only' },
            { value: 'LEDGER_ONLY', label: 'Ledger-only' },
            { value: 'AMOUNT_MISMATCH', label: 'Amount mismatch' },
            { value: 'CURRENCY_MISMATCH', label: 'Currency mismatch' },
          ]} />
          <span className="ml-auto text-xs text-slate-500">
            {rows.length} rows · match rate {pct(world.providerTransactions.length > 0 ? active.matchedCount / world.providerTransactions.length : 0)}
          </span>
        </div>
        {runningReconciliation ? <LoadingState label="Comparing provider settlements against ledger entries…" /> : (
          <DataTable columns={columns} rows={rows} rowKey={(r) => `${r.settlementId}-${r.refundId}`} pageSize={12} />
        )}
      </Card>
    </div>
  );
}
