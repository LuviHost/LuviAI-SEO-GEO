'use client';

import { use, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { useSiteContext } from '../../../site-context';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ArrowLeft, Upload, Sparkles, Download, Image as ImageIcon, Type, Palette,
  Smartphone, RotateCw, Eye, Plus, Trash2, ChevronLeft, ChevronRight, Check, Loader2,
} from 'lucide-react';
import { PHONE_FRAMES, type PhoneFrame } from './phone-frames';
import { TEMPLATES } from './templates';

// Konva is dynamically imported (browser-only — needs window/canvas)
const Stage = dynamic(() => import('react-konva').then(m => m.Stage), { ssr: false });
const Layer = dynamic(() => import('react-konva').then(m => m.Layer), { ssr: false });
const Rect = dynamic(() => import('react-konva').then(m => m.Rect), { ssr: false });
const KonvaImage = dynamic(() => import('react-konva').then(m => m.Image), { ssr: false });
const KonvaText = dynamic(() => import('react-konva').then(m => m.Text), { ssr: false });
const KonvaGroup = dynamic(() => import('react-konva').then(m => m.Group), { ssr: false });

// App Store dimensions presets
const PRESETS = [
  { id: 'ios-67', label: 'iPhone 6.7" (iOS)', width: 1290, height: 2796, store: 'IOS' as const },
  { id: 'ios-65', label: 'iPhone 6.5" (iOS)', width: 1242, height: 2688, store: 'IOS' as const },
  { id: 'android-phone', label: 'Android Phone', width: 1080, height: 1920, store: 'ANDROID' as const },
  { id: 'ipad', label: 'iPad Pro 13"', width: 2048, height: 2732, store: 'IOS' as const },
];

interface SlotState {
  index: number;
  background: { type: 'gradient' | 'solid' | 'image'; value: string; image?: HTMLImageElement };
  hook: string;
  subtitle: string;
  hookFontSize: number;
  textColor: string;
  textPosition: 'top' | 'bottom';
  phoneFrameId: string;
  phoneTilt: number;
  phoneScale: number;
  screenshot?: HTMLImageElement;
  screenshotUrl?: string;
}

const DEFAULT_GRADIENT = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';

function makeSlot(i: number, n = 10): SlotState {
  return {
    index: i,
    background: { type: 'gradient', value: DEFAULT_GRADIENT },
    hook: i === 0 ? 'Saatlerce sürüyordu' : '',
    subtitle: i === 0 ? 'Şimdi tek tıkla, tek panelden' : '',
    hookFontSize: 96,
    textColor: '#ffffff',
    textPosition: 'top',
    phoneFrameId: 'iphone-15-pro-black',
    phoneTilt: 0,
    phoneScale: 0.75,
  };
}

export default function ScreenshotStudioPage({ params }: { params: Promise<{ id: string; appId: string }> }) {
  const { id: siteId, appId } = use(params);
  const { site } = useSiteContext();
  const router = useRouter();

  // App data
  const [app, setApp] = useState<any>(null);
  const [appLoading, setAppLoading] = useState(true);

  // Editor state
  const [presetId, setPresetId] = useState<string>('ios-67');
  const preset = PRESETS.find(p => p.id === presetId)!;
  const [slots, setSlots] = useState<SlotState[]>(() => Array.from({ length: 10 }, (_, i) => makeSlot(i)));
  const [activeSlot, setActiveSlot] = useState(0);
  const slot = slots[activeSlot];

  // AI state
  const [generatingBg, setGeneratingBg] = useState(false);
  const [generatingCaptions, setGeneratingCaptions] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [bulkExporting, setBulkExporting] = useState(false);

  // Sidebar tab
  const [sidebar, setSidebar] = useState<'phone' | 'background' | 'text' | 'effects' | 'ai' | 'templates'>('ai');

  // Stage ref for export
  const stageRef = useRef<any>(null);
  const [stageReady, setStageReady] = useState(false);

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

  const updateAllSlots = (patch: (s: SlotState) => Partial<SlotState>) => {
    setSlots(prev => prev.map(s => ({ ...s, ...patch(s) })));
  };

  const handleScreenshotUpload = (file: File) => {
    const url = URL.createObjectURL(file);
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => updateSlot({ screenshot: img, screenshotUrl: url });
    img.src = url;
  };

  const generateBackground = async (style: SlotState['background']['type'] | 'minimalist' | 'bold' | 'illustrative' | 'gradient' | 'mesh' = 'gradient') => {
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
      // Export at full resolution (preset.width x preset.height)
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
    toast.info('10 slot tek tek render edilip ZIP olarak indirilecek (~30 sn)');
    try {
      // Sırayla her slotu aktive et, render et
      const originalActive = activeSlot;
      const dataUrls: string[] = [];
      for (let i = 0; i < slots.length; i++) {
        setActiveSlot(i);
        await new Promise(r => setTimeout(r, 400)); // wait for render
        if (stageRef.current) {
          const scale = preset.width / canvasViewWidth;
          dataUrls.push(stageRef.current.toDataURL({ pixelRatio: scale, mimeType: 'image/png' }));
        }
      }
      setActiveSlot(originalActive);
      // Trigger downloads sequentially
      dataUrls.forEach((url, i) => {
        setTimeout(() => {
          const link = document.createElement('a');
          link.download = `${app?.name ?? 'app'}-slot${i + 1}.png`;
          link.href = url;
          link.click();
        }, i * 300);
      });
      toast.success('10 slot indirildi');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBulkExporting(false);
    }
  };

  // Canvas display dimensions (responsive)
  const canvasViewWidth = 320;
  const canvasViewHeight = (canvasViewWidth * preset.height) / preset.width;
  const scale = canvasViewWidth / preset.width;

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
            <p className="text-xs text-muted-foreground">10 slot, App Store / Play Store dimensions, AI-generated</p>
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
            {bulkExporting ? '10 slot render...' : '10 slotu indir'}
          </Button>
        </div>
      </div>

      {/* MAIN AREA */}
      <div className="flex-1 flex overflow-hidden">
        {/* SLOT NAVIGATOR (left rail) */}
        <div className="w-32 bg-background border-r overflow-y-auto p-2 space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-2 px-1">10 Slot</div>
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
                style={{ background: s.background.type === 'gradient' ? s.background.value : s.background.value ? `url(${s.background.value}) center/cover` : '#888' }}
              >
                {s.hook && (
                  <div className="absolute inset-0 flex items-center justify-center p-1">
                    <span className="text-[8px] font-bold text-white text-center leading-tight line-clamp-2 drop-shadow">{s.hook}</span>
                  </div>
                )}
              </div>
              <div className="text-[10px] text-muted-foreground line-clamp-1">{s.hook || 'Boş'}</div>
            </button>
          ))}
        </div>

        {/* CANVAS (center) */}
        <div className="flex-1 grid place-items-center overflow-auto p-6">
          <Card className="shadow-2xl">
            <CardContent className="p-2">
              {typeof window !== 'undefined' && (
                <Stage
                  ref={stageRef}
                  width={canvasViewWidth}
                  height={canvasViewHeight}
                  scaleX={scale}
                  scaleY={scale}
                  onMount={() => setStageReady(true)}
                >
                  <Layer>
                    {/* Background */}
                    {slot.background.type === 'image' && slot.background.image ? (
                      <KonvaImage image={slot.background.image} x={0} y={0} width={preset.width} height={preset.height} />
                    ) : (
                      <Rect x={0} y={0} width={preset.width} height={preset.height} fillLinearGradientStartPoint={{ x: 0, y: 0 }} fillLinearGradientEndPoint={{ x: preset.width, y: preset.height }} fillLinearGradientColorStops={parseGradient(slot.background.value)} />
                    )}

                    {/* Hook text — top */}
                    {slot.textPosition === 'top' && slot.hook && (
                      <KonvaText
                        text={slot.hook}
                        x={preset.width * 0.05}
                        y={preset.height * 0.06}
                        width={preset.width * 0.9}
                        fontSize={slot.hookFontSize}
                        fontStyle="bold"
                        fontFamily="Inter, system-ui, sans-serif"
                        fill={slot.textColor}
                        align="center"
                        lineHeight={1.1}
                      />
                    )}
                    {slot.textPosition === 'top' && slot.subtitle && (
                      <KonvaText
                        text={slot.subtitle}
                        x={preset.width * 0.1}
                        y={preset.height * 0.06 + slot.hookFontSize * 1.2 + 30}
                        width={preset.width * 0.8}
                        fontSize={slot.hookFontSize * 0.4}
                        fontFamily="Inter, system-ui, sans-serif"
                        fill={slot.textColor}
                        align="center"
                        opacity={0.85}
                      />
                    )}

                    {/* Phone frame + screenshot */}
                    <PhoneFrameKonva
                      frameId={slot.phoneFrameId}
                      x={preset.width / 2}
                      y={preset.height / 2 + (slot.textPosition === 'top' ? 200 : -150)}
                      scale={slot.phoneScale}
                      tilt={slot.phoneTilt}
                      screenshot={slot.screenshot}
                      canvasWidth={preset.width}
                    />

                    {/* Hook text — bottom */}
                    {slot.textPosition === 'bottom' && slot.hook && (
                      <KonvaText
                        text={slot.hook}
                        x={preset.width * 0.05}
                        y={preset.height * 0.78}
                        width={preset.width * 0.9}
                        fontSize={slot.hookFontSize}
                        fontStyle="bold"
                        fontFamily="Inter, system-ui, sans-serif"
                        fill={slot.textColor}
                        align="center"
                        lineHeight={1.1}
                      />
                    )}
                    {slot.textPosition === 'bottom' && slot.subtitle && (
                      <KonvaText
                        text={slot.subtitle}
                        x={preset.width * 0.1}
                        y={preset.height * 0.78 + slot.hookFontSize * 1.2 + 30}
                        width={preset.width * 0.8}
                        fontSize={slot.hookFontSize * 0.4}
                        fontFamily="Inter, system-ui, sans-serif"
                        fill={slot.textColor}
                        align="center"
                        opacity={0.85}
                      />
                    )}
                  </Layer>
                </Stage>
              )}
              <div className="text-center text-[10px] text-muted-foreground mt-2">
                {preset.width}×{preset.height} · Slot {activeSlot + 1}/10
              </div>
            </CardContent>
          </Card>
        </div>

        {/* SIDEBAR (right) */}
        <div className="w-96 bg-background border-l overflow-y-auto">
          {/* Sidebar tabs */}
          <div className="border-b grid grid-cols-6 text-xs">
            {[
              { id: 'ai', label: 'AI', icon: Sparkles },
              { id: 'templates', label: 'Tema', icon: ImageIcon },
              { id: 'phone', label: 'Telefon', icon: Smartphone },
              { id: 'background', label: 'BG', icon: Palette },
              { id: 'text', label: 'Yazı', icon: Type },
              { id: 'effects', label: 'Efekt', icon: RotateCw },
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
                  <p className="text-xs text-muted-foreground mb-2">Gemini Imagen 3 ile bu slot için background</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(['gradient', 'mesh', 'minimalist', 'bold', 'illustrative'] as const).map(s => (
                      <Button key={s} size="sm" variant="outline" onClick={() => generateBackground(s)} disabled={generatingBg} className="text-xs h-8">
                        {generatingBg ? <Loader2 className="h-3 w-3 animate-spin" /> : s}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {sidebar === 'templates' && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">Hazır Şablonlar</h3>
                <p className="text-xs text-muted-foreground mb-2">Tüm slotlara uygulanır</p>
                <div className="grid grid-cols-2 gap-2">
                  {TEMPLATES.map(t => (
                    <button
                      key={t.id}
                      onClick={() => updateAllSlots(s => ({
                        background: { type: 'gradient', value: t.gradient },
                        textColor: t.textColor,
                        hookFontSize: t.hookFontSize,
                        textPosition: t.textPosition,
                      }))}
                      className="aspect-[9/16] rounded border-2 border-border hover:border-brand relative overflow-hidden"
                      style={{ background: t.gradient }}
                    >
                      <div className="absolute inset-0 flex items-center justify-center p-2">
                        <span className="text-xs font-bold text-center" style={{ color: t.textColor }}>{t.name}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {sidebar === 'phone' && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium mb-1.5 block">Phone Frame</label>
                  <div className="grid grid-cols-3 gap-1.5 max-h-[300px] overflow-y-auto">
                    {PHONE_FRAMES.map(f => (
                      <button
                        key={f.id}
                        onClick={() => updateSlot({ phoneFrameId: f.id })}
                        className={`p-2 rounded border text-xs transition-colors ${slot.phoneFrameId === f.id ? 'border-brand bg-brand/5' : 'border-border hover:border-foreground/20'}`}
                      >
                        <div className="text-[10px] font-medium leading-tight">{f.label}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="border-t pt-3">
                  <label className="text-xs font-medium mb-1.5 block">Screenshot</label>
                  <input type="file" accept="image/*" onChange={e => e.target.files?.[0] && handleScreenshotUpload(e.target.files[0])} className="text-xs w-full" />
                  {slot.screenshotUrl && (
                    <div className="mt-2">
                      <img src={slot.screenshotUrl} alt="" className="h-20 rounded border" />
                      <button onClick={() => updateSlot({ screenshot: undefined, screenshotUrl: undefined })} className="text-xs text-rose-600 mt-1 hover:underline">
                        Sil
                      </button>
                    </div>
                  )}
                </div>
                <div className="border-t pt-3">
                  <label className="text-xs font-medium mb-1.5 block">Boyut: {Math.round(slot.phoneScale * 100)}%</label>
                  <input type="range" min="0.4" max="1.2" step="0.05" value={slot.phoneScale} onChange={e => updateSlot({ phoneScale: parseFloat(e.target.value) })} className="w-full" />
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
                  <label className="text-xs font-medium mb-1.5 block">Hazır Gradient'ler</label>
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
                  <label className="text-xs font-medium mb-1.5 block">Solid Renk</label>
                  <input type="color" value={slot.background.type === 'solid' ? slot.background.value : '#667eea'} onChange={e => updateSlot({ background: { type: 'solid', value: e.target.value } })} className="w-full h-10 cursor-pointer" />
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
                  <label className="text-xs font-medium mb-1 block">Yazı rengi</label>
                  <input type="color" value={slot.textColor} onChange={e => updateSlot({ textColor: e.target.value })} className="w-full h-10 cursor-pointer" />
                </div>
                <div>
                  <label className="text-xs font-medium mb-1 block">Hook font boyutu: {slot.hookFontSize}px</label>
                  <input type="range" min="40" max="160" step="4" value={slot.hookFontSize} onChange={e => updateSlot({ hookFontSize: parseInt(e.target.value) })} className="w-full" />
                </div>
              </div>
            )}

            {sidebar === 'effects' && (
              <div className="space-y-3 text-sm">
                <p className="text-xs text-muted-foreground">Faz 3'te eklenecek: Multi-phone composition, drop shadow, glow, hand-holding, perspective…</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// === Phone Frame Konva component ===
function PhoneFrameKonva({ frameId, x, y, scale, tilt, screenshot, canvasWidth }: {
  frameId: string;
  x: number; y: number;
  scale: number;
  tilt: number;
  screenshot?: HTMLImageElement;
  canvasWidth: number;
}) {
  const frame = PHONE_FRAMES.find(f => f.id === frameId) ?? PHONE_FRAMES[0];
  const w = canvasWidth * scale * frame.aspectRatio;
  const h = w * (frame.height / frame.width);
  return (
    <KonvaGroup x={x} y={y} rotation={tilt} offsetX={w / 2} offsetY={h / 2}>
      {/* Phone body (rounded rect) */}
      <Rect x={0} y={0} width={w} height={h} cornerRadius={w * 0.13} fill={frame.bodyColor} shadowBlur={40} shadowOpacity={0.3} shadowOffset={{ x: 0, y: 20 }} />
      {/* Screen area (slightly inset) */}
      {screenshot ? (
        <KonvaImage image={screenshot} x={w * 0.02} y={h * 0.012} width={w * 0.96} height={h * 0.976} cornerRadius={w * 0.11} />
      ) : (
        <Rect x={w * 0.02} y={h * 0.012} width={w * 0.96} height={h * 0.976} cornerRadius={w * 0.11} fill="#0a0a0a" />
      )}
      {/* Notch (Pro models) */}
      {frame.hasDynamicIsland && (
        <Rect x={w / 2 - w * 0.18} y={h * 0.012} width={w * 0.36} height={h * 0.022} cornerRadius={h * 0.011} fill="#000000" />
      )}
    </KonvaGroup>
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

function parseGradient(css: string): number[] {
  // Very basic CSS gradient parser → returns Konva colorStops [0, '#fff', 1, '#000']
  const matches = css.match(/#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3}/g);
  if (!matches || matches.length < 2) return [0, '#667eea', 1, '#764ba2'];
  const stops: any[] = [];
  matches.forEach((color, i) => {
    stops.push(i / (matches.length - 1));
    stops.push(color);
  });
  return stops;
}
