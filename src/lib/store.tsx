import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { AppEnv, CustomerRow, DiscrepancyRow, FixRun, ReconciliationResult, Refund, RefundRequestInput, SimulationRun, SeedWorld, WorkerLog } from './types';
import { buildSeedWorld } from './seedData';
import { computeFindings, defaultFixStatuses, runReconciliation, toUsd, totalMinor } from './reconciliation';
import { SCENARIOS } from './scenarios';
import { FIXES } from './fixes';
import type { Finding } from './reconciliation';

type FixStatus = 'PROPOSED' | 'VERIFIED' | 'APPLIED';

function statusesFromFixRun(run: FixRun, applied: boolean): Record<string, FixStatus> {
  const statuses: Record<string, FixStatus> = defaultFixStatuses();
  for (const check of run.check) {
    statuses[check.fixId] = check.status === 'PASS' ? (applied ? 'APPLIED' : 'VERIFIED') : 'PROPOSED';
  }
  return statuses;
}

export interface Toast {
  id: string;
  kind: 'success' | 'error' | 'info';
  message: string;
}

export interface DashboardKpis {
  totalRefundRequests: number;
  totalProviderPayoutMinor: number;
  totalLedgerAmountMinor: number;
  financialDiscrepancyMinor: number;
  duplicateRefunds: number;
  failedTransactions: number;
  discrepancyPct: number;
  pendingRefunds: number;
  processingRefunds: number;
}

interface StoreValue {
  world: SeedWorld;
  findings: Finding[];
  kpis: DashboardKpis;
  baseline: ReconciliationResult;
  reconciliation: ReconciliationResult | null;
  runningReconciliation: boolean;
  runs: SimulationRun[];
  runningScenario: string | null;
  activeRun: SimulationRun | null;
  fixRun: FixRun | null;
  runningFixes: boolean;
  fixStatuses: Record<string, FixStatus>;
  toasts: Toast[];
  env: AppEnv;
  pushToast: (kind: Toast['kind'], message: string) => void;
  dismissToast: (id: string) => void;
  runReconciliationAction: () => void;
  runScenarioAction: (scenarioId: string) => void;
  resetSimulations: () => void;
  runFixesAction: () => void;
  acknowledgeFixesAction: () => Promise<void>;
  revertFixesAction: () => Promise<void>;
  createRefund: (input: RefundRequestInput) => Promise<{ ok: boolean; error?: string; refund?: Refund }>;
  createCustomer: (input: { name: string; email: string; currency: 'USD' | 'EUR' | 'GBP' }) => Promise<{ ok: boolean; error?: string }>;
  createOrder: (input: { customerId: string; amount: string; currency: 'USD' | 'EUR' | 'GBP' }) => Promise<{ ok: boolean; error?: string }>;
  acknowledgeRecoveryPreview: (customerId: string) => Promise<{ ok: boolean; error?: string; acknowledgedAt?: string }>;
  simulateRefundProcessing: (refundId: string) => Promise<void>;
  customerRows: CustomerRow[];
  discrepancyRows: DiscrepancyRow[];
  recentLogs: WorkerLog[];
}

const StoreContext = createContext<StoreValue | null>(null);

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api';

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = typeof result === 'object' && result !== null && 'detail' in result
      ? String(result.detail)
      : `Backend request failed (${response.status})`;
    throw new Error(detail);
  }
  return result as T;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [world, setWorld] = useState<SeedWorld>(buildSeedWorld);
  const [runs, setRuns] = useState<SimulationRun[]>([]);
  const [runningScenario, setRunningScenario] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<SimulationRun | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationResult | null>(null);
  const [runningReconciliation, setRunningReconciliation] = useState(false);
  const [fixRun, setFixRun] = useState<FixRun | null>(null);
  const [runningFixes, setRunningFixes] = useState(false);
  const [fixStatuses, setFixStatuses] = useState(defaultFixStatuses());
  const [toasts, setToasts] = useState<Toast[]>([]);

  const pushToast = useCallback((kind: Toast['kind'], message: string) => {
    const id = `t-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    setToasts((prev) => [...prev.slice(-3), { id, kind, message }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const refreshWorld = useCallback(async () => {
    const nextWorld = await apiRequest<SeedWorld>('/world');
    setWorld(nextWorld);
    return nextWorld;
  }, []);

  useEffect(() => {
    Promise.all([
      refreshWorld(),
      apiRequest<SimulationRun[]>('/simulations'),
      apiRequest<ReconciliationResult>('/reconciliation'),
      apiRequest<FixRun | null>('/fixes/latest'),
    ]).then(([, savedRuns, savedReconciliation, savedFixRun]) => {
      setRuns(savedRuns);
      setActiveRun(savedRuns[0] ?? null);
      if (savedReconciliation.label !== 'baseline') setReconciliation(savedReconciliation);
      setFixRun(savedFixRun);
      if (savedFixRun) {
        setFixStatuses(statusesFromFixRun(savedFixRun, Boolean(savedFixRun.acknowledgedAt)));
      }
    }).catch((error: unknown) => {
      pushToast('error', error instanceof Error ? error.message : 'Could not load backend data');
    });
  }, [pushToast, refreshWorld]);

  const findings = useMemo(() => computeFindings(world), [world]);

  const kpis = useMemo<DashboardKpis>(() => {
    const providerPayout = totalMinor(world.providerTransactions);
    const ledgerTotal = totalMinor(world.ledgerEntries);
    const dup = findings.filter((f) => f.kind === 'DUPLICATE_REFUND');
    return {
      totalRefundRequests: world.refunds.length,
      totalProviderPayoutMinor: providerPayout,
      totalLedgerAmountMinor: ledgerTotal,
      financialDiscrepancyMinor: providerPayout - ledgerTotal,
      duplicateRefunds: dup.length,
      failedTransactions: world.refunds.filter((r) => r.status === 'FAILED').length,
      discrepancyPct: providerPayout > 0 ? (providerPayout - ledgerTotal) / providerPayout : 0,
      pendingRefunds: world.refunds.filter((r) => r.status === 'PENDING').length,
      processingRefunds: world.refunds.filter((r) => r.status === 'PROCESSING').length,
    };
  }, [world, findings]);

  const baseline = useMemo(() => runReconciliation(world, 'baseline', world.refunds[0]?.createdAt ?? new Date().toISOString()), [world]);

  const customerRows = useMemo<CustomerRow[]>(() => {
    const map = new Map<string, CustomerRow>();
    for (const c of world.customers) {
      map.set(c.id, { id: c.id, name: c.name, email: c.email, currency: c.currency, refundCount: 0, intendedMinor: 0, paidMinor: 0, duplicateMinor: 0, recovery: 'MONITOR', recoveryNote: 'No anomalies detected' });
    }
    for (const r of world.refunds) {
      const row = map.get(r.customerId);
      if (!row) continue;
      row.refundCount += 1;
      row.intendedMinor += toUsd(r.amountMinor, r.currency);
    }
    const refundById = new Map(world.refunds.map((refund) => [refund.id, refund]));
    for (const transaction of world.providerTransactions) {
      const refund = refundById.get(transaction.refundId);
      const row = refund ? map.get(refund.customerId) : undefined;
      if (row) row.paidMinor += toUsd(transaction.amountMinor, transaction.currency);
    }
    for (const f of findings) {
      const row = map.get(f.customerId);
      if (!row) continue;
      if (f.kind === 'DUPLICATE_REFUND') {
        row.duplicateMinor += f.differenceMinor;
        row.recovery = 'CLAWBACK_REVIEW';
        row.recoveryNote = 'Duplicate payout detected — clawback review (dry run only)';
      } else if (f.kind === 'MISSING_LEDGER' && row.recovery !== 'CLAWBACK_REVIEW') {
        row.recovery = 'LEDGER_WRITE_OFF';
        row.recoveryNote = 'Provider paid but ledger missing — recommend ledger write-off';
      }
    }
    return [...map.values()].filter((r) => r.refundCount > 0 || r.duplicateMinor > 0).sort((a, b) => b.duplicateMinor - a.duplicateMinor || b.intendedMinor - a.intendedMinor);
  }, [world, findings]);

  const discrepancyRows = useMemo<DiscrepancyRow[]>(() => {
    const rows: DiscrepancyRow[] = [];
    for (const f of findings) {
      rows.push({
        key: f.id,
        refundId: f.refundId,
        customerId: f.customerId,
        providerAmountMinor: f.providerMinor,
        ledgerAmountMinor: f.ledgerMinor,
        differenceMinor: f.differenceMinor,
        providerCurrency: 'USD',
        ledgerCurrency: 'USD',
        currencyMismatch: f.kind === 'CURRENCY_MISMATCH',
        suspectedCause: f.cause,
        status: 'SUSPECTED',
      });
    }
    return rows.sort((a, b) => b.differenceMinor - a.differenceMinor);
  }, [world, findings]);

  const recentLogs = useMemo(() => [...world.workerLogs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [world]);

  const runReconciliationAction = useCallback(() => {
    setRunningReconciliation(true);
    apiRequest<ReconciliationResult>('/reconciliation/run', { method: 'POST' })
      .then((result) => {
        setReconciliation(result);
        pushToast('success', `Reconciliation complete: ${result.providerOnlyCount} provider-only, ${result.duplicateCount} duplicates, net ${result.netDiscrepancyMinor >= 0 ? '+' : ''}${(result.netDiscrepancyMinor / 100).toFixed(2)} USD`);
      })
      .catch((error: unknown) => pushToast('error', error instanceof Error ? error.message : 'Reconciliation failed'))
      .finally(() => setRunningReconciliation(false));
  }, [pushToast]);

  const runScenarioAction = useCallback((scenarioId: string) => {
    setRunningScenario(scenarioId);
    apiRequest<SimulationRun>(`/simulations/${scenarioId}`, { method: 'POST' })
      .then((run) => {
        setRuns((prev) => [run, ...prev.filter((r) => r.scenarioId !== scenarioId)]);
        setActiveRun(run);
        const exposure = run.duplicatedAmountMinor + run.missingLedgerAmountMinor + run.fxLossMinor;
        pushToast('success', `${run.scenarioTitle} simulated — exposure ${(exposure / 100).toFixed(2)} USD written to scenario evidence`);
      })
      .catch((error: unknown) => pushToast('error', error instanceof Error ? error.message : 'Simulation failed'))
      .finally(() => setRunningScenario(null));
  }, [pushToast]);

  const resetSimulations = useCallback(() => {
    apiRequest<{ status: string }>('/reset', { method: 'POST' })
      .then(async () => {
        await refreshWorld();
        setRuns([]);
        setActiveRun(null);
        setFixRun(null);
        setReconciliation(null);
        setFixStatuses(defaultFixStatuses());
        pushToast('info', 'Your analysis history was cleared; demo and account records were retained');
      })
      .catch((error: unknown) => pushToast('error', error instanceof Error ? error.message : 'Simulation reset failed'));
  }, [pushToast, refreshWorld]);

  const runFixesAction = useCallback(() => {
    setRunningFixes(true);
    apiRequest<FixRun>('/fixes/run', { method: 'POST' })
      .then((result) => {
        setFixRun(result);
        const allPass = result.check.every((c) => c.status === 'PASS');
        setFixStatuses(statusesFromFixRun(result, false));
        if (allPass) {
          pushToast('success', `Corrected run verified: net discrepancy reduced from ${(result.before.netDiscrepancyMinor / 100).toFixed(2)} to ${(result.after.netDiscrepancyMinor / 100).toFixed(2)} USD`);
        } else {
          pushToast('error', 'Corrected run finished with failing checks — see Fix & Recovery for details');
        }
      })
      .catch((error: unknown) => pushToast('error', error instanceof Error ? error.message : 'Fix verification failed'))
      .finally(() => setRunningFixes(false));
  }, [pushToast]);

  const acknowledgeFixesAction = useCallback(async () => {
    setRunningFixes(true);
    try {
      const result = await apiRequest<FixRun>('/fixes/acknowledge', { method: 'POST' });
      await refreshWorld();
      const updatedReconciliation = await apiRequest<ReconciliationResult>('/reconciliation');
      setFixRun(result);
      setReconciliation(updatedReconciliation);
      setFixStatuses(statusesFromFixRun(result, true));
      pushToast('success', `Verified corrections applied to the simulation at ${new Date(result.acknowledgedAt ?? Date.now()).toLocaleTimeString()}; reconciliation is now balanced`);
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : 'Could not apply the verified simulation');
    } finally {
      setRunningFixes(false);
    }
  }, [pushToast, refreshWorld]);

  const revertFixesAction = useCallback(async () => {
    setRunningFixes(true);
    try {
      const result = await apiRequest<FixRun>('/fixes/revert', { method: 'POST' });
      await refreshWorld();
      const updatedReconciliation = await apiRequest<ReconciliationResult>('/reconciliation');
      setFixRun(result);
      setReconciliation(updatedReconciliation);
      setFixStatuses(statusesFromFixRun(result, false));
      pushToast('info', 'Simulation corrections reverted; original synthetic records are visible again');
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : 'Could not revert the simulation corrections');
    } finally {
      setRunningFixes(false);
    }
  }, [pushToast, refreshWorld]);

  const createRefund = useCallback(async (input: RefundRequestInput) => {
    try {
      const refund = await apiRequest<Refund>('/refunds', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      await refreshWorld();
      return { ok: true, refund };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Could not create the refund request.' };
    }
  }, [refreshWorld]);

  const createCustomer = useCallback(async (input: { name: string; email: string; currency: 'USD' | 'EUR' | 'GBP' }) => {
    try {
      await apiRequest('/customers', { method: 'POST', body: JSON.stringify(input) });
      await refreshWorld();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Could not create the customer.' };
    }
  }, [refreshWorld]);

  const createOrder = useCallback(async (input: { customerId: string; amount: string; currency: 'USD' | 'EUR' | 'GBP' }) => {
    try {
      await apiRequest('/orders', { method: 'POST', body: JSON.stringify(input) });
      await refreshWorld();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Could not create the order.' };
    }
  }, [refreshWorld]);

  const acknowledgeRecoveryPreview = useCallback(async (customerId: string) => {
    try {
      const result = await apiRequest<{ acknowledgedAt: string }>(`/customers/${customerId}/recovery/acknowledge`, { method: 'POST' });
      await refreshWorld();
      return { ok: true, acknowledgedAt: result.acknowledgedAt };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Could not acknowledge the recovery preview.' };
    }
  }, [refreshWorld]);

  const simulateRefundProcessing = useCallback(async (refundId: string) => {
    try {
      await apiRequest(`/refunds/${refundId}/process`, { method: 'POST' });
      await refreshWorld();
      const updatedReconciliation = await apiRequest<ReconciliationResult>('/reconciliation/run', { method: 'POST' });
      setReconciliation(updatedReconciliation);
      pushToast('success', `Refund ${refundId} processed: provider settled and ledger posted`);
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : 'Refund processing failed');
    }
  }, [pushToast, refreshWorld]);

  const value = useMemo<StoreValue>(() => ({
    world,
    findings,
    kpis,
    baseline,
    reconciliation,
    runningReconciliation,
    runs,
    runningScenario,
    activeRun,
    fixRun,
    runningFixes,
    fixStatuses,
    toasts,
    env: { mode: 'SIMULATION', apiBaseUrl: API_BASE_URL, database: 'refundguard.db (SQLite)', workerPool: 'worker-01 … worker-04', fxSource: 'pinned daily rates (EUR 1.10 / GBP 1.27)' },
    pushToast,
    dismissToast,
    runReconciliationAction,
    runScenarioAction,
    resetSimulations,
    runFixesAction,
    acknowledgeFixesAction,
    revertFixesAction,
    createRefund,
    createCustomer,
    createOrder,
    acknowledgeRecoveryPreview,
    simulateRefundProcessing,
    customerRows,
    discrepancyRows,
    recentLogs,
  }), [world, findings, kpis, baseline, reconciliation, runningReconciliation, runs, runningScenario, activeRun, fixRun, runningFixes, fixStatuses, toasts, pushToast, dismissToast, runReconciliationAction, runScenarioAction, resetSimulations, runFixesAction, acknowledgeFixesAction, revertFixesAction, createRefund, createCustomer, createOrder, acknowledgeRecoveryPreview, simulateRefundProcessing, customerRows, discrepancyRows, recentLogs]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}

export { SCENARIOS, FIXES };
