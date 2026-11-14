/**
 * Kenar cubugu catilari (13.11.2026, sahip: "tek menude birlestirelim, farkli yerlerde kalmis
 * gibi oldu"): Bot Takibi (tek satir kod + Canli Tarayici), Icerikler (+ Firsatlar),
 * Ayarlar (+ Baglantilar + Otomatik Akis). Ayni gun Google Isletme panelden kaldirildi;
 * aksam Gorsel Alt Metinleri "Sayfa SEO Iyilestir"e sekme oldu, Olcum Altyapisi kaldirildi.
 * 14.11.2026: Yayin Hedefleri Icerik grubundan Ayarlar catisina sekme olarak tasindi.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { describe, expect, it } from 'vitest';
import { SITE_NAV_ITEMS, SITE_ROOFS, isItemActive, roofTabsForPath, siteNavGroups, sitePaletteItems } from './site-nav';
import { SITE_ROUTES } from './site-routes';

const S = 'cabc';
const ogeler = () => siteNavGroups(S).flatMap((g) => g.items);
const oge = (route: string) => ogeler().find((i) => i.route === route)!;

describe('kenar cubugu — tek menude toplanan sayfalar', () => {
  it('Firsatlar, Baglantilar, Otomatik Akis, Canli Tarayici ve Gorsel Alt Metinleri ayri menu ogesi degil', () => {
    const rotalar = SITE_NAV_ITEMS.map((i) => i.route as string);
    for (const r of ['opportunities', 'connections', 'autopilot', 'crawler', 'images', 'publishTargets']) expect(rotalar, r).not.toContain(r);
    expect(rotalar).toEqual(expect.arrayContaining(['botTakibi', 'articles', 'settings', 'snippet']));
  });

  it('Yayin Hedefleri Ayarlar catisinda (14.11.2026, sahip: "ayarlar kismina alalim"); Icerik grubu 3 oge; adres ayni', () => {
    const icerik = siteNavGroups(S).find((g) => g.id === 'content')!.items.map((i) => i.label);
    expect(icerik).toEqual(['İçerikler', 'Videolar', 'Topluluk Ajanı']);
    expect(SITE_ROOFS.settings.tabs.map((t) => t.route)).toEqual(['settings', 'connections', 'publishTargets', 'autopilot']);
    expect(SITE_ROUTES.publishTargets).toBe('/publish-targets');
    expect(isItemActive(`/sites/${S}/publish-targets`, oge('settings'))).toBe(true);
    expect(isItemActive(`/sites/${S}/publish-targets`, oge('articles'))).toBe(false);
    const r = roofTabsForPath(`/sites/${S}/publish-targets`, S)!;
    expect(r.tabs.filter((t) => t.active).map((t) => t.label)).toEqual(['Yayın hedefleri']);
  });

  it('Google Isletme panelde yok (sahip: "bunu istemiyoruz")', () => {
    expect(SITE_NAV_ITEMS.map((i) => i.label).join(' ')).not.toMatch(/Google İşletme/);
    expect(Object.keys(SITE_ROUTES)).not.toContain('googleIsletme');
  });

  it('Olcum Altyapisi panelde yok (sahip: "cok da onemli degil"): menu, palet ve rota', () => {
    expect(SITE_NAV_ITEMS.map((i) => i.label).join(' ')).not.toMatch(/Ölçüm Altyapısı/);
    expect(sitePaletteItems().map((i) => i.label).join(' ')).not.toMatch(/Ölçüm Altyapısı/);
    expect(Object.keys(SITE_ROUTES)).not.toContain('olcum');
  });

  it('Saglik grubu sade: Site Skoru, Siralama Takibi, Sayfa SEO Iyilestir, Takili Sayfalar, Rakipler', () => {
    const saglik = siteNavGroups(S).find((g) => g.id === 'health')!.items.map((i) => i.label);
    expect(saglik).toEqual(['Site Skoru', 'Sıralama Takibi', 'Sayfa SEO İyileştir', 'Takılı Sayfalar', 'Rakipler']);
  });

  it('cati ogesi catisindaki her sayfada (ve alt sayfalarinda) aktif; ayni anda yalniz bir oge aktif', () => {
    expect(isItemActive(`/sites/${S}/opportunities`, oge('articles'))).toBe(true);
    expect(isItemActive(`/sites/${S}/articles/abc`, oge('articles'))).toBe(true);
    expect(isItemActive(`/sites/${S}/crawler-live`, oge('botTakibi'))).toBe(true);
    expect(isItemActive(`/sites/${S}/connections`, oge('settings'))).toBe(true);
    expect(isItemActive(`/sites/${S}/autopilot`, oge('settings'))).toBe(true);
    expect(isItemActive(`/sites/${S}/connections`, oge('articles'))).toBe(false);
    expect(isItemActive(`/sites/${S}/images`, oge('snippet'))).toBe(true);
    expect(isItemActive(`/sites/${S}/snippet`, oge('snippet'))).toBe(true);
    expect(isItemActive(`/sites/${S}/images`, oge('audit'))).toBe(false);
    for (const yol of ['/opportunities', '/articles', '/crawler-live', '/bot-takibi', '/autopilot', '/connections', '/settings', '/publish-targets', '/snippet', '/images']) {
      expect(ogeler().filter((i) => isItemActive(`/sites/${S}${yol}`, i)).map((i) => i.label), yol).toHaveLength(1);
    }
  });

  it('her catinin ilk sekmesi menu ogesinin kendi rotasi; sekme rotalari tanimli ve tek catida', () => {
    for (const [id, cati] of Object.entries(SITE_ROOFS)) {
      const menu = SITE_NAV_ITEMS.find((i) => i.roof === id);
      expect(menu, id).toBeDefined();
      expect(cati.tabs[0].route, id).toBe(menu!.route);
      for (const t of cati.tabs) expect(Object.keys(SITE_ROUTES), t.route).toContain(t.route);
    }
    const hepsi = Object.values(SITE_ROOFS).flatMap((c) => c.tabs.map((t) => t.route));
    expect(new Set(hepsi).size).toBe(hepsi.length);
  });

  it('her sekme kartinin ikonu ve tek satirlik aciklamasi var (kart dar: en fazla 44 karakter)', () => {
    for (const cati of Object.values(SITE_ROOFS)) {
      for (const t of cati.tabs) {
        expect(t.icon, t.route).toBeTruthy();
        expect(t.desc.length, t.route).toBeGreaterThan(8);
        expect(t.desc.length, t.route).toBeLessThanOrEqual(44);
      }
    }
    const r = roofTabsForPath(`/sites/${S}/images`, S)!;
    expect(r.tabs.map((t) => t.desc)).toEqual(['Başlık, açıklama ve şema eksikleri', 'Eksik alt metnine öneri ve onay']);
    expect(r.tabs.every((t) => !!t.icon)).toBe(true);
  });
});

describe('sekme seridi — roofTabsForPath', () => {
  it('cati sayfasinda sekmeleri verir; gecerli sayfa isaretli', () => {
    const r = roofTabsForPath(`/sites/${S}/connections`, S)!;
    expect(r.tabs.map((t) => t.label)).toEqual(['Site ayarları', 'Bağlantılar', 'Yayın hedefleri', 'Otomatik akış']);
    expect(r.tabs.filter((t) => t.active).map((t) => t.label)).toEqual(['Bağlantılar']);
    expect(roofTabsForPath(`/sites/${S}/crawler-live`, S)!.tabs.map((t) => t.label)).toEqual(['Tek satır kod', 'Canlı tarayıcı']);
    expect(roofTabsForPath(`/sites/${S}/opportunities`, S)!.tabs.map((t) => t.label)).toEqual(['İçerikler', 'Fırsatlar']);
  });

  it('Sayfa SEO catisi: iki sekme, iki sayfada da gorunur; Site Skoru\'ndaki "Alt metinlerini duzelt" adresi ayni', () => {
    const alt = roofTabsForPath(`/sites/${S}/images`, S)!;
    expect(alt.tabs.map((t) => t.label)).toEqual(['Başlık ve açıklama', 'Görsel alt metinleri']);
    expect(alt.tabs.filter((t) => t.active).map((t) => t.label)).toEqual(['Görsel alt metinleri']);
    expect(roofTabsForPath(`/sites/${S}/snippet`, S)!.tabs.filter((t) => t.active).map((t) => t.label)).toEqual(['Başlık ve açıklama']);
    expect(SITE_ROUTES.images).toBe('/images');
    expect(SITE_ROUTES.snippet).toBe('/snippet');
  });

  it('cati disi sayfada ve alt sayfada (makale ayrintisi) serit yok', () => {
    expect(roofTabsForPath(`/sites/${S}/audit`, S)).toBeNull();
    expect(roofTabsForPath(`/sites/${S}/articles/abc`, S)).toBeNull();
    expect(roofTabsForPath(`/sites/${S}`, S)).toBeNull();
  });
});

describe('komut paleti — toplanan sayfalar kendi adiyla aranir', () => {
  it('Baglantilar, Otomatik Akis, Icerik Firsatlari ve Canli Tarayici palette duruyor; her rota bir kez', () => {
    const adlar = sitePaletteItems().map((i) => i.label);
    for (const ad of ['Bağlantılar', 'Otomatik Akış', 'İçerik Fırsatları', 'Canlı Tarayıcı', 'Bot Takibi', 'İçerikler', 'Ayarlar', 'Yayın Hedefleri', 'Sayfa SEO İyileştir', 'Görsel Alt Metinleri']) {
      expect(adlar, ad).toContain(ad);
    }
    const rotalar = sitePaletteItems().map((i) => i.route);
    expect(new Set(rotalar).size).toBe(rotalar.length);
  });
});
