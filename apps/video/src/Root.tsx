import React from 'react';
import { Composition } from 'remotion';
import { HeroLoop, HERO_LOOP_DURATION, HERO_LOOP_FPS, type HeroLoopProps } from './hero-loop/HeroLoop';
import { Explainer, EXPLAINER_DURATION, EXPLAINER_FPS } from './explainer/Explainer';
import { AiScan, AI_SCAN_DURATION, AI_SCAN_FPS, AI_SCAN_HEIGHT, AI_SCAN_WIDTH, type AiScanProps } from './ai-scan/AiScan';
import { ProductIntro, PRODUCT_INTRO_DURATION, type MarketingProps } from './marketing/ProductIntro';
import { SocialAd, SOCIAL_AD_DURATION } from './marketing/SocialAd';
import { FeatureExplainer, FEATURE_EXPLAINER_DURATION } from './marketing/FeatureExplainer';
import { FPS as MARKETING_FPS } from './marketing/timeline';
import { ArticleShort, ARTICLE_SHORT_DURATION, articleShortDefaults } from './article-short/ArticleShort';

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
      {/* Pazarlama videolari — muzik + efekt izi timeline.json'dan; muted=true sessiz varyant */}
      <Composition
        id="ProductIntro"
        component={ProductIntro}
        durationInFrames={PRODUCT_INTRO_DURATION}
        fps={MARKETING_FPS}
        width={1920}
        height={1080}
        defaultProps={{ muted: false } satisfies MarketingProps}
      />
      <Composition
        id="SocialAd"
        component={SocialAd}
        durationInFrames={SOCIAL_AD_DURATION}
        fps={MARKETING_FPS}
        width={1080}
        height={1920}
        defaultProps={{ muted: false } satisfies MarketingProps}
      />
      <Composition
        id="FeatureExplainer"
        component={FeatureExplainer}
        durationInFrames={FEATURE_EXPLAINER_DURATION}
        fps={MARKETING_FPS}
        width={1920}
        height={1080}
        defaultProps={{ muted: false } satisfies MarketingProps}
      />
      {/* Makaleden otomatik kisa video — props: scripts/article-short.mjs'in urettigi props.json */}
      <Composition
        id="ArticleShort"
        component={ArticleShort}
        durationInFrames={ARTICLE_SHORT_DURATION}
        fps={MARKETING_FPS}
        width={1080}
        height={1920}
        defaultProps={articleShortDefaults}
      />
    </>
  );
};
