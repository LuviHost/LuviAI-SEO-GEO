import React, { useMemo } from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { TempoProvider, TempoSoundtrack, tempoTimeline } from '../tempo/TempoTimeline';
import { brandPalette, type BrandPalette } from '../article-short/palette';
import { normalizeStyle, type StyledComposition, type VideoStyle } from './registry.mjs';
import { useStyleFonts } from './fonts';
import { buildStory, makeWin, type Story, type StoryProps, type Win } from './story';
import { PanelStyle } from './panel';
import { PaperStyle } from './paper';
import { SwissStyle } from './swiss';
import { ChatStyle } from './chat';
import { DiagramStyle } from './diagram';
import { FootageStyle } from './footage';

/**
 * Stilli RanksUp Video — classic disindaki stiller. Bes kompozisyon (ArticleShort, SiteIntro, SiteIntroWide,
 * ProductShort, ProductWide) props.style classic degilse buraya devreder; classic yol hic degismez.
 *
 * Ortak olan: tempo cizelgesi + muzik (TempoSoundtrack, src/tempo), marka paleti (palette.ts — musterinin
 * rengi, kontrasta gore yazi rengi), metin modeli (story.ts — classic ile ayni metinler) ve zaman pencereleri
 * (story.ts makeWin). Stil kiti yalniz gorseli cizer.
 */

export type KitProps = { story: Story; pal: BrandPalette; win: Win; frame: number };

const KITS: Record<Exclude<VideoStyle, 'classic'>, React.FC<KitProps>> = {
  panel: PanelStyle,
  paper: PaperStyle,
  swiss: SwissStyle,
  chat: ChatStyle,
  diagram: DiagramStyle,
  footage: FootageStyle,
};

/** classic disinda bir stil mi (bilinmeyen deger classic sayilir — render hatti zaten reddeder) */
export const isStyled = (style: unknown) => normalizeStyle(style) !== 'classic';

export const StyledVideo: React.FC<{ compositionId: StyledComposition; props: StoryProps }> = ({ compositionId, props }) => {
  const style = normalizeStyle(props.style) as Exclude<VideoStyle, 'classic'>;
  const ready = useStyleFonts(style);
  const frame = useCurrentFrame();
  const TL = useMemo(() => tempoTimeline(compositionId, props), [compositionId, props]);
  const story = useMemo(() => buildStory(compositionId, props), [compositionId, props]);
  const win = useMemo(() => makeWin(TL, story, style), [TL, story, style]);
  const pal = useMemo(() => brandPalette(props.brand?.primary), [props.brand?.primary]);
  const Kit = KITS[style];
  return (
    <TempoProvider value={TL}>
      <AbsoluteFill style={{ overflow: 'hidden', background: pal.bg }}>
        <TempoSoundtrack tl={TL} muted={props.muted ?? false} />
        {ready ? <Kit story={story} pal={pal} win={win} frame={frame} /> : null}
      </AbsoluteFill>
    </TempoProvider>
  );
};
