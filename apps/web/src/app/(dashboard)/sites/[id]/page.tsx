'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowLeft, ExternalLink, CheckCircle2, Circle } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { AnalyticsTab } from '@/components/analytics-tab';
import { SettingsTab } from '@/components/settings-tab';
import { PipelineProgress, PIPELINE_STEPS } from '@/components/pipeline-progress';

export default function SitePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const onboardingMode = searchParams.get('onboarding') === 'running';

  const [site, setSite] = useState<any>(null);
  const [audit, setAudit] = useState<any>(null);
  const [queue, setQueue] = useState<any>(null);
  const [articles, setArticles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const id = params.id as string;

  const refresh = async () => {
    try {
      const [s, a, q, ar] = await Promise.all([
        api.getSite(id),
        api.getLatestAudit(id).catch(() => null),
        api.getTopicQueue(id).catch(() => null),
        api.listArticles(id).catch(() => []),
      ]);
      setSite(s);
      setAudit(a);
      setQueue(q);
      setArticles(ar);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    if (onboardingMode) {
      const interval = setInterval(refresh, 5000);
      return () => clearInterval(interval);
    }
  }, [id, onboardingMode]);

  if (loading || !site) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-32" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/dashboard" className="text-sm text-muted-foreground hover:text-brand inline-flex items-center gap-1">
          <ArrowLeft className="h-3 w-3" /> Dashboard
        </Link>
        <h1 className="text-3xl font-bold mt-2">{site.name}</h1>
        <a
          href={site.url}
          target="_blank"
          rel="noopener"
          className="text-sm text-muted-foreground hover:text-brand inline-flex items-center gap-1 mt-1"
        >
          {site.url} <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {onboardingMode && site.status !== 'ACTIVE' && (
        <Card className="border-brand/30 bg-brand/5">
          <CardContent className="p-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-3 h-3 bg-brand rounded-full animate-pulse" />
              <h3 className="font-bold text-brand">Onboarding çalışıyor</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Brain → Audit → Topic Queue → İlk makale. ~5-10 dk. Bu sayfa otomatik yenilenir.
            </p>
            <div className="space-y-2 text-sm">
              <Step done={!!site.brain} label="1. Brain (marka analizi)" />
              <Step done={!!audit} label="2. Audit (sağlık kontrolü)" />
              <Step done={!!queue} label="3. Topic Queue" />
              <Step done={articles.length > 0} label="4. İlk makale" />
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="audit">
        <div className="overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0 scrollbar-thin">
          <TabsList className="w-max sm:w-auto">
            <TabsTrigger value="audit">Sağlık Audit</TabsTrigger>
            <TabsTrigger value="topics">Topic Queue</TabsTrigger>
            <TabsTrigger value="articles">Makaleler ({articles.length})</TabsTrigger>
            <TabsTrigger value="analytics">📊 Analytics</TabsTrigger>
            <TabsTrigger value="settings">⚙️ Ayarlar</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="audit"><AuditTab audit={audit} siteId={id} onRefresh={refresh} /></TabsContent>
        <TabsContent value="topics"><TopicsTab queue={queue} siteId={id} onRefresh={refresh} /></TabsContent>
        <TabsContent value="articles"><ArticlesTab articles={articles} siteId={id} /></TabsContent>
        <TabsContent value="analytics"><AnalyticsTab siteId={id} /></TabsContent>
        <TabsContent value="settings"><SettingsTab siteId={id} /></TabsContent>
      </Tabs>
    </div>
  );
}

function Step({ done, label }: { done: boolean; label: string }) {
  const Icon = done ? CheckCircle2 : Circle;
  return (
    <div className="flex items-center gap-2 text-sm">
      <Icon className={`h-4 w-4 ${done ? 'text-green-500' : 'text-muted-foreground/50'}`} />
      <span className={done ? '' : 'text-muted-foreground'}>{label}</span>
    </div>
  );
}

function AuditTab({ audit, siteId, onRefresh }: { audit: any; siteId: string; onRefresh: () => void }) {
  const [running, setRunning] = useState(false);
  const [fixing, setFixing] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      await api.runAuditNow(siteId);
      toast.success('Audit tamamlandı');
      onRefresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRunning(false);
    }
  };

  if (!audit) {
    return (
      <div className="space-y-4">
        {!running && (
          <Card>
            <CardContent className="p-12 text-center">
              <p className="text-muted-foreground mb-4">Henüz audit çalıştırılmamış.</p>
              <Button onClick={run}>Audit Çalıştır</Button>
              <p className="text-xs text-muted-foreground mt-3">
                Yaklaşık 30 saniye sürer. Site sayfaları taranır, 14 SEO kontrolü yapılır.
              </p>
            </CardContent>
          </Card>
        )}
        <PipelineProgress
          title="Sağlık Audit çalışıyor"
          steps={PIPELINE_STEPS.audit}
          running={running}
        />
      </div>
    );
  }

  const checks = audit.checks ?? {};
  const issues = audit.issues ?? [];
  const fixable = issues.filter((i: any) => i.fixable);

  const applyFix = async () => {
    setFixing(true);
    try {
      await api.applyAutoFix(siteId, ['sitemap', 'robots', 'llms']);
      toast.success("Auto-fix queue'ya eklendi — yayın hedefine yükleniyor");
      setTimeout(() => {
        onRefresh();
        setFixing(false);
      }, 25000);
    } catch (err: any) {
      toast.error(err.message);
      setFixing(false);
    }
  };

  return (
    <div className="space-y-4">
      {(running || fixing) && (
        <PipelineProgress
          title={running ? 'Audit yeniden çalışıyor' : 'Otomatik düzeltme uygulanıyor'}
          steps={running ? PIPELINE_STEPS.audit : PIPELINE_STEPS.autoFix}
          running={running || fixing}
        />
      )}

      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={run} disabled={running || fixing}>
          {running ? 'Çalışıyor…' : 'Audit\'i Yenile'}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">Genel Skor</div>
            <div className="text-4xl font-bold text-brand mt-1">{audit.overallScore}/100</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">GEO Skor</div>
            <div className="text-4xl font-bold mt-1">{audit.geoScore ?? '-'}/100</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="text-sm text-muted-foreground">Issues</div>
            <div className="text-4xl font-bold mt-1 text-red-500">{issues.length}</div>
          </CardContent>
        </Card>
      </div>

      {fixable.length > 0 && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="p-4 flex items-center justify-between flex-wrap gap-3">
            <p className="font-semibold">⚡ {fixable.length} sorun otomatik düzeltilebilir</p>
            <Button size="sm" onClick={applyFix}>Otomatik Düzelt</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <h3 className="font-semibold">14 Kontrol Noktası</h3>
        </CardHeader>
        <CardContent className="p-0">
          <div className="divide-y">
            {Object.entries(checks)
              .filter(([, v]: any) => v?.name)
              .map(([k, v]: any) => (
                <div key={k} className="px-5 py-3 flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2">
                    {v.valid ? <CheckCircle2 className="h-4 w-4 text-green-500" /> : <Circle className="h-4 w-4 text-red-500" />}
                    {v.name}
                  </span>
                  <span className="font-mono text-muted-foreground">{v.score}/100</span>
                </div>
              ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TopicsTab({ queue, siteId, onRefresh }: { queue: any; siteId: string; onRefresh: () => void }) {
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    try {
      await api.runTopicEngineNow(siteId);
      toast.success('Topic engine bitti');
      onRefresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRunning(false);
    }
  };

  const [generating, setGenerating] = useState<string | null>(null);

  const generate = async (topic: string) => {
    setGenerating(topic);
    try {
      await api.generateArticle(siteId, topic);
      toast.success('Makale üretildi! Articles sekmesinde gör.');
      onRefresh();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setGenerating(null);
    }
  };

  if (!queue) {
    return (
      <div className="space-y-4">
        {!running && (
          <Card>
            <CardContent className="p-12 text-center">
              <p className="text-muted-foreground mb-4">Topic queue henüz oluşmadı.</p>
              <Button onClick={run}>Topic Engine Çalıştır</Button>
              <p className="text-xs text-muted-foreground mt-3">
                Yaklaşık 60 saniye sürer. Plan + GSC + AI search + rakip analizinden konu sıralanır.
              </p>
            </CardContent>
          </Card>
        )}
        <PipelineProgress
          title="Topic Engine çalışıyor"
          steps={PIPELINE_STEPS.topicEngine}
          running={running}
        />
      </div>
    );
  }

  const tier1 = queue.tier1Topics ?? [];

  return (
    <div className="space-y-4">
      {generating && (
        <PipelineProgress
          title={`Makale üretiliyor: "${generating.slice(0, 60)}${generating.length > 60 ? '…' : ''}"`}
          steps={PIPELINE_STEPS.article}
          running={true}
        />
      )}

      <div className="flex justify-between items-center flex-wrap gap-3">
        <h3 className="font-bold text-lg">🥇 Tier 1 — Hemen Yazılmalı</h3>
        <Button size="sm" variant="outline" onClick={run} disabled={running}>
          {running ? 'Yenileniyor…' : 'Topic Engine\'i Yenile'}
        </Button>
      </div>

      {running && (
        <PipelineProgress
          title="Topic Engine yeniden çalışıyor"
          steps={PIPELINE_STEPS.topicEngine}
          running={running}
        />
      )}

      <div className="grid gap-3">
        {tier1.map((t: any, i: number) => {
          const isThis = generating === t.topic;
          return (
            <Card key={i} className={isThis ? 'ring-2 ring-brand' : ''}>
              <CardContent className="p-4">
                <div className="flex justify-between items-start mb-2 gap-2">
                  <Badge>SKOR {t.score}</Badge>
                  <span className="text-xs text-muted-foreground">{t.persona}</span>
                </div>
                <h4 className="font-semibold mb-1">{t.topic}</h4>
                <p className="text-xs text-muted-foreground mb-3">{t.data_summary}</p>
                <Button
                  size="sm"
                  onClick={() => generate(t.topic)}
                  disabled={!!generating}
                >
                  {isThis ? 'Üretiliyor…' : 'Bu konuyu üret →'}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ArticlesTab({ articles, siteId }: { articles: any[]; siteId: string }) {
  if (articles.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-muted-foreground">
          Henüz makale üretilmemiş.
        </CardContent>
      </Card>
    );
  }

  const STATUS_VARIANT: Record<string, any> = {
    DRAFT: 'secondary',
    GENERATING: 'warning',
    EDITING: 'warning',
    REVIZE_NEEDED: 'destructive',
    READY_TO_PUBLISH: 'default',
    PUBLISHED: 'success',
    FAILED: 'destructive',
    ARCHIVED: 'outline',
  };

  return (
    <div className="space-y-3">
      {articles.map((a) => (
        <Link key={a.id} href={`/sites/${siteId}/articles/${a.id}` as any} className="block">
          <Card className="hover:border-brand/50 hover:shadow-sm transition-all cursor-pointer">
            <CardContent className="p-4">
              <div className="flex justify-between items-start mb-2 gap-2 flex-wrap">
                <h4 className="font-semibold flex-1 min-w-0">{a.title}</h4>
                <Badge variant={STATUS_VARIANT[a.status] ?? 'secondary'}>{a.status}</Badge>
              </div>
              <div className="text-xs text-muted-foreground flex gap-4 flex-wrap items-center">
                {a.wordCount && <span>{a.wordCount} kelime</span>}
                {a.readingTime && <span>{a.readingTime} dk okuma</span>}
                {a.persona && <span>{a.persona}</span>}
                {a.editorScore != null && <span>Editör: {a.editorScore}/60</span>}
                <span className="ml-auto text-brand font-medium">Aç →</span>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
