import { describe, it, expect } from 'vitest';
import { checkGeoGate, splitSentences } from '@luviai/shared';
import { checkGeoGate as checkGeoGateV1 } from './fixtures/geo-gate-v1.js';

/**
 * Regresyon ilkesi (PR #20 incelemesi): iki revizyonda kapanmayan kapi bulgusu
 * → REVIZE_NEEDED, yayin yok, makale hakki iade YOK. Rehber yolunda bugun
 * gecen makale yeni kurallar yuzunden durmamali.
 *
 * MOCK YOK: gercek checkGeoGate, dondurulmus eski kapiyla (fixtures/geo-gate-v1.ts,
 * main 9ebb3cc) ayni metinlerde karsilastirilir: karar ve engelleyici kodlar ayni,
 * geri bildirim metni "Öneriler" bolumu cikarilinca birebir ayni.
 */

const OK_REST = `
## KDV nasıl hesaplanır?
> **Kısa cevap:** Matrahı oranla çarpın.

Hesap basittir. Önce matrahı bulun. Sonra oranı uygulayın.

| Kalem | Açıklama |
|---|---|
| Matrah | Vergisiz tutar |
| Oran | Mevzuattaki oran |

## KDV ne zaman beyan edilir?
> **Kısa cevap:** Her ay düzenli olarak beyan edilir.

Beyan aylıktır. Süreyi kaçırmayın.

## Sıkça Sorulan Sorular
### KDV iade edilir mi?
Bazı durumlarda edilir.

## Sonuç
Hesap kolaydır.
`;
const LEDE = `# KDV Hesaplama
> **Hızlı cevap:** KDV, matrahın oranla çarpımıdır. Oran mal ve hizmete göre değişir.

Giriş paragrafı kısa tutuldu.
`;
const AUTHOR = '\n**Bu makale Örnek Muhasebe tarafından hazırlandı.**\n';
const DATE = '\n*Son güncelleme: 2026-10-24*\n';
const long = (n: number) => `${Array.from({ length: n }, () => 'kelime').join(' ')}.`;

const CORPUS: Array<[string, string]> = [
  ['tam gecen rehber', LEDE + OK_REST + AUTHOR + DATE],
  ['tarih yok', LEDE + OK_REST + AUTHOR],
  ['yazar satiri yok (yalniz oneri)', LEDE + OK_REST + DATE],
  ['tablo yok', LEDE + OK_REST.replace(/\| Kalem[\s\S]*?\| Oran \| Mevzuattaki oran \|\n/, '') + AUTHOR + DATE],
  ['kisa cevap yok', LEDE + OK_REST.replace('> **Kısa cevap:** Matrahı oranla çarpın.\n', '') + AUTHOR + DATE],
  ['soru H2 orani dusuk', LEDE + OK_REST.replace('## KDV nasıl hesaplanır?', '## KDV Hesaplama').replace('## KDV ne zaman beyan edilir?', '## Beyan Takvimi') + AUTHOR + DATE],
  ['zayif lede', LEDE.replace(/> \*\*Hızlı cevap:\*\*[^\n]*\n/, 'Günümüzde vergi konuları giderek karmaşıklaşıyor ve bu yazıda KDV hesabını ele alacağız.\n') + OK_REST + AUTHOR + DATE],
  ['eski kalip: kaynaksiz oran', LEDE + OK_REST.replace('Beyan aylıktır.', 'Gecikme faizi %4,5 uygulanır.') + AUTHOR + DATE],
  ['eski kalip: kaynaksiz TL', LEDE + OK_REST.replace('Beyan aylıktır.', 'Ceza 2.000 TL olarak kesilir.') + AUTHOR + DATE],
  ['yeni kalip: $29 (oneri)', LEDE + OK_REST.replace('Beyan aylıktır.', 'Program aylık $29 ile başlar.') + AUTHOR + DATE],
  ['yeni kalip: 1.039 ₺ ve 29 € (oneri)', LEDE + OK_REST.replace('Beyan aylıktır.', 'Paket 1.039 ₺ ya da 29 € tutuyor.') + AUTHOR + DATE],
  ['yeni + eski kalip ayni makalede', LEDE + OK_REST.replace('Beyan aylıktır.', 'Paket 1.039 ₺ tutuyor.').replace('Bazı durumlarda edilir.', 'İade 500 TL üstünde yapılır.') + AUTHOR + DATE],
  ['kaynakli fiyat', LEDE + OK_REST.replace('Beyan aylıktır.', 'Paket 1.039 ₺ ([fiyat sayfası](https://ornek.com/fiyat)).') + AUTHOR + DATE],
  ['uzun cumleler + tarih yok', LEDE.replace('Giriş paragrafı kısa tutuldu.', Array.from({ length: 8 }, () => long(30)).join(' ')) + OK_REST + AUTHOR],
  ['uzun cumleler, gecen', LEDE.replace('Giriş paragrafı kısa tutuldu.', Array.from({ length: 8 }, () => long(30)).join(' ')) + OK_REST + AUTHOR + DATE],
  ['frontmatter + kod blogu', `---\ntitle: "KDV"\n---\n${LEDE}${OK_REST}\n\`\`\`bash\necho "$1 ve 99 TL"\n\`\`\`\n${AUTHOR}${DATE}`],
  ['H1 yok', OK_REST + DATE],
];

/** Yeni geri bildirimden "Öneriler" (warn) bolumunu cikarir */
const withoutSuggestions = (feedback: string) => feedback.replace(/\n\n### Öneriler[\s\S]*?(?=\n\nNot: )/, '');

describe('rehber yolu: yeni kapi = eski kapi (karar, engelleyici kodlar, geri bildirim)', () => {
  it.each(CORPUS)('%s', (_name, md) => {
    const before = checkGeoGateV1(md);
    for (const after of [checkGeoGate(md), checkGeoGate(md, { contentType: 'guide' }), checkGeoGate(md, { contentType: 'guide', contentTypeSource: 'explicit' })]) {
      expect(after.pass).toBe(before.pass);
      const blockCodes = after.issues.filter((i) => i.severity === 'block').map((i) => i.code).sort();
      expect(blockCodes).toEqual(before.issues.map((i) => i.code).sort());
      // Engelleyici bulgularin ornekleri de ayni
      for (const b of before.issues) {
        expect(after.issues.find((i) => i.code === b.code && i.severity === 'block')?.samples).toEqual(b.samples);
      }
      expect(withoutSuggestions(after.feedback)).toBe(before.feedback);
      const hasWarn = after.issues.some((i) => i.severity === 'warn');
      expect(after.feedback.includes('### Öneriler')).toBe(!after.pass && hasWarn);
      if (before.pass) expect(after.feedback).toBe('');
    }
  });

  it('derlemde yeni kalip ve uzun cumle gercekten oneri olarak yakalaniyor (bos test degil)', () => {
    const md = CORPUS.find(([n]) => n === 'yeni kalip: $29 (oneri)')![1];
    expect(checkGeoGate(md).issues.map((i) => `${i.code}/${i.severity}`)).toEqual(['UNSOURCED_NUMERIC_CLAIM/warn']);
    const longMd = CORPUS.find(([n]) => n === 'uzun cumleler + tarih yok')![1];
    expect(checkGeoGate(longMd).issues.map((i) => `${i.code}/${i.severity}`)).toEqual(['NO_UPDATED_DATE/block', 'LONG_SENTENCES/warn']);
  });
});

// ────────────────────────────────────────────────────────────
//  Sablona uyan makale gercek kapidan gecer (soru H2 %50 kurali ile catisma yok)
// ────────────────────────────────────────────────────────────

const TAIL = `
## Sıkça Sorulan Sorular

### Ücretsiz deneme var mı?

Çoğunda var.

## Sonuç

Seçim ihtiyaca bağlıdır.

**Bu makale Örnek tarafından hazırlandı.**

*Son güncelleme: 2026-10-24*
`;
const option = (n: string) => `### ${n}\n\n- Artı: kolay kurulum\n- Eksi: sınırlı rapor\n\n**İdeal kullanıcı:** küçük ekipler.\n`;

const BEST_FOR = `# En iyi muhasebe programları
> **Hızlı cevap:** Çoğu KOBİ için Paraşüt en uygun seçenektir. Stok ağırlıklıysan Logo daha uygun.

## Hangi seçenek kime uygun?
> **Kısa cevap:** Ölçeğe ve stok ihtiyacına göre değişir.

| Sıra | Ad | Kime uygun | Fiyat | Temel sınırlama |
|---|---|---|---|---|
| 1 | Paraşüt | KOBİ | Ücretli | Sınırlı stok |
| 2 | Logo İşbaşı | Orta ölçek | Ücretli | Kurulum |
| 3 | Mikro | Muhasebeci | Ücretli | Arayüz |

${option('Paraşüt')}
${option('Logo İşbaşı')}
${option('Mikro')}
## Seçenekleri nasıl değerlendirdik?
> **Kısa cevap:** Kullanım kolaylığı, entegrasyon ve destek ölçüldü.

Her programı aynı ölçütlerle inceledik.
${TAIL}`;

const COMPARISON = `# Shopify vs WooCommerce
> **Hızlı cevap:** Çoğu küçük işletme için Shopify daha uygun. Tam kontrol isteyenler WooCommerce seçmeli.

## Shopify ile WooCommerce arasındaki farklar neler?
> **Kısa cevap:** Shopify barındırmalı, WooCommerce kendi sunucunda çalışır.

| Ölçüt | Shopify | WooCommerce |
|---|---|---|
| Özellikler | Hazır | Eklentiyle |
| Fiyat | Aylık abonelik | Ücretsiz eklenti, barındırma ücretli |
| Entegrasyon | Uygulama mağazası | Eklenti dizini |
| Destek | 7/24 | Topluluk |

## Hangisi kime uygun?
> **Kısa cevap:** Hız isteyen Shopify, esneklik isteyen WooCommerce.

### Yeni başlayan mağaza
Shopify daha hızlı açılır.

### Geliştiricisi olan ekip
WooCommerce daha esnektir.

## Shopify'dan WooCommerce'e nasıl geçilir?
> **Kısa cevap:** Verileri dışa aktarıp içe aktarın.

1. Ürünleri dışa aktarın.
2. WooCommerce'i kurun.
3. Ürünleri içe aktarın.

## Shopify ve WooCommerce'in sınırlamaları neler?
> **Kısa cevap:** Biri abonelik ister, diğeri bakım ister.

Shopify'da işlem ücreti olabilir. WooCommerce'te güncellemeler senin işin.
${TAIL}`;

const ALTERNATIVES = `# Cloudflare alternatifleri
> **Hızlı cevap:** Çoğu site için Fastly ve Bunny en yakın Cloudflare alternatifleridir.

## Kullanıcılar neden Cloudflare'dan ayrılıyor?
> **Kısa cevap:** Destek ve özel ihtiyaçlar yüzünden.

Bazı ekipler kurumsal destek arar.

## Cloudflare'ın en iyi alternatifleri hangileri?
> **Kısa cevap:** Fastly, Bunny, Akamai, KeyCDN ve Gcore öne çıkar.

${['Fastly', 'Bunny', 'Akamai', 'KeyCDN', 'Gcore'].map((n) => `### ${n}\n\n**Kime uygun:** orta ölçekli siteler.\n\nGüçlü yanı hız, zayıf yanı panel.\n`).join('\n')}
| Alternatif | Kime uygun | Öne çıkan fark |
|---|---|---|
| Fastly | Medya siteleri | Anlık önbellek temizleme |
| Bunny | Küçük siteler | Basit panel |

## Geçiş yaparken nelere dikkat edilmeli?
> **Kısa cevap:** DNS kayıtlarını ve önbellek kurallarını taşıyın.

Önce DNS kayıtlarını dışa aktarın.
${TAIL}`;

describe('sablona uyan makale gercek kapidan gecer (acik tip, engelleyici kurallar acik)', () => {
  it.each([
    ['best_for', BEST_FOR],
    ['comparison', COMPARISON],
    ['alternatives', ALTERNATIVES],
  ] as const)('%s', (type, md) => {
    const r = checkGeoGate(md, { contentType: type, contentTypeSource: 'explicit' });
    expect(r.issues.filter((i) => i.severity === 'block')).toEqual([]);
    expect(r.pass).toBe(true);
    expect(r.stats.questionRatio).toBeGreaterThanOrEqual(0.5);
    expect(r.stats.templateMissing).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────
//  Cumle bolme ve Ingilizce yazar satiri
// ────────────────────────────────────────────────────────────

describe('splitSentences — sayi + nokta', () => {
  it('sonraki kelime buyuk harfse cumle sonu; kucuk harfse sira sayisi', () => {
    expect(splitSentences('Süre 31 Mart 2026. Bu tarihten sonra başvuru yok. Limit sınırı 5. Daha fazlası yasak. 3. adımda bitti.'))
      .toEqual(['Süre 31 Mart 2026.', 'Bu tarihten sonra başvuru yok.', 'Limit sınırı 5.', 'Daha fazlası yasak.', '3. adımda bitti.']);
  });
  it('"Yrd. Doç." bolmez', () => {
    expect(splitSentences('Yrd. Doç. Ali geldi. Sonra gitti.')).toEqual(['Yrd. Doç. Ali geldi.', 'Sonra gitti.']);
  });
  it('patolojik girdide dogrusal kalir', () => {
    const t0 = Date.now();
    const out = splitSentences('vb. '.repeat(200_000));
    expect(out).toHaveLength(1);
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});

describe('MISSING_AUTHOR_LINE — Ingilizce siteler', () => {
  const en = (line: string) => `# Title\n> **Hızlı cevap:** Answer.\n\n## What is it?\n> **Kısa cevap:** A thing.\n\nText.\n\n${line}\n\n*Son güncelleme: 2026-10-24*\n`;
  it.each([['Written by Jane Doe.'], ['*By Jane Doe*'], ['**Author:** Jane Doe'], ['Reviewed by Dr. Smith']])('%s yazar satiri sayilir', (line) => {
    expect(checkGeoGate(en(line)).stats.hasAuthorLine).toBe(true);
  });
  it('"By default, ..." yazar satiri degil', () => {
    expect(checkGeoGate(en('By default, the cache is on.')).stats.hasAuthorLine).toBe(false);
  });
});
