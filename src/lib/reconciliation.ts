import type { LedgerEntry, ProviderTransaction, Refund } from './types';
import { SIM_TZ } from './seedData';
import type { Finding, MatchRow, ReconciliationResult } from './types';

export interface CoreTables {
  refunds: Refund[];
  providerTransactions: ProviderTransaction[];
  ledgerEntries: LedgerEntry[];
}

export function totalMinor(rows: { amountMinor: number; currency: string }[]): number {
  return rows.reduce((sum, row) => sum + toUsd(row.amountMinor, row.currency), 0);
}

export function runReconciliation(tables: CoreTables, label: string, ranAt: string): ReconciliationResult {
  const refundById = new Map(tables.refunds.map((refund) => [refund.id, refund]));
  const bySettlement = new Map<string, ProviderTransaction[]>();
  for (const tx of tables.providerTransactions) {
    const list = bySettlement.get(tx.refundId) ?? [];
    list.push(tx);
    bySettlement.set(tx.refundId, list);
  }
  const ledgerByRefund = new Map<string, LedgerEntry[]>();
  for (const entry of tables.ledgerEntries) {
    const list = ledgerByRefund.get(entry.refundId) ?? [];
    list.push(entry);
    ledgerByRefund.set(entry.refundId, list);
  }

  const rows: MatchRow[] = [];
  let matched = 0, providerOnly = 0, ledgerOnly = 0, duplicates = 0, amountMismatch = 0, currencyMismatch = 0;
  let net = 0;

  for (const [refundId, txs] of bySettlement) {
    const entries = ledgerByRefund.get(refundId) ?? [];
    const refund = refundById.get(refundId);
    const providerMinor = txs.reduce((sum, tx) => sum + toUsd(tx.amountMinor, tx.currency), 0);
    const ledgerMinor = entries.reduce((sum, entry) => sum + toUsd(entry.amountMinor, entry.currency), 0);
    const differenceMinor = providerMinor - ledgerMinor;
    const invalidCurrency = refund
      ? txs.some((tx) => tx.currency !== refund.currency)
        || entries.some((entry) => entry.currency !== refund.currency && entry.currency !== 'USD')
      : false;
    currencyMismatch += Number(invalidCurrency);
    if (entries.length === 0) {
      providerOnly += 1;
    } else {
      duplicates += txs.length - 1;
      amountMismatch += Number(differenceMinor !== 0);
      if (!invalidCurrency && differenceMinor === 0) matched += 1;
    }
    net += differenceMinor;
    rows.push({
      settlementId: txs.map((tx) => tx.id).join('+'),
      refundId,
      providerMinor,
      ledgerMinor,
      differenceMinor,
      currency: 'USD',
      side: entries.length === 0
        ? 'PROVIDER_ONLY'
        : invalidCurrency
          ? 'CURRENCY_MISMATCH'
          : differenceMinor === 0
            ? 'MATCHED'
            : 'AMOUNT_MISMATCH',
    });
  }
  for (const [refundId, entries] of ledgerByRefund) {
    if (!bySettlement.has(refundId)) {
      ledgerOnly += 1;
      const ledgerMinor = entries.reduce((sum, entry) => sum + toUsd(entry.amountMinor, entry.currency), 0);
      net -= ledgerMinor;
      rows.push({ settlementId: '—', refundId, providerMinor: 0, ledgerMinor, differenceMinor: -ledgerMinor, currency: 'USD', side: 'LEDGER_ONLY' });
    }
  }

  return {
    id: `REC${String(ranAt.length)}${Math.floor(Math.random() * 900 + 100)}`,
    label,
    ranAt,
    matchedCount: matched,
    providerOnlyCount: providerOnly,
    ledgerOnlyCount: ledgerOnly,
    duplicateCount: duplicates,
    amountMismatchCount: amountMismatch,
    currencyMismatchCount: currencyMismatch,
    netDiscrepancyMinor: net,
    rows,
  };
}

export type { Finding } from './types';

export function computeFindings(tables: CoreTables): Finding[] {
  const findings: Finding[] = [];
  const providerByRefund = new Map<string, ProviderTransaction[]>();
  for (const tx of tables.providerTransactions) {
    const list = providerByRefund.get(tx.refundId) ?? [];
    list.push(tx);
    providerByRefund.set(tx.refundId, list);
  }
  const ledgerByRefund = new Map<string, LedgerEntry[]>();
  for (const entry of tables.ledgerEntries) {
    const list = ledgerByRefund.get(entry.refundId) ?? [];
    list.push(entry);
    ledgerByRefund.set(entry.refundId, list);
  }
  const refundById = new Map(tables.refunds.map((r) => [r.id, r]));

  for (const [refundId, txs] of providerByRefund) {
    const refund = refundById.get(refundId);
    const entries = ledgerByRefund.get(refundId) ?? [];
    const providerRaw = txs.reduce((sum, tx) => sum + tx.amountMinor, 0);
    const ledgerRaw = entries.reduce((sum, entry) => sum + entry.amountMinor, 0);
    const providerMinor = txs.reduce((sum, tx) => sum + toUsd(tx.amountMinor, tx.currency), 0);
    const ledgerMinor = entries.reduce((sum, entry) => sum + toUsd(entry.amountMinor, entry.currency), 0);
    const differenceMinor = providerMinor - ledgerMinor;
    const providerCurrency = txs[0].currency;
    const ledgerCurrency = entries[0]?.currency ?? providerCurrency;
    const invalidCurrency = refund
      ? txs.some((tx) => tx.currency !== refund.currency)
        || entries.some((entry) => entry.currency !== refund.currency && entry.currency !== 'USD')
      : false;
    if (txs.length > 1) {
      findings.push({ id: `F${refundId}-DUP`, refundId, customerId: refund?.customerId ?? '—', providerMinor, ledgerMinor, differenceMinor, currency: 'USD', providerCurrency, ledgerCurrency, kind: 'DUPLICATE_REFUND', cause: `${txs.length} provider settlements exist for one refund request`, severity: 'HIGH' });
    } else if (entries.length === 0) {
      findings.push({ id: `F${refundId}-MLEDGER`, refundId, customerId: refund?.customerId ?? '—', providerMinor, ledgerMinor: 0, differenceMinor: providerMinor, currency: 'USD', providerCurrency, ledgerCurrency, kind: 'MISSING_LEDGER', cause: 'Provider settled the refund but no ledger entry was posted', severity: 'HIGH' });
    } else if (invalidCurrency) {
      findings.push({ id: `F${refundId}-CUR`, refundId, customerId: refund?.customerId ?? '—', providerMinor, ledgerMinor, differenceMinor, currency: 'USD', providerCurrency, ledgerCurrency, kind: 'CURRENCY_MISMATCH', cause: `Provider uses ${providerCurrency}; ledger uses ${ledgerCurrency}, which is not a valid currency for this refund.`, severity: 'MEDIUM' });
    } else if (differenceMinor !== 0) {
      const direction = differenceMinor > 0 ? 'short' : 'over';
      findings.push({
        id: `F${refundId}-AMT`,
        refundId,
        customerId: refund?.customerId ?? '—',
        providerMinor,
        ledgerMinor,
        differenceMinor,
        currency: 'USD',
        providerCurrency,
        ledgerCurrency,
        kind: 'AMOUNT_MISMATCH',
        cause: `Provider ${providerCurrency} ${(providerRaw / 100).toFixed(2)} equals $${(providerMinor / 100).toFixed(2)} USD; ledger ${ledgerCurrency} ${(ledgerRaw / 100).toFixed(2)} equals $${(ledgerMinor / 100).toFixed(2)} USD, leaving the ledger ${ (Math.abs(differenceMinor) / 100).toFixed(2) } USD ${direction}.`,
        severity: 'MEDIUM',
      });
    }
  }
  return findings;
}

export function defaultFixStatuses(): Record<string, 'PROPOSED' | 'VERIFIED' | 'APPLIED'> {
  return {
    idempotency_keys: 'PROPOSED',
    atomic_claim: 'PROPOSED',
    provider_status_probe: 'PROPOSED',
    ledger_recovery: 'PROPOSED',
    decimal_fx: 'PROPOSED',
    safe_retry: 'PROPOSED',
  };
}

export const FX_TABLE: Record<'EUR' | 'GBP', number> = { EUR: 1.1, GBP: 1.27 };

export function toUsd(amountMinor: number, currency: string): number {
  if (currency === 'USD') return amountMinor;
  const rateHundredths = currency === 'EUR' ? 110 : currency === 'GBP' ? 127 : 100;
  const converted = amountMinor * rateHundredths;
  return Math.sign(converted) * Math.floor((Math.abs(converted) + 50) / 100);
}

export function emptyReconciliation(label: string): ReconciliationResult {
  return { id: '—', label, ranAt: new Date(SIM_TZ).toISOString(), matchedCount: 0, providerOnlyCount: 0, ledgerOnlyCount: 0, duplicateCount: 0, amountMismatchCount: 0, currencyMismatchCount: 0, netDiscrepancyMinor: 0, rows: [] };
}
