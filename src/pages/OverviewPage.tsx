import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Copy, DollarSign, Landmark, ShieldCheck, Undo2, XCircle } from 'lucide-react';
import { Card, CardHeader, KpiCard, Badge, Button, EmptyState } from '@/components/ui';
import { DailyVolumeChart, ProviderVsLedgerChart, StatusPieChart } from '@/components/charts';
import { useStore } from '@/lib/store';
import { dateTime, moneyMinor, num, pct } from '@/lib/format';
import { toUsd } from '@/lib/reconciliation';

export function OverviewPage() {
  const { kpis, world, findings, recentLogs, baseline } = useStore();

  const chartDays = useMemo(() => {
    const timestamps = [
      ...world.refunds.map((refund) => Date.parse(refund.createdAt)),
      ...world.providerTransactions.map((transaction) => Date.parse(transaction.createdAt)),
      ...world.ledgerEntries.map((entry) => Date.parse(entry.createdAt)),
    ].filter(Number.isFinite);
    const lastDate = new Date(Math.max(Date.now(), ...timestamps));
    lastDate.setUTCHours(0, 0, 0, 0);
    return Array.from({ length: 14 }, (_, index) =>
      new Date(lastDate.getTime() - (13 - index) * 86400_000).toISOString().slice(0, 10),
    );
  }, [world]);

  const providerSeries = useMemo(() => {
    const byDay = new Map(chartDays.map((date) => [date, { day: date.slice(5), providerMinor: 0, ledgerMinor: 0 }]));
    for (const tx of world.providerTransactions) {
      const day = tx.createdAt.slice(0, 10);
      const bucket = byDay.get(day);
      if (bucket) bucket.providerMinor += toUsd(tx.amountMinor, tx.currency);
    }
    for (const entry of world.ledgerEntries) {
      const day = entry.createdAt.slice(0, 10);
      const bucket = byDay.get(day);
      if (bucket) bucket.ledgerMinor += toUsd(entry.amountMinor, entry.currency);
    }
    return [...byDay.values()];
  }, [chartDays, world]);

  const volumeSeries = useMemo(() => {
    const byDay = new Map(chartDays.map((date) => [date, { day: date.slice(5), count: 0 }]));
    for (const r of world.refunds) {
      const day = r.createdAt.slice(0, 10);
      const bucket = byDay.get(day);
      if (bucket) bucket.count += 1;
    }
    return [...byDay.values()];
  }, [chartDays, world]);

  const statusPie = useMemo(() => {
    const counts = { PAID: 0, PROCESSING: 0, PENDING: 0, FAILED: 0 };
    for (const r of world.refunds) counts[r.status] += 1;
    return [
      { name: 'Paid', value: counts.PAID },
      { name: 'Processing', value: counts.PROCESSING },
      { name: 'Pending', value: counts.PENDING },
      { name: 'Failed', value: counts.FAILED },
    ];
  }, [world]);

  const recentIncidents = findings.slice(0, 5);
  const isBalanced = kpis.financialDiscrepancyMinor === 0
    && findings.length === 0
    && baseline.providerOnlyCount === 0
    && baseline.ledgerOnlyCount === 0
    && baseline.duplicateCount === 0
    && baseline.amountMismatchCount === 0
    && baseline.currencyMismatchCount === 0;
  const health = isBalanced ? 'BALANCED' : Math.abs(kpis.discrepancyPct) < 0.02 ? 'DEGRADED' : 'IMBALANCED';
  const healthColor = health === 'BALANCED'
    ? 'text-emerald-700'
    : health === 'DEGRADED'
      ? 'text-amber-700'
      : 'text-rose-700';
  const healthSurface = health === 'BALANCED'
    ? 'border-emerald-200 bg-emerald-50'
    : health === 'DEGRADED'
      ? 'border-amber-200 bg-amber-50'
      : 'border-rose-200 bg-rose-50';

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Overview</h1>
        <p className="text-sm text-slate-500 mt-0.5">Live financial posture across provider settlements and the internal ledger.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <KpiCard label="Total Refund Requests" value={num(kpis.totalRefundRequests)} sub={`${kpis.pendingRefunds} pending · ${kpis.processingRefunds} processing`} tone="info" icon={<Undo2 size={16} />} />
        <KpiCard label="Total Provider Payout" value={moneyMinor(kpis.totalProviderPayoutMinor)} sub="Sum of all provider settlements" tone="neutral" icon={<DollarSign size={16} />} />
        <KpiCard label="Total Ledger Amount" value={moneyMinor(kpis.totalLedgerAmountMinor)} sub="Sum of all posted ledger entries" tone="neutral" icon={<Landmark size={16} />} />
        <KpiCard label="Financial Discrepancy" value={moneyMinor(kpis.financialDiscrepancyMinor)} sub={`${pct(kpis.discrepancyPct)} of provider payout unaccounted`} tone={kpis.financialDiscrepancyMinor !== 0 ? 'bad' : 'good'} icon={<AlertTriangle size={16} />} />
        <KpiCard label="Duplicate Refunds" value={num(kpis.duplicateRefunds)} sub="Refunds with more than one provider settlement" tone={kpis.duplicateRefunds > 0 ? 'bad' : 'good'} icon={<Copy size={16} />} />
        <KpiCard label="Failed Transactions" value={num(kpis.failedTransactions)} sub="Refunds rejected or errored in processing" tone={kpis.failedTransactions > 0 ? 'warn' : 'good'} icon={<XCircle size={16} />} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2">
          <CardHeader title="Provider vs Ledger" subtitle="Daily USD-equivalent values from the latest 14 days of records" />
          <div className="px-3 pb-4"><ProviderVsLedgerChart data={providerSeries} /></div>
        </Card>
        <Card>
          <CardHeader title="Reconciliation Health" subtitle="Current comparison of provider vs ledger" />
          <div className="px-5 pb-5 flex flex-col items-center">
            <div className={`w-full rounded-lg border px-4 py-5 text-center ${healthSurface}`}>
              <ShieldCheck size={28} className={`mx-auto ${healthColor}`} />
              <p className={`mt-2 text-lg font-semibold ${healthColor}`}>{health}</p>
              <p className="text-xs text-slate-600 mt-1">
                Net gap {moneyMinor(baseline.netDiscrepancyMinor)} · {num(baseline.matchedCount)} matched · {num(baseline.providerOnlyCount)} provider-only · {num(baseline.duplicateCount)} duplicates
              </p>
            </div>
            <Link to="/reconciliation" className="mt-4 w-full"><Button variant="secondary" className="w-full">Open reconciliation</Button></Link>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card>
          <CardHeader title="Daily Refund Volume" subtitle="Requests created per day across the latest 14 days of records" />
          <div className="px-3 pb-4"><DailyVolumeChart data={volumeSeries} /></div>
        </Card>
        <Card>
          <CardHeader title="Refund Status Distribution" subtitle="All refund requests by current status" />
          <div className="px-3 pb-4"><StatusPieChart data={statusPie} /></div>
        </Card>
        <Card>
          <CardHeader title="Latest Worker Activity" subtitle="Most recent worker log entries"
            action={<Link to="/workers" className="text-xs font-medium text-blue-600 hover:text-blue-700">View all</Link>} />
          <div className="px-5 pb-5 space-y-3">
            {recentLogs.slice(0, 5).map((log) => (
              <div key={log.id} className="flex items-start gap-2.5">
                <Badge value={log.level} />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-700 truncate">{log.refundId ?? '—'} · {log.event}</p>
                  <p className="text-[11px] text-slate-500 truncate">{log.message}</p>
                  <p className="text-[10px] text-slate-400">{log.workerId} · {dateTime(log.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent Financial Incidents" subtitle="Highest-impact findings from the reconciliation engine"
          action={<Link to="/investigation" className="text-xs font-medium text-blue-600 hover:text-blue-700">Investigate</Link>} />
        {recentIncidents.length === 0 ? (
          <EmptyState title="No incidents" message="No financial discrepancies were detected in the current dataset." />
        ) : (
          <div className="px-5 pb-5 space-y-3">
            {recentIncidents.map((f) => (
              <div key={f.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 px-4 py-3">
                <Badge value={f.kind} />
                <span className="text-sm font-medium text-slate-700">{f.refundId}</span>
                <span className="text-xs text-slate-500">{f.customerId}</span>
                <span className="text-xs text-slate-500 flex-1 min-w-[12rem]">{f.cause}</span>
                <span className="text-sm font-semibold tabular text-rose-600">{moneyMinor(f.differenceMinor, 'USD')}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
