'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useSiteContext } from '../site-context';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { useEntitlements } from '@/lib/entitlements';
import { PlanLockedCard } from '@/components/plan-locked-card';
import { cn } from '@/lib/utils';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { siteHref } from '@/lib/site-routes';
import { formatPct } from '@/lib/format';
import { ARTICLE_STATUS_LABEL, label } from '@/lib/labels';
import {
  Lightbulb, RefreshCw, Loader2, Sparkles, FileText, Repeat,
  X, TrendingUp, MessageSquareWarning, Undo2,
} from 'lucide-react';

/**
 * İçerik Fırsatları — kapalı döngünün ekranı.
 * Prompt Lab'de KAYBEDİLEN sorgu → fırsat kartı (kanıtıyla) → tek tıkla
 * makale → yayın → yeniden ölçüm → kazandın/kaybettin deltası.
 */

const COVERAGE_BADGE: Record<string, { text: string; variant: 'danger' | 'warning' | 'secondary' | 'success' }> = {
  LOST:    { text: 'Kayıp',     variant: 'danger' },
  WEAK:    { text: 'Zayıf',     variant: 'warning' },
  MISSING: { text: 'Veri yok',  variant: 'secondary' },
  WON:     { text: 'Kazanıldı', variant: 'success' },
};

// Geri alinabilir yoksayma: backend yalniz OPEN/PLANNED/DISMISSED arasinda gecise izin verir
const UNDOABLE = new Set(['OPEN', 'PLANNED']);

const STATUS_LABEL: Record<string, string> = {
  OPEN: 'Açık',
  PLANNED: 'Planlandı',
  GENERATED: 'Makale üretildi',
  PUBLISHED: 'Yayınlandı',
  REMEASURED: 'Yeniden ölçüldü',
  DISMISSED: 'Yoksayıldı',
};

const SOURCE_LABEL: Record<string, { text: string; icon: any }> = {
  prompt:  { text: 'Prompt Lab', icon: Sparkles },
  reviews: { text: 'App Yorumları', icon: MessageSquareWarning },
  radar:   { text: 'Product Radar', icon: TrendingUp },
  manual:  { text: 'Manuel', icon: Lightbulb },
};

export default function OpportunitiesPage() {
  const { site } = useSiteContext();
  const { can, requirementFor } = useEntitlements();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deriving, setDeriving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);

  const allowed = can('contentOpportunities');
  const confirm = useConfirm();

  const load = async () => {
    try {
      const rows = await api.listOpportunities(site.id);
      setItems(rows);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Haklar KESIN gelene kadar istek atilmaz — kapali planda bos 200/403 gurultusu olmasin.
  useEffect(() => {
    if (allowed !== true) return;
    load();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [site.id, allowed]);

  const derive = async () => {
    setDeriving(true);
    try {
      const res = await api.deriveOpportunities(site.id);
      toast.success(`Tarama bitti: ${res.created} yeni fırsat, ${res.updated} güncellendi (${res.scanned} prompt)`);
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setDeriving(false);
    }
  };

  const generate = async (item: any) => {
    setBusy(item.id);
    try {
      const res: any = await api.generateFromOpportunity(site.id, item.id);
      if (res?.mode === 'update') {
        toast.success(`Bu soruyu zaten cevaplayan makale var — yeni makale yerine güncelleniyor: "${res.matchedTitle}"`);
      } else {
        toast.success('Makale üretimi başladı — İçerikler sayfasından izleyebilirsin');
      }
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const remeasure = async (item: any) => {
    setBusy(item.id);
    try {
      const res = await api.remeasureOpportunity(site.id, item.id);
      const { before, after } = res;
      toast.success(`Yeniden ölçüldü: ${before.cited}/${before.total} → ${after.cited}/${after.total}`);
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(null);
    }
  };

  const setStatus = async (item: any, status: string) => {
    try {
      await api.updateOpportunity(site.id, item.id, status);
      await load();
      return true;
    } catch (err: any) {
      toast.error(err.message);
      return false;
    }
  };

  // Yoksay: OPEN/PLANNED icin toast'ta "Geri al"; makalesi olan karti geri acmak
  // backend'de mumkun olmadigi icin onlarda once onay istenir.
  const dismiss = async (item: any) => {
    const prev: string = item.status;
    if (!UNDOABLE.has(prev)) {
      const ok = await confirm({
        title: 'Bu fırsat yoksayılsın mı?',
        description: 'Bu fırsatın bir makalesi var; yoksaydıktan sonra listeye geri getirilemez.',
        confirmLabel: 'Yoksay',
        danger: true,
      });
      if (!ok) return;
    }
    const done = await setStatus(item, 'DISMISSED');
    if (!done) return;
    if (UNDOABLE.has(prev)) {
      toast('Fırsat yoksayıldı', {
        action: { label: 'Geri al', onClick: () => { void setStatus(item, prev); } },
      });
    }
  };

  const visible = items.filter((i) => showDismissed || i.status !== 'DISMISSED');

  if (allowed === false) {
    return (
      <PlanLockedCard
        requirement={requirementFor('contentOpportunities')}
        description="AI aramalarında kaybettiğin sorguları fırsata çevirir: makale üret, yayınla, yeniden ölç, kanıtı gör."
      />
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={Lightbulb}
        title="İçerik Fırsatları"
        description={<>AI aramalarında <strong>kaybettiğin</strong> sorgular fırsata dönüşür: makale üret → yayınla → yeniden ölç → kanıtı gör.</>}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setShowDismissed((v) => !v)} aria-pressed={showDismissed}>
              {showDismissed ? 'Yoksayılanları gizle' : 'Yoksayılanları göster'}
            </Button>
            <Button size="sm" onClick={derive} disabled={deriving}>
              {deriving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4 mr-1.5" aria-hidden />}
              Fırsatları tara
            </Button>
          </>
        }
      />

      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Fırsatlar yükleniyor">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="p-4 space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center space-y-3">
            <Lightbulb className="h-10 w-10 mx-auto text-muted-foreground/40" aria-hidden />
            <p className="text-sm text-muted-foreground">
              Henüz fırsat yok. Önce <Link href={siteHref(site.id, 'geoLab')} className="underline">GEO Lab</Link>&apos;de
              sorgularını çalıştır, sonra &quot;Fırsatları tara&quot;ya bas.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((item) => {
            const cov = COVERAGE_BADGE[item.coverage] ?? COVERAGE_BADGE.MISSING;
            const src = SOURCE_LABEL[item.source] ?? SOURCE_LABEL.manual;
            const SrcIcon = src.icon;
            const meta = item.meta ?? {};
            const remeasureResult = item.remeasureResult;
            const providersLost: string[] = Array.isArray(item.providersLost) ? item.providersLost : [];
            return (
              <Card key={item.id} className={cn(item.status === 'DISMISSED' && 'opacity-50')}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0 space-y-1">
                      {/* Tek rozet (kapsama) + sade meta satiri — eskiden 3-4 minik rozet yan yanaydi */}
                      <div className="flex items-center gap-2 flex-wrap text-label text-muted-foreground">
                        <Badge variant={cov.variant} className="text-label">{cov.text}</Badge>
                        <span className="inline-flex items-center gap-1">
                          <SrcIcon className="h-3 w-3" aria-hidden />{src.text}
                        </span>
                        {item.status !== 'OPEN' && <span>· {STATUS_LABEL[item.status] ?? item.status}</span>}
                        {typeof item.score === 'number' && item.score > 0 && (
                          <span className="tabular-nums">· öncelik {item.score}/100</span>
                        )}
                      </div>
                      <div className="font-semibold text-sm">{item.title}</div>
                      <div className="text-xs text-muted-foreground">
                        Sorgu: <span className="font-mono">"{item.query}"</span>
                        {typeof meta.citedRate === 'number' && (
                          <> · son 14 günde alıntılanma: <strong>{formatPct(meta.citedRate, 0)}</strong> ({meta.cited}/{meta.total})</>
                        )}
                      </div>
                      {providersLost.length > 0 && (
                        <div className="text-label text-muted-foreground">
                          Kaybedilen sağlayıcılar: {providersLost.join(', ')}
                        </div>
                      )}
                      {item.article && (
                        <div className="text-xs">
                          → Makale:{' '}
                          <Link href={`${siteHref(site.id, 'articles')}/${item.article.id}`} className="underline text-brand">
                            {item.article.title}
                          </Link>{' '}
                          <span className="text-muted-foreground">({label(ARTICLE_STATUS_LABEL, item.article.status)})</span>
                        </div>
                      )}
                      {remeasureResult && (
                        <div className="text-xs rounded-md bg-muted/50 px-2.5 py-1.5 inline-block">
                          Yeniden ölçüm:{' '}
                          {remeasureResult.before
                            ? <>{remeasureResult.before.cited}/{remeasureResult.before.total} → </>
                            : <span className="text-muted-foreground">(öncesiyle kıyaslanamaz — ölçüm yöntemi değişti) </span>}
                          <strong>{remeasureResult.after?.cited}/{remeasureResult.after?.total}</strong>
                          {typeof remeasureResult.dayCount === 'number' && (
                            <> · {remeasureResult.dayCount} gün / {(remeasureResult.followUpsDone ?? 0) + 1} ölçüm</>
                          )}
                          {remeasureResult.verdict === 'PRELIMINARY' && (
                            <span
                              className="ml-1.5 rounded-full border border-warning/30 bg-warning/10 text-warning px-1.5 py-0.5 text-label font-semibold"
                              title="Kesin hüküm için en az 2 farklı günde 6 ölçüm gerekir — tek günün tek koşumu AI cevaplarının günlük oynaklığını yansıtmaz. Takip ölçümleri sonraki günlerde otomatik koşar, kotanı tüketmez."
                            >
                              ön sonuç — ölçüm birikiyor
                            </span>
                          )}
                          {Array.isArray(remeasureResult.wonProviders) && remeasureResult.wonProviders.length > 0 && (
                            <> · kazanılan: {remeasureResult.wonProviders.join(', ')}</>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-1.5 shrink-0">
                      {(item.status === 'OPEN' || item.status === 'PLANNED') && !item.articleId && (
                        <Button size="sm" onClick={() => generate(item)} disabled={busy !== null}>
                          {busy === item.id ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <FileText className="h-3.5 w-3.5 mr-1.5" />}
                          Makale üret
                        </Button>
                      )}
                      {(item.status === 'PUBLISHED' || item.status === 'GENERATED' || (item.status === 'REMEASURED' && remeasureResult?.verdict === 'PRELIMINARY')) && item.promptId && (
                        <Button size="sm" variant="outline" onClick={() => remeasure(item)} disabled={busy !== null}>
                          {busy === item.id ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Repeat className="h-3.5 w-3.5 mr-1.5" />}
                          Yeniden ölç
                        </Button>
                      )}
                      {item.status !== 'DISMISSED' && item.status !== 'REMEASURED' && (
                        <Button size="sm" variant="ghost" onClick={() => dismiss(item)}>
                          <X className="h-3.5 w-3.5 mr-1" aria-hidden /> Yoksay
                        </Button>
                      )}
                      {item.status === 'DISMISSED' && !item.articleId && (
                        <Button size="sm" variant="ghost" onClick={() => setStatus(item, 'OPEN')}>
                          <Undo2 className="h-3.5 w-3.5 mr-1" aria-hidden /> Geri aç
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
