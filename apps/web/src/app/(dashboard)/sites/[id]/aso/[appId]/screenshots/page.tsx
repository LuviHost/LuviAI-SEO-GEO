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
  Smartphone, RotateCw, Loader2, Upload, Trash2,
} from 'lucide-react';
import { PHONE_FRAMES } from './phone-frames';
import { TEMPLATES } from './templates';
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
  const [slots, setSlots] = useState<SlotState[]>(() => Array.from({ length: 10 }, (_, i) => makeSlot(i)));
  const [activeSlot, setActiveSlot] = useState(0);
  const slot = slots[activeSlot];

  const [generatingBg, setGeneratingBg] = useState(false);
  const [generatingCaptions, setGeneratingCaptions] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [bulkExporting, setBulkExporting] = useState(false);

  const [sidebar, setSidebar] = useState<'ai' | 'templates' | 'layout' | 'phone' | 'background' | 'text'>('ai');

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
      const preset = LAYOUT_PRESETS.find(p => p.id === presetId);
      return preset ? { ...s, ...preset.config } : s;
    }));
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
    });
    img.src = url;
  };

  const generateBackground = async (style: 'gradient' | 'mesh' | 'minimalist' | 'bold' | 'illustrative' | 'hand-photo') => {
    setGeneratingBg(true);
    try {
      const result = await api.request<{ url: string; width: number; height: number }>(
        `/sites/${siteId}/aso/apps/${appId}/screenshots/background`,
        { method: 'POST', body: JSON.stringify({ style, width: preset.width, height: preset.height }) },
      );
      const fullUrl = process.env.NEXT_PUBLIC_API_URL ? `${process.env.NEXT_PUBLIC_API_URL}${result.url}` : result.url;
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      const isHand = style === 'hand-photo';
      img.onload = () => updateSlot({
        background: { type: 'image', value: fullUrl, image: img },
        phoneScale: isHand ? 0 : (slot.phoneScale === 0 ? 0.7 : slot.phoneScale),
        backgroundIsHand: isHand,
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
        { method: 'POST', body: JSON.stringify({ slotCount: 10, locale: app?.country === 'tr' ? 'tr' : 'en' }) },
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
            <p className="text-xs text-muted-foreground">10 slot · App Store/Play Store dimensions · AI-generated</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select value={presetId} onChange={e => setPresetId(e.target.value)} className="h-9 px-2 rounded-md border border-input text-sm bg-background">
            {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label} · {p.width}×{p.height}</option>)}
          </select>
          <Button size="sm" variant="outline" onClick={exportPng} disabled={exporting}>
            <Download className="h-4 w-4 mr-1" />
            {exporting ? 'İndiriliyor...' : 'Bu slotu indir'}
          </Button>
          <Button size="sm" onClick={exportAll} disabled={bulkExporting}>
            <Download className={`h-4 w-4 mr-1 ${bulkExporting ? 'animate-spin' : ''}`} />
            {bulkExporting ? 'Render...' : '10 slotu indir'}
          </Button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* SLOT NAVIGATOR */}
        <div className="w-32 bg-background border-r overflow-y-auto p-2 space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-2 px-1">10 SLOT</div>
          {slots.map((s, i) => (
            <button
              key={i}
              onClick={() => setActiveSlot(i)}
              className={`w-full p-2 rounded border text-left transition-colors ${
                activeSlot === i ? 'border-brand bg-brand/10' : 'border-border hover:border-foreground/20'
              }`}
            >
              <div className="text-xs font-bold mb-1">#{i + 1}</div>
              <div
                className="aspect-[9/19.5] rounded mb-1 overflow-hidden relative"
                style={{
                  background: s.background.type === 'gradient' ? s.background.value :
                              s.background.type === 'solid' ? s.background.value :
                              s.background.image ? `url(${s.background.value}) center/cover` : '#888'
                }}
              >
                {/* Hook text — sadece text 'top'taysa üstte, 'bottom'taysa altta */}
                {s.hook && (
                  <div className={`absolute left-0 right-0 px-1 ${s.textPosition === 'top' ? 'top-1' : 'bottom-1'}`}>
                    <span className="text-[7px] font-bold text-center leading-tight line-clamp-2 drop-shadow block" style={{ color: s.textColor }}>
                      {s.hook}
                    </span>
                  </div>
                )}
                {/* Phone screenshot mini preview — center */}
                {s.screenshotUrl && (
                  <div
                    className={`absolute left-1/4 right-1/4 ${s.textPosition === 'top' ? 'bottom-1' : 'top-1'} aspect-[9/19] rounded-sm overflow-hidden border border-black/40 shadow-md`}
                  >
                    <img src={s.screenshotUrl} alt="" className="w-full h-full object-cover" />
                  </div>
                )}
                {/* No screenshot placeholder */}
                {!s.screenshotUrl && (
                  <div className={`absolute left-1/3 right-1/3 ${s.textPosition === 'top' ? 'bottom-1' : 'top-1'} aspect-[9/19] rounded-sm border border-dashed border-white/40 flex items-center justify-center`}>
                    <span className="text-[6px] text-white/60 text-center">No img</span>
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
                  <p className="text-xs text-muted-foreground mb-2">10 slot için Türkçe hook + subtitle üretir (Claude Haiku)</p>
                  <Button size="sm" className="w-full" onClick={generateCaptions} disabled={generatingCaptions}>
                    <Sparkles className={`h-4 w-4 mr-1 ${generatingCaptions ? 'animate-spin' : ''}`} />
                    {generatingCaptions ? 'AI çalışıyor...' : '10 Caption Üret'}
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
                      Bu app için üretilmiş AI background'lar — token harcama, tıkla tekrar kullan.
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

                <div className="border-t pt-3">
                  <h3 className="text-sm font-semibold mb-1 flex items-center gap-1.5">🖐️ AI Hand Photo</h3>
                  <p className="text-xs text-muted-foreground mb-2">
                    Gemini Imagen 3 ile el + telefon fotoğrafı üretir (boş ekranlı). Sonra Telefon sekmesinden screenshot ekleyebilirsin.
                  </p>
                  <Button size="sm" className="w-full" variant="outline" onClick={() => generateBackground('hand-photo')} disabled={generatingBg}>
                    <Sparkles className={`h-4 w-4 mr-1 ${generatingBg ? 'animate-spin' : ''}`} />
                    {generatingBg ? 'Üretiliyor (~10 sn)...' : 'El Background Üret (boş ekran)'}
                  </Button>
                </div>
              </div>
            )}

            {sidebar === 'templates' && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Hazır Şablonlar</h3>
                <p className="text-xs text-muted-foreground mb-2">Tüm slotlara uygulanır (background + yazı stili)</p>
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
            )}

            {sidebar === 'layout' && (
              <div className="space-y-3">
                {/* Auto-layout — 10 slot için akıllı dağıtım */}
                <div className="rounded-lg border border-brand/40 bg-brand/5 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Sparkles className="h-4 w-4 text-brand" />
                    <h3 className="text-sm font-semibold">Auto-Layout</h3>
                  </div>
                  <p className="text-[11px] text-muted-foreground mb-2 leading-snug">
                    10 slota App Store'da yaygın akışı uygula: hero → tilted → multi-phone → variety. Anlık, ücretsiz.
                  </p>
                  <Button size="sm" className="w-full" onClick={applyAutoLayout}>
                    <Sparkles className="h-3.5 w-3.5 mr-1" />
                    10 Slot Otomatik Dağıt
                  </Button>
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
                    Bu layout'u 10 slota uygula
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
    </div>
  );
}
