'use client';

import { useState } from 'react';
import { Player } from '@remotion/player';
import { useTheme } from 'next-themes';
import {
  AiScan,
  AI_SCAN_DURATION,
  AI_SCAN_FPS,
  AI_SCAN_HEIGHT,
  AI_SCAN_WIDTH,
  type AiScanEngine,
} from '@luviai/video/ai-scan';
import type { Locale } from '@/lib/i18n';

/**
 * Test sonucunun kisisel 10 sn ozeti — apps/video'daki AiScan kompozisyonu,
 * @remotion/player ile tarayicida canli cizilir (render edilmis dosya yok).
 *
 * YALNIZ checker-overlay icinden next/dynamic ile yuklenir: kullanici alan adi
 * testini gondermeden bu parca (ve remotion) indirilmez. Hareketi azalt tercihinde
 * oynatilmaz, son kare (sonuc) statik gosterilir.
 */
export default function AiScanPlayer({
  domain,
  score,
  engines,
  locale,
}: {
  domain: string;
  score: number;
  engines: AiScanEngine[];
  locale: Locale;
}) {
  const { resolvedTheme } = useTheme();
  // ssr:false ile yuklendigi icin matchMedia ilk render'da okunabilir; Player'in
  // initialFrame'i mount'ta sabitlendiginden tercih efektle sonradan gelmemeli.
  const [reduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  return (
    <Player
      component={AiScan}
      inputProps={{ domain, score, engines, locale, theme: resolvedTheme === 'dark' ? 'dark' : 'light' }}
      durationInFrames={AI_SCAN_DURATION}
      fps={AI_SCAN_FPS}
      compositionWidth={AI_SCAN_WIDTH}
      compositionHeight={AI_SCAN_HEIGHT}
      style={{ width: '100%', aspectRatio: `${AI_SCAN_WIDTH} / ${AI_SCAN_HEIGHT}` }}
      autoPlay={!reduced}
      initialFrame={reduced ? AI_SCAN_DURATION - 1 : 0}
      controls={false}
      loop={false}
      moveToBeginningWhenEnded={false}
      clickToPlay={false}
      initiallyMuted
      acknowledgeRemotionLicense
    />
  );
}
