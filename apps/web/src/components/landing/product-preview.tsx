'use client';

import { TrendingUp, Bot, FileText, ShieldCheck, Zap, Search, ArrowUp, type LucideIcon } from 'lucide-react';
import { useT } from '@/lib/i18n';

/**
 * Statik urun onizlemesi — HeroLoop videosu yuklenemezse gosterilen JSX mock'u.
 * Videonun gorsel dili buradan uyarlandi; ayni gercek KobiPratik rakamlarini
 * kullanir (bkz. apps/video/src/hero-loop/HeroLoop.tsx). Sayfa metni Turkce/Ingilizce
 * landing sozlugunden; panel ici ornek etiketler urun arayuzu gibi Turkce kalir.
 */
export default function ProductPreview() {
  const { t } = useT();
  return (
    <div className="rounded-2xl border bg-card shadow-2xl shadow-brand-500/10 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b bg-muted/40">
        <div className="flex gap-1.5" aria-hidden>
          <span className="h-3 w-3 rounded-full bg-danger/60" />
          <span className="h-3 w-3 rounded-full bg-warning/60" />
          <span className="h-3 w-3 rounded-full bg-success/60" />
        </div>
        <div className="flex-1 mx-3 px-3 py-1 rounded-md bg-background border text-label font-mono text-muted-foreground text-center truncate">
          ranksup.ai/sites/kobipratik.com
        </div>
        <div className="hidden sm:flex items-center gap-1 text-label text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-success motion-safe:animate-pulse" />
          {t('land.preview.live')}
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_320px]">
        <div className="p-4 sm:p-5 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <MiniStat label="Organik trafik" value="6.5x" note="3 ayda" />
            <MiniStat label="Günlük tıklama" value="340" note="önce 52" />
            <MiniStat label="Aylık gösterim" value="729K" note="önce 80K" />
            <MiniStat label="App Store sıra" value="2.9" note="önce 4.8" />
          </div>

          <div className="rounded-xl border bg-background p-4">
            <div className="text-xs font-semibold">AI görünürlük</div>
            <div className="text-label text-muted-foreground mb-3">ChatGPT · Claude · Gemini · Perplexity</div>
            <CitationChart />
          </div>
        </div>

        <div className="border-t lg:border-t-0 lg:border-l bg-muted/20 p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="h-1.5 w-1.5 rounded-full bg-success motion-safe:animate-pulse" />
            <div className="text-xs font-semibold">{t('land.preview.activity')}</div>
          </div>
          <ul className="space-y-3 text-xs">
            <FeedItem icon={TrendingUp} text="Sıralaman yükseldi: 'ön muhasebe' #8 → #3" />
            <FeedItem icon={Zap} text="Otomatik pilot ASA teklifini güncelledi" />
            <FeedItem icon={FileText} text="Yeni makale taslağı hazır: 'KOBİ vergi takvimi'" />
            <FeedItem icon={ShieldCheck} text="Agent Readiness: llms.txt eklendi" />
            <FeedItem icon={Bot} text="ChatGPT cevabında markan anıldı" />
            <FeedItem icon={Search} text="Site tarandı, ilk anahtar kelimeler çıkarıldı" />
          </ul>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-lg border bg-background p-2.5">
      <div className="text-label uppercase tracking-wider text-muted-foreground truncate">{label}</div>
      <div className="flex items-baseline gap-1.5 mt-0.5">
        <span className="text-base font-bold">{value}</span>
        <span className="inline-flex items-center text-label text-success">
          <ArrowUp className="h-3 w-3" aria-hidden />
          {note}
        </span>
      </div>
    </div>
  );
}

function CitationChart() {
  // Renkler grafik tokenlarindan (globals.css --chart-N) — sabit hex yok
  const lines = [
    { color: 'hsl(var(--chart-1))', points: [30, 28, 35, 32, 40, 45, 42, 50, 55, 58, 62, 70] },
    { color: 'hsl(var(--chart-2))', points: [22, 25, 28, 30, 32, 35, 38, 42, 45, 48, 52, 55] },
    { color: 'hsl(var(--chart-3))', points: [18, 20, 19, 24, 26, 28, 30, 32, 34, 36, 38, 40] },
    { color: 'hsl(var(--chart-7))', points: [12, 14, 15, 17, 19, 22, 24, 26, 28, 30, 32, 35] },
  ];
  const w = 500;
  const h = 110;
  const max = 80;
  const path = (pts: number[]) => {
    const step = w / (pts.length - 1);
    return pts.map((y, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - (y / max) * h).toFixed(1)}`).join(' ');
  };
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-28" aria-hidden>
      {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
        <line key={i} x1="0" x2={w} y1={p * h} y2={p * h} stroke="currentColor" strokeOpacity="0.06" strokeWidth="1" />
      ))}
      {lines.map((l, i) => (
        <path key={i} d={path(l.points)} fill="none" stroke={l.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}

function FeedItem({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <li className="flex gap-2.5">
      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-brand-500/10 text-brand-600">
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
      <span className="leading-snug">{text}</span>
    </li>
  );
}
