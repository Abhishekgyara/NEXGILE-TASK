export type RefundStatus = 'PENDING' | 'PROCESSING' | 'PAID' | 'FAILED';
export type LedgerStatus = 'NOT_RECORDED' | 'PENDING' | 'POSTED';
export type ProviderStatus = 'NOT_SENT' | 'SETTLED' | 'TIMEOUT' | 'FAILED';

export interface Customer {
  id: string;
  name: string;
  email: string;
  currency: 'USD' | 'EUR' | 'GBP';
  createdAt: string;
}

export interface Order {
  id: string;
  customerId: string;
  amountMinor: number;
  currency: 'USD' | 'EUR' | 'GBP';
  status: 'SHIPPED' | 'DELIVERED' | 'CANCELLED';
  createdAt: string;
}

export interface Refund {
  id: string;
  customerId: string;
  orderId: string;
  amountMinor: number;
  currency: 'USD' | 'EUR' | 'GBP';
  status: RefundStatus;
  providerStatus: ProviderStatus;
  ledgerStatus: LedgerStatus;
  workerId: string | null;
  retryCount: number;
  createdAt: string;
  paidAt: string | null;
  scenario: string | null;
}

export interface ProviderTransaction {
  id: string;
  refundId: string;
  amountMinor: number;
  currency: 'USD' | 'EUR' | 'GBP';
  status: ProviderStatus;
  settlementId: string;
  createdAt: string;
  source: string;
}

export interface LedgerEntry {
  id: string;
  refundId: string;
  amountMinor: number;
  currency: 'USD' | 'EUR' | 'GBP';
  status: LedgerStatus;
  createdAt: string;
  updatedAt?: string;
  source: string;
}

export interface WorkerLog {
  id: string;
  workerId: string;
  refundId: string | null;
  level: 'INFO' | 'WARN' | 'ERROR';
  event: string;
  status: string;
  message: string;
  createdAt: string;
}

export interface WorkerJob {
  id: string;
  workerId: string;
  refundId: string;
  status: 'QUEUED' | 'PROCESSING' | 'DONE' | 'FAILED';
  attempts: number;
  claimedAt: string | null;
  finishedAt: string | null;
}

export interface FxRate {
  fromCurrency: 'EUR' | 'GBP';
  toCurrency: 'USD';
  rate: number;
  effectiveDate: string;
  source: string;
}

export interface RefundRequestInput {
  customerId: string;
  orderId: string;
  amount: string;
  currency: 'USD' | 'EUR' | 'GBP';
}

export interface SimulationEvent {
  at: string;
  workerId: string;
  level: 'INFO' | 'WARN' | 'ERROR';
  event: string;
  message: string;
}

export interface SimulationRun {
  id: string;
  scenarioId: string;
  scenarioTitle: string;
  status: 'RUNNING' | 'COMPLETED' | 'FAILED';
  severity: string;
  startedAt: string;
  finishedAt: string | null;
  duplicatedAmountMinor: number;
  missingLedgerAmountMinor: number;
  fxLossMinor: number;
  events: SimulationEvent[];
  cause: string;
  targetRefundId: string;
}

export interface DiscrepancyRow {
  key: string;
  refundId: string;
  customerId: string;
  providerAmountMinor: number;
  ledgerAmountMinor: number;
  differenceMinor: number;
  providerCurrency: string;
  ledgerCurrency: string;
  currencyMismatch: boolean;
  suspectedCause: string;
  status: 'SUSPECTED' | 'CONFIRMED' | 'RESOLVED';
}

export interface MatchRow {
  settlementId: string;
  refundId: string | null;
  providerMinor: number;
  ledgerMinor: number;
  differenceMinor: number;
  currency: string;
  side: 'MATCHED' | 'PROVIDER_ONLY' | 'LEDGER_ONLY' | 'AMOUNT_MISMATCH' | 'CURRENCY_MISMATCH';
}

export interface ReconciliationResult {
  id: string;
  label: string;
  ranAt: string;
  matchedCount: number;
  providerOnlyCount: number;
  ledgerOnlyCount: number;
  duplicateCount: number;
  amountMismatchCount: number;
  currencyMismatchCount: number;
  netDiscrepancyMinor: number;
  rows: MatchRow[];
}

export interface CustomerRow {
  id: string;
  name: string;
  email: string;
  currency: 'USD' | 'EUR' | 'GBP';
  refundCount: number;
  intendedMinor: number;
  paidMinor: number;
  duplicateMinor: number;
  recovery: 'CLAWBACK_REVIEW' | 'LEDGER_WRITE_OFF' | 'MONITOR';
  recoveryNote: string;
}

export interface Fix {
  id: string;
  name: string;
  rootCause: string;
  solution: string;
  guarantees: string[];
  status: 'PROPOSED' | 'IMPLEMENTED';
}

export interface FixCheck {
  id: string;
  fixId: string;
  status: 'PASS' | 'FAIL';
  detail: string;
}

export interface FixRun {
  id: string;
  ranAt: string;
  acknowledgedAt?: string | null;
  revertedAt?: string | null;
  check: FixCheck[];
  before: { netDiscrepancyMinor: number; providerPayoutMinor: number; ledgerTotalMinor: number; duplicateCount: number; refundCount: number };
  after: { netDiscrepancyMinor: number; providerPayoutMinor: number; ledgerTotalMinor: number; duplicateCount: number; refundCount: number };
}

export interface ReportFile {
  filename: string;
  label: string;
  description: string;
  generatedAt: string;
  body: string;
}

export interface SeedWorld {
  customers: Customer[];
  orders: Order[];
  refunds: Refund[];
  providerTransactions: ProviderTransaction[];
  ledgerEntries: LedgerEntry[];
  workerJobs: WorkerJob[];
  workerLogs: WorkerLog[];
  fxRates: FxRate[];
}

export interface Finding {
  id: string;
  refundId: string;
  customerId: string;
  providerMinor: number;
  ledgerMinor: number;
  differenceMinor: number;
  currency: string;
  providerCurrency: string;
  ledgerCurrency: string;
  kind: 'DUPLICATE_REFUND' | 'MISSING_LEDGER' | 'AMOUNT_MISMATCH' | 'CURRENCY_MISMATCH' | 'WORKER_FAILURE';
  cause: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface AppEnv {
  mode: 'SIMULATION';
  apiBaseUrl: string;
  database: string;
  workerPool: string;
  fxSource: string;
}
