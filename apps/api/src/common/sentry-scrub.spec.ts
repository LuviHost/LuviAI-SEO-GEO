import { describe, it, expect } from 'vitest';
import { sentryOlayTemizle } from './sentry-scrub.js';

describe('sentryOlayTemizle', () => {
  it('cerez, govde, kimlik basliklari ve sorgu dizesi gitmez; diger basliklar kalir', () => {
    const olay = sentryOlayTemizle({
      request: {
        url: 'https://api.ranksup.ai/api/gbp/oauth/callback?code=gizli&state=x',
        method: 'GET',
        cookies: { session: 's3cr3t' },
        data: '{"email":"a@b.com"}',
        query_string: 'code=gizli&state=x',
        headers: { Cookie: 'session=s3cr3t', Authorization: 'Bearer x', 'x-api-key': 'k', 'cf-connecting-ip': '1.2.3.4', 'user-agent': 'Mozilla' },
      },
      user: { id: 'u1', email: 'a@b.com', ip_address: '1.2.3.4' },
    });
    expect(olay.request.cookies).toBeUndefined();
    expect(olay.request.data).toBeUndefined();
    expect(olay.request.url).toBe('https://api.ranksup.ai/api/gbp/oauth/callback');
    expect(olay.request.query_string).toBe('[kaldirildi]');
    expect(olay.request.headers).toEqual({ 'user-agent': 'Mozilla' });
    expect(olay.user).toEqual({ id: 'u1' });
  });

  it('istek yoksa olay bozulmaz', () => {
    expect(sentryOlayTemizle({ message: 'x' })).toEqual({ message: 'x' });
  });
});
