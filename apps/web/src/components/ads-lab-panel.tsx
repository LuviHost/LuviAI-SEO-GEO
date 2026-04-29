'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Megaphone, Play, Pause, Plus, Target, Activity, Zap, Link2, Check, X, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { InfoTooltip } from '@/components/info-tooltip';

/**
 * Ads Lab — Faz 11.2. Google Ads + Meta Marketing API (direkt entegrasyon).
 * 4 sekme: Yeni Kampanya / Aktifler / Performans / Otopilot Geçmişi
 *
 * Reklam Hesapları (Google + Meta OAuth bağlama) artık burada DEĞIL —
 * Ayarlar > Entegrasyonlar altına taşındı (Faz 11.6 UX birleşik hub).
 */
export function AdsLabPanel({ site }: { site: any }) {
  const [tab, setTab] = useState<'builder' | 'active' | 'performance' | 'autopilot'>('builder');
  const [conn, setConn] = useState<{ google: boolean; meta: boolean } | null>(null);

  useEffect(() => {
    api.getAdsConnections(site.id).then(setConn).catch(() => setConn({ google: false, meta: false }));
  }, [site.id]);

  const noAccounts = conn !== null && !conn.google && !conn.meta;

  return (
    <div className="rounded-lg border border-orange-500/30 bg-gradient-to-br from-orange-500/5 to-transparent p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold inline-flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-orange-500" /> Ads Lab — Google Ads + Meta Ads
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          AI ile reklam hedefle, metin üret, görsel hazırla, bütçe ayarla, yayınla. Resmi Google Ads + Meta Marketing API'leri ile direkt entegrasyon — 3. parti SaaS yok.
        </p>
      </div>

      {noAccounts && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 flex items-start gap-3">
          <Link2 className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="flex-1 text-xs">
            <p className="font-semibold text-amber-700 dark:text-amber-400">Önce reklam hesabı bağla</p>
            <p className="text-muted-foreground mt-0.5">
              Kampanya kurmak için en az bir Google Ads veya Meta Ads hesabına ihtiyacın var.
            </p>
            <a
              href={`/sites/${site.id}?tab=settings#ads-accounts`}
              className="mt-2 inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-semibold hover:underline"
            >
              Ayarlar → Reklam Hesapları'na git →
            </a>
          </div>
        </div>
      )}

      <div className="inline-flex border rounded-md overflow-hidden flex-wrap">
        {([
          ['builder', 'Yeni Kampanya', <Plus key="b" className="h-3 w-3" />],
          ['active', 'Aktifler', <Play key="a" className="h-3 w-3" />],
          ['performance', 'Performans', <Target key="p" className="h-3 w-3" />],
          ['autopilot', 'Otopilot Geçmişi', <Zap key="ap" className="h-3 w-3" />],
        ] as const).map(([id, label, icon]) => (
          <button
            key={id}
            onClick={() => setTab(id as any)}
            className={`px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1 ${tab === id ? 'bg-orange-500 text-white' : 'bg-card text-muted-foreground hover:bg-muted'}`}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {tab === 'builder' && <BuilderTab site={site} />}
      {tab === 'active' && <ActiveTab siteId={site.id} />}
      {tab === 'performance' && <PerformanceTab siteId={site.id} />}
      {tab === 'autopilot' && <AutopilotHistoryTab siteId={site.id} />}

      {!noAccounts && conn && (
        <AutopilotToggle site={site} disabled={!conn.google && !conn.meta} />
      )}
    </div>
  );
}

function AutopilotToggle({ site, disabled }: { site: any; disabled: boolean }) {
  const [autopilot, setAutopilot] = useState(!!site.adsAutopilot);
  const [saving, setSaving] = useState(false);

  const save = async (next: boolean) => {
    setSaving(true);
    setAutopilot(next);
    try {
      await api.updateAdsSettings(site.id, { adsAutopilot: next });
      toast.success(`Ads Otopilot ${next ? 'açıldı' : 'kapatıldı'}`);
    } catch (err: any) { toast.error(err.message); setAutopilot(!next); }
    finally { setSaving(false); }
  };

  return (
    <label className="flex items-center gap-2 text-xs cursor-pointer p-3 rounded-md border bg-orange-500/5">
      <input
        type="checkbox"
        checked={autopilot}
        disabled={disabled || saving}
        onChange={(e) => save(e.target.checked)}
      />
      <span>
        <strong>Ads Otopilot</strong> — Her 6 saatte bir aktif kampanyaları analiz eder.
        ROAS &lt; 1.5 → pause, ROAS &gt; 5 + CTR &gt; 3% → bütçe %20 artır.
      </span>
    </label>
  );
}

// ──────────────────────────────────────────────────────────────────
// Otopilot Geçmişi (Faz 11.1) — autopilotActions JSON akışı
// ──────────────────────────────────────────────────────────────────
function AutopilotHistoryTab({ siteId }: { siteId: string }) {
  const [campaigns, setCampaigns] = useState<any[]>([]);

  useEffect(() => { api.listAdCampaigns(siteId).then(setCampaigns).catch(() => {}); }, [siteId]);

  const allActions = campaigns.flatMap((c) =>
    (Array.isArray(c.autopilotActions) ? c.autopilotActions : []).map((a: any) => ({
      ...a,
      campaignName: c.name,
      campaignId: c.id,
      platform: c.platform,
    }))
  ).sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  const ICONS: Record<string, string> = {
    'pause-low-roas': '⏸',
    'budget-up-20%': '🚀',
    'ab-test-winner': '🏆',
    'add-negative-keywords': '🚫',
  };

  const COLORS: Record<string, string> = {
    'pause-low-roas': 'border-red-500/30 bg-red-500/5',
    'budget-up-20%': 'border-green-500/30 bg-green-500/5',
    'ab-test-winner': 'border-blue-500/30 bg-blue-500/5',
    'add-negative-keywords': 'border-yellow-500/30 bg-yellow-500/5',
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-muted/20 p-3 text-xs">
        <p className="font-semibold mb-1">🤖 Otopilot her 6 saatte bir 6 kontrol çalıştırır:</p>
        <ul className="space-y-0.5 text-muted-foreground">
          <li>1. <strong>Performans Sync</strong> — gerçek metrikler resmi API'den DB'ye akar</li>
          <li>2. <strong>ROAS Pause</strong> — ROAS &lt; 1.5 + 100 TL+ harcama → otomatik pause</li>
          <li>3. <strong>Budget Up</strong> — CTR &gt; 3% + ROAS &gt; 5 → bütçe %20 artır</li>
          <li>4. <strong>A/B Winner</strong> — 7+ gün eski varyantların kazananını seç</li>
          <li>5. <strong>Negative Keywords</strong> — search terms'den alakasız kelimeleri sil</li>
          <li>6. <strong>Budget Shift</strong> — Google ↔ Meta arasında ROAS'a göre kaydır</li>
          <li>7. <strong>Auto-Boost</strong> — viral organik post'u Meta'da $50 ile boost</li>
          <li>8. <strong>GA4 Cross-Validate</strong> — fraud/sahte tıklama tespit</li>
        </ul>
      </div>

      {allActions.length === 0 ? (
        <p className="text-sm text-muted-foreground p-6 text-center">Henüz otopilot aksiyonu yok. Otopilot aktif olunca buraya 6 saatte bir karar geçmişi gelecek.</p>
      ) : (
        <div className="space-y-2">
          {allActions.slice(0, 30).map((a, i) => {
            const action = a.action ?? a.actions?.[0] ?? 'unknown';
            return (
              <div key={i} className={`rounded-md border p-2.5 ${COLORS[action] ?? ''}`}>
                <div className="flex items-start gap-2">
                  <span className="text-lg shrink-0">{ICONS[action] ?? '•'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{a.campaignName}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {action} · {new Date(a.time).toLocaleString('tr-TR')}
                    </p>
                    {a.reason && <p className="text-[11px] mt-1 italic">"{a.reason}"</p>}
                    {a.winnerCtr && (
                      <p className="text-[11px] mt-1">Winner CTR: {(a.winnerCtr * 100).toFixed(2)}% · {a.pausedCount} loser pause</p>
                    )}
                    {a.keywords && (
                      <p className="text-[11px] mt-1">{a.keywords.length} negatif: {a.keywords.slice(0, 5).join(', ')}…</p>
                    )}
                    {a.ctr !== undefined && a.roas !== undefined && (
                      <p className="text-[11px] mt-1 font-mono">CTR: {(a.ctr * 100).toFixed(2)}% · ROAS: {a.roas.toFixed(2)}x</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Yeni Kampanya — Wizard
// ──────────────────────────────────────────────────────────────────
function BuilderTab({ site }: { site: any }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    platform: 'both' as 'google_ads' | 'meta_ads' | 'both',
    objective: 'leads' as 'traffic' | 'leads' | 'conversions' | 'brand_awareness' | 'sales',
    productOrService: '',
    keyBenefit: '',
    landingUrl: site.url ?? '',
    budgetType: 'daily' as 'daily' | 'lifetime',
    budgetAmount: 100,
    autoLaunch: false,
  });
  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState<any>(null);

  const build = async () => {
    if (!form.productOrService) { toast.error('Ürün/hizmet bilgisi gerekli'); return; }
    if (!form.landingUrl.startsWith('http')) { toast.error('Landing URL geçersiz'); return; }
    setBuilding(true);
    try {
      const res = await api.buildCampaign(site.id, form);
      setResult(res);
      toast.success(`Kampanya hazır: ${res.campaigns.length} platform · $${res.estimatedCostUsd.toFixed(2)} maliyet`);
    } catch (err: any) { toast.error(err.message); }
    finally { setBuilding(false); }
  };

  if (result) {
    return (
      <div className="space-y-3">
        <div className="rounded-md border border-green-500/30 bg-green-500/5 p-3">
          <p className="text-sm font-semibold text-green-700 dark:text-green-400">
            ✓ {result.campaigns.length} kampanya DRAFT olarak hazırlandı
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            AI maliyeti: ${result.estimatedCostUsd.toFixed(2)} · Görsel: {result.images?.length ?? 0} · Hedef kitle: {Object.keys(result.audience ?? {}).length}
          </p>
        </div>

        {/* Audience preview */}
        {result.audience && (
          <details className="rounded-md border">
            <summary className="px-3 py-2 cursor-pointer text-xs font-semibold bg-muted/30">
              📍 Hedef Kitle Önerileri
            </summary>
            <div className="p-3 text-xs space-y-2">
              {result.audience.google && (
                <div>
                  <p className="font-semibold mb-1">Google Anahtar Kelimeler:</p>
                  <div className="flex flex-wrap gap-1">
                    {(result.audience.google.keywords ?? []).slice(0, 12).map((k: any, i: number) => (
                      <Badge key={i} variant="outline" className="text-[10px]">{k.text}</Badge>
                    ))}
                  </div>
                </div>
              )}
              {result.audience.meta && (
                <div>
                  <p className="font-semibold mb-1 mt-2">Meta Interest'ler:</p>
                  <div className="flex flex-wrap gap-1">
                    {(result.audience.meta.interests ?? []).slice(0, 10).map((i: any, idx: number) => (
                      <Badge key={idx} variant="outline" className="text-[10px]">{i.name}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </details>
        )}

        {/* Ad copy preview */}
        {result.adCopy && (
          <details className="rounded-md border" open>
            <summary className="px-3 py-2 cursor-pointer text-xs font-semibold bg-muted/30">
              ✍️ Reklam Metinleri
            </summary>
            <div className="p-3 text-xs space-y-3">
              <div>
                <p className="font-semibold mb-1">Google Headlines (15 adet):</p>
                <div className="grid grid-cols-2 gap-1">
                  {(result.adCopy.google?.headlines ?? []).slice(0, 6).map((h: any, i: number) => (
                    <div key={i} className="border rounded px-2 py-1 truncate">"{h.text}" <span className="text-muted-foreground">({h.length})</span></div>
                  ))}
                </div>
              </div>
              <div>
                <p className="font-semibold mb-1">Meta Primary Text (5):</p>
                {(result.adCopy.meta?.primaryTexts ?? []).slice(0, 3).map((t: string, i: number) => (
                  <p key={i} className="border rounded px-2 py-1 mb-1">{t}</p>
                ))}
              </div>
            </div>
          </details>
        )}

        {/* Image preview */}
        {result.images?.length > 0 && (
          <details className="rounded-md border" open>
            <summary className="px-3 py-2 cursor-pointer text-xs font-semibold bg-muted/30">
              🖼️ Reklam Görselleri ({result.images.length} format)
            </summary>
            <div className="p-3 grid grid-cols-3 gap-2">
              {result.images.map((img: any, i: number) => (
                <div key={i} className="border rounded overflow-hidden">
                  <img src={img.publicUrl} alt={img.format} className="w-full h-auto" />
                  <p className="text-[10px] text-center py-1 bg-muted/30">{img.format}</p>
                </div>
              ))}
            </div>
          </details>
        )}

        <div className="flex items-center gap-2">
          <Button onClick={() => { setResult(null); setStep(1); }}>Yeni Kampanya</Button>
          <Button variant="outline" onClick={() => window.location.reload()}>Aktiflere Git</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">3 dakikada AI tüm kampanyayı hazırlar — hedef kitle + reklam metni + görsel + bütçe.</p>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs font-medium">Platform</span>
          <select value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value as any })} className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background">
            <option value="both">Google + Meta</option>
            <option value="google_ads">Sadece Google</option>
            <option value="meta_ads">Sadece Meta</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium">Hedef</span>
          <select value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value as any })} className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background">
            <option value="traffic">Trafik</option>
            <option value="leads">Lead toplama</option>
            <option value="conversions">Dönüşüm</option>
            <option value="brand_awareness">Marka bilinirliği</option>
            <option value="sales">Satış</option>
          </select>
        </label>
      </div>

      <label className="block">
        <span className="text-xs font-medium">Ürün / Hizmet</span>
        <input value={form.productOrService} onChange={(e) => setForm({ ...form, productOrService: e.target.value })} className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background" placeholder="Örn: Shared hosting paketleri 49 TL'den" />
      </label>

      <label className="block">
        <span className="text-xs font-medium">Ana Fayda (opsiyonel)</span>
        <input value={form.keyBenefit} onChange={(e) => setForm({ ...form, keyBenefit: e.target.value })} className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background" placeholder="Örn: 7/24 Türkçe destek + ücretsiz SSL" />
      </label>

      <label className="block">
        <span className="text-xs font-medium">Landing URL</span>
        <input type="url" value={form.landingUrl} onChange={(e) => setForm({ ...form, landingUrl: e.target.value })} className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background" />
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs font-medium">Bütçe Tipi</span>
          <select value={form.budgetType} onChange={(e) => setForm({ ...form, budgetType: e.target.value as any })} className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background">
            <option value="daily">Günlük</option>
            <option value="lifetime">Toplam</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium">Bütçe (TL)</span>
          <input type="number" min={50} value={form.budgetAmount} onChange={(e) => setForm({ ...form, budgetAmount: parseFloat(e.target.value) || 0 })} className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background" />
        </label>
      </div>

      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input type="checkbox" checked={form.autoLaunch} onChange={(e) => setForm({ ...form, autoLaunch: e.target.checked })} />
        <span><strong>Hazır olunca otomatik yayına al</strong> (Reklam Hesabı bağlı olmalı). Kapalı bırakırsan DRAFT'ta kalır, sen "Yayınla" tıklarsın.</span>
      </label>

      <Button onClick={build} disabled={building} size="lg" className="w-full">
        {building ? 'Hazırlanıyor (~60s)…' : '🚀 Kampanyayı Hazırla'}
      </Button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Aktif Kampanyalar
// ──────────────────────────────────────────────────────────────────
function ActiveTab({ siteId }: { siteId: string }) {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.listAdCampaigns(siteId);
      setCampaigns(res);
    } catch (err: any) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [siteId]);

  const launch = async (id: string) => {
    try { const r = await api.launchCampaign(siteId, id); if (r.ok) toast.success('Yayına alındı'); else toast.error(r.error ?? 'Hata'); load(); }
    catch (err: any) { toast.error(err.message); }
  };

  const pause = async (id: string) => {
    try { await api.pauseCampaign(siteId, id); toast.success('Pause edildi'); load(); }
    catch (err: any) { toast.error(err.message); }
  };

  if (loading) return <div className="text-sm text-muted-foreground p-6 text-center">Yükleniyor…</div>;
  if (campaigns.length === 0) return <div className="text-sm text-muted-foreground p-6 text-center">Henüz kampanya yok. "Yeni Kampanya" sekmesinden oluştur.</div>;

  return (
    <div className="space-y-2">
      {campaigns.map((c) => (
        <div key={c.id} className="rounded-md border p-3">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div>
              <p className="font-semibold text-sm">{c.name}</p>
              <p className="text-[11px] text-muted-foreground">{c.platform} · {c.objective} · {c.budgetAmount} TL/{c.budgetType}</p>
            </div>
            <Badge variant={c.status === 'ACTIVE' ? 'default' : c.status === 'PAUSED' ? 'outline' : 'secondary'}>{c.status}</Badge>
          </div>
          <div className="grid grid-cols-4 gap-2 text-xs mb-2">
            <div>
              <p className="text-muted-foreground">
                <InfoTooltip term="Impression">İmpr</InfoTooltip>
              </p>
              <p className="font-mono font-bold">{c.impressions}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Tıkl</p>
              <p className="font-mono font-bold">{c.clicks}</p>
            </div>
            <div>
              <p className="text-muted-foreground">
                <InfoTooltip term="CTR">CTR</InfoTooltip>
              </p>
              <p className="font-mono font-bold">{(c.ctr * 100).toFixed(1)}%</p>
            </div>
            <div>
              <p className="text-muted-foreground">
                <InfoTooltip term="ROAS">ROAS</InfoTooltip>
              </p>
              <p className={`font-mono font-bold ${c.roas >= 2 ? 'text-green-500' : c.roas > 0 ? 'text-yellow-500' : ''}`}>{c.roas.toFixed(1)}x</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {c.status === 'DRAFT' && <Button size="sm" onClick={() => launch(c.id)}><Play className="h-3 w-3 mr-1" /> Yayına Al</Button>}
            {c.status === 'ACTIVE' && <Button size="sm" variant="outline" onClick={() => pause(c.id)}><Pause className="h-3 w-3 mr-1" /> Pause</Button>}
            {c.externalId && <span className="text-[10px] text-muted-foreground">ID: {c.externalId}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Performans
// ──────────────────────────────────────────────────────────────────
function PerformanceTab({ siteId }: { siteId: string }) {
  const [campaigns, setCampaigns] = useState<any[]>([]);

  useEffect(() => { api.listAdCampaigns(siteId).then(setCampaigns).catch(() => {}); }, [siteId]);

  const totalSpend = campaigns.reduce((a, c) => a + Number(c.spend ?? 0), 0);
  const totalConv = campaigns.reduce((a, c) => a + (c.conversions ?? 0), 0);
  const avgRoas = campaigns.length > 0 ? campaigns.reduce((a, c) => a + (c.roas ?? 0), 0) / campaigns.length : 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md border p-3 text-center">
          <p className="text-2xl font-bold">{totalSpend.toFixed(0)} ₺</p>
          <p className="text-[11px] text-muted-foreground">Toplam Harcama</p>
        </div>
        <div className="rounded-md border p-3 text-center">
          <p className="text-2xl font-bold">{totalConv}</p>
          <p className="text-[11px] text-muted-foreground">Dönüşüm</p>
        </div>
        <div className="rounded-md border p-3 text-center">
          <p className={`text-2xl font-bold ${avgRoas >= 2 ? 'text-green-500' : avgRoas > 0 ? 'text-yellow-500' : ''}`}>{avgRoas.toFixed(1)}x</p>
          <p className="text-[11px] text-muted-foreground">Ort. ROAS</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground italic">
        Performans verileri her 6 saatte bir resmi Google Ads API + Meta Marketing API üzerinden senkronize edilir. Otopilot ROAS-bazlı optimize eder.
      </p>
    </div>
  );
}


// ──────────────────────────────────────────────────────────────────
//  OAuth popup-based connection cards (Faz 11.5)
// ──────────────────────────────────────────────────────────────────

/**
 * OAuth popup'i acar, bitince postMessage bekler.
 * Provider: 'google-ads' | 'meta-ads'
 */
function useOAuthPopup(provider: 'google-ads' | 'meta-ads', siteId: string) {
  const [busy, setBusy] = useState(false);

  const start = async (onResult: (data: any) => void) => {
    setBusy(true);
    try {
      const { url } = await api.getOAuthStartUrl(provider, siteId);
      const w = 600, h = 700;
      const left = window.screenX + (window.outerWidth - w) / 2;
      const top = window.screenY + (window.outerHeight - h) / 2;
      const popup = window.open(url, 'oauth-popup', `width=${w},height=${h},left=${left},top=${top},toolbar=no,location=no,status=no,menubar=no,scrollbars=yes`);
      if (!popup) throw new Error('Popup engellendi — tarayıcı izni ver');

      let resolved = false;
      const handler = (e: MessageEvent) => {
        if (e.origin !== window.location.origin) return;
        const msg = e.data;
        if (!msg || (msg.type !== 'oauth-success' && msg.type !== 'oauth-error')) return;
        if (msg.provider !== provider) return;
        resolved = true;
        window.removeEventListener('message', handler);
        if (msg.type === 'oauth-error') {
          toast.error(msg.message ?? 'Bağlantı hatası');
        } else {
          onResult(msg.data ?? {});
        }
        setBusy(false);
      };
      window.addEventListener('message', handler);

      // Popup kapanmasi watchdog
      const timer = setInterval(() => {
        if (popup.closed) {
          clearInterval(timer);
          if (!resolved) {
            window.removeEventListener('message', handler);
            setBusy(false);
          }
        }
      }, 500);
    } catch (err: any) {
      toast.error(err.message);
      setBusy(false);
    }
  };

  return { busy, start };
}

export function GoogleAdsOAuthCard({ site, connected, onChanged }: { site: any; connected: boolean; onChanged: () => void }) {
  const oauth = useOAuthPopup('google-ads', site.id);
  const [picker, setPicker] = useState<{ id: string; resourceName: string; descriptiveName?: string; currencyCode?: string; isManager?: boolean }[] | null>(null);
  const [savingPick, setSavingPick] = useState(false);

  const connect = () => {
    oauth.start(async (data) => {
      onChanged();
      if (data.autoSelected) {
        toast.success('Google Ads bağlandı ✓');
      } else if (data.customers?.length > 1) {
        setPicker(data.customers);
        toast.message('Birden fazla hesap bulundu — birini seç');
      } else if (!data.customers?.length) {
        toast.warning('Google Ads hesabı bulunamadı — bu Google hesabında reklam hesabı yok mu?');
      }
    });
  };

  const disconnect = async () => {
    if (!confirm('Google Ads bağlantısı kaldırılacak. Emin misin?')) return;
    try {
      await api.connectGoogleAds(site.id, { customerId: undefined, refreshToken: undefined });
      toast.success('Bağlantı kaldırıldı');
      onChanged();
    } catch (err: any) { toast.error(err.message); }
  };

  const pick = async (customerId: string) => {
    setSavingPick(true);
    try {
      await api.selectOAuthAccount('google-ads', site.id, { customerId });
      toast.success('Hesap seçildi ✓');
      setPicker(null);
      onChanged();
    } catch (err: any) { toast.error(err.message); }
    finally { setSavingPick(false); }
  };

  const showPicker = async () => {
    try {
      const r = await api.getOAuthOptions('google-ads', site.id);
      setPicker(r.customers ?? []);
    } catch (err: any) { toast.error(err.message); }
  };

  return (
    <div className={`rounded-md border p-3 ${connected ? 'border-green-500/40 bg-green-500/5' : 'bg-muted/10'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`h-7 w-7 rounded-full grid place-items-center ${connected ? 'bg-green-500/20' : 'bg-muted'}`}>
            {connected ? <Check className="h-4 w-4 text-green-600" /> : <X className="h-4 w-4 text-muted-foreground" />}
          </span>
          <div>
            <p className="text-sm font-semibold flex items-center gap-2">
              <GoogleIcon /> Google Ads
            </p>
            <p className="text-[11px] text-muted-foreground">
              {connected
                ? <>Bağlı{site.googleAdsCustomerId && <> · <span className="font-mono">{site.googleAdsCustomerId}</span></>} · {site.googleAdsConnectedAt && new Date(site.googleAdsConnectedAt).toLocaleDateString('tr-TR')}</>
                : 'Tek tık bağlan — Google izin ekranı'}
            </p>
          </div>
        </div>
        {connected ? (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={showPicker}>Hesap Değiştir</Button>
            <Button size="sm" variant="outline" onClick={disconnect}>Kaldır</Button>
          </div>
        ) : (
          <Button size="sm" onClick={connect} disabled={oauth.busy} className="gap-1.5">
            {oauth.busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <GoogleIcon />}
            {oauth.busy ? 'Açılıyor…' : 'Google ile Bağla'}
          </Button>
        )}
      </div>

      {picker && (
        <div className="mt-3 pt-3 border-t space-y-2">
          <p className="text-xs font-medium">Hangi Google Ads hesabı?</p>
          {picker.length === 0 ? (
            <p className="text-xs text-muted-foreground">Bu Google hesabıyla erişilebilir Google Ads hesabı yok.</p>
          ) : (
            picker.map((c) => (
              <button
                key={c.id}
                onClick={() => pick(c.id)}
                disabled={savingPick}
                className={`w-full flex items-start justify-between gap-2 px-3 py-2 rounded border text-xs hover:border-brand/40 hover:bg-brand/5 transition-colors ${site.googleAdsCustomerId === c.id ? 'border-green-500/40 bg-green-500/5' : ''}`}
              >
                <div className="flex flex-col items-start gap-0.5 min-w-0">
                  <span className="font-medium truncate">{c.descriptiveName || (c.isManager ? 'Manager hesabı' : 'İsimsiz hesap')}</span>
                  <span className="text-muted-foreground font-mono text-[10px]">{c.id.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3')}{c.currencyCode ? ` · ${c.currencyCode}` : ''}{c.isManager ? ' · Manager' : ''}</span>
                </div>
                {site.googleAdsCustomerId === c.id && <Check className="h-3 w-3 text-green-600 mt-0.5 shrink-0" />}
              </button>
            ))
          )}
          <Button size="sm" variant="ghost" onClick={() => setPicker(null)} className="w-full">İptal</Button>
        </div>
      )}
    </div>
  );
}

export function MetaAdsOAuthCard({ site, connected, onChanged }: { site: any; connected: boolean; onChanged: () => void }) {
  const oauth = useOAuthPopup('meta-ads', site.id);
  const [opts, setOpts] = useState<{ adAccounts: any[]; pages: any[] } | null>(null);
  const [showOpts, setShowOpts] = useState(false);

  const connect = () => {
    oauth.start(async (data) => {
      onChanged();
      if (data.autoSelected) {
        toast.success('Meta Ads bağlandı ✓');
      } else {
        // birden fazla varsa picker'i hemen ac
        setOpts({ adAccounts: data.adAccounts ?? [], pages: data.pages ?? [] });
        setShowOpts(true);
      }
    });
  };

  const disconnect = async () => {
    if (!confirm('Meta Ads bağlantısı kaldırılacak. Emin misin?')) return;
    try {
      await api.connectMetaAds(site.id, { accountId: undefined, accessToken: undefined, pageId: undefined, instagramActorId: undefined });
      toast.success('Bağlantı kaldırıldı');
      onChanged();
    } catch (err: any) { toast.error(err.message); }
  };

  const loadOpts = async () => {
    try {
      const r = await api.getOAuthOptions('meta-ads', site.id);
      setOpts({ adAccounts: r.adAccounts ?? [], pages: r.pages ?? [] });
      setShowOpts(true);
    } catch (err: any) { toast.error(err.message); }
  };

  const save = async (selection: { adAccountId?: string; pageId?: string; instagramActorId?: string }) => {
    try {
      await api.selectOAuthAccount('meta-ads', site.id, selection);
      toast.success('Seçim kaydedildi ✓');
      setShowOpts(false);
      onChanged();
    } catch (err: any) { toast.error(err.message); }
  };

  return (
    <div className={`rounded-md border p-3 ${connected ? 'border-green-500/40 bg-green-500/5' : 'bg-muted/10'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`h-7 w-7 rounded-full grid place-items-center ${connected ? 'bg-green-500/20' : 'bg-muted'}`}>
            {connected ? <Check className="h-4 w-4 text-green-600" /> : <X className="h-4 w-4 text-muted-foreground" />}
          </span>
          <div>
            <p className="text-sm font-semibold flex items-center gap-2">
              <MetaIcon /> Meta Ads (Facebook + Instagram)
            </p>
            <p className="text-[11px] text-muted-foreground">
              {connected
                ? <>Bağlı{site.metaAdsAccountId && <> · <span className="font-mono">{site.metaAdsAccountId}</span></>}{site.metaPageId && <> · Page {site.metaPageId}</>}</>
                : 'Tek tık bağlan — Facebook izin ekranı'}
            </p>
          </div>
        </div>
        {connected ? (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={loadOpts}>Hesap/Sayfa Değiştir</Button>
            <Button size="sm" variant="outline" onClick={disconnect}>Kaldır</Button>
          </div>
        ) : (
          <Button size="sm" onClick={connect} disabled={oauth.busy} className="gap-1.5">
            {oauth.busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <MetaIcon />}
            {oauth.busy ? 'Açılıyor…' : 'Facebook ile Bağla'}
          </Button>
        )}
      </div>

      {showOpts && opts && (
        <MetaPicker
          opts={opts}
          current={{ adAccountId: site.metaAdsAccountId, pageId: site.metaPageId, instagramActorId: site.metaInstagramActorId }}
          onCancel={() => setShowOpts(false)}
          onSave={save}
        />
      )}
    </div>
  );
}

function MetaPicker({ opts, current, onCancel, onSave }: {
  opts: { adAccounts: any[]; pages: any[] };
  current: { adAccountId?: string; pageId?: string; instagramActorId?: string };
  onCancel: () => void;
  onSave: (s: { adAccountId?: string; pageId?: string; instagramActorId?: string }) => Promise<void>;
}) {
  const [adAccountId, setAdAccountId] = useState(current.adAccountId ?? '');
  const [pageId, setPageId] = useState(current.pageId ?? '');
  const [saving, setSaving] = useState(false);

  const selectedPage = opts.pages.find((p) => p.id === pageId);
  const igId = selectedPage?.instagramId ?? '';

  const submit = async () => {
    if (!adAccountId) { toast.error('Reklam hesabı seç'); return; }
    if (!pageId) { toast.error('Facebook Page seç'); return; }
    setSaving(true);
    try {
      await onSave({ adAccountId, pageId, instagramActorId: igId || undefined });
    } finally { setSaving(false); }
  };

  return (
    <div className="mt-3 pt-3 border-t space-y-3">
      <div>
        <p className="text-xs font-medium mb-1.5">Reklam Hesabı (Ad Account)</p>
        {opts.adAccounts.length === 0 ? (
          <p className="text-[11px] text-muted-foreground p-2 border rounded">Aktif reklam hesabı bulunamadı.</p>
        ) : (
          <div className="space-y-1">
            {opts.adAccounts.map((a) => (
              <button
                key={a.id}
                onClick={() => setAdAccountId(a.id)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded border text-xs hover:border-brand/40 transition-colors ${adAccountId === a.id ? 'border-brand bg-brand/5' : ''}`}
              >
                <span className="truncate"><strong>{a.name}</strong> · <span className="font-mono text-muted-foreground">{a.id}</span></span>
                {adAccountId === a.id && <Check className="h-3 w-3 text-brand shrink-0" />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="text-xs font-medium mb-1.5">Facebook Page (zorunlu — kampanya + boost için)</p>
        {opts.pages.length === 0 ? (
          <p className="text-[11px] text-muted-foreground p-2 border rounded">Sayfa bulunamadı. Facebook'ta sayfa kur, sonra tekrar bağla.</p>
        ) : (
          <div className="space-y-1">
            {opts.pages.map((p) => (
              <button
                key={p.id}
                onClick={() => setPageId(p.id)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded border text-xs hover:border-brand/40 transition-colors ${pageId === p.id ? 'border-brand bg-brand/5' : ''}`}
              >
                <span className="truncate">
                  <strong>{p.name}</strong>
                  {p.instagramId && <span className="ml-1.5 text-[10px] inline-flex items-center gap-0.5 text-pink-500">📷 IG bağlı</span>}
                </span>
                {pageId === p.id && <Check className="h-3 w-3 text-brand shrink-0" />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={submit} disabled={saving} className="flex-1">
          {saving ? 'Kaydediliyor…' : 'Seçimi Kaydet'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>İptal</Button>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden>
      <path fill="#EA4335" d="M12 5c1.6 0 3 .55 4.13 1.62l3.07-3.07A11.92 11.92 0 0 0 12 0C7.31 0 3.26 2.69 1.28 6.6l3.58 2.78A7.02 7.02 0 0 1 12 5Z" />
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.68-.22-2.47H12v4.68h6.46a5.53 5.53 0 0 1-2.39 3.63l3.69 2.86c2.16-1.99 3.4-4.92 3.4-8.7Z" />
      <path fill="#FBBC05" d="M4.86 14.62a7.04 7.04 0 0 1 0-5.24L1.28 6.6a11.97 11.97 0 0 0 0 10.8l3.58-2.78Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.92l-3.69-2.86a7.16 7.16 0 0 1-10.4-3.6L1.28 17.4C3.26 21.31 7.31 24 12 24Z" />
    </svg>
  );
}

function MetaIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden>
      <circle cx="12" cy="12" r="12" fill="#1877F2" />
      <path fill="#fff" d="M14.7 12.5h-2.2v7H9.6v-7H8v-2.5h1.6V8.4c0-1.7 1-2.9 3.1-2.9.9 0 1.6.1 1.6.1v2.1h-1c-.9 0-1.2.5-1.2 1.1v1.7h2.4l-.4 2.5Z" />
    </svg>
  );
}

