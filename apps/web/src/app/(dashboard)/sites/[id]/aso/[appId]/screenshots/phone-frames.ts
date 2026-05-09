/** Phone frame metadata. Konva ile rounded rect olarak çizilir (SVG değil — perf). */
export interface PhoneFrame {
  id: string;
  label: string;
  width: number;  // pixel reference (for aspect ratio)
  height: number;
  aspectRatio: number; // width / canvas width oranı
  bodyColor: string;
  hasDynamicIsland: boolean;
  hasNotch: boolean;
  store: 'IOS' | 'ANDROID' | 'BOTH';
}

export const PHONE_FRAMES: PhoneFrame[] = [
  // iOS
  { id: 'iphone-15-pro-black',  label: 'iPhone 15 Pro · Black',  width: 393, height: 852, aspectRatio: 0.45, bodyColor: '#1d1d1f', hasDynamicIsland: true,  hasNotch: false, store: 'IOS' },
  { id: 'iphone-15-pro-titan',  label: 'iPhone 15 Pro · Titan',  width: 393, height: 852, aspectRatio: 0.45, bodyColor: '#8a8d92', hasDynamicIsland: true,  hasNotch: false, store: 'IOS' },
  { id: 'iphone-15-pro-white',  label: 'iPhone 15 Pro · White',  width: 393, height: 852, aspectRatio: 0.45, bodyColor: '#f0eee5', hasDynamicIsland: true,  hasNotch: false, store: 'IOS' },
  { id: 'iphone-15-blue',       label: 'iPhone 15 · Blue',       width: 393, height: 852, aspectRatio: 0.45, bodyColor: '#3b6688', hasDynamicIsland: true,  hasNotch: false, store: 'IOS' },
  { id: 'iphone-15-pink',       label: 'iPhone 15 · Pink',       width: 393, height: 852, aspectRatio: 0.45, bodyColor: '#ffb3c7', hasDynamicIsland: true,  hasNotch: false, store: 'IOS' },
  { id: 'iphone-14-black',      label: 'iPhone 14 · Black',      width: 390, height: 844, aspectRatio: 0.45, bodyColor: '#1d1d1f', hasDynamicIsland: false, hasNotch: true,  store: 'IOS' },
  { id: 'iphone-se-3',          label: 'iPhone SE 3',            width: 375, height: 667, aspectRatio: 0.50, bodyColor: '#1d1d1f', hasDynamicIsland: false, hasNotch: false, store: 'IOS' },
  { id: 'ipad-pro-13',          label: 'iPad Pro 13"',           width: 1024, height: 1366, aspectRatio: 0.7, bodyColor: '#1d1d1f', hasDynamicIsland: false, hasNotch: false, store: 'IOS' },
  // Android
  { id: 'pixel-8-pro-black',    label: 'Pixel 8 Pro · Black',    width: 412, height: 916, aspectRatio: 0.45, bodyColor: '#0e1216', hasDynamicIsland: false, hasNotch: false, store: 'ANDROID' },
  { id: 'pixel-8-mint',         label: 'Pixel 8 · Mint',         width: 412, height: 916, aspectRatio: 0.45, bodyColor: '#a3c4a8', hasDynamicIsland: false, hasNotch: false, store: 'ANDROID' },
  { id: 'galaxy-s24-ultra',     label: 'Galaxy S24 Ultra · Titan', width: 412, height: 916, aspectRatio: 0.46, bodyColor: '#404347', hasDynamicIsland: false, hasNotch: false, store: 'ANDROID' },
  { id: 'galaxy-s24-violet',    label: 'Galaxy S24 · Violet',    width: 412, height: 916, aspectRatio: 0.45, bodyColor: '#665a87', hasDynamicIsland: false, hasNotch: false, store: 'ANDROID' },
];
