import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// NAP ayristiricisi hata verirse olcumun ayakta kaldigini sinamak icin anahtar
const napBozuk = vi.hoisted(() => ({ on: false }));
vi.mock('./local-nap.js', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./local-nap.js')>();
  return {
    ...orig,
    answerNapSignal: (...args: Parameters<typeof orig.answerNapSignal>) => {
      if (napBozuk.on) throw new Error('ayristirici hatasi');
      return orig.answerNapSignal(...args);
    },
  };
});

import { AiCitationService } from './ai-citation.service.js';

/**
 * buildProbe'un cevabin TAMAMINDAN urettigi iki sey:
 *  - nap: yerel olcumun cevap tarafi (local-nap.ts) — probe'a yazilir,
 *    prompt-lab "incelendi mi" sorusunu alanin VARLIGINA bakarak cevaplar
 *  - answerTextOf: tam metin yalniz bellekte; probe'un alani degil, JSON'a /
 *    kopyaya / kayda gecmez (Product Radar icin)
 * Yol runPublicProbes; yalniz Perplexity anahtari verilir, fetch taklit edilir.
 */

const PROVIDER_KEYS = [
  'ANTHROPIC_API_KEY', 'GOOGLE_AI_API_KEY', 'OPENAI_API_KEY', 'PERPLEXITY_API_KEY',
  'XAI_API_KEY', 'DEEPSEEK_API_KEY', 'GROQ_API_KEY',
];
let backup: Record<string, string | undefined> = {};

beforeEach(() => {
  backup = Object.fromEntries(PROVIDER_KEYS.map((k) => [k, process.env[k]]));
  for (const k of PROVIDER_KEYS) delete process.env[k];
  process.env.PERPLEXITY_API_KEY = 'pplx-testkey-1234567890';
  napBozuk.on = false;
});
afterEach(() => {
  for (const [k, v] of Object.entries(backup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.restoreAllMocks();
});

function service() {
  const prisma = { $executeRawUnsafe: vi.fn(async () => 1) };
  return new AiCitationService(prisma as any, {} as any, {} as any, {} as any);
}

function respond(status: number, body: unknown) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

const answer = (content: string) => ({ choices: [{ message: { content }, finish_reason: 'stop' }], citations: [] });

async function probeFor(svc: AiCitationService, brand: string, host: string, query = 'Kadıköy kuaför önerir misin?') {
  const out = await svc.runPublicProbes({ brand, host, queries: [query] });
  const pr = out.find((r) => r.provider === 'perplexity')!;
  return { out, probe: pr.probes[0] };
}

describe('buildProbe — yerel olcum NAP sinyali (probe.nap)', () => {
  it('markanin maddesindeki telefon/adres; sonraki isletmenin numarasi markaya yazilmaz', async () => {
    respond(200, answer([
      "Kadıköy'de öne çıkan kuaförler:",
      '',
      '1. **Lavanta Kuaför**',
      '   - Adres: Caferağa Mah. Moda Cad. No:12, Kadıköy/İstanbul',
      '   - Telefon: 0216 555 00 00',
      '',
      '2. **Rakip Kuaför**',
      '   - Telefon: 0216 999 88 77',
    ].join('\n')));
    const { probe } = await probeFor(service(), 'Lavanta Kuaför', 'lavantakuafor.com');
    expect(probe.brandMentioned).toBe(true);
    expect(probe.nap).toEqual({
      nearPhones: ['+902165550000'],
      allPhones: ['+902165550000', '+902169998877'],
      address: 'Caferağa Mah. Moda Cad. No:12, Kadıköy/İstanbul',
    });
  });

  it('numara 220 karakterlik alintinin DISINDA olsa da bulunur (cevabin tamami incelenir)', async () => {
    const intro = 'Kadıköy ve çevresinde pek çok kuaför var; aşağıdaki liste kullanıcı yorumları, fiyat ve ulaşım kolaylığı dikkate alınarak hazırlandı. '.repeat(3);
    respond(200, answer(`${intro}\n\n### Lavanta Kuaför\nModa sahiline yakın butik salon.\nTelefon: 0532 111 22 33`));
    const { probe } = await probeFor(service(), 'Lavanta Kuaför', 'lavantakuafor.com');
    expect(probe.excerpt!.length).toBeLessThanOrEqual(220);
    expect(probe.excerpt).not.toContain('0532');
    expect(probe.nap?.nearPhones).toEqual(['+905321112233']);
  });

  it('NAP bulunmayan cevap: alan VAR ve null (incelendi, bulunmadi)', async () => {
    respond(200, answer('Lavanta Kuaför, Moda tarafında sevilen bir salon.'));
    const { probe } = await probeFor(service(), 'Lavanta Kuaför', 'lavantakuafor.com');
    expect(Object.prototype.hasOwnProperty.call(probe, 'nap')).toBe(true);
    expect(probe.nap).toBeNull();
  });

  it('NAP ayristiricisi hata verirse asil olcum korunur; alan YAZILMAZ (incelenmedi)', async () => {
    napBozuk.on = true;
    respond(200, answer('Lavanta Kuaför, Moda tarafında sevilen bir salon. Telefon: 0216 555 00 00'));
    const { probe } = await probeFor(service(), 'Lavanta Kuaför', 'lavantakuafor.com');
    expect(probe.excerpt).not.toMatch(/^HATA:/);
    expect(probe.brandMentioned).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(probe, 'nap')).toBe(false);
  });

  it('HATA satirinda alan YOK (cevap incelenmedi → yerel ozet "olculmedi")', async () => {
    // 4xx yeniden denenmez — test beklemeye girmesin
    respond(400, { error: { message: 'bad request' } });
    const { probe } = await probeFor(service(), 'Lavanta Kuaför', 'lavantakuafor.com');
    expect(probe.excerpt).toBe('HATA: bad_request');
    expect(Object.prototype.hasOwnProperty.call(probe, 'nap')).toBe(false);
  });
});

describe('buildProbe — tam cevap metni yalniz bellekte (answerTextOf)', () => {
  const head = 'KOBİ kredisi karşılaştırması için öne çıkan platformlar şunlar: Hangikredi, Hesapkurdu ve Kobipratik. ';
  const filler = 'Faiz oranı, vade ve masrafları birlikte değerlendirmek gerekir. '.repeat(4);
  const tail = '7. Enpara — dijital başvuru, özel kampanya kodu XQ-91 ile masrafsız.';
  const full = `${head}${filler}\n${tail}`;

  it('servis tam metni verir; probe excerpt 220 karakter, tam metin probe alanlarinda yok', async () => {
    respond(200, answer(full));
    const svc = service();
    const { out, probe } = await probeFor(svc, 'Kobipratik', 'kobipratik.com', 'KOBİ kredisi için en iyi karşılaştırma siteleri?');

    expect(full.length).toBeGreaterThan(220);
    expect(svc.answerTextOf(probe)).toContain('XQ-91');
    expect(svc.answerTextOf(probe)).toContain('Enpara');
    expect(probe.excerpt!.length).toBeLessThanOrEqual(220);
    expect(probe.excerpt).not.toContain('Enpara');

    // Kalici kayda / API cevabina giden her bicim: JSON, kopya, anahtar listesi
    const json = JSON.stringify(out);
    expect(json).not.toContain('XQ-91');
    expect(Object.values(probe).some((v) => typeof v === 'string' && v.includes('XQ-91'))).toBe(false);
    expect(svc.answerTextOf({ ...probe })).toBeUndefined();
    expect(JSON.stringify(structuredClone(probe))).not.toContain('XQ-91');
  });

  it('HATA satiri ve disaridan gelen probe icin tam metin yok', async () => {
    respond(400, { error: { message: 'bad' } });
    const svc = service();
    const { probe } = await probeFor(svc, 'Kobipratik', 'kobipratik.com');
    expect(svc.answerTextOf(probe)).toBeUndefined();
    expect(svc.answerTextOf({ query: 'x', cited: false, brandMentioned: false, excerpt: 'kayittan' })).toBeUndefined();
  });
});
