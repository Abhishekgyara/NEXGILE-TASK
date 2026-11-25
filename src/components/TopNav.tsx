import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, CircleDot, Menu, UserCircle2 } from 'lucide-react';
import { useStore } from '@/lib/store';
import { dateTime } from '@/lib/format';
import { useAuth } from '@/lib/auth';

export function TopNav({ onMenu }: { onMenu: () => void }) {
  const { world, env, kpis, pushToast } = useStore();
  const { user, logout } = useAuth();
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const navigate = useNavigate();

  const incidents = world.workerLogs.filter((l) => l.level === 'ERROR').slice(0, 4);

  return (
    <header className="sticky top-0 z-30 h-16 bg-white/95 backdrop-blur border-b border-slate-200 flex items-center gap-3 px-4 lg:px-6">
      <button className="text-slate-500 lg:hidden" onClick={onMenu} aria-label="Open menu">
        <Menu size={20} />
      </button>

      <div className="hidden md:flex items-center gap-2 rounded-full bg-blue-50 border border-blue-200 px-3 py-1">
        <CircleDot size={12} className="text-blue-600" />
        <span className="text-xs font-medium text-blue-700">{env.mode} environment</span>
      </div>
      <div className="flex-1" />

      <div className="relative">
        <button onClick={() => { setNotifOpen((o) => !o); setProfileOpen(false); }} className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 transition-colors" aria-label="Notifications">
          <Bell size={18} />
          {kpis.duplicateRefunds > 0 ? (
            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white" />
          ) : null}
        </button>
        {notifOpen ? (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setNotifOpen(false)} />
            <div className="absolute right-0 z-20 mt-1.5 w-80 rounded-lg border border-slate-200 bg-white shadow-lg overflow-hidden animate-fade-slide-up">
              <p className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 border-b border-slate-100">Latest financial incidents</p>
              {incidents.map((l) => (
                <div key={l.id} className="px-4 py-2.5 border-b border-slate-100 last:border-0">
                  <p className="text-xs font-medium text-slate-700">{l.refundId ?? '—'} · {l.event}</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">{l.message}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{dateTime(l.createdAt)}</p>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>

      <div className="relative">
        <button onClick={() => { setProfileOpen((o) => !o); setNotifOpen(false); }} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-100 transition-colors" aria-label="Profile menu">
          <UserCircle2 size={26} className="text-slate-400" />
          <span className="hidden sm:block text-left">
            <span className="block text-xs font-semibold text-slate-700 leading-tight">{user?.name ?? 'Account'}</span>
            <span className="block text-[10px] text-slate-500 leading-tight">{user?.email}</span>
          </span>
          <ChevronDown size={14} className="text-slate-400" />
        </button>
        {profileOpen ? (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setProfileOpen(false)} />
            <div className="absolute right-0 z-20 mt-1.5 w-48 rounded-lg border border-slate-200 bg-white shadow-lg py-1 animate-fade-slide-up">
              <button className="w-full text-left px-4 py-2 text-sm text-slate-600 hover:bg-slate-50" onClick={() => setProfileOpen(false)}>Profile</button>
              <button className="w-full text-left px-4 py-2 text-sm text-slate-600 hover:bg-slate-50" onClick={() => navigate('/settings')}>Settings</button>
              <div className="border-t border-slate-100 my-1" />
              <button
                className="w-full text-left px-4 py-2 text-sm text-rose-600 hover:bg-rose-50"
                onClick={async () => {
                  setProfileOpen(false);
                  try {
                    await logout();
                  } catch (error) {
                    pushToast('error', error instanceof Error ? error.message : 'Sign out failed');
                  }
                }}
              >
                Sign out
              </button>
            </div>
          </>
        ) : null}
      </div>
    </header>
  );
}
