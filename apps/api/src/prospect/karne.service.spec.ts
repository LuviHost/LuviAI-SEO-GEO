import { describe, it, expect, vi } from 'vitest';
import { KarneService } from './karne.service.js';
import { sorulariGetir } from './karne-sorular.js';

/**
 * Panelden karne uretimi (intel.controller → KarneService.uret).
 *
 * NEDEN VAR: altsektorAnahtari(sektor, altsektor) tek argumanla (alt sektor
 * metni) cagriliyordu; fonksiyon onu sektor diye dogrulayip "Bilinmeyen
 * sektör" hatasi atiyordu. Alt sektor verilen her panel karnesi hic
 * uretilmiyordu (hata yalniz loglaniyordu). Vitest dekorator metadata'si
 * uretmez — servis elle kurulur.
 */
function kur(o: { bugunVar?: boolean; olcum?: () => Promise<unknown[]>; satirlar?: unknown[]; kayit?: unknown } = {}) {
  const runPublicProbes = vi.fn<(opts: { queries: string[] }) => Promise<unknown[]>>(
    o.olcum ??
      (async () => [
        { provider: 'perplexity', label: 'Perplexity', available: true, probes: [], cost: 0.001 },
        { provider: 'meta', label: 'Meta AI (Llama)', available: false, probes: [], reason: 'NO_KEY', cost: 0 },
      ]),
  );
  const create = vi.fn(async () => ({ id: 'k1', token: 'tok' }));
  const findFirst = vi.fn(async () => (o.bugunVar ? { id: 'eski' } : null));
  const findMany = vi.fn(async () => o.satirlar ?? []);
  const findUnique = vi.fn(async () => o.kayit ?? null);
  const prisma = { prospectKarne: { create, findFirst, findMany, findUnique } };
  const settings = { getString: vi.fn(async () => '') };
  const svc = new KarneService(prisma as any, { runPublicProbes } as any, settings as any);
  return { svc, runPublicProbes, create, findFirst };
}

/** Arka plan olcumunun (then/catch/finally) bitmesini bekle */
const bekle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('KarneService.uret — alt sektor', () => {
  it('eslesen alt sektor: hata yok, alana ozel sorular sorulur ve anahtar kayda gecer', async () => {
    const t = kur();
    const k = await t.svc.uret({ brand: 'Acme Bank', host: 'acmebank.com.tr', sektor: 'finans', altsektor: 'Sigorta şirketi' });
    expect(k.token).toBe('tok');
    const sorulan = t.runPublicProbes.mock.calls[0][0].queries;
    expect(sorulan).toEqual(sorulariGetir('finans', 'sigorta'));
    // Genel setten farkli: son 3 soru alana ozel
    expect(sorulan).not.toEqual(sorulariGetir('finans'));
    expect((t.create.mock.calls[0] as any)[0].data.altsektor).toBe('sigorta');
  });

  it('eslesmeyen alt sektor genel sorulara duser (hata atmaz), ham metin kayda gecer', async () => {
    const t = kur();
    await t.svc.uret({ brand: 'Acme Bank', host: 'acmebank.com.tr', sektor: 'finans', altsektor: 'kuyumcu' });
    expect(t.runPublicProbes.mock.calls[0][0].queries).toEqual(sorulariGetir('finans'));
    expect((t.create.mock.calls[0] as any)[0].data.altsektor).toBe('kuyumcu');
  });

  it('yapilandirilmamis saglayici (NO_KEY) karnede kapsam disi', async () => {
    const t = kur();
    const k = await t.svc.uret({ brand: 'Acme Bank', host: 'acmebank.com.tr', sektor: 'finans' });
    expect(k.ozet.saglayicilar.find((s) => s.provider === 'meta')?.kapsamda).toBe(false);
  });
});

describe('KarneService.uret — kuruma ozel sorular (panel /admin/karneler)', () => {
  it('ozel sorular bankanin yerine sorulur; sektor serbest etikettir; kurum adi gecen soru elenir', async () => {
    const t = kur();
    await t.svc.uret({
      brand: 'Acme Ajans',
      host: 'acmeajans.com',
      sektor: 'Dijital pazarlama ajansı',
      sorular: ["1. Türkiye'de dijital pazarlama ajansı önerir misin?", '', '# not', 'Acme Ajans güvenilir mi?'],
    });
    expect(t.runPublicProbes.mock.calls[0][0].queries).toEqual(["Türkiye'de dijital pazarlama ajansı önerir misin?"]);
    expect((t.create.mock.calls[0] as any)[0].data.sektor).toBe('Dijital pazarlama ajansı');
  });

  it('etiket bos ise "Özel soru seti" yazar', async () => {
    const t = kur();
    await t.svc.uret({ brand: 'Ornek Bilisim', host: 'ornekbilisim.com.tr', sektor: '', sorular: ['Kurumsal sistem entegratörü önerir misin?'] });
    expect((t.create.mock.calls[0] as any)[0].data.sektor).toBe('Özel soru seti');
  });

  it('soru siniri asilirsa olcum yapilmaz', async () => {
    const t = kur();
    const cok = Array.from({ length: 21 }, (_, i) => `Soru ${i + 1} hangi firma?`);
    await expect(t.svc.uret({ brand: 'Acme Ajans', host: 'acme.com', sektor: 'x', sorular: cok })).rejects.toThrow(/en fazla 20/);
    expect(t.runPublicProbes).not.toHaveBeenCalled();
  });
});

describe('KarneService.baslat — panelden arka plan olcumu', () => {
  const girdi = { brand: 'Acme Ajans', host: 'https://www.acmeajans.com/', sektor: 'Ajans', sorular: ['Dijital pazarlama ajansı önerir misin?'] };

  it('dogrulama hatasi para harcamadan doner', async () => {
    const t = kur();
    const r = await t.svc.baslat({ ...girdi, brand: 'IC' });
    expect(r).toMatchObject({ started: false });
    expect((r as any).reason).toMatch(/en az 4 karakter/);
    expect(t.runPublicProbes).not.toHaveBeenCalled();
  });

  it('ayni TR gununde olculmus alan adi onay ister', async () => {
    const t = kur({ bugunVar: true });
    const r = await t.svc.baslat(girdi);
    expect(r).toMatchObject({ started: false, ayniGun: true });
    expect(t.runPublicProbes).not.toHaveBeenCalled();
  });

  it('onayla baslar, is HAZIR olur ve karne kaydina baglanir', async () => {
    const t = kur({ bugunVar: true });
    const r = await t.svc.baslat(girdi, { ayniGunOnay: true });
    expect(r.started).toBe(true);
    expect(t.svc.isListesi()[0]).toMatchObject({ host: 'acmeajans.com', durum: 'CALISIYOR', soruSayisi: 1 });
    await bekle();
    expect(t.svc.isListesi()[0]).toMatchObject({ durum: 'HAZIR', karneId: 'k1' });
    expect(t.svc.isListesi()[0].bitti).toBeTruthy();
  });

  it('ayni alan adi icin calisan olcum varken ikincisi baslamaz', async () => {
    const t = kur({ olcum: () => new Promise(() => undefined) });
    expect((await t.svc.baslat(girdi)).started).toBe(true);
    const ikinci = await t.svc.baslat(girdi);
    expect(ikinci).toMatchObject({ started: false });
    expect((ikinci as any).reason).toMatch(/zaten sürüyor/);
    expect(t.runPublicProbes).toHaveBeenCalledTimes(1);
  });

  it('olcum hatasi isi HATA yapar, mesaj panelde gorunur', async () => {
    const t = kur({ olcum: async () => { throw new Error('DB yok'); } });
    await t.svc.baslat(girdi);
    await bekle();
    expect(t.svc.isListesi()[0]).toMatchObject({ durum: 'HATA', hata: 'DB yok' });
  });
});

describe('KarneService — liste ve tekrar olcum', () => {
  const satir = (id: string, host: string, gun: string, toplam: Record<string, number>) => ({
    id, token: `t-${id}`, brand: 'X Firma', host, sektor: 'Ajans', altsektor: null,
    ozet: { sorular: ['a', 'b'], toplam }, maliyetUsd: 3.36, gorulmeSayisi: 0, sonGorulmeAt: null,
    createdAt: new Date(gun), prospect: null,
  });

  it('sayilar ozetten gelir; ayni alan adinin olcum sirasi eskiden yeniye', async () => {
    const t = kur({
      satirlar: [
        satir('c', 'a.com', '2026-11-09T10:00:00Z', { olculenCevap: 48, anilanCevap: 2, olculenSaglayici: 6, anilanSaglayici: 2 }),
        satir('b', 'b.com', '2026-11-08T10:00:00Z', { olculenCevap: 40, anilanCevap: 0 }),
        satir('a', 'a.com', '2026-11-07T10:00:00Z', {}),
      ],
    });
    const l = await t.svc.adminListe();
    expect(l.map((r) => [r.id, r.olcumNo])).toEqual([['c', 2], ['b', 1], ['a', 1]]);
    expect(l[0]).toMatchObject({ soruSayisi: 2, olculenCevap: 48, anilanCevap: 2, anilanSaglayici: 2, url: 'https://ranksup.ai/karne/t-c' });
    expect(l[2]).toMatchObject({ olculenCevap: 0, anilanCevap: 0 });
  });

  it('tekrar olcum ayni sorulari ve etiketi kullanir', async () => {
    const t = kur({
      kayit: { brand: 'Acme Ajans', host: 'acmeajans.com', sektor: 'Dijital pazarlama ajansı', altsektor: null, prospectId: null, ozet: { sorular: ['Dijital pazarlama ajansı önerir misin?', 'Otomotiv için ajans?'] } },
    });
    const r = await t.svc.tekrarBaslat('k9');
    expect(r.started).toBe(true);
    await bekle();
    expect(t.runPublicProbes.mock.calls[0][0].queries).toEqual(['Dijital pazarlama ajansı önerir misin?', 'Otomotiv için ajans?']);
    expect((t.create.mock.calls[0] as any)[0].data.sektor).toBe('Dijital pazarlama ajansı');
  });
});
