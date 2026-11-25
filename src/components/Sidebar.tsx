import { NavLink, Link, useLocation } from 'react-router-dom';
import {
  Activity,
  Bug,
  FileText,
  LayoutDashboard,
  LifeBuoy,
  Search,
  Settings,
  ShieldCheck,
  Undo2,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { useStore } from '@/lib/store';

const NAV_ITEMS = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/refunds', label: 'Refund Operations', icon: Undo2 },
  { to: '/simulation', label: 'Bug Simulation', icon: Bug },
  { to: '/investigation', label: 'Investigation', icon: Search },
  { to: '/reconciliation', label: 'Reconciliation', icon: ShieldCheck },
  { to: '/fixes', label: 'Fix & Recovery', icon: Wrench },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/workers', label: 'Worker Logs', icon: Activity },
  { to: '/reports', label: 'Reports & Documentation', icon: FileText },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { kpis, runs } = useStore();
  const location = useLocation();
  const discrepancy = kpis.financialDiscrepancyMinor;

  return (
    <>
      {open ? <div className="fixed inset-0 bg-navy-950/60 z-40 lg:hidden" onClick={onClose} /> : null}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-navy-900 text-slate-300 flex flex-col transition-transform duration-200 lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center gap-2.5 px-5 h-16 border-b border-navy-700/60">
          <span className="rounded-lg bg-blue-600 p-1.5 text-white shadow">
            <LifeBuoy size={18} />
          </span>
          <div>
            <p className="text-white font-semibold leading-tight">RefundGuard</p>
            <p className="text-[10px] text-navy-300 uppercase tracking-wider">Reconciliation platform</p>
          </div>
          <button className="ml-auto text-navy-300 lg:hidden" onClick={onClose} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = location.pathname === item.to;
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onClose}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${active ? 'bg-navy-700 text-white font-medium' : 'hover:bg-navy-800 hover:text-white'}`}
              >
                <Icon size={16} className={active ? 'text-blue-400' : 'text-navy-300'} />
                <span className="flex-1">{item.label}</span>
                {item.to === '/investigation' && runs.length > 0 ? (
                  <span className="rounded-full bg-rose-500/90 px-1.5 text-[10px] font-semibold text-white">{runs.length}</span>
                ) : null}
              </NavLink>
            );
          })}
        </nav>

        <div className="px-4 pb-4">
          <div className="rounded-lg bg-navy-800 border border-navy-700 p-3">
            <p className="text-[10px] uppercase tracking-wider text-navy-300">Reconciliation health</p>
            <p className={`mt-1 text-sm font-semibold tabular ${discrepancy !== 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
              {discrepancy !== 0 ? 'IMBALANCED' : 'BALANCED'}
            </p>
            <div className="mt-2 h-1.5 rounded-full bg-navy-700 overflow-hidden">
              <div className={`h-full rounded-full ${discrepancy !== 0 ? 'bg-rose-500' : 'bg-emerald-500'}`} style={{ width: discrepancy !== 0 ? '72%' : '100%' }} />
            </div>
            <Link to="/reconciliation" className="mt-2 inline-block text-[11px] text-blue-400 hover:text-blue-300">
              Open reconciliation →
            </Link>
          </div>
        </div>
      </aside>
    </>
  );
}
