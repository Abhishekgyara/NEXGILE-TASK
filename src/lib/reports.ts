import type { CustomerRow, Finding, FixRun, ReconciliationResult, Refund, SeedWorld, WorkerLog } from './types';
import { dateTime, moneyMinor, num } from './format';
import { totalMinor } from './reconciliation';
import { FIXES } from './fixes';

export interface ReportInputs {
  world: SeedWorld;
  findings: Finding[];
  reconciliation: ReconciliationResult;
  fixRun: FixRun | null;
  customerRows: CustomerRow[];
  generatedAt: string;
}

function usdTotal(minor: number): string {
  return moneyMinor(minor, 'USD');
}

function netDiscrepancyUsd(inputs: ReportInputs): number {
  return inputs.reconciliation.netDiscrepancyMinor;
}

function reconciliationHealth(result: ReconciliationResult): 'BALANCED' | 'IMBALANCED' {
  return result.netDiscrepancyMinor === 0
    && result.providerOnlyCount === 0
    && result.ledgerOnlyCount === 0
    && result.duplicateCount === 0
    && result.amountMismatchCount === 0
    && result.currencyMismatchCount === 0
    ? 'BALANCED'
    : 'IMBALANCED';
}

function simulationState(fixRun: FixRun | null): string {
  if (fixRun?.acknowledgedAt) return `Corrected simulation applied at ${dateTime(fixRun.acknowledgedAt)}`;
  if (fixRun?.revertedAt) return `Corrections reverted at ${dateTime(fixRun.revertedAt)}`;
  if (fixRun) return `Dry run completed at ${dateTime(fixRun.ranAt)}; corrections have not been applied`;
  return 'Baseline synthetic records are active; no corrected run has been acknowledged';
}

export function buildUnderstanding(inputs: ReportInputs): string {
  const { world, findings } = inputs;
  const dupFindings = findings.filter((f) => f.kind === 'DUPLICATE_REFUND');
  const missingLedger = findings.filter((f) => f.kind === 'MISSING_LEDGER');
  const amountMismatch = findings.filter((f) => f.kind === 'AMOUNT_MISMATCH');
  const currencyMismatch = findings.filter((f) => f.kind === 'CURRENCY_MISMATCH');
  const workerFailures = world.workerLogs.filter((l) => l.level === 'ERROR');
  const example = dupFindings.length
    ? `${dupFindings[0].refundId} currently has duplicate provider settlements`
    : missingLedger.length
      ? `${missingLedger[0].refundId} currently has a provider settlement without a ledger entry`
      : 'no current reconciliation anomalies are present';
  const originalGap = inputs.fixRun?.acknowledgedAt
    ? ` Discrepancy before this fix run was ${usdTotal(inputs.fixRun.before.netDiscrepancyMinor)}.`
    : '';
  const health = reconciliationHealth(inputs.reconciliation);

  return `# UNDERSTANDING

Generated: ${dateTime(inputs.generatedAt)}

## Architecture
- React SPA (React Router, Recharts, Tailwind) for the dashboard UI.
- Deterministic synthetic data layer models customers, orders, refunds, provider settlements, ledger entries, worker jobs, and worker logs.
- Reconciliation engine compares provider settlements against ledger entries transaction by transaction.
- A corrected-processing pipeline produces before/after financial snapshots and verification checks.

## Workflow
1. Refund requests are created per order and priced in the customer's currency.
2. Workers claim jobs, call the provider, and post ledger entries.
3. Reconciliation compares every provider settlement to its ledger entries.
4. Findings are classified (duplicate, missing ledger, amount mismatch, currency mismatch) and drive the Fix & Recovery flow.

## Current simulation observations
- Active state: ${simulationState(inputs.fixRun)}.
- ${num(findings.length)} findings in the current workspace: ${num(dupFindings.length)} duplicates, ${num(missingLedger.length)} missing ledger entries, ${num(amountMismatch.length)} amount mismatches, ${num(currencyMismatch.length)} currency mismatches.
- Net financial exposure: ${usdTotal(netDiscrepancyUsd(inputs))}.
- Reconciliation health: ${health} — ${inputs.reconciliation.matchedCount} matched, ${inputs.reconciliation.providerOnlyCount} provider-only, ${inputs.reconciliation.duplicateCount} duplicate settlements.
- Current dataset: ${num(world.customers.length)} customers, ${num(world.orders.length)} orders, and ${num(world.refunds.length)} refunds.
- ${num(workerFailures.length)} worker error log entries are present in the current workspace.

## Root-cause hypotheses
1. No idempotency keys on provider calls (duplicates after retries).
2. No atomic job claiming (race conditions between workers).
3. Blind retries on timeout without a provider status probe.
4. Ledger writes decoupled from provider settlement, with no sweeper.
5. Stale FX fallback rate plus float arithmetic (FX mis-booking).
6. No bounded retry/lease protocol on crashed workers.

## Current evidence
- Provider settlements: ${num(world.providerTransactions.length)} records, ${usdTotal(totalMinor(world.providerTransactions))}.
- Ledger entries: ${num(world.ledgerEntries.length)} records, ${usdTotal(totalMinor(world.ledgerEntries))}.
- Worker jobs: ${num(world.workerJobs.length)}; worker logs: ${num(world.workerLogs.length)}.
- Current example: ${example}.${originalGap}
- Reconciliation run: ${inputs.reconciliation.id} (${inputs.reconciliation.label}), ${dateTime(inputs.reconciliation.ranAt)}.

## Alternative approaches considered
- Rebuilding the ledger from provider records only: rejected, loses internal state transitions.
- Streaming event-sourcing rewrite: rejected for scope; targeted fixes are sufficient and verifiable.

## Implementation plan
1. Add idempotency keys and atomic claiming (highest financial impact).
2. Add provider status probe before retries.
3. Same-transaction ledger posting plus a reconciliation sweeper.
4. Decimal-based FX with pinned rates.
5. Bounded retries with backoff and lease-based recovery.
`;
}

export function buildDecisions(inputs: ReportInputs): string {
  const { findings, reconciliation } = inputs;
  const health = reconciliationHealth(reconciliation);
  const passedChecks = inputs.fixRun?.check.filter((check) => check.status === 'PASS').length ?? 0;
  return `# DECISIONS

Generated: ${dateTime(inputs.generatedAt)}

## Current workspace context
- Simulation state: ${simulationState(inputs.fixRun)}.
- Reconciliation: ${health}, ${usdTotal(reconciliation.netDiscrepancyMinor)} net discrepancy across ${num(reconciliation.rows.length)} rows.
- Current findings: ${num(findings.length)}; provider-only ${num(reconciliation.providerOnlyCount)}, duplicate ${num(reconciliation.duplicateCount)}, ledger-only ${num(reconciliation.ledgerOnlyCount)}.
- Latest fix run: ${inputs.fixRun ? `${passedChecks}/${inputs.fixRun.check.length} checks passed` : 'not run'}.

## Decisions
1. **Model data deterministically first.** A fixed-seed dataset makes every bug reproducible and every report verifiable. Evidence: ${num(inputs.world.refunds.length)} refunds regenerate identically.
2. **Compute reconciliation against records, not UI state.** Findings are derived from provider and ledger records only. Evidence: ${num(findings.length)} findings derived from ${num(inputs.world.providerTransactions.length)} settlements vs ${num(inputs.world.ledgerEntries.length)} ledger entries.
3. **Never claim a fix works without a verification check.** Each fix runs a concrete assertion against corrected records before they can be acknowledged.
4. **Report net discrepancy in USD minor units.** All currencies convert through pinned rates for comparability.

## Current evidence
- ${num(reconciliation.providerOnlyCount)} provider-only settlements (ledger never recorded).
- ${num(reconciliation.duplicateCount)} duplicate settlements for single refunds.
- ${num(reconciliation.amountMismatchCount)} amount mismatches between provider and ledger.
- ${num(reconciliation.currencyMismatchCount)} currency mismatches (e.g. EUR settlement booked as USD).

## Root-cause hypotheses
- Duplicate settlements in the current run: ${num(findings.filter((finding) => finding.kind === 'DUPLICATE_REFUND').length)}.
- Missing ledger entries in the current run: ${num(findings.filter((finding) => finding.kind === 'MISSING_LEDGER').length)}.
- These are synthetic test outcomes, not claims about a live payment provider or production incident.

## Technical trade-offs
- SQL-backed synthetic records over a full provider sandbox: deterministic, auditable, no real money.
- Server-side reconciliation over client-side filtering: keeps totals authoritative.
- Acknowledgment applies a per-account corrected simulation view with an audit timestamp; source database rows remain unchanged and can be restored by reverting the simulation.
`;
}

export function buildReport(inputs: ReportInputs): string {
  const { findings, reconciliation, fixRun } = inputs;
  const dup = findings.filter((f) => f.kind === 'DUPLICATE_REFUND');
  const missing = findings.filter((f) => f.kind === 'MISSING_LEDGER');
  const amt = findings.filter((f) => f.kind === 'AMOUNT_MISMATCH');
  const cur = findings.filter((f) => f.kind === 'CURRENCY_MISMATCH');
  const totalGap = netDiscrepancyUsd(inputs);
  const dupUsd = dup.reduce((s, f) => s + f.differenceMinor, 0);
  const missingUsd = missing.reduce((s, f) => s + f.differenceMinor, 0);
  const amtUsd = amt.reduce((s, f) => s + Math.abs(f.differenceMinor), 0);
  const curUsd = cur.reduce((s, f) => s + Math.abs(f.differenceMinor), 0);
  const failedJobs = inputs.world.workerJobs.filter((j) => j.status === 'FAILED').length;
  const errors = inputs.world.workerLogs.filter((l) => l.level === 'ERROR').length;
  const before = fixRun?.before;
  const after = fixRun?.after;
  const passedChecks = fixRun?.check.filter((check) => check.status === 'PASS').length ?? 0;

  const cfo = fixRun?.acknowledgedAt && totalGap === 0
    ? `The corrected synthetic simulation is balanced with a $0.00 USD reconciliation gap. ${passedChecks} of ${fixRun.check.length} checks passed, and the changes were acknowledged at ${dateTime(fixRun.acknowledgedAt)}. This is a simulation only; no source database records or customer payments were changed.`
    : totalGap === 0
      ? 'No net financial discrepancy is currently recorded in the active simulation. Check the reconciliation detail for offsetting issues before treating the books as balanced.'
      : `The provider has ${moneyMinor(Math.abs(totalGap), 'USD')} ${totalGap > 0 ? 'more' : 'less'} recorded than the ledger, with ${num(dup.length)} duplicate refunds and ${num(missing.length)} missing ledger entries. Review the root causes and dry-run checks; no real customer recovery has been initiated.`;

  return `# REPORT

Generated: ${dateTime(inputs.generatedAt)}

## 1. Gap breakdown
- Duplicate refunds: ${num(dup.length)} findings, ${usdTotal(dupUsd)} exposure.
- Missing ledger entries: ${num(missing.length)} findings, ${usdTotal(missingUsd)} exposure.
- Amount mismatches: ${num(amt.length)} findings, ${usdTotal(amtUsd)} exposure.
- Currency mismatches: ${num(cur.length)} findings, ${usdTotal(curUsd)} exposure.
- Failed worker jobs: ${num(failedJobs)}; worker error log entries: ${num(errors)}.
- Reconciliation: ${reconciliation.matchedCount} matched, ${reconciliation.providerOnlyCount} provider-only, ${reconciliation.ledgerOnlyCount} ledger-only, ${reconciliation.duplicateCount} duplicates.
- Total estimated exposure: ${usdTotal(totalGap)}.

## 2. Fixes and proof
${fixRun
    ? fixRun.check.map((c, i) => `${i + 1}. ${FIXES.find((f) => f.id === c.fixId)?.name ?? c.fixId}: **${c.status}** — ${c.detail}`).join('\n')
    : 'No corrected run executed yet. Run "Run Corrected Simulation" on the Fix & Recovery page to generate verified results.'}
${before && after ? `\nBefore: net discrepancy ${usdTotal(before.netDiscrepancyMinor)}, ${before.duplicateCount} duplicates.\nAfter: net discrepancy ${usdTotal(after.netDiscrepancyMinor)}, ${after.duplicateCount} duplicates.\n` : ''}
${fixRun?.acknowledgedAt ? `Corrections acknowledged: ${dateTime(fixRun.acknowledgedAt)}.\n` : ''}
${fixRun?.revertedAt ? `Corrections reverted: ${dateTime(fixRun.revertedAt)}.\n` : ''}

## 3. Customers paid twice
${inputs.customerRows.filter((c) => c.duplicateMinor > 0).slice(0, 20).map((c) => `- ${c.id} (${c.name}): duplicate exposure ${moneyMinor(c.duplicateMinor, 'USD')} USD-equivalent across ${num(c.refundCount)} refunds — ${c.recoveryNote}`).join('\n') || '- No customers with duplicate payouts found.'}

## 4. Note to CFO
${cfo.split(' ').length <= 150 ? cfo : cfo.split(' ').slice(0, 150).join(' ')}

## 5. Current interpretation
- Findings above describe the current simulated view; the counts update after each reconciliation or correction action.
- Root-cause statements are hypotheses based on synthetic evidence and should not be read as conclusions about a live system.

## 6. Not done and not known
- No real payment provider was contacted; all settlements are synthetic.
- Clawback is a dry-run preview only; no customer recovery has been initiated.
- Actual production FX contract terms and provider fee schedules are unknown.
- Historical root causes outside the 21-day seeded window are not modeled.
`;
}

export function buildReadme(inputs: ReportInputs): string {
  const { world, reconciliation, findings, fixRun } = inputs;
  const health = reconciliationHealth(reconciliation);
  const passedChecks = fixRun?.check.filter((check) => check.status === 'PASS').length ?? 0;
  return `# RefundGuard README

Generated: ${dateTime(inputs.generatedAt)}

## Project setup
RefundGuard is a financial reconciliation and debugging platform: it demonstrates how refund pipelines lose money, reproduces six concrete failure scenarios, reconciles provider settlements against the internal ledger, and verifies corrected processing logic.

## Current workspace snapshot
- State: ${simulationState(fixRun)}.
- Reconciliation: ${health}; net discrepancy ${usdTotal(reconciliation.netDiscrepancyMinor)}.
- Current findings: ${num(findings.length)}; provider settlements ${num(world.providerTransactions.length)}; ledger entries ${num(world.ledgerEntries.length)}.
- Customers: ${num(world.customers.length)}; orders: ${num(world.orders.length)}; refund requests: ${num(world.refunds.length)}.
- Latest corrected run: ${fixRun ? `${passedChecks}/${fixRun.check.length} checks passed` : 'not run'}.

## Architecture
- **Frontend**: React 18 + TypeScript, React Router pages, Recharts visualizations, Tailwind styling, shared app store.
- **Backend**: FastAPI with account-aware endpoints and SQL persistence (MySQL supported; SQLite used for tests).
- **Data layer**: shared synthetic demo records plus account-owned customers, orders, and refunds.
- **Engines**: server-side reconciliation, findings classifier, corrected-processing pipeline with verification checks.
- **Reports**: UNDERSTANDING, DECISIONS, REPORT, README generated from computed findings.
- **Simulation safety**: acknowledging verified fixes changes the per-user projected view; underlying source rows remain unchanged and can be restored by reverting.

## Installation
\`\`\`bash
npm install
\`\`\`

## Execution
\`\`\`bash
npm run dev      # start the app
npm run build    # production build
\`\`\`

For the API, configure \`backend/.env\` as described in \`backend/README.md\`, then run:
\`\`\`powershell
uvicorn backend.main:app --reload
\`\`\`

## API surface
- \`GET /api/world\` — current account-visible synthetic records.
- \`GET /api/findings\` and \`POST /api/reconciliation/run\` — current anomaly and reconciliation results.
- \`POST /api/fixes/run\` — verify proposed corrections without applying them.
- \`POST /api/fixes/acknowledge\` and \`POST /api/fixes/revert\` — apply or revert the synthetic projection.
- \`GET /api/customers/recovery\` — current customer recovery preview; no real recovery payments are made.

## Testing instructions
1. Run backend tests with \`python -m unittest backend.test_api\`.
2. Run frontend checks with \`npm run typecheck\` and \`npm run build\`.
3. Run Reconciliation and compare its classification counts with the current findings.
4. On Fix & Recovery, run a dry run and confirm every verification check passes before acknowledging it.
5. After acknowledgment, confirm the dashboard and reports reflect the balanced projection; revert to restore the initial synthetic view.
`;
}

export function buildCustomerCsv(rows: CustomerRow[]): string {
  const header = 'customer_id,name,email,currency,refund_count,intended_usd_minor,paid_usd_minor,duplicate_usd_minor,recovery';
  const lines = rows.map((r) => [r.id, r.name, r.email, r.currency, r.refundCount, r.intendedMinor, r.paidMinor, r.duplicateMinor, r.recovery].join(','));
  return [header, ...lines].join('\n');
}

export function buildReconciliationCsv(result: ReconciliationResult, refunds: Refund[]): string {
  const customerById = new Map(refunds.map((r) => [r.id, r.customerId]));
  const header = 'settlement_id,refund_id,customer_id,provider_usd_minor,ledger_usd_minor,usd_difference_minor,currency,side';
  const lines = result.rows.map((r) => [r.settlementId, r.refundId, customerById.get(r.refundId ?? '') ?? '', r.providerMinor, r.ledgerMinor, r.differenceMinor, r.currency, r.side].join(','));
  return [header, ...lines].join('\n');
}

export function buildLogsCsv(logs: WorkerLog[]): string {
  const header = 'id,worker_id,refund_id,level,event,status,message,created_at';
  const lines = logs.map((l) => [l.id, l.workerId, l.refundId ?? '', l.level, l.event, l.status, `"${l.message.replace(/"/g, '""')}"`, l.createdAt].join(','));
  return [header, ...lines].join('\n');
}
