/**
 * Kenar cubugu catilari (13.11.2026, sahip: "tek menude birlestirelim, farkli yerlerde kalmis
 * gibi oldu"): Bot Takibi (tek satir kod + Canli Tarayici), Icerikler (+ Firsatlar),
 * Ayarlar (+ Baglantilar + Otomatik Akis). Ayni gun Google Isletme panelden kaldirildi.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { describe, expect, it } from 'vitest';
import { SITE_NAV_ITEMS, SITE_ROOFS, isItemActive, roofTabsForPath, siteNavGroups, sitePaletteItems } from './site-nav';
import { SITE_ROUTES } from './site-routes';

const S = 'cabc';
const ogeler = () => siteNavGroups(S).flatMap((g) => g.items);
const oge = (route: string) => ogeler().find((i) => i.route === route)!;

describe('kenar cubugu — tek menude toplanan sayfalar', () => {
  it('Firsatlar, Baglantilar, Otomatik Akis ve Canli Tarayici ayri menu ogesi degil', () => {
    const rotalar = SITE_NAV_ITEMS.map((i) => i.route as string);
    for (const r of ['opportunities', 'connections', 'autopilot', 'crawler']) expect(rotalar, r).not.toContain(r);
    expect(rotalar).toEqual(expect.arrayContaining(['botTakibi', 'articles', 'settings']));
  });

  it('Google Isletme panelde yok (sahip: "bunu istemiyoruz")', () => {
    expect(SITE_NAV_ITEMS.map((i) => i.label).join(' ')).not.toMatch(/Google İşletme/);
    expect(Object.keys(SITE_ROUTES)).not.toContain('googleIsletme');
  });

  it('cati ogesi catisindaki her sayfada (ve alt sayfalarinda) aktif; ayni anda yalniz bir oge aktif', () => {
    expect(isItemActive(`/sites/${S}/opportunities`, oge('articles'))).toBe(true);
    expect(isItemActive(`/sites/${S}/articles/abc`, oge('articles'))).toBe(true);
    expect(isItemActive(`/sites/${S}/crawler-live`, oge('botTakibi'))).toBe(true);
    expect(isItemActive(`/sites/${S}/connections`, oge('settings'))).toBe(true);
    expect(isItemActive(`/sites/${S}/autopilot`, oge('settings'))).toBe(true);
    expect(isItemActive(`/sites/${S}/connections`, oge('articles'))).toBe(false);
    for (const yol of ['/opportunities', '/articles', '/crawler-live', '/bot-takibi', '/autopilot', '/connections', '/settings']) {
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
});

describe('sekme seridi — roofTabsForPath', () => {
  it('cati sayfasinda sekmeleri verir; gecerli sayfa isaretli', () => {
    const r = roofTabsForPath(`/sites/${S}/connections`, S)!;
    expect(r.tabs.map((t) => t.label)).toEqual(['Site ayarları', 'Bağlantılar', 'Otomatik akış']);
    expect(r.tabs.filter((t) => t.active).map((t) => t.label)).toEqual(['Bağlantılar']);
    expect(roofTabsForPath(`/sites/${S}/crawler-live`, S)!.tabs.map((t) => t.label)).toEqual(['Tek satır kod', 'Canlı tarayıcı']);
    expect(roofTabsForPath(`/sites/${S}/opportunities`, S)!.tabs.map((t) => t.label)).toEqual(['İçerikler', 'Fırsatlar']);
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
    for (const ad of ['Bağlantılar', 'Otomatik Akış', 'İçerik Fırsatları', 'Canlı Tarayıcı', 'Bot Takibi', 'İçerikler', 'Ayarlar']) {
      expect(adlar, ad).toContain(ad);
    }
    const rotalar = sitePaletteItems().map((i) => i.route);
    expect(new Set(rotalar).size).toBe(rotalar.length);
  });
});
