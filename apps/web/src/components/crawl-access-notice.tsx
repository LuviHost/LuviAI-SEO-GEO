'use client';

import { RefreshCw } from 'lucide-react';
import { StatusBanner } from '@/components/ui/status-banner';
import { Button } from '@/components/ui/button';
import { crawlAccessTitle, type CrawlAccess } from '@/lib/crawl-access';

function formatWhen(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return null;
  return d.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * "Erişim engellendi" / "Siteye ulaşılamadı" durumu — skor yerine gösterilir.
 * Neden (reason) ve site sahibinin yapacağı (hint) API'den gelir.
 */
export function CrawlAccessNotice({
  access,
  onRetry,
  retrying,
  staleScoreAt,
  compact,
  className,
}: {
  access: CrawlAccess;
  /** Verilirse "Tekrar dene" düğmesi çıkar */
  onRetry?: () => void;
  retrying?: boolean;
  /** Bu denemeden önce hesaplanmış bir skor varsa tarihi — güncel olmadığını söyleriz */
  staleScoreAt?: string | Date | null;
  /** Özet kartlarında kısa sürüm */
  compact?: boolean;
  className?: string;
}) {
  const when = formatWhen(access.at);
  const staleWhen = formatWhen(staleScoreAt);
  return (
    <StatusBanner
      tone={access.state === 'blocked' ? 'warning' : 'danger'}
      title={crawlAccessTitle(access)}
      className={className}
      action={
        onRetry ? (
          <Button size="sm" variant="outline" onClick={onRetry} disabled={retrying} aria-busy={retrying}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${retrying ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />
            {retrying ? 'Deneniyor…' : 'Tekrar dene'}
          </Button>
        ) : undefined
      }
    >
      <p>{access.reason}</p>
      {access.hint && <p className="mt-1 font-medium text-foreground">{access.hint}</p>}
      {!compact && (
        <p className="mt-2 text-label">
          {access.kind === 'robots'
            ? 'robots.txt kuralı nedeniyle site taranmadı; bu yüzden site skoru hesaplanmadı.'
            : access.state === 'blocked'
              ? 'Tarayıcımız siteyi okuyamadığı için site skoru hesaplanmadı; engel sayfasını sitenin kendisi gibi puanlamak yanıltıcı olurdu.'
              : 'Tarayıcımız siteye ulaşamadığı için site skoru hesaplanmadı; okunamayan bir siteyi puanlamak yanıltıcı olurdu.'}
          {staleWhen && ` Önceki skor (${staleWhen}) bu denemeden önce hesaplandı ve güncel durumu yansıtmıyor.`}
          {when && ` Son deneme: ${when}.`}
        </p>
      )}
    </StatusBanner>
  );
}
