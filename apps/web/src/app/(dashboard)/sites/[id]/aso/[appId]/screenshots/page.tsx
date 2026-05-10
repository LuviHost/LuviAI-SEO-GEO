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
  Smartphone, RotateCw, Loader2, Upload,
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
  };
}

// Layout presets — Hero (text top + single phone), Showcase (2 phones), Comparison (3 phones)
const LAYOUT_PRESETS = [
  {
    id: 'hero',
    name: 'Hero',
    description: 'Tek telefon ortada, üstte güçlü hook',
    config: { phoneLayout: 'single' as const, textPosition: 'top' as const, phoneVerticalAlign: 'center' as const, phoneScale: 0.75, phoneTilt: 0 },
  },
  {
    id: 'showcase',
    name: 'Showcase',
    description: '2 telefon yan yana, premium look',
    config: { phoneLayout: 'duo' as const, textPosition: 'top' as const, phoneVerticalAlign: 'center' as const, phoneScale: 0.7, phoneTilt: 0 },
  },
  {
    id: 'comparison',
    name: 'Comparison',
    description: '3 telefon kademeli, feature showcase',
    config: { phoneLayout: 'trio' as const, textPosition: 'top' as const, phoneVerticalAlign: 'center' as const, phoneScale: 0.75, phoneTilt: 0 },
  },
  {
    id: 'tilted-right',
    name: 'Tilted Right',
    description: 'Sağa eğik tek telefon — Media Markt style',
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

  const stageRef = useRef<Konva.Stage>(null);

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
    img.onload = () => updateSlot({ background: { type: 'image', value: url, image: img } });
    img.src = url;
  };

  const generateBackground = async (style: 'gradient' | 'mesh' | 'minimalist' | 'bold' | 'illustrative' | 'hand-photo') => {
    setGeneratingBg(true);
    try {
      toast.info('Gemini Imagen 3 background üretiyor (~10 sn)...');
      const result = await api.request<{ url: string; width: number; height: number }>(
        `/sites/${siteId}/aso/apps/${appId}/screenshots/background`,
        { method: 'POST', body: JSON.stringify({ style, width: preset.width, height: preset.height }) },
      );
      const fullUrl = process.env.NEXT_PUBLIC_API_URL ? `${process.env.NEXT_PUBLIC_API_URL}${result.url}` : result.url;
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => updateSlot({ background: { type: 'image', value: fullUrl, image: img } });
      img.onerror = () => toast.error('Background image yüklenemedi');
      img.src = fullUrl;
      toast.success('Background hazır');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setGeneratingBg(false);
    }
  };

  const generateCaptions = async () => {
    setGeneratingCaptions(true);
    try {
      toast.info('AI tüm slotlar için caption üretiyor (~20 sn)...');
      const result = await api.request<{ captions: Array<{ slot: number; hook: string; subtitle: string }> }>(
        `/sites/${siteId}/aso/apps/${appId}/screenshots/captions`,
        { method: 'POST', body: JSON.stringify({ slotCount: 10, locale: app?.country === 'tr' ? 'tr' : 'en' }) },
      );
      setSlots(prev => prev.map((s, i) => {
        const cap = result.captions.find(c => c.slot === i + 1);
        return cap ? { ...s, hook: cap.hook, subtitle: cap.subtitle } : s;
      }));
      toast.success(`${result.captions.length} caption üretildi`);
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
      toast.success(`Slot ${activeSlot + 1} indirildi`);
    } catch (err: any) {
      toast.error(`Export hatası: ${err.message}`);
    } finally {
      setExporting(false);
    }
  };

  const exportAll = async () => {
    setBulkExporting(true);
    toast.info(`10 slot tek tek indirilecek (~${slots.length * 0.5} sn)`);
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
      toast.success('10 slot indirildi');
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

                <div className="border-t pt-3">
                  <h3 className="text-sm font-semibold mb-1 flex items-center gap-1.5">🖐️ AI Hand Photo</h3>
                  <p className="text-xs text-muted-foreground mb-2">
                    Photorealistic el+telefon fotoğrafı (Gemini Imagen 3) — background olarak kullan, üstüne kendi telefonu da yerleştir.
                  </p>
                  <Button size="sm" className="w-full" variant="outline" onClick={() => generateBackground('hand-photo')} disabled={generatingBg}>
                    <Sparkles className={`h-4 w-4 mr-1 ${generatingBg ? 'animate-spin' : ''}`} />
                    {generatingBg ? 'Üretiliyor (~10 sn)...' : 'AI Hand Photo Üret'}
                  </Button>
                  <p className="text-[10px] text-muted-foreground mt-1.5">
                    Tip: Üretildikten sonra Telefon tab'da boyutu küçülterek (60-65%) hand'in içindeymiş gibi göster.
                  </p>
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
                <h3 className="text-sm font-semibold">Layout Preset'leri</h3>
                <p className="text-xs text-muted-foreground mb-2">Tek tıkla telefon + yazı kompozisyonu — bu slot için</p>
                <div className="grid grid-cols-2 gap-2">
                  {LAYOUT_PRESETS.map(p => (
                    <button
                      key={p.id}
                      onClick={() => updateSlot(p.config)}
                      className={`p-3 rounded border-2 text-left transition-colors ${
                        slot.phoneLayout === p.config.phoneLayout && slot.phoneTilt === (p.config.phoneTilt ?? 0) && slot.textPosition === p.config.textPosition
                          ? 'border-brand bg-brand/5'
                          : 'border-border hover:border-foreground/30'
                      }`}
                    >
                      <div className="text-xs font-bold mb-0.5">{p.name}</div>
                      <div className="text-[10px] text-muted-foreground leading-tight">{p.description}</div>
                    </button>
                  ))}
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
                  <label className="text-xs font-medium mb-1.5 block">Boyut: {Math.round(slot.phoneScale * 100)}%</label>
                  <input type="range" min="0.4" max="1.2" step="0.05" value={slot.phoneScale} onChange={e => updateSlot({ phoneScale: parseFloat(e.target.value) })} className="w-full" />
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
                        onClick={() => updateSlot({ background: { type: 'solid', value: c.value } })}
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
                        onClick={() => updateSlot({ background: { type: 'gradient', value: g } })}
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
                    onChange={e => updateSlot({ background: { type: 'solid', value: e.target.value } })}
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
                      <button onClick={() => updateSlot({ background: { type: 'gradient', value: GRADIENTS[0] } })} className="text-xs text-rose-600 hover:underline">
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
