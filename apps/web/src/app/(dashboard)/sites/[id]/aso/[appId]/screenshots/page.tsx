'use client';

import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useSiteContext } from '../../../site-context';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ArrowLeft, Sparkles, Download, Image as ImageIcon, Type, Palette,
  Smartphone, RotateCw, Loader2, Upload, Trash2, Copy, Eye,
  Star, AlertCircle, CheckCircle2, X as XIcon, Wand2,
} from 'lucide-react';
import { PHONE_FRAMES } from './phone-frames';
import { TEMPLATES } from './templates';
import { PANORAMA_THEMES, computeSlotDecorations, type Decoration } from './panorama-themes';
import type Konva from 'konva';

// Tüm Konva component'leri tek dynamic import ile (proper Next.js + react-konva pattern)
const ScreenshotStage = dynamic(
  () => import('./screenshot-stage').then(m => m.ScreenshotStage),
  { ssr: false, loading: () => <div className="bg-muted/40 rounded animate-pulse" style={{ width: 320, height: 692 }} /> }
);

const PRESETS = [
  { id: 'ios-67', label: 'iPhone 6.7" (iOS)', width: 1290, height: 2796, store: 'IOS' as const },
  { id: 'ios-65', label: 'iPhone 6.5" (iOS)', width: 1242, height: 2688, store: 'IOS' as const },
  { id: 'android-phone', label: 'Android Phone', width: 1080, height: 1920, store: 'ANDROID' as const },
  { id: 'ipad', label: 'iPad Pro 13"', width: 2048, height: 2732, store: 'IOS' as const },
];

interface SlotState {
  index: number;
  background: { type: 'gradient' | 'solid' | 'image'; value: string; image?: HTMLImageElement };
  bgOverlay?: 'none' | 'dark' | 'light' | 'top-fade' | 'bottom-fade';
  hook: string;
  subtitle: string;
  hookFontSize: number;
  textColor: string;
  textPosition: 'top' | 'bottom';
  textAlign?: 'left' | 'center' | 'right';
  phoneFrameId: string;
  phoneTilt: number;
  phoneScale: number;
  phoneLayout?: 'single' | 'duo' | 'trio';
  phoneVerticalAlign?: 'top' | 'center' | 'bottom';
  screenshot?: HTMLImageElement;
  screenshotUrl?: string;
  screenshot2?: HTMLImageElement;
  screenshot2Url?: string;
  screenshot3?: HTMLImageElement;
  screenshot3Url?: string;
  // Hand-photo bg seçildi mi — true ise üst-üste telefon olmaması için phoneScale=0 ve
  // screenshot upload edilince AI multimodal ile içine yerleştirilir.
  backgroundIsHand?: boolean;
  // Panorama temasından üretilmiş dekoratif şekiller. Slot sınırlarını aşan şekiller
  // komşu slotlarda da yarım yarım görünür → birleşik tasarım hissi.
  decorations?: Decoration[];
}

function makeSlot(i: number): SlotState {
  return {
    index: i,
    background: { type: 'gradient', value: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
    bgOverlay: 'none',
    hook: '',
    subtitle: '',
    hookFontSize: 110,
    textColor: '#ffffff',
    textPosition: 'top',
    textAlign: 'center',
    phoneFrameId: 'iphone-15-pro-black',
    phoneTilt: 0,
    phoneScale: 0.7,
    phoneLayout: 'single',
    phoneVerticalAlign: 'center',
    backgroundIsHand: false,
  };
}

// Layout presets — Hero (text top + single phone), Showcase (2 phones), Comparison (3 phones)
const LAYOUT_PRESETS = [
  {
    id: 'hero',
    name: 'Hero',
    description: 'Tek telefon ortada, üstte hook',
    config: { phoneLayout: 'single' as const, textPosition: 'top' as const, phoneVerticalAlign: 'center' as const, phoneScale: 0.75, phoneTilt: 0 },
  },
  {
    id: 'showcase',
    name: 'Showcase',
    description: '2 telefon yan yana',
    config: { phoneLayout: 'duo' as const, textPosition: 'top' as const, phoneVerticalAlign: 'center' as const, phoneScale: 0.7, phoneTilt: 0 },
  },
  {
    id: 'comparison',
    name: 'Comparison',
    description: '3 telefon kademeli',
    config: { phoneLayout: 'trio' as const, textPosition: 'top' as const, phoneVerticalAlign: 'center' as const, phoneScale: 0.75, phoneTilt: 0 },
  },
  {
    id: 'tilted-right',
    name: 'Tilted Right',
    description: 'Sağa eğik tek telefon',
    config: { phoneLayout: 'single' as const, textPosition: 'top' as const, phoneVerticalAlign: 'bottom' as const, phoneScale: 0.85, phoneTilt: 12 },
  },
  {
    id: 'tilted-left',
    name: 'Tilted Left',
    description: 'Sola eğik tek telefon',
    config: { phoneLayout: 'single' as const, textPosition: 'top' as const, phoneVerticalAlign: 'bottom' as const, phoneScale: 0.85, phoneTilt: -12 },
  },
  {
    id: 'phone-top',
    name: 'Phone Top',
    description: 'Telefon üstte, yazı altta',
    config: { phoneLayout: 'single' as const, textPosition: 'bottom' as const, phoneVerticalAlign: 'top' as const, phoneScale: 0.7, phoneTilt: 0 },
  },
];

// 10 slot için kanıtlanmış sıralama — App Store top app'lerinde yaygın akış:
// hero (intro) → tilted variations (feature highlight) → multi-phone (depth) → variety
const AUTO_LAYOUT_PATTERN = [
  'hero', 'tilted-right', 'showcase', 'tilted-left', 'phone-top',
  'hero', 'comparison', 'tilted-right', 'tilted-left', 'showcase',
];

// Panorama için: tüm telefonlar dikey ortada (kayıklık yok), sadece tilt + scale + sayı değişir.
// Hareket hissini scale/tilt verir, vertical baseline sabit kalır.
type PanoramaSlotLayout = {
  phoneLayout: 'single' | 'duo' | 'trio';
  phoneTilt: number;
  phoneScale: number;
  phoneVerticalAlign: 'top' | 'center' | 'bottom';
  textPosition: 'top' | 'bottom';
};
const PANORAMA_LAYOUT_PATTERN: PanoramaSlotLayout[] = [
  { phoneLayout: 'single', phoneTilt: -8,  phoneScale: 0.78, phoneVerticalAlign: 'center', textPosition: 'top' },
  { phoneLayout: 'single', phoneTilt: 12,  phoneScale: 0.72, phoneVerticalAlign: 'center', textPosition: 'top' },
  { phoneLayout: 'duo',    phoneTilt: 0,   phoneScale: 0.68, phoneVerticalAlign: 'center', textPosition: 'top' },
  { phoneLayout: 'single', phoneTilt: -12, phoneScale: 0.78, phoneVerticalAlign: 'center', textPosition: 'top' },
  { phoneLayout: 'single', phoneTilt: 0,   phoneScale: 0.82, phoneVerticalAlign: 'center', textPosition: 'top' },
  { phoneLayout: 'single', phoneTilt: 8,   phoneScale: 0.74, phoneVerticalAlign: 'center', textPosition: 'top' },
  { phoneLayout: 'trio',   phoneTilt: 0,   phoneScale: 0.58, phoneVerticalAlign: 'center', textPosition: 'top' },
  { phoneLayout: 'single', phoneTilt: -15, phoneScale: 0.78, phoneVerticalAlign: 'center', textPosition: 'top' },
  { phoneLayout: 'single', phoneTilt: 14,  phoneScale: 0.72, phoneVerticalAlign: 'center', textPosition: 'top' },
  { phoneLayout: 'single', phoneTilt: 0,   phoneScale: 0.85, phoneVerticalAlign: 'center', textPosition: 'top' },
];

// Panorama theme preview — temsili 1 slot'luk mini SVG, ilk 6 shape'i gösterir.
function PanoramaPreview({ theme }: { theme: typeof PANORAMA_THEMES[number] }) {
  const W = 100, H = 178;
  // Tema'nın orta slot'una düşen shape'leri al (vx 400-600 → slot ~5)
  const sample = theme.shapes
    .filter(s => s.vx >= 350 && s.vx <= 650)
    .slice(0, 6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid slice">
      {sample.map((s, i) => {
        const cx = ((s.vx - 400) / 200) * W;        // 400-600 range → 0-W
        const cy = (s.vy / 100) * H;
        const size = (s.vsize / 100) * W * 0.6;     // hafif küçültülmüş
        if (s.type === 'circle') return <circle key={i} cx={cx} cy={cy} r={size} fill={s.fill} opacity={s.opacity ?? 1} />;
        if (s.type === 'ring')   return <circle key={i} cx={cx} cy={cy} r={size} fill="none" stroke={s.stroke ?? s.fill} strokeWidth={(s.strokeWidth ?? 4) / 4} opacity={s.opacity ?? 1} />;
        if (s.type === 'triangle') {
          const pts = [
            [cx, cy - size],
            [cx + size * 0.866, cy + size * 0.5],
            [cx - size * 0.866, cy + size * 0.5],
          ].map(p => p.join(',')).join(' ');
          return <polygon key={i} points={pts} fill={s.fill} opacity={s.opacity ?? 1} transform={`rotate(${s.rotation ?? 0} ${cx} ${cy})`} />;
        }
        return null;
      })}
    </svg>
  );
}

// AI suggestion alanı — label + value + char counter + tek-tık kopyala.
function SuggestionField({ label, value, limit, multiline }: {
  label: string; value: string; limit: number; multiline?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const len = value.length;
  const overLimit = len > limit;
  const handleCopy = () => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="rounded-md border bg-background p-2.5">
      <div className="flex items-center justify-between mb-1">
        <div className="text-[11px] font-semibold flex items-center gap-1.5">
          {label}
          <span className={`text-[10px] font-normal ${overLimit ? 'text-rose-600' : 'text-muted-foreground'}`}>
            ({len}/{limit})
          </span>
        </div>
        <button
          onClick={handleCopy}
          className={`text-[10px] px-2 py-0.5 rounded border transition-colors flex items-center gap-1 ${
            copied ? 'border-emerald-500 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30' : 'border-border hover:border-brand hover:text-brand'
          }`}
        >
          {copied ? <><CheckCircle2 className="h-3 w-3" /> Kopyalandı</> : <><Copy className="h-3 w-3" /> Kopyala</>}
        </button>
      </div>
      {multiline ? (
        <textarea
          readOnly
          value={value}
          onFocus={e => e.target.select()}
          className="w-full text-[11px] leading-relaxed bg-transparent resize-none max-h-32 outline-none cursor-text"
          rows={Math.min(6, value.split('\n').length + 1)}
        />
      ) : (
        <input
          readOnly
          value={value}
          onFocus={e => e.target.select()}
          className="w-full text-[11px] bg-transparent outline-none cursor-text"
        />
      )}
    </div>
  );
}

// Layout preset preview — config'e göre minik SVG mockup. Telefon, yazı bloğu pozisyonu görünür.
function LayoutPreview({ config }: { config: typeof LAYOUT_PRESETS[number]['config'] }) {
  const W = 60, H = 100;
  const textY = config.textPosition === 'top' ? 6 : H - 16;

  const phoneCount = config.phoneLayout === 'single' ? 1 : config.phoneLayout === 'duo' ? 2 : 3;
  const baseW = config.phoneLayout === 'single' ? 22 : config.phoneLayout === 'duo' ? 16 : 13;
  const baseH = baseW * 2.05;
  const scaleMul = Math.min(config.phoneScale / 0.75, 1.15);
  const phoneW = baseW * scaleMul;
  const phoneH = baseH * scaleMul;

  // phoneCenterY hesabı — gerçek render'a yakın
  let phoneCenterY: number;
  if (config.textPosition === 'top') {
    const top = 22, bottom = H - 6;
    phoneCenterY = config.phoneVerticalAlign === 'top' ? top + (bottom - top) * 0.3
                 : config.phoneVerticalAlign === 'bottom' ? top + (bottom - top) * 0.7
                 : (top + bottom) / 2;
  } else {
    const top = 6, bottom = H - 22;
    phoneCenterY = config.phoneVerticalAlign === 'top' ? top + (bottom - top) * 0.3
                 : config.phoneVerticalAlign === 'bottom' ? top + (bottom - top) * 0.7
                 : (top + bottom) / 2;
  }

  const phones: Array<{ cx: number; cy: number; tilt: number; w: number; h: number; opacity: number }> = [];
  if (phoneCount === 1) {
    phones.push({ cx: W / 2, cy: phoneCenterY, tilt: config.phoneTilt, w: phoneW, h: phoneH, opacity: 1 });
  } else if (phoneCount === 2) {
    phones.push({ cx: W / 2 - 10, cy: phoneCenterY, tilt: config.phoneTilt - 8, w: phoneW * 0.9, h: phoneH * 0.9, opacity: 1 });
    phones.push({ cx: W / 2 + 10, cy: phoneCenterY + 3, tilt: config.phoneTilt + 8, w: phoneW * 0.9, h: phoneH * 0.9, opacity: 1 });
  } else {
    phones.push({ cx: W / 2 - 14, cy: phoneCenterY + 4, tilt: config.phoneTilt - 12, w: phoneW * 0.78, h: phoneH * 0.78, opacity: 0.7 });
    phones.push({ cx: W / 2,      cy: phoneCenterY,     tilt: config.phoneTilt,       w: phoneW,        h: phoneH,        opacity: 1 });
    phones.push({ cx: W / 2 + 14, cy: phoneCenterY + 4, tilt: config.phoneTilt + 12, w: phoneW * 0.78, h: phoneH * 0.78, opacity: 0.7 });
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto rounded" preserveAspectRatio="xMidYMid meet">
      {/* canvas bg */}
      <rect width={W} height={H} fill="#f1f1f4" rx={2} />
      {/* text bars */}
      <rect x={8} y={textY} width={44} height={3} rx={1} fill="#333" opacity={0.55} />
      <rect x={8} y={textY + 5} width={32} height={2} rx={1} fill="#333" opacity={0.3} />
      {/* phones */}
      {phones.map((p, i) => (
        <g key={i} transform={`rotate(${p.tilt} ${p.cx} ${p.cy})`} opacity={p.opacity}>
          <rect
            x={p.cx - p.w / 2} y={p.cy - p.h / 2}
            width={p.w} height={p.h}
            rx={2.2}
            fill="#ffffff"
            stroke="#1a1a1a"
            strokeOpacity={0.7}
            strokeWidth={0.6}
          />
          <rect
            x={p.cx - p.w / 2 + 1} y={p.cy - p.h / 2 + 1.5}
            width={p.w - 2} height={p.h - 3}
            rx={1.5}
            fill="#6c5ce7"
            opacity={0.28}
          />
        </g>
      ))}
    </svg>
  );
}

const GRADIENTS = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
  'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
  'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)',
  'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)',
  'linear-gradient(135deg, #232526 0%, #414345 100%)',
  'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
  'linear-gradient(135deg, #ff0844 0%, #ffb199 100%)',
];

const SOLID_COLORS = [
  { name: 'Red (Media Markt)', value: '#E20613' },
  { name: 'Orange', value: '#FF6B00' },
  { name: 'Yellow', value: '#FFC700' },
  { name: 'Green', value: '#00A859' },
  { name: 'Cyan', value: '#00BCD4' },
  { name: 'Blue', value: '#1976D2' },
  { name: 'Indigo', value: '#3F51B5' },
  { name: 'Purple', value: '#7B1FA2' },
  { name: 'Pink', value: '#E91E63' },
  { name: 'Black', value: '#0a0a0a' },
  { name: 'White', value: '#ffffff' },
  { name: 'LuviHost Brand', value: '#6c5ce7' },
];

export default function ScreenshotStudioPage({ params }: { params: Promise<{ id: string; appId: string }> }) {
  const { id: siteId, appId } = use(params);
  const { site } = useSiteContext();
  const router = useRouter();

  const [app, setApp] = useState<any>(null);
  const [appLoading, setAppLoading] = useState(true);

  const [presetId, setPresetId] = useState<string>('ios-67');
  const preset = PRESETS.find(p => p.id === presetId)!;
  // Slot sayısı: 5 (App Store typical), 8 (Play Store max), 10 (Apple max)
  const [slotCount, setSlotCount] = useState<5 | 8 | 10>(5);
  const [slots, setSlots] = useState<SlotState[]>(() => Array.from({ length: 5 }, (_, i) => makeSlot(i)));
  const [activeSlot, setActiveSlot] = useState(0);
  const slot = slots[activeSlot] ?? slots[0];

  const [generatingBg, setGeneratingBg] = useState(false);
  const [generatingCaptions, setGeneratingCaptions] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [bulkExporting, setBulkExporting] = useState(false);

  const [sidebar, setSidebar] = useState<'ai' | 'templates' | 'layout' | 'phone' | 'background' | 'text'>('ai');

  // Panorama slot pattern — toplamı slotCount olan grup boyutları array'i.
  // Örn (slotCount=5): [5] = tek panorama, [2,1,1,1] = ikili+tekli karma.
  const [panoramaPattern, setPanoramaPattern] = useState<number[]>([5]);
  const [customPatternInput, setCustomPatternInput] = useState<string>('');
  // Son uygulanan panorama teması — pattern/slotCount değişince otomatik re-apply için.
  const [lastAppliedTheme, setLastAppliedTheme] = useState<string | null>(null);
  // applyPanoramaTheme'ı ref'le tutuyoruz ki useEffect içinden stale closure olmadan çağrılabilsin.
  const applyPanoramaThemeRef = useRef<((id: string) => void) | null>(null);

  // Slot sayısı değişince slots array'i yeniden boyutlandır (mevcut slot verileri korunur)
  // ve default pattern'i [slotCount] yap (tek büyük panorama).
  useEffect(() => {
    setSlots(prev => {
      if (prev.length === slotCount) return prev;
      if (prev.length > slotCount) return prev.slice(0, slotCount);
      const extras = Array.from({ length: slotCount - prev.length }, (_, i) => makeSlot(prev.length + i));
      return [...prev, ...extras];
    });
    setPanoramaPattern(p => {
      const sum = p.reduce((a, b) => a + b, 0);
      return sum === slotCount ? p : [slotCount];
    });
    setActiveSlot(a => Math.min(a, slotCount - 1));
  }, [slotCount]);

  // Store preview modal
  const [showPreview, setShowPreview] = useState(false);
  const [previewStore, setPreviewStore] = useState<'IOS' | 'ANDROID'>('IOS');
  const [audit, setAudit] = useState<{ findings: Array<{ severity: string; store: string; field: string; label: string; current: any; message?: string; recommendation?: string }>; score?: number } | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<{ title?: string; subtitle?: string; description?: string; keywords?: string; promotionalText?: string } | null>(null);

  // AI screenshot library — daha önce üretilmiş background'lar
  const [library, setLibrary] = useState<Array<{ filename: string; url: string; timestamp: number; type: 'standard' | 'hand' }>>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);

  const stageRef = useRef<Konva.Stage>(null);

  const loadLibrary = async () => {
    setLibraryLoading(true);
    try {
      const r = await api.request<{ items: typeof library }>(`/sites/${siteId}/aso/apps/${appId}/screenshots/library`);
      setLibrary(r.items);
    } catch {
      // silent — first time has no items
    } finally {
      setLibraryLoading(false);
    }
  };

  const applyLibraryItem = (item: { url: string; type: 'standard' | 'hand' }) => {
    const fullUrl = process.env.NEXT_PUBLIC_API_URL ? `${process.env.NEXT_PUBLIC_API_URL}${item.url}` : item.url;
    const isHand = item.type === 'hand';
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      updateSlot({
        background: { type: 'image', value: fullUrl, image: img },
        phoneScale: isHand ? 0 : (slot.phoneScale === 0 ? 0.7 : slot.phoneScale),
        backgroundIsHand: isHand,
        decorations: undefined,
      });
    };
    img.onerror = () => toast.error('Image yüklenemedi');
    img.src = fullUrl;
  };

  const deleteLibraryItem = async (filename: string) => {
    if (!confirm('Bu üretimi silmek istediğine emin misin?')) return;
    try {
      await api.request(`/sites/${siteId}/aso/apps/${appId}/screenshots/library/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      setLibrary(prev => prev.filter(i => i.filename !== filename));
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // Auto-load library on AI tab open
  useEffect(() => {
    if (sidebar !== 'ai') return;
    loadLibrary();
  }, [sidebar, appId]);

  // Load app
  useEffect(() => {
    api.request<any>(`/sites/${siteId}/aso/apps/${appId}`)
      .then(setApp)
      .catch(err => toast.error(err.message))
      .finally(() => setAppLoading(false));
  }, [siteId, appId]);

  const updateSlot = (patch: Partial<SlotState>) => {
    setSlots(prev => prev.map((s, i) => i === activeSlot ? { ...s, ...patch } : s));
  };

  const updateAllSlots = (patch: Partial<SlotState>) => {
    setSlots(prev => prev.map(s => ({ ...s, ...patch })));
  };

  // 10 slot için AUTO_LAYOUT_PATTERN'a göre her slota farklı preset uygular.
  // App Store'da yaygın akış: hero → tilted → multi-phone → variety. Token harcamaz, anlık.
  const applyAutoLayout = () => {
    setSlots(prev => prev.map((s, i) => {
      const presetId = AUTO_LAYOUT_PATTERN[i % AUTO_LAYOUT_PATTERN.length];
      const lp = LAYOUT_PRESETS.find(p => p.id === presetId);
      return lp ? { ...s, ...lp.config } : s;
    }));
  };

  // panoramaPattern'a göre slot'un hangi gruba ait olduğunu hesaplar.
  // Örn: pattern=[2,1,3,1,3], slot 4 → groupIndex=2 (3'lü grup), slotInGroup=1, groupSize=3
  const getSlotGroupInfo = (pattern: number[], slotIndex: number) => {
    let cumSum = 0;
    for (let g = 0; g < pattern.length; g++) {
      const size = pattern[g];
      if (slotIndex < cumSum + size) {
        return { groupIndex: g, slotInGroup: slotIndex - cumSum, groupSize: size };
      }
      cumSum += size;
    }
    return { groupIndex: 0, slotInGroup: 0, groupSize: 10 };
  };

  // PANORAMA: hazır temayı {slotCount} slota uygular. panoramaPattern'a göre grupla.
  // Her grup kendi içinde sıkıştırılmış mini panorama, gruplar arası rotation farkı var.
  // Dekoratif şekiller grup içinde slot sınırını aşar, grup sınırını aşmaz.
  const applyPanoramaTheme = (themeId: string) => {
    const theme = PANORAMA_THEMES.find(t => t.id === themeId);
    if (!theme) return;
    setLastAppliedTheme(themeId);  // pattern/slotCount değişince otomatik re-apply için
    setSlots(prev => prev.map((s, i) => {
      const { groupIndex, slotInGroup, groupSize } = getSlotGroupInfo(panoramaPattern, i);
      return {
        ...s,
        background: { type: theme.bgType, value: theme.bg },
        backgroundIsHand: false,
        decorations: computeSlotDecorations(theme, slotInGroup, groupSize, groupIndex, preset.width, preset.height, panoramaPattern.length),
        ...PANORAMA_LAYOUT_PATTERN[i % PANORAMA_LAYOUT_PATTERN.length],
      };
    }));
  };
  // Ref'i her render'da güncelle ki useEffect içinden her zaman güncel closure'a sahip versiyon çağrılsın
  applyPanoramaThemeRef.current = applyPanoramaTheme;

  // Pattern veya slotCount değişince mevcut tema otomatik yeniden uygulanır.
  // Kullanıcı pattern butonuna bastığında tekrar tema seçmek zorunda kalmaz.
  useEffect(() => {
    if (lastAppliedTheme && applyPanoramaThemeRef.current) {
      applyPanoramaThemeRef.current(lastAppliedTheme);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panoramaPattern, slotCount]);

  // SET TASARIMI: AI bg üret → {slotCount} slota uygula → auto-layout dağıt. Tek hamlede tüm slotlar uyumlu hâle gelir.
  const generateSetDesign = async (style: 'gradient' | 'mesh' | 'illustrative' | 'bold' | 'minimalist') => {
    setGeneratingBg(true);
    try {
      const result = await api.request<{ url: string; width: number; height: number }>(
        `/sites/${siteId}/aso/apps/${appId}/screenshots/background`,
        { method: 'POST', body: JSON.stringify({ style, width: preset.width, height: preset.height }) },
      );
      const fullUrl = process.env.NEXT_PUBLIC_API_URL ? `${process.env.NEXT_PUBLIC_API_URL}${result.url}` : result.url;
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        // Tek setState ile bg + layout 10 slota birden uygulanır — flicker olmaz
        setSlots(prev => prev.map((s, i) => {
          const presetId = AUTO_LAYOUT_PATTERN[i % AUTO_LAYOUT_PATTERN.length];
          const lp = LAYOUT_PRESETS.find(p => p.id === presetId);
          return {
            ...s,
            background: { type: 'image', value: fullUrl, image: img },
            backgroundIsHand: false,
            decorations: undefined,
            ...(lp ? lp.config : {}),
          };
        }));
      };
      img.onerror = () => toast.error('Background image yüklenemedi');
      img.src = fullUrl;
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setGeneratingBg(false);
      loadLibrary();
    }
  };

  // Aktif slot'un background'unu (image/solid/gradient) {slotCount} slota uygular.
  // backgroundIsHand + phoneScale de senkronlanır.
  const applyCurrentBackgroundToAllSlots = () => {
    const bg = slot.background;
    const isHand = slot.backgroundIsHand;
    const targetPhoneScale = isHand ? 0 : (slot.phoneScale === 0 ? 0.7 : slot.phoneScale);
    setSlots(prev => prev.map(s => ({
      ...s,
      background: bg,
      backgroundIsHand: isHand,
      phoneScale: targetPhoneScale,
    })));
  };

  // Modal açıldığında app audit verisini çeker.
  const loadAudit = async () => {
    setAuditLoading(true);
    try {
      const r = await api.request<any>(`/sites/${siteId}/aso/apps/${appId}/audit`);
      setAudit(r);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setAuditLoading(false);
    }
  };

  // Audit'teki eksikleri AI ile düzeltir (Claude/Gemini → metadata önerisi).
  const aiOptimizeMetadata = async () => {
    setOptimizing(true);
    setAiSuggestion(null);
    try {
      const keywords = (app?.keywords ?? []).map((k: any) => k.keyword).filter(Boolean).slice(0, 5);
      const r = await api.request<any>(
        `/sites/${siteId}/aso/apps/${appId}/optimize-metadata`,
        { method: 'POST', body: JSON.stringify({ targetKeywords: keywords, store: previewStore, locale: app?.country === 'tr' ? 'tr' : 'en' }) },
      );
      setAiSuggestion(r?.optimized ?? r ?? null);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setOptimizing(false);
    }
  };

  useEffect(() => {
    if (showPreview && !audit && !auditLoading) {
      loadAudit();
    }
  }, [showPreview]);

  // Galeri'den bir item'ı doğrudan {slotCount} slota uygular.
  const applyLibraryItemToAllSlots = (item: { url: string; type: 'standard' | 'hand' }) => {
    const fullUrl = process.env.NEXT_PUBLIC_API_URL ? `${process.env.NEXT_PUBLIC_API_URL}${item.url}` : item.url;
    const isHand = item.type === 'hand';
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      setSlots(prev => prev.map(s => ({
        ...s,
        background: { type: 'image', value: fullUrl, image: img },
        backgroundIsHand: isHand,
        phoneScale: isHand ? 0 : (s.phoneScale === 0 ? 0.7 : s.phoneScale),
        decorations: undefined,
      })));
    };
    img.onerror = () => toast.error('Image yüklenemedi');
    img.src = fullUrl;
  };

  const handleScreenshotUpload = (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => updateSlot({ screenshot: img, screenshotUrl: url });
    img.src = url;
  };

  const handleScreenshot2Upload = (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => updateSlot({ screenshot2: img, screenshot2Url: url });
    img.src = url;
  };

  const handleScreenshot3Upload = (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => updateSlot({ screenshot3: img, screenshot3Url: url });
    img.src = url;
  };

  const handleBackgroundUpload = (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => updateSlot({
      background: { type: 'image', value: url, image: img },
      backgroundIsHand: false,
      phoneScale: slot.phoneScale === 0 ? 0.7 : slot.phoneScale,
      decorations: undefined,
    });
    img.src = url;
  };

  const generateBackground = async (style: 'gradient' | 'mesh' | 'minimalist' | 'bold' | 'illustrative') => {
    setGeneratingBg(true);
    try {
      const result = await api.request<{ url: string; width: number; height: number }>(
        `/sites/${siteId}/aso/apps/${appId}/screenshots/background`,
        { method: 'POST', body: JSON.stringify({ style, width: preset.width, height: preset.height }) },
      );
      const fullUrl = process.env.NEXT_PUBLIC_API_URL ? `${process.env.NEXT_PUBLIC_API_URL}${result.url}` : result.url;
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => updateSlot({
        background: { type: 'image', value: fullUrl, image: img },
        phoneScale: slot.phoneScale === 0 ? 0.7 : slot.phoneScale,
        backgroundIsHand: false,
        decorations: undefined,
      });
      img.onerror = () => toast.error('Background image yüklenemedi');
      img.src = fullUrl;
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setGeneratingBg(false);
      loadLibrary(); // refresh gallery
    }
  };

  const generateCaptions = async () => {
    setGeneratingCaptions(true);
    try {
      const result = await api.request<{ captions: Array<{ slot: number; hook: string; subtitle: string }> }>(
        `/sites/${siteId}/aso/apps/${appId}/screenshots/captions`,
        { method: 'POST', body: JSON.stringify({ slotCount, locale: app?.country === 'tr' ? 'tr' : 'en' }) },
      );
      setSlots(prev => prev.map((s, i) => {
        const cap = result.captions.find(c => c.slot === i + 1);
        return cap ? { ...s, hook: cap.hook, subtitle: cap.subtitle } : s;
      }));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setGeneratingCaptions(false);
    }
  };

  const exportPng = async () => {
    if (!stageRef.current) return;
    setExporting(true);
    try {
      const stage = stageRef.current;
      const scale = preset.width / canvasViewWidth;
      const dataUrl = stage.toDataURL({ pixelRatio: scale, mimeType: 'image/png' });
      const link = document.createElement('a');
      link.download = `${app?.name ?? 'app'}-slot${activeSlot + 1}-${preset.width}x${preset.height}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err: any) {
      toast.error(`Export hatası: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const exportAll = async () => {
    setBulkExporting(true);
    try {
      const originalActive = activeSlot;
      for (let i = 0; i < slots.length; i++) {
        setActiveSlot(i);
        await new Promise(r => setTimeout(r, 500));
        if (stageRef.current) {
          const scale = preset.width / canvasViewWidth;
          const dataUrl = stageRef.current.toDataURL({ pixelRatio: scale, mimeType: 'image/png' });
          const link = document.createElement('a');
          link.download = `${app?.name ?? 'app'}-slot${i + 1}.png`;
          link.href = dataUrl;
          link.click();
        }
        await new Promise(r => setTimeout(r, 200));
      }
      setActiveSlot(originalActive);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBulkExporting(false);
    }
  };

  const canvasViewWidth = 320;
  const canvasViewHeight = (canvasViewWidth * preset.height) / preset.width;

  if (appLoading) return <div className="p-8"><Skeleton className="h-[600px]" /></div>;

  return (
    <div className="h-[calc(100vh-72px)] flex flex-col bg-muted/20">
      {/* TOP BAR */}
      <div className="bg-background border-b px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button size="sm" variant="ghost" onClick={() => router.push(`/sites/${siteId}/aso`)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> ASO
          </Button>
          {app?.iconUrl && <img src={app.iconUrl} alt="" className="h-8 w-8 rounded-lg" />}
          <div>
            <h1 className="text-sm font-bold">{app?.name} · Screenshot Studio</h1>
            <p className="text-xs text-muted-foreground">{slotCount} slot · App Store/Play Store dimensions · AI-generated</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select value={presetId} onChange={e => setPresetId(e.target.value)} className="h-9 px-2 rounded-md border border-input text-sm bg-background">
            {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label} · {p.width}×{p.height}</option>)}
          </select>
          <Button size="sm" variant="outline" onClick={() => setShowPreview(true)}>
            <Eye className="h-4 w-4 mr-1" />
            Store'da Önizle
          </Button>
          <Button size="sm" variant="outline" onClick={exportPng} disabled={exporting}>
            <Download className="h-4 w-4 mr-1" />
            {exporting ? 'İndiriliyor...' : 'Bu slotu indir'}
          </Button>
          <Button size="sm" onClick={exportAll} disabled={bulkExporting}>
            <Download className={`h-4 w-4 mr-1 ${bulkExporting ? 'animate-spin' : ''}`} />
            {bulkExporting ? 'Render...' : `${slotCount} slotu indir`}
          </Button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* SLOT NAVIGATOR — her slot için mini Konva render (decorations + phone + text birebir) */}
        <div className="w-32 bg-background border-r overflow-y-auto p-2 space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-2 px-1">{slotCount} SLOT</div>
          {slots.map((s, i) => (
            <button
              key={i}
              onClick={() => setActiveSlot(i)}
              className={`w-full p-2 rounded border text-left transition-colors ${
                activeSlot === i ? 'border-brand bg-brand/10' : 'border-border hover:border-foreground/20'
              }`}
            >
              <div className="text-xs font-bold mb-1">#{i + 1}</div>
              <div className="rounded overflow-hidden bg-muted mb-1 relative" style={{ width: '100%' }}>
                <ScreenshotStage slot={s} width={preset.width} height={preset.height} viewWidth={104} />
                {!s.screenshotUrl && (
                  <div className="absolute inset-0 grid place-items-center pointer-events-none">
                    <span className="text-[7px] text-white/70 bg-black/30 px-1 rounded">No img</span>
                  </div>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground line-clamp-1">{s.hook || 'Boş'}</div>
            </button>
          ))}
        </div>

        {/* CANVAS */}
        <div className="flex-1 grid place-items-center overflow-auto p-6">
          <Card className="shadow-2xl">
            <CardContent className="p-2">
              <ScreenshotStage
                ref={stageRef}
                slot={slot}
                width={preset.width}
                height={preset.height}
                viewWidth={canvasViewWidth}
              />
              <div className="text-center text-[10px] text-muted-foreground mt-2">
                {preset.width}×{preset.height} · Slot {activeSlot + 1}/10
              </div>
            </CardContent>
          </Card>
        </div>

        {/* SIDEBAR */}
        <div className="w-96 bg-background border-l overflow-y-auto">
          <div className="border-b grid grid-cols-6 text-xs sticky top-0 bg-background z-10">
            {[
              { id: 'ai', label: 'AI', icon: Sparkles },
              { id: 'templates', label: 'Tema', icon: ImageIcon },
              { id: 'layout', label: 'Layout', icon: RotateCw },
              { id: 'phone', label: 'Telefon', icon: Smartphone },
              { id: 'background', label: 'BG', icon: Palette },
              { id: 'text', label: 'Yazı', icon: Type },
            ].map(t => {
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  onClick={() => setSidebar(t.id as any)}
                  className={`p-2 flex flex-col items-center gap-0.5 border-r last:border-r-0 ${sidebar === t.id ? 'bg-brand/10 text-brand' : 'hover:bg-muted/50'}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span className="text-[10px]">{t.label}</span>
                </button>
              );
            })}
          </div>

          <div className="p-4 space-y-4">
            {sidebar === 'ai' && (
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-semibold mb-1">AI Caption Generator</h3>
                  <p className="text-xs text-muted-foreground mb-2">{slotCount} slot için Türkçe hook + subtitle üretir (Claude Haiku)</p>
                  <Button size="sm" className="w-full" onClick={generateCaptions} disabled={generatingCaptions}>
                    <Sparkles className={`h-4 w-4 mr-1 ${generatingCaptions ? 'animate-spin' : ''}`} />
                    {generatingCaptions ? 'AI çalışıyor...' : `${slotCount} Caption Üret`}
                  </Button>
                </div>
                <div className="border-t pt-3">
                  <h3 className="text-sm font-semibold mb-1">AI Background</h3>
                  <p className="text-xs text-muted-foreground mb-2">Gemini Imagen 3 ile bu slot için background (~10 sn)</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(['gradient', 'mesh', 'minimalist', 'bold', 'illustrative'] as const).map(s => (
                      <Button key={s} size="sm" variant="outline" onClick={() => generateBackground(s)} disabled={generatingBg} className="text-xs h-8">
                        {generatingBg ? <Loader2 className="h-3 w-3 animate-spin" /> : s}
                      </Button>
                    ))}
                  </div>
                  {slot.background.type === 'image' && (
                    <button
                      onClick={applyCurrentBackgroundToAllSlots}
                      className="w-full mt-2 text-[11px] py-1.5 px-2 rounded border border-dashed border-foreground/30 hover:border-brand hover:bg-brand/5 transition-colors flex items-center justify-center gap-1"
                    >
                      <Copy className="h-3 w-3" /> Bu BG'yi {slotCount} slota uygula
                    </button>
                  )}
                </div>

                {/* Galeri — daha önce üretilmiş AI background'lar */}
                {library.length > 0 && (
                  <div className="border-t pt-3">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-semibold flex items-center gap-1.5">
                        <ImageIcon className="h-4 w-4 text-emerald-600" />
                        Galeri · {library.length}
                      </h3>
                      <button onClick={loadLibrary} className="text-[10px] text-muted-foreground hover:text-foreground">
                        Yenile
                      </button>
                    </div>
                    <p className="text-[10px] text-muted-foreground mb-2">
                      Tıkla = aktif slota uygula · <Copy className="h-2.5 w-2.5 inline" /> ikonu = {slotCount} slota uygula
                    </p>
                    <div className="grid grid-cols-3 gap-1.5 max-h-[260px] overflow-y-auto">
                      {library.map(item => {
                        const fullUrl = (process.env.NEXT_PUBLIC_API_URL ?? '') + item.url;
                        return (
                          <div key={item.filename} className="relative group">
                            <button
                              onClick={() => applyLibraryItem(item)}
                              className="block w-full aspect-[9/19.5] rounded border-2 border-border hover:border-brand overflow-hidden bg-muted"
                              title={`${item.type === 'hand' ? '🖐️ Hand Photo' : 'Background'} — ${new Date(item.timestamp).toLocaleString('tr-TR')}`}
                            >
                              <img src={fullUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                              {item.type === 'hand' && (
                                <span className="absolute top-1 left-1 text-[8px] bg-purple-600 text-white px-1 py-0.5 rounded">
                                  🖐️
                                </span>
                              )}
                            </button>
                            <button
                              onClick={() => applyLibraryItemToAllSlots(item)}
                              className="absolute bottom-1 right-1 h-5 w-5 rounded bg-brand text-white grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-brand/80"
                              title={`${slotCount} slota uygula`}
                            >
                              <Copy className="h-3 w-3" />
                            </button>
                            <button
                              onClick={() => deleteLibraryItem(item.filename)}
                              className="absolute top-1 right-1 h-5 w-5 rounded bg-rose-600 text-white grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-rose-700"
                              title="Sil"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

              </div>
            )}

            {sidebar === 'templates' && (
              <div className="space-y-4">
                {/* Panorama setleri — dekoratif şekiller slot sınırlarını aşar, birleşik tasarım */}
                <div>
                  <div className="flex items-center gap-1.5 mb-1">
                    <Sparkles className="h-3.5 w-3.5 text-brand" />
                    <h3 className="text-sm font-semibold">Panorama Setleri</h3>
                  </div>
                  <p className="text-[11px] text-muted-foreground mb-2 leading-snug">
                    Dekoratif şekiller slot sınırlarını aşar — Vatan/Akakçe stilinde birleşik tasarım.
                  </p>

                  {/* Slot sayısı + pattern seçici */}
                  <div className="mb-2.5 rounded border bg-muted/30 p-2">
                    {/* Slot sayısı */}
                    <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 block">
                      Slot sayısı
                    </label>
                    <div className="grid grid-cols-3 gap-1 mb-2.5">
                      {([5, 8, 10] as const).map(n => (
                        <button
                          key={n}
                          onClick={() => setSlotCount(n)}
                          className={`py-1.5 rounded text-center transition-colors ${
                            slotCount === n ? 'bg-brand text-white' : 'bg-background hover:bg-muted border border-border'
                          }`}
                        >
                          <div className="text-[11px] font-bold leading-tight">{n} slot</div>
                          <div className={`text-[9px] leading-tight ${slotCount === n ? 'text-white/80' : 'text-muted-foreground'}`}>
                            {n === 5 ? 'App Store typical' : n === 8 ? 'Play Store max' : 'Apple max'}
                          </div>
                        </button>
                      ))}
                    </div>

                    {/* Pattern seçici — slot sayısına göre dinamik preset'ler */}
                    <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 block">
                      Pattern (toplam {slotCount})
                    </label>
                    <div className="grid grid-cols-2 gap-1 mb-2">
                      {(slotCount === 5 ? [
                        { p: [5],                  label: 'Tek panorama (Vatan)' },
                        { p: [1, 1, 1, 1, 1],      label: 'Tümü tekli (Teknosa)' },
                        { p: [2, 1, 1, 1],         label: 'İkili+3 Tekli (Koçtaş)' },
                        { p: [3, 1, 1],            label: '3-lü+2 Tekli (Akakçe)' },
                        { p: [1, 1, 3],            label: '2 Tekli+3-lü (Mudo)' },
                        { p: [1, 1, 2, 1],         label: 'Tekli-Tekli-2-Tekli (M.Coco)' },
                      ] : slotCount === 8 ? [
                        { p: [8],                              label: 'Tek panorama' },
                        { p: [1, 1, 1, 1, 1, 1, 1, 1],         label: 'Tümü tekli' },
                        { p: [2, 1, 1, 1, 1, 1, 1],            label: 'İkili+6 Tekli' },
                        { p: [3, 1, 1, 1, 1, 1],               label: '3-lü+5 Tekli' },
                        { p: [4, 4],                           label: '4+4' },
                        { p: [2, 2, 2, 2],                     label: '4 ikili' },
                      ] : [
                        { p: [10],                            label: 'Tek (10)' },
                        { p: [5, 5],                          label: '5+5' },
                        { p: [2, 2, 2, 2, 2],                 label: 'Beş ikili' },
                        { p: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],  label: 'Tümü tekli' },
                        { p: [2, 1, 1, 1, 2, 1, 1, 1],        label: 'İkili+3-Tekli x2' },
                        { p: [3, 1, 1, 3, 1, 1],              label: '3-lü+Tekli x2' },
                      ] as const).map((opt, idx) => {
                        const isActive = JSON.stringify(panoramaPattern) === JSON.stringify(opt.p);
                        return (
                          <button
                            key={idx}
                            onClick={() => setPanoramaPattern(opt.p as number[])}
                            className={`py-1.5 px-2 rounded text-left transition-colors ${
                              isActive ? 'bg-brand text-white' : 'bg-background hover:bg-muted border border-border'
                            }`}
                          >
                            <div className="text-[11px] font-bold leading-tight">{opt.label}</div>
                            <div className={`text-[9px] leading-tight font-mono ${isActive ? 'text-white/80' : 'text-muted-foreground'}`}>
                              {opt.p.join('-')}
                            </div>
                          </button>
                        );
                      })}
                    </div>

                    {/* Custom pattern input */}
                    <details className="mb-2">
                      <summary className="text-[10px] font-semibold cursor-pointer text-muted-foreground hover:text-foreground">
                        Özel pattern yaz (toplam {slotCount} olmalı)
                      </summary>
                      <div className="mt-1.5 flex gap-1">
                        <input
                          type="text"
                          placeholder={slotCount === 5 ? '2,1,1,1' : slotCount === 8 ? '2,1,1,1,1,1,1' : '2,1,2,1,1,3'}
                          value={customPatternInput}
                          onChange={e => setCustomPatternInput(e.target.value)}
                          className="flex-1 px-2 py-1 text-[11px] rounded border border-input bg-background"
                        />
                        <button
                          onClick={() => {
                            const parts = customPatternInput.split(/[,\s]+/).map(s => parseInt(s, 10)).filter(n => Number.isInteger(n) && n >= 1 && n <= slotCount);
                            const sum = parts.reduce((a, b) => a + b, 0);
                            if (sum === slotCount && parts.length > 0) {
                              setPanoramaPattern(parts);
                            } else {
                              toast.error(`Toplam ${slotCount} olmalı (şu an ${sum})`);
                            }
                          }}
                          className="px-2 py-1 text-[11px] rounded border border-input hover:bg-muted"
                        >
                          Uygula
                        </button>
                      </div>
                    </details>

                    {/* Mevcut pattern visual: her grup için bir bar */}
                    <div className="flex gap-0.5 h-2.5 mb-1">
                      {panoramaPattern.map((groupSize, gi) => (
                        <div
                          key={gi}
                          className={`rounded-sm ${groupSize === 1 ? 'bg-muted-foreground/40' : 'bg-brand'}`}
                          style={{ flex: groupSize }}
                          title={`Grup ${gi + 1}: ${groupSize} slot`}
                        />
                      ))}
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-snug">
                      Pattern: <span className="font-mono">{panoramaPattern.join('-')}</span>
                      {' · '}
                      {panoramaPattern.filter(s => s > 1).length} panorama,{' '}
                      {panoramaPattern.filter(s => s === 1).length} tekli
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {PANORAMA_THEMES.map(t => (
                      <button
                        key={t.id}
                        onClick={() => applyPanoramaTheme(t.id)}
                        className="rounded border-2 border-border hover:border-brand transition-colors text-left overflow-hidden"
                        title={t.description}
                      >
                        <div className="aspect-[9/16] relative" style={{ background: t.preview }}>
                          <PanoramaPreview theme={t} />
                        </div>
                        <div className="px-2 py-1.5 bg-background">
                          <div className="text-[11px] font-bold leading-tight">{t.name}</div>
                          <div className="text-[9px] text-muted-foreground leading-tight mt-0.5 line-clamp-1">{t.description}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t pt-3">
                  <h3 className="text-sm font-semibold mb-1">Renk + Yazı Şablonları</h3>
                  <p className="text-xs text-muted-foreground mb-2">Sadece bg + yazı stili, layout korunur</p>
                  <div className="grid grid-cols-2 gap-2">
                    {TEMPLATES.map(t => (
                      <button
                        key={t.id}
                        onClick={() => updateAllSlots({
                          background: t.solid
                            ? { type: 'solid', value: t.solid }
                            : { type: 'gradient', value: t.gradient },
                          textColor: t.textColor,
                          hookFontSize: t.hookFontSize,
                          textPosition: t.textPosition,
                          backgroundIsHand: false,
                          decorations: undefined,
                        })}
                        className="aspect-[9/16] rounded border-2 border-border hover:border-brand relative overflow-hidden group"
                        style={{ background: t.solid ?? t.gradient }}
                      >
                        <div className="absolute inset-0 flex items-center justify-center p-2">
                          <span className="text-[10px] font-bold text-center leading-tight" style={{ color: t.textColor }}>
                            {t.name}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {sidebar === 'layout' && (
              <div className="space-y-3">
                {/* Set Tasarımı — AI bg üret + {slotCount} slota uygula + layout dağıt */}
                <div className="rounded-lg border border-brand/40 bg-brand/5 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Sparkles className="h-4 w-4 text-brand" />
                    <h3 className="text-sm font-semibold">Set Tasarımı (10 Slot Birlikte)</h3>
                  </div>
                  <p className="text-[11px] text-muted-foreground mb-2 leading-snug">
                    AI bg üret + {slotCount} slota uygula + App Store akışıyla layout dağıt. Tüm slotlar aynı tasarım dünyasında.
                  </p>
                  <div className="grid grid-cols-3 gap-1.5 mb-2">
                    {(['gradient', 'mesh', 'illustrative'] as const).map(s => (
                      <Button
                        key={s}
                        size="sm"
                        variant="outline"
                        onClick={() => generateSetDesign(s)}
                        disabled={generatingBg}
                        className="text-[11px] h-8"
                      >
                        {generatingBg ? <Loader2 className="h-3 w-3 animate-spin" /> : s}
                      </Button>
                    ))}
                  </div>
                  <button
                    onClick={applyAutoLayout}
                    disabled={generatingBg}
                    className="w-full text-[11px] py-1.5 px-2 rounded border border-dashed border-foreground/30 hover:border-brand hover:bg-brand/5 transition-colors flex items-center justify-center gap-1 disabled:opacity-50"
                  >
                    <Sparkles className="h-3 w-3" /> Sadece layout dağıt (BG'yi koru)
                  </button>
                </div>

                <div>
                  <h3 className="text-sm font-semibold mb-1">Layout Preset'leri</h3>
                  <p className="text-xs text-muted-foreground mb-2">Aktif slota uygulanır — preview'a tıkla</p>
                  <div className="grid grid-cols-2 gap-2">
                    {LAYOUT_PRESETS.map(p => {
                      const isActive = slot.phoneLayout === p.config.phoneLayout
                        && slot.phoneTilt === (p.config.phoneTilt ?? 0)
                        && slot.textPosition === p.config.textPosition
                        && slot.phoneVerticalAlign === p.config.phoneVerticalAlign;
                      return (
                        <button
                          key={p.id}
                          onClick={() => updateSlot(p.config)}
                          className={`p-2 rounded border-2 text-left transition-colors ${
                            isActive ? 'border-brand bg-brand/5' : 'border-border hover:border-foreground/30'
                          }`}
                          title={p.description}
                        >
                          <div className="mb-1.5">
                            <LayoutPreview config={p.config} />
                          </div>
                          <div className="text-[11px] font-bold leading-tight">{p.name}</div>
                          <div className="text-[9.5px] text-muted-foreground leading-tight mt-0.5">{p.description}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="border-t pt-3">
                  <button
                    onClick={() => updateAllSlots(slot.phoneLayout && slot.textPosition ? {
                      phoneLayout: slot.phoneLayout,
                      textPosition: slot.textPosition,
                      phoneVerticalAlign: slot.phoneVerticalAlign,
                      phoneScale: slot.phoneScale,
                      phoneTilt: slot.phoneTilt,
                    } : {})}
                    className="w-full text-xs py-2 px-3 rounded border border-dashed border-foreground/30 hover:border-brand hover:bg-brand/5 transition-colors"
                  >
                    Bu layout'u {slotCount} slota uygula
                  </button>
                </div>
              </div>
            )}

            {sidebar === 'phone' && (
              <div className="space-y-3">
                {/* Multi-phone composition */}
                <div>
                  <label className="text-xs font-medium mb-1.5 block">Telefon Sayısı</label>
                  <div className="flex border rounded-md overflow-hidden h-9">
                    {(['single', 'duo', 'trio'] as const).map(layout => (
                      <button
                        key={layout}
                        onClick={() => updateSlot({ phoneLayout: layout })}
                        className={`flex-1 text-xs ${(slot.phoneLayout ?? 'single') === layout ? 'bg-brand text-white' : 'bg-background hover:bg-muted'}`}
                      >
                        {layout === 'single' ? '1 telefon' : layout === 'duo' ? '2 telefon' : '3 telefon'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Phone vertical position */}
                <div>
                  <label className="text-xs font-medium mb-1.5 block">Dikey Pozisyon</label>
                  <div className="flex border rounded-md overflow-hidden h-9">
                    {(['top', 'center', 'bottom'] as const).map(va => (
                      <button
                        key={va}
                        onClick={() => updateSlot({ phoneVerticalAlign: va })}
                        className={`flex-1 text-xs ${(slot.phoneVerticalAlign ?? 'center') === va ? 'bg-brand text-white' : 'bg-background hover:bg-muted'}`}
                      >
                        {va === 'top' ? 'Üst' : va === 'center' ? 'Orta' : 'Alt'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Phone Frame */}
                <div className="border-t pt-3">
                  <label className="text-xs font-medium mb-1.5 block">Phone Frame</label>
                  <div className="grid grid-cols-2 gap-1.5 max-h-[200px] overflow-y-auto">
                    {PHONE_FRAMES.map(f => (
                      <button
                        key={f.id}
                        onClick={() => updateSlot({ phoneFrameId: f.id })}
                        className={`p-2 rounded border text-xs transition-colors text-left ${slot.phoneFrameId === f.id ? 'border-brand bg-brand/5' : 'border-border hover:border-foreground/20'}`}
                      >
                        <div className="text-[10px] font-medium leading-tight">{f.label}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Screenshot uploads — duo/trio için 3 ayrı upload */}
                <div className="border-t pt-3">
                  <label className="text-xs font-medium mb-1.5 block">App Screenshot{(slot.phoneLayout ?? 'single') !== 'single' ? ' #1' : ''}</label>
                  <input type="file" accept="image/*" onChange={e => e.target.files?.[0] && handleScreenshotUpload(e.target.files[0])} className="text-xs w-full" />
                  {slot.screenshotUrl && (
                    <div className="mt-2 flex items-center gap-2">
                      <img src={slot.screenshotUrl} alt="" className="h-16 rounded border" />
                      <button onClick={() => updateSlot({ screenshot: undefined, screenshotUrl: undefined })} className="text-xs text-rose-600 hover:underline">
                        Sil
                      </button>
                    </div>
                  )}
                </div>
                {(slot.phoneLayout === 'duo' || slot.phoneLayout === 'trio') && (
                  <div>
                    <label className="text-xs font-medium mb-1.5 block">Screenshot #2</label>
                    <input type="file" accept="image/*" onChange={e => e.target.files?.[0] && handleScreenshot2Upload(e.target.files[0])} className="text-xs w-full" />
                    {slot.screenshot2Url && (
                      <div className="mt-2 flex items-center gap-2">
                        <img src={slot.screenshot2Url} alt="" className="h-16 rounded border" />
                        <button onClick={() => updateSlot({ screenshot2: undefined, screenshot2Url: undefined })} className="text-xs text-rose-600 hover:underline">
                          Sil
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {slot.phoneLayout === 'trio' && (
                  <div>
                    <label className="text-xs font-medium mb-1.5 block">Screenshot #3</label>
                    <input type="file" accept="image/*" onChange={e => e.target.files?.[0] && handleScreenshot3Upload(e.target.files[0])} className="text-xs w-full" />
                    {slot.screenshot3Url && (
                      <div className="mt-2 flex items-center gap-2">
                        <img src={slot.screenshot3Url} alt="" className="h-16 rounded border" />
                        <button onClick={() => updateSlot({ screenshot3: undefined, screenshot3Url: undefined })} className="text-xs text-rose-600 hover:underline">
                          Sil
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="border-t pt-3">
                  <label className="text-xs font-medium mb-1.5 block">Boyut: {Math.round(Math.min(slot.phoneScale, 1.0) * 100)}%</label>
                  <input type="range" min="0.4" max="1.0" step="0.05" value={Math.min(slot.phoneScale, 1.0)} onChange={e => updateSlot({ phoneScale: parseFloat(e.target.value) })} className="w-full" />
                </div>

                {/* Phone drop shadow intensity */}
                <div>
                  <label className="text-xs font-medium mb-1.5 block">Telefon gölgesi: {slot.phoneShadow ?? 70}%</label>
                  <input type="range" min="0" max="100" step="5" value={slot.phoneShadow ?? 70} onChange={e => updateSlot({ phoneShadow: parseInt(e.target.value) })} className="w-full" />
                </div>

                <div>
                  <label className="text-xs font-medium mb-1.5 block">Eğim: {slot.phoneTilt}°</label>
                  <input type="range" min="-30" max="30" step="1" value={slot.phoneTilt} onChange={e => updateSlot({ phoneTilt: parseInt(e.target.value) })} className="w-full" />
                </div>
              </div>
            )}

            {sidebar === 'background' && (
              <div className="space-y-3">
                <button
                  onClick={applyCurrentBackgroundToAllSlots}
                  className="w-full text-xs py-2 px-3 rounded border border-dashed border-foreground/30 hover:border-brand hover:bg-brand/5 transition-colors flex items-center justify-center gap-1.5"
                >
                  <Copy className="h-3.5 w-3.5" /> Aktif slot BG'sini {slotCount} slota uygula
                </button>

                <div>
                  <label className="text-xs font-medium mb-1.5 block">Solid Renkler (Media Markt-style)</label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {SOLID_COLORS.map(c => (
                      <button
                        key={c.value}
                        onClick={() => updateSlot({
                          background: { type: 'solid', value: c.value },
                          backgroundIsHand: false,
                          phoneScale: slot.phoneScale === 0 ? 0.7 : slot.phoneScale,
                        })}
                        title={c.name}
                        className="aspect-square rounded border-2 border-border hover:border-brand"
                        style={{ background: c.value }}
                      />
                    ))}
                  </div>
                </div>
                <div className="border-t pt-3">
                  <label className="text-xs font-medium mb-1.5 block">Gradient'ler</label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {GRADIENTS.map(g => (
                      <button
                        key={g}
                        onClick={() => updateSlot({
                          background: { type: 'gradient', value: g },
                          backgroundIsHand: false,
                          phoneScale: slot.phoneScale === 0 ? 0.7 : slot.phoneScale,
                        })}
                        className="aspect-square rounded border-2 border-border hover:border-brand"
                        style={{ background: g }}
                      />
                    ))}
                  </div>
                </div>
                <div className="border-t pt-3">
                  <label className="text-xs font-medium mb-1.5 block">Custom solid renk</label>
                  <input
                    type="color"
                    value={slot.background.type === 'solid' ? slot.background.value : '#667eea'}
                    onChange={e => updateSlot({
                      background: { type: 'solid', value: e.target.value },
                      backgroundIsHand: false,
                      phoneScale: slot.phoneScale === 0 ? 0.7 : slot.phoneScale,
                    })}
                    className="w-full h-10 cursor-pointer rounded border border-input"
                  />
                </div>
                <div className="border-t pt-3">
                  <label className="text-xs font-medium mb-1.5 block flex items-center gap-1.5">
                    <Upload className="h-3 w-3" />
                    Background görsel yükle (kendi tasarımın)
                  </label>
                  <input type="file" accept="image/*" onChange={e => e.target.files?.[0] && handleBackgroundUpload(e.target.files[0])} className="text-xs w-full" />
                  {slot.background.type === 'image' && (
                    <div className="mt-2 flex items-center gap-2">
                      <img src={slot.background.value} alt="" className="h-16 rounded border" />
                      <button onClick={() => updateSlot({
                        background: { type: 'gradient', value: GRADIENTS[0] },
                        backgroundIsHand: false,
                        phoneScale: slot.phoneScale === 0 ? 0.7 : slot.phoneScale,
                      })} className="text-xs text-rose-600 hover:underline">
                        Kaldır
                      </button>
                    </div>
                  )}
                </div>

                {/* Background overlay — text legibility için */}
                <div className="border-t pt-3">
                  <label className="text-xs font-medium mb-1.5 block">Background Overlay (yazı okunaklılığı için)</label>
                  <div className="grid grid-cols-3 gap-1">
                    {([
                      { id: 'none', label: 'Yok' },
                      { id: 'dark', label: 'Koyu %35' },
                      { id: 'light', label: 'Açık %35' },
                      { id: 'top-fade', label: 'Üst Fade' },
                      { id: 'bottom-fade', label: 'Alt Fade' },
                    ] as const).map(o => (
                      <button
                        key={o.id}
                        onClick={() => updateSlot({ bgOverlay: o.id })}
                        className={`text-[10px] py-1.5 rounded border ${(slot.bgOverlay ?? 'none') === o.id ? 'border-brand bg-brand/5' : 'border-border'}`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1.5">
                    Background image kullandığında yazı netleşmiyor mu? Overlay ekle.
                  </p>
                </div>
              </div>
            )}

            {sidebar === 'text' && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium mb-1 block">Hook (Üst başlık)</label>
                  <textarea value={slot.hook} onChange={e => updateSlot({ hook: e.target.value })} rows={2} className="w-full text-sm px-3 py-2 rounded border border-input bg-background" placeholder="Saatlerce sürüyordu" />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Subtitle (Alt açıklama)</label>
                  <textarea value={slot.subtitle} onChange={e => updateSlot({ subtitle: e.target.value })} rows={2} className="w-full text-sm px-3 py-2 rounded border border-input bg-background" placeholder="Şimdi tek tıkla, tek panelden" />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Yazı pozisyonu</label>
                  <div className="flex gap-1">
                    {(['top', 'bottom'] as const).map(p => (
                      <button key={p} onClick={() => updateSlot({ textPosition: p })} className={`flex-1 text-xs py-1.5 rounded border ${slot.textPosition === p ? 'border-brand bg-brand/5' : 'border-border'}`}>
                        {p === 'top' ? 'Üstte' : 'Altta'}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Yazı hizalaması</label>
                  <div className="flex gap-1">
                    {(['left', 'center', 'right'] as const).map(a => (
                      <button key={a} onClick={() => updateSlot({ textAlign: a })} className={`flex-1 text-xs py-1.5 rounded border ${(slot.textAlign ?? 'center') === a ? 'border-brand bg-brand/5' : 'border-border'}`}>
                        {a === 'left' ? 'Sol' : a === 'center' ? 'Orta' : 'Sağ'}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Yazı rengi</label>
                  <input type="color" value={slot.textColor} onChange={e => updateSlot({ textColor: e.target.value })} className="w-full h-10 cursor-pointer rounded border border-input" />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Hook font: {slot.hookFontSize}px</label>
                  <input type="range" min="40" max="180" step="4" value={slot.hookFontSize} onChange={e => updateSlot({ hookFontSize: parseInt(e.target.value) })} className="w-full" />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Yazı gölgesi: {slot.textShadow ?? 30}%</label>
                  <input type="range" min="0" max="100" step="5" value={slot.textShadow ?? 30} onChange={e => updateSlot({ textShadow: parseInt(e.target.value) })} className="w-full" />
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Açık yazı + parlak background'da %50+ ile okunaklılık artar.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* STORE PREVIEW MODAL */}
      {showPreview && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center p-4 overflow-y-auto"
          onClick={() => setShowPreview(false)}
        >
          <div
            className="bg-background rounded-2xl max-w-6xl w-full my-6 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="sticky top-0 z-10 bg-background rounded-t-2xl border-b px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                {app?.iconUrl && <img src={app.iconUrl} alt="" className="h-12 w-12 rounded-xl shadow shrink-0" />}
                <div className="min-w-0">
                  <h2 className="text-base font-bold truncate">{app?.name ?? 'App'} · Store Önizleme</h2>
                  <p className="text-xs text-muted-foreground">Yayınlamadan önce nasıl gözüktüğünü gör</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex border rounded-md overflow-hidden h-9">
                  <button
                    onClick={() => setPreviewStore('IOS')}
                    className={`px-3 text-xs font-medium ${previewStore === 'IOS' ? 'bg-brand text-white' : 'bg-background hover:bg-muted'}`}
                  >
                    iOS App Store
                  </button>
                  <button
                    onClick={() => setPreviewStore('ANDROID')}
                    className={`px-3 text-xs font-medium ${previewStore === 'ANDROID' ? 'bg-brand text-white' : 'bg-background hover:bg-muted'}`}
                  >
                    Play Store
                  </button>
                </div>
                <button
                  onClick={() => setShowPreview(false)}
                  className="h-9 w-9 rounded-md border hover:bg-muted grid place-items-center"
                  title="Kapat"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Store-style app header card */}
              {(() => {
                const meta: any = app?.metadata ?? {};
                const storeMeta = previewStore === 'IOS' ? meta.ios : meta.android;
                const displayTitle = aiSuggestion?.title ?? storeMeta?.title ?? app?.name ?? '—';
                const displaySubtitle = aiSuggestion?.subtitle ?? storeMeta?.subtitle ?? '';
                const rating = storeMeta?.rating ?? app?.rating ?? null;
                const ratingCount = storeMeta?.ratingCount ?? app?.ratingCount ?? null;
                const category = app?.category ?? '—';

                if (previewStore === 'IOS') {
                  return (
                    <div className="rounded-xl bg-gradient-to-b from-muted/40 to-muted/10 p-5 border">
                      <div className="flex gap-4">
                        {app?.iconUrl
                          ? <img src={app.iconUrl} alt="" className="h-24 w-24 rounded-2xl shadow-md shrink-0" />
                          : <div className="h-24 w-24 rounded-2xl bg-muted shrink-0" />
                        }
                        <div className="flex-1 min-w-0">
                          <div className="text-lg font-bold leading-tight truncate">{displayTitle}</div>
                          {displaySubtitle && (
                            <div className="text-sm text-muted-foreground truncate">{displaySubtitle}</div>
                          )}
                          <div className="text-xs text-muted-foreground mt-1">{category}</div>
                          <div className="flex items-center justify-between mt-3">
                            <div className="text-xs text-muted-foreground">
                              {rating ? (
                                <span className="flex items-center gap-1">
                                  <Star className="h-3 w-3 fill-amber-500 text-amber-500" />
                                  <span className="font-semibold text-foreground">{Number(rating).toFixed(1)}</span>
                                  {ratingCount && <span>· {Number(ratingCount).toLocaleString('tr-TR')}</span>}
                                </span>
                              ) : 'Yeni'}
                            </div>
                            <button className="px-4 py-1 rounded-full bg-blue-600 text-white text-xs font-semibold">
                              EDİN
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                }
                return (
                  <div className="rounded-xl bg-gradient-to-b from-emerald-50 to-background dark:from-emerald-950/30 p-5 border">
                    <div className="flex gap-4">
                      {app?.iconUrl
                        ? <img src={app.iconUrl} alt="" className="h-20 w-20 rounded-2xl shadow shrink-0" />
                        : <div className="h-20 w-20 rounded-2xl bg-muted shrink-0" />
                      }
                      <div className="flex-1 min-w-0">
                        <div className="text-lg font-bold leading-tight">{displayTitle}</div>
                        {displaySubtitle && (
                          <div className="text-xs text-muted-foreground line-clamp-2">{displaySubtitle}</div>
                        )}
                        <div className="flex items-center gap-3 mt-2 text-xs">
                          {rating && (
                            <span className="flex items-center gap-1">
                              <span className="font-semibold">{Number(rating).toFixed(1)}</span>
                              <Star className="h-3 w-3 fill-foreground" />
                            </span>
                          )}
                          {ratingCount && <span className="text-muted-foreground">{Number(ratingCount).toLocaleString('tr-TR')} yorum</span>}
                          <span className="text-muted-foreground">{category}</span>
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 flex gap-2">
                      <button className="flex-1 py-2 rounded-md bg-emerald-600 text-white text-sm font-semibold">Yükle</button>
                      <button className="px-4 py-2 rounded-md border text-sm">Liste</button>
                    </div>
                  </div>
                );
              })()}

              {/* Screenshots strip */}
              <div>
                <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                  <ImageIcon className="h-4 w-4" /> Ekran Görüntüleri ({slots.length})
                </h3>
                <div className="overflow-x-auto pb-2 -mx-2 px-2">
                  <div className="flex gap-3">
                    {slots.map((s, i) => {
                      const thumbW = previewStore === 'IOS' ? 130 : 120;
                      const thumbH = (thumbW * preset.height) / preset.width;
                      return (
                        <div
                          key={i}
                          className={`shrink-0 ${previewStore === 'IOS' ? 'rounded-[18px]' : 'rounded-lg'} overflow-hidden bg-muted shadow-md ring-1 ring-black/5`}
                          style={{ width: thumbW, height: thumbH }}
                        >
                          <ScreenshotStage slot={s} width={preset.width} height={preset.height} viewWidth={thumbW} />
                        </div>
                      );
                    })}
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1">Soldan sağa kaydır — 10 slot arka arkaya gösterilir, kullanıcı app sayfasında bu sırada görür.</p>
              </div>

              {/* Description preview */}
              {(() => {
                const meta: any = app?.metadata ?? {};
                const storeMeta = previewStore === 'IOS' ? meta.ios : meta.android;
                const displayDesc = aiSuggestion?.description ?? storeMeta?.description ?? '';
                if (!displayDesc) return null;
                return (
                  <div>
                    <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
                      <Type className="h-4 w-4" /> Açıklama (ilk paragraf)
                    </h3>
                    <div className="rounded-lg border p-4 text-sm leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
                      {displayDesc.slice(0, 350)}{displayDesc.length > 350 ? '…' : ''}
                    </div>
                  </div>
                );
              })()}

              {/* Analiz + AI Fix */}
              <div className="border-t pt-6">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-amber-500" /> Analiz · Eksikler & Sorunlar
                  </h3>
                  <Button size="sm" onClick={aiOptimizeMetadata} disabled={optimizing}>
                    <Wand2 className={`h-3.5 w-3.5 mr-1 ${optimizing ? 'animate-spin' : ''}`} />
                    {optimizing ? 'AI çalışıyor...' : 'AI ile Düzelt'}
                  </Button>
                </div>

                {auditLoading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                    <Loader2 className="h-4 w-4 animate-spin" /> Audit yükleniyor…
                  </div>
                )}

                {!auditLoading && audit && (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {audit.findings
                      .filter(f => f.store === previewStore || f.store === 'BOTH')
                      .filter(f => f.severity !== 'ok')
                      .map((f, i) => {
                        const color = f.severity === 'error' ? 'border-rose-300 bg-rose-50 dark:bg-rose-950/30'
                                    : f.severity === 'warning' ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/30'
                                    : 'border-blue-300 bg-blue-50 dark:bg-blue-950/30';
                        return (
                          <div key={i} className={`rounded-lg border ${color} p-3`}>
                            <div className="flex items-start gap-2">
                              {f.severity === 'error'
                                ? <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
                                : <AlertCircle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                              }
                              <div className="flex-1 min-w-0">
                                <div className="text-xs font-semibold">{f.label} <span className="text-muted-foreground font-normal">({String(f.current)})</span></div>
                                {f.message && <div className="text-xs text-muted-foreground mt-0.5">{f.message}</div>}
                                {f.recommendation && <div className="text-[11px] mt-1 opacity-80">{f.recommendation}</div>}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    {audit.findings.filter(f => (f.store === previewStore || f.store === 'BOTH') && f.severity !== 'ok').length === 0 && (
                      <div className="rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 p-3 text-sm flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        Tüm metadata alanları temiz görünüyor.
                      </div>
                    )}
                  </div>
                )}

                {/* AI suggestion preview */}
                {aiSuggestion && (
                  <div className="mt-4 rounded-lg border-2 border-brand bg-brand/5 p-4">
                    <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                      <div className="text-xs font-bold flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-brand" /> AI Önerisi (önizleme yukarıda güncellendi)
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px]"
                          onClick={() => {
                            const fields = [
                              aiSuggestion.title && `Title (${aiSuggestion.title.length}/30):\n${aiSuggestion.title}`,
                              aiSuggestion.subtitle && `Subtitle (${aiSuggestion.subtitle.length}/30):\n${aiSuggestion.subtitle}`,
                              aiSuggestion.keywords && `Keywords (${aiSuggestion.keywords.length}/100):\n${aiSuggestion.keywords}`,
                              aiSuggestion.promotionalText && `Promotional Text (${aiSuggestion.promotionalText.length}/170):\n${aiSuggestion.promotionalText}`,
                              aiSuggestion.description && `Description (${aiSuggestion.description.length}/4000):\n${aiSuggestion.description}`,
                            ].filter(Boolean).join('\n\n');
                            navigator.clipboard.writeText(fields).then(() => toast.success('Tüm öneriler panoya kopyalandı'));
                          }}
                        >
                          <Copy className="h-3 w-3 mr-1" /> Tümünü Kopyala
                        </Button>
                        <button onClick={() => setAiSuggestion(null)} className="text-[11px] text-muted-foreground hover:text-foreground">
                          Geri Al
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2 text-xs">
                      {aiSuggestion.title && (
                        <SuggestionField label="Title" value={aiSuggestion.title} limit={30} />
                      )}
                      {aiSuggestion.subtitle && (
                        <SuggestionField label="Subtitle" value={aiSuggestion.subtitle} limit={30} />
                      )}
                      {aiSuggestion.keywords && (
                        <SuggestionField label="Keywords" value={aiSuggestion.keywords} limit={100} />
                      )}
                      {aiSuggestion.promotionalText && (
                        <SuggestionField label="Promotional Text" value={aiSuggestion.promotionalText} limit={170} />
                      )}
                      {aiSuggestion.description && (
                        <SuggestionField label="Description" value={aiSuggestion.description} limit={4000} multiline />
                      )}
                    </div>

                    <p className="text-[10px] text-muted-foreground mt-3">
                      Kaydetmek için kopyala → App Store Connect / Play Console / ASO sayfasındaki metadata editörüne yapıştır.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
