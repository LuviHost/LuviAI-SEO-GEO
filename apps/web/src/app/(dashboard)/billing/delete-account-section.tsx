'use client';

import { useCallback, useState } from 'react';
import { signOut } from 'next-auth/react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBanner } from '@/components/ui/status-banner';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AccountDeletionError,
  appleNeedsManualRemoval,
  detachAgencyClients,
  formatTrDate,
  getAccountDeletionStatus,
  requestAccountDeletion,
  type AccountDeletionResult,
  type AccountDeletionStatus,
} from '@/lib/account-deletion';

/**
 * Hesabı sil — Apple 5.1.1(v) ve KVKK; mobil uygulamadaki akışla aynı politika
 * (apps/api/src/me/account-deletion.policy.ts): erişim hemen kapanır, veriler
 * 30 gün sonra kalıcı silinir, faturalar kişisel bağlantısı kaldırılarak kalır.
 * Metinler o dosyayla birebir aynı şeyi söylemeli.
 */

type Phase = 'loading' | 'ready' | 'error' | 'deleting' | 'done';

const APPLE_STEPS = "Apple ile Giriş bağlantısını kaldırmak için iPhone'unda Ayarlar > [adın] > Apple ile Giriş Yap > RanksUp > Sil adımlarını izle.";

/**
 * "a***@gmail.com · 3 site" (GET /me/account-deletion: maskedEmail, siteCount).
 * NEDEN: farkli bir Google hesabiyla girildiginde sessizce yeni, bos bir hesap
 * acilir; pencere hangi hesabin silinecegini gostermezse kisi gercek hesabi
 * yerine bos hesabi silebilir. Alanlar eski API'de yok: gelmezse satir gosterilmez.
 */
function accountLine(status: AccountDeletionStatus | null): string | null {
  if (!status?.maskedEmail) return null;
  return typeof status.siteCount === 'number' ? `${status.maskedEmail} · ${status.siteCount} site` : status.maskedEmail;
}

export function DeleteAccountSection() {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>('loading');
  const [status, setStatus] = useState<AccountDeletionStatus | null>(null);
  const [result, setResult] = useState<AccountDeletionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [detaching, setDetaching] = useState(false);

  const load = useCallback(async () => {
    setPhase('loading');
    setError(null);
    try {
      setStatus(await getAccountDeletionStatus());
      setPhase('ready');
    } catch (err) {
      setError(err instanceof AccountDeletionError ? err.message : 'Bilgiler alınamadı. Tekrar dene.');
      setPhase('error');
    }
  }, []);

  const openDialog = () => {
    setOpen(true);
    setConfirmed(false);
    setResult(null);
    void load();
  };

  const detach = async () => {
    setDetaching(true);
    setError(null);
    try {
      await detachAgencyClients();
      await load();
    } catch (err) {
      setError(err instanceof AccountDeletionError ? err.message : 'Müşteri bağlantıları kaldırılamadı. Tekrar dene.');
    } finally {
      setDetaching(false);
    }
  };

  const confirmDelete = async () => {
    setPhase('deleting');
    setError(null);
    try {
      setResult(await requestAccountDeletion());
      setPhase('done');
    } catch (err) {
      setError(err instanceof AccountDeletionError ? err.message : 'Silme talebi gönderilemedi. Tekrar dene.');
      setPhase('ready');
      // Engel sonradan oluştuysa (ör. yeni müşteri bağlandı) güncel durumu göster
      if (err instanceof AccountDeletionError && err.status === 409) void load();
    }
  };

  const blockers = status?.blockers ?? [];
  const done = phase === 'done';
  const account = accountLine(status);

  return (
    <section aria-labelledby="hesabi-sil-baslik">
      <Card className="border-danger/30 p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <h2 id="hesabi-sil-baslik" className="font-brand text-h6 font-semibold tracking-tight">Hesabı sil</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Hesabını ve bağlı tüm verilerini silebilirsin. Erişimin hemen kapanır, aboneliğin durur; verilerin 30 gün sonra kalıcı olarak silinir.
            </p>
          </div>
          <Button variant="outline" className="text-danger hover:bg-danger/10 hover:text-danger" onClick={openDialog}>
            <Trash2 className="h-4 w-4" aria-hidden /> Hesabımı sil
          </Button>
        </div>
      </Card>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          // Silme işlenirken ya da tamamlandıktan sonra pencere kapanmaz: oturum artık geçersiz
          if (!o && (phase === 'deleting' || done)) return;
          setOpen(o);
        }}
      >
        <DialogContent hideClose={phase === 'deleting' || done}>
          {done && result ? (
            <>
              <DialogHeader>
                <DialogTitle>Silme talebin alındı</DialogTitle>
                <DialogDescription>Hesabına erişim kapatıldı.</DialogDescription>
              </DialogHeader>
              <DialogBody className="space-y-3 text-sm">
                <p>
                  Verilerin <strong>{formatTrDate(result.purgeAfter)}</strong> tarihinden sonra kalıcı olarak silinecek. Fatura ve ödeme kayıtların kişisel bağlantısı kaldırılarak saklanır.
                </p>
                {appleNeedsManualRemoval(status, result.apple) && <p className="text-muted-foreground">{APPLE_STEPS}</p>}
              </DialogBody>
              <DialogFooter>
                <Button onClick={() => signOut({ callbackUrl: '/' })}>Çıkış yap</Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Hesabın silinsin mi?</DialogTitle>
                <DialogDescription>Bu işlem geri alınamaz.</DialogDescription>
              </DialogHeader>
              <DialogBody className="space-y-4">
                {phase === 'loading' && (
                  <div className="space-y-2" aria-busy="true">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-4/6" />
                  </div>
                )}

                {phase === 'error' && (
                  <StatusBanner tone="danger" title="Bilgiler alınamadı" action={<Button size="sm" variant="outline" onClick={() => void load()}>Tekrar dene</Button>}>
                    {error}
                  </StatusBanner>
                )}

                {(phase === 'ready' || phase === 'deleting') && status && blockers.length > 0 && (
                  <div className="space-y-3">
                    {blockers.map((b) => (
                      <StatusBanner
                        key={b.code}
                        tone="warning"
                        title={b.code === 'agency_has_clients' ? 'Önce müşteri hesaplarını ayır' : 'Bu hesap silinemez'}
                        action={b.code === 'agency_has_clients' ? (
                          <Button size="sm" variant="outline" onClick={detach} disabled={detaching}>
                            {detaching ? 'Ayrılıyor…' : 'Müşteri bağlantılarını kaldır'}
                          </Button>
                        ) : undefined}
                      >
                        {b.message}
                      </StatusBanner>
                    ))}
                    {error && <p className="text-sm text-danger" role="alert">{error}</p>}
                  </div>
                )}

                {(phase === 'ready' || phase === 'deleting') && status && blockers.length === 0 && (
                  <>
                    {account && (
                      <p className="text-sm">
                        Silinecek hesap: <strong>{account}</strong>
                      </p>
                    )}
                    <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                      <li>Hesabına erişimin hemen kapanır; panel ve mobil uygulamadaki oturumların sonlandırılır.</li>
                      {status.subscriptionActive ? (
                        <li>
                          Aboneliğin hemen iptal edilir ve kartından yeni ödeme alınmaz. Kalan dönem için ücret iadesi otomatik yapılmaz; iade talebin için destek ekibine yazabilirsin.
                        </li>
                      ) : (
                        <li>Kartından ödeme alınmaz; otomatik yenileme kapatılır.</li>
                      )}
                      {/* account-deletion.service.ts freezeAccountData ile ayni: otopilot,
                          reklam ve ASA otopilotu kapanir, zamanlanmis makaleler taslaga
                          doner, uygulama takibi durur. "Sosyal paylasim" kaldirilan bir
                          ozellikti (panelde sosyal modul yok). */}
                      <li>API anahtarların iptal edilir; otomatik yayın, reklam ve Apple Search Ads otopilotu ile uygulama sıra takibi durur; yayın hedefi ve bağlı hesap bilgilerin silinir.</li>
                      <li>
                        Sitelerin, içeriklerin, raporların ve diğer tüm hesap verilerin <strong className="text-foreground">{status.purgeAfterDays} gün sonra</strong> kalıcı olarak silinir.
                      </li>
                      <li>Fatura ve ödeme kayıtların, vergi ve ticaret mevzuatı gereği saklanması zorunlu olduğundan kişisel bağlantısı kaldırılarak saklanır.</li>
                      {appleNeedsManualRemoval(status, null) && <li>{APPLE_STEPS}</li>}
                    </ul>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={confirmed}
                        onChange={(e) => setConfirmed(e.target.checked)}
                        disabled={phase === 'deleting'}
                      />
                      <span>Hesabımın ve verilerimin silineceğini, bu işlemin geri alınamayacağını anlıyorum.</span>
                    </label>
                    {error && <p className="text-sm text-danger" role="alert">{error}</p>}
                  </>
                )}
              </DialogBody>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={phase === 'deleting'}>Vazgeç</Button>
                <Button
                  variant="destructive"
                  onClick={confirmDelete}
                  disabled={!confirmed || phase !== 'ready' || blockers.length > 0}
                >
                  {phase === 'deleting' ? 'Siliniyor…' : 'Hesabımı sil'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
