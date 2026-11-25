import { Badge, Button, Card, CardHeader, EmptyState } from '@/components/ui';
import { useStore } from '@/lib/store';
import { FIXES } from '@/lib/fixes';
import { dateTime, moneyMinor, num } from '@/lib/format';

export function FixRecoveryPage() {
  const { fixRun, runningFixes, runFixesAction, acknowledgeFixesAction, revertFixesAction, fixStatuses } = useStore();

  const allPass = fixRun ? fixRun.check.every((c) => c.status === 'PASS') : false;
  const applied = Boolean(fixRun?.acknowledgedAt);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Fix & Recovery</h1>
          <p className="text-sm text-slate-500 mt-0.5">Verify proposed fixes, then acknowledge to apply them to your synthetic workspace. The underlying database records are never modified.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!applied ? (
            <Button variant="secondary" onClick={runFixesAction} loading={runningFixes} disabled={runningFixes}>
              Run Corrected Dry Run
            </Button>
          ) : null}
          {allPass && !applied ? (
            <Button variant="success" onClick={() => void acknowledgeFixesAction()} loading={runningFixes} disabled={runningFixes}>
              Acknowledge Dry Run & Apply
            </Button>
          ) : null}
          {applied ? (
            <Button variant="secondary" onClick={() => void revertFixesAction()} loading={runningFixes} disabled={runningFixes}>
              Revert Simulation Corrections
            </Button>
          ) : null}
        </div>
      </div>

      {fixRun ? (
        <Card>
          <CardHeader
            title={applied ? 'Verified corrections applied to simulation' : allPass ? 'Corrected dry run verified — all checks passed' : 'Corrected dry run finished with failing checks'}
            subtitle={`Run ${dateTime(fixRun.ranAt)}${fixRun.acknowledgedAt ? ` · Applied ${dateTime(fixRun.acknowledgedAt)}` : ''}${fixRun.revertedAt ? ` · Reverted ${dateTime(fixRun.revertedAt)}` : ''}`}
            action={<Badge value={applied ? 'APPLIED' : allPass ? 'PASS' : 'FAIL'} label={applied ? 'SIMULATION UPDATED' : allPass ? 'VERIFIED' : 'CHECK FAILURES'} />}
          />
          {applied ? (
            <div role="status" className="mx-5 mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
              The dashboard, findings, reconciliation, and worker activity now use the corrected synthetic records. Original database rows are preserved; use “Revert Simulation Corrections” to restore the initial imbalanced view.
            </div>
          ) : allPass ? (
            <div className="mx-5 mb-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800">
              All checks passed. Acknowledge the dry run to update your synthetic workspace and make the dashboard reflect the balanced result.
            </div>
          ) : null}
          <div className="px-5 pb-5 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Before applying corrections</p>
              <dl className="mt-3 space-y-1.5 text-sm">
                <Row k="Net discrepancy" v={moneyMinor(fixRun.before.netDiscrepancyMinor)} tone="bad" />
                <Row k="Provider payout total" v={moneyMinor(fixRun.before.providerPayoutMinor)} />
                <Row k="Ledger total" v={moneyMinor(fixRun.before.ledgerTotalMinor)} />
                <Row k="Duplicate settlements" v={num(fixRun.before.duplicateCount)} />
                <Row k="Refund requests" v={num(fixRun.before.refundCount)} />
              </dl>
            </div>
            <div className={`rounded-lg border px-4 py-4 ${allPass ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
              <p className={`text-xs font-semibold uppercase tracking-wide ${allPass ? 'text-emerald-700' : 'text-amber-700'}`}>After corrected simulation</p>
              <dl className="mt-3 space-y-1.5 text-sm">
                <Row k="Net discrepancy" v={moneyMinor(fixRun.after.netDiscrepancyMinor)} tone={Math.abs(fixRun.after.netDiscrepancyMinor) < Math.abs(fixRun.before.netDiscrepancyMinor) ? 'good' : 'bad'} />
                <Row k="Provider payout total" v={moneyMinor(fixRun.after.providerPayoutMinor)} />
                <Row k="Ledger total" v={moneyMinor(fixRun.after.ledgerTotalMinor)} />
                <Row k="Duplicate settlements" v={num(fixRun.after.duplicateCount)} />
                <Row k="Refund requests" v={num(fixRun.after.refundCount)} />
              </dl>
            </div>
          </div>
          <div className="px-5 pb-5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Verification checks (corrected dry-run output)</h4>
            <div className="space-y-2">
              {fixRun.check.map((c) => {
                const fix = FIXES.find((f) => f.id === c.fixId);
                return (
                  <div key={c.fixId} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 px-4 py-2.5">
                    <Badge value={c.status} />
                    <span className="text-sm font-medium text-slate-700">{fix?.name ?? c.fixId}</span>
                    <span className="text-xs text-slate-500 flex-1 min-w-[14rem]">{c.detail}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <EmptyState
            title="No corrected run yet"
            message="Press Run Corrected Simulation to execute the corrected backend processing logic against the seeded refunds, re-run reconciliation, and compare before/after results."
          />
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {FIXES.map((fix) => (
          <Card key={fix.id} className="card-hover p-5 flex flex-col">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-800">{fix.name}</h3>
              <Badge value={fixStatuses[fix.id]} />
            </div>
            <div className="mt-3 space-y-3 text-xs leading-relaxed">
              <div>
                <p className="font-semibold text-rose-700 uppercase tracking-wide text-[10px]">Root cause</p>
                <p className="text-slate-600 mt-0.5">{fix.rootCause}</p>
              </div>
              <div>
                <p className="font-semibold text-blue-700 uppercase tracking-wide text-[10px]">Proposed solution</p>
                <p className="text-slate-600 mt-0.5">{fix.solution}</p>
              </div>
              <div>
                <p className="font-semibold text-emerald-700 uppercase tracking-wide text-[10px]">Guarantees</p>
                <ul className="mt-0.5 space-y-0.5">
                  {fix.guarantees.map((g) => (
                    <li key={g} className="text-slate-600 flex gap-1.5"><span className="text-emerald-500">✓</span>{g}</li>
                  ))}
                </ul>
              </div>
            </div>
            {fixRun ? (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <p className="text-[11px] text-slate-500">
                  <span className="font-medium">Test status:</span>{' '}
                  <Badge value={fixRun.check.find((c) => c.fixId === fix.id)?.status ?? 'PROPOSED'} label={fixRun.check.find((c) => c.fixId === fix.id)?.status ?? 'NOT RUN'} />
                </p>
              </div>
            ) : null}
          </Card>
        ))}
      </div>
    </div>
  );
}

function Row({ k, v, tone }: { k: string; v: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-600">{k}</dt>
      <dd className={`font-semibold tabular ${tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-rose-700' : 'text-slate-800'}`}>{v}</dd>
    </div>
  );
}

