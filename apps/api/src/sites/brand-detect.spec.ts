import { describe, it, expect } from 'vitest';
import { detectBrandName, kisaAd, pickHomePage } from './brand-detect.js';

/** Gercek ana sayfalardan alinmis sinyaller (22.11.2026) */
const org = (name: string, extra: Record<string, unknown> = {}) => ({ '@context': 'https://schema.org', '@type': 'Organization', name, ...extra });

describe('marka adi tespiti — ana sayfadan', () => {
  it('Kalem: baslik + schema ayni ad → kisa ad "Kalem", gorunen ad Kalem', () => {
    const r = detectBrandName({
      title: 'Kalem Finansal Teknolojiler | Ödemenin Geleceği',
      ogTags: {},
      jsonLdBlocks: [org('Kalem Finansal Teknolojiler', { url: 'https://www.kaleminc.com/' }), org('Ana Holding')],
    }, 'https://www.kaleminc.com');
    expect(r).toEqual({ display: 'Kalem', aliases: ['Kalem'] });
  });

  it('og:site_name alan adiyla ortusurse tek kaynak yeter; slogan eklenmez', () => {
    expect(detectBrandName({ title: 'Liman Hizmetleri - En Uygun Teklifler', ogTags: { 'og:site_name': 'MaviLiman' } }, 'https://maviliman.com'))
      .toEqual({ display: 'MaviLiman', aliases: ['MaviLiman'] });
    expect(detectBrandName({ title: 'Online Alışveriş Sitesi | Al-Gel', ogTags: { 'og:site_name': 'Al-Gel' } }, 'https://al-gel.com'))
      .toEqual({ display: 'Al-Gel', aliases: ['Al-Gel'] });
  });

  it('alan adi tam adi tasiyorsa kisa ad yok ("Ayşe" ya da "Güvenli" tek basina marka degil)', () => {
    expect(detectBrandName({ title: 'Dental | Ayşe Demir', ogTags: { 'og:site_name': 'Ayşe Demir' } }, 'https://aysedemir.co.uk'))
      .toEqual({ display: 'Ayşe Demir', aliases: ['Ayşe Demir'] });
    expect(detectBrandName({ title: 'Güvenli Kasa', ogTags: { 'og:site_name': 'Güvenli Kasa' } }, 'https://www.guvenlikasa.com'))
      .toEqual({ display: 'Güvenli Kasa', aliases: ['Güvenli Kasa'] });
  });

  it('gundelik kelimeden ibaret ad: gorunen ad olur, eslesmeye (diger adlara) girmez', () => {
    expect(detectBrandName({ title: 'Emlak İlanları', ogTags: { 'og:site_name': 'Emlak' } }, 'https://emlak.com'))
      .toEqual({ display: 'Emlak', aliases: [] });
  });

  it('uzun hal kisa ad listedeyse eklenmez; sirket eki atilir', () => {
    const r = detectBrandName({
      title: 'Paramix POS: Hızlı Ödeme Alın',
      ogTags: { 'og:site_name': 'Paramix' },
      jsonLdBlocks: [org('Paramix Ödeme Kuruluşu A.Ş.')],
    }, 'https://www.paramix.com');
    expect(r).toEqual({ display: 'Paramix', aliases: ['Paramix'] });
  });

  it('dayanagi olmayan baslik parcasi ad sayilmaz (tek kaynak, alan adiyla ilgisiz)', () => {
    expect(detectBrandName({ title: 'Ana Sayfa | Hoş Geldiniz', ogTags: {} }, 'https://ornekfirma.com')).toBeNull();
    expect(detectBrandName(null, 'https://ornekfirma.com')).toBeNull();
  });

  it('@graph icindeki kurum adi okunur', () => {
    const r = detectBrandName({
      title: 'Zirvo',
      jsonLdBlocks: [{ '@context': 'https://schema.org', '@graph': [{ '@type': 'WebSite', name: 'Zirvo' }, { '@type': 'WebPage', name: 'Anasayfa' }] }],
    }, 'https://zirvo.com');
    expect(r).toEqual({ display: 'Zirvo', aliases: ['Zirvo'] });
  });
});

describe('kisa ad kurali', () => {
  it('kok ilk kelimeyle baslayip baska kelimeyle devam ediyorsa kisa ad', () => {
    expect(kisaAd('Kalem Finansal Teknolojiler', 'kaleminc')).toBe('Kalem');
    expect(kisaAd('Norvex Teknoloji', 'norvex')).toBe('Norvex');
  });
  it('kok sonraki kelimeleri de tasiyorsa yok', () => {
    expect(kisaAd('Pirlanta Digital Solutions', 'pirlantadigital')).toBeNull();
    expect(kisaAd('Güvenli Kasa', 'guvenlikasa')).toBeNull();
    expect(kisaAd('Tek', 'tek')).toBeNull();
  });
});

describe('ana sayfa secimi', () => {
  it('yolu "/" olan sayfa; yoksa ilk', () => {
    const pages = [{ url: 'https://ornek.com/hakkimizda' }, { url: 'https://www.ornek.com/' }];
    expect(pickHomePage(pages, 'https://ornek.com')?.url).toBe('https://www.ornek.com/');
    expect(pickHomePage([{ url: 'https://ornek.com/x' }], 'https://ornek.com')?.url).toBe('https://ornek.com/x');
    expect(pickHomePage([], 'https://ornek.com')).toBeNull();
  });
});

describe('PATCH /sites/:id — diger adlar ve gorunen ad yalniz yoneticide', async () => {
  const { vi } = await import('vitest');
  const { SitesService } = await import('./sites.service.js');
  function svc() {
    const site = { id: 's1', userId: 'u1', name: 'kaleminc', url: 'https://www.kaleminc.com' };
    const prisma = {
      site: {
        findUnique: vi.fn(async () => site),
        update: vi.fn(async (args: any) => ({ ...site, ...args.data })),
      },
    };
    return { s: new SitesService(prisma as any, {} as any, {} as any), prisma };
  }
  const dto = { name: 'kaleminc', brandAliases: ['Uretici', 'Google'], brandDisplay: 'Kalem' };

  it('musteri: alanlar yok sayilir, geri kalan kaydedilir', async () => {
    const { s, prisma } = svc();
    await s.update('s1', dto as any, { id: 'u1', role: 'USER' } as any);
    const data = (prisma.site.update.mock.calls[0] as any[])[0].data;
    expect(data).toEqual({ name: 'kaleminc' });
  });

  it('yonetici: temizlenip yazilir; bos gorunen ad = kaldir', async () => {
    const { s, prisma } = svc();
    await s.update('s1', { ...dto, brandDisplay: '  Kalem  ' } as any, { id: 'admin', role: 'ADMIN' } as any);
    expect((prisma.site.update.mock.calls[0] as any[])[0].data).toMatchObject({ brandAliases: ['Uretici', 'Google'], brandDisplay: 'Kalem' });
    await s.update('s1', { brandDisplay: '' } as any, { id: 'admin', role: 'ADMIN' } as any);
    expect((prisma.site.update.mock.calls[1] as any[])[0].data).toEqual({ brandDisplay: null });
  });
});

describe('kurulum: beyin uretilirken tespit yazilir', async () => {
  const { vi } = await import('vitest');
  const { BrainGeneratorService } = await import('./brain-generator.service.js');
  const page = {
    url: 'https://www.kaleminc.com/', title: 'Kalem Finansal Teknolojiler | Ödemenin Geleceği', ogTags: {},
    jsonLdBlocks: [org('Kalem Finansal Teknolojiler')],
  };
  it('mevcut diger adlar korunur, bulunanlar eklenir, gorunen ad yazilir', async () => {
    const update = vi.fn(async () => ({}));
    const b = new BrainGeneratorService({ site: { update } } as any, {} as any);
    await (b as any).applyDetectedBrand({ id: 's1', name: 'kaleminc', url: 'https://www.kaleminc.com', brandAliases: ['Uretici'] }, [page]);
    expect(update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { brandDisplay: 'Kalem', brandAliases: ['Uretici', 'Kalem'] } });
  });
  it('guvenilir ad yoksa hicbir sey yazilmaz', async () => {
    const update = vi.fn(async () => ({}));
    const b = new BrainGeneratorService({ site: { update } } as any, {} as any);
    await (b as any).applyDetectedBrand({ id: 's1', name: 'ornek', url: 'https://ornek.com', brandAliases: null }, [{ url: 'https://ornek.com/', title: 'Ana Sayfa' }]);
    expect(update).not.toHaveBeenCalled();
  });
  it('yalniz gorunen ad bossa calisir (yoneticinin sildigi ad geri gelmez)', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('./brain-generator.service.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/if \(!site\.brandDisplay\) \{\s*await this\.applyDetectedBrand/);
  });
});
