'use client';

import { SEVERITY_LABEL, label } from '@/lib/labels';
import { useContext, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Layers, Zap, ChevronDown, Puzzle, Image as ImageIcon, Eye } from 'lucide-react';
import { api, autoFixMessages, isRobotsFixKey, isUnverifiedCheck } from '@/lib/api';
// Grup verisi ayni context'teki son taramadan gelir (audit/page.tsx); checks oradan okunur
import { SiteContext } from '@/app/(dashboard)/sites/[id]/site-context';
// robots.txt yalniz onizleme + acik onayla yazilir (API 'preview_required')
import { AutoFixPreviewDialog } from '@/app/(dashboard)/sites/[id]/agent-readiness/auto-fix-preview-dialog';
import { siteHref } from '@/lib/site-routes';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Audit sorunları şablona göre — "yüzlerce sayfa hatası = tek bileşen düzeltmesi".
 * Veri backend'de audit üretilirken hesaplanır (Audit.issueGroups, issue-grouping.ts);
 * alan yoksa (eski taramalar) bileşen hiç görünmez.
 */
const SEV_VARIANT: Record<string, 'danger' | 'warning' | 'secondary'> = {
  critical: 'danger',
  error: 'danger',
  warning: 'warning',
  info: 'secondary',
};

export function AuditIssueGroups({ siteId, groups, onRefresh }: { siteId: string; groups: any; onRefresh?: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const [robotsPreviewKey, setRobotsPreviewKey] = useState<string | null>(null);
  // useContext (useSiteContext degil): bilesen site duzeni disinda da cizilebilsin
  const audit = useContext(SiteContext)?.audit ?? null;
  const templates: any[] = Array.isArray(groups?.byTemplate) ? groups.byTemplate : [];
  const siteWide: any[] = Array.isArray(groups?.siteWide) ? groups.siteWide : [];
  if (templates.length === 0 && siteWide.length === 0) return null;

  /**
   * Sablon butonunun gonderecegi anahtarlar: robots.txt toplu yazilmaz (onizleme +
   * onay), dogrulanamayan kontrolun (erisim engeli) dosyasina hic dokunulmaz.
   */
  const fixPlan = (g: any) => {
    const ids: string[] = (Array.isArray(g.fixableCheckIds) ? g.fixableCheckIds : []).filter((id: string) => !isUnverifiedCheck(audit, id));
    return { bulk: ids.filter((id) => !isRobotsFixKey(id)), robots: ids.find((id) => isRobotsFixKey(id)) ?? null };
  };

  const fixGroup = async (g: any, ids: string[]) => {
    if (ids.length === 0) return;
    setFixing(g.template);
    try {
      // Sonucu GERÇEĞE göre söyle — eskiden auto-fix hiçbir şey yapmasa da
      // "uygulandı" deniyordu (snippet kontrolleri sessizce atlanıyordu).
      const res = await api.applyAutoFix(siteId, ids);
      // Hata / "degisiklik gerekmedi" metinleri API'den, oldugu gibi. "Uygulandi" yalniz
      // sitede dogrulanan dosya icin; yuklenip canli adreste gorunmeyen dosya uyari olarak
      // (lib/api.ts autoFixMessages, onizleme diyalogu ile ayni kural)
      const msg = autoFixMessages(res);
      if (msg.verified.length > 0) toast.success(`${g.template}: ${msg.verified.join(', ')} uygulandı ve sitede doğrulandı`);
      if (msg.unverifiedFixes.length > 0) toast.warning(`${g.template}: ${msg.unverifiedFixes.join(', ')} yazıldı ama sitede doğrulanamadı`, { description: msg.unverified.join(' · '), duration: 10000 });
      if (msg.errors.length > 0) toast.error(msg.errors.length === 1 ? 'Düzeltme uygulanmadı' : `${msg.errors.length} düzeltme uygulanmadı`, { description: msg.errors.join(' · '), duration: 10000 });
      if (msg.unchanged.length > 0) toast.message('Değişiklik gerekmedi', { description: msg.unchanged.join(' · ') });
      if (msg.unsupported.length > 0) toast.warning(`Otomatik düzeltilemez: ${msg.unsupported.join(', ')} — snippet aracını kullan`);
      if (msg.applied.length === 0 && msg.errors.length === 0 && msg.unchanged.length === 0 && msg.unsupported.length === 0) toast.message('Uygulanacak otomatik düzeltme bulunmadı');
      onRefresh?.();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setFixing(null);
    }
  };

  return (
    // Site Skoru kartinin icinde durdugu icin ikinci bir Card yerine cerceveli bolum
    <section className="rounded-lg border p-4">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2"><Layers className="h-4 w-4 text-muted-foreground" /> Şablona göre sorunlar</h3>
            <p className="text-xs text-muted-foreground">Aynı URL desenindeki sayfalar tek satırda — çoğu zaman yüzlerce sayfa hatası tek bir tema/bileşen düzeltmesidir.</p>
          </div>
          {siteWide.length > 0 && (
            <span className="text-xs text-muted-foreground">{siteWide.length} site-geneli sorun (sitemap/robots/HTTPS gibi) aşağıdaki listede</span>
          )}
        </div>

        <div className="space-y-1.5">
          {templates.map((g) => {
            const isOpen = open === g.template;
            const plan = fixPlan(g);
            return (
              <div key={g.template} className="rounded-lg border">
                <button type="button" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : g.template)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left">
                  <code className="text-sm font-semibold">{g.template}</code>
                  <span className="text-xs text-muted-foreground">{g.pageCount} sayfa</span>
                  <div className="flex items-center gap-1 ml-auto">
                    {g.criticalCount > 0 && <Badge variant="danger" className="text-label">{g.criticalCount} kritik</Badge>}
                    {g.warningCount > 0 && <Badge variant="warning" className="text-label">{g.warningCount} uyarı</Badge>}
                    {g.infoCount > 0 && <Badge variant="secondary" className="text-label">{g.infoCount} bilgi</Badge>}
                  </div>
                  <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 border-t pt-2 space-y-2 text-sm">
                    <div className="space-y-1">
                      {g.issues.map((i: any) => (
                        <div key={`${i.checkId}-${i.type}`} className="flex items-center gap-2 text-xs">
                          <Badge variant={SEV_VARIANT[i.severity] ?? 'secondary'} className="text-label">{label(SEVERITY_LABEL, i.severity)}</Badge>
                          <span className="font-medium">{i.description ?? label({}, i.type)}</span>
                          <span className="text-muted-foreground">· {i.count} sayfa</span>
                          {i.fixRoute === 'auto_fix' && !isUnverifiedCheck(audit, i.checkId) && (
                            <span className="text-success text-label">{isRobotsFixKey(i.checkId) ? 'önizlemeyle düzeltilir' : 'otomatik düzeltilebilir'}</span>
                          )}
                          {i.fixRoute === 'snippet' && <span className="text-brand text-label">snippet ile düzeltilir</span>}
                          {i.fixRoute === 'images' && <span className="text-brand text-label">görseller sayfasında düzeltilir</span>}
                        </div>
                      ))}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Örnek: {g.samplePages.map((p: string) => { try { return new URL(p).pathname; } catch { return p; } }).join(' · ')}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {plan.bulk.length > 0 && (
                        <Button
                          size="sm" variant="outline" onClick={() => fixGroup(g, plan.bulk)} disabled={fixing !== null}
                          // Kok klasor kaniti dosyasi da yuklenir ve sitede kalir (api auto-fix.service.ts proveRootDir)
                          title="Dosya yoksa oluşturulur; senin dosyanın üzerine yazılmaz. Yazmadan önce küçük bir doğrulama dosyası (ranksup-verify.txt) yüklenip yayın hedefinin bu siteyi sunduğu kontrol edilir; bu dosya sitende kalır."
                        >
                          <Zap className="h-3.5 w-3.5 mr-1.5" /> {fixing === g.template ? 'Düzeltiliyor…' : `Bu şablonu düzelt (${plan.bulk.join(', ')})`}
                        </Button>
                      )}
                      {plan.robots && (
                        <Button size="sm" variant="outline" onClick={() => setRobotsPreviewKey(plan.robots)} disabled={fixing !== null}>
                          <Eye className="h-3.5 w-3.5 mr-1.5" /> robots.txt önerisini önizle
                        </Button>
                      )}
                      {g.issues.some((i: any) => i.fixRoute === 'images') && (
                        <Button size="sm" variant="outline" asChild>
                          <Link href={siteHref(siteId, 'images')}>
                            <ImageIcon className="h-3.5 w-3.5 mr-1.5" /> Alt metinlerini düzelt
                          </Link>
                        </Button>
                      )}
                      {g.issues.some((i: any) => i.fixRoute === 'snippet') && (
                        <Button size="sm" variant="outline" asChild>
                          <Link href={siteHref(siteId, 'snippet')}>
                            <Puzzle className="h-3.5 w-3.5 mr-1.5" /> Snippet aracında düzelt
                          </Link>
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <AutoFixPreviewDialog
          siteId={siteId}
          fixKey={robotsPreviewKey}
          checkName="Robots.txt"
          open={robotsPreviewKey !== null}
          onOpenChange={(o) => { if (!o) setRobotsPreviewKey(null); }}
          onApplied={() => onRefresh?.()}
        />
    </section>
  );
}
