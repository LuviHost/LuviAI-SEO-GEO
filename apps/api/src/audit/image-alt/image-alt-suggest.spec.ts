import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';

const fetchMock = vi.fn();
vi.mock('../../common/safe-fetch.js', async (orig) => {
  const real: any = await orig();
  return { ...real, safeFetchBinary: (...a: any[]) => fetchMock(...a) };
});

const { ImageAltSuggestService } = await import('./image-alt-suggest.service.js');
const { SafeFetchError } = await import('../../common/safe-fetch.js');

const png = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#ff0000' } }).png().toBuffer();
const row = (id = 'img1') => ({
  id, siteId: 's1', src: 'https://x.com/a.png', firstPageUrl: 'https://x.com/', linked: false, linkHref: null,
  currentAlt: null, context: { heading: 'Ürünler' }, pageLang: 'tr',
});

function build(opts: { llmOutput?: string; stopReason?: string; usedToday?: number; budgetThrows?: boolean } = {}) {
  const updates: any[] = [];
  const prisma = {
    site: { findUniqueOrThrow: vi.fn(async () => ({ userId: 'u1', language: 'tr' })) },
    siteImage: {
      findMany: vi.fn(async ({ where }: any) => where.id.in.map((id: string) => row(id))),
      count: vi.fn(async () => opts.usedToday ?? 0),
      update: vi.fn(async (a: any) => { updates.push(a); return {}; }),
    },
  };
  const llm = {
    chat: vi.fn(async () => ({ output: opts.llmOutput ?? '{"decorative":false,"alt":"Kırmızı ürün etiketi","confidence":0.8}', stopReason: opts.stopReason ?? 'end_turn' })),
  };
  const quota = { enforceAiCostBudget: vi.fn(async () => { if (opts.budgetThrows) throw new Error('butce doldu'); }) };
  const svc = new ImageAltSuggestService(prisma as any, llm as any, quota as any);
  return { svc, prisma, llm, quota, updates };
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ url: 'https://x.com/a.png', contentType: 'image/png', body: png });
  delete process.env.MODEL_IMAGE_ALT;
});

describe('ImageAltSuggestService', () => {
  it('basarili oneri: JPEG gorsel, varsayilan Opus 5.5, effort low; SUGGESTED', async () => {
    const { svc, llm, updates } = build();
    const r = await svc.suggestMany('s1', ['img1']);
    expect(r.outcomes).toEqual([{ id: 'img1', result: 'suggested' }]);
    const req: any = (llm.chat.mock.calls[0] as any)[0];
    expect(req.model).toBe('claude-opus-5-5');
    expect(req.effort).toBe('low');
    expect(req.context).toBe('image-alt');
    expect(req.messages[0].images[0].mediaType).toBe('image/jpeg');
    expect(Buffer.from(req.messages[0].images[0].base64, 'base64').subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(updates.at(-1).data).toMatchObject({ suggestedAlt: 'Kırmızı ürün etiketi', suggestedBy: 'claude-opus-5-5', status: 'SUGGESTED' });
  });

  it('suslemeye ait → DECORATIVE_SUGGESTED, bos alt', async () => {
    const { svc, updates } = build({ llmOutput: '{"decorative":true,"alt":"","confidence":0.9}' });
    expect((await svc.suggestMany('s1', ['img1'])).outcomes[0].result).toBe('decorative');
    expect(updates.at(-1).data).toMatchObject({ suggestedAlt: '', status: 'DECORATIVE_SUGGESTED' });
  });

  it('model reddi (refusal): oneri yok, not yazilir, deneme tavana sayilir', async () => {
    const { svc, updates } = build({ llmOutput: '', stopReason: 'refusal' });
    expect((await svc.suggestMany('s1', ['img1'])).outcomes[0]).toMatchObject({ result: 'failed', note: 'refusal' });
    expect(updates.at(-1).data.suggestionNote).toMatch(/elle yaz/);
    expect(updates.at(-1).data.suggestedAt).toBeInstanceOf(Date);
  });

  it('indirilemeyen gorsel: model CAGRILMAZ, tavana sayilmaz', async () => {
    fetchMock.mockRejectedValueOnce(new SafeFetchError('blocked_address', 'Ozel adres'));
    const { svc, llm, updates } = build();
    expect((await svc.suggestMany('s1', ['img1'])).outcomes[0].result).toBe('failed');
    expect(llm.chat).not.toHaveBeenCalled();
    expect(updates.at(-1).data.suggestedAt).toBeUndefined();
    expect(updates.at(-1).data.suggestionNote).toMatch(/blocked_address/);
  });

  it('SVG atlanir, model cagrilmaz', async () => {
    fetchMock.mockResolvedValueOnce({ url: 'x', contentType: 'image/svg+xml', body: Buffer.from('<svg/>') });
    const { svc, llm } = build();
    expect((await svc.suggestMany('s1', ['img1'])).outcomes[0].result).toBe('skipped');
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('gunluk tavan dolu → atlanir', async () => {
    const { svc, llm } = build({ usedToday: 10_000 });
    const r = await svc.suggestMany('s1', ['img1', 'img2']);
    expect(r.capped).toBe(true);
    expect(r.outcomes.every((o) => o.result === 'skipped')).toBe(true);
    expect(llm.chat).not.toHaveBeenCalled();
  });

  it('AI butcesi dolu → hic baslamaz', async () => {
    const { svc, llm } = build({ budgetThrows: true });
    await expect(svc.suggestMany('s1', ['img1'])).rejects.toThrow(/butce/);
    expect(llm.chat).not.toHaveBeenCalled();
  });
});
