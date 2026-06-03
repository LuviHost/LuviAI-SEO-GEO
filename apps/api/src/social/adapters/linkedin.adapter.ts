import type {
  SocialAdapter,
  SocialAdapterContext,
  SocialPublishInput,
  SocialPublishResult,
} from './types.js';

/**
 * LinkedIn adapter — UGC Posts API (kisisel + sirket sayfasi).
 *
 * Auth: OAuth 2.0 (3-legged). Scope: w_member_social (post yayinla),
 * r_liteprofile + r_emailaddress (profil), w_organization_social (sirket
 * sayfasi adina paylasim).
 *
 * UGC Posts API:
 *   POST https://api.linkedin.com/v2/ugcPosts
 *   Header: Authorization: Bearer <token>, X-Restli-Protocol-Version: 2.0.0
 *
 * "author" alani:
 *   - Kisisel: urn:li:person:{personId}
 *   - Sirket:  urn:li:organization:{orgId}
 *
 * shareMediaCategory: NONE (text), IMAGE, VIDEO, ARTICLE.
 * Image upload icin once /v2/assets?action=registerUpload, sonra binary upload.
 */

const LINKEDIN_API = 'https://api.linkedin.com/v2';

export class LinkedInAdapter implements SocialAdapter {
  type = 'linkedin';
  variants = ['personal', 'company'];

  /**
   * Tip-bazli scope listesi.
   * LINKEDIN_COMPANY icin organization scope'lar gerek (Marketing Developer
   * Platform onayi sart — onaysiz LinkedIn app'leri sayfaya post atamaz,
   * ama organizationAcls endpoint'i icin r_organization_social yeterli).
   */
  static scopesFor(type: string): string[] {
    const base = ['openid', 'profile', 'email', 'w_member_social'];
    if (type === 'LINKEDIN_COMPANY') {
      return [...base, 'r_organization_social', 'w_organization_social', 'rw_organization_admin'];
    }
    return base;
  }

  oauth = {
    scopes: ['openid', 'profile', 'email', 'w_member_social'],

    buildAuthUrl(state: string, redirectUri: string, type?: string): string {
      const scopes = type ? LinkedInAdapter.scopesFor(type) : this.scopes;
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: process.env.LINKEDIN_CLIENT_ID ?? '',
        redirect_uri: redirectUri,
        state,
        scope: scopes.join(' '),
      });
      return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
    },

    async exchange(code: string, redirectUri: string) {
      const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: redirectUri,
          client_id: process.env.LINKEDIN_CLIENT_ID ?? '',
          client_secret: process.env.LINKEDIN_CLIENT_SECRET ?? '',
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`LinkedIn token exchange failed: ${res.status} ${body}`);
      }
      const data = (await res.json()) as {
        access_token: string;
        expires_in: number;
        refresh_token?: string;
        refresh_token_expires_in?: number;
        scope: string;
      };
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        extra: { scope: data.scope },
      };
    },

    async fetchProfile(accessToken: string) {
      // OpenID Connect userinfo endpoint — modern LinkedIn approach
      const res = await fetch(`${LINKEDIN_API}/userinfo`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`LinkedIn userinfo failed: ${res.status} ${body}`);
      }
      const data = (await res.json()) as {
        sub: string;             // person URN's local id (e.g. "abc123")
        name: string;
        given_name?: string;
        family_name?: string;
        picture?: string;
        email?: string;
      };
      return {
        externalId: `urn:li:person:${data.sub}`,
        externalName: data.name,
        externalAvatar: data.picture,
        extra: { email: data.email },
      };
    },
  };

  async publish(input: SocialPublishInput, ctx: SocialAdapterContext): Promise<SocialPublishResult> {
    const accessToken = ctx.credentials?.accessToken;
    if (!accessToken) throw new Error('LinkedIn accessToken yok');

    const author = ctx.externalId; // urn:li:person:... veya urn:li:organization:...
    if (!author) throw new Error('LinkedIn author URN yok (externalId)');

    const text = this.formatText(input);

    // 1) Medya varsa önce LinkedIn'e upload et — asset URN'lerini al
    const mediaAssets = await this.uploadMediaIfAny(input.mediaUrls ?? [], accessToken, author);

    const body: any = {
      author,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
    };

    if (mediaAssets.length > 0) {
      // Medya öncelikli: image veya video
      const firstType = mediaAssets[0].type;
      body.specificContent['com.linkedin.ugc.ShareContent'].shareMediaCategory =
        firstType === 'video' ? 'VIDEO' : 'IMAGE';
      body.specificContent['com.linkedin.ugc.ShareContent'].media = mediaAssets.map((a) => ({
        status: 'READY',
        media: a.assetUrn,
        ...(a.altText ? { description: { text: a.altText } } : {}),
      }));
    } else if (input.metadata?.link) {
      // Link unfurl (metadata.link varsa) — LinkedIn URL'i otomatik unfurl eder
      body.specificContent['com.linkedin.ugc.ShareContent'].shareMediaCategory = 'ARTICLE';
      body.specificContent['com.linkedin.ugc.ShareContent'].media = [
        { status: 'READY', originalUrl: input.metadata.link },
      ];
    }

    const res = await fetch(`${LINKEDIN_API}/ugcPosts`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`LinkedIn publish failed: ${res.status} ${errBody}`);
    }

    const data = (await res.json()) as { id: string };
    const externalId = data.id;
    // urn:li:share:7185... -> https://www.linkedin.com/feed/update/urn:li:share:7185.../
    const externalUrl = `https://www.linkedin.com/feed/update/${encodeURIComponent(externalId)}/`;

    return { externalId, externalUrl, raw: data };
  }

  /**
   * LinkedIn media upload (3 adım):
   *  1. POST /v2/assets?action=registerUpload → uploadUrl + asset URN
   *  2. PUT binary → uploadUrl (LinkedIn'in CDN'i)
   *  3. asset URN'i ugcPosts body'sinde media olarak referans ver
   *
   * Image için recipe: urn:li:digitalmediaRecipe:feedshare-image
   * Video için recipe: urn:li:digitalmediaRecipe:feedshare-video (chunked, daha karmaşık)
   *
   * Şimdilik max 1 image/video destekliyoruz. LinkedIn'in post'larında
   * çok-resim ise carousel — ayrı bir akış gerek.
   */
  private async uploadMediaIfAny(
    mediaUrls: Array<{ url: string; type: 'image' | 'video'; altText?: string }>,
    accessToken: string,
    ownerUrn: string,
  ): Promise<Array<{ assetUrn: string; type: 'image' | 'video'; altText?: string }>> {
    if (!Array.isArray(mediaUrls) || mediaUrls.length === 0) return [];

    const webBase = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
    const result: Array<{ assetUrn: string; type: 'image' | 'video'; altText?: string }> = [];

    // Şimdilik tek medya (video varsa onu, yoksa ilk image)
    const videos = mediaUrls.filter((m) => m.type === 'video').slice(0, 1);
    const images = videos.length > 0 ? [] : mediaUrls.filter((m) => m.type === 'image').slice(0, 1);
    const items = videos.length > 0 ? videos : images;
    if (items.length === 0) return [];

    for (const item of items) {
      const absoluteUrl = item.url.startsWith('http') ? item.url : `${webBase}${item.url}`;
      const recipe = item.type === 'video'
        ? 'urn:li:digitalmediaRecipe:feedshare-video'
        : 'urn:li:digitalmediaRecipe:feedshare-image';

      // 1) Register upload
      const regRes = await fetch(`${LINKEDIN_API}/assets?action=registerUpload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify({
          registerUploadRequest: {
            recipes: [recipe],
            owner: ownerUrn,
            serviceRelationships: [
              { relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' },
            ],
          },
        }),
      });
      if (!regRes.ok) {
        const errBody = await regRes.text();
        throw new Error(`LinkedIn registerUpload failed: ${regRes.status} ${errBody.slice(0, 300)}`);
      }
      const regData = (await regRes.json()) as {
        value: {
          uploadMechanism: {
            'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest': {
              uploadUrl: string;
              headers?: Record<string, string>;
            };
          };
          asset: string;
        };
      };
      const uploadUrl = regData.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl;
      const uploadHeaders = regData.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].headers ?? {};
      const assetUrn = regData.value.asset;

      // 2) Binary'yi indir + PUT et
      const fileRes = await fetch(absoluteUrl);
      if (!fileRes.ok) {
        throw new Error(`LinkedIn media indirilemedi: ${absoluteUrl} → HTTP ${fileRes.status}`);
      }
      const buf = Buffer.from(await fileRes.arrayBuffer());

      const upRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          ...uploadHeaders,
        },
        body: buf,
      });
      if (!upRes.ok) {
        const errBody = await upRes.text().catch(() => '');
        throw new Error(`LinkedIn binary upload failed: ${upRes.status} ${errBody.slice(0, 300)}`);
      }

      result.push({ assetUrn, type: item.type, altText: item.altText });
    }

    return result;
  }

  /**
   * Kullanicinin admin oldugu LinkedIn sirket sayfalari.
   * organizationAcls endpoint'i — `r_organization_social` veya `rw_organization_admin`
   * scope gerekir. Marketing Developer Platform onayli olmayan app'lerde
   * 403 doner — kullaniciya net mesaj gosteririz.
   */
  static async listAdminOrgs(accessToken: string): Promise<Array<{
    organizationUrn: string;
    organizationId: string;
    name: string;
    vanityName?: string;
    logoUrl?: string;
  }>> {
    // Onceden yonetici olunan organizasyonlari listele
    const url = `${LINKEDIN_API}/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&projection=(elements*(*,organization~(localizedName,vanityName,logoV2(original~:playableStreams))))`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
    });
    if (!res.ok) {
      const body = await res.text();
      if (res.status === 403 || /not enough permissions|insufficient permissions|access_denied/i.test(body)) {
        throw new Error('LINKEDIN_NO_MDP_ACCESS');
      }
      throw new Error(`LinkedIn organizationAcls failed: ${res.status} ${body}`);
    }
    const data = (await res.json()) as { elements?: any[] };
    const out: Array<any> = [];
    for (const el of data.elements ?? []) {
      const orgUrn = el.organization;
      if (!orgUrn) continue;
      const orgIdMatch = orgUrn.match(/urn:li:organization:(\d+)/);
      const orgId = orgIdMatch ? orgIdMatch[1] : null;
      if (!orgId) continue;
      const expanded = el['organization~'];
      out.push({
        organizationUrn: orgUrn,
        organizationId: orgId,
        name: expanded?.localizedName ?? `Organization ${orgId}`,
        vanityName: expanded?.vanityName,
        // logoUrl extraction left simple
        logoUrl: undefined,
      });
    }
    return out;
  }

  /**
   * Text + hashtag + mention birlestirir. LinkedIn 3000 karakter sinirina kadar
   * destekler ama "ideal" gosterim 1300 karakter altindadir.
   */
  private formatText(input: SocialPublishInput): string {
    let out = input.text.trim();
    const tags = input.metadata?.hashtags ?? [];
    if (tags.length) {
      out += '\n\n' + tags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(' ');
    }
    if (out.length > 3000) out = out.slice(0, 2997) + '...';
    return out;
  }
}
