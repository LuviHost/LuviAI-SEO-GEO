'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Sparkles, Network, Globe, Check, X, AlertCircle, Copy, ExternalLink, Play, MessageSquare, Link2, Download, Code, Activity, MapPin, Mail, User, BarChart3, Bot } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

/**
 * GEO Lab — gelismis GEO arac kutusu:
 *  1. Heatmap: sektor sorulari × AI provider matrix (yesil/kirmizi/sari/gri)
 *  2. Wikidata draft (Knowledge Graph icin)
 *  3. Wikipedia article draft
 */
export function GeoLabPanel({ siteId }: { siteId: string }) {
  const [tab, setTab] = useState<'heatmap' | 'wikidata' | 'wikipedia' | 'community' | 'cross-link' | 'training' | 'schema-validate' | 'tracker' | 'sitemap-ai' | 'haro' | 'programmatic' | 'ai-console' | 'chat-widget'>('heatmap');

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold inline-flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-brand" /> GEO Lab — Gelişmiş AI Görünürlük Araçları
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Heatmap · Wikidata · Wikipedia · Reddit · Cross-link · AI Training Data
        </p>
      </div>

      <div className="inline-flex border rounded-md overflow-hidden flex-wrap">
        {([
          ['heatmap', 'Heatmap', <Network key="h" className="h-3 w-3" />],
          ['wikidata', 'Wikidata', <Globe key="d" className="h-3 w-3" />],
          ['wikipedia', 'Wikipedia', <Globe key="w" className="h-3 w-3" />],
          ['community', 'Reddit', <MessageSquare key="r" className="h-3 w-3" />],
          ['cross-link', 'Cross-Link', <Link2 key="c" className="h-3 w-3" />],
          ['training', 'Training Data', <Download key="t" className="h-3 w-3" />],
          ['schema-validate', 'Schema Doğrula', <Code key="sv" className="h-3 w-3" />],
          ['tracker', 'Bot Tracker', <Activity key="tr" className="h-3 w-3" />],
          ['sitemap-ai', 'AI Sitemap', <Globe key="sa" className="h-3 w-3" />],
          ['haro', 'HARO', <Mail key="ha" className="h-3 w-3" />],
          ['programmatic', '81 İl', <MapPin key="pg" className="h-3 w-3" />],
          ['ai-console', 'AI Search Console', <BarChart3 key="ac" className="h-3 w-3" />],
          ['chat-widget', 'Chat Widget', <Bot key="cw" className="h-3 w-3" />],
        ] as const).map(([id, label, icon]) => (
          <button
            key={id}
            onClick={() => setTab(id as any)}
            className={`px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1 ${
              tab === id ? 'bg-brand text-white' : 'bg-card text-muted-foreground hover:bg-muted'
            }`}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {tab === 'heatmap' && <HeatmapTab siteId={siteId} />}
      {tab === 'wikidata' && <WikidataTab siteId={siteId} />}
      {tab === 'wikipedia' && <WikipediaTab siteId={siteId} />}
      {tab === 'community' && <CommunityTab siteId={siteId} />}
      {tab === 'cross-link' && <CrossLinkTab siteId={siteId} />}
      {tab === 'training' && <TrainingDataTab siteId={siteId} />}
      {tab === 'schema-validate' && <SchemaValidateTab siteId={siteId} />}
      {tab === 'tracker' && <TrackerEmbedTab siteId={siteId} />}
      {tab === 'sitemap-ai' && <AiSitemapTab siteId={siteId} />}
      {tab === 'haro' && <HaroTab siteId={siteId} />}
      {tab === 'programmatic' && <ProgrammaticTab siteId={siteId} />}
      {tab === 'ai-console' && <AiSearchConsoleTab siteId={siteId} />}
      {tab === 'chat-widget' && <ChatWidgetTab siteId={siteId} />}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// AI Search Console (ChatGPT/Perplexity'den gelen kullanici trafigi)
// ──────────────────────────────────────────────────────────────────
function AiSearchConsoleTab({ siteId }: { siteId: string }) {
  const [data, setData] = useState<any>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getAiReferrerHistory(siteId, days);
      setData(res);
    } catch (err: any) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [days, siteId]);

  if (loading || !data) return <div className="text-sm text-muted-foreground p-6 text-center">Yükleniyor…</div>;

  const sortedReferrers = Object.entries(data.byReferrer ?? {}).sort((a, b) => (b[1] as number) - (a[1] as number));

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Bu sayfa <strong>AI cevap kutucuklarından gelen kullanıcı trafiği</strong>nı gösterir. ChatGPT/Perplexity/Claude'da sitenizin URL'i alıntılandığında, kullanıcı linke tıkladıkça referer header'ı yakalanır. <strong>Bot trafiği değil — gerçek satın alma niyetli ziyaretçi.</strong>
      </p>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="inline-flex border rounded-md overflow-hidden">
          {[7, 30, 90].map((d) => (
            <button key={d} onClick={() => setDays(d)} className={`px-2.5 py-1 text-xs font-medium ${days === d ? 'bg-brand text-white' : 'bg-card text-muted-foreground hover:bg-muted'}`}>{d}g</button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">Toplam: <strong>{data.totalHits.toLocaleString('tr-TR')}</strong> tıklama</span>
      </div>

      {data.totalHits === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Henüz AI referrer trafiği yok. Tracker.js sitenize embed edildikten sonra (Bot Tracker sekmesi) kullanıcılar AI'dan tıklayınca buradan görürsün.
        </div>
      ) : (
        <div className="space-y-2">
          {sortedReferrers.map(([key, hits]) => {
            const reg = (data.registry ?? []).find((r: any) => r.key === key);
            const label = reg?.label ?? key;
            const pct = (data.totalHits > 0 ? (hits as number) / data.totalHits * 100 : 0);
            return (
              <div key={key} className="rounded-md border p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-semibold text-sm">{label}</span>
                  <span className="font-mono text-xs">{(hits as number).toLocaleString('tr-TR')} ({pct.toFixed(1)}%)</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
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
// Chat Widget (Persona)
// ──────────────────────────────────────────────────────────────────
function ChatWidgetTab({ siteId }: { siteId: string }) {
  const url = api.getWidgetEmbedUrl(siteId);
  const snippet = `<script async src="${url}"></script>`;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Sitenizin sağ alt köşesine <strong>AI chat widget</strong> ekler. Ziyaretçi soru sorar, AI marka tonunda cevap verir, ilgili makaleye link verir. Brand voice + persona ile <strong>satış asistanı</strong> gibi çalışır.
      </p>

      <div className="rounded-md border">
        <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between">
          <p className="text-xs font-semibold">Embed Script</p>
          <button onClick={() => { navigator.clipboard.writeText(snippet); toast.success('Kopyalandı'); }} className="text-xs text-brand hover:underline inline-flex items-center gap-1">
            <Copy className="h-3 w-3" /> Kopyala
          </button>
        </div>
        <pre className="p-3 text-[11px] font-mono whitespace-pre-wrap break-all">{snippet}</pre>
      </div>

      <div className="rounded-md border bg-muted/20 p-3">
        <p className="text-xs font-semibold mb-2">Özellikler</p>
        <ul className="space-y-1 text-xs text-muted-foreground">
          <li>✓ Otomatik FAB (sağ alt köşe, tıklanınca açılır)</li>
          <li>✓ Marka rengi + LuviAI gradient</li>
          <li>✓ AI brain context'i + son 30 makale ile cevap üretir</li>
          <li>✓ Cevap içinde ilgili makale linki otomatik</li>
          <li>✓ Mobil uyumlu, responsive</li>
        </ul>
      </div>

      <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3">
        <p className="text-xs">
          🎯 <strong>SEO ve GEO etkisi:</strong> Widget'ta sorulan sorular Google'a "kullanıcı niyeti" sinyali gönderir. Ayrıca cevap içindeki internal link'ler crawler'lar için bonus erişim noktası.
        </p>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// AI Sitemap
// ──────────────────────────────────────────────────────────────────
function AiSitemapTab({ siteId }: { siteId: string }) {
  const url = api.getAiSitemapUrl(siteId);
  const robotsLine = `Sitemap: ${url}`;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Standart <code className="bg-muted px-1 rounded">sitemap.xml</code>'in yanına <strong>AI-optimize sitemap</strong> ekler. Custom <code className="bg-muted px-1 rounded">ai:summary</code> namespace ile her URL için 200 kelimelik AI özet, <code className="bg-muted px-1 rounded">ai:topics</code> ile AEO sorguları, editor skoruna göre priority. AI search engines bu sitemap'i okuyup içeriği daha hızlı öğrenir.
      </p>

      <div className="rounded-md border">
        <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between">
          <p className="text-xs font-semibold">Sitemap URL</p>
          <button
            onClick={() => { navigator.clipboard.writeText(url); toast.success('Kopyalandı'); }}
            className="text-xs text-brand hover:underline inline-flex items-center gap-1"
          >
            <Copy className="h-3 w-3" /> Kopyala
          </button>
        </div>
        <pre className="p-3 text-[11px] font-mono whitespace-pre-wrap break-all">{url}</pre>
      </div>

      <div className="flex items-center gap-2">
        <a href={url} target="_blank" rel="noopener" className="text-xs text-brand hover:underline inline-flex items-center gap-1">
          Sitemap'i aç <ExternalLink className="h-3 w-3" />
        </a>
        <span className="text-xs text-muted-foreground">·</span>
        <a href={`https://search.google.com/search-console/sitemaps?siteUrl=`} target="_blank" rel="noopener" className="text-xs text-brand hover:underline inline-flex items-center gap-1">
          Google Search Console'a submit <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <div className="rounded-md border bg-muted/20 p-3">
        <p className="text-xs font-semibold mb-2">robots.txt'e ekleyin</p>
        <pre className="text-[11px] font-mono">{robotsLine}</pre>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// HARO Parser
// ──────────────────────────────────────────────────────────────────
function HaroTab({ siteId }: { siteId: string }) {
  const [emailContent, setEmailContent] = useState('');
  const [queries, setQueries] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const parse = async () => {
    if (!emailContent.trim()) {
      toast.error('HARO email içeriğini yapıştırın');
      return;
    }
    setLoading(true);
    try {
      const res = await api.parseHaroDigest(siteId, emailContent);
      setQueries(res);
      toast.success(`${res.length} HARO sorusu bulundu`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        HARO (Help A Reporter Out) gazetecilerin sektör soruları için kaynak aradığı bir e-mail servisi. Aldığınız HARO digest'ini buraya yapıştırın — AI sektörle ilgili olanları bulur, marka tonunda <strong>taslak pitch</strong> hazırlar. Yanıtlanan her HARO = backlink + AI authority signal.
      </p>

      <textarea
        value={emailContent}
        onChange={(e) => setEmailContent(e.target.value)}
        placeholder="HARO email içeriğini buraya yapıştırın..."
        className="w-full min-h-[120px] px-3 py-2 border rounded text-xs font-mono bg-background"
      />

      <Button size="sm" onClick={parse} disabled={loading}>
        {loading ? 'Parse ediliyor (~30s)…' : '📧 HARO Parse + Pitch Üret'}
      </Button>

      {queries.length > 0 && (
        <div className="space-y-2">
          {queries.map((q, i) => (
            <div key={i} className="rounded-md border p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">{q.publication}</p>
                  <p className="text-[11px] text-muted-foreground">{q.reporter} · {q.category} · Deadline: {q.deadline}</p>
                </div>
                <Badge variant={q.brandFitScore >= 70 ? 'default' : 'outline'}>{q.brandFitScore}/100</Badge>
              </div>
              <p className="text-xs italic">"{q.query.slice(0, 200)}…"</p>
              <div className="rounded bg-muted/30 p-2 border-l-2 border-brand">
                <p className="text-[10px] uppercase font-semibold text-muted-foreground mb-1">AI taslak pitch:</p>
                <p className="text-xs whitespace-pre-wrap">{q.draftPitch}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(q.draftPitch); toast.success('Kopyalandı'); }}>
                  <Copy className="h-3 w-3 mr-1" /> Kopyala
                </Button>
                {q.email && (
                  <a href={`mailto:${q.email}?subject=HARO Response: ${encodeURIComponent(q.publication)}`} className="text-xs text-brand hover:underline inline-flex items-center gap-1">
                    Gazeteciye yaz <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Programmatic SEO (81 İl)
// ──────────────────────────────────────────────────────────────────
function ProgrammaticTab({ siteId }: { siteId: string }) {
  const [template, setTemplate] = useState('{location} için {niche} öneri rehberi');
  const [spreadDays, setSpreadDays] = useState(30);
  const [maxQuota, setMaxQuota] = useState(20);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    if (!template.includes('{location}')) {
      toast.error('Şablonda {location} yer tutucusu olmalı');
      return;
    }
    setLoading(true);
    try {
      const res = await api.generateProgrammaticCities(siteId, { template, spreadDays, maxQuota });
      setResult(res);
      toast.success(`${res.scheduled} sehir takvime eklendi`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Programmatic SEO: tek şablon, 81 il = 81 makale. <code className="bg-muted px-1 rounded">{'{location}'}</code> ve <code className="bg-muted px-1 rounded">{'{niche}'}</code> yer tutucuları desteklenir. Plan kotasına göre N şehir yayılır, takvime eklenir, otopilot ON ise sırayla üretilip yayınlanır.
      </p>

      <div className="space-y-2">
        <label className="block">
          <span className="text-xs font-medium">Şablon</span>
          <input
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background"
            placeholder="{location} için shared hosting önerileri"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="text-xs font-medium">Yayılma süresi (gün)</span>
            <input
              type="number"
              value={spreadDays}
              onChange={(e) => setSpreadDays(parseInt(e.target.value, 10) || 30)}
              className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background"
              min={1}
              max={365}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium">Maks şehir (kotaya göre)</span>
            <input
              type="number"
              value={maxQuota}
              onChange={(e) => setMaxQuota(parseInt(e.target.value, 10) || 1)}
              className="w-full mt-1 px-3 py-2 border rounded text-sm bg-background"
              min={1}
              max={81}
            />
          </label>
        </div>
      </div>

      <Button size="sm" onClick={generate} disabled={loading}>
        {loading ? 'Şehirler ekleniyor…' : `🗺️ ${maxQuota} Şehri Takvime Ekle`}
      </Button>

      {result && (
        <div className="rounded-md border p-3 bg-green-500/5 space-y-2">
          <p className="text-sm font-semibold">✓ {result.scheduled} şehir takvime eklendi</p>
          <details>
            <summary className="text-xs cursor-pointer text-muted-foreground">Eklenen başlıklar</summary>
            <ul className="mt-2 space-y-0.5 text-[11px]">
              {(result.topics ?? []).map((t: string, i: number) => (
                <li key={i}>• {t}</li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Schema Validator
// ──────────────────────────────────────────────────────────────────
function SchemaValidateTab({ siteId }: { siteId: string }) {
  const [url, setUrl] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const validate = async () => {
    if (!url.startsWith('http')) {
      toast.error('Geçerli URL girin (https://...)');
      return;
    }
    setLoading(true);
    try {
      const res = await api.validateSchema(siteId, url);
      setData(res);
      if (res.valid) toast.success('Schema markup geçerli');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Yayınlanmış makalenizin URL'ini verin. Schema.org JSON-LD'leri çıkarılıp validate edilir. Google rich results + AI search citation için kritik.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="url"
          placeholder="https://siteniz.com/blog/makale.html"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="flex-1 px-3 py-2 border rounded text-sm bg-background"
        />
        <Button size="sm" onClick={validate} disabled={loading}>
          {loading ? 'Tarıyor…' : 'Validate'}
        </Button>
      </div>

      {data && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-md border p-3 text-center">
              <p className={`text-2xl font-bold ${data.valid ? 'text-green-500' : 'text-red-500'}`}>
                {data.valid ? '✓' : '✗'}
              </p>
              <p className="text-[11px] text-muted-foreground">{data.valid ? 'Geçerli' : 'Sorunlu'}</p>
            </div>
            <div className="rounded-md border p-3 text-center">
              <p className="text-2xl font-bold">{data.schemaCount}</p>
              <p className="text-[11px] text-muted-foreground">JSON-LD blok</p>
            </div>
            <div className="rounded-md border p-3 text-center">
              <p className="text-2xl font-bold">{data.types.length}</p>
              <p className="text-[11px] text-muted-foreground">Schema tipi</p>
            </div>
          </div>

          {data.types.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {data.types.map((t: string) => (
                <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
              ))}
            </div>
          )}

          {data.errors.length > 0 && (
            <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3">
              <p className="text-xs font-semibold text-red-700 dark:text-red-400 mb-1.5">❌ Hatalar ({data.errors.length})</p>
              <ul className="space-y-0.5 text-xs">
                {data.errors.map((e: string, i: number) => <li key={i}>• {e}</li>)}
              </ul>
            </div>
          )}

          {data.warnings.length > 0 && (
            <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3">
              <p className="text-xs font-semibold text-yellow-700 dark:text-yellow-400 mb-1.5">⚠ Uyarılar ({data.warnings.length})</p>
              <ul className="space-y-0.5 text-xs">
                {data.warnings.map((w: string, i: number) => <li key={i}>• {w}</li>)}
              </ul>
            </div>
          )}

          {data.recommendations.length > 0 && (
            <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3">
              <p className="text-xs font-semibold text-blue-700 dark:text-blue-400 mb-1.5">💡 Öneriler ({data.recommendations.length})</p>
              <ul className="space-y-0.5 text-xs">
                {data.recommendations.map((r: string, i: number) => <li key={i}>• {r}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Tracker Embed
// ──────────────────────────────────────────────────────────────────
function TrackerEmbedTab({ siteId }: { siteId: string }) {
  const url = api.getTrackerEmbedUrl(siteId);
  const snippet = `<script async src="${url}"></script>`;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Sitenizdeki <strong>her sayfaya</strong> bu script tag'ini ekleyin. AI bot trafiğini <strong>gerçek zamanlı</strong> izler — manuel log upload gerekmez. GPTBot/ClaudeBot/PerplexityBot ziyaret ettiğinde otomatik yakalanır.
      </p>

      <div className="rounded-md border">
        <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between">
          <p className="text-xs font-semibold">Embed Script</p>
          <button
            onClick={() => { navigator.clipboard.writeText(snippet); toast.success('Kopyalandı'); }}
            className="text-xs text-brand hover:underline inline-flex items-center gap-1"
          >
            <Copy className="h-3 w-3" /> Kopyala
          </button>
        </div>
        <pre className="p-3 text-[11px] font-mono whitespace-pre-wrap break-all">{snippet}</pre>
      </div>

      <div className="rounded-md border bg-muted/20 p-3">
        <p className="text-xs font-semibold mb-2">Nereye yapıştır?</p>
        <ul className="space-y-1 text-xs text-muted-foreground">
          <li>• <strong>WordPress:</strong> Tema &gt; Theme File Editor &gt; header.php (&lt;/head&gt; tag'inden hemen önce)</li>
          <li>• <strong>Webflow:</strong> Project Settings &gt; Custom Code &gt; Head Code</li>
          <li>• <strong>cPanel/HTML:</strong> Her sayfanın &lt;head&gt; bölümüne ekleyin</li>
          <li>• <strong>Otopilot ON:</strong> LuviAI'ın yayınladığı yeni makalelere <strong>otomatik</strong> eklenir</li>
        </ul>
      </div>

      <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3">
        <p className="text-xs">
          <strong>📊 Veri akışı:</strong> Bot ziyaret ettiğinde tracker.js çalışır → beacon.gif fetch eder → API middleware bot UA'sını yakalar → 60sn'de bir DB'ye flush eder. <strong>AI Crawler Trafiği</strong> paneli bu verilerle dolar.
        </p>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Reddit / Community Outreach
// ──────────────────────────────────────────────────────────────────
function CommunityTab({ siteId }: { siteId: string }) {
  const [opportunities, setOpportunities] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const find = async () => {
    setLoading(true);
    try {
      const res = await api.findCommunity(siteId, 10);
      setOpportunities(res);
      toast.success(`${res.length} fırsat bulundu`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Taslak panoya kopyalandı');
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        AI'lar (özellikle ChatGPT ve Perplexity) Reddit'i <strong>birinci kaynak</strong> olarak kullanıyor. LuviAI sektör sorularınızla ilgili Reddit postlarını tarayıp marka sesinizde taslak cevap önerir. Spam değil — gerçek değer.
        <strong className="text-yellow-700 dark:text-yellow-400"> Manuel onay zorunlu</strong>, otomatik post YOK.
      </p>
      <Button size="sm" onClick={find} disabled={loading}>
        {loading ? 'Reddit taranıyor (~30s)…' : '🔍 Fırsat Bul'}
      </Button>
      {opportunities.length > 0 && (
        <div className="space-y-2">
          {opportunities.map((op, i) => (
            <div key={i} className="rounded-md border p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">{op.title}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    r/{op.subreddit ?? 'unknown'} · {op.publishedAt ? new Date(op.publishedAt).toLocaleDateString('tr-TR') : ''}
                  </p>
                </div>
                <Badge variant={op.brandFitScore >= 70 ? 'default' : 'outline'}>{op.brandFitScore}/100 fit</Badge>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">{op.snippet}</p>
              <div className="rounded bg-muted/30 p-2 border-l-2 border-brand">
                <p className="text-[10px] uppercase font-semibold text-muted-foreground mb-1">AI taslak yanıt:</p>
                <p className="text-xs whitespace-pre-wrap">{op.draftReply}</p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => copy(op.draftReply)}>
                  <Copy className="h-3 w-3 mr-1" /> Kopyala
                </Button>
                <a href={op.url} target="_blank" rel="noopener" className="text-xs text-brand hover:underline inline-flex items-center gap-1">
                  Reddit'te aç <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Cross-Linking (multi-tenant network effect)
// ──────────────────────────────────────────────────────────────────
function CrossLinkTab({ siteId }: { siteId: string }) {
  const [articles, setArticles] = useState<any[]>([]);
  const [selectedArticle, setSelectedArticle] = useState<string>('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);

  // Site'in published makalelerini cek
  const loadArticles = async () => {
    try {
      const res = await api.listArticles(siteId, 'PUBLISHED');
      setArticles(res);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const suggest = async (articleId: string) => {
    if (!articleId) return;
    setLoading(true);
    setSelectedArticle(articleId);
    try {
      const res = await api.suggestCrossLinks(siteId, articleId, 5);
      setSuggestions(res);
      toast.success(`${res.length} cross-link önerisi`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const apply = async (suggestion: any) => {
    setApplying(suggestion.toArticleId);
    try {
      await api.applyCrossLink(siteId, suggestion);
      toast.success(`Cross-link uygulandı: ${suggestion.toSiteName}`);
      setSuggestions(suggestions.filter((s) => s.toArticleId !== suggestion.toArticleId));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setApplying(null);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        LuviAI ekosistemindeki diğer sitelerle <strong>akıllı cross-link</strong> kurar. AI'lar bu bağlantıları "ekosistem" olarak öğrenir → tüm siteler birden alıntılanır. Sadece <strong>Otopilot ON</strong> olan siteler dahil edilir (consent).
      </p>
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" variant="outline" onClick={loadArticles}>
          Makaleleri Yükle
        </Button>
        {articles.length > 0 && (
          <select
            value={selectedArticle}
            onChange={(e) => suggest(e.target.value)}
            className="px-2 py-1.5 border rounded text-xs bg-background flex-1 max-w-md"
          >
            <option value="">— Bir makale seç —</option>
            {articles.map((a) => (
              <option key={a.id} value={a.id}>{a.title}</option>
            ))}
          </select>
        )}
        {loading && <span className="text-xs text-muted-foreground">Öneriler bulunuyor…</span>}
      </div>

      {suggestions.length > 0 && (
        <div className="space-y-2">
          {suggestions.map((s, i) => (
            <div key={i} className="rounded-md border p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{s.toArticleTitle}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {s.toSiteName} · {s.insertionPoint}
                  </p>
                </div>
                <Badge>{s.relevanceScore}/100</Badge>
              </div>
              <p className="text-xs text-muted-foreground italic">"{s.contextSnippet}"</p>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => apply(s)} disabled={applying === s.toArticleId}>
                  {applying === s.toArticleId ? 'Uygulanıyor…' : '✓ Cross-link Ekle'}
                </Button>
                <a href={s.toArticleUrl} target="_blank" rel="noopener" className="text-xs text-brand hover:underline inline-flex items-center gap-1">
                  Hedef makale <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Training Data (Hugging Face JSONL export)
// ──────────────────────────────────────────────────────────────────
function TrainingDataTab({ siteId }: { siteId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getTrainingDataMetadata(siteId);
      setData(res);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const downloadUrl = api.getTrainingDataDownloadUrl(siteId);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        AI'ların eğitim verisinin <strong>%30+'ı</strong> public dataset'lerden geliyor. Sitenizin makalelerini Hugging Face'e <strong>CC-BY-4.0</strong> lisansla yüklerseniz Mistral, Llama, Claude bir sonraki eğitiminde markanızı öğrenir.
        <strong className="text-green-700 dark:text-green-400"> Kalıcı GEO etkisi</strong> — içerik silinse bile AI hatırlar.
      </p>
      {!data && (
        <Button size="sm" onClick={load} disabled={loading}>
          {loading ? 'Hazırlanıyor…' : '📦 Training Data Hazırla'}
        </Button>
      )}
      {data && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-md border p-3 text-center">
              <p className="text-2xl font-bold">{data.records}</p>
              <p className="text-[11px] text-muted-foreground">Kayıt</p>
            </div>
            <div className="rounded-md border p-3 text-center">
              <p className="text-2xl font-bold">{(data.bytes / 1024).toFixed(1)} <span className="text-sm text-muted-foreground">KB</span></p>
              <p className="text-[11px] text-muted-foreground">Boyut</p>
            </div>
            <div className="rounded-md border p-3 text-center">
              <p className="text-sm font-bold">CC-BY-4.0</p>
              <p className="text-[11px] text-muted-foreground">Lisans</p>
            </div>
          </div>

          <a href={downloadUrl} target="_blank" download className="inline-flex items-center gap-2 rounded-md bg-brand text-white px-4 py-2 text-sm font-medium hover:bg-brand/90">
            <Download className="h-4 w-4" /> JSONL İndir
          </a>

          <div className="rounded-md border">
            <div className="px-3 py-2 border-b bg-muted/30">
              <p className="text-xs font-semibold">Hugging Face'e Yükleme Adımları</p>
            </div>
            <ol className="p-3 space-y-1 text-xs text-muted-foreground">
              {(data.metadata.submitInstructions ?? []).map((s: string, i: number) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </div>

          <details className="rounded-md border">
            <summary className="px-3 py-2 cursor-pointer text-xs font-semibold bg-muted/30">
              Örnek Kayıt (ilk 2 KB)
            </summary>
            <pre className="p-3 text-[10px] font-mono whitespace-pre-wrap max-h-[300px] overflow-y-auto">{data.sample}</pre>
          </details>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Heatmap
// ──────────────────────────────────────────────────────────────────
function HeatmapTab({ siteId }: { siteId: string }) {
  const [running, setRunning] = useState(false);
  const [data, setData] = useState<any>(null);

  const run = async () => {
    setRunning(true);
    try {
      const res = await api.runGeoHeatmap(siteId, 10);
      setData(res);
      toast.success(`Heatmap hazır: ${res.queries.length} sorgu × ${res.providers.length} AI`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-muted-foreground max-w-2xl">
          Sektör sorgularını Claude/Gemini/ChatGPT/Perplexity'ye sorar. Her hücre: <span className="text-green-500 font-bold">●</span> alıntılandın · <span className="text-yellow-500 font-bold">●</span> sadece marka adı geçti · <span className="text-red-500 font-bold">●</span> rakip alıntılandı · <span className="text-muted-foreground font-bold">●</span> kimse alıntılanmadı (fırsat)
        </p>
        <Button size="sm" onClick={run} disabled={running}>
          {running ? 'Test ediliyor (~60s)…' : '🎯 Heatmap Çalıştır'}
        </Button>
      </div>

      {data && (
        <div className="space-y-3">
          {/* Provider skor ozeti */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {data.providers.map((p: string, i: number) => {
              const pid = ['anthropic','gemini','openai','perplexity'][i];
              const score = data.scoreByProvider[pid] ?? 0;
              const color = score >= 60 ? 'text-green-500' : score >= 30 ? 'text-yellow-500' : 'text-red-500';
              return (
                <div key={p} className="rounded-md border p-2 text-center">
                  <p className="text-xs text-muted-foreground">{p}</p>
                  <p className={`text-2xl font-bold ${color}`}>{score}</p>
                </div>
              );
            })}
          </div>

          {/* Heatmap grid */}
          <div className="overflow-x-auto">
            <table className="text-xs border-collapse w-full">
              <thead>
                <tr>
                  <th className="text-left p-2 font-medium border-b">Sorgu</th>
                  {data.providers.map((p: string) => (
                    <th key={p} className="text-center p-2 font-medium border-b min-w-[80px]">{p}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.queries.map((q: string) => (
                  <tr key={q} className="border-b hover:bg-muted/30">
                    <td className="p-2 max-w-[300px]">
                      <p className="truncate" title={q}>{q}</p>
                    </td>
                    {data.providers.map((p: string, i: number) => {
                      const pid = ['anthropic','gemini','openai','perplexity'][i];
                      const cell = data.cells.find((c: any) => c.query === q && c.provider === pid);
                      const status = cell?.status ?? 'none';
                      const bg = status === 'cited' ? 'bg-green-500/30 border-green-500'
                              : status === 'mentioned' ? 'bg-yellow-500/30 border-yellow-500'
                              : status === 'competitor' ? 'bg-red-500/30 border-red-500'
                              : 'bg-muted/30 border-muted';
                      const icon = status === 'cited' ? '✓'
                              : status === 'mentioned' ? '~'
                              : status === 'competitor' ? `→${cell?.competitor?.slice(0, 12)}…`
                              : '—';
                      return (
                        <td key={p} className={`p-2 text-center border ${bg}`} title={cell?.excerpt}>
                          <span className="font-bold text-[11px]">{icon}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Insights */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <InsightBlock
              title={`${data.guzelQueries.length} sorguda alıntılanıyorsun`}
              items={data.guzelQueries.slice(0, 3)}
              color="green"
            />
            <InsightBlock
              title={`${data.zayifQueries.length} sorguda rakip alıntılanıyor`}
              items={data.zayifQueries.slice(0, 3)}
              color="red"
            />
            <InsightBlock
              title={`${data.fırsatQueries.length} sorgu fırsat (kimse yok)`}
              items={data.fırsatQueries.slice(0, 3)}
              color="muted"
            />
          </div>

          {/* Rakip kazanmalari */}
          {Object.keys(data.competitorWins).length > 0 && (
            <div className="rounded-md border p-3 bg-red-500/5">
              <p className="text-xs font-semibold mb-2">🏆 Rakip Kazanma Sayıları</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.competitorWins).map(([host, wins]) => (
                  <Badge key={host} variant="outline" className="text-[11px]">
                    {host} · {wins as number} kez
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InsightBlock({ title, items, color }: { title: string; items: string[]; color: 'green' | 'red' | 'muted' }) {
  const bg = color === 'green' ? 'bg-green-500/10 border-green-500/30'
          : color === 'red' ? 'bg-red-500/10 border-red-500/30'
          : 'bg-muted/30 border-muted';
  return (
    <div className={`rounded-md border p-3 ${bg}`}>
      <p className="text-xs font-semibold mb-1.5">{title}</p>
      {items.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">—</p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((q, i) => (
            <li key={i} className="text-[11px] truncate">• {q}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Wikidata
// ──────────────────────────────────────────────────────────────────
function WikidataTab({ siteId }: { siteId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getWikidataDraft(siteId);
      setData(res);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Panoya kopyalandı');
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Wikidata = Google Knowledge Graph'in kaynağı. Markanızı Wikidata'ya eklerseniz AI'lar (özellikle Gemini ve Bard) sizi otomatik tanır. Aşağıdaki taslağı kopyalayın → "Wikidata'da Yeni Item" butonuna tıklayıp manuel girin.
      </p>
      {!data && (
        <Button size="sm" onClick={load} disabled={loading}>
          {loading ? 'Hazırlanıyor…' : '📝 Wikidata Taslağı Hazırla'}
        </Button>
      )}
      {data && (
        <div className="space-y-3">
          {/* Notability skoru */}
          <div className="rounded-md border p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold">Notability Skoru</p>
              <span className={`text-2xl font-bold ${
                data.notabilityScore >= 60 ? 'text-green-500' :
                data.notabilityScore >= 40 ? 'text-yellow-500' : 'text-red-500'
              }`}>{data.notabilityScore}/100</span>
            </div>
            <ul className="space-y-1 text-xs">
              {data.notabilityNotes.map((n: string, i: number) => (
                <li key={i} className="flex items-start gap-1.5">
                  {n.startsWith('✓') ? <Check className="h-3 w-3 text-green-500 mt-0.5 shrink-0" /> :
                   n.startsWith('⚠') ? <AlertCircle className="h-3 w-3 text-yellow-500 mt-0.5 shrink-0" /> :
                   <X className="h-3 w-3 text-red-500 mt-0.5 shrink-0" />}
                  <span>{n.replace(/^[✓⚠]\s*/, '')}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Labels */}
          <Field label="Türkçe Etiket" value={data.labels.tr.value} onCopy={copy} />
          <Field label="İngilizce Etiket" value={data.labels.en.value} onCopy={copy} />
          <Field label="Türkçe Açıklama" value={data.descriptions.tr.value} onCopy={copy} />

          {/* Claims tablosu */}
          <div className="rounded-md border">
            <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between">
              <p className="text-sm font-semibold">Claims (özellik → değer)</p>
              <button onClick={() => copy(JSON.stringify(data.claims, null, 2))} className="text-xs text-brand hover:underline inline-flex items-center gap-1">
                <Copy className="h-3 w-3" /> Tümünü Kopyala
              </button>
            </div>
            <div className="divide-y text-xs">
              {data.claims.map((c: any, i: number) => (
                <div key={i} className="px-3 py-2 flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-brand">{c.property}</span>
                    <span className="text-muted-foreground ml-1">{c.propertyLabel}</span>
                    <span className="ml-2 font-medium">{c.value}</span>
                  </div>
                  <Badge variant="outline" className="text-[10px] shrink-0">{c.valueType}</Badge>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <a href={data.createUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
              🌐 Manuel: Wikidata'da Yeni Item Oluştur <ExternalLink className="h-3 w-3" />
            </a>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                try {
                  const res = await api.submitKnowledge(siteId, 'wikidata', data);
                  if (res.ok) toast.success(`✓ Wikidata item oluşturuldu: ${res.itemId}`);
                  else if (res.warning) toast.warning(res.warning);
                  else toast.error(res.error ?? 'Bilinmeyen hata');
                } catch (err: any) {
                  toast.error(err.message);
                }
              }}
            >
              🤖 Otomatik Submit (Bot)
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Wikipedia
// ──────────────────────────────────────────────────────────────────
function WikipediaTab({ siteId }: { siteId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getWikipediaDraft(siteId);
      setData(res);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Panoya kopyalandı');
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Wikipedia = AI'ların eğitim verisinin <strong>%30+</strong>'ı. Wikipedia'da maddeniz olursa LLM'ler bir sonraki eğitiminde sizi öğrenir. Manuel review gerekir, "notability" eşiği yüksektir. Aşağıdaki taslağı kopyalayın → Wikipedia'ya gönderin.
      </p>
      {!data && (
        <Button size="sm" onClick={load} disabled={loading}>
          {loading ? 'AI hazırlıyor (Sonnet 4.6, ~30s)…' : '📝 Wikipedia Makale Taslağı Hazırla'}
        </Button>
      )}
      {data && (
        <div className="space-y-3">
          <div className="rounded-md border p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold">{data.title}</p>
              <span className={`text-xl font-bold ${
                data.notabilityScore >= 60 ? 'text-green-500' : 'text-yellow-500'
              }`}>{data.notabilityScore}/100</span>
            </div>
            <p className="text-[11px] text-muted-foreground">Notability skoru. 60+ değilse Wikipedia editörleri reddedebilir.</p>
          </div>

          <div className="rounded-md border">
            <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between">
              <p className="text-xs font-semibold">Wikitext (kopyala → Wikipedia editörüne yapıştır)</p>
              <button onClick={() => copy(data.content)} className="text-xs text-brand hover:underline inline-flex items-center gap-1">
                <Copy className="h-3 w-3" /> Kopyala
              </button>
            </div>
            <pre className="p-3 text-[11px] font-mono whitespace-pre-wrap max-h-[400px] overflow-y-auto">{data.content}</pre>
          </div>

          <p className="text-[11px] text-muted-foreground">
            🔗 Kategoriler: {data.category.join(', ')}
          </p>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onCopy }: { label: string; value: string; onCopy: (text: string) => void }) {
  return (
    <div className="rounded-md border px-3 py-2 flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground uppercase tracking-wide font-medium min-w-[120px]">{label}</span>
      <span className="flex-1 text-sm">{value}</span>
      <button onClick={() => onCopy(value)} className="text-xs text-brand hover:underline">
        <Copy className="h-3 w-3" />
      </button>
    </div>
  );
}
