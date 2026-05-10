/**
 * Panorama temaları — 10 slotluk virtual canvas üzerinde dekoratif şekiller.
 *
 * Koordinat sistemi:
 *   vx = 0-1000 → 10 slot'un birleşik panorama'sında yatay konum (her slot = 100 birim)
 *   vy = 0-100 → slot yüksekliğinin yüzdesi
 *   vsize = virtual panorama birimi (100 = bir slot genişliği)
 *
 * Slot sınırlarını aşan şekiller komşu slotlarda yarım yarım görünür → "birleşik" his.
 */

export type DecorationShape = 'circle' | 'rect' | 'triangle' | 'ring';

export interface VirtualShape {
  type: DecorationShape;
  vx: number;       // 0-1000 panorama horizontal
  vy: number;       // 0-100 slot vertical %
  vsize: number;    // size in virtual units (slot width = 100)
  rotation?: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
}

export interface Decoration {
  type: DecorationShape;
  cx: number;       // canvas-space center X (can be negative or > canvasWidth — Konva clips)
  cy: number;       // canvas-space center Y
  size: number;     // canvas-space size
  rotation?: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
}

export interface PanoramaTheme {
  id: string;
  name: string;
  description: string;
  bg: string;       // gradient or solid color (used as background.value)
  bgType: 'gradient' | 'solid';
  preview: string;  // CSS background for swatch
  shapes: VirtualShape[];
}

export const PANORAMA_THEMES: PanoramaTheme[] = [
  // ─── Vatan-style: Mavi geometrik ────────────────────────────────
  {
    id: 'vatan-blue',
    name: 'Mavi Geometrik',
    description: 'Sarı üçgenler, cyan halkalar, mavi zemin',
    bg: 'linear-gradient(180deg, #1e5fb8 0%, #0a3a8c 100%)',
    bgType: 'gradient',
    preview: 'linear-gradient(135deg, #1e5fb8, #0a3a8c)',
    shapes: [
      // Sarı üçgenler (slot sınırlarını aşar)
      { type: 'triangle', vx: 95,  vy: 18, vsize: 38, rotation: 25,  fill: '#ffd400' },
      { type: 'triangle', vx: 195, vy: 82, vsize: 30, rotation: -35, fill: '#ffd400' },
      { type: 'triangle', vx: 305, vy: 12, vsize: 42, rotation: 15,  fill: '#ffd400' },
      { type: 'triangle', vx: 495, vy: 88, vsize: 36, rotation: -20, fill: '#ffd400' },
      { type: 'triangle', vx: 605, vy: 22, vsize: 40, rotation: 30,  fill: '#ffd400' },
      { type: 'triangle', vx: 795, vy: 78, vsize: 32, rotation: -25, fill: '#ffd400' },
      { type: 'triangle', vx: 905, vy: 15, vsize: 38, rotation: 20,  fill: '#ffd400' },
      // Cyan halkalar
      { type: 'ring', vx: 50,  vy: 50, vsize: 65, stroke: '#00d4ff', strokeWidth: 22, fill: 'transparent', opacity: 0.7 },
      { type: 'ring', vx: 250, vy: 50, vsize: 55, stroke: '#00d4ff', strokeWidth: 18, fill: 'transparent', opacity: 0.7 },
      { type: 'ring', vx: 450, vy: 50, vsize: 70, stroke: '#00d4ff', strokeWidth: 22, fill: 'transparent', opacity: 0.7 },
      { type: 'ring', vx: 650, vy: 50, vsize: 60, stroke: '#00d4ff', strokeWidth: 18, fill: 'transparent', opacity: 0.7 },
      { type: 'ring', vx: 850, vy: 50, vsize: 68, stroke: '#00d4ff', strokeWidth: 22, fill: 'transparent', opacity: 0.7 },
      // Küçük dolu daireler
      { type: 'circle', vx: 145, vy: 40, vsize: 6, fill: '#ffd400', opacity: 0.9 },
      { type: 'circle', vx: 355, vy: 65, vsize: 5, fill: '#00d4ff', opacity: 0.8 },
      { type: 'circle', vx: 555, vy: 35, vsize: 7, fill: '#ffd400', opacity: 0.9 },
      { type: 'circle', vx: 745, vy: 60, vsize: 6, fill: '#00d4ff', opacity: 0.8 },
      { type: 'circle', vx: 945, vy: 45, vsize: 8, fill: '#ffd400', opacity: 0.9 },
    ],
  },

  // ─── Amazon-style: Koyu lacivert ────────────────────────────────
  {
    id: 'amazon-navy',
    name: 'Premium Lacivert',
    description: 'Koyu zemin, parlak vurgu noktaları',
    bg: 'linear-gradient(180deg, #0f1c33 0%, #1a2845 100%)',
    bgType: 'gradient',
    preview: 'linear-gradient(135deg, #0f1c33, #1a2845)',
    shapes: [
      // Geniş yumuşak halkalar (radial glow gibi)
      { type: 'ring', vx: 100, vy: 30, vsize: 80, stroke: '#fbbf24', strokeWidth: 14, fill: 'transparent', opacity: 0.25 },
      { type: 'ring', vx: 300, vy: 70, vsize: 90, stroke: '#fbbf24', strokeWidth: 14, fill: 'transparent', opacity: 0.2 },
      { type: 'ring', vx: 500, vy: 25, vsize: 75, stroke: '#fbbf24', strokeWidth: 14, fill: 'transparent', opacity: 0.25 },
      { type: 'ring', vx: 700, vy: 75, vsize: 85, stroke: '#fbbf24', strokeWidth: 14, fill: 'transparent', opacity: 0.2 },
      { type: 'ring', vx: 900, vy: 35, vsize: 80, stroke: '#fbbf24', strokeWidth: 14, fill: 'transparent', opacity: 0.25 },
      // Vurgu noktaları (parlak sarı dots)
      { type: 'circle', vx: 50,  vy: 15, vsize: 4, fill: '#fbbf24', opacity: 0.8 },
      { type: 'circle', vx: 180, vy: 85, vsize: 5, fill: '#fbbf24', opacity: 0.7 },
      { type: 'circle', vx: 350, vy: 20, vsize: 3, fill: '#fbbf24', opacity: 0.9 },
      { type: 'circle', vx: 480, vy: 80, vsize: 5, fill: '#fbbf24', opacity: 0.7 },
      { type: 'circle', vx: 620, vy: 18, vsize: 4, fill: '#fbbf24', opacity: 0.8 },
      { type: 'circle', vx: 780, vy: 82, vsize: 6, fill: '#fbbf24', opacity: 0.7 },
      { type: 'circle', vx: 950, vy: 25, vsize: 4, fill: '#fbbf24', opacity: 0.9 },
    ],
  },

  // ─── Stripe-style: Mor blob ────────────────────────────────────
  {
    id: 'stripe-purple',
    name: 'Mor Bulut',
    description: 'Yumuşak mor blob\'lar, premium fintech görünüm',
    bg: 'linear-gradient(180deg, #6c5ce7 0%, #a855f7 100%)',
    bgType: 'gradient',
    preview: 'linear-gradient(135deg, #6c5ce7, #a855f7)',
    shapes: [
      // Büyük yumuşak daireler (blob etkisi)
      { type: 'circle', vx: 80,  vy: 25, vsize: 60, fill: '#ec4899', opacity: 0.35 },
      { type: 'circle', vx: 220, vy: 75, vsize: 70, fill: '#ec4899', opacity: 0.3 },
      { type: 'circle', vx: 380, vy: 30, vsize: 65, fill: '#ec4899', opacity: 0.35 },
      { type: 'circle', vx: 540, vy: 80, vsize: 75, fill: '#ec4899', opacity: 0.3 },
      { type: 'circle', vx: 700, vy: 35, vsize: 60, fill: '#ec4899', opacity: 0.35 },
      { type: 'circle', vx: 860, vy: 75, vsize: 70, fill: '#ec4899', opacity: 0.3 },
      // Beyaz parlamalar
      { type: 'circle', vx: 150, vy: 55, vsize: 30, fill: '#ffffff', opacity: 0.2 },
      { type: 'circle', vx: 450, vy: 50, vsize: 35, fill: '#ffffff', opacity: 0.2 },
      { type: 'circle', vx: 750, vy: 55, vsize: 30, fill: '#ffffff', opacity: 0.2 },
      // Beyaz halkalar
      { type: 'ring', vx: 300, vy: 50, vsize: 50, stroke: '#ffffff', strokeWidth: 16, fill: 'transparent', opacity: 0.4 },
      { type: 'ring', vx: 600, vy: 50, vsize: 55, stroke: '#ffffff', strokeWidth: 16, fill: 'transparent', opacity: 0.4 },
      { type: 'ring', vx: 900, vy: 50, vsize: 50, stroke: '#ffffff', strokeWidth: 16, fill: 'transparent', opacity: 0.4 },
    ],
  },

  // ─── Modern-orange: Sıcak gün batımı ──────────────────────────
  {
    id: 'modern-orange',
    name: 'Sıcak Gün Batımı',
    description: 'Turuncu gradient, kremsi vurgular',
    bg: 'linear-gradient(180deg, #ff6b35 0%, #f7c873 100%)',
    bgType: 'gradient',
    preview: 'linear-gradient(135deg, #ff6b35, #f7c873)',
    shapes: [
      // Kremsi halkalar
      { type: 'ring', vx: 60,  vy: 50, vsize: 70, stroke: '#fff5e0', strokeWidth: 18, fill: 'transparent', opacity: 0.55 },
      { type: 'ring', vx: 260, vy: 50, vsize: 60, stroke: '#fff5e0', strokeWidth: 18, fill: 'transparent', opacity: 0.55 },
      { type: 'ring', vx: 460, vy: 50, vsize: 75, stroke: '#fff5e0', strokeWidth: 18, fill: 'transparent', opacity: 0.55 },
      { type: 'ring', vx: 660, vy: 50, vsize: 65, stroke: '#fff5e0', strokeWidth: 18, fill: 'transparent', opacity: 0.55 },
      { type: 'ring', vx: 860, vy: 50, vsize: 70, stroke: '#fff5e0', strokeWidth: 18, fill: 'transparent', opacity: 0.55 },
      // Beyaz noktalar (yıldız efekti)
      { type: 'circle', vx: 130, vy: 25, vsize: 4, fill: '#ffffff', opacity: 0.8 },
      { type: 'circle', vx: 200, vy: 75, vsize: 3, fill: '#ffffff', opacity: 0.7 },
      { type: 'circle', vx: 330, vy: 30, vsize: 5, fill: '#ffffff', opacity: 0.9 },
      { type: 'circle', vx: 410, vy: 70, vsize: 3, fill: '#ffffff', opacity: 0.7 },
      { type: 'circle', vx: 530, vy: 20, vsize: 4, fill: '#ffffff', opacity: 0.8 },
      { type: 'circle', vx: 630, vy: 80, vsize: 5, fill: '#ffffff', opacity: 0.9 },
      { type: 'circle', vx: 730, vy: 28, vsize: 3, fill: '#ffffff', opacity: 0.7 },
      { type: 'circle', vx: 830, vy: 75, vsize: 4, fill: '#ffffff', opacity: 0.8 },
      { type: 'circle', vx: 930, vy: 22, vsize: 5, fill: '#ffffff', opacity: 0.9 },
      // Üçgen aksanlar
      { type: 'triangle', vx: 175, vy: 92, vsize: 25, rotation: 0,   fill: '#fff5e0', opacity: 0.5 },
      { type: 'triangle', vx: 380, vy: 8,  vsize: 22, rotation: 180, fill: '#fff5e0', opacity: 0.5 },
      { type: 'triangle', vx: 580, vy: 92, vsize: 28, rotation: 0,   fill: '#fff5e0', opacity: 0.5 },
      { type: 'triangle', vx: 780, vy: 8,  vsize: 24, rotation: 180, fill: '#fff5e0', opacity: 0.5 },
    ],
  },

  // ─── Mint Fresh: Yeşilimsi modern ─────────────────────────────
  {
    id: 'mint-fresh',
    name: 'Mint Tazeliği',
    description: 'Yeşil-cyan gradient, soft mint vurgular',
    bg: 'linear-gradient(180deg, #10b981 0%, #06b6d4 100%)',
    bgType: 'gradient',
    preview: 'linear-gradient(135deg, #10b981, #06b6d4)',
    shapes: [
      { type: 'circle', vx: 90,  vy: 35, vsize: 55, fill: '#ffffff', opacity: 0.18 },
      { type: 'circle', vx: 280, vy: 70, vsize: 65, fill: '#ffffff', opacity: 0.18 },
      { type: 'circle', vx: 470, vy: 30, vsize: 60, fill: '#ffffff', opacity: 0.18 },
      { type: 'circle', vx: 660, vy: 75, vsize: 70, fill: '#ffffff', opacity: 0.18 },
      { type: 'circle', vx: 850, vy: 35, vsize: 58, fill: '#ffffff', opacity: 0.18 },
      { type: 'ring', vx: 180, vy: 60, vsize: 45, stroke: '#fff', strokeWidth: 16, fill: 'transparent', opacity: 0.45 },
      { type: 'ring', vx: 380, vy: 60, vsize: 50, stroke: '#fff', strokeWidth: 16, fill: 'transparent', opacity: 0.45 },
      { type: 'ring', vx: 580, vy: 60, vsize: 45, stroke: '#fff', strokeWidth: 16, fill: 'transparent', opacity: 0.45 },
      { type: 'ring', vx: 780, vy: 60, vsize: 50, stroke: '#fff', strokeWidth: 16, fill: 'transparent', opacity: 0.45 },
      { type: 'ring', vx: 980, vy: 60, vsize: 45, stroke: '#fff', strokeWidth: 16, fill: 'transparent', opacity: 0.45 },
    ],
  },

  // ─── Coral Sunset: Mercan tonları ────────────────────────────
  {
    id: 'coral-sunset',
    name: 'Mercan Gün Batımı',
    description: 'Pembe-coral gradient, beyaz dalga aksanları',
    bg: 'linear-gradient(180deg, #ff5e8a 0%, #ff9676 100%)',
    bgType: 'gradient',
    preview: 'linear-gradient(135deg, #ff5e8a, #ff9676)',
    shapes: [
      { type: 'circle', vx: 80,  vy: 80, vsize: 50, fill: '#ffd4d4', opacity: 0.45 },
      { type: 'circle', vx: 280, vy: 20, vsize: 55, fill: '#ffd4d4', opacity: 0.45 },
      { type: 'circle', vx: 480, vy: 75, vsize: 50, fill: '#ffd4d4', opacity: 0.45 },
      { type: 'circle', vx: 680, vy: 25, vsize: 60, fill: '#ffd4d4', opacity: 0.45 },
      { type: 'circle', vx: 880, vy: 80, vsize: 55, fill: '#ffd4d4', opacity: 0.45 },
      { type: 'ring', vx: 175, vy: 50, vsize: 40, stroke: '#fff', strokeWidth: 14, fill: 'transparent', opacity: 0.5 },
      { type: 'ring', vx: 375, vy: 50, vsize: 45, stroke: '#fff', strokeWidth: 14, fill: 'transparent', opacity: 0.5 },
      { type: 'ring', vx: 575, vy: 50, vsize: 40, stroke: '#fff', strokeWidth: 14, fill: 'transparent', opacity: 0.5 },
      { type: 'ring', vx: 775, vy: 50, vsize: 45, stroke: '#fff', strokeWidth: 14, fill: 'transparent', opacity: 0.5 },
      { type: 'ring', vx: 975, vy: 50, vsize: 40, stroke: '#fff', strokeWidth: 14, fill: 'transparent', opacity: 0.5 },
      { type: 'circle', vx: 220, vy: 60, vsize: 5, fill: '#fff', opacity: 0.8 },
      { type: 'circle', vx: 420, vy: 35, vsize: 4, fill: '#fff', opacity: 0.9 },
      { type: 'circle', vx: 620, vy: 65, vsize: 6, fill: '#fff', opacity: 0.8 },
      { type: 'circle', vx: 820, vy: 30, vsize: 4, fill: '#fff', opacity: 0.9 },
    ],
  },

  // ─── Ocean Deep: Derin okyanus ───────────────────────────────
  {
    id: 'ocean-deep',
    name: 'Derin Okyanus',
    description: 'Navy → teal gradient, parlayan kabarcıklar',
    bg: 'linear-gradient(180deg, #0a1b3e 0%, #0d4a6b 100%)',
    bgType: 'gradient',
    preview: 'linear-gradient(135deg, #0a1b3e, #0d4a6b)',
    shapes: [
      { type: 'circle', vx: 70,  vy: 25, vsize: 12, fill: '#5ee5ff', opacity: 0.55 },
      { type: 'circle', vx: 130, vy: 75, vsize: 18, fill: '#5ee5ff', opacity: 0.4 },
      { type: 'circle', vx: 200, vy: 40, vsize: 8,  fill: '#a8f0ff', opacity: 0.7 },
      { type: 'circle', vx: 280, vy: 65, vsize: 22, fill: '#5ee5ff', opacity: 0.35 },
      { type: 'circle', vx: 360, vy: 30, vsize: 14, fill: '#5ee5ff', opacity: 0.5 },
      { type: 'circle', vx: 440, vy: 70, vsize: 10, fill: '#a8f0ff', opacity: 0.7 },
      { type: 'circle', vx: 510, vy: 35, vsize: 20, fill: '#5ee5ff', opacity: 0.4 },
      { type: 'circle', vx: 590, vy: 80, vsize: 15, fill: '#5ee5ff', opacity: 0.45 },
      { type: 'circle', vx: 660, vy: 25, vsize: 11, fill: '#a8f0ff', opacity: 0.6 },
      { type: 'circle', vx: 740, vy: 60, vsize: 24, fill: '#5ee5ff', opacity: 0.35 },
      { type: 'circle', vx: 820, vy: 30, vsize: 13, fill: '#5ee5ff', opacity: 0.5 },
      { type: 'circle', vx: 900, vy: 70, vsize: 16, fill: '#a8f0ff', opacity: 0.55 },
      { type: 'circle', vx: 970, vy: 35, vsize: 9,  fill: '#5ee5ff', opacity: 0.7 },
      { type: 'ring',   vx: 250, vy: 50, vsize: 50, stroke: '#5ee5ff', strokeWidth: 12, fill: 'transparent', opacity: 0.25 },
      { type: 'ring',   vx: 550, vy: 50, vsize: 55, stroke: '#5ee5ff', strokeWidth: 12, fill: 'transparent', opacity: 0.25 },
      { type: 'ring',   vx: 850, vy: 50, vsize: 50, stroke: '#5ee5ff', strokeWidth: 12, fill: 'transparent', opacity: 0.25 },
    ],
  },

  // ─── Cyber Neon: Mor-pembe neon ──────────────────────────────
  {
    id: 'cyber-neon',
    name: 'Cyber Neon',
    description: 'Koyu mor zemin, neon pembe ve cyan ışıklar',
    bg: 'linear-gradient(180deg, #1a0b3d 0%, #4c1d6a 100%)',
    bgType: 'gradient',
    preview: 'linear-gradient(135deg, #1a0b3d, #4c1d6a)',
    shapes: [
      { type: 'ring',   vx: 100, vy: 35, vsize: 60, stroke: '#ff2da8', strokeWidth: 14, fill: 'transparent', opacity: 0.7 },
      { type: 'ring',   vx: 300, vy: 65, vsize: 70, stroke: '#00f0ff', strokeWidth: 14, fill: 'transparent', opacity: 0.6 },
      { type: 'ring',   vx: 500, vy: 35, vsize: 65, stroke: '#ff2da8', strokeWidth: 14, fill: 'transparent', opacity: 0.7 },
      { type: 'ring',   vx: 700, vy: 65, vsize: 75, stroke: '#00f0ff', strokeWidth: 14, fill: 'transparent', opacity: 0.6 },
      { type: 'ring',   vx: 900, vy: 35, vsize: 60, stroke: '#ff2da8', strokeWidth: 14, fill: 'transparent', opacity: 0.7 },
      { type: 'circle', vx: 50,  vy: 20, vsize: 5, fill: '#ff2da8', opacity: 0.9 },
      { type: 'circle', vx: 180, vy: 80, vsize: 6, fill: '#00f0ff', opacity: 0.9 },
      { type: 'circle', vx: 380, vy: 18, vsize: 5, fill: '#ff2da8', opacity: 0.9 },
      { type: 'circle', vx: 560, vy: 80, vsize: 7, fill: '#00f0ff', opacity: 0.9 },
      { type: 'circle', vx: 740, vy: 22, vsize: 5, fill: '#ff2da8', opacity: 0.9 },
      { type: 'circle', vx: 920, vy: 78, vsize: 6, fill: '#00f0ff', opacity: 0.9 },
    ],
  },

  // ─── Forest Calm: Yeşil orman ────────────────────────────────
  {
    id: 'forest-calm',
    name: 'Sakin Orman',
    description: 'Koyu yeşil zemin, açık yaprak vurgular',
    bg: 'linear-gradient(180deg, #0f3a2e 0%, #1f6b4d 100%)',
    bgType: 'gradient',
    preview: 'linear-gradient(135deg, #0f3a2e, #1f6b4d)',
    shapes: [
      { type: 'triangle', vx: 90,  vy: 30, vsize: 28, rotation: 35,  fill: '#7fdba8', opacity: 0.6 },
      { type: 'triangle', vx: 190, vy: 75, vsize: 22, rotation: -25, fill: '#a3f0c1', opacity: 0.55 },
      { type: 'triangle', vx: 310, vy: 28, vsize: 30, rotation: 15,  fill: '#7fdba8', opacity: 0.6 },
      { type: 'triangle', vx: 490, vy: 78, vsize: 26, rotation: -30, fill: '#a3f0c1', opacity: 0.55 },
      { type: 'triangle', vx: 610, vy: 32, vsize: 28, rotation: 40,  fill: '#7fdba8', opacity: 0.6 },
      { type: 'triangle', vx: 790, vy: 75, vsize: 24, rotation: -20, fill: '#a3f0c1', opacity: 0.55 },
      { type: 'triangle', vx: 910, vy: 28, vsize: 28, rotation: 30,  fill: '#7fdba8', opacity: 0.6 },
      { type: 'circle', vx: 250, vy: 55, vsize: 40, fill: '#a3f0c1', opacity: 0.18 },
      { type: 'circle', vx: 450, vy: 50, vsize: 45, fill: '#a3f0c1', opacity: 0.18 },
      { type: 'circle', vx: 650, vy: 55, vsize: 40, fill: '#a3f0c1', opacity: 0.18 },
      { type: 'circle', vx: 850, vy: 50, vsize: 45, fill: '#a3f0c1', opacity: 0.18 },
    ],
  },

  // ─── Monochrome: Siyah-beyaz minimal ─────────────────────────
  {
    id: 'monochrome',
    name: 'Monochrome',
    description: 'Siyah-gri minimal, ince beyaz çizgiler',
    bg: 'linear-gradient(180deg, #18181b 0%, #3f3f46 100%)',
    bgType: 'gradient',
    preview: 'linear-gradient(135deg, #18181b, #3f3f46)',
    shapes: [
      { type: 'ring',   vx: 50,  vy: 50, vsize: 70, stroke: '#ffffff', strokeWidth: 8, fill: 'transparent', opacity: 0.35 },
      { type: 'ring',   vx: 250, vy: 50, vsize: 80, stroke: '#ffffff', strokeWidth: 8, fill: 'transparent', opacity: 0.3 },
      { type: 'ring',   vx: 450, vy: 50, vsize: 75, stroke: '#ffffff', strokeWidth: 8, fill: 'transparent', opacity: 0.35 },
      { type: 'ring',   vx: 650, vy: 50, vsize: 85, stroke: '#ffffff', strokeWidth: 8, fill: 'transparent', opacity: 0.3 },
      { type: 'ring',   vx: 850, vy: 50, vsize: 75, stroke: '#ffffff', strokeWidth: 8, fill: 'transparent', opacity: 0.35 },
      { type: 'circle', vx: 150, vy: 25, vsize: 3, fill: '#ffffff', opacity: 0.7 },
      { type: 'circle', vx: 350, vy: 75, vsize: 4, fill: '#ffffff', opacity: 0.7 },
      { type: 'circle', vx: 550, vy: 25, vsize: 3, fill: '#ffffff', opacity: 0.7 },
      { type: 'circle', vx: 750, vy: 75, vsize: 4, fill: '#ffffff', opacity: 0.7 },
      { type: 'circle', vx: 950, vy: 25, vsize: 3, fill: '#ffffff', opacity: 0.7 },
    ],
  },

  // ─── Pastel Dreams: Soft pastel ──────────────────────────────
  {
    id: 'pastel-dreams',
    name: 'Pastel Rüya',
    description: 'Soft lila-pembe pastel, kız tonu yumuşak',
    bg: 'linear-gradient(180deg, #c4b5fd 0%, #fbcfe8 100%)',
    bgType: 'gradient',
    preview: 'linear-gradient(135deg, #c4b5fd, #fbcfe8)',
    shapes: [
      { type: 'circle', vx: 70,  vy: 40, vsize: 50, fill: '#fff', opacity: 0.5 },
      { type: 'circle', vx: 180, vy: 75, vsize: 35, fill: '#a5f3fc', opacity: 0.55 },
      { type: 'circle', vx: 290, vy: 30, vsize: 55, fill: '#fff', opacity: 0.5 },
      { type: 'circle', vx: 400, vy: 70, vsize: 40, fill: '#fde68a', opacity: 0.55 },
      { type: 'circle', vx: 510, vy: 35, vsize: 50, fill: '#fff', opacity: 0.5 },
      { type: 'circle', vx: 620, vy: 75, vsize: 38, fill: '#a5f3fc', opacity: 0.55 },
      { type: 'circle', vx: 730, vy: 30, vsize: 52, fill: '#fff', opacity: 0.5 },
      { type: 'circle', vx: 840, vy: 70, vsize: 42, fill: '#fde68a', opacity: 0.55 },
      { type: 'circle', vx: 950, vy: 35, vsize: 48, fill: '#fff', opacity: 0.5 },
      { type: 'ring',   vx: 240, vy: 50, vsize: 30, stroke: '#fff', strokeWidth: 12, fill: 'transparent', opacity: 0.6 },
      { type: 'ring',   vx: 560, vy: 50, vsize: 35, stroke: '#fff', strokeWidth: 12, fill: 'transparent', opacity: 0.6 },
      { type: 'ring',   vx: 880, vy: 50, vsize: 30, stroke: '#fff', strokeWidth: 12, fill: 'transparent', opacity: 0.6 },
    ],
  },
];

/**
 * Bir slot için, panorama temasından kendi penceresine düşen dekorasyonları üretir.
 *
 * Tema 0-1000 vx aralığı toplam 10 slot için tasarlandı. Grup boyutuna göre tema
 * gruplara bölünür — her grup unique bir slice alır:
 *
 *   groupSize 10, 1 grup  → grup 0: vx 0-1000 (tek büyük panorama)
 *   groupSize 5,  2 grup  → grup 0: vx 0-500, grup 1: vx 500-1000
 *   groupSize 2,  5 grup  → grup 0: vx 0-200, ..., grup 4: vx 800-1000
 *   groupSize 1,  10 grup → her slot kendi 100 birimini alır (grup başına 1 slot)
 *
 * Şekiller orijinal boyutta kalır (sıkıştırma yok). Slot sınırını aşan şekiller
 * sadece KENDİ GRUBU içindeki komşu slotlarda görünür — grup sınırını aşmaz.
 *
 * @param theme — panorama teması (vx 0-1000 koordinat aralığı)
 * @param slotIndexInGroup — bu slotun grubundaki konumu (0 to groupSize-1)
 * @param groupSize — panorama grubu kaç slottan oluşuyor (1, 2, 5, 10)
 * @param groupIndex — bu slotun ait olduğu grubun index'i (0..numGroups-1)
 * @returns canvas-space koordinatlarında Decoration listesi
 */
export function computeSlotDecorations(
  theme: PanoramaTheme,
  slotIndexInGroup: number,
  groupSize: number,
  groupIndex: number,
  canvasWidth: number,
  canvasHeight: number,
): Decoration[] {
  const TOTAL_SLOTS = 10;
  const numGroups = Math.max(1, Math.floor(TOTAL_SLOTS / groupSize));
  const groupVxSpan = 1000 / numGroups;          // örn. groupSize=2 → 200
  const groupVxStart = groupIndex * groupVxSpan;
  const groupVxEnd = groupVxStart + groupVxSpan;
  const slotVxStart = groupVxStart + slotIndexInGroup * 100;
  const slotVxEnd = slotVxStart + 100;

  const out: Decoration[] = [];

  for (const s of theme.shapes) {
    // Şekil hangi gruba ait? (merkezine bak)
    const shapeGroupIndex = Math.min(numGroups - 1, Math.floor(s.vx / groupVxSpan));
    if (shapeGroupIndex !== groupIndex) continue;   // başka grubun şekli, atlat

    // Slot penceresine giriyor mu?
    const shapeStart = s.vx - s.vsize;
    const shapeEnd   = s.vx + s.vsize;
    if (shapeEnd < slotVxStart || shapeStart > slotVxEnd) continue;

    // Canvas koordinatlarına çevir
    const relVx = s.vx - slotVxStart;             // 0-100 slot içi, negatif/100+ taşma (komşu slota uzanır)
    const cx = (relVx / 100) * canvasWidth;
    const cy = (s.vy / 100) * canvasHeight;
    const size = (s.vsize / 100) * canvasWidth;

    out.push({
      type: s.type,
      cx, cy, size,
      rotation: s.rotation,
      fill: s.fill,
      stroke: s.stroke,
      strokeWidth: s.strokeWidth ? s.strokeWidth * (canvasWidth / 1290) : undefined,
      opacity: s.opacity,
    });
  }

  return out;
}
