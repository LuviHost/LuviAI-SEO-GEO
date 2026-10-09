'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Layers, Zap, ChevronDown, Puzzle } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Audit sorunları şablona göre — "yüzlerce sayfa hatası = tek bileşen düzeltmesi".
 * Veri backend'de audit üretilirken hesaplanır (Audit.issueGroups, issue-grouping.ts);
 * alan yoksa (eski taramalar) bileşen hiç görünmez.
 */
const SEV_CLS: Record<string, string> = {
  critical: 'bg-red-500/10 text-red-600 border-red-500/30',
  warning: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
  info: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/30',
};

export function AuditIssueGroups({ siteId, groups, onRefresh }: { siteId: string; groups: any; onRefresh?: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [fixing, setFixing] = useState<string | null>(null);
  const templates: any[] = Array.isArray(groups?.byTemplate) ? groups.byTemplate : [];
  const siteWide: any[] = Array.isArray(groups?.siteWide) ? groups.siteWide : [];
  if (templates.length === 0 && siteWide.length === 0) return null;

  const fixGroup = async (g: any) => {
    setFixing(g.template);
    try {
      // Sonucu GERÇEĞE göre söyle — eskiden auto-fix hiçbir şey yapmasa da
      // "uygulandı" deniyordu (snippet kontrolleri sessizce atlanıyordu).
      const res: any = await api.applyAutoFix(siteId, g.fixableCheckIds);
      const applied: string[] = Array.isArray(res?.applied) ? res.applied : [];
      const errors: any[] = Array.isArray(res?.errors) ? res.errors : [];
      const unsupported: string[] = Array.isArray(res?.unsupported) ? res.unsupported : [];
      if (applied.length > 0) toast.success(`${g.template}: ${applied.join(', ')} uygulandı`);
      if (errors.length > 0) toast.error(`${errors.length} düzeltme başarısız: ${errors.map((e) => e.error).join(' · ')}`);
      if (unsupported.length > 0) toast.warning(`Otomatik düzeltilemez: ${unsupported.join(', ')} — snippet aracını kullan`);
      if (applied.length === 0 && errors.length === 0 && unsupported.length === 0) toast.message('Uygulanacak otomatik düzeltme bulunmadı');
      onRefresh?.();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setFixing(null);
    }
  };

  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div>
            <h3 className="font-semibold flex items-center gap-2"><Layers className="h-4 w-4 text-brand" /> Şablona göre sorunlar</h3>
            <p className="text-xs text-muted-foreground">Aynı URL desenindeki sayfalar tek satırda — çoğu zaman yüzlerce sayfa hatası tek bir tema/bileşen düzeltmesidir.</p>
          </div>
          {siteWide.length > 0 && (
            <span className="text-xs text-muted-foreground">{siteWide.length} site-geneli sorun (sitemap/robots/HTTPS gibi) aşağıdaki listede</span>
          )}
        </div>

        <div className="space-y-1.5">
          {templates.map((g) => {
            const isOpen = open === g.template;
            return (
              <div key={g.template} className="rounded-lg border">
                <button type="button" onClick={() => setOpen(isOpen ? null : g.template)} className="w-full flex items-center gap-3 px-3 py-2.5 text-left">
                  <code className="text-sm font-semibold">{g.template}</code>
                  <span className="text-xs text-muted-foreground">{g.pageCount} sayfa</span>
                  <div className="flex items-center gap-1 ml-auto">
                    {g.criticalCount > 0 && <Badge variant="outline" className={cn('text-[10px]', SEV_CLS.critical)}>{g.criticalCount} kritik</Badge>}
                    {g.warningCount > 0 && <Badge variant="outline" className={cn('text-[10px]', SEV_CLS.warning)}>{g.warningCount} uyarı</Badge>}
                    {g.infoCount > 0 && <Badge variant="outline" className={cn('text-[10px]', SEV_CLS.info)}>{g.infoCount} bilgi</Badge>}
                  </div>
                  <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', isOpen && 'rotate-180')} />
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 border-t pt-2 space-y-2 text-sm">
                    <div className="space-y-1">
                      {g.issues.map((i: any) => (
                        <div key={`${i.checkId}-${i.type}`} className="flex items-center gap-2 text-xs">
                          <Badge variant="outline" className={cn('text-[10px]', SEV_CLS[i.severity])}>{i.severity}</Badge>
                          <span className="font-medium">{i.type}</span>
                          <span className="text-muted-foreground">· {i.count} sayfa</span>
                          {i.fixRoute === 'auto_fix' && <span className="text-emerald-600 text-label">otomatik düzeltilebilir</span>}
                          {i.fixRoute === 'snippet' && <span className="text-brand text-label">snippet ile düzeltilir</span>}
                        </div>
                      ))}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Örnek: {g.samplePages.map((p: string) => { try { return new URL(p).pathname; } catch { return p; } }).join(' · ')}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {g.fixableCheckIds.length > 0 && (
                        <Button size="sm" variant="outline" onClick={() => fixGroup(g)} disabled={fixing !== null}>
                          <Zap className="h-3.5 w-3.5 mr-1.5" /> {fixing === g.template ? 'Düzeltiliyor…' : `Bu şablonu düzelt (${g.fixableCheckIds.join(', ')})`}
                        </Button>
                      )}
                      {g.issues.some((i: any) => i.fixRoute === 'snippet') && (
                        <Button size="sm" variant="outline" asChild>
                          <Link href={`/sites/${siteId}/snippet`}>
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
      </CardContent>
    </Card>
  );
}
