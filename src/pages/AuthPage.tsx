import { useState } from 'react';
import { LifeBuoy, LoaderCircle, LockKeyhole, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth';

export function AuthPage() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'signup') await signup(name, email, password);
      else await login(email, password);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not authenticate.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative isolate flex min-h-screen items-center justify-center overflow-hidden bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100 px-4 py-8 sm:px-6">
      <div aria-hidden="true" className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-blue-300/30 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -right-24 h-[30rem] w-[30rem] rounded-full bg-indigo-300/30 blur-3xl" />

      <div className="relative grid w-full max-w-5xl overflow-hidden rounded-3xl border border-white/80 bg-white shadow-[0_30px_90px_-35px_rgba(30,64,175,0.35)] lg:min-h-[620px] lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative hidden overflow-hidden bg-gradient-to-br from-navy-950 via-navy-900 to-blue-900 p-10 text-white sm:p-12 lg:flex lg:flex-col">
          <div aria-hidden="true" className="absolute -right-24 -top-20 h-72 w-72 rounded-full bg-blue-400/20 blur-3xl" />
          <div aria-hidden="true" className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-indigo-400/20 blur-3xl" />
          <div className="relative flex items-center gap-3">
            <span className="rounded-xl bg-white/15 p-2.5 text-white ring-1 ring-white/20"><LifeBuoy size={23} /></span>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">RefundGuard</h1>
              <p className="text-xs text-blue-100/75">Refund operations workspace</p>
            </div>
          </div>

          <div className="relative my-auto max-w-md py-12">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium text-blue-100">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
              A clearer view of every refund
            </span>
            <h2 className="mt-6 text-4xl font-semibold leading-tight tracking-tight xl:text-5xl">
              Keep your refund operations in control.
            </h2>
            <p className="mt-5 max-w-sm text-sm leading-6 text-blue-100/75">
              Review activity, follow records, and manage your workspace from one secure place.
            </p>

            <div className="mt-10 space-y-3">
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.07] p-4">
                <span className="rounded-xl bg-emerald-300/10 p-2.5 text-emerald-200"><ShieldCheck size={19} /></span>
                <div>
                  <p className="text-sm font-medium text-white">Your workspace, your records</p>
                  <p className="mt-0.5 text-xs text-blue-100/65">Account data stays private to you.</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.07] p-4">
                <span className="rounded-xl bg-blue-300/10 p-2.5 text-blue-200"><LockKeyhole size={19} /></span>
                <div>
                  <p className="text-sm font-medium text-white">A secure sign-in</p>
                  <p className="mt-0.5 text-xs text-blue-100/65">Access your account whenever you need it.</p>
                </div>
              </div>
            </div>
          </div>
          <p className="relative text-xs text-blue-100/55">RefundGuard · Refund operations workspace</p>
        </section>

        <section className="flex items-center justify-center px-6 py-10 sm:px-12 lg:px-14">
          <div className="w-full max-w-md">
            <div className="mb-9 flex items-center gap-3 lg:hidden">
              <span className="rounded-xl bg-blue-600 p-2.5 text-white shadow-lg shadow-blue-600/20"><LifeBuoy size={22} /></span>
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-slate-900">RefundGuard</h1>
                <p className="text-xs text-slate-500">Refund operations workspace</p>
              </div>
            </div>

            <div className="mb-7">
              <p className="text-sm font-semibold text-blue-700">{mode === 'login' ? 'Welcome back' : 'Get started'}</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">
                {mode === 'login' ? 'Sign in to your workspace' : 'Create your account'}
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                {mode === 'login' ? 'Enter your details to pick up where you left off.' : 'Your records will be saved to your account.'}
              </p>
            </div>

            <form className="space-y-5" onSubmit={submit}>
              {mode === 'signup' ? (
                <Field label="Name">
                  <input required minLength={2} maxLength={80} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} className={inputClass} />
                </Field>
              ) : null}
              <Field label="Email">
                <input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className={inputClass} />
              </Field>
              <Field label="Password">
                <input required minLength={mode === 'signup' ? 8 : 1} maxLength={128} type="password" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} className={inputClass} />
                {mode === 'signup' ? <span className="mt-1.5 block text-xs text-slate-400">Use at least 8 characters.</span> : null}
              </Field>
              {error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p> : null}
              <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 hover:shadow-blue-700/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60">
                {busy ? <LoaderCircle size={16} className="animate-spin" /> : null}
                {mode === 'login' ? 'Sign in' : 'Create account'}
              </button>
            </form>
            <p className="mt-6 text-center text-sm text-slate-500">
              {mode === 'login' ? 'New to RefundGuard?' : 'Already have an account?'}{' '}
              <button
                type="button"
                className="font-semibold text-blue-700 underline-offset-4 transition hover:text-blue-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
                onClick={() => { setError(''); setMode((value) => value === 'login' ? 'signup' : 'login'); }}
              >
                {mode === 'login' ? 'Create an account' : 'Sign in'}
              </button>
            </p>
            <p className="mt-8 border-t border-slate-100 pt-5 text-center text-xs leading-5 text-slate-400">
              Demo data is shared. Records you create are private to your account.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-2 block text-sm font-medium text-slate-700">{label}</span>{children}</label>;
}

const inputClass = 'w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:ring-4 focus:ring-blue-100';
