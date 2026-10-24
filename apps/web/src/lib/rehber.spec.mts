/**
 * /rehber yayin kapisi: her makale cevap-oncelikli yapida, kaynakli ve tarihli olmali;
 * FAQPage JSON-LD'si gorunur SSS ile birebir ayni, para tutarlarinin yaninda kaynak var.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REHBER_ARTICLES } from '../content/rehber/index';
import type { RehberArticle } from '../content/rehber/types';
import { CONTENT_AUTHOR, PUBLIC_PAGES, pageUpdated } from './page-updated';
import {
  MONEY_RE, blockTexts, firstSentence, parseInline, plainInline, rehberFaqJsonLd, rehberJsonLd, rehberPath, wordCount,
} from './rehber';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const REHBER_DIR = join(SRC, 'app/(marketing)/rehber');
const read = (p: string) => readFileSync(p, 'utf8');
const BUGUN = new Date().toISOString().slice(0, 10);
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const gecerliTarih = (d: string) => ISO.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

/** Makalenin tum gorunur metinleri */
function tumMetinler(a: RehberArticle): string[] {
  return [
    a.title, a.description, a.answer, ...a.quick,
    ...a.sections.flatMap((s) => [s.h2, ...s.blocks.flatMap(blockTexts)]),
    ...a.faq.flatMap((f) => [f.q, f.a]),
  ];
}

describe('yardimcilar', () => {
  it('MONEY_RE birim-onde ve birim-sonda tutarlari yakalar, yuzde ve yili yakalamaz', () => {
    for (const s of ['$149/ay', '€47/ay', '1.039 TL', '12.470,40 TL', '50 ₺', '₺1.499', '149 $']) expect(MONEY_RE.test(s), s).toBe(true);
    for (const s of ['%40', '2026', '15 prompt', '24 saat', 'TLS', '9 motor']) expect(MONEY_RE.test(s), s).toBe(false);
  });

  it('ilk cumle "llms.txt" gibi ic noktalarda bolunmez; isaretleme temizlenir', () => {
    expect(firstSentence('llms.txt, bir dosyadır; etkisi yok. İkinci cümle.')).toBe('llms.txt, bir dosyadır; etkisi yok.');
    expect(plainInline('[fiyat](/pricing) ve **kalın**')).toBe('fiyat ve kalın');
    expect(parseInline('a [b](/c) d')).toEqual([
      { type: 'text', text: 'a ' }, { type: 'link', text: 'b', href: '/c' }, { type: 'text', text: ' d' },
    ]);
  });
});

describe('rehber kaydi = rotalar = sitemap', () => {
  const sluglar = REHBER_ARTICLES.map((a) => a.slug);

  it('7 makale, slug tekrari yok', () => {
    expect(sluglar.length).toBe(7);
    expect(new Set(sluglar).size).toBe(sluglar.length);
  });

  it('her slug icin rota dosyasi var ve dogru veri modulunu kullaniyor; kayitsiz rota yok', () => {
    for (const s of sluglar) {
      const page = read(join(REHBER_DIR, s, 'page.tsx'));
      expect(page, s).toContain(`from '@/content/rehber/${s}'`);
      expect(page, s).toContain('<RehberArticlePage article={article} />');
    }
    const dizinler = readdirSync(REHBER_DIR).filter((e) => statSync(join(REHBER_DIR, e)).isDirectory());
    expect(dizinler.sort()).toEqual([...sluglar].sort());
    expect(read(join(REHBER_DIR, 'page.tsx'))).toContain('PageUpdatedLine path="/rehber"');
  });

  it('dizin ve her makale PUBLIC_PAGES (sitemap) icinde; fazladan /rehber yolu yok', () => {
    const yollar = PUBLIC_PAGES.map((p) => p.path).filter((p) => p.startsWith('/rehber'));
    expect(yollar.sort()).toEqual(['/rehber', ...sluglar.map(rehberPath)].sort());
  });
});

describe.each(REHBER_ARTICLES.map((a) => [a.slug, a] as const))('%s', (_slug, a) => {
  const yol = rehberPath(a.slug);
  const kaynakIdleri = new Set(a.sources.map((s) => s.id));

  it('baslik bir soru; H2 ve SSS sorulari soru bicimli', () => {
    expect(a.title).toContain('?');
    for (const s of a.sections) expect(s.h2.trim().endsWith('?'), s.h2).toBe(true);
    for (const f of a.faq) expect(f.q.trim().endsWith('?'), f.q).toBe(true);
  });

  it('meta: <title> sablonla ≤ 60, aciklama 70-155 karakter', () => {
    expect(`${a.metaTitle} · RanksUp`.length, a.metaTitle).toBeLessThanOrEqual(60);
    expect(a.description.length, a.description).toBeLessThanOrEqual(155);
    expect(a.description.length).toBeGreaterThanOrEqual(70);
  });

  it('ilk cumle dogrudan cevap: ≤ 25 kelime', () => {
    const ilk = firstSentence(a.answer);
    expect(wordCount(ilk), ilk).toBeLessThanOrEqual(25);
    expect(wordCount(ilk)).toBeGreaterThanOrEqual(8);
  });

  it('Hızlı cevap 3-7 madde; en az bir tablo var', () => {
    expect(a.quick.length).toBeGreaterThanOrEqual(3);
    expect(a.quick.length).toBeLessThanOrEqual(7);
    expect(a.sections.some((s) => s.blocks.some((b) => b.t === 'table'))).toBe(true);
  });

  it('SSS 5-8 soru, duz metin; FAQPage JSON-LD gorunur SSS ile birebir ayni', () => {
    expect(a.faq.length).toBeGreaterThanOrEqual(5);
    expect(a.faq.length).toBeLessThanOrEqual(8);
    for (const f of a.faq) expect(plainInline(f.a), f.q).toBe(f.a);
    const ld = rehberFaqJsonLd(a) as { mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }> };
    expect(ld.mainEntity.map((q) => ({ q: q.name, a: q.acceptedAnswer.text }))).toEqual(a.faq.map((f) => ({ q: f.q, a: f.a })));
    // Sayfadaki JSON-LD dizisi ayni FAQPage nesnesini tasir
    expect(rehberJsonLd(a, pageUpdated(yol))).toContainEqual(rehberFaqJsonLd(a));
  });

  it('kaynaklar: en az bir URL; URL https + gecerli erisim tarihi; birinci taraf veride not', () => {
    expect(a.sources.some((s) => s.url)).toBe(true);
    expect(kaynakIdleri.size).toBe(a.sources.length);
    for (const s of a.sources) {
      if (s.url) {
        expect(s.url, s.id).toMatch(/^https:\/\//);
        expect(gecerliTarih(s.accessed ?? ''), `${s.id} erisim tarihi`).toBe(true);
        expect(s.accessed! <= BUGUN, `${s.id} gelecekte`).toBe(true);
      } else {
        expect(s.note, `${s.id} birinci taraf notu`).toBeTruthy();
      }
    }
  });

  it('bloklarin kaynak referanslari var olan kaynaklara gidiyor', () => {
    for (const s of a.sections) for (const b of s.blocks) {
      if ('kaynak' in b && b.kaynak) for (const id of b.kaynak) expect(kaynakIdleri.has(id), `${s.id}: ${id}`).toBe(true);
    }
  });

  it('para tutari yalniz yaninda kaynak satiri olan blokta; cevap, ozet, SSS ve meta tutar tasimiyor', () => {
    for (const s of a.sections) for (const b of s.blocks) {
      if (blockTexts(b).some((t) => MONEY_RE.test(t))) {
        const k = 'kaynak' in b ? b.kaynak : undefined;
        expect(k?.length ?? 0, `${s.id} blogunda tutar var ama kaynak yok`).toBeGreaterThan(0);
      }
    }
    for (const t of [a.title, a.description, a.metaTitle, a.answer, ...a.quick, ...a.faq.flatMap((f) => [f.q, f.a])]) {
      expect(MONEY_RE.test(t), t).toBe(false);
    }
  });

  it('tarihler gecerli: ilk yayin ≤ son guncelleme ≤ bugun', () => {
    const guncel = pageUpdated(yol);
    expect(gecerliTarih(a.published)).toBe(true);
    expect(a.published <= guncel).toBe(true);
    expect(guncel <= BUGUN).toBe(true);
  });

  it('JSON-LD: baslik, tarihler, yazar sabiti ve logolu yayinci', () => {
    type Ld = { '@type': string; headline: string; datePublished: string; dateModified: string;
      author: { name: string }; publisher: { logo: { url: string } }; itemListElement: Array<{ item: string }> };
    const [art, crumbs] = rehberJsonLd(a, pageUpdated(yol)) as unknown as Ld[];
    expect(art['@type']).toBe(a.schemaType);
    expect(art.headline).toBe(a.title);
    expect(art.datePublished).toBe(a.published);
    expect(art.dateModified).toBe(pageUpdated(yol));
    expect(art.author.name).toBe(CONTENT_AUTHOR.tr);
    expect(art.publisher.logo.url).toMatch(/^https:\/\/ranksup\.ai\//);
    expect(crumbs.itemListElement.at(-1).item).toBe(`https://ranksup.ai${yol}`);
  });

  it('ic baglantilar var olan sayfalara, dis baglantilar https; ilgili rehberler kayitli', () => {
    const yollar = new Set(PUBLIC_PAGES.map((p) => p.path));
    for (const t of tumMetinler(a)) {
      for (const tok of parseInline(t)) {
        if (tok.type !== 'link') continue;
        if (tok.href.startsWith('/')) expect(yollar.has(tok.href.split('#')[0]), `${a.slug}: ${tok.href}`).toBe(true);
        else expect(tok.href, `${a.slug}: ${tok.href}`).toMatch(/^https:\/\//);
      }
    }
    const sluglar = new Set(REHBER_ARTICLES.map((x) => x.slug));
    expect(a.related.length).toBeGreaterThan(0);
    for (const r of a.related) {
      expect(sluglar.has(r), r).toBe(true);
      expect(r).not.toBe(a.slug);
    }
  });

  it('KobiPratik anan makale iliskiyi aciklar; RanksUp karsilastiran makale kendi urunumuz oldugunu yazar', () => {
    const metin = tumMetinler(a).join('\n');
    if (metin.includes('KobiPratik')) expect(metin).toContain('kurucu ekibimizin ortağı olduğu bir site');
    if (a.slug === 'yapay-zeka-gorunurluk-araclari') expect(metin).toContain('bizim ürünümüz');
  });
});

describe('sayfa bileseni = veri', () => {
  const bilesen = read(join(SRC, 'components/rehber/rehber-article.tsx'));

  it('gorunur SSS ve JSON-LD ayni listeden; tarih ve yazar tek kaynaktan', () => {
    expect(bilesen).toContain('a.faq.map((f) =>');
    expect(bilesen).toContain('rehberJsonLd(a, updated)');
    expect(bilesen).toContain('const updated = pageUpdated(path)');
    expect(bilesen).toContain('<PageUpdatedLine path={path} fixedLocale="tr" />');
    // Deneme cagrisi plans.ts deneme maddesiyle ayni
    expect(bilesen).toContain('14 gün ücretsiz dene · Kart gerekmez');
    expect(bilesen).not.toContain("'use client'");
  });
});
