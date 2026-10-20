'use client';

import { EngineLogo } from '@/components/engine-logo';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Sparkles, Network, Globe, Check, X, AlertCircle, Copy, ExternalLink, Play, MessageSquare, Link2, Download, Code, Activity, MapPin, Mail, BarChart3, Bot,
  Gauge, Award, Wrench, Send, BookOpen, Target, Lightbulb, Package, FileText, Search, Map as MapIcon, Trophy, CheckCircle2, XCircle, AlertTriangle, Tags,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNum } from '@/lib/format';
import { api } from '@/lib/api';
import { LockedGenerateButton } from '@/components/locked-article';
import { refreshArticleAllowance, useArticleAllowance } from '@/lib/use-article-allowance';
import { MeasurementLimitNote } from '@/components/measurement-limit-note';
import { isWeeklyMeasurementLimitError, refreshMeasurementAllowance, useMeasurementAllowance } from '@/lib/measurement-allowance';
import { displayProbeText } from '@/lib/probe-error-text';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

/**
 * GEO Lab — gelismis GEO arac kutusu:
 *  1. Heatmap: sektor sorulari × AI provider matrix (yesil/kirmizi/sari/gri)
 *  2. Wikidata draft (Knowledge Graph icin)
 *  3. Wikipedia article draft
 */
type ToolId = 'heatmap' | 'wikidata' | 'wikipedia' | 'community' | 'cross-link' | 'training' | 'schema-validate' | 'tracker' | 'sitemap-ai' | 'haro' | 'programmatic' | 'ai-console' | 'chat-widget';

type Tool = { id: ToolId; label: string; icon: React.ComponentType<{ className?: string }> };

// 13 arac tek satirda telefonda kirilip tasiyordu → 4 kategori, her biri kendi sekme listesinde
const CATEGORIES: Array<{ id: string; label: string; icon: React.ComponentType<{ className?: string }>; description: string; tools: Tool[] }> = [
  {
    id: 'olc',
    label: 'Ölç',
    icon: Gauge,
    description: 'AI cevaplarında nerede alıntılandığını ve AI kaynaklı trafiği ölç.',
    tools: [
      { id: 'heatmap', label: 'Isı haritası', icon: Network },
      { id: 'ai-console', label: 'AI trafik konsolu', icon: BarChart3 },
      { id: 'tracker', label: 'Bot izleyici', icon: Activity },
    ],
  },
  {
    id: 'otorite',
    label: 'Otorite',
    icon: Award,
    description: 'Bilgi grafiği, ansiklopedi ve topluluk sinyalleriyle güven kazan.',
    tools: [
      { id: 'wikidata', label: 'Wikidata', icon: Globe },
      { id: 'wikipedia', label: 'Wikipedia', icon: BookOpen },
      { id: 'community', label: 'Reddit', icon: MessageSquare },
      { id: 'haro', label: 'HARO', icon: Mail },
      { id: 'cross-link', label: 'Çapraz bağlantı', icon: Link2 },
    ],
  },
  {
    id: 'teknik',
    label: 'Teknik',
    icon: Wrench,
    description: 'AI tarayıcılarının siteni doğru okuması için yapısal veriler.',
    tools: [
      { id: 'schema-validate', label: 'Şema doğrula', icon: Code },
      { id: 'sitemap-ai', label: 'AI site haritası', icon: Globe },
      { id: 'training', label: 'Eğitim verisi', icon: Download },
    ],
  },
  {
    id: 'dagitim',
    label: 'Dağıtım',
    icon: Send,
    description: 'İçeriğini ölçekle çoğalt ve sitende AI sohbetiyle sun.',
    tools: [
      { id: 'programmatic', label: '81 il sayfası', icon: MapPin },
      { id: 'chat-widget', label: 'Sohbet aracı', icon: Bot },
    ],
  },
];

function ToolBody({ id, siteId, ownerId }: { id: ToolId; siteId: string; ownerId?: string | null }) {
  switch (id) {
    case 'heatmap': return <HeatmapTab siteId={siteId} />;
    case 'wikidata': return <WikidataTab siteId={siteId} />;
    case 'wikipedia': return <WikipediaTab siteId={siteId} />;
    case 'community': return <CommunityTab siteId={siteId} />;
    case 'cross-link': return <CrossLinkTab siteId={siteId} />;
    case 'training': return <TrainingDataTab siteId={siteId} />;
    case 'schema-validate': return <SchemaValidateTab siteId={siteId} />;
    case 'tracker': return <TrackerEmbedTab siteId={siteId} />;
    case 'sitemap-ai': return <AiSitemapTab siteId={siteId} />;
    case 'haro': return <HaroTab siteId={siteId} />;
    case 'programmatic': return <ProgrammaticTab siteId={siteId} ownerId={ownerId} />;
    case 'ai-console': return <AiSearchConsoleTab siteId={siteId} />;
    case 'chat-widget': return <ChatWidgetTab siteId={siteId} />;
  }
}

/**
 * GEO Lab — gelismis GEO arac kutusu. ui/tabs (Radix: klavye + ARIA), iki seviye:
 * kategori → arac. Sekme listeleri yatay kayar; telefonda satir kirilmaz.
 */
export function GeoLabPanel({ siteId, ownerId }: { siteId: string; /** Sitenin sahibi (site.userId): makale hakki onun */ ownerId?: string | null }) {
  const [category, setCategory] = useState(CATEGORIES[0].id);
  // Her kategoride son secilen arac hatirlanir
  const [toolByCat, setToolByCat] = useState<Record<string, ToolId>>(
    () => Object.fromEntries(CATEGORIES.map((c) => [c.id, c.tools[0].id])) as Record<string, ToolId>,
  );

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <SectionHeader
          as="h3"
          icon={Sparkles}
          title="Gelişmiş AI görünürlük araçları"
          description="Ölç, otorite kazan, teknik altyapıyı düzelt ve içeriğini dağıt."
        />

        <Tabs value={category} onValueChange={setCategory}>
          <div className="-mx-4 overflow-x-auto px-4">
            <TabsList className="w-max" aria-label="Araç kategorisi">
              {CATEGORIES.map((c) => {
                const Icon = c.icon;
                return (
                  <TabsTrigger key={c.id} value={c.id}>
                    <Icon className="h-3.5 w-3.5 mr-1.5" aria-hidden /> {c.label}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </div>

          {CATEGORIES.map((c) => (
            <TabsContent key={c.id} value={c.id} className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">{c.description}</p>
              <Tabs
                value={toolByCat[c.id]}
                onValueChange={(v) => setToolByCat((prev) => ({ ...prev, [c.id]: v as ToolId }))}
              >
                <div className="-mx-4 overflow-x-auto border-b px-4">
                  <TabsList className="h-auto w-max justify-start gap-1 rounded-none bg-transparent p-0" aria-label={`${c.label} araçları`}>
                    {c.tools.map((t) => {
                      const Icon = t.icon;
                      return (
                        <TabsTrigger
                          key={t.id}
                          value={t.id}
                          className="rounded-none border-b-2 border-transparent px-3 py-2 text-xs data-[state=active]:border-brand data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none dark:data-[state=active]:bg-transparent"
                        >
                          <Icon className="h-3.5 w-3.5 mr-1.5" aria-hidden /> {t.label}
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                </div>
                {c.tools.map((t) => (
                  <TabsContent key={t.id} value={t.id} className="mt-3">
                    <ToolBody id={t.id} siteId={siteId} ownerId={ownerId} />
                  </TabsContent>
                ))}
              </Tabs>
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
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

  if (loading || !data) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Yükleniyor">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  const sortedReferrers = Object.entries(data.byReferrer ?? {}).sort((a, b) => (b[1] as number) - (a[1] as number));

  return (
    <div className="space-y-3">
      {/*
        Eski metin "gercek satin alma niyetli ziyaretci", "cogu site icin %1'in altinda" ve
        "ChatGPT trafiginin buyuk bolumu Direct gorunur" diyordu — olculmemis niyet ve
        kaynaksiz oranlar. Dogrulanan: Ahrefs, Mart 2026, 74.752 site — AI sohbet botlari
        toplam web trafiginin %0,28'i; bazi asistanlar yonlendiren adresi iletmedigi icin
        AI ziyaretleri eksik sayilabiliyor. https://ahrefs.com/blog/ai-chatbot-traffic/
      */}
      <p className="text-xs text-muted-foreground">
        Bu sayfa <strong>AI cevaplarındaki bağlantılardan gelen kullanıcı trafiği</strong>ni gösterir. ChatGPT/Perplexity/Claude cevabında sitenizin bağlantısı yer alıp kullanıcı tıkladığında, tarayıcının gönderdiği yönlendiren adres (referrer) yakalanır. <strong>Bot trafiği değil — AI cevabındaki bağlantıya tıklayan gerçek ziyaretçi.</strong>
      </p>
      <p className="text-label text-muted-foreground">
        Bağlam: bağımsız ölçümler AI asistanlarından gelen ziyaretin toplam web trafiğinin küçük bir bölümü olduğunu gösteriyor (Ahrefs, Mart 2026: %0,28). Bu ziyaretçi soruyu sormuş, cevabı okumuş ve sonra tıklamıştır. Bazı AI uygulamaları yönlendiren adresi iletmediği için bu ziyaretlerin bir kısmı analitikte &quot;Direct&quot; görünür; bu sayfa <strong>ölçülebilen alt küme</strong>dir, tamamı değil.
      </p>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="inline-flex border rounded-md overflow-hidden">
          {[7, 30, 90].map((d) => (
            <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)} className={`px-2.5 py-1 text-xs font-medium ${days === d ? 'bg-brand text-white' : 'bg-card text-muted-foreground hover:bg-muted'}`}>{d}g</button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">Toplam: <strong>{formatNum(data.totalHits)}</strong> tıklama</span>
      </div>

      {data.totalHits === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Henüz AI referrer trafiği yok. Tracker.js sitenize embed edildikten sonra (Bot Tracker sekmesi) kullanıcılar AI&apos;dan tıklayınca buradan görürsün. Sıfır olması olağandır: AI asistanlarından gelen ziyaret çoğu sitede toplam trafiğin küçük bir bölümüdür ve tıklama için önce cevapta kaynak (bağlantı) olarak yer almak gerekir.
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
                  <span className="font-mono text-xs">{formatNum(hits as number)} (%{pct.toFixed(1)})</span>
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
        <pre className="p-3 text-label font-mono whitespace-pre-wrap break-all">{snippet}</pre>
      </div>

      <div className="rounded-md border bg-muted/20 p-3">
        <p className="text-xs font-semibold mb-2">Özellikler</p>
        <ul className="space-y-1 text-xs text-muted-foreground">
          <li className="flex items-start gap-1.5"><Check className="h-3 w-3 mt-0.5 shrink-0 text-success" aria-hidden />Otomatik FAB (sağ alt köşe, tıklanınca açılır)</li>
          {/* Eski madde "Marka rengi + RanksUp gradient" diyordu: widget renkleri persona-chat.service.ts buildWidgetJs icinde sabit mor degrade; site rengine gore ayar yok */}
          <li className="flex items-start gap-1.5"><Check className="h-3 w-3 mt-0.5 shrink-0 text-success" aria-hidden />Mor renkli düğme ve sohbet penceresi (renkler sabittir)</li>
          <li className="flex items-start gap-1.5"><Check className="h-3 w-3 mt-0.5 shrink-0 text-success" aria-hidden />AI brain context'i + son 30 makale ile cevap üretir</li>
          <li className="flex items-start gap-1.5"><Check className="h-3 w-3 mt-0.5 shrink-0 text-success" aria-hidden />Cevap içinde ilgili makale linki otomatik</li>
          <li className="flex items-start gap-1.5"><Check className="h-3 w-3 mt-0.5 shrink-0 text-success" aria-hidden />Mobil uyumlu, responsive</li>
        </ul>
      </div>

      <div className="rounded-md border border-info/30 bg-info/5 p-3">
        <p className="text-xs">
          {/* Eski metin "sorular Google'a kullanici niyeti sinyali gonderir" diyordu: widget sorulari yalniz RanksUp API'sine gider, Google'a hicbir sey iletilmez */}
          <Target className="inline h-3.5 w-3.5 mr-1 align-[-2px]" aria-hidden /><strong>Ne işe yarar:</strong> Ziyaretçinin sorusunu sitenizin içeriğiyle yanıtlar ve ilgili makaleye yönlendirir. Sorular yalnızca RanksUp&apos;a iletilir; arama motorlarına ya da AI asistanlarına bir sinyal gönderilmez ve sıralamaya doğrudan etkisi yoktur.
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
        {/* Eski metin "200 kelimelik AI ozet" ve "AI search engines bu sitemap'i okuyup daha hizli ogrenir" diyordu: ai-sitemap.service.ts meta aciklamanin ilk 200 KARAKTERINI yaziyor; ai: alanlari standart degil, okuyan motor aciklanmamis */}
        {/* Harita RanksUp sunucusundan herkese acik sunulur (audit.controller sitemap-ai.xml @Public). Yalniz sitede herkese acik oldugu bilinen adresi olan yazilar listelenir (ai-sitemap.service advertisedArticleEntry: cop kutusundaki / silinmis kopya ve herkese acik oldugu bilinmeyip hic canli gorulmemis WordPress kopyasi adres vermez; articlePublicUrl artik uretimde cagrilmiyor) */}
        Standart <code className="bg-muted px-1 rounded">sitemap.xml</code>&apos;ine ek olarak RanksUp, sitenin <strong>AI odaklı bir site haritasını</strong> kendi sunucusunda yayınlar: özel <code className="bg-muted px-1 rounded">ai:summary</code> alanında her yazının meta açıklaması (en fazla 200 karakter), <code className="bg-muted px-1 rounded">ai:topics</code> alanında AEO soruları, editör skoruna göre öncelik. Yalnız sitende yayınlanmış ve adresi bilinen yazılar listelenir; indirme olarak alınan ya da site dışındaki bir sisteme (GitHub deposu, Contentful/Sanity/Strapi gibi içerik yönetim sistemleri) gönderilen yazılar listelenmez. Harita kendiliğinden güncellenir. <code className="bg-muted px-1 rounded">ai:</code> alanları standart site haritası protokolünün parçası değildir; AI arama motorlarının bu alanları okuduğu açıklanmış değildir, etkisi garanti edilmez.
      </p>

      <div className="rounded-md border">
        <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between">
          <p className="text-xs font-semibold">Site haritası adresi</p>
          <button
            onClick={() => { navigator.clipboard.writeText(url); toast.success('Kopyalandı'); }}
            className="text-xs text-brand hover:underline inline-flex items-center gap-1"
          >
            <Copy className="h-3 w-3" /> Kopyala
          </button>
        </div>
        <pre className="p-3 text-label font-mono whitespace-pre-wrap break-all">{url}</pre>
      </div>

      <div className="flex items-center gap-2">
        <a href={url} target="_blank" rel="noopener" className="text-xs text-brand hover:underline inline-flex items-center gap-1">
          Haritayı aç <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      <div className="rounded-md border bg-muted/20 p-3">
        <p className="text-xs font-semibold mb-2">Sitenin robots.txt dosyasına ekle</p>
        <pre className="text-label font-mono whitespace-pre-wrap break-all">{robotsLine}</pre>
        {/*
          Kaynaklar: sitemaps.org "Sitemaps & Cross Submits" (baska host'taki
          harita robots.txt ile gosterilir; harita yalniz o host'un adreslerini
          icerir) ve Google "Build and submit a sitemap" (robots.txt satiri bir
          sonraki robots.txt taramasinda bulunur; Search Console'dan capraz
          gonderim icin tum alan adlarinin sahipligi dogrulanmali) —
          https://www.sitemaps.org/protocol.html#sitemaps_cross_submits
          https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap
          Eski "Google Search Console'a submit" baglantisi kaldirildi: musteri
          RanksUp'in alan adini dogrulayamaz, Site Haritalari raporu baska alan
          adindaki adresi kabul etmez ("URL not allowed",
          https://support.google.com/webmasters/answer/7451001).
        */}
        <p className="text-xs text-muted-foreground mt-2">
          Harita RanksUp sunucusunda durur; sitenin robots.txt dosyasındaki bu satır, başka bir sunucudaki haritayı siteye bağlamanın standart yoludur. Google haritayı, robots.txt dosyanı bir sonraki taramasında bulur. Harita farklı bir alan adında olduğu için Search Console&apos;daki Site Haritaları raporundan gönderilemez: Google orada başka alan adındaki bir haritayı ancak iki alan adının da sahipliği doğrulanmışsa kabul eder.
        </p>
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
      {/*
        Eski metin "AI sektörle ilgili olanları bulur" diyordu: ayristirma ve uygunluk
        puani kural tabanli (haro-parser.service.ts scoreFit), AI yalniz taslak yazar —
        ve artik yalniz uygunluk puani en yuksek sorulara (HARO_PITCH_TOP_N).
      */}
      <p className="text-xs text-muted-foreground">
        HARO (Help A Reporter Out) gazetecilerin sektör soruları için kaynak aradığı bir e-mail servisi. Aldığınız HARO digest&apos;ini buraya yapıştırın — sorular sektörünüze uygunluğa göre sıralanır, en uygun olanlara AI marka tonunda <strong>taslak pitch</strong> hazırlar. Gazeteci yanıtınızı kullanırsa haberde kaynak olarak anılabilir ve bağlantı alabilirsiniz; yayın ve bağlantı garanti değildir.
      </p>

      <textarea
        value={emailContent}
        onChange={(e) => setEmailContent(e.target.value)}
        placeholder="HARO email içeriğini buraya yapıştırın..."
        className="w-full min-h-[120px] px-3 py-2 border rounded text-xs font-mono bg-background"
      />

      <Button size="sm" onClick={parse} disabled={loading}>
        {loading ? 'Ayrıştırılıyor (~30 sn)…' : <><Mail className="h-3.5 w-3.5 mr-1.5" aria-hidden />HARO ayrıştır + yanıt üret</>}
      </Button>

      {queries.length > 0 && (
        <div className="space-y-2">
          {queries.map((q, i) => (
            <div key={i} className="rounded-md border p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">{q.publication}</p>
                  <p className="text-label text-muted-foreground">{q.reporter} · {q.category} · Deadline: {q.deadline}</p>
                </div>
                <Badge variant={q.brandFitScore >= 70 ? 'default' : 'outline'}>{q.brandFitScore}/100</Badge>
              </div>
              <p className="text-xs italic">"{q.query.slice(0, 200)}…"</p>
              {q.pitchSkipped ? (
                <p className="text-label text-muted-foreground">Taslak hazırlanmadı: AI taslağı yalnız uygunluk puanı en yüksek sorular için hazırlanır.</p>
              ) : (
                <div className="rounded bg-muted/30 p-2 border-l-2 border-brand">
                  <p className="text-label font-semibold text-muted-foreground mb-1">AI taslak pitch:</p>
                  <p className="text-xs whitespace-pre-wrap">{q.draftPitch}</p>
                </div>
              )}
              <div className="flex items-center gap-2">
                {!q.pitchSkipped && (
                  <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(q.draftPitch); toast.success('Kopyalandı'); }}>
                    <Copy className="h-3 w-3 mr-1" /> Kopyala
                  </Button>
                )}
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
function ProgrammaticTab({ siteId, ownerId }: { siteId: string; ownerId?: string | null }) {
  // Hak bitince sunucu hic sehir eklemez (programmatic-seo.service kalan hakka gore
  // keser): dugme bos sonuc yerine kilidi gosterir
  const allowance = useArticleAllowance(ownerId);
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
      refreshArticleAllowance(ownerId);
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
            className="mt-1 flex h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
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
              className="mt-1 flex h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
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
              className="mt-1 flex h-10 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
              min={1}
              max={81}
            />
          </label>
        </div>
      </div>

      {allowance.locked ? (
        <LockedGenerateButton lock={allowance} />
      ) : (
      <Button size="sm" onClick={generate} disabled={loading}>
        {loading ? 'Şehirler ekleniyor…' : <><MapIcon className="h-3.5 w-3.5 mr-1.5" aria-hidden />{maxQuota} şehri takvime ekle</>}
      </Button>
      )}

      {result && (
        <div className="rounded-md border p-3 bg-success/5 space-y-2">
          <p className="flex items-center gap-1.5 text-sm font-semibold"><CheckCircle2 className="h-4 w-4 text-success" aria-hidden />{result.scheduled} şehir takvime eklendi</p>
          <details>
            <summary className="text-xs cursor-pointer text-muted-foreground">Eklenen başlıklar</summary>
            <ul className="mt-2 space-y-0.5 text-label">
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
        {/* Google: yapilandirilmis veri zengin sonuclari etkinlestirebilir, zorunlu alanlar eksikse uygun olmaz — https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data */}
        Yayınlanmış makalenizin URL&apos;ini verin. Schema.org JSON-LD blokları çıkarılıp doğrulanır. Yapılandırılmış veri sayfayı Google zengin sonuçlarına uygun hâle getirebilir (gerekli alanlar eksiksizse); AI aramalarında atıf alma üzerindeki etkisi garanti değildir.
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
              <p className={`text-metric-lg tabular-nums ${data.valid ? 'text-success' : 'text-danger'}`}>
                {data.valid ? <CheckCircle2 className="mx-auto h-7 w-7" aria-label="Geçerli" /> : <XCircle className="mx-auto h-7 w-7" aria-label="Sorunlu" />}
              </p>
              <p className="text-label text-muted-foreground">{data.valid ? 'Geçerli' : 'Sorunlu'}</p>
            </div>
            <div className="rounded-md border p-3 text-center">
              <p className="text-metric-lg tabular-nums">{data.schemaCount}</p>
              <p className="text-label text-muted-foreground">JSON-LD blok</p>
            </div>
            <div className="rounded-md border p-3 text-center">
              <p className="text-metric-lg tabular-nums">{data.types.length}</p>
              <p className="text-label text-muted-foreground">Schema tipi</p>
            </div>
          </div>

          {data.types.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {data.types.map((t: string) => (
                <Badge key={t} variant="outline" className="text-label">{t}</Badge>
              ))}
            </div>
          )}

          {data.errors.length > 0 && (
            <div className="rounded-md border border-danger/30 bg-danger/5 p-3">
              <p className="text-xs font-semibold text-danger mb-1.5 flex items-center gap-1.5"><XCircle className="h-3.5 w-3.5" aria-hidden />Hatalar ({data.errors.length})</p>
              <ul className="space-y-0.5 text-xs">
                {data.errors.map((e: string, i: number) => <li key={i}>• {e}</li>)}
              </ul>
            </div>
          )}

          {data.warnings.length > 0 && (
            <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
              <p className="text-xs font-semibold text-warning mb-1.5 flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />Uyarılar ({data.warnings.length})</p>
              <ul className="space-y-0.5 text-xs">
                {data.warnings.map((w: string, i: number) => <li key={i}>• {w}</li>)}
              </ul>
            </div>
          )}

          {data.recommendations.length > 0 && (
            <div className="rounded-md border border-info/30 bg-info/5 p-3">
              <p className="text-xs font-semibold text-info mb-1.5 flex items-center gap-1.5"><Lightbulb className="h-3.5 w-3.5" aria-hidden />Öneriler ({data.recommendations.length})</p>
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
      {/*
        Eski metin "GPTBot/ClaudeBot/PerplexityBot ziyaret ettiginde otomatik yakalanir, manuel log
        gerekmez" diyordu. Mekanizma (tracker.controller.ts + crawler-tracking.middleware.ts): bot
        betik dosyasini indirirse istek bot kimligiyle gelir ve kaydedilir; beacon yalniz betigi
        CALISTIRAN ziyaretcide atilir. Vercel, 17.12.2024: "none of the major AI crawlers currently
        render JavaScript"; ChatGPT ve Claude tarayicilari JS dosyasi indiriyor ama calistirmiyor —
        https://vercel.com/blog/the-rise-of-the-ai-crawler (haber: https://www.searchenginejournal.com/ai-crawlers)
      */}
      <p className="text-xs text-muted-foreground">
        Sitenizdeki <strong>her sayfaya</strong> bu script tag&apos;ini ekleyin. Bir bot betik dosyasını indirdiğinde ya da betiği çalıştırdığında kaydedilir; AI cevaplarından gelen ziyaretçiler de yakalanır. JavaScript çalıştırmayan ve betik dosyasını indirmeyen tarayıcılar bu yöntemle görünmez — Vercel&apos;in Aralık 2024 analizine göre büyük AI tarayıcıları JavaScript çalıştırmıyor; bu yüzden bu yöntem bot ziyaretlerinin yalnızca bir kısmını gösterebilir. Eksiksiz ölçüm sunucu ya da CDN kayıtlarıyla mümkündür.
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
        <pre className="p-3 text-label font-mono whitespace-pre-wrap break-all">{snippet}</pre>
      </div>

      <div className="rounded-md border bg-muted/20 p-3">
        <p className="text-xs font-semibold mb-2">Nereye yapıştır?</p>
        <ul className="space-y-1 text-xs text-muted-foreground">
          <li>• <strong>WordPress:</strong> Tema &gt; Theme File Editor &gt; header.php (&lt;/head&gt; tag'inden hemen önce)</li>
          <li>• <strong>Webflow:</strong> Project Settings &gt; Custom Code &gt; Head Code</li>
          <li>• <strong>cPanel/HTML:</strong> Her sayfanın &lt;head&gt; bölümüne ekleyin</li>
          <li>• <strong>Otopilot ON:</strong> RanksUp'ın yayınladığı yeni makalelere <strong>otomatik</strong> eklenir</li>
        </ul>
      </div>

      <div className="rounded-md border border-info/30 bg-info/5 p-3">
        <p className="text-xs">
          <BarChart3 className="inline h-3.5 w-3.5 mr-1 align-[-2px]" aria-hidden /><strong>Veri akışı:</strong> Tarayıcı tracker.js dosyasını indirdiğinde istek botun kimliğiyle (User-Agent) API&apos;ye gelir ve kaydedilir; betiği çalıştıran ziyaretçide ayrıca beacon.gif isteği atılır. Kayıtlar 60 saniyede bir veritabanına yazılır; <strong>AI Crawler Trafiği</strong> paneli bu verilerle dolar.
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
      {/*
        Eski metin "AI'lar (ozellikle ChatGPT ve Perplexity) Reddit'i birinci kaynak olarak
        kullaniyor" diyordu; iki bagimsiz kaynak bu kesinligi desteklemiyor (ChatGPT'de bazi
        veri setlerinde Wikipedia onde). Desteklenen ifade: Reddit en sik kaynak gosterilen
        alan adlari arasinda, oran platforma ve doneme gore degisiyor.
        - Peec AI, Mart 2026, ~30 milyon atif (ChatGPT, AI Mode, Gemini, Perplexity, AI Overviews):
          Reddit 1. — https://docs.peec.ai/research/most-cited-domains-in-ai-search
        - Evertune, Subat 2026, 200M+ istem: Perplexity atiflarinin bazi donemlerde ~1/5'i Reddit;
          ChatGPT'de incelenen dort alan arasinda Wikipedia onde —
          https://www.evertune.ai/resources/insights-on-ai/perplexity-loves-reddit-exploring-llms-top-sources
      */}
      <p className="text-xs text-muted-foreground">
        Bağımsız atıf analizleri Reddit&apos;i AI cevaplarında en sık kaynak gösterilen alan adları arasında buluyor; oran platforma ve döneme göre değişiyor. RanksUp sektör sorularınızla ilgili Reddit gönderilerini tarayıp marka sesinizde taslak yanıt önerir. Yanıtı yalnızca soruya gerçekten katkı sağlıyorsa ve topluluk kurallarına uyuyorsa paylaşın.
        <strong className="text-warning"> Manuel onay zorunlu</strong>, otomatik gönderi YOK.
      </p>
      <Button size="sm" onClick={find} disabled={loading}>
        {loading ? 'Reddit taranıyor (~30 sn)…' : <><Search className="h-3.5 w-3.5 mr-1.5" aria-hidden />Fırsat bul</>}
      </Button>
      {opportunities.length > 0 && (
        <div className="space-y-2">
          {opportunities.map((op, i) => (
            <div key={i} className="rounded-md border p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">{op.title}</p>
                  <p className="text-label text-muted-foreground mt-0.5">
                    r/{op.subreddit ?? 'unknown'} · {op.publishedAt ? new Date(op.publishedAt).toLocaleDateString('tr-TR') : ''}
                  </p>
                </div>
                <Badge variant={op.brandFitScore >= 70 ? 'default' : 'outline'}>{op.brandFitScore}/100 fit</Badge>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">{op.snippet}</p>
              <div className="rounded bg-muted/30 p-2 border-l-2 border-brand">
                <p className="text-label font-semibold text-muted-foreground mb-1">AI taslak yanıt:</p>
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
        RanksUp ekosistemindeki diğer sitelerle konuyla ilgili <strong>çapraz bağlantı</strong> önerir; okuyucuya ilgili içeriği sunar. AI asistanlarının bu bağlantıları nasıl değerlendireceği garanti edilmez. Sadece <strong>Otopilot ON</strong> olan siteler dahil edilir (onay).
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
                  <p className="text-label text-muted-foreground">
                    {s.toSiteName} · {s.insertionPoint}
                  </p>
                </div>
                <Badge>{s.relevanceScore}/100</Badge>
              </div>
              <p className="text-xs text-muted-foreground italic">"{s.contextSnippet}"</p>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => apply(s)} disabled={applying === s.toArticleId}>
                  {applying === s.toArticleId ? 'Uygulanıyor…' : <><Check className="h-3.5 w-3.5 mr-1.5" aria-hidden />Çapraz bağlantı ekle</>}
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
      {/*
        Eski metin kaynaksiz bir oran ("%30+") ve garanti ("Mistral, Llama, Claude markanizi
        ogrenir", "icerik silinse bile AI hatirlar") veriyordu. Hangi saglayicinin hangi acik
        veri setini ne zaman kullandigi aciklanmiyor; etki olculemez — vaat edilmez.
      */}
      <p className="text-xs text-muted-foreground">
        Makalelerinizi <strong>CC-BY-4.0</strong> lisansıyla Hugging Face&apos;te açık bir veri seti olarak yayımlayabilirsiniz.
        Açık veri setleri bazı modellerin eğitiminde kullanılabilir; ancak hangi sağlayıcının hangi veri setini ne zaman kullandığı açıklanmaz.
        Etkisi garanti değildir ve RanksUp bunu ölçemez.
      </p>
      {!data && (
        <Button size="sm" onClick={load} disabled={loading}>
          {loading ? 'Hazırlanıyor…' : <><Package className="h-3.5 w-3.5 mr-1.5" aria-hidden />Eğitim verisini hazırla</>}
        </Button>
      )}
      {data && (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-md border p-3 text-center">
              <p className="text-metric-lg tabular-nums">{data.records}</p>
              <p className="text-label text-muted-foreground">Kayıt</p>
            </div>
            <div className="rounded-md border p-3 text-center">
              <p className="text-metric-lg tabular-nums">{(data.bytes / 1024).toFixed(1)} <span className="text-sm text-muted-foreground">KB</span></p>
              <p className="text-label text-muted-foreground">Boyut</p>
            </div>
            <div className="rounded-md border p-3 text-center">
              <p className="text-sm font-bold">CC-BY-4.0</p>
              <p className="text-label text-muted-foreground">Lisans</p>
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
            <pre className="p-3 text-label font-mono whitespace-pre-wrap max-h-[300px] overflow-y-auto">{data.sample}</pre>
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
  const { blocked: measurementBlocked } = useMeasurementAllowance();
  const [data, setData] = useState<any>(null);

  const run = async () => {
    setRunning(true);
    try {
      const res = await api.runGeoHeatmap(siteId, 10);
      setData(res);
      toast.success(`Heatmap hazır: ${res.queries.length} sorgu × ${res.providers.length} AI`);
      refreshMeasurementAllowance();
    } catch (err: any) {
      if (isWeeklyMeasurementLimitError(err)) refreshMeasurementAllowance();
      toast.error(err.message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-muted-foreground max-w-2xl">
          Sektör sorgularını Claude/Gemini/ChatGPT/Perplexity'ye sorar. Her hücre: <span className="text-success font-bold">●</span> alıntılandın · <span className="text-warning font-bold">●</span> sadece marka adı geçti · <span className="text-danger font-bold">●</span> rakip alıntılandı · <span className="text-muted-foreground font-bold">●</span> kimse alıntılanmadı (fırsat) · <span className="text-muted-foreground">ölçülemedi</span> sağlayıcı hata verdi ya da etkin değil — skora ve önerilere girmez
        </p>
        <Button size="sm" onClick={run} disabled={running || measurementBlocked}>
          {running ? 'Test ediliyor (~60 sn)…' : <><Play className="h-3.5 w-3.5 mr-1.5" aria-hidden />Isı haritasını çalıştır</>}
        </Button>
      </div>
      <MeasurementLimitNote />

      {data && (
        <div className="space-y-3">
          {/* Provider skor ozeti — skor yalniz olculen hucrelerden; hic olculemeyen saglayici "—" (0 degil) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {data.providers.map((p: string, i: number) => {
              const pid = providerIdAt(data, i);
              const raw = data.scoreByProvider?.[pid];
              const score: number | null = typeof raw === 'number' ? raw : null;
              const color = score === null ? 'text-muted-foreground' : score >= 60 ? 'text-success' : score >= 30 ? 'text-warning' : 'text-danger';
              return (
                <div key={p} className="rounded-md border p-2 text-center">
                  <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground"><EngineLogo provider={pid} size={16} />{p}</p>
                  <p className={`text-metric-lg tabular-nums ${color}`}>{score ?? '—'}</p>
                  {score === null && <p className="text-label text-muted-foreground">ölçülemedi</p>}
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
                  {data.providers.map((p: string, i: number) => (
                    <th key={p} className="text-center p-2 font-medium border-b min-w-[80px]">
                      <span className="inline-flex items-center gap-1.5">
                        <EngineLogo provider={providerIdAt(data, i) || p} size={16} />
                        {p}
                      </span>
                    </th>
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
                      const pid = providerIdAt(data, i);
                      const cell = data.cells.find((c: any) => c.query === q && c.provider === pid);
                      // Hata / etkin olmayan saglayici olcum degildir: "kimse alintilanmadi" (gri) ile karismasin
                      const status: string = cell?.status ?? 'error';
                      const unmeasured = status === 'error' || status === 'disabled';
                      const bg = status === 'cited' ? 'bg-success/30 border-success'
                              : status === 'mentioned' ? 'bg-warning/30 border-warning'
                              : status === 'competitor' ? 'bg-danger/30 border-danger'
                              : unmeasured ? 'bg-background border-muted border-dashed'
                              : 'bg-muted/30 border-muted';
                      const icon = status === 'cited' ? '✓'
                              : status === 'mentioned' ? '~'
                              : status === 'competitor' ? `→${cell?.competitor?.slice(0, 12)}…`
                              : status === 'disabled' ? 'etkin değil'
                              : unmeasured ? 'ölçülemedi'
                              : '—';
                      return (
                        <td key={p} className={`p-2 text-center border ${bg}`} title={displayProbeText(cell?.excerpt)}>
                          <span className={unmeasured ? 'text-label text-muted-foreground' : 'font-bold text-label'}>{icon}</span>
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
          {(data.olculemeyenQueries?.length ?? 0) > 0 && (
            <p className="text-label text-muted-foreground">
              {data.olculemeyenQueries.length} sorgu hiçbir sağlayıcıda ölçülemedi (hata ya da boş cevap); skora ve yukarıdaki gruplara dahil edilmedi.
            </p>
          )}

          {/* Rakip kazanmalari */}
          {Object.keys(data.competitorWins).length > 0 && (
            <div className="rounded-md border p-3 bg-danger/5">
              <p className="flex items-center gap-1.5 text-xs font-semibold mb-2"><Trophy className="h-3.5 w-3.5" aria-hidden />Rakip kazanma sayıları</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.competitorWins).map(([host, wins]) => (
                  <Badge key={host} variant="outline" className="text-label">
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

/** Isi haritasi sutun kimligi: API providerIds dondurur; eski cevapta sabit sira (Claude, Gemini, ChatGPT, Perplexity) */
function providerIdAt(data: any, i: number): string {
  return data?.providerIds?.[i] ?? ['anthropic', 'gemini', 'openai', 'perplexity'][i] ?? '';
}

function InsightBlock({ title, items, color }: { title: string; items: string[]; color: 'green' | 'red' | 'muted' }) {
  const bg = color === 'green' ? 'bg-success/10 border-success/30'
          : color === 'red' ? 'bg-danger/10 border-danger/30'
          : 'bg-muted/30 border-muted';
  return (
    <div className={`rounded-md border p-3 ${bg}`}>
      <p className="text-xs font-semibold mb-1.5">{title}</p>
      {items.length === 0 ? (
        <p className="text-label text-muted-foreground italic">—</p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((q, i) => (
            <li key={i} className="text-label truncate">• {q}</li>
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
      {/*
        Eski metin "Wikidata = Google Knowledge Graph'in kaynagi ... AI'lar (ozellikle Gemini ve
        Bard) sizi otomatik tanir" diyordu: Wikidata bilgi grafiklerinin kaynaklarindan yalnizca
        biri, Bard adi 8 Subat 2024'te Gemini oldu (https://blog.google/products/gemini/bard-gemini-advanced-app/)
        ve "otomatik tanima" vaat edilemez.
      */}
      <p className="text-xs text-muted-foreground">
        Wikidata, herkesin düzenleyebildiği açık bir bilgi tabanıdır; arama motorları ve AI sistemleri bu tür yapılandırılmış kaynaklardan yararlanabilir. Bir öğe eklemek, AI asistanlarının markanızı tanıyacağını garanti etmez ve Wikidata&apos;nın kayda değerlik kuralları uygulanır. Aşağıdaki taslağı kopyalayın → &quot;Wikidata&apos;da yeni öğe oluştur&quot; bağlantısıyla elle girin.
      </p>
      {!data && (
        <Button size="sm" onClick={load} disabled={loading}>
          {loading ? 'Hazırlanıyor…' : <><FileText className="h-3.5 w-3.5 mr-1.5" aria-hidden />Wikidata taslağı hazırla</>}
        </Button>
      )}
      {data && (
        <div className="space-y-3">
          {/*
            Eski baslik "Notability Skoru · x/100" idi: puan Wikidata'nin kayda degerlik
            olcutu degil, RanksUp'in gorebildigi sinyallerden (site, rakip listesi, SEO
            stratejisi, ana sayfadaki Organization sameAs baglantilari) en fazla notabilityMax (50) uretir — "site yasi"
            sinyali kaldirildi, cunku site.createdAt sitenin RanksUp'a eklenme tarihiydi
            (knowledge-graph-builder.service.ts checkNotability / NOTABILITY_MAX).
          */}
          <div className="rounded-md border p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold">RanksUp ön kontrol puanı</p>
              <NotabilityScore data={data} large />
            </div>
            <p className="text-label text-muted-foreground mb-2">Site, RanksUp&apos;taki rakip listesi ve SEO stratejisi, ana sayfanızdaki kimlik bağlantıları (Organization sameAs) üzerinden hesaplanır. Wikidata&apos;nın kayda değerlik ölçütünü (ciddi ve herkese açık kaynaklarla tanımlanabilir olma) ölçmez; kaynakları kendiniz doğrulayın.</p>
            <ul className="space-y-1 text-xs">
              {data.notabilityNotes.map((n: string, i: number) => (
                <li key={i} className="flex items-start gap-1.5">
                  {n.startsWith('✓') ? <Check className="h-3 w-3 text-success mt-0.5 shrink-0" /> :
                   n.startsWith('⚠') ? <AlertCircle className="h-3 w-3 text-warning mt-0.5 shrink-0" /> :
                   <X className="h-3 w-3 text-danger mt-0.5 shrink-0" />}
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
                  <Badge variant="outline" className="text-label shrink-0">{c.valueType}</Badge>
                </div>
              ))}
            </div>
          </div>

          {/*
            "Otomatik gönder (bot)" dugmesi kaldirildi: RanksUp Wikidata'ya musteri adina
            oge gondermez (knowledge-submitter.service.ts — bot hesabinin sorumlulugu
            operatordedir); knowledge/submit her zaman elle ekleme yonergesi donuyordu,
            dugme yalniz uyari gosteriyordu. Ekleme musterinin kendi hesabiyla, elle.
          */}
          <div className="flex items-center gap-3 flex-wrap">
            <a href={data.createUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-sm text-brand hover:underline">
              <Globe className="h-3.5 w-3.5" aria-hidden /> Elle: Wikidata&apos;da yeni öğe oluştur <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
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
      {/*
        Eski metin kaynaksiz "%30+" oran ve "LLM'ler bir sonraki egitiminde sizi ogrenir"
        garantisi veriyordu (Egitim verisi sekmesinden kaldirilan vaadin aynisi). Egitim karisimini
        yayimlayan modellerde Wikipedia payi birkac yuzde:
        - GPT-3 (Brown vd., 2020) Tablo 2.2: egitim karisiminda %3 — https://arxiv.org/abs/2005.14165
        - LLaMA (Touvron vd., 2023) Tablo 1: ornekleme orani %4,5 — https://arxiv.org/abs/2302.13971
        Bir maddenin hangi modelin egitimine ne zaman girecegi aciklanmaz; etki olculemez.

        "Taslagi kopyalayin → Wikipedia'ya gonderin" kendi markasi hakkinda madde
        acmayi ozendiriyordu. Vikipedi kurallari (18.10.2026 dogrulandi):
        - Cikar catismasi (Vikipedi:Cikar_catismasi):
          https://tr.wikipedia.org/wiki/Vikipedi:%C3%87%C4%B1kar_%C3%A7at%C4%B1%C5%9Fmas%C4%B1
          "Genellikle kendiniz veya tanidiginiz herhangi birisi hakkinda maddeler
          olusturmaktan kacinmalisiniz." / "Tartisma sayfalarina bir not birakarak
          yapmak istediginiz degisiklikleri onerebilirsiniz."; ucretli katkida kimin
          odedigi ve kimin adina duzenlendigi beyan edilir (Wikimedia Kullanim
          Kosullari md. 4: https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use).
        - Kayda degerlik (Vikipedi:Kayda_degerlik):
          https://tr.wikipedia.org/wiki/Vikipedi:Kayda_de%C4%9Ferlik
          "Bir konu kendisinden bagimsiz, kapsamli, guvenilir, birden cok ikincil
          kaynaklarca icerik edilmisse kayda degerdir."
        notabilityScore Vikipedi olcutu DEGIL: knowledge-graph-builder.service.ts
        checkNotability RanksUp verisinden (site, rakip listesi, SEO stratejisi,
        ana sayfadaki Organization sameAs) en cok notabilityMax (50) puan uretir. "Sitenin RanksUp'a
        eklenme tarihi" sinyali kaldirildi: site yasi diye puanlaniyordu.
      */}
      <p className="text-xs text-muted-foreground">
        Wikipedia, eğitim veri karışımını yayımlayan bazı dil modellerinin eğitim verisinde yer alır (ör. GPT-3 ve LLaMA makalelerinde birkaç yüzdelik pay). Ancak bir maddenin hangi modelin eğitimine ne zaman gireceği açıklanmaz; etkisi garanti değildir ve RanksUp bunu ölçemez.
        Vikipedi&apos;ye göre bir konu, kendisinden bağımsız, güvenilir ve birden çok ikincil kaynakta kapsamlı yer alıyorsa kayda değerdir.
        Kendi markan hakkında madde açmak Vikipedi&apos;nin çıkar çatışması yönergesine göre önerilmez: bağlantını açıkça belirtmen gerekir, değişiklikleri maddenin tartışma sayfasından önerebilirsin; ücretli katkılarda kimin adına düzenleme yaptığını beyan etmek zorunludur.
        Aşağıdaki taslak bu süreçte kullanabileceğin bir başlangıç metnidir.
      </p>
      {!data && (
        <Button size="sm" onClick={load} disabled={loading}>
          {loading ? 'AI hazırlıyor (~30 sn)…' : <><FileText className="h-3.5 w-3.5 mr-1.5" aria-hidden />Wikipedia madde taslağı hazırla</>}
        </Button>
      )}
      {data && (
        <div className="space-y-3">
          <div className="rounded-md border p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold">{data.title}</p>
              <NotabilityScore data={data} />
            </div>
            <p className="text-label text-muted-foreground">RanksUp ön kontrol puanı: site, RanksUp&apos;taki rakip listesi ve SEO stratejisi, ana sayfanızdaki kimlik bağlantıları (Organization sameAs) üzerinden hesaplanır. Vikipedi&apos;nin kayda değerlik ölçütünü (bağımsız kaynaklarda yer alma) ölçmez.</p>
          </div>

          <div className="rounded-md border">
            <div className="px-3 py-2 border-b bg-muted/30 flex items-center justify-between">
              <p className="text-xs font-semibold">Wikitext (kopyala → Wikipedia editörüne yapıştır)</p>
              <button onClick={() => copy(data.content)} className="text-xs text-brand hover:underline inline-flex items-center gap-1">
                <Copy className="h-3 w-3" /> Kopyala
              </button>
            </div>
            <pre className="p-3 text-label font-mono whitespace-pre-wrap max-h-[400px] overflow-y-auto">{data.content}</pre>
          </div>

          <p className="text-label text-muted-foreground">
            <Tags className="inline h-3.5 w-3.5 mr-1 align-[-2px]" aria-hidden />Kategoriler: {data.category.join(', ')}
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * RanksUp on kontrol puani "puan/tavan". Tavan API'den (notabilityMax = 50);
 * eski cevapta yoksa 100. Renk orana gore: puan 100'e olceklenmez, cunku kalan
 * kisim (bagimsiz kaynaklar) RanksUp'in olcemedigi, elle dogrulanacak kisimdir.
 */
function NotabilityScore({ data, large = false }: { data: { notabilityScore?: unknown; notabilityMax?: unknown }; large?: boolean }) {
  const max = typeof data.notabilityMax === 'number' && data.notabilityMax > 0 ? data.notabilityMax : 100;
  const score = typeof data.notabilityScore === 'number' ? data.notabilityScore : 0;
  const ratio = score / max;
  const tone = ratio >= 0.8 ? 'text-success' : ratio >= 0.4 ? 'text-warning' : 'text-danger';
  return <span className={`${large ? 'text-metric-lg' : 'text-metric'} tabular-nums ${tone}`}>{score}/{max}</span>;
}

function Field({ label, value, onCopy }: { label: string; value: string; onCopy: (text: string) => void }) {
  return (
    <div className="rounded-md border px-3 py-2 flex items-center gap-2">
      <span className="text-label text-muted-foreground font-medium min-w-[120px]">{label}</span>
      <span className="flex-1 text-sm">{value}</span>
      <button onClick={() => onCopy(value)} className="text-xs text-brand hover:underline">
        <Copy className="h-3 w-3" />
      </button>
    </div>
  );
}
