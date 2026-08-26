'use client';

import { useEffect, useRef, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Sparkles, Upload, Copy, ExternalLink, Info } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

/**
 * Google AI yüzeyi — AI Overviews / AI Mode.
 *
 * Google bu veriyi API ile VERMİYOR; tek yol Search Console'daki "Üretken AI"
 * raporunun CSV export'u. Kullanıcı dosyayı yükler → önizleme (yanlış dosya
 * koruması) → içe aktar → grafik. Yanında: AI-Mode-şüpheli sorgular
 * (sezgisel) ve Preferred Sources rehberi (enjeksiyon yok, kopyala-yapıştır).
 */

const MAX_CSV_BYTES = 200_000; // Nest JSON body limiti (100 KB) + tarih tablosu birkaç KB — büyük dosya = yanlış tablo

const SIGNAL_LABEL: Record<string, string> = {
  'question': 'soru',
  'long-tail': 'uzun kuyruk',
  'zero-click-ranked': 'iyi sırada, tıklanmıyor',
  'comparison': 'karşılaştırma',
};

export function GoogleAiSurfaceCard({ siteId, site }: { siteId: string; site?: any }) {
  const [series, setSeries] = useState<any>(null);
  const [aiMode, setAiMode] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [csvText, setCsvText] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    const [s, m] = await Promise.all([
      api.getGscAiSeries(siteId, 90).catch(() => null),
      api.getAiModeQueries(siteId, 28).catch(() => null),
    ]);
    setSeries(s);
    setAiMode(m);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [siteId]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_CSV_BYTES) {
      toast.error('Dosya çok büyük — Üretken AI raporunun TARİH tablosunu (Dates.csv) yükleyin, sayfa tablosunu değil.');
      return;
    }
    const text = await file.text();
    setCsvText(text);
    setFileName(file.name);
    setBusy(true);
    try {
      const p = await api.previewGscAiCsv(siteId, text);
      setPreview(p);
    } catch (err: any) {
      setPreview(null);
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    setBusy(true);
    try {
      const r = await api.importGscAiCsv(siteId, csvText, fileName);
      toast.success(`${r.saved} gün içe aktarıldı (${r.from} → ${r.to})`);
      setPreview(null); setCsvText(''); setFileName('');
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const host = (() => {
    try { return new URL(site?.url ?? '').hostname.replace(/^www\./, ''); } catch { return ''; }
  })();
  const lang = site?.language === 'en' ? 'en' : 'tr';
  const snippet = `<script async src="https://news.google.com/swg/js/v1/publisher.js"></script>\n<div google-add-preferred-source-btn data-lang="${lang}"></div>`;
  const deepLink = host ? `https://www.google.com/preferences/source?q=${host}` : 'https://www.google.com/preferences/source';
  const copy = (text: string) => navigator.clipboard.writeText(text).then(() => toast.success('Kopyalandı'), () => toast.error('Kopyalanamadı'));

  const hasSeries = Array.isArray(series?.series) && series.series.length > 0;

  return (
    <div className="space-y-6">
      {/* ── AIO / AI Mode gösterimleri ── */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 flex-wrap">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-orange-500" /> Google üretken AI görünümleri (AI Overviews + AI Mode)
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
              Google bu veriyi API ile vermiyor. Search Console → Performans → <strong>Üretken AI</strong> raporu → Dışa aktar → <strong>tarih tablosu (CSV)</strong> dosyasını yükle. Yalnız gösterim gelir; AI Overviews / AI Mode ayrımı yok.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload className="h-3.5 w-3.5 mr-1.5" /> CSV yükle
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {preview && (
            <div className="mb-4 rounded-lg border p-3 text-sm space-y-1.5 bg-muted/30">
              <div className="font-medium">Önizleme — {fileName}</div>
              <div className="text-xs text-muted-foreground">
                {preview.rows} gün · {preview.from} → {preview.to} · toplam {preview.totalImpressions.toLocaleString('tr-TR')} gösterim
                · kolon: {Object.entries(preview.mapping ?? {}).map(([k, v]) => `${k}=${v}`).join(', ')}
              </div>
              {preview.suspiciousNote && (
                <div className="text-xs text-amber-700 dark:text-amber-300 flex items-start gap-1.5"><Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />{preview.suspiciousNote}</div>
              )}
              {preview.warnings?.length > 0 && (
                <div className="text-xs text-muted-foreground">Uyarılar: {preview.warnings.slice(0, 3).join(' · ')}</div>
              )}
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={doImport} disabled={busy}>İçe aktar</Button>
                <Button size="sm" variant="ghost" onClick={() => { setPreview(null); setCsvText(''); if (fileRef.current) fileRef.current.value = ''; }}>Vazgeç</Button>
              </div>
            </div>
          )}

          {hasSeries ? (
            <>
              <div className="flex items-baseline gap-4 mb-3 flex-wrap">
                <div>
                  <div className="text-2xl font-bold tabular-nums">{series.totals.last28.toLocaleString('tr-TR')}</div>
                  <div className="text-[11px] text-muted-foreground">son 28 gün AI gösterimi</div>
                </div>
                {series.totals.deltaPct !== null && (
                  <Badge variant={series.totals.deltaPct >= 0 ? 'success' : 'warning'}>{series.totals.deltaPct >= 0 ? '+' : ''}{series.totals.deltaPct}% önceki 28 güne göre</Badge>
                )}
                {series.lastImportAt && <span className="text-[11px] text-muted-foreground">son yükleme {new Date(series.lastImportAt).toLocaleDateString('tr-TR')}</span>}
              </div>
              <div className="h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series.series}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8 }} />
                    <Line type="monotone" dataKey="impressions" stroke="#f97316" strokeWidth={2} name="AI gösterimi" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </>
          ) : (
            <div className="text-sm text-muted-foreground py-6 text-center">
              Henüz veri yok. Rapor Google tarafında kademeli açılıyor — hesabında henüz görünmüyorsa birkaç hafta sonra tekrar bak.
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── AI-Mode şüpheli sorgular ── */}
      {aiMode && aiMode.summary?.total > 0 && (
        <Card>
          <CardHeader>
            <h3 className="font-semibold">AI Mode'dan gelmiş olabilecek sorgular <span className="text-xs font-normal text-muted-foreground">(sezgisel tahmin · son {aiMode.days} gün)</span></h3>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
              {aiMode.summary.likely}/{aiMode.summary.total} sorgu (%{aiMode.summary.sharePct}) soru kalıbı + uzun kuyruk ya da "iyi sırada ama tıklanmıyor" deseni taşıyor. {aiMode.note}
            </p>
          </CardHeader>
          <CardContent className="p-0">
            {aiMode.queries.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Bu dönemde deseni taşıyan sorgu yok.</div>
            ) : (
              <div className="divide-y">
                {aiMode.queries.slice(0, 20).map((q: any, i: number) => (
                  <div key={i} className="px-5 py-2.5 text-sm flex items-center justify-between gap-3 flex-wrap">
                    <span className="font-medium min-w-0 truncate">{q.query}</span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {q.signals.map((sg: string) => <Badge key={sg} variant="secondary" className="text-[10px]">{SIGNAL_LABEL[sg] ?? sg}</Badge>)}
                      <span className="text-[11px] text-muted-foreground tabular-nums">{q.impressions} göst · {q.clicks} tık{q.position !== null ? ` · poz ${q.position}` : ''}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Preferred Sources rehberi (enjeksiyon yok — kopyala-yapıştır) ── */}
      <Card>
        <CardHeader>
          <h3 className="font-semibold">Google "Tercih Edilen Kaynak" butonu</h3>
          <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
            Okuyucular seni <em>tercih edilen kaynak</em> olarak seçerse Google Top Stories'te öne çıkarsın ve AI Overviews / AI Mode'da "tercih edilen" rozeti alabilirsin (600 bin+ kaynak seçildi). Butonu site chrome'una (başlık/altbilgi, takip modülü) koy — makale gövdesine değil.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-xs text-muted-foreground flex items-start gap-1.5">
            <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>Uygunluk: yalnız alan adı / alt alan adı seviyesinde (alt dizin olmaz) ve sitenin Google'ın kaynak aracında listelenmiş olması gerekir. Buton görünmüyorsa siten henüz listelenmemiş olabilir — o zaman alttaki bağlantıyı kullan.</span>
          </div>
          <pre className="text-[11px] rounded-md border bg-muted/40 p-3 overflow-x-auto whitespace-pre">{snippet}</pre>
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={() => copy(snippet)}><Copy className="h-3.5 w-3.5 mr-1.5" /> Kodu kopyala</Button>
            <Button size="sm" variant="outline" onClick={() => copy(deepLink)}><Copy className="h-3.5 w-3.5 mr-1.5" /> Bağlantıyı kopyala</Button>
            <a href={deepLink} target="_blank" rel="noreferrer" className="text-xs underline text-brand inline-flex items-center gap-1">{deepLink} <ExternalLink className="h-3 w-3" /></a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
