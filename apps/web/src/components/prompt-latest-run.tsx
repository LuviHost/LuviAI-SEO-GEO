'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { api, type PromptLatestRun, type PromptLatestRunProvider } from '@/lib/api';
import { PROVIDER_LABELS } from '@/lib/chart-colors';
import { SOURCE_TYPE_LABELS, formatDay, shortUrl } from '@/lib/cited-sources';
import { EngineLogo } from '@/components/engine-logo';
import { Badge } from '@/components/ui/badge';

/**
 * GEO Lab soru satiri — son olcum, asistan bazinda.
 *
 * Satir acilinca once BU gorunur: her asistan siteni kaynak gosterdi mi,
 * adini andi mi, hangi siteleri kaynak gosterdi. Veri GET prompts/:id/latest
 * (AI cagrisi yok, olcum hakki harcamaz). `refreshKey` degisince (satir
 * calistirildi / toplu calistirma ilerledi) yeniden okunur.
 */

const providerName = (p: PromptLatestRunProvider) => PROVIDER_LABELS[p.provider] ?? p.label;

function Verdict({ p }: { p: PromptLatestRunProvider }) {
  // cited = cevapta site adresi ya da linki gecti (kaynak listesinde olmasa da)
  if (p.cited) {
    return (
      <Badge variant="success" className="text-label px-1.5 py-0" title="Cevapta sitenin adresi ya da linki geçti">
        Siteni gösterdi
      </Badge>
    );
  }
  if (p.mentioned) return <Badge variant="warning" className="text-label px-1.5 py-0">Adını andı, link yok</Badge>;
  return <Badge variant="secondary" className="text-label px-1.5 py-0">Anmadı</Badge>;
}

function Sources({ p }: { p: PromptLatestRunProvider }) {
  if (p.sourcesStatus === 'no_search') {
    return <p className="text-label text-muted-foreground">Web araması yapmadı — kendi bilgisinden cevapladı, kaynak listesi yok.</p>;
  }
  if (p.sourcesStatus === 'not_recorded') {
    return <p className="text-label text-muted-foreground">Bu ölçümde kaynak kaydı tutulmuyordu.</p>;
  }
  if (p.sources.length === 0) {
    return <p className="text-label text-muted-foreground">Arama yaptı ama kaynak göstermedi.</p>;
  }
  return (
    <ul className="flex flex-wrap gap-1">
      {p.sources.map((s) => {
        const tone = s.type === 'own'
          ? 'border-success/40 bg-success/10 text-success'
          : s.type === 'competitor'
            ? 'border-warning/40 bg-warning/10 text-warning'
            : 'bg-background text-foreground';
        const tag = s.type === 'own' || s.type === 'competitor' ? SOURCE_TYPE_LABELS[s.type] : null;
        return (
          <li key={s.url}>
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              title={s.title ? `${s.title} — ${shortUrl(s.url, 120)}` : shortUrl(s.url, 120)}
              className={`inline-flex max-w-xs items-center gap-1 rounded border px-1.5 py-0.5 text-label hover:underline ${tone}`}
            >
              <span className="truncate">{s.domain}</span>
              {tag && <span className="shrink-0 opacity-80">· {tag}</span>}
              <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-60" />
            </a>
          </li>
        );
      })}
      {p.moreSources > 0 && (
        <li className="self-center text-label text-muted-foreground">+{p.moreSources} kaynak daha</li>
      )}
    </ul>
  );
}

export function PromptLatestRunView({
  siteId, promptId, refreshKey,
}: {
  siteId: string;
  promptId: string;
  refreshKey?: string | null;
}) {
  const [data, setData] = useState<PromptLatestRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    api.promptLatestRun(siteId, promptId)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setFailed(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [siteId, promptId, refreshKey]);

  if (loading && !data) {
    return (
      <p className="flex items-center gap-1.5 text-label text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Son ölçüm yükleniyor…
      </p>
    );
  }
  if (failed && !data) {
    return <p className="text-label text-muted-foreground">Son ölçüm okunamadı. Sayfayı yenileyip tekrar dene.</p>;
  }
  if (!data || !data.date || data.providers.length === 0) {
    return (
      <p className="text-label text-muted-foreground">
        Bu soru henüz ölçülmedi. Sağdaki ▶ düğmesiyle ya da &quot;Tümünü çalıştır&quot; ile ölç.
      </p>
    );
  }

  const cited = data.providers.filter((p) => p.cited).length;
  const mentioned = data.providers.filter((p) => !p.cited && p.mentioned).length;
  const total = data.providers.length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="text-xs font-semibold">Son ölçüm · {formatDay(data.date)}</p>
        <p className="text-label text-muted-foreground">
          {total} asistandan {cited} tanesi siteni gösterdi (adres ya da link)
          {mentioned > 0 ? `, ${mentioned} tanesi yalnız adını andı` : ''}.
        </p>
      </div>

      <ul className="divide-y rounded-md border bg-background">
        {data.providers.map((p) => (
          <li key={p.provider} className="space-y-1.5 p-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <EngineLogo provider={p.provider} size={14} />
              <span className="text-xs font-medium">{providerName(p)}</span>
              <Verdict p={p} />
              {p.brandInQuery && (
                <span className="text-label text-muted-foreground">· soruda marka adı geçiyor</span>
              )}
              {p.competitors.length > 0 && (
                <span className="text-label text-muted-foreground">
                  · Andığı rakipler: {p.competitors.slice(0, 5).join(', ')}
                </span>
              )}
            </div>
            <Sources p={p} />
            {p.excerpt && (
              <p className="line-clamp-2 text-label text-muted-foreground" title={p.excerpt}>
                “{p.excerpt}”
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
