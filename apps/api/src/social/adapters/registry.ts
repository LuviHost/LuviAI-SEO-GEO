import type { SocialAdapter } from './types.js';
import { LinkedInAdapter } from './linkedin.adapter.js';
import { TwitterAdapter } from './twitter.adapter.js';

/**
 * Adapter registry — tum kayitli sosyal kanal adaptorleri burada toplanir.
 * Sprint 2'de X / Facebook / Instagram eklenecek.
 *
 * Anahtar: SocialChannelType enum value (ornek: 'LINKEDIN_PERSONAL').
 */
const linkedinAdapter = new LinkedInAdapter();
const twitterAdapter = new TwitterAdapter();

const REGISTRY: Record<string, SocialAdapter> = {
  LINKEDIN_PERSONAL: linkedinAdapter,
  LINKEDIN_COMPANY: linkedinAdapter, // ayni adapter, author URN farki
  X_TWITTER: twitterAdapter,
};

export function getAdapter(channelType: string): SocialAdapter {
  const adapter = REGISTRY[channelType];
  if (!adapter) {
    throw new Error(`Henuz desteklenmeyen sosyal kanal tipi: ${channelType}`);
  }
  return adapter;
}

export function listSupportedTypes(): Array<{ type: string; label: string; status: 'live' | 'soon'; note?: string }> {
  return [
    { type: 'LINKEDIN_PERSONAL', label: 'LinkedIn (Kişisel)', status: 'live' },
    {
      type: 'LINKEDIN_COMPANY',
      label: 'LinkedIn (Şirket Sayfası)',
      status: 'soon',
      note: 'LinkedIn Community Management API onayı bekleniyor (Developer Apps → Products → Community Management API → Request access).',
    },
    { type: 'X_TWITTER', label: 'X / Twitter', status: 'live' },
    { type: 'FACEBOOK_PAGE', label: 'Facebook Sayfa', status: 'soon' },
    { type: 'INSTAGRAM_BUSINESS', label: 'Instagram Business', status: 'soon' },
    { type: 'TIKTOK', label: 'TikTok', status: 'soon' },
    { type: 'YOUTUBE', label: 'YouTube', status: 'soon' },
    { type: 'THREADS', label: 'Threads', status: 'soon' },
    { type: 'BLUESKY', label: 'Bluesky', status: 'soon' },
    { type: 'PINTEREST', label: 'Pinterest', status: 'soon' },
  ];
}
