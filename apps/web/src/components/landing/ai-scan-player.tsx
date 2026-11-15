'use client';

import { useState } from 'react';
import { Player } from '@remotion/player';
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
 * Test sonucunun kisisel ~7 sn ozeti — apps/video'daki AiScan kompozisyonu,
 * @remotion/player ile tarayicida canli cizilir (render edilmis dosya yok).
 *
 * YALNIZ checker-overlay icinden next/dynamic ile yuklenir: kullanici alan adi
 * testini gondermeden bu parca (ve remotion) indirilmez. Hareketi azalt tercihinde
 * oynatilmaz, son kare (sonuc) statik gosterilir.
 *
 * TEMA: sonuc katmani yalniz herkese acik sayfalarda (koyu vitrin) acilir ve
 * vitrin her zaman koyudur (globals.css `.vitrin`); panelin acik/koyu tercihi
 * burada GECERSIZ. Eskiden next-themes okunuyordu: acik tema secmis biri siyah
 * diyalogun icinde beyaz bir kutu gorurdu.
 */
export default function AiScanPlayer({
  domain,
  score,
  engines,
  locale,
  theme = 'dark',
}: {
  domain: string;
  score: number;
  engines: AiScanEngine[];
  locale: Locale;
  theme?: 'light' | 'dark';
}) {
  // ssr:false ile yuklendigi icin matchMedia ilk render'da okunabilir; Player'in
  // initialFrame'i mount'ta sabitlendiginden tercih efektle sonradan gelmemeli.
  const [reduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  return (
    <Player
      component={AiScan}
      inputProps={{ domain, score, engines, locale, theme }}
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
