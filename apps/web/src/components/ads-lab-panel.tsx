'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Megaphone, Settings, Play, Pause, Plus, Sparkles, Wallet, Target, Image as ImageIcon, AlertCircle, Check, Activity, Zap } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

/**
 * Ads Lab — Faz 11. Google + Meta + GA4 MCP entegrasyonu.
 * 4 sekme: Yeni Kampanya / Aktifler / Performans / MCP Ayarları
 */
export function AdsLabPanel({ site }: { site: any }) {
  const [tab, setTab] = useState<'builder' | 'active' | 'performance' | 'autopilot' | 'settings'>('builder');

  return (
    <div className="rounded-lg border border-orange-500/30 bg-gradient-to-br from-orange-500/5 to-transparent p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold inline-flex items-center gap-2">
          <Megaphone className="h-4 w-4 text-orange-500" /> Ads Lab — Google + Meta + GA4
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          AI ile reklam hedefle, metin üret, görsel hazırla, bütçe ayarla, yayınla. <strong>Ryze AI MCP</strong> ile tek panelden 250+ tool.
        </p>
      </div>

      <div className="inline-flex border rounded-md overflow-hidden flex-wrap">
        {([
          ['builder', 'Yeni Kampanya', <Plus key="b" className="h-3 w-3" />],
          ['active', 'Aktifler', <Play key="a" className="h-3 w-3" />],
          ['performance', 'Performans', <Target key="p" className="h-3 w-3" />],
          ['autopilot', 'Otopilot Geçmişi', <Zap key="ap" className="h-3 w-3" />],
          ['settings', 'MCP Ayarları', <Settings key="s" className="h-3 w-3" />],
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
      {tab === 'settings' && <SettingsTab site={site} />}
    </div>
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
          <li>1. <strong>Performans Sync</strong> — gerçek metrikler MCP'den DB'ye akar</li>
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
        <span><strong>Hazır olunca otomatik yayına al</strong> (MCP yapılandırılmış olmalı). Kapalı bırakırsan DRAFT'ta kalır, sen "Yayınla" tıklarsın.</span>
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
            <div><p className="text-muted-foreground">İmpr</p><p className="font-mono font-bold">{c.impressions}</p></div>
            <div><p className="text-muted-foreground">Tıkl</p><p className="font-mono font-bold">{c.clicks}</p></div>
            <div><p className="text-muted-foreground">CTR</p><p className="font-mono font-bold">{(c.ctr * 100).toFixed(1)}%</p></div>
            <div><p className="text-muted-foreground">ROAS</p><p className={`font-mono font-bold ${c.roas >= 2 ? 'text-green-500' : c.roas > 0 ? 'text-yellow-500' : ''}`}>{c.roas.toFixed(1)}x</p></div>
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
        Performans verileri her 6 saatte bir Ryze AI MCP üzerinden senkronize edilir. Detaylı GA4 cross-validation otopilot ile.
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// MCP Ayarları
// ──────────────────────────────────────────────────────────────────
function SettingsTab({ site }: { site: any }) {
  const [endpoint, setEndpoint] = useState(site.adsMcpEndpoint ?? '');
  const [token, setToken] = useState(site.adsMcpToken ?? '');
  const [autopilot, setAutopilot] = useState(site.adsAutopilot ?? false);
  const [saving, setSaving] = useState(false);
  const [pinging, setPinging] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateAdsSettings(site.id, { adsMcpEndpoint: endpoint, adsMcpToken: token, adsAutopilot: autopilot });
      toast.success('Ayarlar kaydedildi');
    } catch (err: any) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const ping = async () => {
    setPinging(true);
    try {
      const r = await api.pingMcp(site.id);
      if (r.ok) toast.success('MCP endpoint çalışıyor ✓');
      else toast.error(r.error ?? 'Bağlantı hatası');
    } catch (err: any) { toast.error(err.message); }
    finally { setPinging(false); }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border bg-muted/20 p-3 text-xs">
        <p className="font-semibold mb-1">Ryze AI MCP Setup</p>
        <ol className="space-y-1 text-muted-foreground list-decimal pl-4">
          <li><a href="https://www.get-ryze.ai/" target="_blank" rel="noopener" className="text-brand hover:underline">get-ryze.ai</a>'de hesap aç</li>
          <li>Google Ads + Meta Ads + GA4 hesaplarını OAuth ile bağla</li>
          <li>Verilen MCP endpoint URL + Bearer token'ı buraya yapıştır</li>
        </ol>
      </div>

      <label className="block">
        <span className="text-xs font-medium">MCP Endpoint URL</span>
        <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background font-mono" placeholder="https://mcp.get-ryze.ai/..." />
      </label>

      <label className="block">
        <span className="text-xs font-medium">Bearer Token</span>
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background font-mono" placeholder="ryze_..." />
      </label>

      <label className="flex items-center gap-2 text-xs cursor-pointer p-3 rounded-md border bg-orange-500/5">
        <input type="checkbox" checked={autopilot} onChange={(e) => setAutopilot(e.target.checked)} />
        <span><strong>Ads Otopilot</strong> — Her 6 saatte bir aktif kampanyaları analiz eder. ROAS &lt; 1.5 → pause, ROAS &gt; 5 + CTR &gt; 3% → bütçe %20 artır.</span>
      </label>

      <div className="flex items-center gap-2">
        <Button onClick={save} disabled={saving}>{saving ? 'Kaydediliyor…' : 'Kaydet'}</Button>
        <Button variant="outline" onClick={ping} disabled={pinging || !endpoint}>{pinging ? 'Test ediliyor…' : 'MCP Test'}</Button>
      </div>
    </div>
  );
}
