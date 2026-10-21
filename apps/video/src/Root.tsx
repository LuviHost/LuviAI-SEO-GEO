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
import { SiteIntro, SiteIntroWide, SITE_INTRO_DURATION, SITE_INTRO_WIDE_DURATION, siteIntroDefaults } from './promo/SiteIntro';
import { ProductShort, ProductWide, PRODUCT_SHORT_DURATION, productShortDefaults } from './promo/ProductShort';
import { VideoLaunch, VIDEO_LAUNCH_DURATION } from './launch/VideoLaunch';
import { VideoLaunchVertical, VIDEO_LAUNCH_VERTICAL_DURATION } from './launch/VideoLaunchVertical';
import { KobiPratikReels, KOBIPRATIK_REELS_DURATION } from './kobipratik/KobiPratikReels';
import { KobiPratikIntro, KOBIPRATIK_INTRO_DURATION } from './kobipratik/KobiPratikIntro';

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
      {/* RanksUp Video tanitim sablonlari — props: api videos/video-render.service.ts (site / urun) */}
      <Composition id="SiteIntro" component={SiteIntro} durationInFrames={SITE_INTRO_DURATION} fps={MARKETING_FPS} width={1080} height={1920} defaultProps={siteIntroDefaults} />
      <Composition id="SiteIntroWide" component={SiteIntroWide} durationInFrames={SITE_INTRO_WIDE_DURATION} fps={MARKETING_FPS} width={1920} height={1080} defaultProps={siteIntroDefaults} />
      <Composition id="ProductShort" component={ProductShort} durationInFrames={PRODUCT_SHORT_DURATION} fps={MARKETING_FPS} width={1080} height={1920} defaultProps={productShortDefaults} />
      <Composition id="ProductWide" component={ProductWide} durationInFrames={PRODUCT_SHORT_DURATION} fps={MARKETING_FPS} width={1920} height={1080} defaultProps={productShortDefaults} />
      {/* RanksUp Video duyurusu — ornek videolar kobipratik.com icin gercek sablon ciktisi (launch/examples.ts) */}
      <Composition id="VideoLaunch" component={VideoLaunch} durationInFrames={VIDEO_LAUNCH_DURATION} fps={MARKETING_FPS} width={1920} height={1080} defaultProps={{ muted: false } satisfies MarketingProps} />
      <Composition id="VideoLaunchVertical" component={VideoLaunchVertical} durationInFrames={VIDEO_LAUNCH_VERTICAL_DURATION} fps={MARKETING_FPS} width={1080} height={1920} defaultProps={{ muted: false } satisfies MarketingProps} />
      {/* KobiPratik'in kendi reklamlari (src/kobipratik/) — KobiPratik markasi, RanksUp markasi yok */}
      <Composition id="KobiPratikReels" component={KobiPratikReels} durationInFrames={KOBIPRATIK_REELS_DURATION} fps={MARKETING_FPS} width={1080} height={1920} defaultProps={{ muted: false } satisfies MarketingProps} />
      <Composition id="KobiPratikIntro" component={KobiPratikIntro} durationInFrames={KOBIPRATIK_INTRO_DURATION} fps={MARKETING_FPS} width={1920} height={1080} defaultProps={{ muted: false } satisfies MarketingProps} />
      {/* ayni zaman cizelgesi + ayni ses; yerlesim en/boy oranina gore (useLayout) */}
      <Composition id="KobiPratikIntroVertical" component={KobiPratikIntro} durationInFrames={KOBIPRATIK_INTRO_DURATION} fps={MARKETING_FPS} width={1080} height={1920} defaultProps={{ muted: false } satisfies MarketingProps} />
    </>
  );
};
