'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertCircle, CheckCircle2, ExternalLink, FileText, Images, KeyRound, Loader2, MessageSquare, Package,
  RefreshCw, Star, Unlink, X,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBanner } from '@/components/ui/status-banner';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { AscMetadataPanel } from '@/components/asc-metadata-panel';
import { AscScreenshotsPanel } from '@/components/asc-screenshots-panel';
import { AscReviewReply } from '@/components/asc-review-reply';
import { cn } from '@/lib/utils';

/**
 * App Store Connect — site düzeyi hesap bağlantısı (/aso/connect).
 * Eskiden tek bir uygulamanın modalının sekmesiydi; artık site genelinde
 * ayrı sayfa. Uygulama görünümü yalnız eşleşen ASC uygulamasının panellerini
 * (metadata, ekran görüntüleri, yorumlar) kullanır.
 */

interface Account {
  id: string;
  issuerId: string;
  keyId: string;
  isActive: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  apps: Array<{ id: string; appleAppId: string; bundleId: string; name: string; latestVersion: string | null; latestReleaseAt: string | null }>;
}

interface Alert {
  id: string; severity: string; message: string; daysSinceUpdate: number;
  acknowledgedAt: string | null; createdAt: string;
  app: { name: string; appleAppId: string };
}

type PanelKind = 'reviews' | 'metadata' | 'screenshots';

export function AscTab({ siteId }: { siteId: string }) {
  const confirm = useConfirm();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConnect, setShowConnect] = useState(false);
  const [openPanel, setOpenPanel] = useState<{ appId: string; kind: PanelKind } | null>(null);
  const toggle = (appId: string, kind: PanelKind) =>
    setOpenPanel(openPanel?.appId === appId && openPanel.kind === kind ? null : { appId, kind });

  const refresh = async () => {
    setLoading(true);
    try {
      const [accs, alts] = await Promise.all([
        api.listAscAccounts(siteId).catch(() => []),
        api.listAscAlerts(siteId).catch(() => []),
      ]);
      setAccounts(accs ?? []);
      setAlerts(alts ?? []);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [siteId]);

  const disconnect = async (acc: Account) => {
    const ok = await confirm({
      title: 'App Store Connect bağlantısı kaldırılsın mı?',
      description: 'Apple tarafında hiçbir şey silinmez; yalnız RanksUp bağlantısı kesilir.',
      confirmLabel: 'Bağlantıyı kaldır',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.disconnectAsc(acc.id);
      toast.success('Bağlantı kaldırıldı');
      refresh();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const sync = async (acc: Account) => {
    try {
      const r = await api.syncAscApps(acc.id);
      toast.success(`${r.synced} uygulama eşitlendi`);
      refresh();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  if (loading) {
    return <div className="space-y-3" aria-busy="true"><Skeleton className="h-24" /><Skeleton className="h-40" /></div>;
  }

  if (accounts.length === 0) {
    return (
      <>
        <AscConnectScreen onConnect={() => setShowConnect(true)} />
        <AscConnectDialog siteId={siteId} open={showConnect} onOpenChange={setShowConnect} onSuccess={() => { setShowConnect(false); refresh(); }} />
      </>
    );
  }

  return (
    <div className="space-y-5">
      {alerts.length > 0 && (
        <StatusBanner tone="warning" title={`${alerts.length} aktif uyarı`}>
          <ul className="mt-1 space-y-1.5">
            {alerts.slice(0, 3).map((a) => (
              <li key={a.id} className="flex items-start gap-2">
                <Badge variant={a.severity === 'CRITICAL' ? 'danger' : 'warning'} className="shrink-0 px-1.5 text-label">
                  {a.severity === 'CRITICAL' ? 'Kritik' : 'Uyarı'}
                </Badge>
                <span className="flex-1 text-foreground"><span className="font-medium">{a.app.name}:</span> {a.message}</span>
                <button
                  type="button"
                  onClick={async () => { await api.acknowledgeAscAlert(a.id); refresh(); }}
                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  aria-label="Uyarıyı kapat"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </StatusBanner>
      )}

      <div className="space-y-3">
        {accounts.map((acc) => (
          <Card key={acc.id}>
            <CardContent className="space-y-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand/10 text-brand" aria-hidden>
                    <KeyRound className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">App Store Connect</span>
                      <Badge variant="success" className="px-2 text-label">Aktif</Badge>
                    </div>
                    <p className="mt-0.5 font-mono text-label text-muted-foreground">Issuer: {acc.issuerId.slice(0, 8)}… · Anahtar: {acc.keyId.slice(0, 8)}…</p>
                    <p className="mt-0.5 text-label text-muted-foreground">
                      {acc.apps.length} uygulama · son eşitleme: {acc.lastSyncAt ? new Date(acc.lastSyncAt).toLocaleString('tr-TR') : 'henüz yok'}
                    </p>
                    {acc.lastError && (
                      <p className="mt-1 flex items-center gap-1 text-label text-danger">
                        <AlertCircle className="h-3 w-3" aria-hidden /> {acc.lastError.slice(0, 120)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => sync(acc)}>
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Eşitle
                  </Button>
                  <Button size="sm" variant="ghost" className="w-9 px-0 text-danger hover:bg-danger/10" onClick={() => disconnect(acc)} aria-label="Bağlantıyı kaldır">
                    <Unlink className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {acc.apps.length === 0 ? (
                <p className="text-sm text-muted-foreground">Uygulama bulunamadı — "Eşitle" ile çek.</p>
              ) : (
                <ul className="space-y-2 sm:pl-12">
                  {acc.apps.map((app) => (
                    <li key={app.id} className="rounded-lg border bg-background p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                            <span className="truncate text-sm font-semibold">{app.name}</span>
                            {app.latestVersion && <Badge variant="outline" className="px-1.5 text-label">v{app.latestVersion}</Badge>}
                          </div>
                          <p className="mt-0.5 font-mono text-label text-muted-foreground">{app.bundleId} · {app.appleAppId}</p>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {([
                            ['metadata', FileText, 'Metadata'],
                            ['screenshots', Images, 'Ekran görüntüleri'],
                            ['reviews', MessageSquare, 'Yorumlar'],
                          ] as const).map(([kind, Icon, label]) => (
                            <Button
                              key={kind}
                              size="sm"
                              variant={openPanel?.appId === app.id && openPanel.kind === kind ? 'secondary' : 'outline'}
                              className="h-8 text-label"
                              aria-expanded={openPanel?.appId === app.id && openPanel.kind === kind}
                              onClick={() => toggle(app.id, kind)}
                            >
                              <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
                            </Button>
                          ))}
                        </div>
                      </div>
                      {openPanel?.appId === app.id && openPanel.kind === 'reviews' && <AscReviewsPanel ascAppId={app.id} />}
                      {openPanel?.appId === app.id && openPanel.kind === 'metadata' && <AscMetadataPanel siteId={siteId} ascAppId={app.id} />}
                      {openPanel?.appId === app.id && openPanel.kind === 'screenshots' && <AscScreenshotsPanel siteId={siteId} ascAppId={app.id} />}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

/**
 * Bir ASC uygulamasının yorumları + yanıt (AI taslak, insan düzenler).
 * Kendi kaydırıcısı yok — sayfa kayar; uzun listede "daha fazla" ile açılır.
 */
export function AscReviewsPanel({ ascAppId, className }: { ascAppId: string; className?: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [data, setData] = useState<any>(null);
  const [limit, setLimit] = useState(10);

  const loadReviews = () => {
    setLoading(true);
    setError(null);
    api.fetchAscReviews(ascAppId)
      .then(setData)
      .catch((err) => setError(err))
      .finally(() => setLoading(false));
  };
  useEffect(loadReviews, [ascAppId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading && !data) {
    return <div className={cn('mt-3 space-y-2', className)} aria-busy="true"><Skeleton className="h-16" /><Skeleton className="h-16" /></div>;
  }
  if (error && !data) {
    return (
      <div className={cn('mt-3 flex items-center gap-2 text-sm text-danger', className)} role="alert">
        <AlertCircle className="h-4 w-4" aria-hidden /> {(error as any)?.message ?? 'Yorumlar alınamadı'}
        <Button size="sm" variant="outline" onClick={loadReviews}>Tekrar dene</Button>
      </div>
    );
  }
  if (!data) return null;

  const reviews: any[] = data.reviews ?? [];

  return (
    <div className={cn('mt-3 space-y-2.5 border-t pt-3', className)}>
      <div className="flex items-center gap-2 text-sm">
        <span className="font-semibold">{data.appName} yorumları</span>
        {data.avgRating && <span className="text-muted-foreground">· ort. {data.avgRating} · {reviews.length} yorum</span>}
      </div>
      {reviews.length === 0 ? (
        <p className="text-sm text-muted-foreground">Yorum yok.</p>
      ) : (
        <ul className="space-y-2">
          {reviews.slice(0, limit).map((r: any) => (
            <li key={r.id} className="rounded-md border bg-muted/20 p-3 text-sm">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="inline-flex gap-0.5" aria-label={`${r.rating} / 5 yıldız`}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} className={cn('h-3 w-3', n <= r.rating ? 'fill-warning text-warning' : 'text-muted-foreground/30')} aria-hidden />
                  ))}
                </span>
                <span className="font-medium">{r.title || '(başlıksız)'}</span>
                <span className="ml-auto text-label text-muted-foreground">
                  {r.territory} · {r.createdDate ? new Date(r.createdDate).toLocaleDateString('tr-TR') : '—'}
                </span>
              </div>
              <p className="leading-relaxed text-muted-foreground">{r.body}</p>
              <p className="mt-1 text-label text-muted-foreground">— {r.reviewerNickname}</p>
              <AscReviewReply appId={ascAppId} review={r} onSent={loadReviews} />
            </li>
          ))}
        </ul>
      )}
      {reviews.length > limit && (
        <Button size="sm" variant="ghost" onClick={() => setLimit(limit + 10)}>Daha fazla göster ({reviews.length - limit})</Button>
      )}
    </div>
  );
}

function AscConnectScreen({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="rounded-lg border bg-card p-8 text-center">
      <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-xl bg-brand/10 text-brand" aria-hidden>
        <Package className="h-6 w-6" />
      </div>
      <h3 className="mb-2 text-h6 font-semibold">App Store Connect&apos;i bağla</h3>
      <p className="mx-auto mb-5 max-w-md text-sm text-muted-foreground">
        Yorumlara yanıt, sürüm takibi, metadata ve ekran görüntüsü yükleme için Apple geliştirici hesabını bir kez bağla.
        Uygulamaların App Store kimliğiyle otomatik eşleşir.
      </p>
      <Button onClick={onConnect}>
        <KeyRound className="h-4 w-4" aria-hidden /> Hesap bağla
      </Button>
      <div>
        <a
          href="https://appstoreconnect.apple.com/access/api"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-label text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-3 w-3" aria-hidden /> App Store Connect → Users and Access → Keys
        </a>
      </div>
    </div>
  );
}

function AscConnectDialog({
  siteId, open, onOpenChange, onSuccess,
}: { siteId: string; open: boolean; onOpenChange: (v: boolean) => void; onSuccess: () => void }) {
  const [issuerId, setIssuerId] = useState('');
  const [keyId, setKeyId] = useState('');
  const [privateKeyPem, setPrivateKeyPem] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!issuerId || !keyId || !privateKeyPem) {
      toast.error('Tüm alanlar gerekli');
      return;
    }
    setSubmitting(true);
    try {
      await api.connectAsc(siteId, { issuerId: issuerId.trim(), keyId: keyId.trim(), privateKeyPem: privateKeyPem.trim() });
      toast.success('App Store Connect bağlandı');
      onSuccess();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>App Store Connect bağla</DialogTitle>
          <DialogDescription>Apple geliştirici hesabından bir API anahtarı (.p8) gerekir.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="mb-1 font-medium">Bilgileri nereden alırım?</p>
            <ol className="list-decimal space-y-0.5 pl-4 text-muted-foreground">
              <li><a href="https://appstoreconnect.apple.com/access/integrations/api" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">App Store Connect → Users and Access → Integrations → App Store Connect API</a></li>
              <li>"Generate API Key" — App Manager rolü</li>
              <li>Issuer ID (üstte), Key ID (yeni satır) ve .p8 dosyası</li>
              <li>Üçünü aşağıya yapıştır</li>
            </ol>
          </div>
          <div>
            <label htmlFor="asc-issuer" className="mb-1 block text-label">Issuer ID</label>
            <Input id="asc-issuer" value={issuerId} onChange={(e) => setIssuerId(e.target.value)} placeholder="69a6de8a-1234-…" className="font-mono" required />
          </div>
          <div>
            <label htmlFor="asc-key" className="mb-1 block text-label">Key ID</label>
            <Input id="asc-key" value={keyId} onChange={(e) => setKeyId(e.target.value)} placeholder="2X9XYZ12AB" className="font-mono" required />
          </div>
          <div>
            <label htmlFor="asc-pem" className="mb-1 block text-label">.p8 özel anahtar</label>
            <Textarea
              id="asc-pem"
              value={privateKeyPem}
              onChange={(e) => setPrivateKeyPem(e.target.value)}
              placeholder={'-----BEGIN PRIVATE KEY-----\nMIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg…'}
              rows={6}
              className="font-mono text-label"
              required
            />
            <p className="mt-1 text-label text-muted-foreground">AuthKey_XXXX.p8 dosyasının ham içeriği. Şifrelenmiş (AES-256) saklanır.</p>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Vazgeç</Button>
          <Button onClick={submit} disabled={submitting || !issuerId || !keyId || !privateKeyPem}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
            {submitting ? 'Bağlanıyor…' : 'Bağla'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
