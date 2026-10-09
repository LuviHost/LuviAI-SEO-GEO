import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import { describeHeroImage } from './hero-alt.js';

const bytes = await sharp({ create: { width: 64, height: 32, channels: 3, background: '#336699' } }).webp().toBuffer();
const base = { bytes, title: 'Bisiklet zinciri nasıl yağlanır?', language: 'tr', siteId: 's1', articleId: 'a1' };
const llmWith = (output: string, stopReason = 'end_turn') => ({ chat: vi.fn(async () => ({ output, stopReason })) });

describe('describeHeroImage', () => {
  it('yerel baytlardan JPEG ile gorerek alt uretir; baslik baglam olarak gider', async () => {
    const llm = llmWith('{"decorative":false,"alt":"Zincirine yağ damlatılan bisiklet","confidence":0.8}');
    const r = await describeHeroImage(llm as any, base);
    expect(r).toEqual({ alt: 'Zincirine yağ damlatılan bisiklet', model: 'claude-opus-5-5' });
    const req: any = (llm.chat.mock.calls[0] as any)[0];
    expect(req.context).toBe('hero-alt');
    expect(req.messages[0].images[0].mediaType).toBe('image/jpeg');
    expect(req.messages[0].content).toMatch(/Bisiklet zinciri/);
  });

  it('suslemeye ait → bos alt', async () => {
    expect(await describeHeroImage(llmWith('{"decorative":true,"alt":""}') as any, base)).toEqual({ alt: '', model: 'claude-opus-5-5' });
  });

  it('red, gecersiz cikti ya da hata → null (yayin durmaz, alt="" kalir)', async () => {
    expect(await describeHeroImage(llmWith('', 'refusal') as any, base)).toBeNull();
    expect(await describeHeroImage(llmWith('olmaz') as any, base)).toBeNull();
    const boom = { chat: vi.fn(async () => { throw new Error('AI kapali'); }) };
    expect(await describeHeroImage(boom as any, base)).toBeNull();
  });
});
