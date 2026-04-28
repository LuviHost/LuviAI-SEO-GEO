import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { isAdminUnlockEnabled, isAdminUnlocked, setAdminUnlockCookie, verifyPin } from '@/lib/admin-unlock';
import { Card, CardContent } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

async function unlockAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    redirect('/dashboard');
  }
  const pin = String(formData.get('pin') ?? '').trim();
  const next = String(formData.get('next') ?? '/admin');

  if (!verifyPin(pin)) {
    redirect(`/admin-unlock?error=wrong&next=${encodeURIComponent(next)}`);
  }

  await setAdminUnlockCookie(session.user.id);
  redirect(next);
}

export default async function AdminUnlockPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const session = await auth();
  const params = await searchParams;
  const next = params.next ?? '/admin';

  if (!session?.user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent('/admin-unlock?next=' + next)}`);
  }
  if (session.user.role !== 'ADMIN') {
    redirect('/dashboard');
  }

  // PIN devre disiysa direkt panele gonder
  if (!isAdminUnlockEnabled()) {
    redirect(next);
  }

  if (await isAdminUnlocked(session.user.id)) {
    redirect(next);
  }

  return (
    <div className="min-h-screen bg-slate-950 grid place-items-center px-4">
      <Card className="w-full max-w-sm bg-slate-900 border-slate-800 text-slate-100">
        <CardContent className="p-6 space-y-5">
          <div>
            <div className="text-xs uppercase tracking-wide text-amber-400 mb-1">LuviAI Admin</div>
            <h1 className="text-xl font-bold">Yönetici PIN'i</h1>
            <p className="text-sm text-slate-400 mt-1">
              Devam etmek için yöneticilere özel PIN'i gir.
            </p>
          </div>

          <form action={unlockAction} className="space-y-3">
            <input type="hidden" name="next" value={next} />
            <input
              type="password"
              name="pin"
              autoFocus
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="••••••"
              className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-2 text-base tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-amber-400/40"
            />

            {params.error === 'wrong' && (
              <p className="text-sm text-red-400">PIN hatalı, tekrar dene.</p>
            )}

            <button
              type="submit"
              className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold py-2 rounded-md transition-colors"
            >
              Kilidi Aç
            </button>
          </form>

          <div className="text-xs text-slate-500 border-t border-slate-800 pt-3">
            Bu PIN sadece yöneticilere verilir. Kaybedersen sunucuda{' '}
            <code className="text-slate-400">.env</code> içindeki{' '}
            <code className="text-slate-400">ADMIN_PIN</code> ile doğrula.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
