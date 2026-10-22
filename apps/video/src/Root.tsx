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
import { tempoMetadata } from './tempo/TempoTimeline';
import { PILLAR_COMPOSITIONS } from './pillars/PillarVideo';
import { HYBRID_COMPOSITIONS } from './hybrid/HybridVideo';

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
      {/*
        Makaleden otomatik kisa video — props: scripts/article-short.mjs'in urettigi props.json.
        RanksUp Video sablonlarinin suresi props'a bagli (tempo + metin uzunlugu, src/tempo/plan.mjs):
        calculateMetadata kurar; durationInFrames yalniz 'fast' varsayilani.
      */}
      <Composition
        id="ArticleShort"
        component={ArticleShort}
        calculateMetadata={tempoMetadata('ArticleShort')}
        durationInFrames={ARTICLE_SHORT_DURATION}
        fps={MARKETING_FPS}
        width={1080}
        height={1920}
        defaultProps={articleShortDefaults}
      />
      {/* RanksUp Video tanitim sablonlari — props: api videos/video-render.service.ts (site / urun) */}
      <Composition id="SiteIntro" component={SiteIntro} calculateMetadata={tempoMetadata('SiteIntro')} durationInFrames={SITE_INTRO_DURATION} fps={MARKETING_FPS} width={1080} height={1920} defaultProps={siteIntroDefaults} />
      <Composition id="SiteIntroWide" component={SiteIntroWide} calculateMetadata={tempoMetadata('SiteIntroWide')} durationInFrames={SITE_INTRO_WIDE_DURATION} fps={MARKETING_FPS} width={1920} height={1080} defaultProps={siteIntroDefaults} />
      <Composition id="ProductShort" component={ProductShort} calculateMetadata={tempoMetadata('ProductShort')} durationInFrames={PRODUCT_SHORT_DURATION} fps={MARKETING_FPS} width={1080} height={1920} defaultProps={productShortDefaults} />
      <Composition id="ProductWide" component={ProductWide} calculateMetadata={tempoMetadata('ProductWide')} durationInFrames={PRODUCT_SHORT_DURATION} fps={MARKETING_FPS} width={1920} height={1080} defaultProps={productShortDefaults} />
      {/* RanksUp tanitim videolari — 5 sutun + Canli Tarayici × dikey/yatay (src/pillars; metin script.json, ses audio/pillars/<id>.wav) */}
      {PILLAR_COMPOSITIONS.map((c) => (
        <Composition key={c.id} id={c.id} component={c.component} durationInFrames={c.durationInFrames} fps={MARKETING_FPS} width={c.width} height={c.height} defaultProps={{ muted: false }} />
      ))}
      {/* Hibrit tanitim: stok goruntu kancasi (public/stock, git disi) + panel sahneleri + kapanis (src/hybrid; ses audio/pillars/hibrit.wav) */}
      {HYBRID_COMPOSITIONS.map((c) => (
        <Composition key={c.id} id={c.id} component={c.component} durationInFrames={c.durationInFrames} fps={MARKETING_FPS} width={c.width} height={c.height} defaultProps={{ muted: false }} />
      ))}
    </>
  );
};
