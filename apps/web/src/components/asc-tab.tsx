'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Link2, Unlink, RefreshCw, AlertCircle, Loader2, ExternalLink,
  Star, MessageSquare, Package, AlertTriangle, CheckCircle2, X, Send,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

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

export function AscTab({ siteId }: { siteId: string }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConnect, setShowConnect] = useState(false);
  const [openAppId, setOpenAppId] = useState<string | null>(null);

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

  useEffect(() => { refresh(); }, [siteId]);

  if (loading) {
    return (
      <div className="rounded-xl border bg-card p-8 grid place-items-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <>
        <ConnectScreen onConnect={() => setShowConnect(true)} />
        {showConnect && <ConnectModal siteId={siteId} onClose={() => setShowConnect(false)} onSuccess={() => { setShowConnect(false); refresh(); }} />}
      </>
    );
  }

  return (
    <div className="space-y-5">
      {/* Alerts banner */}
      {alerts.length > 0 && (
        <div className="rounded-xl border-2 border-amber-500/40 bg-amber-50/50 dark:bg-amber-950/20 p-4 space-y-2">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span className="text-sm font-bold">{alerts.length} aktif uyarı</span>
          </div>
          {alerts.slice(0, 3).map((a) => (
            <div key={a.id} className="text-xs flex items-start gap-2">
              <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded ${a.severity === 'CRITICAL' ? 'bg-rose-500/15 text-rose-700' : 'bg-amber-500/15 text-amber-700'}`}>
                {a.severity}
              </span>
              <div className="flex-1">
                <span className="font-semibold">{a.app.name}:</span> {a.message}
              </div>
              <button
                onClick={async () => { await api.acknowledgeAscAlert(a.id); refresh(); }}
                className="text-muted-foreground hover:text-foreground shrink-0"
                title="Onayla"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Accounts */}
      <div className="space-y-3">
        {accounts.map((acc) => (
          <Card key={acc.id}>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-blue-500/15 to-blue-600/10 grid place-items-center shrink-0">
                    <Link2 className="h-4 w-4 text-blue-600" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold">App Store Connect</span>
                      <Badge variant="outline" className="text-[10px]">Aktif</Badge>
                    </div>
                    <p className="text-[11px] text-muted-foreground font-mono mt-0.5">Issuer: {acc.issuerId.slice(0, 8)}… · Key: {acc.keyId.slice(0, 8)}…</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">{acc.apps.length} app · son sync: {acc.lastSyncAt ? new Date(acc.lastSyncAt).toLocaleString('tr-TR') : 'henüz yok'}</p>
                    {acc.lastError && (
                      <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" /> {acc.lastError.slice(0, 120)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        const r = await api.syncAscApps(acc.id);
                        toast.success(`${r.synced} app sync edildi`);
                        refresh();
                      } catch (err: any) {
                        toast.error(err.message);
                      }
                    }}
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1" /> Sync
                  </Button>
                  <button
                    onClick={async () => {
                      if (!confirm('ASC bağlantısı kaldırılsın mı?')) return;
                      await api.disconnectAsc(acc.id);
                      toast.success('Kaldırıldı');
                      refresh();
                    }}
                    className="h-8 w-8 grid place-items-center rounded hover:bg-rose-500/10 text-rose-500"
                  >
                    <Unlink className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Apps */}
              {acc.apps.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">App bulunamadı — "Sync" ile çek.</p>
              ) : (
                <div className="space-y-2 pl-12">
                  {acc.apps.map((app) => (
                    <div key={app.id} className="rounded-lg border bg-background p-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Package className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                            <span className="text-sm font-semibold truncate">{app.name}</span>
                            {app.latestVersion && <Badge variant="outline" className="text-[10px]">v{app.latestVersion}</Badge>}
                          </div>
                          <p className="text-[10px] text-muted-foreground font-mono mt-0.5">{app.bundleId} · {app.appleAppId}</p>
                        </div>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setOpenAppId(openAppId === app.id ? null : app.id)}>
                            <MessageSquare className="h-3 w-3 mr-1" /> Yorumlar
                          </Button>
                        </div>
                      </div>
                      {openAppId === app.id && <AppReviewsPanel appId={app.id} />}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function AppReviewsPanel({ appId }: { appId: string }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    setLoading(true);
    api.fetchAscReviews(appId)
      .then(setData)
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
  }, [appId]);

  if (loading) {
    return <div className="mt-3 grid place-items-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>;
  }
  if (!data) return null;

  return (
    <div className="mt-3 pt-3 border-t space-y-2.5">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-bold">{data.appName} Yorumları</span>
        {data.avgRating && (
          <div className="inline-flex items-center gap-1">
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
            <span className="font-bold">{data.avgRating}</span>
            <span className="text-muted-foreground">({data.reviews.length} yorum)</span>
          </div>
        )}
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto">
        {data.reviews.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">Yorum yok.</p>
        ) : (
          data.reviews.map((r: any) => (
            <div key={r.id} className="rounded border bg-muted/20 p-2 text-xs">
              <div className="flex items-center gap-2 mb-1">
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star key={n} className={`h-3 w-3 ${n <= r.rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}`} />
                  ))}
                </div>
                <span className="font-semibold">{r.title || '(başlıksız)'}</span>
                <span className="text-muted-foreground ml-auto text-[10px]">{r.territory} · {r.createdDate ? new Date(r.createdDate).toLocaleDateString('tr-TR') : '?'}</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">{r.body}</p>
              <p className="text-[10px] text-muted-foreground mt-1">— {r.reviewerNickname}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ConnectScreen({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="rounded-2xl border bg-card p-8 text-center">
      <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-blue-600/20 grid place-items-center mx-auto mb-4">
        <Package className="h-7 w-7 text-blue-600" />
      </div>
      <h3 className="text-xl font-bold mb-2">App Store Connect bağla</h3>
      <p className="text-sm text-muted-foreground mb-5 max-w-md mx-auto">
        Müşteri yorumları, release takibi ve "abandonware" uyarıları için Apple Developer hesabını bağla.
      </p>
      <Button onClick={onConnect} className="bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white">
        <Link2 className="h-4 w-4 mr-2" /> Hesap bağla
      </Button>
      <a
        href="https://appstoreconnect.apple.com/access/api"
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mt-3"
      >
        <ExternalLink className="h-3 w-3" /> App Store Connect → Users and Access → Keys
      </a>
    </div>
  );
}

function ConnectModal({ siteId, onClose, onSuccess }: { siteId: string; onClose: () => void; onSuccess: () => void }) {
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
      toast.success('✅ App Store Connect bağlandı');
      onSuccess();
    } catch (err: any) {
      toast.error(`Hata: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border rounded-2xl shadow-2xl max-w-xl w-full max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-bold">App Store Connect Bağla</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Apple Developer hesabından .p8 key gerekir.</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          <div className="rounded-lg border bg-muted/30 p-3 text-xs">
            <p className="font-semibold mb-1">Bilgileri nereden alırım?</p>
            <ol className="list-decimal pl-4 space-y-0.5 text-muted-foreground">
              <li><a href="https://appstoreconnect.apple.com/access/integrations/api" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">App Store Connect → Users and Access → Integrations → App Store Connect API</a></li>
              <li>"Generate API Key" — App Manager rolü</li>
              <li>Issuer ID (üstte yazıyor) + Key ID (yeni key satırı) + .p8 dosyasını indir</li>
              <li>3 bilgiyi aşağıya yapıştır</li>
            </ol>
          </div>

          <div>
            <label className="text-xs font-semibold mb-1 block">Issuer ID *</label>
            <Input value={issuerId} onChange={(e) => setIssuerId(e.target.value)} placeholder="69a6de8a-1234-..." className="font-mono text-xs" />
          </div>
          <div>
            <label className="text-xs font-semibold mb-1 block">Key ID *</label>
            <Input value={keyId} onChange={(e) => setKeyId(e.target.value)} placeholder="2X9XYZ12AB" className="font-mono text-xs" />
          </div>
          <div>
            <label className="text-xs font-semibold mb-1 block">.p8 Private Key *</label>
            <textarea
              value={privateKeyPem}
              onChange={(e) => setPrivateKeyPem(e.target.value)}
              placeholder="-----BEGIN PRIVATE KEY-----&#10;MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg..."
              rows={6}
              className="w-full font-mono text-[10px] px-2 py-2 rounded border bg-background"
            />
            <p className="text-[10px] text-muted-foreground mt-1">AuthKey_XXXX.p8 dosyasının ham içeriği. Şifrelenmiş (AES-256) saklanır.</p>
          </div>
        </div>
        <div className="px-6 py-4 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>İptal</Button>
          <Button
            onClick={submit}
            disabled={submitting || !issuerId || !keyId || !privateKeyPem}
            className="bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white"
          >
            {submitting ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Bağlanıyor</> : <><CheckCircle2 className="h-4 w-4 mr-1.5" /> Bağla</>}
          </Button>
        </div>
      </div>
    </div>
  );
}
