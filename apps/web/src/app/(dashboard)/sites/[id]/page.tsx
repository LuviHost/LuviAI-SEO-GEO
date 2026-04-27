'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';

export default function SitePage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const onboardingMode = searchParams.get('onboarding') === 'running';

  const [site, setSite] = useState<any>(null);
  const [audit, setAudit] = useState<any>(null);
  const [queue, setQueue] = useState<any>(null);
  const [articles, setArticles] = useState<any[]>([]);
  const [tab, setTab] = useState<'audit' | 'topics' | 'articles'>('audit');

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
    } catch {}
  };

  useEffect(() => {
    refresh();
    if (onboardingMode) {
      const interval = setInterval(refresh, 5000);
      return () => clearInterval(interval);
    }
  }, [id, onboardingMode]);

  if (!site) return <div className="p-8">Yükleniyor...</div>;

  return (
    <div>
      <div className="mb-6">
        <Link href="/dashboard" className="text-sm text-slate-500 hover:text-brand">← Dashboard</Link>
        <h1 className="text-3xl font-bold mt-2">{site.name}</h1>
        <p className="text-slate-600 text-sm">{site.url}</p>
      </div>

      {onboardingMode && site.status !== 'ACTIVE' && (
        <div className="mb-6 bg-brand/5 border border-brand/20 rounded-lg p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-3 h-3 bg-brand rounded-full animate-pulse" />
            <h3 className="font-bold text-brand">Onboarding çalışıyor</h3>
          </div>
          <p className="text-sm text-slate-600 mb-4">
            Site analiz ediliyor → topic queue oluşturuluyor → ilk makale üretiliyor.
            Bu işlem yaklaşık 5-10 dakika sürer. Bu sayfa otomatik yenilenir.
          </p>
          <div className="space-y-2 text-sm">
            <Step done={!!site.brain} label="1. Brain (marka analizi)" />
            <Step done={!!audit} label="2. Audit (sağlık kontrolü)" />
            <Step done={!!queue} label="3. Topic Queue" />
            <Step done={articles.length > 0} label="4. İlk makale" />
          </div>
        </div>
      )}

      <div className="border-b mb-6">
        <div className="flex gap-1">
          {(['audit', 'topics', 'articles'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 -mb-px border-b-2 ${tab === t ? 'border-brand text-brand' : 'border-transparent text-slate-600'}`}
            >
              {t === 'audit' ? 'Sağlık Audit' : t === 'topics' ? 'Topic Queue' : 'Makaleler'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'audit' && <AuditTab audit={audit} siteId={id} />}
      {tab === 'topics' && <TopicsTab queue={queue} siteId={id} />}
      {tab === 'articles' && <ArticlesTab articles={articles} />}
    </div>
  );
}

function Step({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={done ? 'text-green-600' : 'text-slate-400'}>{done ? '✓' : '○'}</span>
      <span className={done ? 'text-slate-700' : 'text-slate-400'}>{label}</span>
    </div>
  );
}

function AuditTab({ audit, siteId }: { audit: any; siteId: string }) {
  if (!audit) {
    return (
      <div className="bg-white border rounded-xl p-12 text-center">
        <p className="text-slate-500 mb-4">Henüz audit çalıştırılmamış.</p>
        <button
          onClick={() => api.runAuditNow(siteId).then(() => location.reload())}
          className="px-4 py-2 bg-brand text-white rounded-lg"
        >
          Audit Çalıştır
        </button>
      </div>
    );
  }

  const checks = audit.checks ?? {};
  const issues = audit.issues ?? [];
  const fixable = issues.filter((i: any) => i.fixable);

  return (
    <div>
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white border rounded-xl p-6">
          <div className="text-sm text-slate-500">Genel Skor</div>
          <div className="text-4xl font-bold text-brand mt-2">{audit.overallScore}/100</div>
        </div>
        <div className="bg-white border rounded-xl p-6">
          <div className="text-sm text-slate-500">GEO Skor</div>
          <div className="text-4xl font-bold mt-2">{audit.geoScore ?? '-'}/100</div>
        </div>
        <div className="bg-white border rounded-xl p-6">
          <div className="text-sm text-slate-500">Issues</div>
          <div className="text-4xl font-bold mt-2 text-red-600">{issues.length}</div>
        </div>
      </div>

      {fixable.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6">
          <p className="font-semibold mb-2">⚡ {fixable.length} sorun otomatik düzeltilebilir</p>
          <button
            onClick={() => api.applyAutoFix(siteId, ['sitemap', 'robots', 'llms']).then(() => alert('Auto-fix queue\'ya eklendi'))}
            className="px-4 py-2 bg-brand text-white rounded text-sm"
          >
            Otomatik Düzelt
          </button>
        </div>
      )}

      <div className="bg-white border rounded-xl overflow-hidden">
        <div className="p-4 border-b font-semibold">14 Kontrol Noktası</div>
        <div className="divide-y">
          {Object.entries(checks).filter(([, v]: any) => v?.name).map(([k, v]: any) => (
            <div key={k} className="p-3 flex items-center justify-between text-sm">
              <span className="flex items-center gap-2">
                {v.valid ? '✅' : '❌'} {v.name}
              </span>
              <span className="font-mono">{v.score}/100</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TopicsTab({ queue, siteId }: { queue: any; siteId: string }) {
  if (!queue) {
    return (
      <div className="bg-white border rounded-xl p-12 text-center">
        <p className="text-slate-500 mb-4">Topic queue henüz oluşmadı.</p>
        <button
          onClick={() => api.runTopicEngineNow(siteId).then(() => location.reload())}
          className="px-4 py-2 bg-brand text-white rounded-lg"
        >
          Topic Engine Çalıştır
        </button>
      </div>
    );
  }

  const tier1 = queue.tier1Topics ?? [];

  return (
    <div className="space-y-6">
      <h3 className="font-bold text-lg">🥇 Tier 1 — Hemen Yazılmalı</h3>
      <div className="space-y-3">
        {tier1.map((t: any, i: number) => (
          <div key={i} className="bg-white border rounded-xl p-4">
            <div className="flex justify-between items-start mb-2">
              <span className="text-xs text-brand font-semibold">SKOR {t.score}</span>
              <span className="text-xs text-slate-500">{t.persona}</span>
            </div>
            <div className="font-semibold mb-1">{t.topic}</div>
            <div className="text-xs text-slate-500 mb-3">{t.data_summary}</div>
            <button
              onClick={() => api.generateArticle(siteId, t.topic).then(() => alert('Üretildi! Articles sekmesinde gör.'))}
              className="text-xs px-3 py-1 bg-brand text-white rounded"
            >
              Bu Konuyu Üret →
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function ArticlesTab({ articles }: { articles: any[] }) {
  if (articles.length === 0) {
    return (
      <div className="bg-white border rounded-xl p-12 text-center">
        <p className="text-slate-500">Henüz makale üretilmemiş.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {articles.map(a => (
        <div key={a.id} className="bg-white border rounded-xl p-4">
          <div className="flex justify-between items-start mb-2">
            <h4 className="font-semibold">{a.title}</h4>
            <span className="text-xs px-2 py-1 bg-slate-100 rounded">{a.status}</span>
          </div>
          <div className="text-xs text-slate-500 flex gap-4">
            <span>{a.wordCount} kelime</span>
            <span>{a.readingTime} dk okuma</span>
            <span>{a.persona ?? '-'}</span>
            {a.editorScore && <span>Score: {a.editorScore}/60</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
