import React from 'react';
import { AbsoluteFill, Sequence, interpolate, spring, useCurrentFrame, useVideoConfig, Easing } from 'remotion';
import { Check, Globe, FileText, BarChart3, Smartphone, Loader2, Sparkles, ArrowRight } from 'lucide-react';
import { alpha, brand, fontMono, fontSans, light, type Theme } from '../tokens';
import { Caption, Card, LogoMark, Pill, Wordmark, progress } from '../ui';

/**
 * Explainer — "Nasil calisir" videosu (70 sn, seslendirme yok, Turkce altyazi).
 *
 *   Giris (4 sn)  → 1. Siteni bagla → 2. AI analiz eder → 3. Yayina alir ve olcer → Kapanis (ranksup.ai)
 *
 * Ekrandaki ogeler urun akisinin TEMSILIDIR; olculmus metrik iddiasi yoktur (rakam
 * gosterilen tek yer analiz ilerleme yuzdesidir). Metinler landing'deki "Nasil
 * calisir" adimlariyla (land.how.*) ayni anlatimi izler.
 */

export const EXPLAINER_FPS = 30;

const INTRO = 120;
const ACT = 600;
const ACT3 = 630;
const OUTRO = 150;
export const EXPLAINER_DURATION = INTRO + ACT + ACT + ACT3 + OUTRO; // 2100 kare = 70 sn

type Cap = { from: number; to: number; text: string };

export const Explainer: React.FC = () => {
  const theme = light;
  return (
    <AbsoluteFill style={{ background: theme.background, fontFamily: fontSans, color: theme.foreground }}>
      <AbsoluteFill
        style={{ background: `radial-gradient(1400px 800px at 85% 0%, ${alpha(brand[500], 0.08)}, transparent 70%)` }}
      />
      <Sequence durationInFrames={INTRO} name="Giris">
        <Intro theme={theme} />
      </Sequence>
      <Sequence from={INTRO} durationInFrames={ACT} name="1 Siteni bagla">
        <ActFrame theme={theme} n={1} title="Siteni bağla" duration={ACT} captions={ACT1_CAPTIONS}>
          <ActConnect theme={theme} />
        </ActFrame>
      </Sequence>
      <Sequence from={INTRO + ACT} durationInFrames={ACT} name="2 AI analiz eder">
        <ActFrame theme={theme} n={2} title="AI analiz eder" duration={ACT} captions={ACT2_CAPTIONS}>
          <ActAnalyze theme={theme} />
        </ActFrame>
      </Sequence>
      <Sequence from={INTRO + 2 * ACT} durationInFrames={ACT3} name="3 Yayina alir ve olcer">
        <ActFrame theme={theme} n={3} title="Yayına alır ve ölçer" duration={ACT3} captions={ACT3_CAPTIONS}>
          <ActPublish theme={theme} />
        </ActFrame>
      </Sequence>
      <Sequence from={INTRO + 2 * ACT + ACT3} durationInFrames={OUTRO} name="Kapanis">
        <Outro theme={theme} />
      </Sequence>
    </AbsoluteFill>
  );
};

/* ───────────────────────── Ortak cerceve ───────────────────────── */

function ActFrame({
  theme,
  n,
  title,
  duration,
  captions,
  children,
}: {
  theme: Theme;
  n: number;
  title: string;
  duration: number;
  captions: Cap[];
  children: React.ReactNode;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = Math.min(progress(frame, 0, 14), 1 - progress(frame, duration - 14, duration));
  const head = spring({ frame, fps, config: { damping: 200 } });
  const cap = captions.find((c) => frame >= c.from && frame < c.to);
  const capOpacity = cap ? Math.min(progress(frame, cap.from, cap.from + 10), 1 - progress(frame, cap.to - 10, cap.to)) : 0;

  return (
    <AbsoluteFill style={{ opacity: fade }}>
      <div
        style={{
          position: 'absolute',
          left: 120,
          top: 80,
          display: 'flex',
          alignItems: 'center',
          gap: 22,
          opacity: head,
          transform: `translateX(${(1 - head) * -30}px)`,
        }}
      >
        <span
          style={{
            width: 64,
            height: 64,
            borderRadius: 20,
            background: `linear-gradient(135deg, ${brand[400]}, ${brand[600]})`,
            color: 'white',
            display: 'grid',
            placeItems: 'center',
            fontSize: 34,
            fontWeight: 800,
            boxShadow: `0 10px 28px ${alpha(brand[500], 0.35)}`,
          }}
        >
          {n}
        </span>
        <span style={{ fontSize: 58, fontWeight: 800, letterSpacing: '-0.03em' }}>{title}</span>
      </div>
      <div style={{ position: 'absolute', right: 120, top: 96, display: 'flex', gap: 10 }}>
        {[1, 2, 3].map((i) => (
          <span
            key={i}
            style={{ width: i === n ? 44 : 14, height: 14, borderRadius: 99, background: i === n ? brand[500] : theme.border }}
          />
        ))}
      </div>
      {/* AbsoluteFill height:100% tasidigi icin icerik alani duz div ile sinirlanir */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 190, bottom: 180 }}>{children}</div>
      {cap && <Caption text={cap.text} opacity={capOpacity} theme={theme} />}
    </AbsoluteFill>
  );
}

/* ───────────────────────── Giris / kapanis ───────────────────────── */

function Intro({ theme }: { theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const mark = spring({ frame, fps, config: { damping: 12 } });
  const word = spring({ frame: frame - 10, fps, config: { damping: 200 } });
  const tag = progress(frame, 35, 60);
  const out = 1 - progress(frame, 105, 120);
  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 40, opacity: out }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 34 }}>
        <div style={{ transform: `scale(${mark})` }}>
          <LogoMark size={130} />
        </div>
        <div style={{ opacity: word, transform: `translateX(${(1 - word) * 30}px)` }}>
          <Wordmark size={110} theme={theme} />
        </div>
      </div>
      <div style={{ fontSize: 46, fontWeight: 600, color: theme.mutedForeground, opacity: tag, transform: `translateY(${(1 - tag) * 14}px)` }}>
        Markan, AI asistanlarının cevaplarında görünsün.
      </div>
    </AbsoluteFill>
  );
}

function Outro({ theme }: { theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spring({ frame, fps, config: { damping: 200 } });
  const b = spring({ frame: frame - 12, fps, config: { damping: 14 } });
  const c = progress(frame, 30, 50);
  return (
    <AbsoluteFill style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 36 }}>
      <div style={{ opacity: a, transform: `translateY(${(1 - a) * 20}px)` }}>
        <Wordmark size={96} theme={theme} />
      </div>
      <div
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 18,
          padding: '28px 56px',
          borderRadius: 28,
          background: `linear-gradient(135deg, ${brand[500]}, ${brand[600]})`,
          color: 'white',
          fontSize: 76,
          fontWeight: 800,
          letterSpacing: '-0.03em',
          boxShadow: `0 24px 60px ${alpha(brand[500], 0.4)}`,
          transform: `scale(${0.6 + 0.4 * b})`,
          opacity: Math.min(1, b * 1.5),
        }}
      >
        ranksup.ai <ArrowRight size={64} strokeWidth={3} />
      </div>
      <div style={{ fontSize: 40, fontWeight: 600, color: theme.mutedForeground, opacity: c }}>
        Ücretsiz başla · 2 makale ücretsiz · Kart gerekmez
      </div>
    </AbsoluteFill>
  );
}

/* ───────────────────────── 1. Siteni bagla ───────────────────────── */

const ACT1_CAPTIONS: Cap[] = [
  { from: 15, to: 185, text: "Sitenin adresini yapıştır — teknik bilgi gerekmez." },
  { from: 195, to: 400, text: 'RanksUp siteni tarar; sayfalarını ve içeriğini okur.' },
  { from: 410, to: 590, text: 'Sektörünü ve marka sesini belirler, ilk anahtar kelimeleri çıkarır.' },
];

const PAGES = ['/', '/blog', '/blog/on-muhasebe-nedir', '/blog/kobi-kredisi-rehberi', '/araclar/fatura-hesaplama', '/hakkimizda', '/iletisim'];
const KEYWORDS = ['ön muhasebe', 'kobi kredisi', 'e-fatura', 'vergi takvimi', 'esnaf finansmanı'];

function ActConnect({ theme }: { theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const url = 'kobipratik.com';
  const typed = Math.floor(interpolate(frame, [50, 50 + url.length * 4], [0, url.length], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }));
  const press = frame >= 140 && frame < 152 ? 0.94 : 1;
  const inputIn = spring({ frame: frame - 20, fps, config: { damping: 200 } });
  // Giris karti yukari kayar, tarama paneli altina gelir
  const lift = progress(frame, 175, 205, Easing.inOut(Easing.cubic));
  const crawl = progress(frame, 205, 390, Easing.linear);
  const sector = spring({ frame: frame - 400, fps, config: { damping: 16 } });

  return (
    <AbsoluteFill style={{ alignItems: 'center' }}>
      <div
        style={{
          marginTop: interpolate(lift, [0, 1], [180, 10]),
          width: 1180,
          opacity: inputIn,
          transform: `translateY(${(1 - inputIn) * 30}px)`,
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 14,
            padding: 14,
            borderRadius: 28,
            background: theme.card,
            border: `3px solid ${alpha(brand[500], 0.4)}`,
            boxShadow: `0 24px 60px ${alpha(brand[500], 0.14)}`,
          }}
        >
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 20, padding: '0 22px' }}>
            <Globe size={40} color={brand[600]} />
            <span style={{ fontSize: 46, fontWeight: 600, fontFamily: fontMono }}>
              {url.slice(0, typed)}
              <span style={{ display: 'inline-block', width: 3, height: 46, marginLeft: 4, background: brand[500], verticalAlign: 'middle', opacity: Math.floor(frame / 15) % 2 ? 0 : 1 }} />
            </span>
          </div>
          <div
            style={{
              padding: '24px 44px',
              borderRadius: 18,
              background: `linear-gradient(135deg, ${brand[500]}, ${brand[600]})`,
              color: 'white',
              fontSize: 38,
              fontWeight: 800,
              transform: `scale(${press})`,
              display: 'flex',
              alignItems: 'center',
              gap: 14,
            }}
          >
            {frame > 150 && crawl < 1 ? <Loader2 size={38} style={{ transform: `rotate(${frame * 12}deg)` }} /> : null}
            Başlat
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 30, width: 1180, marginTop: 34, opacity: lift }}>
        <Card theme={theme} style={{ flex: 1.2, height: 420 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <span style={{ fontSize: 30, fontWeight: 700 }}>Sayfalar taranıyor</span>
            <span style={{ fontSize: 26, fontWeight: 700, color: brand[600], fontVariantNumeric: 'tabular-nums' }}>%{Math.round(crawl * 100)}</span>
          </div>
          <div style={{ height: 10, borderRadius: 99, background: theme.muted, marginBottom: 20 }}>
            <div style={{ height: 10, borderRadius: 99, width: `${crawl * 100}%`, background: brand[500] }} />
          </div>
          {PAGES.map((p, i) => {
            const at = 215 + i * 24;
            const on = progress(frame, at, at + 10);
            return (
              <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 24, fontFamily: fontMono, height: 38, opacity: on }}>
                <Check size={24} color={theme.success} strokeWidth={3} />
                {p}
              </div>
            );
          })}
        </Card>
        <Card theme={theme} style={{ flex: 1, height: 420, opacity: Math.min(1, sector), transform: `translateY(${(1 - Math.min(1, sector)) * 24}px)` }}>
          <div style={{ fontSize: 30, fontWeight: 700, marginBottom: 20 }}>Sitenin profili</div>
          <div style={{ fontSize: 22, color: theme.mutedForeground }}>Sektör</div>
          <Pill color={brand[600]} style={{ fontSize: 26, marginTop: 8 }}>
            <Sparkles size={24} /> KOBİ finansı · Türkiye
          </Pill>
          <div style={{ fontSize: 22, color: theme.mutedForeground, marginTop: 22 }}>İlk anahtar kelimeler</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 10 }}>
            {KEYWORDS.map((k, i) => {
              const on = progress(frame, 440 + i * 14, 452 + i * 14);
              return (
                <span
                  key={k}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 12,
                    border: `1.5px solid ${theme.border}`,
                    background: theme.muted,
                    fontSize: 22,
                    fontWeight: 600,
                    opacity: on,
                    transform: `scale(${0.8 + 0.2 * on})`,
                  }}
                >
                  {k}
                </span>
              );
            })}
          </div>
        </Card>
      </div>
    </AbsoluteFill>
  );
}

/* ───────────────────────── 2. AI analiz eder ───────────────────────── */

const ACT2_CAPTIONS: Cap[] = [
  { from: 15, to: 200, text: 'AI; rakiplerini, sıralamalarını ve eksik kaldığın konuları analiz eder.' },
  { from: 210, to: 400, text: 'Markanın 7 AI asistanının cevaplarında geçip geçmediğini ölçer.' },
  { from: 410, to: 590, text: 'Sonuçlar dakikalar içinde tek panelde.' },
];

const CHECKS = ["Rakiplerin metadata'sı", 'Arama sıralamaları', 'Eksik anahtar kelimeler', 'AI görünürlük ölçümü'];
const ENGINES = ['ChatGPT', 'Claude', 'Gemini', 'Perplexity', 'Grok', 'DeepSeek', 'Meta AI'];

function ActAnalyze({ theme }: { theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pct = progress(frame, 20, 520, Easing.inOut(Easing.quad));
  const done = frame > 520;

  return (
    <AbsoluteFill style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 110 }}>
      <ScanOrb theme={theme} frame={frame} pct={pct} done={done} />
      <div style={{ width: 720, display: 'flex', flexDirection: 'column', gap: 22 }}>
        {CHECKS.map((c, i) => {
          const start = 30 + i * 110;
          const appear = spring({ frame: frame - start, fps, config: { damping: 200 } });
          const finished = frame > start + 90;
          return (
            <div
              key={c}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 22,
                padding: '24px 28px',
                borderRadius: 22,
                background: theme.card,
                border: `2px solid ${finished ? alpha(theme.success, 0.45) : theme.border}`,
                opacity: appear,
                transform: `translateX(${(1 - appear) * 40}px)`,
              }}
            >
              <span
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 99,
                  display: 'grid',
                  placeItems: 'center',
                  background: finished ? alpha(theme.success, 0.14) : alpha(brand[500], 0.12),
                  color: finished ? theme.success : brand[600],
                }}
              >
                {finished ? <Check size={30} strokeWidth={3} /> : <Loader2 size={30} style={{ transform: `rotate(${frame * 10}deg)` }} />}
              </span>
              <span style={{ fontSize: 34, fontWeight: 700 }}>{c}</span>
            </div>
          );
        })}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 8 }}>
          {ENGINES.map((e, i) => {
            const on = progress(frame, 250 + i * 12, 262 + i * 12);
            return (
              <span
                key={e}
                style={{
                  padding: '8px 16px',
                  borderRadius: 99,
                  fontSize: 22,
                  fontWeight: 700,
                  border: `1.5px solid ${alpha(brand[500], 0.35 * on + 0.1)}`,
                  background: alpha(brand[500], 0.08 * on),
                  color: on > 0.5 ? brand[700] : theme.mutedForeground,
                }}
              >
                {e}
              </span>
            );
          })}
        </div>
      </div>
    </AbsoluteFill>
  );
}

/** components/ai-scan FuturisticGauge/ScanOrb fikrinin Remotion uyarlamasi (animejs yok) */
function ScanOrb({ theme, frame, pct, done }: { theme: Theme; frame: number; pct: number; done: boolean }) {
  const S = 560;
  const C = S / 2;
  const arcs = [brand[300], brand[500], brand[400], brand[600], brand[200]];
  const arcPath = (start: number, end: number, r: number) => {
    const a1 = ((start - 90) * Math.PI) / 180;
    const a2 = ((end - 90) * Math.PI) / 180;
    return `M ${C + r * Math.cos(a1)} ${C + r * Math.sin(a1)} A ${r} ${r} 0 0 1 ${C + r * Math.cos(a2)} ${C + r * Math.sin(a2)}`;
  };
  const progR = 200;
  const circ = 2 * Math.PI * progR;
  return (
    <div style={{ position: 'relative', width: S, height: S }}>
      <svg width={S} height={S} style={{ position: 'absolute', inset: 0 }}>
        <g transform={`rotate(${frame * 0.9} ${C} ${C})`}>
          {arcs.map((c, i) => (
            <path key={i} d={arcPath(i * 72, i * 72 + 50, 262)} stroke={c} strokeWidth={10} strokeLinecap="round" fill="none" opacity={0.85} />
          ))}
        </g>
        <g transform={`rotate(${-frame * 0.4} ${C} ${C})`}>
          {Array.from({ length: 72 }).map((_, i) => {
            const a = (i * 5 * Math.PI) / 180;
            const r1 = 232;
            const r2 = i % 6 === 0 ? 218 : 225;
            return (
              <line key={i} x1={C + r1 * Math.cos(a)} y1={C + r1 * Math.sin(a)} x2={C + r2 * Math.cos(a)} y2={C + r2 * Math.sin(a)} stroke={theme.mutedForeground} strokeOpacity={0.35} strokeWidth={2} />
            );
          })}
        </g>
        <circle cx={C} cy={C} r={progR} fill="none" stroke={theme.muted} strokeWidth={12} />
        <circle
          cx={C}
          cy={C}
          r={progR}
          fill="none"
          stroke={done ? theme.success : brand[500]}
          strokeWidth={12}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - pct)}
          transform={`rotate(-90 ${C} ${C})`}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          left: C - 170,
          top: C - 170,
          width: 340,
          height: 340,
          borderRadius: 999,
          background: `radial-gradient(circle at 35% 30%, white, ${brand[50]} 60%, ${brand[100]})`,
          boxShadow: `inset 0 -10px 40px ${alpha(brand[500], 0.15)}, 0 20px 60px ${alpha(brand[500], 0.18)}`,
          display: 'grid',
          placeItems: 'center',
          textAlign: 'center',
        }}
      >
        <div>
          <div style={{ fontSize: 110, fontWeight: 800, letterSpacing: '-0.04em', color: light.foreground, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            %{Math.round(pct * 100)}
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, color: done ? theme.success : brand[700], marginTop: 10 }}>
            {done ? 'Analiz tamam' : 'Analiz ediliyor'}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── 3. Yayina alir ve olcer ───────────────────────── */

const ACT3_CAPTIONS: Cap[] = [
  { from: 15, to: 200, text: 'Eksik kaldığın sorular için marka sesinde makale yazar ve yayınlar.' },
  { from: 210, to: 400, text: 'AI görünürlüğünü düzenli ölçer ve raporlar.' },
  { from: 410, to: 620, text: 'Uygulaman varsa App Store için başlık ve anahtar kelime önerir.' },
];

const REPORT = [
  { label: 'ChatGPT', cited: true },
  { label: 'Claude', cited: true },
  { label: 'Gemini', cited: false },
  { label: 'Perplexity', cited: true },
  { label: 'Grok', cited: false },
  { label: 'DeepSeek', cited: false },
  { label: 'Meta AI', cited: true },
];

function ActPublish({ theme }: { theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const cardIn = (start: number) => spring({ frame: frame - start, fps, config: { damping: 200 } });
  const a = cardIn(10);
  const b = cardIn(205);
  const c = cardIn(405);
  const published = frame > 165;
  const focus = (start: number, end: number) => (frame >= start && frame < end ? 1 : 0);
  const cardStyle = (p: number, active: number): React.CSSProperties => ({
    width: 520,
    height: 600,
    opacity: p,
    transform: `translateY(${(1 - p) * 40}px) scale(${active ? 1 : 0.97})`,
    border: `2px solid ${active ? alpha(brand[500], 0.55) : theme.border}`,
    boxShadow: active ? `0 24px 60px ${alpha(brand[500], 0.16)}` : 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  });

  return (
    <AbsoluteFill style={{ display: 'flex', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 40 }}>
      {/* Makale */}
      <Card theme={theme} style={cardStyle(a, focus(0, 205))}>
        <CardHead icon={<FileText size={30} />} title="Makale" />
        <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.2 }}>Ön muhasebe nedir? KOBİ'ler için rehber</div>
        {[0.95, 0.88, 0.92, 0.7, 0.9, 0.82, 0.6].map((w, i) => {
          const g = progress(frame, 40 + i * 14, 70 + i * 14);
          return <div key={i} style={{ height: 14, borderRadius: 99, background: theme.muted, width: `${w * 100 * g}%` }} />;
        })}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
          {['Schema.org', 'SSS işaretlemesi', 'Görseller'].map((t, i) => (
            <Pill key={t} color={brand[700]} style={{ opacity: progress(frame, 130 + i * 10, 140 + i * 10), fontSize: 19 }}>
              {t}
            </Pill>
          ))}
        </div>
        <div style={{ marginTop: 'auto' }}>
          <Pill color={published ? theme.success : theme.warning} style={{ fontSize: 22 }}>
            {published ? <Check size={22} strokeWidth={3} /> : <Loader2 size={22} style={{ transform: `rotate(${frame * 10}deg)` }} />}
            {published ? 'Yayınlandı' : 'Kalite kontrolü'}
          </Pill>
        </div>
      </Card>

      {/* AI gorunurluk raporu */}
      <Card theme={theme} style={cardStyle(b, focus(205, 405))}>
        <CardHead icon={<BarChart3 size={30} />} title="AI görünürlük raporu" />
        <Pill color={theme.mutedForeground} style={{ alignSelf: 'flex-start', fontSize: 17 }}>Örnek rapor</Pill>
        {REPORT.map((e, i) => {
          const at = 240 + i * 16;
          const on = progress(frame, at, at + 12);
          const col = e.cited ? theme.success : theme.mutedForeground;
          return (
            <div key={e.label} style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 25, fontWeight: 600 }}>
              <span style={{ width: 150 }}>{e.label}</span>
              <div style={{ flex: 1, height: 12, borderRadius: 99, background: theme.muted }}>
                <div style={{ height: 12, borderRadius: 99, width: `${(e.cited ? 100 : 18) * on}%`, background: alpha(col, e.cited ? 0.85 : 0.45) }} />
              </div>
              <span style={{ width: 120, textAlign: 'right', fontSize: 20, color: col, opacity: on }}>{e.cited ? 'Anıldı' : 'Anılmadı'}</span>
            </div>
          );
        })}
      </Card>

      {/* ASO onerisi */}
      <Card theme={theme} style={cardStyle(c, focus(405, ACT3))}>
        <CardHead icon={<Smartphone size={30} />} title="ASO önerisi" />
        <div style={{ fontSize: 22, color: theme.mutedForeground }}>Başlık</div>
        <div style={{ fontSize: 26, fontFamily: fontMono, padding: '14px 18px', borderRadius: 14, background: theme.muted, textDecoration: 'line-through', color: theme.mutedForeground, opacity: progress(frame, 430, 445) }}>
          KobiPratik
        </div>
        <div
          style={{
            fontSize: 26,
            fontFamily: fontMono,
            fontWeight: 700,
            padding: '14px 18px',
            borderRadius: 14,
            border: `2px solid ${alpha(theme.success, 0.5)}`,
            background: alpha(theme.success, 0.08),
            opacity: progress(frame, 460, 478),
          }}
        >
          KobiPratik: Ön Muhasebe
        </div>
        <div style={{ fontSize: 22, color: theme.mutedForeground, marginTop: 8 }}>Anahtar kelime fırsatları</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {['e-fatura', 'gider takibi', 'kobi muhasebe'].map((k, i) => (
            <span
              key={k}
              style={{ padding: '8px 16px', borderRadius: 12, background: alpha(brand[500], 0.1), color: brand[700], fontSize: 22, fontWeight: 700, opacity: progress(frame, 495 + i * 12, 507 + i * 12) }}
            >
              {k}
            </span>
          ))}
        </div>
        <div
          style={{
            marginTop: 'auto',
            alignSelf: 'flex-start',
            padding: '14px 30px',
            borderRadius: 14,
            background: brand[500],
            color: 'white',
            fontSize: 24,
            fontWeight: 800,
            opacity: progress(frame, 540, 556),
            transform: `scale(${frame >= 575 && frame < 585 ? 0.94 : 1})`,
          }}
        >
          Onayla ve uygula
        </div>
      </Card>
    </AbsoluteFill>
  );
}

function CardHead({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <span style={{ width: 56, height: 56, borderRadius: 16, background: alpha(brand[500], 0.12), color: brand[600], display: 'grid', placeItems: 'center' }}>{icon}</span>
      <span style={{ fontSize: 30, fontWeight: 800 }}>{title}</span>
    </div>
  );
}
