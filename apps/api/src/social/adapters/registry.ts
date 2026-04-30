import type { SocialAdapter } from './types.js';
import { LinkedInAdapter } from './linkedin.adapter.js';
import { TwitterAdapter } from './twitter.adapter.js';
import { BlueskyAdapter } from './bluesky.adapter.js';
import { PinterestAdapter } from './pinterest.adapter.js';
import { TikTokAdapter } from './tiktok.adapter.js';
import { YouTubeAdapter } from './youtube.adapter.js';
import { FacebookAdapter } from './facebook.adapter.js';
import { InstagramAdapter } from './instagram.adapter.js';
import { ThreadsAdapter } from './threads.adapter.js';

/**
 * Adapter registry — tüm kayıtlı sosyal kanal adaptörleri burada toplanır.
 * Anahtar: SocialChannelType enum value (LINKEDIN_PERSONAL, TIKTOK, vb.)
 */
const linkedinAdapter = new LinkedInAdapter();
const twitterAdapter = new TwitterAdapter();
const blueskyAdapter = new BlueskyAdapter();
const pinterestAdapter = new PinterestAdapter();
const tiktokAdapter = new TikTokAdapter();
const youtubeAdapter = new YouTubeAdapter();
const facebookAdapter = new FacebookAdapter();
const instagramAdapter = new InstagramAdapter();
const threadsAdapter = new ThreadsAdapter();

const REGISTRY: Record<string, SocialAdapter> = {
  LINKEDIN_PERSONAL: linkedinAdapter,
  LINKEDIN_COMPANY: linkedinAdapter,
  X_TWITTER: twitterAdapter,
  BLUESKY: blueskyAdapter,
  PINTEREST: pinterestAdapter,
  TIKTOK: tiktokAdapter,
  YOUTUBE: youtubeAdapter,
  FACEBOOK_PAGE: facebookAdapter,
  INSTAGRAM_BUSINESS: instagramAdapter,
  THREADS: threadsAdapter,
};

export function getAdapter(channelType: string): SocialAdapter {
  const adapter = REGISTRY[channelType];
  if (!adapter) {
    throw new Error(`Henüz desteklenmeyen sosyal kanal tipi: ${channelType}`);
  }
  return adapter;
}

/**
 * UI catalog. status:
 *   'live'       — env key + onay tamam, hemen kullanılabilir
 *   'config'     — adapter hazır ama .env'de API key eksik
 *   'review'     — adapter hazır, env key var ama platform app review'u şart
 *   'soon'       — kod henüz yazılmadı (artık yok, hepsi 'live'/'config'/'review')
 */
function envKeysReady(keys: string[]): boolean {
  return keys.every((k) => !!process.env[k]);
}

export function listSupportedTypes(): Array<{
  type: string;
  label: string;
  status: 'live' | 'config' | 'review' | 'soon';
  note?: string;
  recommended?: boolean;
  category?: 'text' | 'image' | 'video' | 'mixed';
}> {
  return [
    {
      type: 'LINKEDIN_PERSONAL',
      label: 'LinkedIn (Kişisel)',
      status: envKeysReady(['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET']) ? 'live' : 'config',
      recommended: true,
      category: 'text',
      note: '✓ Ücretsiz · Hemen yayın yapabilirsin · B2B ve hosting/teknik içerik için en yüksek etkileşim',
    },
    {
      type: 'LINKEDIN_COMPANY',
      label: 'LinkedIn (Şirket Sayfası)',
      status: envKeysReady(['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET']) ? 'review' : 'config',
      category: 'text',
      note: 'LinkedIn Marketing Developer Platform onayı bekleniyor (Developer Apps → Products → Community Management API → Request access).',
    },
    {
      type: 'X_TWITTER',
      label: 'X / Twitter',
      status: envKeysReady(['TWITTER_CLIENT_ID', 'TWITTER_CLIENT_SECRET']) ? 'live' : 'config',
      category: 'text',
      note: '⚠ Ücretli — X API artık tweet başına kredi istiyor (Pay Per Use). Önce Developer Portal → Billing → Credits.',
    },
    {
      type: 'BLUESKY',
      label: 'Bluesky',
      status: 'live', // env key gerek YOK — kullanıcı app password girer
      category: 'text',
      note: '✓ Ücretsiz · App review YOK · Kullanıcı bsky.app/settings/app-passwords\'tan üretip handle ile beraber girer.',
      recommended: true,
    },
    {
      type: 'PINTEREST',
      label: 'Pinterest',
      status: envKeysReady(['PINTEREST_CLIENT_ID', 'PINTEREST_CLIENT_SECRET']) ? 'live' : 'config',
      category: 'image',
      note: 'Image pin destekli. Video pin upload akışı uygulanmadı (gelecek faz).',
    },
    {
      type: 'TIKTOK',
      label: 'TikTok',
      status: envKeysReady(['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET']) ? 'review' : 'config',
      category: 'video',
      note: 'Content Posting API — TikTok Developer Portal\'dan app review tamamlanmadan production\'da çalışmaz (sandbox sadece app admin\'lerine açık).',
    },
    {
      type: 'YOUTUBE',
      label: 'YouTube',
      status: envKeysReady(['GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET']) ? 'live' : 'config',
      category: 'video',
      note: 'Data API v3 + Shorts upload. Quota: ~6 video/gün (10K unit limit). Ek quota artırımı için Google Cloud quota request.',
    },
    {
      type: 'FACEBOOK_PAGE',
      label: 'Facebook Sayfa',
      status: envKeysReady(['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET']) ? 'review' : 'config',
      category: 'mixed',
      note: 'Meta App Review + Business Verification gerekli (4-6 hafta). pages_manage_posts izni şart.',
    },
    {
      type: 'INSTAGRAM_BUSINESS',
      label: 'Instagram (Business/Creator)',
      status: envKeysReady(['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET']) ? 'review' : 'config',
      category: 'mixed',
      note: 'Reels + Feed + Story destekli. App review gerekli — instagram_business_content_publish. IG hesabı bir FB Page\'e bağlı olmalı.',
    },
    {
      type: 'THREADS',
      label: 'Threads',
      status: envKeysReady(['THREADS_APP_ID', 'THREADS_APP_SECRET']) ? 'review' : 'config',
      category: 'text',
      note: 'Threads Graph API — Meta Developer Portal\'da app review zorunlu (text/image/video).',
    },
  ];
}
