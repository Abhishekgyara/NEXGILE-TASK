import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Info, Loader2, X } from 'lucide-react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl bg-white border border-slate-200 shadow-card ${className}`}>{children}</div>;
}

export function CardHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-3">
      <div>
        <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
        {subtitle ? <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  type = 'button',
  className = '',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'success';
  size?: 'sm' | 'md';
  disabled?: boolean;
  loading?: boolean;
  type?: 'button' | 'submit';
  className?: string;
}) {
  const base = 'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed';
  const sizes = { sm: 'text-xs px-3 py-1.5', md: 'text-sm px-4 py-2' };
  const variants = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 focus-visible:ring-blue-500',
    secondary: 'bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus-visible:ring-slate-400',
    danger: 'bg-rose-600 text-white hover:bg-rose-700 focus-visible:ring-rose-500',
    success: 'bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-500',
    ghost: 'text-slate-600 hover:bg-slate-100 focus-visible:ring-slate-400',
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled || loading} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {loading ? <Loader2 size={14} className="animate-spin" /> : null}
      {children}
    </button>
  );
}

const BADGE_STYLES: Record<string, string> = {
  PAID: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  POSTED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  SETTLED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  MATCHED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  DONE: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  PASS: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  IMPLEMENTED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  VERIFIED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  APPLIED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  INFO: 'bg-blue-50 text-blue-700 ring-blue-200',
  OK: 'bg-blue-50 text-blue-700 ring-blue-200',
  PROCESSING: 'bg-blue-50 text-blue-700 ring-blue-200',
  SIMULATION: 'bg-blue-50 text-blue-700 ring-blue-200',
  PENDING: 'bg-amber-50 text-amber-700 ring-amber-200',
  WARN: 'bg-amber-50 text-amber-700 ring-amber-200',
  RETRY: 'bg-amber-50 text-amber-700 ring-amber-200',
  TIMEOUT: 'bg-amber-50 text-amber-700 ring-amber-200',
  PROPOSED: 'bg-amber-50 text-amber-700 ring-amber-200',
  MONITOR: 'bg-amber-50 text-amber-700 ring-amber-200',
  FAILED: 'bg-rose-50 text-rose-700 ring-rose-200',
  ERROR: 'bg-rose-50 text-rose-700 ring-rose-200',
  ERR: 'bg-rose-50 text-rose-700 ring-rose-200',
  CRITICAL: 'bg-rose-50 text-rose-700 ring-rose-200',
  HIGH: 'bg-rose-50 text-rose-700 ring-rose-200',
  FAIL: 'bg-rose-50 text-rose-700 ring-rose-200',
  AMOUNT_MISMATCH: 'bg-rose-50 text-rose-700 ring-rose-200',
  CURRENCY_MISMATCH: 'bg-rose-50 text-rose-700 ring-rose-200',
  DUPLICATE_REFUND: 'bg-rose-50 text-rose-700 ring-rose-200',
  MISSING_LEDGER: 'bg-rose-50 text-rose-700 ring-rose-200',
  WORKER_FAILURE: 'bg-rose-50 text-rose-700 ring-rose-200',
  PROVIDER_ONLY: 'bg-rose-50 text-rose-700 ring-rose-200',
  LEDGER_ONLY: 'bg-amber-50 text-amber-700 ring-amber-200',
  MEDIUM: 'bg-amber-50 text-amber-700 ring-amber-200',
  LOW: 'bg-slate-100 text-slate-600 ring-slate-200',
  SUSPECTED: 'bg-amber-50 text-amber-700 ring-amber-200',
  CONFIRMED: 'bg-rose-50 text-rose-700 ring-rose-200',
  RESOLVED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  CLAWBACK_REVIEW: 'bg-rose-50 text-rose-700 ring-rose-200',
  LEDGER_WRITE_OFF: 'bg-amber-50 text-amber-700 ring-amber-200',
  NOT_SENT: 'bg-slate-100 text-slate-600 ring-slate-200',
  NOT_RECORDED: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export function Badge({ value, label }: { value: string; label?: string }) {
  const style = BADGE_STYLES[value] ?? 'bg-slate-100 text-slate-600 ring-slate-200';
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${style}`}>
      {label ?? value.replace(/_/g, ' ')}
    </span>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  tone = 'neutral',
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'good' | 'bad' | 'warn' | 'info';
  icon?: ReactNode;
}) {
  const tones = {
    neutral: { value: 'text-slate-900', chip: 'bg-slate-100 text-slate-600' },
    good: { value: 'text-emerald-700', chip: 'bg-emerald-50 text-emerald-600' },
    bad: { value: 'text-rose-700', chip: 'bg-rose-50 text-rose-600' },
    warn: { value: 'text-amber-700', chip: 'bg-amber-50 text-amber-600' },
    info: { value: 'text-blue-700', chip: 'bg-blue-50 text-blue-600' },
  };
  const t = tones[tone];
  return (
    <Card className="card-hover p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</p>
        {icon ? <span className={`rounded-lg p-1.5 ${t.chip}`}>{icon}</span> : null}
      </div>
      <p className={`mt-3 text-2xl font-semibold tabular ${t.value}`}>{value}</p>
      {sub ? <p className="mt-1 text-xs text-slate-500">{sub}</p> : null}
    </Card>
  );
}

export function EmptyState({ title, message, action }: { title: string; message: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
      <div className="rounded-full bg-slate-100 p-3 mb-3 text-slate-400">
        <Info size={22} />
      </div>
      <h4 className="text-sm font-semibold text-slate-700">{title}</h4>
      <p className="mt-1 text-xs text-slate-500 max-w-sm">{message}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function LoadingState({ label = 'Loading data…' }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-slate-500">
      <Loader2 size={24} className="animate-spin text-blue-600" />
      <p className="mt-3 text-sm">{label}</p>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer, wide = false }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-navy-950/50 animate-overlay-in" onClick={onClose} />
      <div className={`relative bg-white rounded-xl shadow-xl border border-slate-200 w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} max-h-[85vh] flex flex-col animate-fade-slide-up`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
        {footer ? <div className="px-5 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', tone = 'danger', loading = false }: { open: boolean; onClose: () => void; onConfirm: () => void; title: string; message: string; confirmLabel?: string; tone?: 'danger' | 'primary'; loading?: boolean }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button variant={tone} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
        </>
      }
    >
      <div className="flex gap-3">
        <span className={tone === 'danger' ? 'text-rose-500' : 'text-amber-500'}>
          <AlertTriangle size={20} />
        </span>
        <p className="text-sm text-slate-600">{message}</p>
      </div>
    </Modal>
  );
}

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  sortValue?: (row: T) => string | number;
  className?: string;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  pageSize = 10,
  onRowClick,
  emptyTitle = 'No records found',
  emptyMessage = 'Try adjusting your search or filters.',
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  pageSize?: number;
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyMessage?: string;
}) {
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const sorted = (() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = col.sortValue!(a);
      const vb = col.sortValue!(b);
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
  })();

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const slice = sorted.slice(current * pageSize, current * pageSize + pageSize);

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  if (rows.length === 0) return <EmptyState title={emptyTitle} message={emptyMessage} />;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/60">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500 ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'} ${col.sortValue ? 'cursor-pointer select-none hover:text-slate-700' : ''}`}
                  onClick={() => col.sortValue && toggleSort(col.key)}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.header}
                    {col.sortValue && sortKey === col.key ? <ChevronDown size={12} className={sortDir === 'desc' ? 'rotate-180' : ''} /> : null}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((row) => (
              <tr
                key={rowKey(row)}
                className={`border-b border-slate-100 last:border-0 transition-colors ${onRowClick ? 'cursor-pointer hover:bg-blue-50/50' : 'hover:bg-slate-50'}`}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((col) => (
                  <td key={col.key} className={`px-4 py-2.5 ${col.align === 'right' ? 'text-right tabular' : col.align === 'center' ? 'text-center' : ''} ${col.className ?? ''}`}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
        <p className="text-xs text-slate-500">
          Showing {current * pageSize + 1}–{Math.min((current + 1) * pageSize, sorted.length)} of {sorted.length}
        </p>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="secondary" onClick={() => setPage(Math.max(0, current - 1))} disabled={current === 0}>Previous</Button>
          <span className="px-2 text-xs text-slate-500 tabular">Page {current + 1} / {pageCount}</span>
          <Button size="sm" variant="secondary" onClick={() => setPage(Math.min(pageCount - 1, current + 1))} disabled={current >= pageCount - 1}>Next</Button>
        </div>
      </div>
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full sm:w-64 rounded-lg border border-slate-300 px-3 py-2 text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-shadow"
    />
  );
}

export function FilterSelect({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; label: string }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="rounded-lg border border-slate-300 px-3 py-2 text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

export function ToastContainer({ toasts, onDismiss }: { toasts: { id: string; kind: 'success' | 'error' | 'info'; message: string }[]; onDismiss: (id: string) => void }) {
  const icons = { success: <CheckCircle2 size={16} />, error: <AlertTriangle size={16} />, info: <Info size={16} /> };
  const styles = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    error: 'border-rose-200 bg-rose-50 text-rose-800',
    info: 'border-blue-200 bg-blue-50 text-blue-800',
  };
  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]">
      {toasts.map((t) => (
        <div key={t.id} className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 shadow-card animate-fade-slide-up ${styles[t.kind]}`}>
          <span className="mt-0.5 shrink-0">{icons[t.kind]}</span>
          <p className="text-xs leading-relaxed flex-1">{t.message}</p>
          <button onClick={() => onDismiss(t.id)} className="opacity-60 hover:opacity-100" aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function useDebounced<T>(value: T, delay = 250): T {
  const [debounced, setDebounced] = useState(value);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer.current);
  }, [value, delay]);
  return debounced;
}
