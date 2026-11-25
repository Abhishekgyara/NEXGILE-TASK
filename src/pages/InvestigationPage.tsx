import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock, Database, FileWarning, Server, UserX } from 'lucide-react';
import { Badge, Card, Column, DataTable, FilterSelect, KpiCard, Modal, SearchInput, useDebounced } from '@/components/ui';
import { useStore } from '@/lib/store';
import { dateTime, moneyMinor, num } from '@/lib/format';
import type { DiscrepancyRow, Finding, WorkerLog } from '@/lib/types';

const KIND_LABELS: Record<Finding['kind'], string> = {
  DUPLICATE_REFUND: 'Duplicate refund candidate',
  MISSING_LEDGER: 'Missing ledger entry',
  AMOUNT_MISMATCH: 'Amount mismatch',
  CURRENCY_MISMATCH: 'Currency mismatch',
  WORKER_FAILURE: 'Worker failure',
};

export function InvestigationPage() {
  const { findings, world, discrepancyRows } = useStore();
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const [kindFilter, setKindFilter] = useState('ALL');
  const [selected, setSelected] = useState<DiscrepancyRow | null>(null);

  const stats = useMemo(() => {
    const dup = findings.filter((f) => f.kind === 'DUPLICATE_REFUND');
    const missing = findings.filter((f) => f.kind === 'MISSING_LEDGER');
    const cur = findings.filter((f) => f.kind === 'CURRENCY_MISMATCH');
    const workerErrors = world.workerLogs.filter((l) => l.level === 'ERROR');
    const dupTotal = dup.reduce((s, f) => s + f.differenceMinor, 0);
    const suspicious = new Set(findings.map((f) => f.refundId)).size;
    return { dup: dup.length, missing: missing.length, cur: cur.length, workerErrors: workerErrors.length, dupTotal, suspicious };
  }, [findings, world]);

  const rows = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    return discrepancyRows.filter((r) => {
      if (q && !r.refundId.toLowerCase().includes(q) && !r.customerId.toLowerCase().includes(q)) return false;
      if (kindFilter !== 'ALL') {
        const finding = findings.find((f) => f.id === r.key);
        if (!finding || finding.kind !== kindFilter) return false;
      }
      return true;
    });
  }, [discrepancyRows, debounced, kindFilter, findings]);

  const columns: Column<DiscrepancyRow>[] = [
    { key: 'refund', header: 'Refund ID', render: (r) => <span className="font-medium text-slate-800">{r.refundId}</span>, sortValue: (r) => r.refundId },
    { key: 'customer', header: 'Customer', render: (r) => r.customerId, sortValue: (r) => r.customerId },
    { key: 'provider', header: 'Provider (USD eq.)', align: 'right', render: (r) => moneyMinor(r.providerAmountMinor, 'USD'), sortValue: (r) => r.providerAmountMinor },
    { key: 'ledger', header: 'Ledger (USD eq.)', align: 'right', render: (r) => moneyMinor(r.ledgerAmountMinor, 'USD'), sortValue: (r) => r.ledgerAmountMinor },
    { key: 'diff', header: 'Difference (USD)', align: 'right', render: (r) => <span className={r.differenceMinor !== 0 ? 'font-semibold text-rose-600' : 'text-slate-400'}>{moneyMinor(r.differenceMinor, 'USD')}</span>, sortValue: (r) => r.differenceMinor },
    { key: 'cause', header: 'Suspected Cause', render: (r) => <span className="text-xs text-slate-600">{r.suspectedCause}</span> },
    { key: 'status', header: 'Status', render: (r) => <Badge value={r.status} /> },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">Investigation</h1>
        <p className="text-sm text-slate-500 mt-0.5">Classified discrepancies with database, provider, and worker evidence for each record.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        <KpiCard label="Total Suspicious Transactions" value={num(stats.suspicious)} sub="Unique refunds flagged by reconciliation" tone="warn" icon={<FileWarning size={16} />} />
        <KpiCard label="Duplicate Refund Candidates" value={num(stats.dup)} sub={`${moneyMinor(stats.dupTotal)} duplicated payout exposure`} tone="bad" icon={<CopyIcon />} />
        <KpiCard label="Missing Ledger Entries" value={num(stats.missing)} sub="Provider-only settlements with no booking" tone="bad" icon={<Database size={16} />} />
        <KpiCard label="Currency Mismatches" value={num(stats.cur)} sub="Ledger booked in a different currency than settled" tone="warn" icon={<Server size={16} />} />
        <KpiCard label="Worker Failures" value={num(stats.workerErrors)} sub="Error-level log entries across the pool" tone="bad" icon={<AlertTriangle size={16} />} />
        <KpiCard label="Verified Findings" value={num(findings.length)} sub="Confirmed by the reconciliation engine" tone="info" icon={<CheckCircle2 size={16} />} />
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-3 px-5 py-4 border-b border-slate-100">
          <SearchInput value={search} onChange={setSearch} placeholder="Search by refund or customer ID…" />
          <FilterSelect label="Kind" value={kindFilter} onChange={setKindFilter} options={[
            { value: 'ALL', label: 'All finding types' },
            { value: 'DUPLICATE_REFUND', label: 'Duplicate refunds' },
            { value: 'MISSING_LEDGER', label: 'Missing ledger entries' },
            { value: 'AMOUNT_MISMATCH', label: 'Amount mismatches' },
            { value: 'CURRENCY_MISMATCH', label: 'Currency mismatches' },
          ]} />
          <span className="ml-auto text-xs text-slate-500">{rows.length} flagged records</span>
        </div>
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.key} pageSize={12} onRowClick={(r) => setSelected(r)} />
      </Card>

      {selected ? <EvidenceModal row={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function CopyIcon() {
  return <UserX size={16} />;
}

function EvidenceModal({ row, onClose }: { row: DiscrepancyRow; onClose: () => void }) {
  const { world, findings } = useStore();
  const refund = world.refunds.find((r) => r.id === row.refundId);
  const finding = findings.find((f) => f.id === row.key);
  const txs = world.providerTransactions.filter((t) => t.refundId === row.refundId);
  const entries = world.ledgerEntries.filter((l) => l.refundId === row.refundId);
  const logs: WorkerLog[] = world.workerLogs.filter((l) => l.refundId === row.refundId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  return (
    <Modal open onClose={onClose} title={`Evidence — ${row.refundId}`} wide footer={<button onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">Close</button>}>
      <div className="space-y-5">
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge value={finding?.kind ?? 'AMOUNT_MISMATCH'} />
            <Badge value={finding?.severity ?? 'HIGH'} />
            <Badge value={row.status} />
          </div>
          <p className="text-xs text-slate-600 mt-2">{row.suspectedCause}</p>
        </div>

        <Section title="Database entries" icon={<Database size={14} />}>
          <KV k="Refund record" v={refund ? `${refund.id} · ${moneyMinor(refund.amountMinor, refund.currency)} · status ${refund.status}` : 'not found'} />
          <KV k="Ledger entries" v={entries.length === 0 ? 'NONE — provider-only settlement' : entries.map((e) => `${e.id}: ${moneyMinor(e.amountMinor, e.currency)} (${e.status})`).join(' | ')} />
          <KV k="Provider settlements" v={txs.map((t) => `${t.id}: ${moneyMinor(t.amountMinor, t.currency)} (${t.status})`).join(' | ')} />
          <KV k="Worker job" v={(() => { const job = world.workerJobs.find((j) => j.refundId === row.refundId); return job ? `${job.id} · ${job.status} · ${job.attempts} attempt(s)` : 'no job'; })()} />
        </Section>

        <Section title="Provider settlement records" icon={<Server size={14} />}>
          {txs.length === 0 ? <p className="text-xs text-slate-500">No settlements.</p> : txs.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-2 text-xs border border-slate-200 rounded-lg px-3 py-2">
              <span className="font-medium text-slate-700">{t.id}</span>
              <Badge value={t.status} />
              <span className="tabular">{moneyMinor(t.amountMinor, t.currency)}</span>
              <span className="text-slate-400">{t.settlementId}</span>
              <span className="ml-auto text-slate-400">{dateTime(t.createdAt)}</span>
            </div>
          ))}
        </Section>

        <Section title="Worker logs" icon={<AlertTriangle size={14} />}>
          {logs.length === 0 ? <p className="text-xs text-slate-500">No worker logs for this refund.</p> : logs.map((l) => (
            <div key={l.id} className="flex items-start gap-2 text-xs">
              <Badge value={l.level} />
              <div>
                <p className="font-medium text-slate-700">{l.event}</p>
                <p className="text-slate-500">{l.message}</p>
                <p className="text-slate-400 text-[10px]">{l.workerId} · {dateTime(l.createdAt)}</p>
              </div>
            </div>
          ))}
        </Section>

        <Section title="Transaction timeline" icon={<Clock size={14} />}>
          <ol className="relative border-l-2 border-slate-200 ml-2 space-y-3">
            {(refund ? [{ at: refund.createdAt, label: 'Refund request created', detail: `${moneyMinor(refund.amountMinor, refund.currency)} for ${refund.orderId}` }] : [])
              .concat(txs.map((t) => ({ at: t.createdAt, label: `Provider settlement ${t.id}`, detail: `${moneyMinor(t.amountMinor, t.currency)} (${t.status})` })))
              .concat(entries.map((e) => ({ at: e.createdAt, label: `Ledger entry ${e.id}`, detail: `${moneyMinor(e.amountMinor, e.currency)} (${e.status})` })))
              .sort((a, b) => a.at.localeCompare(b.at))
              .map((e, i) => (
                <li key={i} className="ml-4">
                  <span className="absolute -left-[5px] mt-1.5 h-2 w-2 rounded-full bg-slate-300" />
                  <p className="text-xs font-medium text-slate-700">{e.label}</p>
                  <p className="text-xs text-slate-500">{e.detail}</p>
                  <p className="text-[10px] text-slate-400">{dateTime(e.at)}</p>
                </li>
              ))}
          </ol>
        </Section>
      </div>
    </Modal>
  );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">{icon}{title}</h4>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      <span className="font-medium text-slate-600 min-w-[10rem]">{k}</span>
      <span className="text-slate-500 flex-1 min-w-[12rem]">{v}</span>
    </div>
  );
}

export { KIND_LABELS };
