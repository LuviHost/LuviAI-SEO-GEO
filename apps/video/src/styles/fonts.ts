import { useEffect, useState } from 'react';
import { cancelRender, continueRender, delayRender, staticFile } from 'remotion';
import { STYLE_FONTS, type VideoStyle } from './registry.mjs';

/**
 * Stil fontlari — yerel OFL dosyalari (public/fonts, lisans public/fonts/OFL.txt), FontFace ile yuklenir
 * (marketing/kit.tsx useBrandFonts ile ayni yontem; @remotion/fonts loadFont da ayni FontFace + delayRender
 * isini yapar — yeni bagimlilik eklenmedi). Google Fonts 'latin' alt kumesi KULLANILMAZ: ş ğ ı İ glifleri yok.
 * Yuklenmeden kare cekilmez; metin olcumu (canvas) ancak hazir olunca yapilir.
 */

export const fontSora = "'Sora', 'Plus Jakarta Sans', sans-serif";
export const fontJakarta = "'Plus Jakarta Sans', 'Sora', sans-serif";
export const fontInter = "'Inter', 'Plus Jakarta Sans', sans-serif";
export const fontAnton = "'Anton', 'Sora', sans-serif";
export const fontCaveat = "'Caveat', 'Plus Jakarta Sans', cursive";

const BASE = [
  { family: 'Sora', file: 'fonts/Sora.ttf', weight: '100 800' },
  { family: 'Plus Jakarta Sans', file: 'fonts/PlusJakartaSans.ttf', weight: '200 800' },
];

const loaded = new Map<string, Promise<void>>();
function load(family: string, file: string, weight: string): Promise<void> {
  const key = `${family}|${file}`;
  if (!loaded.has(key)) {
    const face = new FontFace(family, `url('${staticFile(file)}') format('truetype')`, { weight });
    loaded.set(key, face.load().then((f) => void document.fonts.add(f)));
  }
  return loaded.get(key)!;
}

export function useStyleFonts(style: VideoStyle): boolean {
  const [handle] = useState(() => delayRender(`Video stili fontlari (${style})`));
  const [ready, setReady] = useState(false);
  useEffect(() => {
    Promise.all([...BASE, ...STYLE_FONTS[style]].map((f) => load(f.family, f.file, f.weight)))
      .then(() => setReady(true))
      .catch((err) => cancelRender(err));
  }, [style]);
  useEffect(() => {
    if (ready) continueRender(handle);
  }, [ready, handle]);
  return ready;
}
