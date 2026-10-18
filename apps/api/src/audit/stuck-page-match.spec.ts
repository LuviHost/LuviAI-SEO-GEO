import { describe, it, expect } from 'vitest';
import { StuckPageDetectorService } from './stuck-page-detector.service.js';

/**
 * Takili sayfa <-> makale eslesmesi: statik hedefler '<slug>.html' yayinliyor
 * ve yayinci adresi publishedTo[].externalUrl olarak yaziyor. Eski kod
 * uzantiyi atmiyor ve yalniz publishedTo[].url'e bakiyordu: bu sitelerde
 * hicbir takili sayfa makaleyle eslesmiyordu.
 */
const svc = Object.create(StuckPageDetectorService.prototype) as any;
const articles = [
  { id: 'a1', slug: 'kuafor-fiyatlari', title: 'Kuafor fiyatlari', publishedTo: [] },
  { id: 'a2', slug: 'diger-yazi', title: 'Diger', publishedTo: [{ ok: true, externalUrl: 'https://www.ornek.com/blog/ozel-adres/' }] },
  { id: 'a3', slug: 'eski', title: 'Eski', publishedTo: [{ url: 'https://ornek.com/eski-kayit' }] },
];

describe('takili sayfa makale eslesmesi', () => {
  it('WordPress tarzi /slug/ ve statik /blog/slug.html eslesir', () => {
    expect(svc.matchArticle('https://ornek.com/kuafor-fiyatlari/', articles)?.id).toBe('a1');
    expect(svc.matchArticle('https://ornek.com/blog/kuafor-fiyatlari.html', articles)?.id).toBe('a1');
  });
  it('publishedTo[].externalUrl (yayincinin yazdigi alan) ve eski url alani eslesir; www/sonek normalize', () => {
    expect(svc.matchArticle('https://ornek.com/blog/ozel-adres', articles)?.id).toBe('a2');
    expect(svc.matchArticle('http://www.ornek.com/eski-kayit/', articles)?.id).toBe('a3');
  });
  it('eslesme yoksa null', () => {
    expect(svc.matchArticle('https://ornek.com/baska', articles)).toBeNull();
    expect(svc.matchArticle('gecersiz', articles)).toBeNull();
  });
});

describe('M-1 — cop kutusundaki kopya (trashedAt) eslesme kaniti degildir', () => {
  const TRASHED_AT = '2026-10-05T00:00:00.000Z';

  it('adres eslemesi cop kutusundaki kaydi yok sayar (kontrol: ayni kayit canliyken eslesir)', () => {
    const trashed = [{ id: 'a4', slug: 'baska-slug', title: 'Cop', publishedTo: [{ targetId: 'wp1', ok: true, externalUrl: 'https://ornek.com/2025/05/cop-yazi/', trashedAt: TRASHED_AT }] }];
    expect(svc.matchArticle('https://ornek.com/2025/05/cop-yazi/', trashed)).toBeNull();
    const live = [{ ...trashed[0], publishedTo: [{ ...trashed[0].publishedTo[0], trashedAt: undefined }] }];
    expect(svc.matchArticle('https://ornek.com/2025/05/cop-yazi/', live)?.id).toBe('a4');
  });

  it('WordPress kalici baglantisi yazinin slug\'i: o adresteki kopya cop kutusundaysa slug ile de eslenmez; yazinin canli FTP kopyasi eslesir', () => {
    const list = [{
      id: 'a5', slug: 'kdv-rehberi', title: 'KDV',
      publishedTo: [
        { targetId: 'wp1', ok: true, externalUrl: 'https://ornek.com/kdv-rehberi/', trashedAt: TRASHED_AT },
        { targetId: 'ftp1', ok: true, externalUrl: 'https://ornek.com/blog/kdv-rehberi.html' },
      ],
    }];
    expect(svc.matchArticle('https://www.ornek.com/kdv-rehberi', list)).toBeNull();
    expect(svc.matchArticle('https://ornek.com/blog/kdv-rehberi.html', list)?.id).toBe('a5');
  });

  it('ayni adreste canli bir kopya da varsa (geri yuklenip yeniden yayinlanmis) eslesir', () => {
    const list = [{
      id: 'a6', slug: 'geri-gelen', title: 'Geri',
      publishedTo: [
        { targetId: 'wp-eski', ok: true, externalUrl: 'https://ornek.com/geri-gelen/', trashedAt: TRASHED_AT },
        { targetId: 'wp-yeni', ok: true, externalUrl: 'https://ornek.com/geri-gelen/' },
      ],
    }];
    expect(svc.matchArticle('https://ornek.com/geri-gelen/', list)?.id).toBe('a6');
  });
});
