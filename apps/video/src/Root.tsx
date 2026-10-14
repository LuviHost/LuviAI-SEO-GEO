import React from 'react';
import { Composition } from 'remotion';
import { HeroLoop, HERO_LOOP_DURATION, HERO_LOOP_FPS, type HeroLoopProps } from './hero-loop/HeroLoop';
import { Explainer, EXPLAINER_DURATION, EXPLAINER_FPS } from './explainer/Explainer';
import { AiScan, AI_SCAN_DURATION, AI_SCAN_FPS, AI_SCAN_HEIGHT, AI_SCAN_WIDTH, type AiScanProps } from './ai-scan/AiScan';

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="HeroLoopLight"
        component={HeroLoop}
        durationInFrames={HERO_LOOP_DURATION}
        fps={HERO_LOOP_FPS}
        width={1920}
        height={1080}
        defaultProps={{ theme: 'light' } satisfies HeroLoopProps}
      />
      <Composition
        id="HeroLoopDark"
        component={HeroLoop}
        durationInFrames={HERO_LOOP_DURATION}
        fps={HERO_LOOP_FPS}
        width={1920}
        height={1080}
        defaultProps={{ theme: 'dark' } satisfies HeroLoopProps}
      />
      <Composition
        id="Explainer"
        component={Explainer}
        durationInFrames={EXPLAINER_DURATION}
        fps={EXPLAINER_FPS}
        width={1920}
        height={1080}
      />
      <Composition
        id="AiScan"
        component={AiScan}
        durationInFrames={AI_SCAN_DURATION}
        fps={AI_SCAN_FPS}
        width={AI_SCAN_WIDTH}
        height={AI_SCAN_HEIGHT}
        defaultProps={{ domain: 'kobipratik.com', score: 57, theme: 'light' } satisfies AiScanProps}
      />
    </>
  );
};
