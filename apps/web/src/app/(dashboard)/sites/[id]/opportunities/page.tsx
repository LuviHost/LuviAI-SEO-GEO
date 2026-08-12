'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useSiteContext } from '../site-context';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  Lightbulb, RefreshCw, Loader2, Sparkles, FileText, Repeat,
  X, TrendingUp, MessageSquareWarning,
} from 'lucide-react';

/**
 * İçerik Fırsatları — kapalı döngünün ekranı.
 * Prompt Lab'de KAYBEDİLEN sorgu → fırsat kartı (kanıtıyla) → tek tıkla
 * makale → yayın → yeniden ölçüm → kazandın/kaybettin deltası.
 */

const COVERAGE_BADGE: Record<string, { text: string; cls: string }> = {
  LOST:    { text: 'KAYIP',    cls: 'bg-red-500/10 text-red-600 border-red-500/30' },
  WEAK:    { text: 'ZAYIF',    cls: 'bg-amber-500/10 text-amber-600 border-amber-500/30' },
  MISSING: { text: 'VERİ YOK', cls: 'bg-zinc-500/10 text-zinc-500 border-zinc-500/30' },
  WON:     { text: 'KAZANILDI', cls: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30' },
};

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
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [deriving, setDeriving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);

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

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [site.id]);

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
      await api.generateFromOpportunity(site.id, item.id);
      toast.success('Makale üretimi başladı — İçerikler sayfasından izleyebilirsin');
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

  const dismiss = async (item: any) => {
    try {
      await api.updateOpportunity(site.id, item.id, 'DISMISSED');
      await load();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const visible = items.filter((i) => showDismissed || i.status !== 'DISMISSED');

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 grid place-items-center">
            <Lightbulb className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-2xl font-bold">İçerik Fırsatları</h2>
            <p className="text-sm text-muted-foreground">
              AI aramalarında <strong>kaybettiğin</strong> sorgular içerik fırsatına dönüşür: makale üret → yayınla → yeniden ölç → kanıtı gör.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowDismissed((v) => !v)}>
            {showDismissed ? 'Yoksayılanları gizle' : 'Yoksayılanları göster'}
          </Button>
          <Button onClick={derive} disabled={deriving}>
            {deriving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
            Fırsatları Tara
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground p-6 text-center">Yükleniyor…</div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center space-y-3">
            <Lightbulb className="h-10 w-10 mx-auto text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              Henüz fırsat yok. Önce <Link href={`/sites/${site.id}/geo-lab`} className="underline">GEO Lab</Link>'de
              prompt'larını çalıştır, sonra "Fırsatları Tara"ya bas.
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
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className={cn('text-[10px]', cov.cls)}>{cov.text}</Badge>
                        <Badge variant="outline" className="text-[10px]">
                          <SrcIcon className="h-3 w-3 mr-1" />{src.text}
                        </Badge>
                        <Badge variant="outline" className="text-[10px]">{STATUS_LABEL[item.status] ?? item.status}</Badge>
                        {typeof item.score === 'number' && item.score > 0 && (
                          <span className="text-[10px] font-mono text-muted-foreground">öncelik {item.score}/100</span>
                        )}
                      </div>
                      <div className="font-semibold text-sm">{item.title}</div>
                      <div className="text-xs text-muted-foreground">
                        Sorgu: <span className="font-mono">"{item.query}"</span>
                        {typeof meta.citedRate === 'number' && (
                          <> · son 14g citation: <strong>{Math.round(meta.citedRate * 100)}%</strong> ({meta.cited}/{meta.total})</>
                        )}
                      </div>
                      {providersLost.length > 0 && (
                        <div className="text-[11px] text-muted-foreground">
                          Kaybedilen sağlayıcılar: {providersLost.join(', ')}
                        </div>
                      )}
                      {item.article && (
                        <div className="text-xs">
                          → Makale:{' '}
                          <Link href={`/sites/${site.id}/articles/${item.article.id}`} className="underline text-brand">
                            {item.article.title}
                          </Link>{' '}
                          <span className="text-muted-foreground">({item.article.status})</span>
                        </div>
                      )}
                      {remeasureResult && (
                        <div className="text-xs rounded-md bg-muted/50 px-2.5 py-1.5 inline-block">
                          Yeniden ölçüm: {remeasureResult.before?.cited}/{remeasureResult.before?.total} →{' '}
                          <strong>{remeasureResult.after?.cited}/{remeasureResult.after?.total}</strong>
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
                          Makale Üret
                        </Button>
                      )}
                      {(item.status === 'PUBLISHED' || item.status === 'GENERATED') && item.promptId && (
                        <Button size="sm" variant="outline" onClick={() => remeasure(item)} disabled={busy !== null}>
                          {busy === item.id ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Repeat className="h-3.5 w-3.5 mr-1.5" />}
                          Yeniden Ölç
                        </Button>
                      )}
                      {item.status !== 'DISMISSED' && item.status !== 'REMEASURED' && (
                        <Button size="sm" variant="ghost" onClick={() => dismiss(item)}>
                          <X className="h-3.5 w-3.5 mr-1" /> Yoksay
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
