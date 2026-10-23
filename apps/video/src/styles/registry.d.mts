/** registry.mjs tipleri (Remotion TS tarafi icin; mantik registry.mjs'te) */
export type VideoStyle = 'classic' | 'panel' | 'paper' | 'swiss' | 'chat' | 'diagram' | 'footage';
export type StyledComposition = 'ArticleShort' | 'SiteIntro' | 'SiteIntroWide' | 'ProductShort' | 'ProductWide';

export interface StyleFont {
  family: string;
  file: string;
  weight: string;
}
export interface StockClip {
  id: string;
  file: string;
  url: string;
  page: string;
  bytes: number;
  sha256: string;
  use: [number, number];
  formats: Array<'vertical' | 'horizontal'>;
  focus: number;
}
export interface SceneExits {
  hook: number;
  point: number;
  list: number;
}

export declare const VIDEO_STYLES: readonly VideoStyle[];
export declare const DEFAULT_STYLE: VideoStyle;
export declare function parseStyle(v: unknown): VideoStyle;
export declare function normalizeStyle(v: unknown): VideoStyle;
export declare const STYLE_FONTS: Record<VideoStyle, StyleFont[]>;
export declare const STYLE_EXITS: Record<VideoStyle, Record<StyledComposition, SceneExits>>;
export declare const STOCK_CLIPS: StockClip[];
export declare const STOCK_DIR: string;
export declare function styleAssets(style: unknown): { fonts: string[]; stock: Array<{ file: string; bytes: number }> };
