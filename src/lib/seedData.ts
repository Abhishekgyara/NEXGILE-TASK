import type { Customer, FxRate, LedgerEntry, Order, ProviderTransaction, Refund, SeedWorld, WorkerJob, WorkerLog } from './types';

export const SIM_TZ = new Date('2026-11-23T14:00:00Z').getTime();
const HOUR = 3600_000;
const DAY = 24 * HOUR;

export const WORKER_IDS = ['worker-01', 'worker-02', 'worker-03', 'worker-04'];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function iso(ts: number): string {
  return new Date(ts).toISOString();
}

function seededCustomers(): Customer[] {
  const first = ['Ava', 'Noah', 'Mia', 'Liam', 'Zoe', 'Ethan', 'Ivy', 'Owen', 'Ruby', 'Felix', 'Nina', 'Jonas', 'Clara', 'Milo', 'Elsa', 'Theo', 'Lena', 'Hugo', 'Sara', 'Emil'];
  const last = ['Berg', 'Lund', 'Voss', 'Dahl', 'Klein', 'Roos', 'Holt', 'Falk', 'Stern', 'Wren', 'Aalto', 'Brandt', 'Sørli', 'Kvist', 'Hagen', 'Eklund', 'Molde', 'Rask', 'Storli', 'Nordvik'];
  const currencies: Customer['currency'][] = ['USD', 'USD', 'USD', 'EUR', 'EUR', 'GBP'];
  const list: Customer[] = [];
  for (let i = 1; i <= 1000; i++) {
    const r = (i * 7919) % 1000;
    list.push({
      id: `C${String(i).padStart(3, '0')}`,
      name: `${first[r % first.length]} ${last[(i * 13) % last.length]}`,
      email: `customer${String(i).padStart(3, '0')}@mail.example`,
      currency: currencies[i % currencies.length],
      createdAt: iso(SIM_TZ - (40 + (i % 500)) * DAY),
    });
  }
  return list;
}

export function buildSeedWorld(): SeedWorld {
  const rand = mulberry32(20261125);
  const customers = seededCustomers();
  const currencies: Order['currency'][] = ['USD', 'USD', 'USD', 'EUR', 'EUR', 'GBP'];

  const orders: Order[] = [];
  for (let i = 1; i <= 2000; i++) {
    const cust = customers[i % customers.length];
    const major = Math.round(40 + rand() * 460) + 0.99;
    orders.push({
      id: `ORD${String(i).padStart(4, '0')}`,
      customerId: cust.id,
      amountMinor: Math.round(major * 100),
      currency: cust.currency,
      status: rand() > 0.15 ? 'DELIVERED' : 'SHIPPED',
      createdAt: iso(SIM_TZ - (5 + rand() * 35) * DAY),
    });
  }

  const statuses: Refund['status'][] = ['PENDING', 'PROCESSING', 'PAID', 'PAID', 'PAID', 'FAILED', 'PAID', 'PROCESSING'];
  const refunds: Refund[] = [];
  for (let i = 1; i <= 3000; i++) {
    const order = orders[i % orders.length];
    const status = statuses[i % statuses.length];
    const createdTs = SIM_TZ - Math.floor(rand() * 21 * DAY);
    const paid = status === 'PAID';
    const retryCount = i % 17 === 0 ? 1 + (i % 3) : 0;
    const providerStatus: Refund['providerStatus'] = paid ? 'SETTLED' : status === 'FAILED' ? 'FAILED' : status === 'PROCESSING' ? (i % 13 === 0 ? 'TIMEOUT' : 'NOT_SENT') : 'NOT_SENT';
    const ledgerStatus: Refund['ledgerStatus'] = paid ? 'POSTED' : status === 'PROCESSING' ? (i % 11 === 0 ? 'PENDING' : 'NOT_RECORDED') : 'NOT_RECORDED';
    refunds.push({
      id: `REF${String(i).padStart(4, '0')}`,
      customerId: order.customerId,
      orderId: order.id,
      amountMinor: Math.round(order.amountMinor * (0.1 + rand() * 0.4)),
      currency: order.currency,
      status,
      providerStatus,
      ledgerStatus,
      workerId: paid || status === 'PROCESSING' ? WORKER_IDS[i % WORKER_IDS.length] : null,
      retryCount,
      createdAt: iso(createdTs),
      paidAt: paid ? iso(createdTs + Math.floor(0.5 + rand() * 5) * HOUR) : null,
      scenario: null,
    });
  }

  // Scenario 1 — duplicate refund: worker crash before ledger write, retry pays again.
  const r1 = refunds[0];
  r1.id = 'REF1001'; r1.customerId = 'C101'; r1.status = 'PAID';
  r1.amountMinor = 10000; r1.currency = 'USD'; r1.providerStatus = 'SETTLED'; r1.ledgerStatus = 'POSTED';
  r1.workerId = 'worker-01'; r1.retryCount = 1; r1.scenario = 'duplicate_refund';
  r1.createdAt = iso(SIM_TZ - 6 * DAY); r1.paidAt = iso(SIM_TZ - 6 * DAY + 2 * HOUR);

  // Scenario 2 — race condition: two workers process the same PENDING refund.
  const r2 = refunds[1];
  r2.id = 'REF1002'; r2.customerId = 'C101'; r2.status = 'PAID';
  r2.amountMinor = 5000; r2.currency = 'USD'; r2.providerStatus = 'SETTLED'; r2.ledgerStatus = 'POSTED';
  r2.workerId = 'worker-02'; r2.retryCount = 0; r2.scenario = 'race_condition';
  r2.createdAt = iso(SIM_TZ - 5 * DAY); r2.paidAt = iso(SIM_TZ - 5 * DAY + HOUR);

  // Scenario 3 — provider timeout: settled remotely, app saw timeout and retried.
  const r3 = refunds[2];
  r3.id = 'REF1003'; r3.customerId = 'C205'; r3.status = 'PAID';
  r3.amountMinor = 7500; r3.currency = 'USD'; r3.providerStatus = 'SETTLED'; r3.ledgerStatus = 'POSTED';
  r3.workerId = 'worker-03'; r3.retryCount = 1; r3.scenario = 'provider_timeout';
  r3.createdAt = iso(SIM_TZ - 4 * DAY); r3.paidAt = iso(SIM_TZ - 4 * DAY + 3 * HOUR);

  // Scenario 4 — missing ledger entry: provider settled, nothing posted.
  const r4 = refunds[3];
  r4.id = 'REF1004'; r4.customerId = 'C310'; r4.status = 'PAID';
  r4.amountMinor = 12000; r4.currency = 'USD'; r4.providerStatus = 'SETTLED'; r4.ledgerStatus = 'NOT_RECORDED';
  r4.workerId = 'worker-04'; r4.retryCount = 0; r4.scenario = 'missing_ledger';
  r4.createdAt = iso(SIM_TZ - 3 * DAY); r4.paidAt = iso(SIM_TZ - 3 * DAY + HOUR);

  // Scenario 5 — FX conversion error: EUR 100 booked at wrong rate / rounding.
  const r5 = refunds[4];
  r5.id = 'REF1005'; r5.customerId = 'C415'; r5.status = 'PAID';
  r5.amountMinor = 10000; r5.currency = 'EUR'; r5.providerStatus = 'SETTLED'; r5.ledgerStatus = 'POSTED';
  r5.workerId = 'worker-01'; r5.retryCount = 0; r5.scenario = 'fx_error';
  r5.createdAt = iso(SIM_TZ - 2 * DAY); r5.paidAt = iso(SIM_TZ - 2 * DAY + 4 * HOUR);

  // Scenario 6 — worker crash and retry: crash mid-processing, retry recovers.
  const r6 = refunds[5];
  r6.id = 'REF1006'; r6.customerId = 'C512'; r6.status = 'PAID';
  r6.amountMinor = 6400; r6.currency = 'USD'; r6.providerStatus = 'SETTLED'; r6.ledgerStatus = 'POSTED';
  r6.workerId = 'worker-02'; r6.retryCount = 2; r6.scenario = 'worker_crash';
  r6.createdAt = iso(SIM_TZ - DAY); r6.paidAt = iso(SIM_TZ - DAY + 5 * HOUR);

  const providerTransactions: ProviderTransaction[] = [];
  const ledgerEntries: LedgerEntry[] = [];
  const workerJobs: WorkerJob[] = [];
  const workerLogs: WorkerLog[] = [];
  let settlementSeq = 1000;
  let logSeq = 1;

  function pushLog(refundId: string | null, workerId: string, level: WorkerLog['level'], event: string, status: string, message: string, at: string) {
    workerLogs.push({
      id: `WL${String(logSeq++).padStart(5, '0')}`,
      workerId,
      refundId,
      level,
      event,
      status,
      message,
      createdAt: at,
    });
  }

  for (const r of refunds) {
    if (r.providerStatus === 'SETTLED') {
      providerTransactions.push({
        id: `TX${settlementSeq++}`,
        refundId: r.id,
        amountMinor: r.amountMinor,
        currency: r.currency,
        status: 'SETTLED',
        settlementId: `STL${settlementSeq}`,
        createdAt: r.paidAt ?? r.createdAt,
        source: r.scenario ? `seed:${r.scenario}` : 'seed:batch',
      });
    }
    if (r.ledgerStatus === 'POSTED') {
      ledgerEntries.push({
        id: `LE${r.id.slice(3)}`,
        refundId: r.id,
        amountMinor: r.amountMinor,
        currency: r.currency,
        status: 'POSTED',
        createdAt: (r.paidAt ?? r.createdAt),
        source: r.scenario ? `seed:${r.scenario}` : 'seed:batch',
      });
    } else if (r.ledgerStatus === 'PENDING') {
      ledgerEntries.push({
        id: `LE${r.id.slice(3)}`,
        refundId: r.id,
        amountMinor: r.amountMinor,
        currency: r.currency,
        status: 'PENDING',
        createdAt: r.createdAt,
        source: 'seed:batch',
      });
    }
    if (r.status !== 'PENDING') {
      const attempts = 1 + r.retryCount;
      workerJobs.push({
        id: `JOB${r.id.slice(3)}`,
        workerId: r.workerId ?? WORKER_IDS[0],
        refundId: r.id,
        status: r.status === 'FAILED' ? 'FAILED' : 'DONE',
        attempts,
        claimedAt: r.createdAt,
        finishedAt: r.paidAt ?? r.createdAt,
      });
      pushLog(r.id, r.workerId ?? WORKER_IDS[0], 'INFO', 'JOB_CLAIMED', 'OK', `Claimed refund job ${r.id} for processing`, r.createdAt);
      if (r.status === 'PAID') {
        pushLog(r.id, r.workerId ?? WORKER_IDS[0], 'INFO', 'PROVIDER_CALL', 'OK', `Provider accepted refund ${r.id}`, r.paidAt ?? r.createdAt);
        if (r.ledgerStatus === 'POSTED') {
          pushLog(r.id, r.workerId ?? WORKER_IDS[0], 'INFO', 'LEDGER_POSTED', 'OK', `Ledger entry posted for ${r.id}`, r.paidAt ?? r.createdAt);
        } else {
          pushLog(r.id, r.workerId ?? WORKER_IDS[0], 'ERROR', 'LEDGER_WRITE_FAILED', 'ERR', `Ledger write failed for ${r.id}: connection reset`, r.paidAt ?? r.createdAt);
        }
      } else if (r.status === 'FAILED') {
        pushLog(r.id, r.workerId ?? WORKER_IDS[0], 'ERROR', 'PROVIDER_CALL', 'ERR', `Provider rejected refund ${r.id}: do_not_honor`, r.createdAt);
      } else if (r.providerStatus === 'TIMEOUT') {
        pushLog(r.id, r.workerId ?? WORKER_IDS[0], 'WARN', 'PROVIDER_TIMEOUT', 'RETRY', `Provider response timed out for ${r.id}, scheduling retry`, r.createdAt);
      }
    }
  }

  // Scenario-specific histories.
  const r1Paid = r1.paidAt ?? r1.createdAt;
  providerTransactions.push({ id: `TX${settlementSeq++}`, refundId: 'REF1001', amountMinor: 10000, currency: 'USD', status: 'SETTLED', settlementId: `STL${settlementSeq}`, createdAt: r1Paid, source: 'seed:retry_duplicate' });
  workerJobs.push({ id: 'JOB1001R', workerId: 'worker-01', refundId: 'REF1001', status: 'DONE', attempts: 2, claimedAt: iso(SIM_TZ - 6 * DAY + 90 * 60_000), finishedAt: r1Paid });
  pushLog('REF1001', 'worker-01', 'INFO', 'JOB_CLAIMED', 'OK', 'Claimed refund job REF1001', r1.createdAt);
  pushLog('REF1001', 'worker-01', 'INFO', 'PROVIDER_CALL', 'OK', 'Provider accepted refund REF1001 ($100.00)', r1Paid);
  pushLog('REF1001', 'worker-01', 'ERROR', 'WORKER_CRASH', 'ERR', 'Worker crashed after provider call, ledger update never ran', iso(SIM_TZ - 6 * DAY + 91 * 60_000));
  pushLog('REF1001', 'worker-01', 'WARN', 'RETRY_QUEUED', 'RETRY', 'Unacked job requeued, no idempotency key checked', iso(SIM_TZ - 6 * DAY + 95 * 60_000));
  pushLog('REF1001', 'worker-01', 'INFO', 'PROVIDER_CALL', 'OK', 'Provider accepted duplicate refund REF1001 ($100.00)', r1Paid);

  const r2Paid = r2.paidAt ?? r2.createdAt;
  providerTransactions.push({ id: `TX${settlementSeq++}`, refundId: 'REF1002', amountMinor: 5000, currency: 'USD', status: 'SETTLED', settlementId: `STL${settlementSeq}`, createdAt: r2Paid, source: 'seed:race_condition' });
  workerJobs.push({ id: 'JOB1002B', workerId: 'worker-03', refundId: 'REF1002', status: 'DONE', attempts: 1, claimedAt: iso(SIM_TZ - 5 * DAY + 59 * 60_000), finishedAt: r2Paid });
  pushLog('REF1002', 'worker-02', 'INFO', 'JOB_READ', 'OK', 'Read REF1002 status = PENDING (no row lock)', iso(SIM_TZ - 5 * DAY + 60 * 60_000));
  pushLog('REF1002', 'worker-03', 'INFO', 'JOB_READ', 'OK', 'Read REF1002 status = PENDING (no row lock)', iso(SIM_TZ - 5 * DAY + 60 * 60_000 + 900));
  pushLog('REF1002', 'worker-02', 'INFO', 'PROVIDER_CALL', 'OK', 'Provider accepted refund REF1002 ($50.00)', r2Paid);
  pushLog('REF1002', 'worker-03', 'INFO', 'PROVIDER_CALL', 'OK', 'Provider accepted refund REF1002 ($50.00)', iso(SIM_TZ - 5 * DAY + 61 * 60_000));
  pushLog('REF1002', 'worker-02', 'ERROR', 'DUPLICATE_DETECTED', 'ERR', 'Two settlements found for REF1002 after reconciliation', iso(SIM_TZ - 4 * DAY));

  const r3Paid = r3.paidAt ?? r3.createdAt;
  providerTransactions.push({ id: `TX${settlementSeq++}`, refundId: 'REF1003', amountMinor: 7500, currency: 'USD', status: 'SETTLED', settlementId: `STL${settlementSeq}`, createdAt: r3Paid, source: 'seed:timeout_retry' });
  workerJobs.push({ id: 'JOB1003R', workerId: 'worker-03', refundId: 'REF1003', status: 'DONE', attempts: 2, claimedAt: iso(SIM_TZ - 4 * DAY + 3 * HOUR), finishedAt: r3Paid });
  pushLog('REF1003', 'worker-03', 'INFO', 'PROVIDER_CALL', 'OK', 'Provider accepted refund REF1003 ($75.00)', r3Paid);
  pushLog('REF1003', 'worker-03', 'WARN', 'PROVIDER_TIMEOUT', 'RETRY', 'Response timed out after 30s; provider had actually settled', iso(SIM_TZ - 4 * DAY + 3 * HOUR + 30_000));
  pushLog('REF1003', 'worker-03', 'INFO', 'RETRY_NO_VERIFY', 'ERR', 'Retried without querying provider status first', iso(SIM_TZ - 4 * DAY + 3 * HOUR + 35 * 60_000));
  pushLog('REF1003', 'worker-03', 'INFO', 'PROVIDER_CALL', 'OK', 'Provider accepted duplicate refund REF1003 ($75.00)', iso(SIM_TZ - 4 * DAY + 3 * HOUR + 36 * 60_000));

  pushLog('REF1004', 'worker-04', 'INFO', 'PROVIDER_CALL', 'OK', 'Provider accepted refund REF1004 ($120.00)', r4.paidAt ?? r4.createdAt);
  pushLog('REF1004', 'worker-04', 'ERROR', 'LEDGER_INSERT_MISSING', 'ERR', 'Ledger insert skipped: worker died before commit', iso(SIM_TZ - 3 * DAY + HOUR + 60_000));

  pushLog('REF1005', 'worker-01', 'WARN', 'FX_RATE_STALE', 'ERR', 'FX rate fallback 1.05 used instead of 1.10 for REF1005', r5.createdAt);
  pushLog('REF1005', 'worker-01', 'INFO', 'LEDGER_POSTED', 'OK', 'Ledger posted REF1005 at $105.00 (expected $110.00)', r5.paidAt ?? r5.createdAt);

  const r6Paid = r6.paidAt ?? r6.createdAt;
  pushLog('REF1006', 'worker-02', 'INFO', 'JOB_CLAIMED', 'OK', 'Claimed refund job REF1006', r6.createdAt);
  pushLog('REF1006', 'worker-02', 'ERROR', 'WORKER_CRASH', 'ERR', 'Worker OOM killed mid-processing of REF1006', iso(SIM_TZ - DAY + 2 * HOUR));
  pushLog('REF1006', 'worker-02', 'WARN', 'RETRY_QUEUED', 'RETRY', 'REF1006 requeued after crash', iso(SIM_TZ - DAY + 3 * HOUR));
  pushLog('REF1006', 'worker-02', 'INFO', 'PROVIDER_CALL', 'OK', 'Provider accepted refund REF1006 on retry', r6Paid);
  pushLog('REF1006', 'worker-02', 'INFO', 'LEDGER_POSTED', 'OK', 'Ledger entry posted for REF1006', iso(SIM_TZ - DAY + 5 * HOUR + 60_000));

  // Controlled discrepancies beyond the six scenarios.
  for (let i = 6; i < refunds.length; i += 97) {
    const r = refunds[i];
    if (r.providerStatus !== 'SETTLED') continue;
    providerTransactions.push({ id: `TX${settlementSeq++}`, refundId: r.id, amountMinor: r.amountMinor, currency: r.currency, status: 'SETTLED', settlementId: `STL${settlementSeq}`, createdAt: r.paidAt ?? r.createdAt, source: 'seed:batch' });
    ledgerEntries.push({ id: `LE${r.id.slice(3)}A`, refundId: r.id, amountMinor: r.amountMinor, currency: r.currency, status: 'POSTED', createdAt: r.paidAt ?? r.createdAt, source: 'seed:batch' });
    ledgerEntries.push({ id: `LE${r.id.slice(3)}B`, refundId: r.id, amountMinor: r.amountMinor, currency: r.currency, status: 'POSTED', createdAt: r.paidAt ?? r.createdAt, source: 'seed:batch' });
    pushLog(r.id, r.workerId ?? WORKER_IDS[0], 'ERROR', 'DUPLICATE_LEDGER', 'ERR', `Duplicate ledger entries detected for ${r.id}`, iso(SIM_TZ - DAY));
  }
  for (let i = 11; i < refunds.length; i += 113) {
    const r = refunds[i];
    if (r.providerStatus !== 'SETTLED' || r.currency === 'USD') continue;
    const entry = ledgerEntries.find((l) => l.refundId === r.id);
    if (entry) {
      entry.currency = 'USD';
      pushLog(r.id, r.workerId ?? WORKER_IDS[0], 'ERROR', 'CURRENCY_MISMATCH', 'ERR', `Ledger currency mismatch for ${r.id}: provider ${r.currency} vs ledger USD`, iso(SIM_TZ - 12 * HOUR));
    }
  }
  for (let i = 19; i < refunds.length; i += 131) {
    const r = refunds[i];
    if (r.providerStatus !== 'SETTLED') continue;
    const entry = ledgerEntries.find((l) => l.refundId === r.id && l.currency === r.currency);
    if (entry) {
      entry.amountMinor = r.amountMinor + 250;
      pushLog(r.id, r.workerId ?? WORKER_IDS[0], 'WARN', 'AMOUNT_MISMATCH', 'ERR', `Ledger amount differs from provider settlement for ${r.id}`, iso(SIM_TZ - 10 * HOUR));
    }
  }
  for (let i = 23; i < refunds.length; i += 149) {
    const r = refunds[i];
    if (r.providerStatus !== 'SETTLED') continue;
    if (!ledgerEntries.some((l) => l.refundId === r.id)) {
      pushLog(r.id, r.workerId ?? WORKER_IDS[0], 'ERROR', 'LEDGER_WRITE_FAILED', 'ERR', `Ledger entry missing for ${r.id}: provider-only settlement`, iso(SIM_TZ - 8 * HOUR));
    }
  }

  const fxRates: FxRate[] = [
    { fromCurrency: 'EUR', toCurrency: 'USD', rate: 1.1, effectiveDate: iso(SIM_TZ - 30 * DAY), source: 'manual-daily-fix' },
    { fromCurrency: 'GBP', toCurrency: 'USD', rate: 1.27, effectiveDate: iso(SIM_TZ - 30 * DAY), source: 'manual-daily-fix' },
    { fromCurrency: 'EUR', toCurrency: 'USD', rate: 1.05, effectiveDate: iso(SIM_TZ - 2 * DAY), source: 'stale-fallback' },
    { fromCurrency: 'GBP', toCurrency: 'USD', rate: 1.24, effectiveDate: iso(SIM_TZ - 2 * DAY), source: 'stale-fallback' },
  ];

  return { customers, orders, refunds, providerTransactions, ledgerEntries, workerJobs, workerLogs, fxRates };
}
