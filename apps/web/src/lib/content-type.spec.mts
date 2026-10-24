/**
 * Konu onerisi icerik tipi rozeti: etiketler paylasilan sablon modulundeki
 * etiketlerle ayni, rehber ve bilinmeyen deger rozet uretmez.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { describe, expect, it } from 'vitest';
import { CONTENT_TYPE_LABELS } from '../../../../packages/shared/src/prompts/content-templates';
import { CONTENT_TYPE_BADGES, contentTypeBadge } from './content-type';

describe('contentTypeBadge', () => {
  it('etiketler @luviai/shared CONTENT_TYPE_LABELS ile ayni (rehber haric)', () => {
    const nonGuide = Object.fromEntries(Object.entries(CONTENT_TYPE_LABELS).filter(([k]) => k !== 'guide'));
    expect(CONTENT_TYPE_BADGES).toEqual(nonGuide);
  });
  it('rehber, bilinmeyen ve dize disi deger rozet uretmez', () => {
    expect(contentTypeBadge('guide')).toBeNull();
    expect(contentTypeBadge('review')).toBeNull();
    expect(contentTypeBadge(undefined)).toBeNull();
    expect(contentTypeBadge('toString')).toBeNull();
  });
  it('rehber disi tip etiketlenir', () => {
    expect(contentTypeBadge('comparison')).toBe('Karşılaştırma');
    expect(contentTypeBadge('pricing')).toBe('Fiyatlar');
  });
});
