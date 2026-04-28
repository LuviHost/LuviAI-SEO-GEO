/**
 * Social adapter framework — her platform icin ayni interface.
 * Adapter sadece "post yayinla" ve "OAuth iste" sorumlulugunu tasir;
 * scheduling, retry ve DB SocialPostsService isidir.
 */

export interface SocialAdapterContext {
  /** SocialChannel.credentials JSON parse + decrypt edilmis hali */
  credentials: Record<string, any>;
  /** SocialChannel.config (pageId, ugcUrn, accountId vb) */
  config: Record<string, any> | null;
  /** SocialChannel.externalId (varsa) — adapter buna gore endpoint sasirir */
  externalId: string | null;
}

export interface SocialPublishInput {
  text: string;
  mediaUrls?: Array<{ url: string; type: 'image' | 'video'; altText?: string }>;
  metadata?: {
    hashtags?: string[];
    mentions?: string[];
    link?: string;
    threadParts?: string[];   // X icin thread; her parca <= 280 char
  };
}

export interface SocialPublishResult {
  externalId: string;          // platforma ozel ID (urn, tweet id, post id)
  externalUrl: string;         // public URL
  raw?: any;                   // ham response (debug)
}

export interface OAuthConfig {
  authUrl: string;
  scopes: string[];
}

export interface OAuthExchange {
  /** kod -> access_token */
  exchange(code: string, redirectUri: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt?: Date;
    extra?: Record<string, any>;
  }>;
  /** access_token -> kullanici/sayfa profil bilgisi */
  fetchProfile(accessToken: string): Promise<{
    externalId: string;
    externalName: string;
    externalAvatar?: string;
    extra?: Record<string, any>;
  }>;
}

export interface SocialAdapter {
  type: string;
  /** Account turunde "personal" / "company" / "page" gibi alt secim varsa */
  variants?: string[];
  publish(input: SocialPublishInput, ctx: SocialAdapterContext): Promise<SocialPublishResult>;
  /** Token expire olduysa refresh — donus credentials JSON yenisi */
  refreshTokens?(ctx: SocialAdapterContext): Promise<Record<string, any> | null>;
  oauth?: OAuthExchange & {
    buildAuthUrl(state: string, redirectUri: string): string;
    scopes: string[];
  };
}
