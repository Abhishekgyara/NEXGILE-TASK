import { useState } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar';
import { TopNav } from '@/components/TopNav';
import { ToastContainer } from '@/components/ui';
import { StoreProvider, useStore } from '@/lib/store';
import { OverviewPage } from '@/pages/OverviewPage';
import { RefundOperationsPage } from '@/pages/RefundOperationsPage';
import { BugSimulationPage } from '@/pages/BugSimulationPage';
import { InvestigationPage } from '@/pages/InvestigationPage';
import { ReconciliationPage } from '@/pages/ReconciliationPage';
import { FixRecoveryPage } from '@/pages/FixRecoveryPage';
import { CustomersPage } from '@/pages/CustomersPage';
import { WorkerLogsPage } from '@/pages/WorkerLogsPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { AuthProvider, useAuth } from '@/lib/auth';
import { AuthPage } from '@/pages/AuthPage';

function Shell() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { toasts, dismissToast } = useStore();

  return (
    <div className="min-h-screen">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="lg:pl-64 flex flex-col min-h-screen">
        <TopNav onMenu={() => setSidebarOpen(true)} />
        <main className="flex-1 p-4 lg:p-6">
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/refunds" element={<RefundOperationsPage />} />
            <Route path="/simulation" element={<BugSimulationPage />} />
            <Route path="/investigation" element={<InvestigationPage />} />
            <Route path="/reconciliation" element={<ReconciliationPage />} />
            <Route path="/fixes" element={<FixRecoveryPage />} />
            <Route path="/customers" element={<CustomersPage />} />
            <Route path="/workers" element={<WorkerLogsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AuthShell />
      </BrowserRouter>
    </AuthProvider>
  );
}

function AuthShell() {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-500">Loading workspace…</div>;
  if (!user) return <AuthPage />;
  return (
    <StoreProvider>
        <Shell />
    </StoreProvider>
  );
}
