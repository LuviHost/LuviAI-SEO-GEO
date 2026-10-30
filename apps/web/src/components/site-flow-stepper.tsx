'use client';

import { siteHref } from '@/lib/site-routes';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  CheckCircle2, Circle, ExternalLink, Plus, Trash2,
  Sparkles, FileText, Zap, Plug, OctagonAlert, Eye, Download, Copy, Info,
} from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  aiCardView, aiCitationOf, aiCitationSkipLabel, aiMeasuredAtLabel, api, autoFixIssues, autoFixMessages, geoAccessOf, geoSampleNote, isRobotsFixKey,
  isUnverifiedCheck, rootFileTarget,
} from '@/lib/api';
// robots.txt yalniz onizleme + acik onayla yazilir (API 'preview_required'); ayni diyalog Ajan Hazirligi sayfasinda da
import { AutoFixPreviewDialog } from '@/app/(dashboard)/sites/[id]/agent-readiness/auto-fix-preview-dialog';
import { autoFixNotices } from '@/lib/auto-fix-notices';
import { showNotice } from '@/lib/notice';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { PipelineProgress, PIPELINE_STEPS } from '@/components/pipeline-progress';
import { EngineLogo } from '@/components/engine-logo';
import { SiteFavicon } from '@/components/site-favicon';
import { PROVIDER_LABELS } from '@/lib/chart-colors';
import { displayProbeText } from '@/lib/probe-error-text';
import { CrawlAccessNotice } from '@/components/crawl-access-notice';
import { currentCrawlAccess } from '@/lib/crawl-access';
import { AUDIT_PENDING_DESC, AUDIT_PENDING_TITLE, runQueuedAudit } from '@/lib/audit-run';

/*
 * Bu dosyada yalniz baska sayfalarin kullandigi govdeler kalir: AuditStepBody
 * (Site Skoru), SnippetPanel ve CompetitorsStepBody. Eski adim akisi
 * (SiteFlowStepper) ve yalniz onun kullandigi govdeler (GSC/GA4, konu
 * onerileri, makaleler, icerik takvimi, AI citation paneli) hicbir yerden
 * ice aktarilmiyordu; kaldirildi.
 */

// ──────────────────────────────────────────────────────────────────────
// Step 1 — Site Skoru
// ──────────────────────────────────────────────────────────────────────
// Auto-fix dosyalarının kök URL haritası (well-known paths)
const AUTOFIX_PUBLIC_PATH: Record<string, string> = {
  sitemap: 'sitemap.xml',
  sitemap_xml: 'sitemap.xml',
  robots: 'robots.txt',
  robots_txt: 'robots.txt',
  llms: 'llms.txt',
  llms_txt: 'llms.txt',
};

const AUTOFIX_LABEL: Record<string, string> = {
  sitemap: 'Sitemap',
  sitemap_xml: 'Sitemap',
  robots: 'Robots.txt',
  robots_txt: 'Robots.txt',
  llms: 'llms.txt',
  llms_txt: 'llms.txt',
};

function publicUrlForFix(siteUrl: string | undefined, fix: string): string | null {
  const path = AUTOFIX_PUBLIC_PATH[fix];
  if (!path || !siteUrl) return null;
  try {
    const u = new URL(siteUrl);
    return `${u.protocol}//${u.host}/${path}`;
  } catch {
    return null;
  }
}

export function AuditStepBody({
  audit, siteId, onRefresh, onboardingMode, afterSummary, hideRefresh, crawlAccess,
}: {
  audit: any;
  siteId: string;
  onRefresh: () => void;
  onboardingMode?: boolean;
  /** Skor + otomatik düzelt satırından HEMEN sonra gösterilecek içerik (ör. şablona göre sorunlar) */
  afterSummary?: React.ReactNode;
  /** Sayfa başlığında zaten "Yeniden tara" varsa alttaki ikinci yenile düğmesini gizle */
  hideRefresh?: boolean;
  /** site.crawlAccess — son tarama denemesinde anasayfa okunamadıysa nedeni (API skor üretmez) */
  crawlAccess?: unknown;
}) {
  const [running, setRunning] = useState(false);
  const [fixing, setFixing] = useState(false);
  // Kok dosya yazabilen (FTP / SFTP / cPanel) aktif hedef var mi — WordPress REST
  // kok dosya yazamaz; eskiden yalniz "varsayilan hedef var mi"ya bakiliyordu ve
  // WordPress'li site "Otomatik duzelt"e basinca sessizce hata aliyordu.
  const [hasFileTarget, setHasFileTarget] = useState<boolean | null>(null);
  const [siteUrl, setSiteUrl] = useState<string | undefined>(undefined);
  const [lastApplied, setLastApplied] = useState<Array<{ fix: string; url: string | null; filename?: string; content?: string; verified?: boolean }>>([]);
  const [previewFile, setPreviewFile] = useState<{ filename: string; content: string } | null>(null);
  /** robots.txt onizleme diyalogu — acikken duzeltme anahtari ('robots_txt') */
  const [robotsPreviewKey, setRobotsPreviewKey] = useState<string | null>(null);
  // Son AI gorunurluk testi: taramadan yeniyse kart onu gosterir (lib/api.ts aiCardView)
  const [latestRun, setLatestRun] = useState<any>(null);

  // Dosya yazabilen yayin hedefi var mi? Kok dosya duzeltmesi icin zorunlu. + site URL'i (public link kurmak icin)
  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listPublishTargets(siteId), api.getSite(siteId).catch(() => null)])
      .then(([targets, site]: any[]) => {
        if (cancelled) return;
        setHasFileTarget(!!rootFileTarget(targets));
        setSiteUrl(site?.url);
      })
      .catch(() => { if (!cancelled) setHasFileTarget(false); });
    return () => { cancelled = true; };
  }, [siteId]);

  useEffect(() => {
    let cancelled = false;
    api.getCitationRuns(siteId, 1)
      .then((runs) => { if (!cancelled) setLatestRun(Array.isArray(runs) ? runs[0] ?? null : null); })
      .catch(() => { if (!cancelled) setLatestRun(null); });
    return () => { cancelled = true; };
  }, [siteId, audit?.id]);

  // audit.fixesApplied varsa onu da göster (sayfa yenilendiğinde geçmiş kalsın)
  useEffect(() => {
    const applied: string[] = Array.isArray(audit?.fixesApplied) ? audit.fixesApplied : [];
    if (applied.length > 0 && lastApplied.length === 0) {
      setLastApplied(applied.map((f) => ({ fix: f, url: publicUrlForFix(siteUrl, f) })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audit?.fixesApplied, siteUrl]);

  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  // Kuyruk + yoklama (lib/audit-run.ts): senkron istek vekil sunucuda 504'e dusuyordu
  const run = async () => {
    setRunning(true);
    try {
      const out = await runQueuedAudit(
        { queue: () => api.queueAudit(siteId), getJob: api.getJob },
        { isAlive: () => alive.current },
      );
      if (!alive.current) return;
      if (out.kind === 'done') toast.success('Site skoru güncellendi');
      else if (out.kind === 'failed') toast.error(out.error);
      else toast.message(AUDIT_PENDING_TITLE, { description: AUDIT_PENDING_DESC });
      // Erişim engeli kalıcı kayıt bırakır — paneli tazele ki durum görünsün
      onRefresh();
    } catch (err: any) {
      toast.error(err.message || 'Tarama başlatılamadı');
    } finally {
      if (alive.current) setRunning(false);
    }
  };

  // Son deneme anasayfayı okuyamadıysa skor YOK (eldeki skor da güncel değil):
  // engel sayfası sitenin kendisi gibi puanlanmaz (ofsayt.com 44 vakası).
  const access = currentCrawlAccess(crawlAccess ?? audit?.accessBlocked, audit);
  if (access) {
    return (
      <div className="space-y-3">
        {running && (
          <PipelineProgress title="Site yeniden taranıyor" steps={PIPELINE_STEPS.audit} running />
        )}
        <CrawlAccessNotice
          access={access}
          onRetry={hideRefresh ? undefined : run}
          retrying={running}
          staleScoreAt={audit?.ranAt}
        />
      </div>
    );
  }

  if (!audit) {
    // Onboarding modunda chain otomatik calisiyor — manuel buton kafa karistirir,
    // direkt progress goster.
    if (onboardingMode || running) {
      return (
        <PipelineProgress
          title="Site skoru otomatik hesaplaniyor"
          steps={PIPELINE_STEPS.audit}
          running
        />
      );
    }
    return (
      <div className="space-y-3">
        <div className="text-center py-6">
          <p className="text-sm text-muted-foreground mb-3">Henüz site skoru hesaplanmadı.</p>
          <Button onClick={run}>Skoru Hesapla</Button>
          <p className="text-xs text-muted-foreground mt-3">~30 sn — 14 SEO + GEO kontrolü</p>
        </div>
      </div>
    );
  }

  const issues = audit.issues ?? [];
  // Yalniz auto-fix'in GERCEKTEN urettigi kok dosyalar (fixRoute, /audit/latest);
  // dogrulanamayan kontrolun (erisim engeli) sorunu oneri almaz — lib/api.ts autoFixIssues
  const fixable = autoFixIssues(audit);
  // robots.txt toplu uygulanmaz: mevcut dosyayla birlesir, API onizleme + acik onay ister
  const robotsFixable = fixable.filter((i: any) => isRobotsFixKey(i.checkId));
  const bulkFixable = fixable.filter((i: any) => !isRobotsFixKey(i.checkId));
  const bulkIds: string[] = [...new Set<string>(bulkFixable.map((i: any) => i.checkId).filter(Boolean))];
  const bulkFiles = [...new Set(bulkIds.map((f) => AUTOFIX_PUBLIC_PATH[f] ?? f))];
  const robotsKey: string = robotsFixable[0]?.checkId ?? 'robots_txt';
  const checks = audit.checks ?? {};
  // Taramadaki AI ölçümü: atlandıysa (haftalık hak, kota, sağlayıcı yok) skor yok — 0/100 değil
  const ai = aiCitationOf(audit);
  // Kartta gosterilen: taramadan yeni bir "Yeniden Test" varsa o, yoksa taramadaki olcum
  const aiView = aiCardView(audit, latestRun);
  const aiFromRun = aiView?.source === 'run';
  const aiAt = aiMeasuredAtLabel(aiView?.at);
  // Doğrulanamayan kontrol (erişim engeli) ve ölçülmeyen AI adımı "sorunlu" sayılmaz — ölçülemedi
  const failedCount = Object.values(checks).filter((v: any) =>
    v?.name && !v?.details?.unverified && !(v?.id === 'ai_citations' && !ai?.measured) && (v?.score ?? 0) < 100,
  ).length;
  const totalCount = Object.values(checks).filter((v: any) => v?.name).length;
  const blockedPageCount: number = Number(checks.crawlCoverage?.blockedCount ?? 0);
  // GEO orneklemi engele takildiysa skor yok (null) — nedeni ve cozumu gosterilir
  const geo = geoAccessOf(audit);
  const geoBlocked = audit.geoScore == null ? geo.blocked : null;
  const geoNote = audit.geoScore != null ? geoSampleNote(geo.sample) : null;
  const fixLabel = (f: string) => AUTOFIX_LABEL[f] ?? f;

  const applyFix = async () => {
    if (hasFileTarget === false) {
      toast.error('Kök dosyalar için FTP, SFTP ya da cPanel yayın hedefi ekle — WordPress REST kök dosya yazamaz.', {
        duration: 8000,
      });
      return;
    }
    if (bulkIds.length === 0) {
      toast.message('Uygulanacak otomatik düzeltme bulunmadı');
      return;
    }
    setFixing(true);
    try {
      const result = await api.applyAutoFix(siteId, bulkIds);
      if (result?.reason === 'no-publish-target') {
        toast.error('Aktif yayın hedefi yok — Yayın Hedefleri sayfasından FTP, SFTP ya da cPanel ekle.', {
          duration: 9000,
        });
        setFixing(false);
        return;
      }
      const msg = autoFixMessages(result, fixLabel);
      // Basari yalniz sitede DOGRULANAN dosya; yuklenip canli adreste okunamayan dosya
      // API nedeniyle uyari (lib/auto-fix-notices.ts). Eskiden msg.applied ile her
      // yuklenen dosya "uygulandi" diye basari gosteriliyordu.
      for (const n of autoFixNotices(msg, fixLabel)) showNotice(n);
      if (msg.applied.length > 0) {
        // Backend'den gelen files[] varsa — content + filename'i state'e yaz (blob indirme için)
        const filesByFix = new Map((Array.isArray(result?.files) ? result.files : []).map((f) => [f.fix, f]));
        const apiUnverified = new Set((Array.isArray(result?.unverified) ? result.unverified : []).map((u) => u?.fix));
        setLastApplied(msg.applied.map((f) => {
          const file = filesByFix.get(f);
          return {
            fix: f,
            url: file?.externalUrl ?? publicUrlForFix(siteUrl, f),
            filename: file?.filename,
            content: file?.content,
            // Rozet bildirimle ayni kural: "dogrulandi" yalniz msg.verified; API'nin
            // okuyup goremedigi dosya "henuz gorunmuyor"; kanit yoksa rozet yok
            verified: msg.verified.includes(f) ? true : file?.verified === false || apiUnverified.has(f) ? false : undefined,
          };
        }));
      }
      if (msg.previewRequired) setRobotsPreviewKey(robotsKey);
      setTimeout(() => { onRefresh(); setFixing(false); }, 5000);
    } catch (err: any) {
      toast.error(err.message);
      setFixing(false);
    }
  };

  const downloadText = (filename: string, content: string) => {
    const blob = new Blob([content], {
      type: filename.endsWith('.xml') ? 'application/xml' : 'text/plain;charset=utf-8',
    });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  };

  const scoreTone = (s: number) => (s >= 80 ? 'text-success' : s >= 50 ? 'text-warning' : 'text-danger');

  return (
    <div className="space-y-4">
      {(running || fixing) && (
        <PipelineProgress
          title={running ? 'Site skoru yeniden hesaplanıyor' : 'Otomatik düzeltme uygulanıyor'}
          steps={running ? PIPELINE_STEPS.audit : PIPELINE_STEPS.autoFix}
          running={running || fixing}
        />
      )}

      {/* Önce skor, hemen altında birincil eylem — eskiden en altta kalıyordu */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border p-3 text-center">
          <div className="text-metric-lg tabular-nums text-brand">{audit.overallScore}</div>
          <div className="text-label text-muted-foreground mt-1">Site skoru / 100</div>
        </div>
        <div className="rounded-lg border p-3 text-center">
          {geoBlocked ? (
            // Orneklenen sayfalar engele takildi: skor YOK — "—" yerine neden (asagidaki not)
            <div className="text-sm font-semibold leading-snug text-warning pt-1.5" title={geoBlocked.reason}>Ölçülemedi</div>
          ) : (
            <div className="text-metric-lg tabular-nums">{audit.geoScore ?? '—'}</div>
          )}
          <div className="text-label text-muted-foreground mt-1">AI arama / 100</div>
        </div>
        <div className="rounded-lg border p-3 text-center">
          <div className="text-metric-lg tabular-nums text-danger">
            {failedCount}
            <span className="text-base text-muted-foreground font-normal">/{totalCount}</span>
          </div>
          <div className="text-label text-muted-foreground mt-1">Sorunlu kontrol ({issues.length} bulgu)</div>
        </div>
      </div>

      {geoBlocked && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs">
          <Info className="h-3.5 w-3.5 mt-px shrink-0 text-warning" aria-hidden />
          <p className="leading-relaxed">
            <span className="font-medium">AI arama skoru hesaplanmadı: </span>
            {geoBlocked.reason} {geoBlocked.hint}
          </p>
        </div>
      )}
      {geoNote && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden />
          AI arama skoru: {geoNote}
        </p>
      )}

      {blockedPageCount > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden />
          {blockedPageCount} sayfa erişim engeli nedeniyle taranamadı ve puana dahil edilmedi.
          {checks.crawlCoverage?.stoppedEarly ? ' Bot koruması devreye girdiği için tarama erken durduruldu.' : ''}
        </p>
      )}

      {fixable.length > 0 && (
        <div className="rounded-lg border border-brand/25 bg-brand/5 divide-y divide-brand/15">
          {bulkFixable.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">{bulkFixable.length} sorun tek tıkla düzeltilebilir</p>
                <p className="text-xs text-muted-foreground">
                  {bulkFiles.join(', ')} yoksa oluşturulup yayın hedefine yüklenir; mevcut dosyanın üzerine yazılmaz.
                </p>
              </div>
              {hasFileTarget === false ? (
                <Button size="sm" variant="outline" asChild>
                  <Link href={siteHref(siteId, 'publishTargets')} title="Kök dosyalar yalnız FTP, SFTP ya da cPanel ile yüklenebilir">
                    <Plug className="h-4 w-4 mr-1.5" aria-hidden /> FTP / SFTP hedefi ekle
                  </Link>
                </Button>
              ) : (
                <Button size="sm" onClick={applyFix} disabled={fixing}>
                  <Zap className="h-4 w-4 mr-1.5" aria-hidden />
                  {fixing ? 'Düzeltiliyor…' : `Otomatik düzelt (${bulkFixable.length})`}
                </Button>
              )}
            </div>
          )}
          {robotsFixable.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">robots.txt: {robotsFixable.length} sorun</p>
                <p className="text-xs text-muted-foreground">
                  Mevcut dosyanla birleştirilir: eksik AI bot grupları mevcut kurallarına dokunulmadan eklenir. Yazmadan önce farkı görüp onaylarsın; engelleri kaldırmak senin kararın.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={() => setRobotsPreviewKey(robotsKey)} disabled={fixing}>
                <Eye className="h-4 w-4 mr-1.5" aria-hidden /> Önizle ve uygula
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Kritik bulgular — açık liste (artık accordion'a saklanmıyor) */}
      {issues.length > 0 && (() => {
        const critical = issues.filter((i: any) => i.severity === 'critical');
        const warnings = issues.filter((i: any) => i.severity === 'warning');
        const top = [...critical, ...warnings].slice(0, 6);
        return (
          <div className="rounded-lg border border-danger/25 bg-danger/5 p-3 space-y-2">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <OctagonAlert className="h-4 w-4 text-danger" aria-hidden />
              {critical.length} kritik · {warnings.length} uyarı bulundu
            </p>
            <ul className="space-y-1.5 text-xs">
              {top.map((i: any, idx: number) => (
                <li key={idx} className="flex items-start gap-2 leading-relaxed">
                  <span
                    aria-hidden
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${i.severity === 'critical' ? 'bg-danger' : 'bg-warning'}`}
                  />
                  <span className="flex-1">
                    {i.description}
                    {i.fixRoute === 'auto_fix' && !isUnverifiedCheck(audit, i.checkId) && (
                      <Badge variant="warning" className="ml-1.5 px-1.5 py-0 text-label">
                        {isRobotsFixKey(i.checkId) ? 'önizlemeli' : 'otomatik'}
                      </Badge>
                    )}
                  </span>
                </li>
              ))}
              {issues.length > top.length && (
                <li className="text-muted-foreground italic pl-4">+{issues.length - top.length} ek bulgu…</li>
              )}
            </ul>
          </div>
        );
      })()}

      {afterSummary}

      {/* Son yuklenen dosyalar — auto-fix sonrasi public URL'ler. Liste YUKLENENLERI
          gosterir (applied / audit.fixesApplied, sitede dogrulanamayanlar dahil); baslik
          "duzeltildi" demez, sitede gorunurluk dosya rozetinde (auto-fix-notices.ts) */}
      {lastApplied.length > 0 && (
        <div className="rounded-lg border border-success/25 bg-success/5 p-4">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-success">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> Son yüklenen dosyalar ({lastApplied.length})
            </p>
            <span className="text-label text-muted-foreground">dosyalar yayın hedefine yüklendi</span>
          </div>
          <ul className="space-y-2">
            {lastApplied.map((item) => {
              const label = AUTOFIX_LABEL[item.fix] ?? item.fix;
              const filename = AUTOFIX_PUBLIC_PATH[item.fix] ?? item.fix;
              return (
                <li
                  key={item.fix}
                  className="flex items-center justify-between gap-3 flex-wrap rounded-md bg-card border p-2.5"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-sm font-medium">
                        {label}
                        {/* "yuklendi" ile "sitede gorunuyor" ayri: API yazimdan sonra canli adresi yeniden okur */}
                        {item.verified === true && <Badge variant="success" className="px-1.5 py-0 text-label">sitede doğrulandı</Badge>}
                        {item.verified === false && (
                          <Badge variant="warning" className="px-1.5 py-0 text-label" title="Önbellek (CDN) ya da yayın hedefindeki kök dizin ayarı olabilir">
                            sitede henüz görünmüyor
                          </Badge>
                        )}
                      </div>
                      <div className="text-label text-muted-foreground font-mono truncate">
                        {item.url ?? `/${filename}`}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* Görüntüle: backend content varsa modal, yoksa public URL'i yeni tab */}
                    {item.content ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2.5 text-xs"
                        onClick={() => setPreviewFile({
                          filename: item.filename ?? filename,
                          content: item.content!,
                        })}
                      >
                        <Eye className="h-3.5 w-3.5 mr-1" aria-hidden /> Görüntüle
                      </Button>
                    ) : item.url ? (
                      <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs" asChild>
                        <a href={item.url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-3.5 w-3.5 mr-1" aria-hidden /> Yayınlanan dosya
                        </a>
                      </Button>
                    ) : null}

                    {/* İndir: backend content varsa Blob download (cross-origin sorununu çözer) */}
                    {item.content ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-2.5 text-xs"
                        onClick={() => {
                          downloadText(item.filename ?? filename, item.content!);
                          toast.success(`${item.filename ?? filename} indirildi`);
                        }}
                      >
                        <Download className="h-3.5 w-3.5 mr-1" aria-hidden /> İndir
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="flex items-start gap-1.5 text-label text-muted-foreground mt-3">
            <Info className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden />
            Görüntüle/İndir → backend&apos;in ürettiği gerçek dosya. &quot;Yayınlanan dosya&quot; → yayın hedefindeki canlı sürüm (cross-origin nedeniyle indirilemez, sadece açılır).
          </p>
        </div>
      )}

      {/* Üretilen dosyanın önizlemesi — ui/dialog (Esc + odak tuzağı) */}
      <Dialog open={!!previewFile} onOpenChange={(o) => { if (!o) setPreviewFile(null); }}>
        <DialogContent size="xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-mono text-sm">
              <FileText className="h-4 w-4 text-muted-foreground" aria-hidden />
              {previewFile?.filename}
            </DialogTitle>
          </DialogHeader>
          <pre className="max-h-[60vh] overflow-auto p-5 text-xs font-mono whitespace-pre-wrap break-all">
            {previewFile?.content}
          </pre>
          <DialogFooter>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                if (!previewFile) return;
                try {
                  await navigator.clipboard.writeText(previewFile.content);
                  toast.success('Kopyalandı');
                } catch {
                  toast.error('Kopyalanamadı');
                }
              }}
            >
              <Copy className="h-3.5 w-3.5 mr-1.5" aria-hidden /> Kopyala
            </Button>
            <Button size="sm" onClick={() => previewFile && downloadText(previewFile.filename, previewFile.content)}>
              <Download className="h-3.5 w-3.5 mr-1.5" aria-hidden /> İndir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* robots.txt onizleme + onay — toplu "otomatik duzelt" robots'u yazmaz (API preview_required) */}
      <AutoFixPreviewDialog
        siteId={siteId}
        fixKey={robotsPreviewKey}
        checkName="Robots.txt"
        open={robotsPreviewKey !== null}
        onOpenChange={(o) => { if (!o) setRobotsPreviewKey(null); }}
        onApplied={onRefresh}
      />

      {/* 14 nokta kontrol listesi — varsayilan olarak acik, her satirda durum */}
      <div className="rounded-lg border">
        <div className="px-4 py-2 border-b bg-muted/30 flex items-center justify-between">
          <span className="text-sm font-semibold">14 SEO + GEO kontrol noktası</span>
          <span className="text-label text-muted-foreground">Var · Eksik · Yok</span>
        </div>
        <div className="divide-y text-sm">
          {Object.entries(checks).filter(([, v]: any) => v?.name && v?.id !== 'ai_citations').map(([k, v]: any) => {
            const firstIssue = Array.isArray(v.issues) && v.issues.length > 0 ? v.issues[0] : null;
            const fixable = Array.isArray(v.issues) && v.issues.some((i: any) => i.fixRoute === 'auto_fix');
            // Dosyaya erişimimiz engellendi / sunucu hata verdi: "YOK" değil, ölçülemedi
            // (API bu kontrolü genel skora katmaz). Ayrı satır biçimi.
            if (v.details?.unverified) {
              return (
                <div key={k} className="px-4 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      <Info className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" aria-hidden />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium">{v.name}</span>
                          <span className="text-label font-semibold text-muted-foreground">DOĞRULANAMADI</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                          {v.details.unverifiedReason}
                          {v.details.unverifiedHint ? ` ${v.details.unverifiedHint}` : ''}
                        </p>
                      </div>
                    </div>
                    <span className="font-mono text-xs font-bold shrink-0 text-muted-foreground" title="Skora dahil edilmedi">—</span>
                  </div>
                </div>
              );
            }
            const ok = v.found && v.valid;
            const stateCls = ok ? 'text-success' : v.found ? 'text-warning' : 'text-danger';
            return (
              <div key={k} className="px-4 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2 flex-1 min-w-0">
                    {ok ? (
                      <CheckCircle2 className="h-4 w-4 text-success shrink-0 mt-0.5" aria-hidden />
                    ) : (
                      <Circle className={`h-4 w-4 shrink-0 mt-0.5 ${stateCls}`} aria-hidden />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{v.name}</span>
                        <span className={`text-label font-semibold ${stateCls}`}>
                          {ok ? 'VAR' : v.found ? 'EKSİK' : 'YOK'}
                        </span>
                        {fixable && (isRobotsFixKey(k) ? (
                          // robots.txt toplu yazilmaz: onizleme + onay (AutoFixPreviewDialog)
                          <button
                            type="button"
                            onClick={() => setRobotsPreviewKey(k)}
                            className="rounded bg-warning/10 px-1.5 py-0 text-label font-semibold text-warning hover:bg-warning/20"
                          >
                            önizle ve uygula
                          </button>
                        ) : (
                          <Badge variant="warning" className="px-1.5 py-0 text-label">otomatik</Badge>
                        ))}
                      </div>
                      {firstIssue && (
                        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                          {firstIssue.description}
                        </p>
                      )}
                    </div>
                  </div>
                  <span className={`font-mono text-xs font-bold shrink-0 ${scoreTone(v.score)}`}>{v.score}/100</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Denetimin AI adımı. Atlandıysa (haftalık ölçüm hakkı, kota, sağlayıcı yok) skor YOK —
          eskiden boş sağlayıcı listesiyle "0 AI asistanında ölçüldü · 0/100" görünüyordu.
          Sayılan: skor döndüren asistanlar (yapılandırılmamış Llama gibi ölçülemeyenler değil). */}
      {aiView && ai && (
        <div className="rounded-lg border p-4">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold">AI Arama Görünürlüğü {aiFromRun ? '(son test)' : '(otomatik)'}</p>
              <p className="text-xs text-muted-foreground">
                {aiFromRun
                  ? `${aiView.providers.filter((p) => p.available && typeof p.score === 'number').length} AI asistanında ölçüldü${aiAt ? ` · ${aiAt}` : ''}`
                  : ai.measured
                    ? `${ai.measuredProviders} AI asistanında ölçüldü${aiAt ? ` · tarama anında, ${aiAt}` : ''}`
                    : aiCitationSkipLabel(ai)}
              </p>
            </div>
            {aiFromRun || ai.measured ? (
              <span className="text-metric-lg tabular-nums text-brand shrink-0">{aiView.score}/100</span>
            ) : (
              <span className="text-sm font-semibold text-muted-foreground shrink-0">Ölçülmedi</span>
            )}
          </div>
          {(aiFromRun || !ai.measured) && (
            <p className="text-xs text-muted-foreground mb-2">
              {aiFromRun ? 'Taramadan sonra yapılan en son testin sonucu. Tüm ölçümler ve soru bazında cevaplar ' : 'AI görünürlük ölçümlerin '}
              <Link href={siteHref(siteId, 'visibility')} className="underline hover:text-foreground">AI Görünürlük</Link>{' '}
              sayfasında tutulur.
            </p>
          )}
          {aiView.providers.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {aiView.providers.map((p) => (
                <div key={p.provider} className="rounded-md border p-2">
                  <div className="flex items-center justify-between">
                    <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
                      <EngineLogo provider={p.provider} size={16} />
                      <span className="truncate">{PROVIDER_LABELS[p.provider] ?? p.label}</span>
                    </span>
                    <span className={`text-sm font-bold ${
                      p.score === null ? 'text-muted-foreground' :
                      p.score >= 60 ? 'text-success' :
                      p.score >= 30 ? 'text-warning' : 'text-danger'
                    }`}>
                      {p.available && p.score !== null ? p.score : '—'}
                    </span>
                  </div>
                  {!p.available && p.reason && (
                    <p className="text-label text-muted-foreground mt-1 leading-snug">{displayProbeText(p.reason)}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!hideRefresh && (
        <div className="flex justify-end pt-2">
          <Button size="sm" variant="outline" onClick={run} disabled={running || fixing}>
            {running ? 'Hesaplanıyor…' : 'Skoru Yenile'}
          </Button>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Snippet Panel — D1 (AI üretip kullanıcıya copy-paste verir)
// ──────────────────────────────────────────────────────────────────────
export function SnippetPanel({ siteId, initialUrl }: { siteId: string; initialUrl?: string }) {
  const [loading, setLoading] = useState(false);
  const [pageUrl, setPageUrl] = useState(initialUrl ?? '');
  // Bulk scan'den URL gelince auto-trigger generate
  useEffect(() => {
    if (initialUrl && initialUrl !== pageUrl) {
      setPageUrl(initialUrl);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialUrl]);
  const [snippets, setSnippets] = useState<any[] | null>(null);
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<any | null>(null);
  const [staticPreview, setStaticPreview] = useState<any | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [writing, setWriting] = useState(false);
  const [writeResult, setWriteResult] = useState<any | null>(null);

  const generate = async () => {
    setLoading(true);
    setApplyResult(null);
    try {
      const res = await api.getSnippets(siteId, pageUrl || undefined);
      setSnippets(res.snippets ?? []);
      setResolvedUrl(res.pageUrl ?? null);
      if ((res.snippets ?? []).length === 0) toast.info('Bu sayfa için eksik on-page tag bulunamadı');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const apply = async () => {
    if (!snippets || snippets.length === 0) return;
    setApplying(true);
    try {
      const res = await api.applySnippets(siteId, snippets);
      setApplyResult(res);
      if (res.ok) toast.success(`${res.applied.length} alan WP'ye yazıldı (${res.adapter})`);
      else toast.error(res.skipped?.[0]?.reason ?? 'Otomatik yazma başarısız');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setApplying(false);
    }
  };

  const previewStatic = async () => {
    if (!snippets || snippets.length === 0 || !resolvedUrl) return;
    setPreviewing(true);
    setWriteResult(null);
    try {
      const res = await api.previewStaticWrite(siteId, resolvedUrl, snippets);
      setStaticPreview(res);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setPreviewing(false);
    }
  };

  const writeStatic = async () => {
    if (!snippets || !resolvedUrl) return;
    if (!confirm('Sayfa HTML\'i overwrite edilecek. Devam edilsin mi?')) return;
    setWriting(true);
    try {
      const res = await api.writeStatic(siteId, resolvedUrl, snippets);
      setWriteResult(res);
      if (res.ok) toast.success(`${res.applied?.length ?? 0} değişiklik yazıldı (${res.adapter})`);
      // manual: sayfayi sunan statik dosya dogrulanamadi, hicbir sey yazilmadi; hata
      // degil, elle uygulama yolu (api static-html-fixer.service write → manual: true)
      else if (res.manual) toast.message('Otomatik yazılmadı; snippet\'leri elle uygula', { description: res.error });
      else toast.error(res.error ?? 'Yazılamadı');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setWriting(false);
    }
  };

  const copy = async (idx: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(idx);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      toast.error('Kopyalanamadı');
    }
  };

  const labelFor = (type: string) => ({
    meta_title: 'Meta Title',
    meta_description: 'Meta Description',
    canonical: 'Canonical URL',
    open_graph: 'Open Graph',
    twitter_card: 'Twitter Card',
    jsonld_article: 'JSON-LD Article',
    jsonld_organization: 'JSON-LD Organization',
    jsonld_breadcrumb: 'JSON-LD Breadcrumb',
    h1: 'H1 Etiketi',
  } as Record<string, string>)[type] ?? type;

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">On-Page Snippet Üretici</p>
          <p className="text-xs text-muted-foreground mt-0.5">Eksik canonical, meta description, OG tag, JSON-LD vb. için AI ile snippet üretir. Sayfanı bozmadan kendi panelinden yapıştırırsın (Yoast custom field, Webflow Page Settings, statik HTML <code>&lt;head&gt;</code> vb.).</p>
        </div>
      </div>
      <div className="mt-3 flex gap-2 flex-wrap">
        <Input placeholder="Sayfa URL (boşsa anasayfa)" value={pageUrl} onChange={e => setPageUrl(e.target.value)} className="flex-1 min-w-[260px]" />
        <Button size="sm" onClick={generate} disabled={loading}>
          {loading ? 'Üretiliyor…' : 'Snippet Üret'}
        </Button>
      </div>

      {snippets && snippets.length > 0 && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-blue-500/30 bg-blue-500/5 p-2.5">
          <div className="text-xs">
            <p className="font-medium">Otomatik yazım (deneysel)</p>
            <p className="text-muted-foreground mt-0.5">
              WordPress (Yoast/RankMath), Webflow veya Shopify default target'ı varsa otomatik yazar.{' '}
              {/* Hedefler Yayin Hedefleri sayfasinda; Baglantilar'da hedef ekleme yok */}
              <Link href={siteHref(siteId, 'publishTargets')} className="underline text-blue-600 hover:text-blue-700">
                Publish target ekle/düzenle →
              </Link>
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={apply} disabled={applying}>
            {applying ? 'Yazılıyor…' : 'Otomatik Yaz'}
          </Button>
        </div>
      )}

      {applyResult && (
        <div className={`mt-2 rounded-md border p-2.5 text-xs ${applyResult.ok ? 'border-green-500/30 bg-green-500/5' : 'border-red-500/30 bg-red-500/5'}`}>
          <p className="font-medium">{applyResult.ok ? '✓ Yazıldı' : '✗ Yazılamadı'} — adapter: {applyResult.adapter}</p>
          {applyResult.applied?.length > 0 && (
            <p className="text-muted-foreground mt-1">Uygulanan: {applyResult.applied.join(', ')}</p>
          )}
          {applyResult.skipped?.length > 0 && (
            <ul className="text-muted-foreground mt-1 list-disc list-inside">
              {applyResult.skipped.map((s: any, i: number) => (<li key={i}>{s.field}: {s.reason}</li>))}
            </ul>
          )}
        </div>
      )}

      {snippets && snippets.length > 0 && resolvedUrl && (
        <div className="mt-3 rounded-md border border-brand-500/30 bg-brand-500/5 p-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="text-xs">
              <p className="font-medium">Statik HTML auto-write (FTP/SFTP/cPanel için)</p>
              <p className="text-muted-foreground mt-0.5">
                Önce "Önizle" — sayfanın <code>&lt;head&gt;</code>'ine snippet'ler ekleniyor, diff gösterilir. Onay sonrası canlı dosya overwrite.{' '}
                <Link href={siteHref(siteId, 'publishTargets')} className="underline text-brand-700 hover:text-brand-800">
                  FTP/SFTP/cPanel target ekle →
                </Link>
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={previewStatic} disabled={previewing || writing}>
                {previewing ? 'Önizleniyor…' : 'Önizle'}
              </Button>
              <Button size="sm" onClick={writeStatic} disabled={!staticPreview || writing}>
                {writing ? 'Yazılıyor…' : 'Onayla ve Yaz'}
              </Button>
            </div>
          </div>

          {staticPreview && (
            <div className="mt-2 space-y-2">
              <p className="text-[11px]">
                Uygulanacak: <span className="font-mono text-green-600">{staticPreview.applied?.join(', ') || '(yok)'}</span>
                {staticPreview.skipped?.length > 0 && <> · atlanacak: <span className="font-mono text-yellow-600">{staticPreview.skipped.map((s: any) => s.type).join(', ')}</span></>}
              </p>
              <details className="text-[11px]">
                <summary className="cursor-pointer">Head diff göster</summary>
                <div className="grid grid-cols-2 gap-2 mt-1.5">
                  <div>
                    <p className="font-medium mb-1">Eski &lt;head&gt;</p>
                    <pre className="bg-muted/50 p-2 rounded overflow-auto max-h-60 whitespace-pre-wrap break-all">{staticPreview.diff?.before?.slice(0, 2500) || '—'}</pre>
                  </div>
                  <div>
                    <p className="font-medium mb-1">Yeni &lt;head&gt;</p>
                    <pre className="bg-green-500/5 p-2 rounded overflow-auto max-h-60 whitespace-pre-wrap break-all">{staticPreview.diff?.after?.slice(0, 2500) || '—'}</pre>
                  </div>
                </div>
              </details>
            </div>
          )}

          {writeResult && (writeResult.manual ? (
            // Elle uygulama nedeni (CMS izi, dogrulanamayan dosya vb.) notr: siteye bir sey yazilmadi, hata degil
            <div className="mt-2 text-label font-normal rounded p-2 border border-border bg-muted/50 text-muted-foreground">
              <span className="font-medium text-foreground">Otomatik yazılmadı:</span> {writeResult.error ?? 'Sayfa dosyası doğrulanamadı; snippet\'leri elle uygula.'}
            </div>
          ) : (
            <div className={`mt-2 text-[11px] rounded p-2 ${writeResult.ok ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
              {writeResult.ok ? '✓' : '✗'} {writeResult.ok
                ? `Dosya yazıldı: ${writeResult.remoteDir}/${writeResult.filename} — uygulanan: ${writeResult.applied?.join(', ')}`
                : (writeResult.error ?? 'Bilinmeyen hata')}
            </div>
          ))}
        </div>
      )}

      {snippets && (
        <div className="mt-3 space-y-2">
          {resolvedUrl && <p className="text-[11px] text-muted-foreground">Hedef: <span className="font-mono">{resolvedUrl}</span></p>}
          {snippets.length === 0 && <p className="text-xs text-muted-foreground">Bu sayfa için eksik tag yok ✓</p>}
          {snippets.map((s: any, i: number) => (
            <div key={i} className="rounded-md border">
              <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-muted/30">
                <div>
                  <span className="text-xs font-semibold">{labelFor(s.type)}</span>
                  <span className="text-[11px] text-muted-foreground ml-2">{s.insertLocation}</span>
                </div>
                <Button size="sm" variant="ghost" onClick={() => copy(i, s.generatedSnippet)}>
                  {copied === i ? '✓ Kopyalandı' : 'Kopyala'}
                </Button>
              </div>
              <div className="px-3 py-2">
                <p className="text-[11px] text-muted-foreground mb-1.5">{s.reason}</p>
                <pre className="text-[11px] bg-muted/50 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all font-mono">{s.generatedSnippet}</pre>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Step 2 — Rakipler
// ──────────────────────────────────────────────────────────────────────
type Competitor = { name: string; url: string; strengths?: string[]; weaknesses?: string[] };

export function CompetitorsStepBody({
  siteId, initial, onChanged, onboardingMode,
}: {
  siteId: string;
  initial: Competitor[];
  onChanged: () => void;
  onboardingMode?: boolean;
}) {
  const [list, setList] = useState<Competitor[]>(initial ?? []);
  const [draftName, setDraftName] = useState('');
  const [draftUrl, setDraftUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    setList(initial ?? []);
  }, [initial]);

  const persist = async (next: Competitor[]) => {
    setSaving(true);
    try {
      const saved = await api.setCompetitors(siteId, next);
      setList(saved);
      onChanged();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (url: string) => {
    const next = list.filter((c) => c.url !== url);
    await persist(next);
    toast.success('Rakip kaldırıldı');
  };

  const add = async () => {
    const name = draftName.trim();
    let url = draftUrl.trim();
    if (!name || !url) {
      toast.error('İsim ve URL zorunlu');
      return;
    }
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    const next = [...list, { name, url }];
    await persist(next);
    setDraftName('');
    setDraftUrl('');
    toast.success('Rakip eklendi');
  };

  const regenerate = async () => {
    if (!confirm('AI yeni bir rakip listesi üretsin mi? Mevcut listenin üzerine yazılır (kaybolur).')) return;
    setRegenerating(true);
    try {
      await api.regenerateBrain(siteId);
      toast.success('Brain yeniden üretiliyor (~60sn) — sayfayı yenile');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRegenerating(false);
    }
  };

  if (onboardingMode && list.length === 0 && !regenerating) {
    return (
      <PipelineProgress
        title="AI rakipleri otomatik tespit ediyor"
        steps={PIPELINE_STEPS.brain}
        running
      />
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Konu önerileri ve içerik üretimi bu listeyi kullanır. AI senin için rakip önerdi;
        seninle yarışan başka siteler varsa ekle, alakasız olanları kaldır.
      </p>

      {list.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Henüz rakip yok. AI tespit etmediyse aşağıdan elle ekleyebilirsin.
        </div>
      ) : (
        <ul className="divide-y border rounded-lg">
          {list.map((c) => (
            <li key={c.url} className="px-4 py-3 flex items-start justify-between gap-3">
              <SiteFavicon url={c.url} name={c.name} size="sm" className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-sm">{c.name}</div>
                <a href={c.url} target="_blank" rel="noopener" className="text-xs text-muted-foreground hover:text-brand inline-flex items-center gap-1">
                  {c.url} <ExternalLink className="h-3 w-3" />
                </a>
                {(c.strengths?.length || c.weaknesses?.length) ? (
                  <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-2 sm:gap-4">
                    {c.strengths?.length ? (
                      <div><dt className="font-medium text-success">Güçlü yanları</dt><dd className="text-muted-foreground">{c.strengths.join(', ')}</dd></div>
                    ) : null}
                    {c.weaknesses?.length ? (
                      <div><dt className="font-medium text-warning">Açıkları</dt><dd className="text-muted-foreground">{c.weaknesses.join(', ')}</dd></div>
                    ) : null}
                  </dl>
                ) : null}
              </div>
              <Button size="sm" variant="ghost" onClick={() => remove(c.url)} disabled={saving} title="Kaldır" aria-label={`${c.name} rakibini kaldır`} className="text-muted-foreground hover:text-danger">
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-lg border p-3 space-y-2">
        <div className="text-xs font-semibold text-muted-foreground">Manuel ekle</div>
        <div className="flex gap-2 flex-wrap">
          <Input placeholder="Marka adı" value={draftName} onChange={(e) => setDraftName(e.target.value)} className="flex-1 min-w-[140px]" />
          <Input placeholder="https://rakip.com" value={draftUrl} onChange={(e) => setDraftUrl(e.target.value)} className="flex-[2] min-w-[200px]" />
          <Button onClick={add} disabled={saving || !draftName || !draftUrl}>
            <Plus className="h-4 w-4 mr-1" /> Ekle
          </Button>
        </div>
      </div>

      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={regenerate} disabled={regenerating}>
          <Sparkles className="h-4 w-4 mr-1" />
          {regenerating ? 'Üretiliyor…' : 'AI ile yeniden bul'}
        </Button>
      </div>
    </div>
  );
}
