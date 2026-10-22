import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EmailService, EDITOR_SCORE_MAX, type EmailTemplate } from './email.service.js';

/**
 * E-posta baglantilari ve olcekleri = web uygulamasi + uretim hatti.
 *
 * NEDEN VAR: welcome_day1 iki yardim sayfasina baglanti veriyordu
 * (/help/onboarding, /help/publish-targets); ikisi de hic yoktu, musteri 404
 * goruyordu. "Makale hazir" e-postalari editor skorunu "/60" ile yaziyordu;
 * olcek 16ab0d9'dan beri 90. Derleme ikisini de yakalamaz: baglanti bir dize,
 * skor bir sablon. Bu spec her sablonu isler, RanksUp adresine giden her
 * baglantiyi apps/web/src/app rota agacinda arar ve paydayi pipeline'in
 * sabitiyle karsilastirir.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** apps/api/src/email -> apps/web/src/app */
const WEB_APP = path.resolve(HERE, '../../../web/src/app');
const read = (p: string) => fs.readFileSync(p, 'utf8');

const svc = new EmailService({ emailLog: { create: async () => {} } } as never);
const render = (t: EmailTemplate, d: Record<string, any> = {}) =>
  (svc as any).renderTemplate(t, d) as { subject: string; html: string };

/** Tip birlesimindeki TUM sablonlar — kaynaktan okunur (email-template.spec.ts ile ayni yontem) */
function tumSablonlar(): EmailTemplate[] {
  const src = read(path.join(HERE, 'email.service.ts'));
  const bas = src.indexOf('export type EmailTemplate');
  const blok = src.slice(bas, src.indexOf(';', bas));
  return [...blok.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1] as EmailTemplate);
}

const PAGE_FILES = ['page.tsx', 'page.ts', 'page.jsx', 'page.js'];
const hasPage = (dir: string) => PAGE_FILES.some((f) => fs.existsSync(path.join(dir, f)));
const subdirs = (dir: string) =>
  fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);

/**
 * Next.js App Router eslemesi: (grup) klasorleri adrese girmez, [param] tek
 * parcayi, [...param] / [[...param]] kalan parcalarin hepsini karsilar.
 * _ ile baslayan ozel klasorler rota degildir.
 */
function routeExists(dir: string, segs: string[]): boolean {
  if (segs.length === 0 && hasPage(dir)) return true;
  for (const name of subdirs(dir)) {
    if (name.startsWith('_')) continue;
    const child = path.join(dir, name);
    if (/^\(.+\)$/.test(name)) {
      if (routeExists(child, segs)) return true;
      continue;
    }
    if (/^\[\[\.\.\..+\]\]$/.test(name) && hasPage(child)) return true;
    if (segs.length === 0) continue;
    if (/^\[\.\.\..+\]$/.test(name) && hasPage(child)) return true;
    if (name === segs[0] || /^\[[^.[\]]+\]$/.test(name)) {
      if (routeExists(child, segs.slice(1))) return true;
    }
  }
  return false;
}

const urlPathExists = (urlPath: string) =>
  routeExists(WEB_APP, urlPath.split(/[?#]/)[0].split('/').filter(Boolean).map(decodeURIComponent));

const BASE = process.env.WEB_BASE_URL ?? 'https://ranksup.ai';

/**
 * Sablonlari dolu veriyle (siteId'li) ve bos veriyle (yedek baglantilar) isle.
 * publicUrl pipeline.service notifyArticleReady'nin kurdugu bicimde.
 */
const ORNEK = {
  name: 'Test', title: 'Başlık', planName: 'Profesyonel', siteId: 'site1', siteName: 'ornek.com',
  items: ['Madde'], editorScore: 75, wordCount: 1200, faqs: 4, articlesPublished: 3,
  publicUrl: `${BASE}/sites/site1/articles/a1`,
};

function baglantilar(): Array<{ sablon: string; href: string }> {
  const base = BASE;
  const out: Array<{ sablon: string; href: string }> = [];
  for (const t of tumSablonlar()) {
    for (const data of [ORNEK, { name: 'Test' }]) {
      const { html } = render(t, data);
      for (const m of html.matchAll(/href="([^"]+)"/g)) {
        if (m[1] === base || m[1].startsWith(`${base}/`)) out.push({ sablon: t, href: m[1].slice(base.length) || '/' });
      }
    }
  }
  return out;
}

describe('e-posta baglantilari web uygulamasinda bir sayfaya gidiyor', () => {
  it('rota cozumleyici calisiyor (bilinen sayfa var, olmayan yok)', () => {
    expect(urlPathExists('/help/getting-started')).toBe(true);
    expect(urlPathExists('/sites/abc/report')).toBe(true);
    expect(urlPathExists('/')).toBe(true);
    expect(urlPathExists('/help/onboarding')).toBe(false);
    expect(urlPathExists('/help/publish-targets')).toBe(false);
  });

  it('her sablonun her RanksUp baglantisi (govde + altbilgi) var olan bir rota', () => {
    const hepsi = baglantilar();
    expect(hepsi.length).toBeGreaterThan(20);
    const kirik = hepsi.filter((b) => !urlPathExists(b.href)).map((b) => `${b.sablon}: ${b.href}`);
    expect([...new Set(kirik)]).toEqual([]);
  });

  it('welcome_day1: yardim baglantilari var olan sayfalara, siteyi eklememis kullaniciya kesin "uretildi" denmiyor', () => {
    const { html } = render('welcome_day1', { name: 'Test' });
    expect(html).toContain('/help/getting-started');
    expect(html).toContain('/faq');
    expect(html).not.toMatch(/help\/onboarding|help\/publish-targets/);
    expect(html).not.toContain('Onboarding sonrası ilk makalen üretildi');
    expect(html).toContain('Siteni henüz eklemediysen');
  });
});

describe('yasam dongusu e-postalari kodda karsiligi olmayan iddia tasimiyor', () => {
  it('deneme bitisi: "hesap pasiflesir" / "30 gun saklanir" yok (deneme bitince hesap kapanmaz, veri silinmez)', () => {
    // Dayanak: expireOldTrials yalniz subscriptionStatus'u EXPIRED yapar; veri silen ya da
    // hesabi kapatan bir adim yok. Sahip karari 21.10.2026'dan beri suresi dolan hesap
    // salt okunur (billing/trial-expiry.guard.ts, yalniz satin alma acikken); bunu
    // e-postalar denemeSonu ile soyler (trial-expiry-end.spec.ts).
    const quota = read(path.resolve(HERE, '../billing/quota.service.ts'));
    const govde = quota.slice(quota.indexOf('async expireOldTrials('), quota.indexOf('async expireOldTrials(') + 600);
    expect(govde).toContain("data: { subscriptionStatus: 'EXPIRED' }");
    for (const t of ['trial_expiry_d11', 'trial_expiry_d13', 'trial_expired'] as const) {
      const { subject, html } = render(t, { name: 'Test' });
      expect(`${subject} ${html}`, t).not.toMatch(/pasif|30 gün saklan|verilerin silinmez/i);
      expect(html, t).toContain('/pricing');
    }
  });

  it('welcome_day3 GSC durumunu bilmeden "bagli degil" demiyor; welcome_day7 sayi yoksa makale sayisi uydurmuyor', () => {
    const d3 = render('welcome_day3', { name: 'Test' }).html;
    expect(d3).not.toContain('Search Console bağlı değil');
    expect(d3).toContain('Zaten bağladıysan');
    const d7 = render('welcome_day7', { name: 'Test' }).html;
    expect(d7).not.toMatch(/birkaç makale|makale üretildi/);
    expect(render('welcome_day7', { name: 'Test', articleCount: 4 }).html).toContain('Şu ana kadar 4 makale üretildi.');
  });
});

describe('makale hazir e-postalari editor skorunu dogru olcekle yaziyor', () => {
  it('payda pipeline.service EDITOR_MAX_SCORE ile ayni', () => {
    const pipeline = read(path.resolve(HERE, '../articles/pipeline.service.ts'));
    const m = pipeline.match(/private static readonly EDITOR_MAX_SCORE = (\d+);/);
    expect(m, 'pipeline.service.ts EDITOR_MAX_SCORE bulunamadi').toBeTruthy();
    expect(EDITOR_SCORE_MAX).toBe(Number(m![1]));
  });

  it.each(['first_article_published', 'article_ready'] as const)('%s: "75/90", eski "/60" yok', (t) => {
    const { html } = render(t, ORNEK);
    expect(html).toContain(`75/${EDITOR_SCORE_MAX}`);
    expect(html).not.toContain('/60');
  });

  it('skor yoksa olcek de yazilmiyor', () => {
    const { html } = render('article_ready', { name: 'Test', title: 'Başlık' });
    expect(html).not.toContain(`/${EDITOR_SCORE_MAX}<`);
  });
});
