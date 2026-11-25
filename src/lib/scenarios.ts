import type { SimulationEvent, SimulationRun, SeedWorld, Refund } from './types';
import { SIM_TZ } from './seedData';

export interface ScenarioDef {
  id: string;
  title: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  example: string;
  impact: string;
  rootCause: string;
  targetRefundId: string;
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'duplicate_refund',
    title: 'Duplicate Refund',
    severity: 'CRITICAL',
    example: 'Customer C101 requests $100. Worker 1 sends $100 successfully, crashes before updating the ledger, and the retry sends another $100.',
    impact: 'Provider pays $200 for an intended $100 refund. $100 is lost to double payout.',
    rootCause: 'No idempotency key on provider calls: a retry after a crash cannot tell the provider "this refund was already paid".',
    targetRefundId: 'REF1001',
  },
  {
    id: 'race_condition',
    title: 'Race Condition',
    severity: 'CRITICAL',
    example: 'Two workers read REF1002 as PENDING at the same time. Both process the same $50 refund concurrently.',
    impact: 'Provider pays $100 instead of $50 — a second settlement is created with no coordination.',
    rootCause: 'Jobs are read without atomic claiming or row locks, so two workers can own the same refund.',
    targetRefundId: 'REF1002',
  },
  {
    id: 'provider_timeout',
    title: 'Provider Timeout',
    severity: 'HIGH',
    example: 'The provider processes a $75 refund for REF1003 but the response times out. The application retries blindly.',
    impact: 'An uncertain response is treated as failure, so the retry pays the customer twice.',
    rootCause: 'Retry logic does not query provider status before re-sending, so timeouts become duplicates.',
    targetRefundId: 'REF1003',
  },
  {
    id: 'missing_ledger',
    title: 'Missing Ledger Entry',
    severity: 'HIGH',
    example: 'The provider records REF1004 as $120 paid, but no matching ledger entry exists internally.',
    impact: 'Books show $120 less paid out than reality; reconciliation can never balance.',
    rootCause: 'Ledger write runs in a separate step after the provider call with no recovery job for missed writes.',
    targetRefundId: 'REF1004',
  },
  {
    id: 'fx_error',
    title: 'FX Conversion Error',
    severity: 'MEDIUM',
    example: 'Refund = EUR 100 for REF1005. FX rate = 1.10 USD per EUR, so the expected USD amount is $110.00.',
    impact: 'A stale fallback rate (1.05) plus float rounding books $105.00 — a $5.00 silent loss per refund.',
    rootCause: 'Stale FX fallback and float arithmetic instead of a decimal-based, pinned-rate conversion.',
    targetRefundId: 'REF1005',
  },
  {
    id: 'worker_crash',
    title: 'Worker Crash and Retry',
    severity: 'MEDIUM',
    example: 'A worker crashes while processing REF1006. The refund state is left half-processed before the retry recovers it.',
    impact: 'Without safe retry semantics, a crash between provider call and ledger write loses or duplicates money.',
    rootCause: 'No acknowledgement protocol: crashes leave jobs in limbo and retries restart from scratch.',
    targetRefundId: 'REF1006',
  },
];

export function runScenario(scenarioId: string, world: SeedWorld): SimulationRun {
  const def = SCENARIOS.find((s) => s.id === scenarioId) ?? SCENARIOS[0];
  const refund = world.refunds.find((r) => r.id === def.targetRefundId) ?? world.refunds[0];
  const events: SimulationEvent[] = [];
  let duplicated = 0;
  let missingLedger = 0;
  let fxLoss = 0;

  const push = (at: string, workerId: string, level: SimulationEvent['level'], event: string, message: string) => {
    events.push({ at, workerId, level, event, message });
  };

  switch (scenarioId) {
    case 'duplicate_refund': {
      const t0 = SIM_TZ - 6 * 24 * 3600_000;
      push(new Date(t0).toISOString(), 'worker-01', 'INFO', 'JOB_CLAIMED', `Claimed ${refund.id} ($100.00) from the queue`);
      push(new Date(t0 + 60_000).toISOString(), 'worker-01', 'INFO', 'PROVIDER_CALL', 'Provider accepted $100.00 settlement (attempt 1)');
      push(new Date(t0 + 61_000).toISOString(), 'worker-01', 'ERROR', 'WORKER_CRASH', 'Worker crashed before writing the ledger entry');
      push(new Date(t0 + 300_000).toISOString(), 'worker-01', 'WARN', 'RETRY_QUEUED', 'Job requeued — no idempotency key checked against provider');
      push(new Date(t0 + 305_000).toISOString(), 'worker-01', 'INFO', 'PROVIDER_CALL', 'Provider accepted $100.00 settlement (attempt 2, duplicate)');
      push(new Date(t0 + 306_000).toISOString(), 'worker-01', 'ERROR', 'DUPLICATE_PAYMENT', 'Provider now holds $200.00 for an intended $100.00 refund');
      duplicated = 10000;
      break;
    }
    case 'race_condition': {
      const t0 = SIM_TZ - 5 * 24 * 3600_000;
      push(new Date(t0).toISOString(), 'worker-02', 'INFO', 'JOB_READ', `Read ${refund.id} status = PENDING (no row lock, no atomic claim)`);
      push(new Date(t0 + 900).toISOString(), 'worker-03', 'INFO', 'JOB_READ', `Read ${refund.id} status = PENDING (no row lock, no atomic claim)`);
      push(new Date(t0 + 60_000).toISOString(), 'worker-02', 'INFO', 'PROVIDER_CALL', 'Worker-02 settled $50.00 with the provider');
      push(new Date(t0 + 60_500).toISOString(), 'worker-03', 'INFO', 'PROVIDER_CALL', 'Worker-03 settled $50.00 with the provider');
      push(new Date(t0 + 61_000).toISOString(), 'worker-02', 'ERROR', 'DUPLICATE_PAYMENT', 'Two workers paid the same refund: $100.00 instead of $50.00');
      duplicated = 5000;
      break;
    }
    case 'provider_timeout': {
      const t0 = SIM_TZ - 4 * 24 * 3600_000;
      push(new Date(t0).toISOString(), 'worker-03', 'INFO', 'PROVIDER_CALL', `Sent $75.00 refund for ${refund.id}`);
      push(new Date(t0 + 30_000).toISOString(), 'worker-03', 'WARN', 'PROVIDER_TIMEOUT', 'Client timed out after 30s — but the provider had actually settled the refund');
      push(new Date(t0 + 35_000).toISOString(), 'worker-03', 'WARN', 'RETRY_NO_VERIFY', 'Retried immediately without querying provider status first');
      push(new Date(t0 + 36_000).toISOString(), 'worker-03', 'ERROR', 'DUPLICATE_PAYMENT', 'Provider accepted a second $75.00 settlement for the same refund');
      duplicated = 7500;
      break;
    }
    case 'missing_ledger': {
      const t0 = SIM_TZ - 3 * 24 * 3600_000;
      push(new Date(t0).toISOString(), 'worker-04', 'INFO', 'PROVIDER_CALL', `Provider settled ${refund.id} for $120.00`);
      push(new Date(t0 + 500).toISOString(), 'worker-04', 'ERROR', 'LEDGER_INSERT_MISSING', 'Worker died before the ledger insert committed');
      push(new Date(t0 + 3600_000).toISOString(), 'worker-04', 'WARN', 'NO_RECOVERY', 'No recovery job re-scans settled refunds for missing ledger entries');
      push(new Date(t0 + 3610_000).toISOString(), 'worker-04', 'ERROR', 'BOOKS_OFFLINE', 'Provider shows $120.00 paid; internal ledger shows nothing');
      missingLedger = 12000;
      break;
    }
    case 'fx_error': {
      const t0 = SIM_TZ - 2 * 24 * 3600_000;
      push(new Date(t0).toISOString(), 'worker-01', 'INFO', 'FX_LOOKUP', `Needed EUR→USD for ${refund.id}; correct rate 1.10 → $110.00`);
      push(new Date(t0 + 100).toISOString(), 'worker-01', 'WARN', 'FX_RATE_STALE', 'FX service down; fell back to stale cached rate 1.05');
      push(new Date(t0 + 200).toISOString(), 'worker-01', 'WARN', 'FLOAT_ROUNDING', 'Float arithmetic + ad-hoc rounding produced $105.00 instead of $110.00');
      push(new Date(t0 + 300).toISOString(), 'worker-01', 'ERROR', 'BOOKED_WRONG_AMOUNT', 'Ledger posted $105.00 — $5.00 under-booked per refund');
      fxLoss = 500;
      break;
    }
    case 'worker_crash':
    default: {
      const t0 = SIM_TZ - 1 * 24 * 3600_000;
      push(new Date(t0).toISOString(), 'worker-02', 'INFO', 'JOB_CLAIMED', `Claimed ${refund.id} ($64.00)`);
      push(new Date(t0 + 45_000).toISOString(), 'worker-02', 'ERROR', 'WORKER_CRASH', 'Worker OOM-killed mid-processing; refund left in PROCESSING with no ack');
      push(new Date(t0 + 46_000).toISOString(), 'worker-02', 'WARN', 'ORPHANED_JOB', 'No lease timeout returned the job to the queue automatically');
      push(new Date(t0 + 300_000).toISOString(), 'worker-02', 'WARN', 'RETRY_QUEUED', 'Manual requeue after crash; state unknown, retry starts from scratch');
      push(new Date(t0 + 305_000).toISOString(), 'worker-02', 'INFO', 'PROVIDER_CALL', 'Provider accepted $64.00 on the retry attempt');
      push(new Date(t0 + 306_000).toISOString(), 'worker-02', 'INFO', 'LEDGER_POSTED', 'Ledger entry finally posted — recovered, but with an uncontrolled window');
      break;
    }
  }

  const run: SimulationRun = {
    id: `SIM-${scenarioId}-${new Date(SIM_TZ).getTime()}`,
    scenarioId,
    scenarioTitle: def.title,
    status: 'COMPLETED',
    severity: def.severity,
    startedAt: new Date(SIM_TZ - 5000).toISOString(),
    finishedAt: new Date(SIM_TZ).toISOString(),
    duplicatedAmountMinor: duplicated,
    missingLedgerAmountMinor: missingLedger,
    fxLossMinor: fxLoss,
    events,
    cause: def.rootCause,
    targetRefundId: def.targetRefundId,
  };
  return run;
}

export function scenarioLedgerImpact(run: SimulationRun): { duplicated: number; missingLedger: number; fxLoss: number } {
  return { duplicated: run.duplicatedAmountMinor, missingLedger: run.missingLedgerAmountMinor, fxLoss: run.fxLossMinor };
}

export function refundLabel(refund: Refund): string {
  return `${refund.id} · ${refund.customerId} · ${(refund.amountMinor / 100).toFixed(2)} ${refund.currency}`;
}
