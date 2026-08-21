'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Bot, Sparkles, Heart, PieChart, Activity, Flame } from 'lucide-react';

/**
 * AI KPI Şeridi — Overview'un üst bloğu.
 * Mention Rate / Sentiment / Share of Voice / AI crawler ziyaretleri,
 * 7 günlük delta + 14 günlük mini sparkline. Veri hazır tablolardan gelir,
 * yeni ölçüm KOŞMAZ (maliyetsiz).
 */

function Spark({ series, color }: { series: Array<{ value: number }>; color: string }) {
  if (!series || series.length < 2) return null;
  const vals = series.map((s) => s.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const w = 72;
  const h = 22;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * w},${h - ((v - min) / range) * (h - 4) - 2}`).join(' ');
  return (
    <svg width={w} height={h} className="opacity-80">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Delta({ value, suffix = 'pp' }: { value: number | null; suffix?: string }) {
  if (value === null || value === 0) return null;
  const up = value > 0;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[10px] font-semibold', up ? 'text-emerald-500' : 'text-red-500')}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? '+' : ''}{value}{suffix}
    </span>
  );
}

export function AiKpiStrip({ siteId }: { siteId: string }) {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    api.getAiKpis(siteId).then(setData).catch(() => {});
  }, [siteId]);

  if (!data) return null;

  // Manset sayilar artik yalnizca MARKASIZ sorulardan geliyor. Marka adi
  // sorunun icinde gecince asistanin markayi anmasi neredeyse totolojik;
  // ikisi ayni havuzda toplandiginda sayi gorunurlugu degil soru bilesimini
  // olcuyordu. Markali sorular "taninirlik" olarak alt satirda gosteriliyor.
  const brandedMention = data.brandedMentionRate?.value ?? null;
  const mix = data.queryMix as { branded: number; unbranded: number } | undefined;

  const tiles: Array<{
    key: string; label: string; icon: any; color: string;
    value: string; delta: number | null; deltaSuffix?: string;
    series: any[]; href?: string; note?: string; title?: string;
  }> = [
    {
      key: 'mention', label: 'Mention Rate (markasız)', icon: Sparkles, color: '#f97316',
      value: data.mentionRate.value !== null ? `${data.mentionRate.value}%` : '—',
      delta: data.mentionRate.deltaPct, series: data.mentionRate.series,
      href: 'geo-lab',
      note: brandedMention !== null ? `Markalı sorularda %${brandedMention}` : undefined,
      title:
        'Marka adı sorunun içinde geçmeyen sorulardaki anılma oranı — asıl görünürlük ölçüsü budur. ' +
        'Marka adı geçen sorularda asistanın markayı anması beklenen bir sonuç olduğu için ayrı tutulur.' +
        (mix ? ` Son 7 gün: ${mix.unbranded} markasız, ${mix.branded} markalı ölçüm.` : ''),
    },
    {
      key: 'sentiment', label: 'Sentiment (7g)', icon: Heart, color: '#ec4899',
      value: data.sentiment.value !== null ? `${data.sentiment.value}%` : '—',
      delta: data.sentiment.deltaPct, series: data.sentiment.series,
      href: 'visibility',
    },
    {
      key: 'sov', label: 'Share of Voice (7g)', icon: PieChart, color: '#8b5cf6',
      value: data.shareOfVoice.value !== null ? `${data.shareOfVoice.value}%` : '—',
      delta: data.shareOfVoice.deltaPct, series: data.shareOfVoice.series,
      href: 'competitors',
    },
    {
      key: 'crawler', label: 'AI Crawler (7g)', icon: Activity, color: '#06b6d4',
      value: data.aiCrawlerHits.value !== null ? String(data.aiCrawlerHits.value) : '—',
      delta: data.aiCrawlerHits.deltaPct, deltaSuffix: '%', series: data.aiCrawlerHits.series,
      href: 'crawler-live',
    },
    {
      key: 'cite', label: 'Cite Fetch (7g)', icon: Flame, color: '#ef4444',
      value: data.citeFetches?.value !== null && data.citeFetches !== undefined ? String(data.citeFetches.value) : '—',
      delta: data.citeFetches?.deltaPct ?? null, deltaSuffix: '%', series: data.citeFetches?.series ?? [],
      href: 'crawler-live',
    },
    {
      key: 'axo', label: 'Agent Ready', icon: Bot, color: '#22c55e',
      value: data.agentReadiness.score !== null ? `${data.agentReadiness.score}/100` : '—',
      delta: null, series: [],
      href: 'agent-readiness',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {tiles.map((t) => {
        const Icon = t.icon;
        const inner = (
          <Card className="hover:border-brand/40 transition-colors h-full" title={t.title}>
            <CardContent className="p-3.5">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                <Icon className="h-3 w-3" style={{ color: t.color }} /> {t.label}
              </div>
              <div className="flex items-end justify-between gap-2">
                <div>
                  <div className="text-xl font-bold leading-none">{t.value}</div>
                  <div className="mt-1 h-3.5"><Delta value={t.delta} suffix={t.deltaSuffix} /></div>
                </div>
                <Spark series={t.series} color={t.color} />
              </div>
              {t.note && (
                <div className="mt-1.5 text-[10px] text-muted-foreground leading-none">{t.note}</div>
              )}
            </CardContent>
          </Card>
        );
        return t.href ? (
          <Link key={t.key} href={`/sites/${siteId}/${t.href}` as any}>{inner}</Link>
        ) : (
          <div key={t.key}>{inner}</div>
        );
      })}
    </div>
  );
}
