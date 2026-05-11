import type { SocialChannelType } from '@prisma/client';

/**
 * Sosyal medya kanalları için medya formatı politikası.
 *
 *   default: kanal tipi için varsayılan medya formatı
 *   options: kullanıcının UI'dan seçebileceği alternatifler (default dahil)
 *   editable: false ise kullanıcı değiştiremez (TikTok/YouTube zorunlu video)
 *
 * Mantık:
 *   - TIKTOK, YOUTUBE: video zorunlu (platform doğası)
 *   - INSTAGRAM_BUSINESS, FACEBOOK_PAGE, PINTEREST: image default, video opsiyonel
 *   - X_TWITTER, LINKEDIN_*: text default, image/video opsiyonel
 *   - THREADS, BLUESKY, MASTODON: text default, image opsiyonel
 *   - GMB: image default
 */
export type MediaType = 'text' | 'image' | 'video';

export interface MediaPolicy {
  default: MediaType;
  options: readonly MediaType[];
  editable: boolean;
}

export const MEDIA_POLICY: Record<SocialChannelType, MediaPolicy> = {
  TIKTOK:             { default: 'video', options: ['video'],                  editable: false },
  YOUTUBE:            { default: 'video', options: ['video'],                  editable: false },
  INSTAGRAM_BUSINESS: { default: 'image', options: ['image', 'video'],         editable: true  },
  FACEBOOK_PAGE:      { default: 'image', options: ['text', 'image', 'video'], editable: true  },
  X_TWITTER:          { default: 'text',  options: ['text', 'image', 'video'], editable: true  },
  LINKEDIN_PERSONAL:  { default: 'text',  options: ['text', 'image', 'video'], editable: true  },
  LINKEDIN_COMPANY:   { default: 'text',  options: ['text', 'image', 'video'], editable: true  },
  THREADS:            { default: 'text',  options: ['text', 'image'],          editable: true  },
  BLUESKY:            { default: 'text',  options: ['text', 'image'],          editable: true  },
  PINTEREST:          { default: 'image', options: ['image'],                  editable: false },
  GMB:                { default: 'image', options: ['text', 'image'],          editable: true  },
  MASTODON:           { default: 'text',  options: ['text', 'image'],          editable: true  },
};

export function mediaDefaultFor(channelType: SocialChannelType): MediaType {
  return MEDIA_POLICY[channelType]?.default ?? 'text';
}

export function mediaOptionsFor(channelType: SocialChannelType): readonly MediaType[] {
  return MEDIA_POLICY[channelType]?.options ?? ['text'];
}

export function isMediaTypeEditable(channelType: SocialChannelType): boolean {
  return MEDIA_POLICY[channelType]?.editable ?? true;
}

export function isMediaTypeAllowed(channelType: SocialChannelType, mediaType: MediaType): boolean {
  return mediaOptionsFor(channelType).includes(mediaType);
}

/**
 * Video formatını platforma göre seç (FFmpeg generator için).
 *   - TIKTOK, INSTAGRAM, YOUTUBE Shorts → vertical (9:16)
 *   - Diğerleri (FB, X, LinkedIn long-form YouTube) → horizontal (16:9)
 */
export function videoFormatFor(channelType: SocialChannelType): 'horizontal' | 'vertical' {
  const verticalChannels: SocialChannelType[] = ['TIKTOK', 'INSTAGRAM_BUSINESS', 'YOUTUBE'];
  return verticalChannels.includes(channelType) ? 'vertical' : 'horizontal';
}
