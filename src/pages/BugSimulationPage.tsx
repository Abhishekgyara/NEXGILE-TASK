import { useState } from 'react';
import { AlertTriangle, ArrowRight, Clock, Play, RotateCcw, ShieldAlert } from 'lucide-react';
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState } from '@/components/ui';
import { SCENARIOS, useStore } from '@/lib/store';
import { dateTime, moneyMinor } from '@/lib/format';

export function BugSimulationPage() {
  const { runs, runningScenario, activeRun, runScenarioAction, resetSimulations, world } = useStore();
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">Bug Simulation</h1>
          <p className="text-sm text-slate-500 mt-0.5">Reproduce six deterministic refund-pipeline failures. Every run writes scenario evidence, provider records, and worker logs.</p>
        </div>
        <Button variant="danger" onClick={() => setConfirmReset(true)}><RotateCcw size={15} /> Reset Simulation</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {SCENARIOS.map((s) => {
          const run = runs.find((r) => r.scenarioId === s.id);
          const target = world.refunds.find((r) => r.id === s.targetRefundId);
          const isRunning = runningScenario === s.id;
          return (
            <Card key={s.id} className="card-hover flex flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-semibold text-slate-800">{s.title}</h3>
                <Badge value={s.severity} />
              </div>
              <p className="mt-2 text-xs text-slate-600 leading-relaxed">{s.example}</p>
              <div className="mt-3 rounded-lg bg-rose-50 border border-rose-100 px-3 py-2">
                <p className="text-[11px] text-rose-700 flex gap-1.5"><ShieldAlert size={13} className="mt-0.5 shrink-0" />{s.impact}</p>
              </div>
              <div className="mt-3 text-[11px] text-slate-500">
                <span className="font-medium text-slate-600">Target refund:</span> {s.targetRefundId}
                {target ? <> · {moneyMinor(target.amountMinor, target.currency)} · {target.customerId}</> : null}
              </div>
              <div className="mt-4 flex items-center justify-between gap-2">
                <Button onClick={() => runScenarioAction(s.id)} loading={isRunning} disabled={runningScenario !== null && !isRunning}>
                  <Play size={14} /> {run ? 'Re-run Simulation' : 'Simulate'}
                </Button>
                {run ? <span className="text-[10px] text-slate-400">Run {run.id.slice(-6)}</span> : null}
              </div>
              {run ? (
                <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                  {run.duplicatedAmountMinor > 0 ? <span className="rounded-full bg-rose-50 text-rose-700 ring-1 ring-rose-200 px-2 py-0.5">Duplicate exposure {moneyMinor(run.duplicatedAmountMinor)}</span> : null}
                  {run.missingLedgerAmountMinor > 0 ? <span className="rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200 px-2 py-0.5">Unbooked {moneyMinor(run.missingLedgerAmountMinor)}</span> : null}
                  {run.fxLossMinor > 0 ? <span className="rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200 px-2 py-0.5">FX loss {moneyMinor(run.fxLossMinor)}</span> : null}
                </div>
              ) : null}
            </Card>
          );
        })}
      </div>

      {activeRun ? (
        <Card>
          <CardHeader title={`${activeRun.scenarioTitle} — event timeline`} subtitle={activeRun.cause} />
          <ol className="relative border-l-2 border-slate-200 ml-5 mr-5 mb-5 space-y-4">
            {activeRun.events.map((e, i) => (
              <li key={i} className="ml-4">
                <span className={`absolute -left-[5px] mt-1.5 h-2 w-2 rounded-full ${e.level === 'ERROR' ? 'bg-rose-500' : e.level === 'WARN' ? 'bg-amber-500' : 'bg-blue-500'}`} />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-medium text-slate-700">{e.event}</span>
                  <Badge value={e.level} />
                  <span className="text-[10px] text-slate-400 flex items-center gap-1"><Clock size={10} />{dateTime(e.at)} · {e.workerId}</span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{e.message}</p>
              </li>
            ))}
          </ol>
          <div className="mx-5 mb-5 rounded-lg bg-navy-900 px-4 py-3 flex items-start gap-2">
            <AlertTriangle size={15} className="text-amber-400 mt-0.5 shrink-0" />
            <p className="text-xs text-navy-100 leading-relaxed">{activeRun.cause}</p>
          </div>
        </Card>
      ) : runs.length === 0 ? (
        <Card>
          <EmptyState
            title="No simulations run yet"
            message="Pick a scenario above and press Simulate. Each run produces an event timeline, provider and ledger evidence, and a root-cause summary."
          />
        </Card>
      ) : null}

      {runs.length > 0 ? (
        <Card>
          <CardHeader title="Simulation runs" subtitle="All scenarios executed in this session" />
          <div className="px-5 pb-5 space-y-2">
            {runs.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 px-4 py-2.5 text-xs">
                <span className="font-medium text-slate-700">{r.scenarioTitle}</span>
                <Badge value={r.severity} />
                <Badge value={r.status} />
                <span className="text-slate-500">{r.targetRefundId}</span>
                <span className="ml-auto text-slate-400">{r.events.length} events</span>
                <ArrowRight size={12} className="text-slate-300" />
                <button className="text-blue-600 hover:text-blue-700 font-medium" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>View timeline</button>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="Reset simulation environment?"
        message="This clears only your scenario, fix-check, and reconciliation history. Shared demo data and all customer, order, and refund records are retained."
        confirmLabel="Reset everything"
        onConfirm={() => {
          resetSimulations();
          setConfirmReset(false);
        }}
      />
    </div>
  );
}
