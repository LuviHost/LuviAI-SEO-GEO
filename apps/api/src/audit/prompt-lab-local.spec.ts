import { describe, it, expect, vi } from 'vitest';
import { PromptLabService, mergePromptTags } from './prompt-lab.service.js';
import { siteNapKey } from './site-nap.js';
import type { CitationResult } from './ai-citation.service.js';

/**
 * Yerel mod — olcum yolu degismeden NAP karsilastirmasi.
 * Vitest dekorator metadata'si uretmedigi icin servis elle kurulur.
 */

type Row = Record<string, any>;

function fakePrisma(opts: { prompts?: Row[]; kv?: Record<string, string> } = {}) {
  const prompts: Row[] = [...(opts.prompts ?? [])];
  const kv = new Map<string, { value: string; expiresAt: Date | null }>(
    Object.entries(opts.kv ?? {}).map(([k, v]) => [k, { value: v, expiresAt: null }]),
  );
  const runs: Row[] = [];
  const matches = (p: Row, where: Row) => Object.entries(where).every(([k, v]) => {
    if (k === 'id' || k === 'siteId' || k === 'source' || k === 'isActive') return p[k] === v;
    if (k === 'trackedAppId') return (p.trackedAppId ?? null) === v;
    return true;
  });
  const prisma = {
    prompts, kv, runs,
    geoPrompt: {
      findFirst: vi.fn(async ({ where }: any) => {
        const p = prompts.find((x) => matches(x, where));
        return p ? { ...p, fanouts: [] } : null;
      }),
      findMany: vi.fn(async ({ where }: any) => prompts.filter((x) => matches(x, where)).map((p) => ({ ...p, _count: { fanouts: 0 } }))),
      update: vi.fn(async ({ where, data }: any) => Object.assign(prompts.find((x) => x.id === where.id)!, data)),
      createMany: vi.fn(async ({ data }: any) => {
        for (const d of data) prompts.push({ id: `p${prompts.length + 1}`, isActive: true, trackedAppId: null, lastRunAt: null, lastCitedCount: 0, lastTotalCount: 0, createdAt: new Date(), ...d });
        return { count: data.length };
      }),
      delete: vi.fn(async ({ where }: any) => { prompts.splice(prompts.findIndex((x) => x.id === where.id), 1); }),
    },
    geoPromptRun: { createMany: vi.fn(async ({ data }: any) => { runs.push(...data); return { count: data.length }; }) },
    site: { findUnique: vi.fn(async () => ({ id: 's1', url: 'https://lavantakuafor.com/' })) },
    kvStore: {
      findUnique: vi.fn(async ({ where }: any) => (kv.has(where.key) ? { value: kv.get(where.key)!.value } : null)),
      findMany: vi.fn(async ({ where }: any) => [...kv.entries()].filter(([k]) => where.key.in.includes(k)).map(([key, v]) => ({ key, value: v.value }))),
      upsert: vi.fn(async ({ where, create, update }: any) => { kv.set(where.key, kv.has(where.key) ? update : create); return null; }),
      deleteMany: vi.fn(async ({ where }: any) => { const had = kv.delete(where.key); return { count: had ? 1 : 0 }; }),
    },
  };
  return prisma;
}

const STORED_NAP = JSON.stringify({
  phones: ['+902165550000'],
  addresses: [{ street: 'Moda Cd. 1', district: 'Kadıköy', city: 'İstanbul', postalCode: null }],
  sources: ['json-ld'], businessTypes: ['HairSalon'],
  status: 'ok', origin: 'homepage', telScanned: true, pages: ['https://lavantakuafor.com/'],
  reason: null, collectedAt: new Date().toISOString(), attemptedAt: new Date().toISOString(), attemptError: null,
});

const LOCAL_PROMPT = {
  id: 'lp1', siteId: 's1', trackedAppId: null, text: 'Kadıköy kuaför', intent: 'commercial', locale: 'tr',
  source: 'local', tags: ['yerel', 'il:İstanbul', 'ilce:Kadıköy', 'hizmet:kuaför'], isActive: true,
  lastRunAt: null, lastCitedCount: 0, lastTotalCount: 0, createdAt: new Date(),
};

function results(): CitationResult[] {
  return [
    {
      provider: 'openai', label: 'OpenAI ChatGPT', available: true, score: 50,
      probes: [{
        query: 'Kadıköy kuaför', cited: false, brandMentioned: true, brandInQuery: false, excerpt: 'Lavanta Kuaför...',
        nap: { nearPhones: ['+902165550000'], allPhones: ['+902165550000'], address: 'Moda Cd. 1, Kadıköy/İstanbul' },
      } as any],
    },
    {
      provider: 'gemini', label: 'Google Gemini', available: true, score: 0,
      probes: [{
        query: 'Kadıköy kuaför', cited: false, brandMentioned: true, brandInQuery: false, excerpt: 'Lavanta...',
        nap: { nearPhones: ['+902169998877'], allPhones: ['+902169998877'], address: 'Barbaros Bulvarı, Beşiktaş' },
      } as any],
    },
    // Eski olcum surumu: nap alani yok → incelenmedi
    { provider: 'perplexity', label: 'Perplexity', available: true, score: 0, probes: [{ query: 'Kadıköy kuaför', cited: false, brandMentioned: false, excerpt: 'x' }] },
    { provider: 'xai', label: 'xAI Grok', available: false, score: null, probes: [], reason: 'API anahtari yok' },
  ];
}

function service(prisma: ReturnType<typeof fakePrisma>, runQueries = vi.fn(async () => results())) {
  const svc = new PromptLabService(prisma as any, { runQueries } as any, {} as any);
  const fetcher = vi.fn(async () => { throw new Error('siteye gidilmemeli'); });
  svc.siteNapFetcher = fetcher as any;
  return { svc, runQueries, fetcher };
}

describe('PromptLabService — yerel soru olcumu', () => {
  it('ayni olcum yolu: tek runQueries cagrisi, ek AI cagrisi yok; NAP saglayici bazinda karsilastirilir', async () => {
    const prisma = fakePrisma({ prompts: [{ ...LOCAL_PROMPT }], kv: { [siteNapKey('s1')]: STORED_NAP } });
    const { svc, runQueries, fetcher } = service(prisma);
    const out = await svc.runPrompt('s1', 'lp1');

    expect(runQueries).toHaveBeenCalledTimes(1);
    expect(runQueries).toHaveBeenCalledWith('s1', ['Kadıköy kuaför'], { providers: undefined, trigger: undefined });
    expect(fetcher).not.toHaveBeenCalled(); // taze site NAP kaydi var

    const local = out.local!;
    expect(local.location).toEqual({ il: 'İstanbul', ilce: 'Kadıköy', hizmet: 'kuaför' });
    expect(local.napChecked).toBe(true);
    expect(local.siteNap).toMatchObject({ status: 'ok', phones: ['+90 216 555 00 00'] });
    const by = Object.fromEntries(local.providers.map((p) => [p.provider, p]));
    expect(by.openai).toMatchObject({ measured: true, mentioned: true, phone: { status: 'eslesiyor', found: ['+90 216 555 00 00'] }, address: { status: 'eslesiyor' } });
    expect(by.gemini).toMatchObject({ phone: { status: 'farkli', found: ['+90 216 999 88 77'] }, address: { status: 'dogrulanamadi' } });
    expect(by.perplexity).toMatchObject({ measured: true, phone: { status: 'olculmedi' }, address: { status: 'olculmedi' } });
    expect(by.xai).toMatchObject({ measured: false });

    // Son sonuc listede gosterilmek uzere saklanir
    expect(prisma.kv.has('prompt-local:lp1')).toBe(true);
    const list = await svc.list('s1');
    expect(list[0].local).toEqual({ il: 'İstanbul', ilce: 'Kadıköy', hizmet: 'kuaför' });
    expect(list[0].lastLocal?.providers).toHaveLength(4);
  });

  it('site NAP bilinmiyorsa telefon/adres "bilinmiyor"; bulunan numara yine gosterilir', async () => {
    const empty = JSON.stringify({ ...JSON.parse(STORED_NAP), phones: [], addresses: [], status: 'empty', reason: 'yok' });
    const prisma = fakePrisma({ prompts: [{ ...LOCAL_PROMPT }], kv: { [siteNapKey('s1')]: empty } });
    const { svc } = service(prisma);
    const out = await svc.runPrompt('s1', 'lp1');
    const gemini = out.local!.providers.find((p) => p.provider === 'gemini')!;
    expect(gemini.phone).toEqual({ status: 'bilinmiyor', found: ['+90 216 999 88 77'] });
    expect(gemini.address.status).toBe('bilinmiyor');
  });

  it('yerel olmayan soruda yerel ozet yok, site okunmaz', async () => {
    const prisma = fakePrisma({ prompts: [{ ...LOCAL_PROMPT, id: 'm1', source: 'manual', tags: null }] });
    const { svc, fetcher } = service(prisma);
    const out = await svc.runPrompt('s1', 'm1');
    expect(out.local).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(prisma.kvStore.upsert).not.toHaveBeenCalled();
  });

  it('hicbir saglayici olcmediyse son yerel sonuc ezilmez', async () => {
    const prisma = fakePrisma({ prompts: [{ ...LOCAL_PROMPT }], kv: { [siteNapKey('s1')]: STORED_NAP, 'prompt-local:lp1': '{"onceki":true}' } });
    const failing = vi.fn(async () => [{ provider: 'openai', label: 'OpenAI ChatGPT', available: true, score: null, probes: [{ query: 'q', cited: false, brandMentioned: false, excerpt: 'HATA: timeout' }] }] as CitationResult[]);
    const { svc } = service(prisma, failing);
    const out = await svc.runPrompt('s1', 'lp1');
    expect(out.local?.providers[0].measured).toBe(false);
    expect(prisma.kv.get('prompt-local:lp1')!.value).toBe('{"onceki":true}');
  });
});

describe('PromptLabService — yerel soru uretimi', () => {
  it('onizleme kayit yapmaz, takipte olanlari isaretler', async () => {
    const prisma = fakePrisma({ prompts: [{ ...LOCAL_PROMPT, text: 'Kadıköy kuaför' }] });
    const { svc } = service(prisma);
    const out = await svc.previewLocal('s1', { il: 'istanbul', ilceler: ['Kadıköy'], hizmetler: ['kuaför'] });
    expect(out.drafts).toHaveLength(3);
    expect(out.drafts.find((d) => d.text === 'Kadıköy kuaför')?.exists).toBe(true);
    expect(prisma.geoPrompt.createMany).not.toHaveBeenCalled();
  });

  it('secilenleri yerel isaretiyle kaydeder; metin istemciden alinmaz, tekrar eklenmez', async () => {
    const prisma = fakePrisma({ prompts: [{ ...LOCAL_PROMPT, text: 'Kadıköy kuaför' }] });
    const { svc } = service(prisma);
    const out = await svc.createLocal('s1', {
      il: 'İstanbul', ilceler: 'Kadıköy', hizmetler: 'kuaför',
      texts: ['Kadıköy kuaför', "İstanbul Kadıköy'de kuaför için nereyi önerirsin?", 'Uydurma metin'],
    });
    expect(out).toEqual({ created: 1, skipped: 1, limitReached: false });
    const created = prisma.prompts.at(-1)!;
    expect(created).toMatchObject({
      text: "İstanbul Kadıköy'de kuaför için nereyi önerirsin?",
      source: 'local', intent: 'commercial', locale: 'tr',
      tags: ['yerel', 'il:İstanbul', 'ilce:Kadıköy', 'hizmet:kuaför'],
    });
    await expect(svc.createLocal('s1', { il: 'Narnia', hizmetler: 'kuaför' })).rejects.toThrow(/İl adı tanınmadı/);
  });

  it('runAll scope=local yalniz yerel sorulari secer', async () => {
    const prisma = fakePrisma({ prompts: [{ ...LOCAL_PROMPT }, { ...LOCAL_PROMPT, id: 'm1', source: 'manual', tags: null, text: 'Genel soru metni' }] });
    const { svc, runQueries } = service(prisma);
    prisma.kv.set(siteNapKey('s1'), { value: STORED_NAP, expiresAt: null });
    const out = await svc.runAll('s1', { scope: 'local' });
    expect(prisma.geoPrompt.findMany.mock.calls.at(-1)![0].where).toMatchObject({ source: 'local' });
    expect(out.ran).toBe(1);
    expect(runQueries).toHaveBeenCalledTimes(1);
  });
});

/**
 * PATCH prompts/:id etiketleri — yerel sorunun konumu (il/ilce/hizmet)
 * etiketlerde durur. Etiketleri tamamen degistirmek konumu siliyor, panel
 * konumu bos gosteriyordu.
 */
describe('PromptLabService.update — yerel konum etiketleri korunur', () => {
  it('yerel soru: kullanici etiketleri eklenir, il/ilce/hizmet ve yerel isareti kalir', async () => {
    const prisma = fakePrisma({ prompts: [{ ...LOCAL_PROMPT }] });
    const { svc } = service(prisma);
    await svc.update('s1', 'lp1', { tags: ['kampanya', 'ekim'] });
    expect(prisma.prompts[0].tags).toEqual(['yerel', 'il:İstanbul', 'ilce:Kadıköy', 'hizmet:kuaför', 'kampanya', 'ekim']);
    const list = await svc.list('s1');
    expect(list[0].local).toEqual({ il: 'İstanbul', ilce: 'Kadıköy', hizmet: 'kuaför' });
  });

  it('bos liste yalniz kullanici etiketlerini temizler; konum kalir', async () => {
    const prisma = fakePrisma({ prompts: [{ ...LOCAL_PROMPT, tags: [...LOCAL_PROMPT.tags, 'eski'] }] });
    const { svc } = service(prisma);
    await svc.update('s1', 'lp1', { tags: [] });
    expect(prisma.prompts[0].tags).toEqual(['yerel', 'il:İstanbul', 'ilce:Kadıköy', 'hizmet:kuaför']);
  });

  it('istemciden gelen ayrilmis etiket (konum degistirme / yerel yapma) yok sayilir', async () => {
    const prisma = fakePrisma({
      prompts: [{ ...LOCAL_PROMPT }, { ...LOCAL_PROMPT, id: 'm1', source: 'manual', tags: ['pos'], text: 'Genel soru metni' }],
    });
    const { svc } = service(prisma);
    await svc.update('s1', 'lp1', { tags: ['il:Ankara', 'HIZMET:berber', 'yeni'] });
    expect(prisma.prompts[0].tags).toEqual(['yerel', 'il:İstanbul', 'ilce:Kadıköy', 'hizmet:kuaför', 'yeni']);
    await svc.update('s1', 'm1', { tags: ['Yerel', 'il:İzmir', 'kredi'] });
    expect(prisma.prompts[1].tags).toEqual(['kredi']);
    const list = await svc.list('s1');
    expect(list.find((p) => p.id === 'm1')!.local).toBeNull();
  });

  it('etiket alani yoksa ya da dizi degilse etiketlere dokunulmaz', async () => {
    const prisma = fakePrisma({ prompts: [{ ...LOCAL_PROMPT }] });
    const { svc } = service(prisma);
    await svc.update('s1', 'lp1', { isActive: false });
    expect(prisma.geoPrompt.update.mock.calls.at(-1)![0].data).toEqual({ isActive: false });
    expect(mergePromptTags(LOCAL_PROMPT, 'yerel' as any)).toBeUndefined();
    expect(prisma.prompts[0].tags).toEqual(LOCAL_PROMPT.tags);
  });

  it('mergePromptTags: yerel olmayan soru eski davranis (tam degistirme), tekrarlar tekillesir', () => {
    expect(mergePromptTags({ source: 'manual', tags: ['a'] }, ['b', 'b', 7 as any])).toEqual(['b']);
    // source 'local' olmasa da yerel etiketli soru yereldir (isLocalPrompt)
    expect(mergePromptTags({ source: 'manual', tags: ['yerel', 'il:Bursa', 'hizmet:oto yıkama'] }, ['x']))
      .toEqual(['yerel', 'il:Bursa', 'hizmet:oto yıkama', 'x']);
  });
});
