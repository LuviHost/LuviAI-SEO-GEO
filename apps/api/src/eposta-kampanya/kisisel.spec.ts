import { describe, expect, it, vi } from 'vitest';
import {
  kisiselDegiskenler, kisiselOku, llmCiktisiniDogrula, olcumCumlesi, olcumOzeti, olcumTarihi, sayfaOzeti, sayfaYeterliMi,
  type KisiselVeri,
} from './kisisel.js';

vi.mock('../audit/axo-fetch.js', async (orijinal) => ({
  ...(await orijinal<typeof import('../audit/axo-fetch.js')>()),
  probeUrl: vi.fn(),
}));
const { probeUrl } = await import('../audit/axo-fetch.js');
const { KisiselHazirlikService } = await import('./kisisel-hazirlik.service.js');

const veri = (a: boolean, b: boolean, gecenler: string[] = []): KisiselVeri => ({
  surum: 1, marka: 'Avasya', faaliyet: 'Kurumsal firmalara bulut ve siber güvenlik çözümleri sunuyorsunuz.',
  soru: 'İstanbul\'da kurumsal sistem entegratörü firmalar hangileri?',
  olcum: { tarih: '2026-11-07T21:30:00Z', asistanlar: [{ ad: 'ChatGPT', olculdu: true, anildi: a }, { ad: 'Perplexity', olculdu: true, anildi: b }], gecenler },
});

describe('llmCiktisiniDogrula', () => {
  const o = { host: 'avasya.com.tr', firma: 'avasya.com.tr' };
  const iyi = { uygun: true, neden: '', marka: 'Avasya', faaliyet: 'Kurumsal firmalara bulut, siber güvenlik ve veri merkezi çözümleri sunuyorsunuz.', soru: 'İstanbul\'da kurumsal sistem entegratörü firmalar hangileri?' };

  it('gecerli cikti kabul edilir', () => {
    expect(llmCiktisiniDogrula(iyi, o)).toEqual({ ok: true, marka: 'Avasya', faaliyet: iyi.faaliyet, soru: iyi.soru });
  });
  it.each([
    [{ ...iyi, uygun: false, neden: 'park sayfası' }, /Site uygun değil: park sayfası/],
    [{ ...iyi, faaliyet: 'Kurumsal firmalara bulut ve siber güvenlik çözümleri sunan bir firma.' }, /sunuyorsunuz/],
    [{ ...iyi, faaliyet: 'Sektörün lider firması olarak kurumsal BT çözümleri sunuyorsunuz.' }, /övgü/],
    [{ ...iyi, soru: 'Avasya güvenilir bir firma mı?' }, /firmanın adı geçiyor/],
    [{ ...iyi, soru: 'Kurumsal BT firmaları' }, /Soru biçimi/],
    [{ ...iyi, marka: '' }, /Marka adı/],
    [null, /JSON/],
  ])('reddedilir: %#', (raw, neden) => {
    const r = llmCiktisiniDogrula(raw, o);
    expect(r.ok).toBe(false);
    expect((r as { neden: string }).neden).toMatch(neden);
  });
});

describe('olcum', () => {
  it('olcumOzeti: anilma, kendi alan adi ve alt alan adlari elenir, siklik sirasi', () => {
    const r = olcumOzeti([
      { provider: 'openai', available: true, probes: [{ brandMentioned: false, mentionedDomains: ['netas.com.tr', 'www.avasya.com.tr', 'ngn.com.tr'] }] },
      { provider: 'perplexity', available: true, probes: [{ cited: true, mentionedDomains: ['ngn.com.tr', 'blog.avasya.com.tr'] }] },
    ], 'avasya.com.tr');
    expect(r.asistanlar).toEqual([{ ad: 'ChatGPT', olculdu: true, anildi: false }, { ad: 'Perplexity', olculdu: true, anildi: true }]);
    expect(r.adaylar).toEqual(['ngn.com.tr', 'netas.com.tr']);
  });
  it('olcumOzeti: calismayan saglayici olculmedi sayilir', () => {
    const r = olcumOzeti([{ provider: 'openai', available: false, probes: [] }], 'a.com');
    expect(r.asistanlar.every((x) => !x.olculdu)).toBe(true);
  });
  it('olcumCumlesi: dort durum, rakip listesi Turkce baglacla', () => {
    expect(olcumCumlesi(veri(false, false, ['a.com', 'b.com', 'c.com', 'd.com']))).toBe('İki asistanın cevabında da yoktunuz. Cevaplarda öne çıkanlar: a.com, b.com ve c.com.');
    expect(olcumCumlesi(veri(true, false))).toBe("ChatGPT cevabında sizi andı, Perplexity'nin cevabında ise yoktunuz.");
    expect(olcumCumlesi(veri(false, true, ['a.com']))).toBe("Perplexity cevabında sizi andı, ChatGPT'nin cevabında ise yoktunuz. Cevaplarda öne çıkanlar: a.com.");
    expect(olcumCumlesi(veri(true, true))).toBe('İki asistan da cevabında sizi andı.');
  });
  it('olcumTarihi TR saatiyle', () => {
    expect(olcumTarihi('2026-11-07T21:30:00Z')).toBe('8 Kasım');
    expect(kisiselDegiskenler(veri(false, false)).olcum_tarihi).toBe('8 Kasım');
  });
  it('kisiselOku: eksik olcum ya da tek asistan kabul edilmez', () => {
    expect(kisiselOku(veri(true, false))).not.toBeNull();
    expect(kisiselOku({ ...veri(true, false), olcum: { ...veri(true, false).olcum, asistanlar: [{ ad: 'ChatGPT', olculdu: true, anildi: true }] } })).toBeNull();
    expect(kisiselOku({ neden: 'x' })).toBeNull();
  });
});

describe('sayfaOzeti', () => {
  it('baslik, aciklama, basliklar; script/nav atilir', () => {
    const html = `<html><head><title>Avasya &#8211; Teknolojinin Her Hali</title><meta name="description" content="Kurumsal BT"></head>
      <body><nav><a>Menü</a></nav><script>var x=1</script><h1>Güçlü Altyapı</h1><h2>Siber Güvenlik</h2><h2>Siber Güvenlik</h2><p>${'Veri merkezi ve bulut. '.repeat(20)}</p></body></html>`;
    const o = sayfaOzeti(html);
    expect(o.baslik).toBe('Avasya – Teknolojinin Her Hali');
    expect(o.aciklama).toBe('Kurumsal BT');
    expect(o.basliklar).toEqual(['Güçlü Altyapı', 'Siber Güvenlik']);
    expect(o.metin).not.toMatch(/Menü|var x/);
    expect(sayfaYeterliMi(o)).toBe(true);
  });
  it('park/yapim asamasi sayfasi yetersiz', () => {
    expect(sayfaYeterliMi(sayfaOzeti(`<title>Yapım aşamasında</title><body>${'x '.repeat(200)}</body>`))).toBe(false);
    expect(sayfaYeterliMi(sayfaOzeti('<title>A</title><body>kısa</body>'))).toBe(false);
  });
});

describe('KisiselHazirlikService.firmaHazirla', () => {
  const html = `<title>Avasya</title><body><h1>Kurumsal BT</h1><p>${'Bulut, siber güvenlik, veri merkezi çözümleri. '.repeat(10)}</p></body>`;
  const llmCevap = { uygun: true, neden: '', marka: 'Avasya', faaliyet: 'Kurumsal firmalara bulut, siber güvenlik ve veri merkezi çözümleri sunuyorsunuz.', soru: 'İstanbul\'da kurumsal sistem entegratörü firmalar hangileri?' };
  const kur = (probes: any[]) => {
    vi.mocked(probeUrl).mockResolvedValue({ state: 'ok', text: html, block: null } as any);
    const llm = { chat: vi.fn(async () => ({ output: JSON.stringify(llmCevap), costUsd: 0.004, stopReason: 'end_turn' })) };
    const citation = {
      runPublicProbes: vi.fn(async (_o: any) => probes),
      classifyRealCompetitors: vi.fn(async ({ candidates }: any) => new Set(candidates.filter((c: string) => c !== 'wikipedia.org'))),
    };
    return { svc: new KisiselHazirlikService({} as any, llm as any, citation as any), llm, citation };
  };

  it('iki asistan olculunce HAZIR; yalniz ChatGPT + Perplexity sorulur; kaynak siteler elenir', async () => {
    const { svc, citation } = kur([
      { provider: 'openai', available: true, cost: 0.02, probes: [{ brandMentioned: false, mentionedDomains: ['netas.com.tr', 'wikipedia.org'] }] },
      { provider: 'perplexity', available: true, cost: 0.01, probes: [{ brandMentioned: false, mentionedDomains: ['netas.com.tr', 'ngn.com.tr'] }] },
    ]);
    const r = await svc.firmaHazirla({ firma: 'avasya.com.tr', web: 'avasya.com.tr', email: 'bilgi@avasya.com.tr' });
    expect(r.durum).toBe('HAZIR');
    expect(citation.runPublicProbes.mock.calls[0][0]).toMatchObject({ brand: 'Avasya', host: 'avasya.com.tr', queries: [llmCevap.soru], only: ['openai', 'perplexity'] });
    // Hizli modelle olculur (11.11.2026): kademe verilmezse varsayilan 'premium' = ChatGPT amiral
    // model, aday basina ~0.15 USD. Soguk e-posta hazirligi ucretsiz testle ayni kademede kalir.
    expect(citation.runPublicProbes.mock.calls[0][0].tier).toBe('standard');
    const v = (r as { veri: KisiselVeri }).veri;
    expect(v.olcum.gecenler).toEqual(['netas.com.tr', 'ngn.com.tr']);
    expect(kisiselOku(v)).not.toBeNull();
  });

  it('bir asistan olculemezse TEKRAR (tek kaynakla "siz yoktunuz" yazilmaz)', async () => {
    const { svc } = kur([
      { provider: 'openai', available: true, cost: 0.02, probes: [{ brandMentioned: false }] },
      { provider: 'perplexity', available: false, cost: 0, probes: [], reason: 'HATA' },
    ]);
    const r = await svc.firmaHazirla({ firma: 'x', web: 'avasya.com.tr', email: 'bilgi@avasya.com.tr' });
    expect(r).toEqual({ durum: 'TEKRAR', neden: 'Perplexity ölçülemedi' });
  });

  it('site engelliyse INCELE, LLM ve olcum cagrilmaz', async () => {
    const { svc, llm, citation } = kur([]);
    vi.mocked(probeUrl).mockResolvedValue({ state: 'blocked', text: '', block: { reason: 'Cloudflare bot doğrulaması' } } as any);
    const r = await svc.firmaHazirla({ firma: 'x', web: 'avasya.com.tr', email: 'bilgi@avasya.com.tr' });
    expect(r).toEqual({ durum: 'INCELE', inceleme: { neden: 'Cloudflare bot doğrulaması' } });
    expect(llm.chat).not.toHaveBeenCalled();
    expect(citation.runPublicProbes).not.toHaveBeenCalled();
  });
});
