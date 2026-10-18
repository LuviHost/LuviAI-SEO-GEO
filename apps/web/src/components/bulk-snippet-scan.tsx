'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { api, type BulkScanPage, type BulkScanResult } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  Globe,
  Search,
  CheckCircle2,
  XCircle,
  Sparkles,
  RefreshCw,
  ShieldAlert,
  FileX,
} from 'lucide-react';

/**
 * Skoru olculmeyen satirlar ortalamaya ve "Sorunlu"ya girmez:
 *   blocked → "Erisilemedi" (WAF / bot dogrulamasi)
 *   failed  → "Okunamadi" (sayfa indirilemedi; neden failReason'da)
 * Tipler lib/api.ts'te (snippet-generator.service.ts bulkScan ile ayni sekil).
 */
type ScanRow = BulkScanPage;
type ScanResult = BulkScanResult;

/** Engel sayisi: yeni API blockedPages doner; eski cevapta satirlardan sayilir */
function blockedCount(r: ScanResult): number {
  return typeof r.blockedPages === 'number' ? r.blockedPages : r.pages.filter((p) => p.blocked).length;
}

/**
 * Okunamayan sayfa sayisi SATIRLARDAN sayilir (failedPages'e bakilmaz): engelli bir satir
 * ayrica failed tasisa bile yalniz "Erisilemedi" olarak bir kez sayilmali; tum satirlar
 * cevapta oldugu icin bu sayim her zaman kesin. Eski API failed dondurmez → 0.
 */
function failedCount(r: ScanResult): number {
  return r.pages.filter((p) => !p.blocked && p.failed === true).length;
}

/** Skoru olculmedi mi (engel ya da okuma hatasi) */
function unmeasured(p: ScanRow): boolean {
  return !!p.blocked || p.failed === true;
}

/**
 * Bulk scan UI — root URL gir → tüm alt sayfaları crawl et → SEO durumu tablosu.
 * AI çağrısı yok, sadece HTML parse. Tablodan tek tek "Üret" tıklanır → SnippetPanel'e atlar.
 */
export function BulkSnippetScan({
  siteId,
  defaultUrl,
  onPickUrl,
}: {
  siteId: string;
  defaultUrl?: string;
  onPickUrl: (url: string) => void;
}) {
  const [rootUrl, setRootUrl] = useState(defaultUrl ?? '');
  const [maxPages, setMaxPages] = useState(30);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);

  const scan = async () => {
    setLoading(true);
    try {
      const r = await api.bulkScanSnippets(siteId, rootUrl || undefined, maxPages);
      setResult(r);
      const blocked = blockedCount(r);
      const failed = failedCount(r);
      const read = r.totalScanned - blocked - failed;
      const skipped = [
        blocked > 0 ? `${blocked} sayfa erişim engeline takıldı` : null,
        failed > 0 ? `${failed} sayfa okunamadı` : null,
      ].filter(Boolean).join(', ');
      if (r.totalScanned > 0 && read <= 0) {
        // Hicbir sayfa okunamadiysa ortalama yok — "ortalama 0" siteyi bozuk gosterirdi
        toast.warning(`${r.totalScanned} sayfa tarandı ama hiçbiri okunamadı; ortalama skor hesaplanmadı.`, { duration: 10000 });
      } else {
        toast.success(
          skipped
            ? `${r.totalScanned} sayfa tarandı; ${skipped}. Okunan ${read} sayfanın ortalama skoru ${r.averageScore}.`
            : `${r.totalScanned} sayfa tarandı, ortalama skor ${r.averageScore}`,
        );
      }
    } catch (err: any) {
      // Sayfalarin hepsi engelliyse API 400 + neden doner (ApiError.message = sunucu metni)
      toast.error(err.message || 'Tarama başarısız', { duration: 10000 });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div>
          <h3 className="font-semibold text-base inline-flex items-center gap-2">
            <Globe className="h-4 w-4 text-muted-foreground" /> Toplu Sayfa Tarama
          </h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            Site adresini gir → tüm alt sayfalar otomatik taranır → her birinin Title, Meta, OG, Twitter, Schema durumu tablo olarak çıkar.
            Tek tıkla istediğin sayfaya odaklanıp AI ile snippet üretirsin. <strong>Ücretsiz</strong> (AI çağrısı yapmaz).
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Input
            type="url"
            value={rootUrl}
            onChange={(e) => setRootUrl(e.target.value)}
            placeholder="https://senin-sitendin.com (boş bırakırsan site URL'in alınır)"
            className="flex-1 min-w-[280px]"
          />
          <select
            value={maxPages}
            onChange={(e) => setMaxPages(parseInt(e.target.value, 10))}
            className="rounded-md border bg-card px-2 py-2 text-sm"
            disabled={loading}
          >
            <option value={10}>10 sayfa</option>
            <option value={30}>30 sayfa</option>
            <option value={50}>50 sayfa</option>
          </select>
          <Button onClick={scan} disabled={loading}>
            {loading ? (
              <><RefreshCw className="h-4 w-4 mr-1 animate-spin" /> Taranıyor…</>
            ) : (
              <><Search className="h-4 w-4 mr-1" /> Toplu Tara</>
            )}
          </Button>
        </div>

        {/* Loading skeleton */}
        {loading && !result && (
          <div className="space-y-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        )}

        {/* Summary band — engelli / okunamayan sayfa ne ortalamaya ne "Sorunlu"ya girer (skoru olculmedi) */}
        {result && (() => {
          const blocked = blockedCount(result);
          const failed = failedCount(result);
          const read = Math.max(0, result.totalScanned - blocked - failed);
          const chips = 3 + (blocked > 0 ? 1 : 0) + (failed > 0 ? 1 : 0);
          const skipped = [
            blocked > 0 ? `${blocked} sayfa erişim engeline takıldı (güvenlik duvarı, bot doğrulaması, hız sınırı gibi)` : null,
            failed > 0 ? `${failed} sayfa okunamadı` : null,
          ].filter(Boolean).join('; ');
          return (
            <div className="space-y-2">
              <div className={cn('grid gap-2', chips === 3 ? 'grid-cols-3' : chips === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-5')}>
                <SummaryChip label="Taranan" value={result.totalScanned} accent="brand" />
                <SummaryChip
                  label="Ort. Skor"
                  // Okunan sayfa yoksa ortalama YOK: "0/100" siteyi bozuk gosterirdi
                  value={read > 0 ? `${result.averageScore}/100` : '—'}
                  accent={read === 0 ? 'muted' : result.averageScore >= 70 ? 'emerald' : result.averageScore >= 40 ? 'amber' : 'rose'}
                  hint={read > 0 ? `okunan ${read} sayfa` : 'okunan sayfa yok'}
                />
                <SummaryChip label="Sorunlu" value={result.pages.filter((p) => !unmeasured(p) && p.score < 60).length} accent="rose" />
                {blocked > 0 && <SummaryChip label="Erişilemedi" value={blocked} accent="muted" />}
                {failed > 0 && <SummaryChip label="Okunamadı" value={failed} accent="muted" />}
              </div>
              {skipped && (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <ShieldAlert className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden />
                  <span>
                    {skipped}; bu sayfaların skoru ölçülmedi.
                    Ortalama yalnız okunan {read} sayfayı kapsar; ölçülmeyen sayfalar &quot;Sorunlu&quot; sayısına dahil değil.
                  </span>
                </p>
              )}
            </div>
          );
        })()}

        {/* Tablo */}
        {result && result.pages.length > 0 && (
          <div className="rounded-lg border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/30 text-muted-foreground border-b">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium w-[35%]">URL</th>
                    <th className="text-left px-3 py-2 font-medium">Skor</th>
                    <th className="text-left px-3 py-2 font-medium">Title</th>
                    <th className="text-left px-3 py-2 font-medium">Meta</th>
                    <th className="text-center px-2 py-2 font-medium">OG</th>
                    <th className="text-center px-2 py-2 font-medium">TW</th>
                    <th className="text-center px-2 py-2 font-medium">Schema</th>
                    <th className="text-center px-2 py-2 font-medium">FAQ</th>
                    <th className="text-right px-3 py-2 font-medium">Aksiyon</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {[...result.pages]
                    // Olculmeyen sayfa skoru 0 diye en uste cikmasin: engelli / okunamayan satirlar en sonda
                    .sort((a, b) => Number(unmeasured(a)) - Number(unmeasured(b)) || a.score - b.score)
                    .map((row) => unmeasured(row) ? (
                      <UnmeasuredRow key={row.url} row={row} />
                    ) : (
                      <tr key={row.url} className="hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-2 font-mono text-[11px] truncate max-w-[260px]" title={row.url}>
                          {row.url.replace(/^https?:\/\//, '')}
                        </td>
                        <td className="px-3 py-2">
                          <ScorePill score={row.score} />
                        </td>
                        <td className="px-3 py-2">
                          <TitleStatus row={row} />
                        </td>
                        <td className="px-3 py-2">
                          <MetaStatus row={row} />
                        </td>
                        <td className="px-2 py-2 text-center"><BoolDot ok={row.hasOG} /></td>
                        <td className="px-2 py-2 text-center"><BoolDot ok={row.hasTwitter} /></td>
                        <td className="px-2 py-2 text-center"><BoolDot ok={row.hasSchema} /></td>
                        <td className="px-2 py-2 text-center"><BoolDot ok={row.hasFAQ} muted /></td>
                        <td className="px-3 py-2 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onPickUrl(row.url)}
                            className="h-7 text-[11px]"
                          >
                            <Sparkles className="h-3 w-3 mr-1 text-brand" /> Üret
                          </Button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {result && result.pages.length === 0 && (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm text-muted-foreground">Hiç sayfa bulunamadı. URL'i kontrol et.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Skoru olculmeyen satir. Engel → "Erisilemedi" (nedeni issues[0]); okuma hatasi →
 * "Okunamadi" (nedeni failReason, yoksa issues[0]). Snippet uretimi kapali: okunamayan
 * sayfanin yerine uretilecek meta/SSS dayanaksiz olurdu.
 */
function UnmeasuredRow({ row }: { row: ScanRow }) {
  const blocked = !!row.blocked;
  const reason = blocked ? row.issues?.[0] : (row.failReason ?? row.issues?.[0]);
  const Icon = blocked ? ShieldAlert : FileX;
  return (
    <tr className="bg-muted/10">
      <td className="px-3 py-2 font-mono text-label truncate max-w-[260px]" title={row.url}>
        {row.url.replace(/^https?:\/\//, '')}
      </td>
      <td className="px-3 py-2" colSpan={7}>
        <span className="inline-flex items-center gap-1 text-label font-semibold text-muted-foreground" title={reason || undefined}>
          <Icon className="h-3 w-3" aria-hidden /> {blocked ? 'Erişilemedi' : 'Okunamadı'}
        </span>
        {reason && <span className="ml-2 text-label text-muted-foreground">{reason}</span>}
      </td>
      <td className="px-3 py-2 text-right">
        <Button size="sm" variant="outline" disabled className="h-7 text-label" title="Sayfa okunamadığı için snippet üretilemez">
          <Sparkles className="h-3 w-3 mr-1 text-brand" /> Üret
        </Button>
      </td>
    </tr>
  );
}

function SummaryChip({ label, value, accent, hint }: { label: string; value: string | number; accent: string; hint?: string }) {
  const colors: Record<string, string> = {
    brand: 'border-brand/30 bg-brand/5 text-brand',
    muted: 'border-border bg-muted/40 text-muted-foreground',
    emerald: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400',
    amber: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-400',
    rose: 'border-rose-500/30 bg-rose-500/5 text-rose-700 dark:text-rose-400',
  };
  return (
    <div className={cn('rounded-lg border px-3 py-2', colors[accent])}>
      <div className="text-label font-semibold opacity-80">{label}</div>
      <div className="text-xl font-bold tabular-nums leading-tight mt-0.5">{value}</div>
      {hint && <div className="text-label opacity-80 mt-0.5">{hint}</div>}
    </div>
  );
}

function ScorePill({ score }: { score: number }) {
  const color =
    score >= 70 ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30' :
    score >= 40 ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30' :
    'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30';
  return (
    <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-bold tabular-nums', color)}>
      {score}
    </span>
  );
}

function TitleStatus({ row }: { row: ScanRow }) {
  if (!row.title) return <span className="text-rose-500 inline-flex items-center gap-0.5"><XCircle className="h-3 w-3" /> yok</span>;
  const ok = row.titleLength >= 20 && row.titleLength <= 65;
  return (
    <span className={cn('text-[10px] font-mono', ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
      {row.titleLength}ch {ok ? '✓' : '⚠'}
    </span>
  );
}

function MetaStatus({ row }: { row: ScanRow }) {
  if (!row.metaDescription) return <span className="text-rose-500 inline-flex items-center gap-0.5"><XCircle className="h-3 w-3" /> yok</span>;
  const ok = row.metaDescriptionLength >= 140 && row.metaDescriptionLength <= 160;
  return (
    <span className={cn('text-[10px] font-mono', ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
      {row.metaDescriptionLength}ch {ok ? '✓' : '⚠'}
    </span>
  );
}

function BoolDot({ ok, muted = false }: { ok: boolean; muted?: boolean }) {
  if (ok) return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mx-auto" />;
  return muted
    ? <span className="text-muted-foreground/40">—</span>
    : <XCircle className="h-3.5 w-3.5 text-rose-400 mx-auto" />;
}
