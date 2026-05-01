import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import {
  isAdminUnlockEnabled, isAdminUnlocked, setAdminUnlockCookie, verifyPin,
} from '@/lib/admin-unlock';
import {
  isAdminOtpEnabled, isAuthorizedAdminEmail, requestAdminOtp, verifyAdminOtp,
} from '@/lib/admin-otp';
import { Card, CardContent } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

/**
 * Admin paneline ek-faktor giriş.
 * Öncelik:
 *   1) Email-OTP (RESEND_API_KEY ve ADMIN_EMAIL env'lerinde varsa)
 *   2) PIN (ADMIN_PIN env'inde varsa, fallback)
 *   3) Hiçbiri yoksa direkt panel
 */

async function sendOtpAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user?.email || session.user.role !== 'ADMIN') {
    redirect('/dashboard');
  }
  if (!isAuthorizedAdminEmail(session.user.email)) {
    redirect(`/admin-unlock?error=unauthorized`);
  }
  const next = String(formData.get('next') ?? '/admin');
  const result = await requestAdminOtp(session.user.email);
  if (!result.ok) {
    const code = result.reason === 'COOLDOWN' ? 'cooldown' : 'mail_fail';
    redirect(`/admin-unlock?step=otp&error=${code}&next=${encodeURIComponent(next)}`);
  }
  redirect(`/admin-unlock?step=otp&sent=1&next=${encodeURIComponent(next)}`);
}

async function verifyOtpAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user?.id || !session.user.email || session.user.role !== 'ADMIN') {
    redirect('/dashboard');
  }
  const code = String(formData.get('code') ?? '').trim();
  const next = String(formData.get('next') ?? '/admin');

  const result = verifyAdminOtp(session.user.email, code);
  if (!result.ok) {
    const reason = result.reason ?? 'wrong';
    redirect(`/admin-unlock?step=otp&error=${reason.toLowerCase()}&next=${encodeURIComponent(next)}`);
  }

  await setAdminUnlockCookie(session.user.id);
  redirect(next);
}

async function unlockPinAction(formData: FormData) {
  'use server';
  const session = await auth();
  if (!session?.user || session.user.role !== 'ADMIN') {
    redirect('/dashboard');
  }
  const pin = String(formData.get('pin') ?? '').trim();
  const next = String(formData.get('next') ?? '/admin');

  if (!verifyPin(pin)) {
    redirect(`/admin-unlock?step=pin&error=wrong&next=${encodeURIComponent(next)}`);
  }
  await setAdminUnlockCookie(session.user.id);
  redirect(next);
}

export default async function AdminUnlockPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; step?: string; sent?: string }>;
}) {
  const session = await auth();
  const params = await searchParams;
  const next = params.next ?? '/admin';
  const otpEnabled = isAdminOtpEnabled();
  const pinEnabled = isAdminUnlockEnabled();

  if (!session?.user) {
    redirect(`/signin?callbackUrl=${encodeURIComponent('/admin-unlock?next=' + next)}`);
  }
  if (session.user.role !== 'ADMIN') {
    redirect('/dashboard');
  }
  if (!otpEnabled && !pinEnabled) {
    redirect(next);
  }
  if (await isAdminUnlocked(session.user.id)) {
    redirect(next);
  }

  // Yetkili admin email değilse error göster (OTP modunda)
  const userEmail = session.user.email ?? '';
  const isOtpMode = otpEnabled && (!params.step || params.step === 'send' || params.step === 'otp');
  const isPinMode = !isOtpMode && pinEnabled;

  if (otpEnabled && !isAuthorizedAdminEmail(userEmail)) {
    return (
      <div className="min-h-screen bg-slate-950 grid place-items-center px-4">
        <Card className="w-full max-w-sm bg-slate-900 border-red-500/40 text-slate-100">
          <CardContent className="p-6 space-y-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-red-400 mb-1">LuviAI Admin</div>
              <h1 className="text-xl font-bold">Erişim engellendi</h1>
              <p className="text-sm text-slate-400 mt-1">
                Bu Google hesabı (<strong>{userEmail}</strong>) admin email listesinde değil.
              </p>
            </div>
            <p className="text-xs text-slate-500">
              Doğru hesapla giriş yapmadıysan <a href="/signin" className="text-amber-400 hover:underline">çıkış yap ve tekrar dene</a>.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // OTP gönderim aşaması (default OTP modunda)
  if (isOtpMode && params.step !== 'otp') {
    return (
      <div className="min-h-screen bg-slate-950 grid place-items-center px-4">
        <Card className="w-full max-w-sm bg-slate-900 border-slate-800 text-slate-100">
          <CardContent className="p-6 space-y-5">
            <div>
              <div className="text-xs uppercase tracking-wide text-amber-400 mb-1">LuviAI Admin</div>
              <h1 className="text-xl font-bold">Email ile giriş</h1>
              <p className="text-sm text-slate-400 mt-1">
                Admin paneline girmek için 6 haneli kodu mailine göndereceğiz.
              </p>
            </div>

            <div className="rounded-md border border-slate-800 bg-slate-950 px-3 py-2.5 text-sm">
              <div className="text-[10px] uppercase tracking-wide text-slate-500 mb-1 font-mono">Mail adresi</div>
              <div className="text-slate-100 font-mono">{userEmail}</div>
            </div>

            {params.error === 'unauthorized' && (
              <p className="text-sm text-red-400">Bu hesap yetkili admin listesinde değil.</p>
            )}
            {params.error === 'mail_fail' && (
              <p className="text-sm text-red-400">Mail gönderilemedi. Tekrar dene.</p>
            )}

            <form action={sendOtpAction}>
              <input type="hidden" name="next" value={next} />
              <button
                type="submit"
                className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold rounded-md py-2.5 transition"
              >
                Kod Gönder
              </button>
            </form>

            {pinEnabled && (
              <a
                href={`/admin-unlock?step=pin&next=${encodeURIComponent(next)}`}
                className="block text-center text-xs text-slate-500 hover:text-slate-300 underline"
              >
                Veya admin PIN kullan
              </a>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // OTP doğrulama aşaması
  if (isOtpMode && params.step === 'otp') {
    const errorMsg: Record<string, string> = {
      wrong_code: 'Kod hatalı, tekrar dene.',
      no_code: 'Önce kod gönder.',
      expired: 'Kodun süresi doldu. Yeni kod iste.',
      too_many_attempts: 'Çok fazla yanlış deneme. Yeni kod iste.',
      cooldown: 'Lütfen 30 saniye sonra tekrar dene.',
      mail_fail: 'Mail gönderilemedi. Tekrar dene.',
    };

    return (
      <div className="min-h-screen bg-slate-950 grid place-items-center px-4">
        <Card className="w-full max-w-sm bg-slate-900 border-slate-800 text-slate-100">
          <CardContent className="p-6 space-y-5">
            <div>
              <div className="text-xs uppercase tracking-wide text-amber-400 mb-1">LuviAI Admin</div>
              <h1 className="text-xl font-bold">Mail kodunu gir</h1>
              <p className="text-sm text-slate-400 mt-1">
                <strong>{userEmail}</strong> adresine 6 haneli kod gönderildi. 5 dakika geçerli.
              </p>
            </div>

            {params.sent === '1' && !params.error && (
              <p className="text-sm text-emerald-400">✓ Kod gönderildi, mailini kontrol et.</p>
            )}

            <form action={verifyOtpAction} className="space-y-3">
              <input type="hidden" name="next" value={next} />
              <input
                type="text"
                name="code"
                autoFocus
                required
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoComplete="one-time-code"
                placeholder="••••••"
                className="w-full bg-slate-950 border border-slate-800 rounded-md px-3 py-3 text-2xl tracking-[0.4em] text-center font-mono focus:outline-none focus:ring-2 focus:ring-amber-400/40"
              />

              {params.error && errorMsg[params.error] && (
                <p className="text-sm text-red-400">{errorMsg[params.error]}</p>
              )}

              <button
                type="submit"
                className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold rounded-md py-2.5 transition"
              >
                Doğrula ve Aç
              </button>
            </form>

            <div className="flex items-center justify-between text-xs">
              <form action={sendOtpAction}>
                <input type="hidden" name="next" value={next} />
                <button type="submit" className="text-slate-500 hover:text-slate-300 underline">
                  Yeni kod iste
                </button>
              </form>
              {pinEnabled && (
                <a
                  href={`/admin-unlock?step=pin&next=${encodeURIComponent(next)}`}
                  className="text-slate-500 hover:text-slate-300 underline"
                >
                  PIN kullan
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // PIN modu (fallback)
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
          <form action={unlockPinAction} className="space-y-3">
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
              className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold rounded-md py-2.5 transition"
            >
              Kilidi Aç
            </button>
          </form>
          {otpEnabled && (
            <a
              href={`/admin-unlock?next=${encodeURIComponent(next)}`}
              className="block text-center text-xs text-slate-500 hover:text-slate-300 underline"
            >
              Veya mail ile gir
            </a>
          )}
          <hr className="border-slate-800" />
          <p className="text-xs text-slate-500">
            Bu PIN sadece yöneticilere verilir. Kaybedersen sunucuda <code className="text-slate-300">.env</code> içindeki <code className="text-slate-300">ADMIN_PIN</code> ile doğrula.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
