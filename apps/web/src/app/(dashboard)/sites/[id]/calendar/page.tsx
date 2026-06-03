'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useSiteContext } from '../site-context';
import { ContentCalendarPanel } from '@/components/site-flow-stepper';
import { EmptyState, RelatedLinks } from '@/components/empty-state';
import { Calendar, Sparkles, FileText } from 'lucide-react';
import { api } from '@/lib/api';

export default function CalendarPage() {
  const { site, articles, refresh } = useSiteContext();

  // Sosyal kanal listesi (kullanıcının bağladıkları)
  const [socialChannels, setSocialChannels] = useState<any[]>([]);
  // Per-article social pre-plan: hangi makalede hangi kanalda paylaşılacak
  const [articlePrePlan, setArticlePrePlan] = useState<Record<string, Set<string> | null>>({});
  // Standalone sosyal post'lar — Studio wizard'ından oluşturulan (articleId=NULL) DRAFT/QUEUED
  const [standaloneSocialPosts, setStandaloneSocialPosts] = useState<any[]>([]);
  const [socialPostsTick, setSocialPostsTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.listSocialChannels(site.id)
      .then((rows) => {
        if (!cancelled) setSocialChannels(Array.isArray(rows) ? rows.filter((c: any) => c?.isActive) : []);
      })
      .catch(() => { if (!cancelled) setSocialChannels([]); });
    return () => { cancelled = true; };
  }, [site.id]);

  // Standalone sosyal post'ları çek (articleId yok + scheduledFor var)
  useEffect(() => {
    let cancelled = false;
    api.listSocialPosts(site.id, {})
      .then((rows: any) => {
        if (cancelled) return;
        const filtered = (Array.isArray(rows) ? rows : [])
          .filter((p: any) => !p.articleId && p.scheduledFor &&
            (p.status === 'DRAFT' || p.status === 'QUEUED' || p.status === 'NEEDS_APPROVAL' || p.status === 'PUBLISHED'));
        setStandaloneSocialPosts(filtered);
      })
      .catch(() => { if (!cancelled) setStandaloneSocialPosts([]); });
    return () => { cancelled = true; };
  }, [site.id, socialPostsTick]);

  useEffect(() => {
    setArticlePrePlan((prev) => {
      const next = { ...prev };
      for (const a of (articles ?? [])) {
        if (next[a.id] !== undefined) continue;
        const raw = (a as any).socialPrePlanChannelIds;
        next[a.id] = Array.isArray(raw) ? new Set<string>(raw as string[]) : null;
      }
      return next;
    });
  }, [articles]);

  const isChannelEnabledForArticle = (articleId: string, channelId: string): boolean => {
    const cur = articlePrePlan[articleId];
    if (cur === undefined || cur === null) return true;
    return cur.has(channelId);
  };

  const toggleChannelForArticle = async (articleId: string, channelId: string, articleTitle?: string) => {
    const allActive = socialChannels.map((c) => c.id);
    const cur = articlePrePlan[articleId];
    const set = cur ? new Set(cur) : new Set<string>(allActive);
    if (set.has(channelId)) set.delete(channelId);
    else set.add(channelId);

    setArticlePrePlan((prev) => ({ ...prev, [articleId]: set }));

    const arr = Array.from(set);
    const isAll = arr.length === allActive.length && allActive.every((id) => arr.includes(id));
    try {
      await api.setArticleSocialPrePlan(site.id, articleId, isAll ? null : arr);
      const ch = socialChannels.find((c) => c.id === channelId);
      const channelName = (ch?.type ?? 'kanal').toUpperCase();
      const tShort = (articleTitle ?? '').slice(0, 40) + ((articleTitle ?? '').length > 40 ? '…' : '');
      const titlePart = tShort ? `"${tShort}" → ` : '';
      toast.success(set.has(channelId)
        ? `${titlePart}${channelName}'da paylaşılacak`
        : `${titlePart}${channelName}'dan kaldırıldı`);
    } catch (err: any) {
      toast.error(err.message || 'Kanal tercihi kaydedilemedi');
    }
  };

  const scheduled = (articles ?? []).filter((a: any) => {
    if (a?.status !== 'SCHEDULED') return false;
    if (!a?.scheduledAt) return false;
    const d = new Date(a.scheduledAt);
    return !isNaN(d.getTime());
  });
  const otherCount = (articles ?? []).filter((a: any) => a?.status && a.status !== 'SCHEDULED').length;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 grid place-items-center">
          <Calendar className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-2xl font-bold">İçerik Takvimi</h2>
          <p className="text-sm text-muted-foreground">Planlanmış makaleler (mavi) + standalone sosyal post'lar (mor). Sürükleyip günü değiştir, saatini ayarla.</p>
        </div>
      </div>
      {scheduled.length === 0 && standaloneSocialPosts.length === 0 ? (
        <EmptyState
          icon={Calendar}
          accent="sky"
          title="Takvim boş"
          description="Önerilen Konular'dan makale al, ya da Studio > Sosyal Yayın'dan bir sosyal post oluştur. Hepsi burada görünür."
          primary={{ label: 'Önerilen Konulara git', href: `/sites/${site.id}/topics` }}
          secondary={{ label: 'Studio (Sosyal Yayın)', href: `/sites/${site.id}/studio?tab=publish` }}
        />
      ) : (
        <ContentCalendarPanel
          siteId={site.id}
          scheduled={scheduled}
          otherArticlesCount={otherCount}
          onChanged={() => { refresh(); setSocialPostsTick((t) => t + 1); }}
          socialChannels={socialChannels}
          isChannelEnabledForArticle={isChannelEnabledForArticle}
          toggleChannelForArticle={toggleChannelForArticle}
          standaloneSocialPosts={standaloneSocialPosts}
        />
      )}
      <RelatedLinks
        links={[
          { href: `/sites/${site.id}/topics`, label: 'Önerilen Konular', description: 'Yeni öneri al, takvime sürükle', icon: Sparkles },
          { href: `/sites/${site.id}/articles`, label: 'Makaleler', description: 'Tüm pipeline durumlarını gör', icon: FileText },
        ]}
      />
    </div>
  );
}
