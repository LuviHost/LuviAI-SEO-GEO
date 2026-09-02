'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Link2, Unlink, RefreshCw, Plus, Trash2, TrendingUp, Eye, MousePointer,
  Download, DollarSign, AlertCircle, ExternalLink, CheckCircle2, Loader2, X,
  Sparkles, Bot,
} from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface Account {
  id: string;
  orgId: string;
  keyId: string;
  teamId: string | null;
  isActive: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  createdAt: string;
  autoPilotEnabled?: boolean;
  autoPilotBudgetCap?: number | null;
  autoPilotLastRunAt?: string | null;
  autoPilotLastResult?: string | null;
  _count: { campaigns: number };
}

interface Campaign {
  id: string;
  asaCampaignId: string;
  name: string;
  budget: number;
  status: string;
  countriesOrRegions: string[];
  appAdamId: string | null;
  createdAt: string;
  account: { id: string; orgId: string };
  _count: { adGroups: number };
}

interface PerformanceData {
  daysBack: number;
  totals: {
    impressions: number;
    taps: number;
    installs: number;
    spendUsd: number;
    avgCpt: number;
    avgCpa: number;
    ttr: number;
    conversionRate: number;
  };
  dailyRows: any[];
}

export function AsaTab({ siteId, prefillKeyword, onPrefillConsumed }: { siteId: string; prefillKeyword?: string | null; onPrefillConsumed?: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [performance, setPerformance] = useState<PerformanceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showConnect, setShowConnect] = useState(false);
  const [showNewCampaign, setShowNewCampaign] = useState<{ accountId: string; initialKeyword?: string } | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const [accs, camps, perf] = await Promise.all([
        api.listAsaAccounts(siteId).catch(() => []),
        api.listAsaCampaigns(siteId).catch(() => []),
        api.getAsaPerformance(siteId, 30).catch(() => null),
      ]);
      setAccounts(accs ?? []);
      setCampaigns(camps ?? []);
      setPerformance(perf);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, [siteId]);

  // Keywords sekmesinden "ASA'ya ekle" tıklanırsa: hesap varsa modal aç + keyword prefill
  useEffect(() => {
    if (!prefillKeyword || loading) return;
    const active = accounts.find((a) => a.isActive);
    if (!active) {
      toast.error('Önce Apple Search Ads bağla — soldaki "Bağla" butonu');
      onPrefillConsumed?.();
      return;
    }
    setShowNewCampaign({ accountId: active.id, initialKeyword: prefillKeyword });
    onPrefillConsumed?.();
  }, [prefillKeyword, loading, accounts]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" /> Apple Search Ads yükleniyor…
      </div>
    );
  }

  // Hiç account yoksa: connect ekranı
  if (accounts.length === 0) {
    return (
      <>
        <ConnectScreen onConnect={() => setShowConnect(true)} />
        {showConnect && (
          <ConnectModal
            siteId={siteId}
            onClose={() => setShowConnect(false)}
            onSuccess={() => {
              setShowConnect(false);
              refresh();
            }}
          />
        )}
      </>
    );
  }

  // Account var: dashboard
  return (
    <div className="space-y-5">
      {/* Account list */}
      <div className="grid gap-3">
        {accounts.map((acc) => (
          <Card key={acc.id} className="border-brand/20 bg-brand/5">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="h-10 w-10 rounded-xl bg-white dark:bg-slate-900 border border-brand/30 grid place-items-center shrink-0">
                    <Link2 className="h-5 w-5 text-brand" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-bold">Apple Search Ads Hesabı</h3>
                      {acc.isActive ? (
                        <Badge variant={'success' as any} className="text-[10px]">Aktif</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">Pasif</Badge>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                      Org ID: {acc.orgId} · Key: {acc.keyId.slice(0, 8)}…
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {acc._count.campaigns} kampanya · son sync:{' '}
                      {acc.lastSyncAt ? new Date(acc.lastSyncAt).toLocaleString('tr-TR') : 'henüz yok'}
                    </div>
                    {acc.lastError && (
                      <div className="text-[11px] text-rose-600 dark:text-rose-400 mt-1 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" /> {acc.lastError}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        const r = await api.syncAsaCampaigns(acc.id);
                        const parts = [`${r.synced} kampanya sync`];
                        if (r.removed && r.removed > 0) parts.push(`${r.removed} silindi`);
                        toast.success(parts.join(' · '));
                        refresh();
                      } catch (err: any) {
                        toast.error(`Sync hatası: ${err.message}`);
                      }
                    }}
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1" /> Sync
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setShowNewCampaign({ accountId: acc.id })}
                    className="bg-gradient-to-br from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 text-white"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" /> Yeni Kampanya
                  </Button>
                  <button
                    onClick={async () => {
                      if (!confirm('Hesabı kaldır? Kampanyalar Apple tarafında silinmez, sadece RanksUp bağlantısı kesilir.')) return;
                      try {
                        await api.disconnectAsa(acc.id);
                        toast.success('Hesap kaldırıldı');
                        refresh();
                      } catch (err: any) {
                        toast.error(err.message);
                      }
                    }}
                    className="h-8 w-8 grid place-items-center rounded hover:bg-rose-500/10 text-rose-500"
                    title="Hesabı kaldır"
                  >
                    <Unlink className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Auto-Pilot panel */}
              <AutoPilotPanel account={acc} onChanged={refresh} />
            </CardContent>
          </Card>
        ))}
        <button
          onClick={() => setShowConnect(true)}
          className="text-xs text-brand hover:underline inline-flex items-center gap-1"
        >
          <Plus className="h-3 w-3" /> Başka hesap bağla
        </button>
      </div>

      {/* Performance summary */}
      {performance && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-bold">Son 30 Gün Performans</h4>
            <span className="text-[11px] text-muted-foreground">
              {performance.dailyRows.length} günlük veri
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MetricCard
              icon={Eye}
              label="Gösterim"
              value={fmtNum(performance.totals.impressions)}
              color="blue"
            />
            <MetricCard
              icon={MousePointer}
              label="Tıklama"
              value={fmtNum(performance.totals.taps)}
              subtext={`%${(performance.totals.ttr * 100).toFixed(2)} TTR`}
              color="violet"
            />
            <MetricCard
              icon={Download}
              label="Kurulum"
              value={fmtNum(performance.totals.installs)}
              subtext={`%${(performance.totals.conversionRate * 100).toFixed(2)} CR`}
              color="emerald"
            />
            <MetricCard
              icon={DollarSign}
              label="Harcama"
              value={`$${performance.totals.spendUsd.toFixed(2)}`}
              subtext={`CPI $${performance.totals.avgCpa.toFixed(2)}`}
              color="orange"
            />
          </div>
        </div>
      )}

      {/* Campaign list */}
      <div>
        <h4 className="text-sm font-bold mb-2">Kampanyalar</h4>
        {campaigns.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed border-border p-6 text-center">
            <TrendingUp className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-sm font-medium">Henüz kampanya yok</p>
            <p className="text-xs text-muted-foreground mt-1">
              Yukarıdaki <strong>+ Yeni Kampanya</strong> ile başla, ya da Apple tarafında oluşturduysan <strong>Sync</strong> ile çek.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {campaigns.map((c) => (
              <Card key={c.id}>
                <CardContent className="p-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-semibold text-sm">{c.name}</span>
                      <Badge
                        variant={c.status === 'ENABLED' ? ('success' as any) : 'outline'}
                        className="text-[10px]"
                      >
                        {c.status}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground">
                        ID: {c.asaCampaignId}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
                      <span>💰 ${c.budget.toFixed(2)}/gün</span>
                      <span>·</span>
                      <span>🌍 {c.countriesOrRegions.join(', ')}</span>
                      <span>·</span>
                      <span>{c._count.adGroups} adgroup</span>
                    </div>
                  </div>
                  <a
                    href={c.appAdamId
                      ? `https://app-ads.apple.com/cm/app/${c.appAdamId}/report/campaign/${c.asaCampaignId}`
                      : `https://app-ads.apple.com/cm`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-brand hover:underline inline-flex items-center gap-1"
                  >
                    <ExternalLink className="h-3 w-3" /> Apple'da aç
                  </a>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {showConnect && (
        <ConnectModal
          siteId={siteId}
          onClose={() => setShowConnect(false)}
          onSuccess={() => {
            setShowConnect(false);
            refresh();
          }}
        />
      )}

      {showNewCampaign && (
        <NewCampaignModal
          accountId={showNewCampaign.accountId}
          siteId={siteId}
          initialKeyword={showNewCampaign.initialKeyword}
          onClose={() => setShowNewCampaign(null)}
          onSuccess={() => {
            setShowNewCampaign(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  Auto-Pilot Panel (account satırı altı)
// ─────────────────────────────────────────────────────────

function AutoPilotPanel({ account, onChanged }: { account: Account; onChanged: () => void }) {
  const [enabled, setEnabled] = useState(!!account.autoPilotEnabled);
  const [budgetCap, setBudgetCap] = useState<string>(account.autoPilotBudgetCap?.toString() ?? '500');
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const lastResult = (() => {
    if (!account.autoPilotLastResult) return null;
    try { return JSON.parse(account.autoPilotLastResult) as { added: string[]; paused: string[]; skipped: string[]; reason?: string }; } catch { return null; }
  })();

  const save = async (nextEnabled?: boolean) => {
    setSaving(true);
    try {
      const cap = parseFloat(budgetCap);
      await api.setAsaAutoPilot(account.id, {
        enabled: nextEnabled ?? enabled,
        budgetCapUsd: isNaN(cap) ? null : cap,
      });
      toast.success(nextEnabled === true ? '🤖 Auto-Pilot AÇILDI' : nextEnabled === false ? 'Auto-Pilot kapatıldı' : 'Bütçe limiti güncellendi');
      onChanged();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const runNow = async () => {
    if (!confirm("Auto-Pilot şimdi çalıştırılsın mı? Yeni keyword'ler eklenir + düşük performanslı olanlar pause edilir.")) return;
    setRunning(true);
    try {
      const r = await api.runAsaAutoPilot(account.id);
      const parts: string[] = [];
      if (r.added.length) parts.push(`+${r.added.length} keyword`);
      if (r.paused.length) parts.push(`-${r.paused.length} pause`);
      if (r.reason) parts.push(r.reason);
      toast.success(`Auto-Pilot bitti: ${parts.join(' · ') || 'değişiklik yok'}`);
      onChanged();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className={cn(
      'mt-3 rounded-lg border-2 transition-colors',
      enabled ? 'border-emerald-500/40 bg-emerald-50/30 dark:bg-emerald-950/10' : 'border-dashed border-border bg-muted/20',
    )}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-3 py-2 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-2">
          <div className={cn('h-7 w-7 rounded-full grid place-items-center', enabled ? 'bg-emerald-500 text-white' : 'bg-muted')}>
            <Bot className="h-3.5 w-3.5" />
          </div>
          <div>
            <p className="text-sm font-semibold">
              Auto-Pilot {enabled ? <Badge className="ml-1 bg-emerald-500 text-white text-[10px]">AKTİF</Badge> : <Badge variant="outline" className="ml-1 text-[10px]">Kapalı</Badge>}
            </p>
            <p className="text-[10px] text-muted-foreground">
              {enabled
                ? `Her gece otomatik · Bütçe cap: $${account.autoPilotBudgetCap ?? '—'}/ay`
                : 'Haftalık AI keyword ekle + düşük perf. pause et'}
            </p>
          </div>
        </div>
        <span className="text-xs text-muted-foreground">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 pt-1 space-y-3 border-t border-border/40">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs">Auto-Pilot</label>
            <Button
              size="sm"
              variant={enabled ? 'default' : 'outline'}
              onClick={async () => { const next = !enabled; setEnabled(next); await save(next); }}
              disabled={saving}
              className={enabled ? 'bg-emerald-600 hover:bg-emerald-700' : ''}
            >
              {enabled ? '✓ AKTİF' : 'Aç'}
            </Button>
          </div>

          <div>
            <label className="text-xs font-semibold mb-1 block">Aylık bütçe cap (USD)</label>
            <div className="flex gap-2">
              <Input
                type="number"
                min={10}
                step={10}
                value={budgetCap}
                onChange={(e) => setBudgetCap(e.target.value)}
                className="h-8 text-sm"
                placeholder="500"
              />
              <Button size="sm" variant="outline" onClick={() => save()} disabled={saving}>
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Kaydet'}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Bu sınır aşılırsa Auto-Pilot yeni keyword eklemez (mevcut kampanyalar Apple tarafında çalışmaya devam eder).
            </p>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={runNow}
            disabled={running || !enabled}
            className="w-full"
          >
            {running ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Çalışıyor</> : <>⚡ Şimdi çalıştır</>}
          </Button>

          {lastResult && (
            <div className="rounded-md bg-background/60 border p-2 text-[11px] space-y-1">
              <p className="font-semibold">Son çalışma{account.autoPilotLastRunAt ? `: ${new Date(account.autoPilotLastRunAt).toLocaleString('tr-TR')}` : ':'}</p>
              {lastResult.added.length > 0 && <p className="text-emerald-700 dark:text-emerald-400">+ {lastResult.added.length} keyword: {lastResult.added.slice(0, 3).join(', ')}{lastResult.added.length > 3 ? '…' : ''}</p>}
              {lastResult.paused.length > 0 && <p className="text-amber-700 dark:text-amber-400">⏸ {lastResult.paused.length} pause: {lastResult.paused.slice(0, 3).join(', ')}{lastResult.paused.length > 3 ? '…' : ''}</p>}
              {lastResult.reason && <p className="text-rose-700 dark:text-rose-400">{lastResult.reason}</p>}
              {!lastResult.added.length && !lastResult.paused.length && !lastResult.reason && <p className="text-muted-foreground">Değişiklik yok</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  Connect Screen (account yokken)
// ─────────────────────────────────────────────────────────

function ConnectScreen({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="rounded-2xl border bg-card p-8 text-center">
      <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-brand-500/20 to-brand-600/20 grid place-items-center mx-auto mb-4">
        <Link2 className="h-7 w-7 text-brand-600" />
      </div>
      <h3 className="text-lg font-bold mb-2">Apple Search Ads Bağla</h3>
      <p className="text-sm text-muted-foreground max-w-md mx-auto mb-5">
        App Store arama sonuçlarında ödemeli reklam göster, organik rank'ını boost et.
        Bağlantı için kendi Apple Developer hesabından oluşturduğun API key (.p8) gerek.
      </p>

      <div className="max-w-md mx-auto text-left rounded-lg border bg-muted/30 p-4 mb-5">
        <p className="text-xs font-semibold mb-2 text-muted-foreground uppercase tracking-wider">
          Ön gereksinimler
        </p>
        <ul className="text-xs space-y-1.5">
          <li className="flex items-start gap-2">
            <span className="text-emerald-600 mt-0.5">✓</span>
            <span><strong>Apple Developer Program</strong> üyeliği ($99/yıl)</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-emerald-600 mt-0.5">✓</span>
            <span><strong>App Store'da yayında</strong> en az 1 iOS app</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-emerald-600 mt-0.5">✓</span>
            <span>
              <strong>Search Ads Advanced</strong> aktif (ücretsiz aktivasyon, kart şart) —{' '}
              <a
                href="https://app.searchads.apple.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand hover:underline"
              >
                searchads.apple.com
              </a>
            </span>
          </li>
        </ul>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 justify-center">
        <Button
          onClick={onConnect}
          className="bg-gradient-to-br from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 text-white"
        >
          <Link2 className="h-4 w-4 mr-1.5" /> Key'imi yapıştır + bağla
        </Button>
        <a
          href="https://developer.apple.com/programs/enroll/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm rounded-md border hover:bg-muted"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Henüz Developer hesabım yok
        </a>
      </div>

      <p className="text-[11px] text-muted-foreground mt-4 max-w-md mx-auto">
        Reklam bütçesi <strong>doğrudan senin Apple kartından</strong> kesilir, RanksUp bütçeyi sadece yönetir.
        Her müşteri kendi key'iyle bağlanır — verileri izole tutulur.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  Connect Modal — key input
// ─────────────────────────────────────────────────────────

function ConnectModal({
  siteId, onClose, onSuccess,
}: {
  siteId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  // 3-step wizard state
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [generating, setGenerating] = useState(false);
  const [publicKeyPem, setPublicKeyPem] = useState('');
  const [privateKeyPem, setPrivateKeyPem] = useState('');
  const [appleCredsRaw, setAppleCredsRaw] = useState('');
  const [parsedClientId, setParsedClientId] = useState('');
  const [parsedKeyId, setParsedKeyId] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [appleLandingUrl, setAppleLandingUrl] = useState('');
  const [errorMode, setErrorMode] = useState<null | { kind: 'invalid_client' | 'other'; raw: string }>(null);

  // ── Step 1: Browser-side ES256 keypair üret (Web Crypto API) ──────────
  const generateKeypair = async () => {
    setGenerating(true);
    try {
      const keypair = await crypto.subtle.generateKey(
        { name: 'ECDSA', namedCurve: 'P-256' },
        true, // extractable
        ['sign', 'verify'],
      );
      // Public key → SPKI → PEM
      const spki = await crypto.subtle.exportKey('spki', keypair.publicKey);
      const publicPem = bufferToPem(spki, 'PUBLIC KEY');
      // Private key → PKCS8 → PEM
      const pkcs8 = await crypto.subtle.exportKey('pkcs8', keypair.privateKey);
      const privatePem = bufferToPem(pkcs8, 'PRIVATE KEY');

      setPublicKeyPem(publicPem);
      setPrivateKeyPem(privatePem);
      // Public key panoya
      try { await navigator.clipboard.writeText(publicPem); } catch { /* clipboard izni yoksa */ }
      toast.success('✅ Anahtar üretildi · Public key panoya kopyalandı');
    } catch (err: any) {
      toast.error(`Anahtar üretim hatası: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  // ── Step 2: Apple'dan kopyalanan blok'tan clientId + keyId çıkar ───────
  // Apple sayfasından kopyalanan format örnek:
  //   clientId SEARCHADS.f5158481-84c4-4baa-86f1-7ef00725f85d
  //   teamId   SEARCHADS.f5158481-84c4-4baa-86f1-7ef00725f85d
  //   keyId    9b19f9eb-8aaf-486c-9a03-62d60f0b0c6d
  const parseAppleCreds = (text: string) => {
    setAppleCredsRaw(text);
    // clientId: SEARCHADS.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (36 char + SEARCHADS. prefix)
    const clientMatch = text.match(/SEARCHADS\.[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i);
    // keyId: standalone UUID (clientId'den farklı, prefix yok)
    const uuidMatches = text.match(/\b[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\b/gi) ?? [];
    // SEARCHADS. prefix'li olmayanları al
    const standaloneUuids = uuidMatches.filter((u) => !text.includes(`SEARCHADS.${u}`));
    const keyMatch = standaloneUuids[0] ?? null;

    setParsedClientId(clientMatch?.[0] ?? '');
    setParsedKeyId(keyMatch ?? '');
  };

  // ── Step 3: Bağla ──────────────────────────────────────────────────────
  const submit = async () => {
    if (!parsedClientId || !parsedKeyId || !privateKeyPem) {
      toast.error('Önceki adımlar tamamlanmadı');
      return;
    }
    setSubmitting(true);
    setErrorMode(null);
    try {
      await api.connectAsa(siteId, {
        orgId: parsedClientId, // backend "orgId" alanı clientId değerini taşır
        keyId: parsedKeyId,
        privateKeyPem,
      });
      toast.success('✅ Apple Search Ads bağlandı');
      onSuccess();
    } catch (err: any) {
      const raw = String(err?.message ?? err ?? '');
      const isInvalidClient = /invalid_client|400/i.test(raw);
      setErrorMode({ kind: isInvalidClient ? 'invalid_client' : 'other', raw });
      // toast sadece kısa bilgi versin; detay ekranda
      toast.error(isInvalidClient ? 'Apple key uyumsuzluğu — aşağıdaki çözüm panelini gör' : 'Bağlantı hatası');
    } finally {
      setSubmitting(false);
    }
  };

  const canGoStep2 = !!publicKeyPem;
  const canGoStep3 = !!parsedClientId && !!parsedKeyId;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border rounded-2xl shadow-2xl max-w-2xl w-full max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-bold">Apple Search Ads Bağla</h2>
            <p className="text-xs text-muted-foreground mt-0.5">3 adımda kurulum — terminal/komut yok</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Stepper */}
        <div className="px-6 py-4 border-b">
          <div className="flex items-center gap-2">
            {[1, 2, 3].map((n) => (
              <div key={n} className="flex items-center gap-2 flex-1">
                <span className={`h-7 w-7 rounded-full grid place-items-center text-xs font-bold shrink-0 transition-colors ${
                  step > n ? 'bg-emerald-500 text-white' :
                  step === n ? 'bg-brand text-white' :
                  'bg-muted text-muted-foreground'
                }`}>
                  {step > n ? <CheckCircle2 className="h-4 w-4" /> : n}
                </span>
                <span className={`text-xs font-medium ${step === n ? 'text-brand' : step > n ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {n === 1 ? 'Anahtar üret' : n === 2 ? "Apple'a yapıştır" : 'Bağla'}
                </span>
                {n < 3 && <div className={`flex-1 h-0.5 ${step > n ? 'bg-emerald-500' : 'bg-muted'}`} />}
              </div>
            ))}
          </div>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
          {/* ─── STEP 1: Keypair üret ─── */}
          {step === 1 && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-4">
                <p className="text-sm leading-relaxed">
                  <strong>Tek tık güvenli anahtar üretimi.</strong> RanksUp tarayıcında ES256 keypair üretir.
                  <strong className="text-emerald-700 dark:text-emerald-400"> Private key sadece sende kalır</strong>,
                  Apple ve RanksUp sunucusu hiç görmez (sadece encrypted blob saklanır).
                </p>
              </div>

              {!publicKeyPem ? (
                <Button
                  onClick={generateKeypair}
                  disabled={generating}
                  className="w-full h-12 bg-gradient-to-br from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 text-white text-base"
                >
                  {generating ? (
                    <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> Üretiliyor…</>
                  ) : (
                    <><Sparkles className="h-5 w-5 mr-2" /> Otomatik Anahtar Üret</>
                  )}
                </Button>
              ) : (
                <>
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-950/10 p-3 flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                    <span className="text-sm">Anahtar üretildi · Public key panoya kopyalandı ✓</span>
                  </div>

                  <details>
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                      Public key'i göster (Apple'a yapıştıracağın metin)
                    </summary>
                    <textarea
                      value={publicKeyPem}
                      readOnly
                      rows={6}
                      className="w-full mt-2 font-mono text-[10px] px-2 py-2 rounded border bg-muted/20"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      onClick={async () => {
                        await navigator.clipboard.writeText(publicKeyPem);
                        toast.success('Panoya kopyalandı');
                      }}
                    >
                      Tekrar kopyala
                    </Button>
                  </details>
                </>
              )}
            </div>
          )}

          {/* ─── STEP 2: Apple'a yapıştır + credentials al ─── */}
          {step === 2 && (
            <div className="space-y-4">
              {/* Action: Apple sayfasını aç */}
              <div className="rounded-lg border-2 border-brand/40 bg-brand/5 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="h-7 w-7 rounded-full bg-brand text-white flex items-center justify-center text-sm font-bold shrink-0">A</div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold">Apple'da Public Key kaydet</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Public key zaten panonda. Apple Search Ads'i açıp aşağıdaki adımları izle:</p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 border-brand/40 text-brand hover:bg-brand/10"
                      onClick={async () => {
                        try { await navigator.clipboard.writeText(publicKeyPem); toast.success('Public key tekrar kopyalandı'); } catch {}
                        window.open('https://app-ads.apple.com/', '_blank', 'noopener,noreferrer');
                      }}
                    >
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                      Apple Search Ads'i aç + public key'i kopyala
                    </Button>
                    <div className="mt-3 rounded-md bg-background/60 border p-2.5 text-[11px] space-y-2">
                      <p className="font-semibold text-foreground">🎯 Apple "Campaigns" sayfası açıldı mı?</p>
                      <p className="text-muted-foreground">URL'deki <strong className="text-foreground">app numarasını</strong> (8 haneli) gir → seni doğru API sayfasına götüreyim:</p>
                      <p className="text-[10px] text-muted-foreground">
                        Örnek URL: <code className="bg-muted px-1 rounded">…/cm/app/<strong className="text-amber-600">21849740</strong>/report</code> → bu sayıyı yaz
                      </p>
                      <div className="flex gap-1.5">
                        <Input
                          placeholder="örn. 21849740"
                          value={appleLandingUrl}
                          onChange={(e) => {
                            const v = e.target.value;
                            const m = v.match(/\d{6,12}/);
                            setAppleLandingUrl(m ? m[0] : v.replace(/\D/g, ''));
                          }}
                          inputMode="numeric"
                          className="font-mono text-xs h-8"
                        />
                        <Button
                          size="sm"
                          className="h-8 shrink-0"
                          disabled={!appleLandingUrl || appleLandingUrl.length < 6}
                          onClick={async () => {
                            try { await navigator.clipboard.writeText(publicKeyPem); } catch {}
                            window.open(`https://app-ads.apple.com/cm/app/${appleLandingUrl}/settings/apicertificates`, '_blank', 'noopener,noreferrer');
                            toast.success('API sayfası açıldı + public key panoda');
                          }}
                        >
                          <ExternalLink className="h-3 w-3 mr-1" />
                          API'yı aç
                        </Button>
                      </div>
                      <p className="text-muted-foreground text-[10px]">
                        Sonra: Public Key kutusuna <strong>Cmd+V</strong> → <strong>Save</strong> → Apple üstte <code>clientId / teamId / keyId</code> verir.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action: Apple'ın verdiklerini buraya yapıştır */}
              <div className="rounded-lg border-2 border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-950/10 p-4 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="h-7 w-7 rounded-full bg-emerald-600 text-white flex items-center justify-center text-sm font-bold shrink-0">B</div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold">Apple'ın verdiği 3 satırı buraya yapıştır</p>
                    <p className="text-xs text-muted-foreground mt-0.5">"Generate API Client" sonrası Apple sana şu formda 3 satır verir:</p>
                    <pre className="mt-2 text-[10px] font-mono bg-background/60 border rounded p-2 overflow-x-auto">{`clientId  SEARCHADS.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
teamId    SEARCHADS.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
keyId     xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`}</pre>
                    <p className="text-[10px] text-muted-foreground mt-1.5">↳ O 3 satırı seç, <strong>Cmd+C</strong> ile kopyala, aşağıdaki kutuya <strong>Cmd+V</strong> ile yapıştır</p>
                  </div>
                </div>

                <textarea
                  value={appleCredsRaw}
                  onChange={(e) => parseAppleCreds(e.target.value)}
                  placeholder={`Apple'ın verdiği 3 satırı buraya yapıştır...`}
                  rows={5}
                  className="w-full font-mono text-[11px] px-3 py-2 rounded-md border bg-background"
                />

                {/* PEM yanlış yapıştırma uyarısı */}
                {appleCredsRaw.includes('BEGIN PUBLIC KEY') && (
                  <div className="rounded border border-amber-500/50 bg-amber-50/60 dark:bg-amber-950/20 p-2.5 flex gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <p className="font-semibold text-amber-900 dark:text-amber-100">Yanlış metin yapıştırdın — bu senin <em>public key</em>'in.</p>
                      <p className="text-amber-800 dark:text-amber-200 mt-0.5">Bu key'i <strong>Apple'a</strong> yapıştırman lazım, buraya değil. Apple sana sonra 3 satır verecek (clientId / teamId / keyId), <strong>onları</strong> buraya yapıştır.</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Parse sonuçları */}
              {appleCredsRaw && !appleCredsRaw.includes('BEGIN PUBLIC KEY') && (
                <div className="rounded-lg border bg-muted/20 p-3 space-y-2 text-xs">
                  <div className="flex items-center gap-2">
                    {parsedClientId ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-amber-600" />
                    )}
                    <span className="font-semibold w-20">Client ID:</span>
                    <code className={parsedClientId ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
                      {parsedClientId || 'bulunamadı — clientId formatı SEARCHADS.xxx olmalı'}
                    </code>
                  </div>
                  <div className="flex items-center gap-2">
                    {parsedKeyId ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-amber-600" />
                    )}
                    <span className="font-semibold w-20">Key ID:</span>
                    <code className={parsedKeyId ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
                      {parsedKeyId || 'bulunamadı — UUID formatı (8-4-4-4-12 char)'}
                    </code>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ─── STEP 3: Onay + bağla ─── */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-50/30 dark:bg-emerald-950/10 p-4">
                <p className="text-sm font-semibold mb-2 text-emerald-900 dark:text-emerald-100">Her şey hazır — son onay:</p>
                <div className="space-y-1.5 text-xs font-mono">
                  <div className="flex gap-2"><span className="w-24 text-muted-foreground">Client ID:</span><span className="truncate">{parsedClientId}</span></div>
                  <div className="flex gap-2"><span className="w-24 text-muted-foreground">Key ID:</span><span>{parsedKeyId}</span></div>
                  <div className="flex gap-2"><span className="w-24 text-muted-foreground">Private key:</span><span className="text-emerald-700 dark:text-emerald-400">✓ tarayıcıda üretildi, AES-256-GCM ile encrypt edilip kaydedilecek</span></div>
                </div>
              </div>

              {/* Hata RECOVERY paneli */}
              {errorMode && errorMode.kind === 'invalid_client' && (
                <div className="rounded-lg border-2 border-red-500/40 bg-red-50/50 dark:bg-red-950/20 p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-bold text-red-900 dark:text-red-100">Apple bağlantıyı reddetti: <code className="text-xs">invalid_client</code></p>
                      <p className="text-xs text-red-800 dark:text-red-200 mt-1">
                        Bu hatanın <strong>tek</strong> sebebi: Apple'da kayıtlı <strong>public key</strong> ile RanksUp'nın imzalamada kullandığı <strong>private key</strong> birbiriyle eşleşmiyor.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2 text-xs">
                    <p className="font-semibold">İki olası neden + çözüm:</p>

                    <div className="rounded border bg-background/60 p-2.5 space-y-1">
                      <p className="font-semibold">🅰 Daha önce başka bir public key kaydetmiştin (örn. openssl ile)</p>
                      <p className="text-muted-foreground">→ Apple hâlâ ESKİ public key'i tanıyor, ama wizard YENİ private key ile imzalıyor.</p>
                      <p className="text-muted-foreground"><strong>Çözüm A:</strong> Apple'da o ESKİ public key'i sil → Step 1'deki YENİ public key'i yapıştır → yeni clientId/keyId al → Step 2'ye yapıştır.</p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-1.5 h-7 text-[11px]"
                        onClick={() => { setStep(2); setErrorMode(null); }}
                      >
                        ← Step 2'ye dön
                      </Button>
                    </div>

                    <div className="rounded border bg-background/60 p-2.5 space-y-1">
                      <p className="font-semibold">🅱 Elinde zaten kullandığın bir <code>.p8</code>/<code>.pem</code> private key var</p>
                      <p className="text-muted-foreground">→ O zaman wizard'ın ürettiği YENİ key'i değil, ESKİ private key'ini kullanmalıyız.</p>
                      <p className="text-muted-foreground"><strong>Çözüm B:</strong> Step 1'e dön, "Geliştirici misiniz? Manuel anahtar yapıştır" linkine bas, ESKİ private key'ini yapıştır.</p>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-1.5 h-7 text-[11px]"
                        onClick={() => { setStep(1); setShowAdvanced(true); setErrorMode(null); }}
                      >
                        ← Step 1 + Manuel mod
                      </Button>
                    </div>
                  </div>

                  <details className="text-[10px] text-muted-foreground">
                    <summary className="cursor-pointer hover:text-foreground">Ham hata detayı (debug)</summary>
                    <pre className="mt-1 p-1.5 bg-background/40 rounded font-mono whitespace-pre-wrap break-all">{errorMode.raw}</pre>
                  </details>
                </div>
              )}

              {errorMode && errorMode.kind === 'other' && (
                <div className="rounded-lg border border-red-500/40 bg-red-50/50 dark:bg-red-950/20 p-3 flex gap-2">
                  <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                  <div className="text-xs">
                    <p className="font-semibold text-red-900 dark:text-red-100">Bağlantı hatası</p>
                    <p className="font-mono text-[10px] mt-1 break-all">{errorMode.raw}</p>
                  </div>
                </div>
              )}

              {!errorMode && (
                <p className="text-xs text-muted-foreground text-center">
                  <strong>Bağla</strong> tuşuna basınca RanksUp Apple'a JWT auth çağrısı atar.<br />
                  Başarılıysa hesap aktif olur ve kampanya oluşturabilirsin.
                </p>
              )}
            </div>
          )}

          {/* Manuel mode toggle (sadece Step 1'de görünür) */}
          {step === 1 && (
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="text-[11px] text-muted-foreground hover:text-foreground hover:underline w-full text-center pt-2"
            >
              {showAdvanced ? '↑ Hızlı moda dön' : 'Geliştirici misiniz? Manuel anahtar yapıştır →'}
            </button>
          )}

          {/* Manuel mode (eski form, advanced kullanıcılar için) */}
          {step === 1 && showAdvanced && (
            <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
              <p className="text-xs font-semibold">Manuel kurulum (openssl ile kendi anahtarını ürettin?)</p>
              <Input
                placeholder="Client ID (SEARCHADS.xxx)"
                value={parsedClientId}
                onChange={(e) => setParsedClientId(e.target.value)}
                className="font-mono text-xs"
              />
              <Input
                placeholder="Key ID (UUID, 8-4-4-4-12)"
                value={parsedKeyId}
                onChange={(e) => setParsedKeyId(e.target.value)}
                className="font-mono text-xs"
              />
              <textarea
                placeholder="-----BEGIN PRIVATE KEY----- ... -----END PRIVATE KEY-----"
                value={privateKeyPem}
                onChange={(e) => setPrivateKeyPem(e.target.value)}
                rows={4}
                className="w-full font-mono text-[10px] px-2 py-2 rounded border bg-background"
              />
              <Button
                size="sm"
                onClick={submit}
                disabled={submitting || !parsedClientId || !parsedKeyId || !privateKeyPem}
                className="w-full"
              >
                {submitting ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Bağlanıyor</> : 'Manuel Bağla'}
              </Button>
            </div>
          )}
        </div>

        {/* Footer — step navigation */}
        {!showAdvanced && (
          <div className="border-t px-6 py-4 flex items-center justify-between gap-2">
            <Button
              variant="outline"
              onClick={() => step > 1 ? setStep((step - 1) as 1 | 2 | 3) : onClose()}
              disabled={submitting}
            >
              {step > 1 ? '← Geri' : 'İptal'}
            </Button>
            {step < 3 ? (
              <Button
                onClick={() => setStep((step + 1) as 1 | 2 | 3)}
                disabled={(step === 1 && !canGoStep2) || (step === 2 && !canGoStep3)}
                className="bg-gradient-to-br from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 text-white"
              >
                İleri →
              </Button>
            ) : (
              <Button
                onClick={submit}
                disabled={submitting}
                className="bg-gradient-to-br from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 text-white"
              >
                {submitting ? (
                  <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Bağlanıyor…</>
                ) : (
                  <><Link2 className="h-4 w-4 mr-1.5" /> Bağla + test et</>
                )}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────

function bufferToPem(buf: ArrayBuffer, label: string): string {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
  // 64 char/line + PEM header/footer
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.slice(i, i + 64));
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

// ─────────────────────────────────────────────────────────
//  New Campaign Modal
// ─────────────────────────────────────────────────────────

function NewCampaignModal({
  accountId, siteId, initialKeyword, onClose, onSuccess,
}: {
  accountId: string;
  siteId: string;
  initialKeyword?: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState('');
  const [dailyBudgetUsd, setDailyBudgetUsd] = useState(10);
  const [countries, setCountries] = useState<string>('TR');
  const [appleAppId, setAppleAppId] = useState('');
  const [keywordsText, setKeywordsText] = useState('');
  const [bidUsd, setBidUsd] = useState(0.50);
  const [submitting, setSubmitting] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestionMeta, setSuggestionMeta] = useState<{ keywordCount: number; country: string; appName: string } | null>(null);

  const aiFill = async (extraKeyword?: string) => {
    setSuggesting(true);
    try {
      const s = await api.suggestAsaCampaign(siteId);
      // extraKeyword (Keywords sekmesinden tıklandı) varsa en başa eklensin, duplicate'i sil
      const finalKeywords = extraKeyword
        ? [extraKeyword, ...s.keywords.filter((k) => k.toLowerCase() !== extraKeyword.toLowerCase())]
        : s.keywords;
      setName(extraKeyword ? `${s.meta.appName} — "${extraKeyword}" odaklı / ${new Date().toLocaleDateString('tr-TR', { month: 'short', year: 'numeric' })}` : s.name);
      setDailyBudgetUsd(s.dailyBudgetUsd);
      setCountries(s.countries.join(','));
      setAppleAppId(String(s.appleAppId));
      setBidUsd(s.bidUsd);
      setKeywordsText(finalKeywords.join('\n'));
      setSuggestionMeta({ ...s.meta, keywordCount: finalKeywords.length });
      toast.success(`✨ AI ${finalKeywords.length} keyword önerdi — formu kontrol et ve oluştur`);
    } catch (err: any) {
      toast.error(err.message || 'AI öneri başarısız');
    } finally {
      setSuggesting(false);
    }
  };

  // initialKeyword (Keywords sekmesinden geldi) varsa otomatik AI doldur + o keyword'ü ekle
  useEffect(() => {
    if (initialKeyword) aiFill(initialKeyword);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (!name.trim() || !appleAppId.trim()) {
      toast.error('Kampanya adı + Apple App ID şart');
      return;
    }
    const adamId = parseInt(appleAppId, 10);
    if (isNaN(adamId)) {
      toast.error('Apple App ID sayı olmalı (App Store URL\'inde id sonrası — örn. 1234567890)');
      return;
    }
    const kwList = keywordsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((text) => ({ text, bidUsd, matchType: 'EXACT' as const }));

    setSubmitting(true);
    try {
      await api.createAsaCampaign({
        accountId,
        name: name.trim(),
        dailyBudgetUsd,
        countries: countries.split(',').map((c) => c.trim().toUpperCase()).filter(Boolean),
        appleAppId: adamId,
        keywords: kwList.length > 0 ? kwList : undefined,
      });
      toast.success(`✅ Kampanya oluşturuldu (${kwList.length} keyword)`);
      onSuccess();
    } catch (err: any) {
      toast.error(`Hata: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-card border rounded-2xl shadow-2xl max-w-xl w-full max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-bold">Yeni Kampanya</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Apple Search Ads'te yeni kampanya — keyword'ler EXACT match, bid ortak.
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          {/* AI ile Doldur butonu */}
          <div className="rounded-xl border-2 border-brand/30 bg-gradient-to-br from-brand/5 to-brand/10 p-3">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-full bg-gradient-to-br from-brand-500 to-brand-600 text-white grid place-items-center shrink-0">
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">AI ile Doldur</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  ASO Keywords sekmesindeki düşük ranking + yüksek trafik keyword'leri otomatik seç, bid + bütçe öner.
                </p>
                {suggestionMeta && (
                  <p className="text-[10px] text-emerald-700 dark:text-emerald-400 mt-1">
                    ✓ {suggestionMeta.appName} · {suggestionMeta.country} · {suggestionMeta.keywordCount} keyword
                  </p>
                )}
              </div>
              <Button
                size="sm"
                onClick={() => aiFill()}
                disabled={suggesting}
                className="shrink-0"
              >
                {suggesting ? (
                  <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Üretiliyor</>
                ) : (
                  <><Sparkles className="h-3.5 w-3.5 mr-1" /> AI ile Doldur</>
                )}
              </Button>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold mb-1 block">Kampanya adı *</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Örn: KobiPratik — KOBİ Kredisi Q1 2026" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold mb-1 block">Günlük bütçe (USD) *</label>
              <Input
                type="number"
                min={1}
                step={1}
                value={dailyBudgetUsd}
                onChange={(e) => setDailyBudgetUsd(parseFloat(e.target.value) || 0)}
              />
            </div>
            <div>
              <label className="text-xs font-semibold mb-1 block">Ülkeler (virgülle)</label>
              <Input value={countries} onChange={(e) => setCountries(e.target.value)} placeholder="TR,US,DE" />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold mb-1 block">Apple App ID (adamId) *</label>
            <Input
              value={appleAppId}
              onChange={(e) => setAppleAppId(e.target.value)}
              placeholder="örn. 1234567890"
              className="font-mono"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              App Store URL'inde <code>/id1234567890</code> kısmındaki sayı. Bu app, bağladığın hesabın developer'ında olmalı.
            </p>
          </div>

          <div>
            <label className="text-xs font-semibold mb-1 block">Keyword başına bid (USD)</label>
            <Input
              type="number"
              min={0.01}
              step={0.05}
              value={bidUsd}
              onChange={(e) => setBidUsd(parseFloat(e.target.value) || 0)}
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Apple kısıt: min $0.01, önerilen $0.30-$2.00. Tüm keyword'lere aynı bid uygulanır.
            </p>
          </div>

          <div>
            <label className="text-xs font-semibold mb-1 block">Keyword'ler (her satıra bir tane)</label>
            <textarea
              value={keywordsText}
              onChange={(e) => setKeywordsText(e.target.value)}
              placeholder={'kobi kredisi\nesnaf finansmanı\nişletme kredisi\nticari pos'}
              rows={6}
              className="w-full text-sm px-3 py-2 rounded-md border bg-background resize-y"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              {keywordsText.split('\n').filter((s) => s.trim()).length} keyword · EXACT match
            </p>
          </div>
        </div>

        <div className="border-t px-6 py-4 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>İptal</Button>
          <Button
            onClick={submit}
            disabled={submitting}
            className="bg-gradient-to-br from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 text-white"
          >
            {submitting ? (
              <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Oluşturuluyor…</>
            ) : (
              <><Plus className="h-4 w-4 mr-1.5" /> Kampanya oluştur</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────

function MetricCard({
  icon: Icon, label, value, subtext, color,
}: {
  icon: any;
  label: string;
  value: string;
  subtext?: string;
  color: 'blue' | 'violet' | 'emerald' | 'orange';
}) {
  const colorClass = {
    blue:    'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    violet:  'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    orange:  'bg-brand-500/10 text-brand-600 dark:text-brand-400',
  }[color];
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-1.5">
          <div className={`h-7 w-7 rounded-lg grid place-items-center ${colorClass}`}>
            <Icon className="h-4 w-4" />
          </div>
          <span className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">{label}</span>
        </div>
        <div className="text-xl font-bold">{value}</div>
        {subtext && <div className="text-[10px] text-muted-foreground mt-0.5">{subtext}</div>}
      </CardContent>
    </Card>
  );
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString('tr-TR');
}
