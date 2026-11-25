import { Card, CardHeader } from '@/components/ui';
import { useStore } from '@/lib/store';
import { num } from '@/lib/format';

export function SettingsPage() {
  const { env, world, kpis } = useStore();

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500 mt-0.5">Simulation environment configuration and dataset information.</p>
      </div>

      <Card>
        <CardHeader title="Simulation environment" subtitle="RefundGuard runs against a deterministic synthetic dataset — never a real payment provider." />
        <div className="px-5 pb-5 divide-y divide-slate-100">
          <SettingRow label="Mode" value={env.mode} note="All operations are simulated; no real money moves." />
          <SettingRow label="Processing engine" value={env.apiBaseUrl} note="Reconciliation and scenario engines run in-process." />
          <SettingRow label="Dataset" value={env.database} note={`${num(world.customers.length)} customers · ${num(world.orders.length)} orders · ${num(world.refunds.length)} refunds`} />
          <SettingRow label="Worker pool" value={env.workerPool} note={`${num(world.workerJobs.length)} jobs · ${num(world.workerLogs.length)} log entries`} />
          <SettingRow label="FX source" value={env.fxSource} note="Pinned at refund creation to avoid stale-rate drift." />
          <SettingRow label="Seed" value="fixed (deterministic)" note="Every reload reproduces the exact same dataset and bugs." />
        </div>
      </Card>

      <Card>
        <CardHeader title="Financial posture" subtitle="Current KPI snapshot used by reports" />
        <div className="px-5 pb-5 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: 'Refund requests', value: num(kpis.totalRefundRequests) },
            { label: 'Provider payout', value: (kpis.totalProviderPayoutMinor / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' }) },
            { label: 'Ledger total', value: (kpis.totalLedgerAmountMinor / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' }) },
            { label: 'Discrepancy', value: (kpis.financialDiscrepancyMinor / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' }) },
            { label: 'Duplicate refunds', value: num(kpis.duplicateRefunds) },
            { label: 'Failed transactions', value: num(kpis.failedTransactions) },
          ].map((s) => (
            <div key={s.label} className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">{s.label}</p>
              <p className="text-sm font-semibold text-slate-800 mt-0.5 tabular">{s.value}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Safety guarantees" subtitle="Hard limits enforced by the platform" />
        <div className="px-5 pb-5 space-y-2">
          {[
            'No connection to a real payment provider, ever.',
            'No real financial transactions are executed; clawbacks are dry-run previews only.',
            'All money is handled in integer minor units (cents) — no floating point in totals.',
            'Reports are generated from computed reconciliation findings, never hardcoded figures.',
            'Resetting clears your analysis history only; demo and account records are retained.',
          ].map((g) => (
            <p key={g} className="text-xs text-slate-600 flex gap-2"><span className="text-emerald-500">✓</span>{g}</p>
          ))}
        </div>
      </Card>
    </div>
  );
}

function SettingRow({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-2 py-3">
      <span className="text-xs font-medium text-slate-500 uppercase tracking-wide min-w-[9rem]">{label}</span>
      <span className="text-sm font-medium text-slate-800">{value}</span>
      <span className="text-xs text-slate-400 w-full sm:w-auto">{note}</span>
    </div>
  );
}
