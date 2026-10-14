import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { Bot, FileText, Search, ShieldCheck, TrendingUp, Zap, Check, ArrowUp } from 'lucide-react';
import { alpha, brand, fontMono, fontSans, themes, type Theme, type ThemeName } from '../tokens';
import { Card, Pill, progress } from '../ui';

/**
 * HeroLoop — landing hero'sundaki sessiz, donguye giren urun videosu (20 sn).
 *
 * Gorsel dil apps/web/src/app/page.tsx'teki eski JSX ProductPreview'dan (MiniStat,
 * CitationChart, KeywordRow, FeedItem) uyarlandi. KPI kutularindaki rakamlar YALNIZ
 * olculmus KobiPratik vakasindan gelir (landing "Sonuclar" bolumu ile ayni kaynak):
 *   - organik trafik 6.5x — Search Console, gunde 52 -> 340 tiklama
 *   - aylik gosterim 79.852 -> 728.565 (~729K)
 *   - App Store ortalama sirasi 4.8 -> 2.9 (app_rankings, 1.264 olcum)
 * Anahtar kelime merdiveni ve ASA karti "Ornek ekran" etiketiyle gosterilir; ASA
 * kartinda rakam yoktur (uydurma metrik basilmaz).
 *
 * Kusursuz dongu: kare 0 ile son kare ayni "bos" durumdadir — dinamik ogeler
 * 555-590 arasinda sonumlenir, URL silinir.
 */

export type HeroLoopProps = { theme: ThemeName };

export const HERO_LOOP_FPS = 30;
export const HERO_LOOP_DURATION = 600; // 20 sn

const URL_TEXT = 'kobipratik.com';
const TYPE_START = 20;
const TYPE_FRAMES_PER_CHAR = 4;
const RESET_START = 555;
const RESET_END = 590;

export const HeroLoop: React.FC<HeroLoopProps> = ({ theme: themeName }) => {
  const theme = themes[themeName];
  const frame = useCurrentFrame();
  // r: tum dinamik icerigin gorunurluk carpani (dongu sonunda 0'a iner)
  const r = 1 - progress(frame, RESET_START, RESET_END);

  return (
    <AbsoluteFill
      style={{
        background: theme.background,
        fontFamily: fontSans,
        color: theme.foreground,
      }}
    >
      {/* Arka plan duz tema zemini: video sayfaya kenar izi birakmadan oturur
          (landing'de ayni background token'i uzerinde oynar). */}
      <div
        style={{
          position: 'absolute',
          left: 70,
          top: 60,
          width: 1780,
          height: 960,
          borderRadius: 28,
          background: theme.card,
          border: `1.5px solid ${theme.border}`,
          boxShadow:
            theme.name === 'dark'
              ? '0 40px 120px rgba(0,0,0,0.45)'
              : `0 40px 120px ${alpha(brand[500], 0.12)}, 0 10px 30px rgba(15,23,42,0.06)`,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <BrowserBar theme={theme} frame={frame} r={r} />
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          <div style={{ flex: 1, padding: 32, display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0 }}>
            <KpiRow theme={theme} frame={frame} r={r} />
            <CitationCard theme={theme} frame={frame} r={r} />
            <div style={{ display: 'flex', gap: 24, height: 282 }}>
              <KeywordCard theme={theme} frame={frame} r={r} />
              <AsaCard theme={theme} frame={frame} r={r} />
            </div>
          </div>
          <Feed theme={theme} frame={frame} r={r} />
        </div>
      </div>
    </AbsoluteFill>
  );
};

/* ───────────────────────── Tarayici cubugu ───────────────────────── */

function BrowserBar({ theme, frame, r }: { theme: Theme; frame: number; r: number }) {
  const typed = Math.floor(
    interpolate(frame, [TYPE_START, TYPE_START + URL_TEXT.length * TYPE_FRAMES_PER_CHAR], [0, URL_TEXT.length], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );
  const erased = Math.floor(
    interpolate(frame, [RESET_START, RESET_START + 30], [0, URL_TEXT.length], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );
  const visible = URL_TEXT.slice(0, Math.max(0, typed - erased));
  const caretOn = Math.floor(frame / 15) % 2 === 0;
  // Tarama cizgisi: yazma bittikten sonra
  const crawl = progress(frame, 82, 118) * r;
  const live = 0.55 + 0.45 * Math.abs(Math.sin((frame * Math.PI) / 30));

  return (
    <div
      style={{
        height: 76,
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        padding: '0 28px',
        borderBottom: `1.5px solid ${theme.border}`,
        background: alpha(theme.name === 'dark' ? '#0f172a' : '#f1f5f9', 0.6),
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', gap: 10 }}>
        {[theme.danger, theme.warning, theme.success].map((c, i) => (
          <span key={i} style={{ width: 16, height: 16, borderRadius: 99, background: alpha(c, 0.7) }} />
        ))}
      </div>
      <div
        style={{
          flex: 1,
          maxWidth: 940,
          margin: '0 auto',
          height: 44,
          borderRadius: 12,
          background: theme.background,
          border: `1.5px solid ${theme.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: fontMono,
          fontSize: 22,
          color: theme.mutedForeground,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <span>ranksup.ai/sites/</span>
        <span style={{ color: theme.foreground, fontWeight: 600 }}>{visible}</span>
        <span
          style={{
            width: 2,
            height: 26,
            marginLeft: 2,
            background: brand[500],
            opacity: caretOn ? 1 : 0,
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 0,
            bottom: 0,
            height: 3,
            width: `${crawl * 100}%`,
            background: brand[500],
            opacity: crawl > 0 && crawl < 0.999 ? 1 : 0,
          }}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 18, fontWeight: 700, color: theme.mutedForeground, letterSpacing: '0.08em' }}>
        <span style={{ width: 10, height: 10, borderRadius: 99, background: theme.success, opacity: live }} />
        CANLI
      </div>
    </div>
  );
}

/* ───────────────────────── KPI kutulari ───────────────────────── */

type Kpi = {
  label: string;
  from: number;
  to: number;
  format: (v: number) => string;
  before: string;
  /** Kucuk deger iyiyse (siralama) yesil ok asagi degil yukari anlaminda */
  source: string;
};

const KPIS: Kpi[] = [
  { label: 'ORGANİK TRAFİK', from: 1, to: 6.5, format: (v) => `${v.toFixed(1)}x`, before: '3 ayda', source: 'KobiPratik' },
  { label: 'GÜNLÜK TIKLAMA', from: 52, to: 340, format: (v) => `${Math.round(v)}`, before: 'önce 52', source: 'Search Console' },
  { label: 'AYLIK GÖSTERİM', from: 79.852, to: 728.565, format: (v) => `${Math.round(v)}K`, before: 'önce 80K', source: 'son 30 gün' },
  { label: 'APP STORE ORT. SIRA', from: 4.8, to: 2.9, format: (v) => v.toFixed(1), before: 'önce 4.8', source: '1.264 ölçüm' },
];

function KpiRow({ theme, frame, r }: { theme: Theme; frame: number; r: number }) {
  const { fps } = useVideoConfig();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 20, height: 150 }}>
      {KPIS.map((k, i) => {
        const start = 100 + i * 12;
        const appear = spring({ frame: frame - start, fps, config: { damping: 200 } }) * r;
        const count = progress(frame, start, start + 60);
        const value = k.from + (k.to - k.from) * count;
        return (
          <div
            key={k.label}
            style={{
              borderRadius: 18,
              border: `1.5px solid ${theme.border}`,
              background: theme.background,
              padding: '20px 24px',
              position: 'relative',
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 600, color: theme.mutedForeground, letterSpacing: '0.04em' }}>
              {k.label}
            </div>
            {/* yer tutucu iskelet — icerik gelmeden once */}
            <div
              style={{
                position: 'absolute',
                left: 24,
                top: 66,
                width: 140,
                height: 40,
                borderRadius: 10,
                background: theme.muted,
                opacity: 1 - appear,
              }}
            />
            <div style={{ opacity: appear, transform: `translateY(${(1 - appear) * 10}px)` }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 8 }}>
                <span style={{ fontSize: 48, fontWeight: 800, letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>
                  {k.format(value)}
                </span>
                <span style={{ fontSize: 18, fontWeight: 700, color: theme.success, display: 'inline-flex', alignItems: 'center', gap: 2, whiteSpace: 'nowrap' }}>
                  <ArrowUp size={18} strokeWidth={3} />
                  {k.before}
                </span>
              </div>
              <div style={{ fontSize: 16, color: theme.mutedForeground, marginTop: 2 }}>{k.source}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ───────────────────────── AI gorunurluk grafigi ───────────────────────── */

const ENGINE_LINES: Array<{ name: string; points: number[] }> = [
  { name: 'ChatGPT', points: [30, 28, 35, 32, 40, 45, 42, 50, 55, 58, 62, 70] },
  { name: 'Claude', points: [22, 25, 28, 30, 32, 35, 38, 42, 45, 48, 52, 55] },
  { name: 'Gemini', points: [18, 20, 19, 24, 26, 28, 30, 32, 34, 36, 38, 40] },
  { name: 'Perplexity', points: [12, 14, 15, 17, 19, 22, 24, 26, 28, 30, 32, 35] },
];

function CitationCard({ theme, frame, r }: { theme: Theme; frame: number; r: number }) {
  const w = 1160;
  const h = 210;
  const max = 80;
  const path = (pts: number[]) => {
    const step = w / (pts.length - 1);
    return pts.map((y, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - (y / max) * h).toFixed(1)}`).join(' ');
  };
  const areaP = progress(frame, 230, 290) * r;

  return (
    <Card theme={theme} style={{ height: 340, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>AI görünürlük</div>
          <div style={{ fontSize: 18, color: theme.mutedForeground, marginTop: 2 }}>4 AI motorunda markanın anılma eğilimi</div>
        </div>
        <div style={{ display: 'flex', gap: 22 }}>
          {ENGINE_LINES.map((l, i) => {
            const on = progress(frame, 170 + i * 18, 190 + i * 18) * r;
            return (
              <span key={l.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 18, fontWeight: 600, opacity: 0.35 + 0.65 * on }}>
                <span style={{ width: 12, height: 12, borderRadius: 99, background: theme.chart[i] }} />
                {l.name}
              </span>
            );
          })}
        </div>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', flex: 1 }} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`hl-area-${theme.name}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={brand[500]} stopOpacity={0.22} />
            <stop offset="100%" stopColor={brand[500]} stopOpacity={0} />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((p) => (
          <line key={p} x1={0} x2={w} y1={p * h} y2={p * h} stroke={theme.border} strokeWidth={1.5} />
        ))}
        <path d={`${path(ENGINE_LINES[0].points)} L${w},${h} L0,${h} Z`} fill={`url(#hl-area-${theme.name})`} opacity={areaP} />
        {ENGINE_LINES.map((l, i) => {
          const draw = progress(frame, 170 + i * 18, 250 + i * 18);
          return (
            <path
              key={l.name}
              d={path(l.points)}
              fill="none"
              stroke={theme.chart[i]}
              strokeWidth={4}
              strokeLinecap="round"
              strokeLinejoin="round"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={1 - draw}
              opacity={r}
            />
          );
        })}
      </svg>
    </Card>
  );
}

/* ───────────────────────── Anahtar kelime merdiveni ───────────────────────── */

function KeywordCard({ theme, frame, r }: { theme: Theme; frame: number; r: number }) {
  const { fps } = useVideoConfig();
  const appear = progress(frame, 255, 275) * r;
  const climb = spring({ frame: frame - 285, fps, config: { damping: 18, mass: 0.9 }, durationInFrames: 70 });
  const rankFloat = 8 - 5 * climb;
  const rank = Math.round(rankFloat);
  const rowH = 18;
  const gap = 5;

  return (
    <Card theme={theme} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 24, fontWeight: 700 }}>App Store sıralaması</div>
        <Pill color={theme.mutedForeground} style={{ fontSize: 15, padding: '4px 12px' }}>Örnek ekran</Pill>
      </div>
      <div style={{ display: 'flex', gap: 34, alignItems: 'center', flex: 1, opacity: appear }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 22, color: theme.mutedForeground }}>Anahtar kelime</div>
          <div style={{ fontSize: 34, fontWeight: 800, marginTop: 4 }}>ön muhasebe</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 10 }}>
            <span style={{ fontSize: 64, fontWeight: 800, color: brand[600], letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums' }}>
              #{rank}
            </span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 22,
                fontWeight: 700,
                color: theme.success,
                whiteSpace: 'nowrap',
                opacity: progress(frame, 330, 345),
              }}
            >
              <TrendingUp size={22} strokeWidth={2.6} /> 5 basamak
            </span>
          </div>
        </div>
        <div style={{ position: 'relative', width: 300, height: 8 * rowH + 7 * gap }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: 0,
                top: i * (rowH + gap),
                width: '100%',
                height: rowH,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}
            >
              <span style={{ width: 34, fontSize: 15, fontWeight: 700, color: theme.mutedForeground, fontFamily: fontMono }}>#{i + 1}</span>
              <span style={{ flex: 1, height: 10, borderRadius: 99, background: theme.muted, maxWidth: 230 - i * 14 }} />
            </div>
          ))}
          <div
            style={{
              position: 'absolute',
              left: 40,
              right: 0,
              top: (rankFloat - 1) * (rowH + gap) - 3,
              height: rowH + 6,
              borderRadius: 8,
              background: brand[500],
              boxShadow: `0 6px 18px ${alpha(brand[500], 0.35)}`,
              color: 'white',
              fontSize: 15,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              paddingLeft: 12,
            }}
          >
            kobipratik
          </div>
        </div>
      </div>
    </Card>
  );
}

/* ───────────────────────── Apple Search Ads — otomatik pilot ───────────────────────── */

function AsaCard({ theme, frame, r }: { theme: Theme; frame: number; r: number }) {
  const { fps } = useVideoConfig();
  const appear = progress(frame, 315, 335) * r;
  const adjust = spring({ frame: frame - 345, fps, config: { damping: 14 } });
  const knob = 0.72 - 0.24 * adjust;
  const lines = [
    { t: 395, text: 'Teklif, dönüşüme göre düşürüldü' },
    { t: 425, text: 'Zayıf anahtar kelime duraklatıldı' },
  ];

  return (
    <Card
      theme={theme}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        background: `linear-gradient(135deg, ${alpha(brand[500], 0.07)}, ${theme.card} 60%)`,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 24, fontWeight: 700 }}>Apple Search Ads</div>
        <Pill color={theme.success} style={{ fontSize: 16, opacity: 0.4 + 0.6 * appear }}>
          <Zap size={16} strokeWidth={2.6} /> Otomatik pilot
        </Pill>
      </div>
      <div style={{ opacity: appear }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 18, color: theme.mutedForeground, marginBottom: 12 }}>
          <span>Teklif</span>
          <span>hedef: dönüşüm başı maliyet</span>
        </div>
        <div style={{ position: 'relative', height: 14, borderRadius: 99, background: theme.muted }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${knob * 100}%`, borderRadius: 99, background: `linear-gradient(90deg, ${brand[300]}, ${brand[500]})` }} />
          <div
            style={{
              position: 'absolute',
              top: -9,
              left: `calc(${knob * 100}% - 16px)`,
              width: 32,
              height: 32,
              borderRadius: 99,
              background: 'white',
              border: `4px solid ${brand[500]}`,
              boxShadow: '0 4px 12px rgba(15,23,42,0.18)',
              boxSizing: 'border-box',
            }}
          />
        </div>
        <div style={{ marginTop: 26, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {lines.map((l) => {
            const p = progress(frame, l.t, l.t + 16) * r;
            return (
              <div key={l.text} style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 21, fontWeight: 600, opacity: p, transform: `translateX(${(1 - p) * 16}px)` }}>
                <span style={{ width: 28, height: 28, borderRadius: 99, background: alpha(theme.success, 0.15), display: 'grid', placeItems: 'center', color: theme.success }}>
                  <Check size={18} strokeWidth={3} />
                </span>
                {l.text}
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

/* ───────────────────────── Canli aktivite akisi ───────────────────────── */

const FEED: Array<{ t: number; Icon: typeof Bot; text: string }> = [
  { t: 125, Icon: Search, text: 'Site tarandı, ilk anahtar kelimeler çıkarıldı' },
  { t: 255, Icon: Bot, text: 'ChatGPT cevabında markan anıldı' },
  { t: 355, Icon: TrendingUp, text: "Sıralaman yükseldi: 'ön muhasebe' #8 → #3" },
  { t: 400, Icon: Zap, text: 'Otomatik pilot ASA teklifini güncelledi' },
  { t: 450, Icon: FileText, text: "Yeni makale taslağı hazır: 'KOBİ vergi takvimi'" },
  { t: 500, Icon: ShieldCheck, text: 'Agent Readiness: llms.txt eklendi' },
];

function Feed({ theme, frame, r }: { theme: Theme; frame: number; r: number }) {
  const { fps } = useVideoConfig();
  const ITEM = 124;
  const appear = FEED.map((f) => spring({ frame: frame - f.t, fps, config: { damping: 200 }, durationInFrames: 20 }));
  const latest = appear.reduce((acc, p, i) => (p > 0.5 ? i : acc), -1);
  const pulse = 0.55 + 0.45 * Math.abs(Math.sin((frame * Math.PI) / 30));

  return (
    <div
      style={{
        width: 470,
        borderLeft: `1.5px solid ${theme.border}`,
        background: alpha(theme.name === 'dark' ? '#0f172a' : '#f8fafc', 0.7),
        padding: 28,
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 22, fontWeight: 700 }}>
        <span style={{ width: 11, height: 11, borderRadius: 99, background: theme.success, opacity: pulse }} />
        Canlı aktivite
      </div>
      <div style={{ position: 'relative', flex: 1 }}>
        {FEED.map((f, i) => {
          // En yeni ustte: kendisinden sonra gelenlerin toplam ilerlemesi kadar asagi kayar
          const below = appear.slice(i + 1).reduce((a, b) => a + b, 0);
          const p = appear[i] * r;
          const Icon = f.Icon;
          return (
            <div
              key={f.text}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: below * ITEM,
                height: ITEM - 14,
                display: 'flex',
                gap: 16,
                alignItems: 'flex-start',
                opacity: p,
                transform: `translateX(${(1 - appear[i]) * 40}px)`,
              }}
            >
              <span
                style={{
                  width: 46,
                  height: 46,
                  flexShrink: 0,
                  borderRadius: 14,
                  background: alpha(brand[500], 0.12),
                  color: brand[600],
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <Icon size={24} strokeWidth={2.2} />
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 21, fontWeight: 600, lineHeight: 1.3 }}>{f.text}</div>
                <div style={{ fontSize: 16, color: theme.mutedForeground, marginTop: 4 }}>{i === latest ? 'şimdi' : 'az önce'}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
