/**
 * Video provider framework — her sağlayıcı aynı interface'i uygular.
 * Provider sadece "video üret" sorumluluğu taşır; queue/retry/persistence VideoService işidir.
 */

export interface VideoBrief {
  /** İçeriğin başlığı (hem prompt hem dosya adı için) */
  title: string;
  /** Tam senaryo metni — TTS provider'ları bunu sese çevirir; AI video provider'ları bunu prompt'a katar */
  scriptText: string;
  /** Saniye cinsinden hedef süre (provider limitlerine göre clamp'lenir) */
  durationSec: number;
  /** 9:16 (Reels/Shorts/TikTok), 16:9 (YouTube), 1:1 (Instagram feed) */
  aspectRatio: '9:16' | '16:9' | '1:1';
  /** TR / EN / ... */
  language: string;
  /** ElevenLabs voice id, OpenAI voice ('alloy'|'echo'|...), HeyGen avatar id */
  voiceId?: string;
  /** Style hint — provider'a özel ama tüm provider'lar opsiyonel olarak kabul eder */
  style?: string;
  /** Görsel URL'leri (slideshow modu için) */
  imageUrls?: string[];
}

export interface VideoGenerationResult {
  /** Sunucudaki/CDN'deki final video URL */
  videoUrl: string;
  /** Thumbnail URL (varsa) */
  thumbnailUrl?: string;
  /** Saniye */
  durationSec: number;
  /** Bytes */
  fileSize?: number;
  /** Provider'a özel job/operation ID (poll için) */
  providerJobId?: string;
  /** Tahmini USD maliyet */
  costUsd?: number;
  /** Ham response */
  raw?: any;
}

export interface VideoProviderInfo {
  /** Enum value (DB'de saklanan) */
  key: 'SLIDESHOW' | 'VEO' | 'RUNWAY' | 'HEYGEN' | 'SORA';
  label: string;
  description: string;
  /** UI'da gösterilecek tipik üretim süresi etiketi */
  estTime: string;
  /** Tipik USD maliyet bandı ("Ücretsiz" / "$0.10–0.30 / video" gibi) */
  costBand: string;
  /** Quality 1-5 */
  quality: number;
  /** Provider'ın gerek duyduğu env key'leri */
  requiredEnvKeys: string[];
  /** Şu an kullanılabilir mi (env keys mevcut ve adapter çalışıyor mu) */
  ready: boolean;
  /** Notlar (UI tooltip) */
  note?: string;
  /** Hangi durumlar için ideal */
  bestFor?: string[];
}

export interface VideoProvider {
  key: VideoProviderInfo['key'];
  info(): VideoProviderInfo;
  generate(brief: VideoBrief): Promise<VideoGenerationResult>;
}
