import { describe, it, expect } from 'vitest';
import { checkGeoGate, splitSentences } from '@luviai/shared';

/**
 * GEO Faz 4 kapi eklemeleri: LONG_SENTENCES (warn), TEMPLATE_STRUCTURE (block,
 * yalniz rehber disi tipte), MISSING_AUTHOR_LINE (warn) ve fiyat kaliplarinin
 * UNSOURCED_NUMERIC_CLAIM kapsamina girmesi.
 *
 * Ilke: 'warn' bulgu PASS'i dusurmez ve kapi gecerken editore gitmez —
 * rehber yolunda bugun gecen makale bu eklemeler yuzunden durmaz.
 */

/** Bugunku kurallarin hepsini gecen rehber makalesi (tablo, kisa cevap, soru H2, tarih, kaynak, lede) */
const PASSING_GUIDE = `# KDV Hesaplama
> **Hızlı cevap:** KDV, matrahın oranla çarpımıdır. Oran mal ve hizmete göre değişir.

Giriş paragrafı kısa tutuldu.

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

**Bu makale Örnek Muhasebe tarafından hazırlandı.**

*Son güncelleme: 2026-10-24*
`;

const codes = (md: string, opts?: Parameters<typeof checkGeoGate>[1]) => checkGeoGate(md, opts).issues.map((i) => i.code);

describe('geriye uyumluluk — rehber yolu', () => {
  it('bugun gecen rehber makalesi gecmeye devam eder; yeni bulgu yok', () => {
    const r = checkGeoGate(PASSING_GUIDE);
    expect(r.pass).toBe(true);
    expect(r.issues).toEqual([]);
    expect(r.feedback).toBe('');
    expect(r.stats.contentType).toBe('guide');
    expect(r.stats.templateMissing).toEqual([]);
  });

  it('rehberde sablon kontrolu yapilmaz (tablo yoksa yalniz NO_TABLE onerisi)', () => {
    const md = PASSING_GUIDE.replace(/\| Kalem[\s\S]*?\| Oran \| Mevzuattaki oran \|\n/, '');
    const r = checkGeoGate(md);
    const c = r.issues.map((i) => i.code);
    expect(c).toContain('NO_TABLE');
    expect(r.issues.find((i) => i.code === 'NO_TABLE')?.severity).toBe('warn');
    expect(c).not.toContain('TEMPLATE_STRUCTURE');
    expect(r.pass).toBe(true);
  });

  it('acikca contentType guide vermek varsayilanla ayni sonucu uretir', () => {
    expect(checkGeoGate(PASSING_GUIDE, { contentType: 'guide' })).toEqual(checkGeoGate(PASSING_GUIDE));
  });

  it('degismeyen eski bulgular (lede, tarih) block onem derecesi tasir; yapi kurallari rehberde oneri', () => {
    const r = checkGeoGate('# Başlık\n\nGünümüzde her şey değişiyor ve bu yazıda anlatacağız.\n\n## Giriş\nMetin.');
    const sev = Object.fromEntries(r.issues.map((i) => [i.code, i.severity]));
    expect(sev.WEAK_LEDE).toBe('block');
    expect(sev.NO_UPDATED_DATE).toBe('block');
    expect(sev.NO_TABLE).toBe('warn');
    expect(sev.LOW_QUESTION_H2_RATIO).toBe('warn');
    expect(sev.MISSING_AUTHOR_LINE).toBe('warn');
    expect(Object.keys(sev)).not.toContain('MISSING_SHORT_ANSWER');
    expect(r.pass).toBe(false);
  });
});

/**
 * 08.11.2026 kanit denetimi: yapi kurallari icin kanit zayif ve celiskili
 * (tablo / soru basligi ile alinti arasinda yalniz korelasyon; bagimsiz tekrar
 * denemesinde stil taktikleri cogu durumda anlamsiz). Her yaziyi ayni iskelete
 * sokmak olcekli sablon izi birakir.
 */
describe('kanit denetimi (08.11.2026) — yapi kurallari', () => {
  const noTable = PASSING_GUIDE.replace(/\| Kalem[\s\S]*?\| Oran \| Mevzuattaki oran \|\n/, '');
  const SOURCES = [undefined, 'default', 'classifier', 'explicit', 'ranker'] as const;
  const noTableSeverity = (o: Parameters<typeof checkGeoGate>[1]) =>
    checkGeoGate(noTable, o).issues.find((i) => i.code === 'NO_TABLE')?.severity;

  it('tablo yoksa: rehber, howto, liste, alternatifler yalniz oneri', () => {
    for (const t of ['guide', 'howto', 'listicle', 'alternatives'] as const) {
      for (const src of SOURCES) expect(noTableSeverity({ contentType: t, contentTypeSource: src })).toBe('warn');
    }
  });

  it('tablo yoksa: sablonu tabloyu zorunlu kilan comparison, best_for, pricing tiplerinde engel (eskisi gibi)', () => {
    for (const t of ['comparison', 'best_for', 'pricing'] as const) {
      for (const src of SOURCES) {
        expect(noTableSeverity({ contentType: t, contentTypeSource: src })).toBe('block');
        expect(checkGeoGate(noTable, { contentType: t, contentTypeSource: src }).pass).toBe(false);
      }
    }
  });

  it('H2 altinda "Kisa cevap" olmamasi hicbir bulgu uretmez (oneri de degil)', () => {
    const md = PASSING_GUIDE.replace(/> \*\*Kısa cevap:\*\*[^\n]*\n/g, '');
    const r = checkGeoGate(md);
    expect(r.issues).toEqual([]);
    expect(r.pass).toBe(true);
    expect(r.feedback).toBe('');
    expect(r.stats.shortAnswerCovered).toBe(0);
  });

  it('soru H2 orani dusukse yalniz oneri; acik urun tipinde de', () => {
    const md = PASSING_GUIDE.replace('## KDV nasıl hesaplanır?', '## KDV Hesaplama').replace('## KDV ne zaman beyan edilir?', '## Beyan Takvimi');
    for (const o of [{}, { contentType: 'comparison' as const, contentTypeSource: 'explicit' as const }]) {
      const r = checkGeoGate(md, o);
      expect(r.issues.find((i) => i.code === 'LOW_QUESTION_H2_RATIO')?.severity).toBe('warn');
      expect(r.pass).toBe(true);
      expect(r.feedback).toBe('');
    }
  });

  it('kaynaksiz sayi, gorunur tarih ve acilis cevabi kurallari engel olarak kaldi', () => {
    const unsourced = PASSING_GUIDE.replace('Beyan aylıktır.', 'Gecikme faizi %4,5 uygulanır.');
    expect(checkGeoGate(unsourced).issues.find((i) => i.code === 'UNSOURCED_NUMERIC_CLAIM')?.severity).toBe('block');
    const noDate = PASSING_GUIDE.replace('*Son güncelleme: 2026-10-24*', '');
    expect(checkGeoGate(noDate).issues.find((i) => i.code === 'NO_UPDATED_DATE')?.severity).toBe('block');
    const weakLede = PASSING_GUIDE.replace(/> \*\*Hızlı cevap:\*\*[^\n]*\n/, '![Hero](hero.webp)\n');
    expect(checkGeoGate(weakLede).issues.find((i) => i.code === 'WEAK_LEDE')?.severity).toBe('block');
  });
});

describe('splitSentences — Turkce cumle bolme', () => {
  it('kisaltma, ondalik, binlik ayrac, sira sayisi ve "A.Ş." cumleyi bolmez', () => {
    expect(splitSentences('Örn. bu bir cümle. KDV oranı %3,5 ve 1.039 TL tutar vb. kalemler var. Şirket A.Ş. olarak kuruldu. 3. adımda bitti! Son mu?'))
      .toEqual([
        'Örn. bu bir cümle.',
        'KDV oranı %3,5 ve 1.039 TL tutar vb. kalemler var.',
        'Şirket A.Ş. olarak kuruldu.',
        '3. adımda bitti!',
        'Son mu?',
      ]);
  });
  it('paragraf siniri cumle siniridir; parantez icindeki kisaltma bolmez', () => {
    expect(splitSentences('Birinci paragraf noktasız\n\nİkinci (örn. bu) cümle.')).toEqual(['Birinci paragraf noktasız', 'İkinci (örn. bu) cümle.']);
  });
  it('ondalik nokta ("3.5") bolmez', () => {
    expect(splitSentences('Oran 3.5 puan arttı. Sonra düştü.')).toEqual(['Oran 3.5 puan arttı.', 'Sonra düştü.']);
  });
});

/** n kelimelik bir cumle */
const sentence = (n: number, word = 'kelime') => `${Array.from({ length: n }, () => word).join(' ')}.`;

describe('LONG_SENTENCES (warn)', () => {
  const withProse = (prose: string) => PASSING_GUIDE.replace('Giriş paragrafı kısa tutuldu.', prose);

  it('25 kelimeyi asan cumle orani %20 ustundeyse warn; PASS dusmez, feedback bos kalir', () => {
    // Sabit metinde ~13 kisa cumle var; 6 uzun cumle → oran ~%30
    const prose = Array.from({ length: 6 }, () => sentence(30)).join(' ');
    const r = checkGeoGate(withProse(prose));
    const issue = r.issues.find((i) => i.code === 'LONG_SENTENCES');
    expect(issue?.severity).toBe('warn');
    expect(issue?.message).toMatch(/ikiye böl/);
    expect(r.pass).toBe(true);
    expect(r.feedback).toBe('');
    expect(r.stats.longSentenceRatio).toBeGreaterThan(0.2);
  });

  it('oran esigin altindaysa bulgu yok', () => {
    const prose = [sentence(30), ...Array.from({ length: 9 }, () => sentence(10))].join(' ');
    expect(codes(withProse(prose))).not.toContain('LONG_SENTENCES');
  });

  it('tablo, liste, baslik ve kod blogu olculmez', () => {
    const longRow = `| ${sentence(40)} | ${sentence(40)} |`;
    const extra = [
      '| A | B |', '|---|---|', longRow, longRow, longRow,
      '', `- ${sentence(40)}`, `1. ${sentence(40)}`, `2. ${sentence(40)}`,
      '', '```', sentence(60), sentence(60), '```',
    ].join('\n');
    expect(codes(withProse(extra))).not.toContain('LONG_SENTENCES');
  });

  it('URL ve kisaltmalar uzun cumle uretmez (URL tek kelime sayilir)', () => {
    const url = 'https://www.gib.gov.tr/' + 'a/'.repeat(40);
    const prose = Array.from({ length: 12 }, () => `Detay için [GİB](${url}) ve örn. ${url} vb. kaynaklara bakın.`).join(' ');
    expect(codes(withProse(prose))).not.toContain('LONG_SENTENCES');
  });

  it('kisa metinde (10 cumleden az) kural uygulanmaz', () => {
    const r = checkGeoGate(`# T\n> **Hızlı cevap:** ${sentence(30)}\n\n${sentence(30)}`);
    expect(r.issues.map((i) => i.code)).not.toContain('LONG_SENTENCES');
  });

  it('kapi baska nedenle kalinca uzun cumle onerisi feedback\'in "Öneriler" bolumune girer', () => {
    const prose = Array.from({ length: 6 }, () => sentence(30)).join(' ');
    const md = withProse(prose).replace('*Son güncelleme: 2026-10-24*', '');
    const r = checkGeoGate(md);
    expect(r.pass).toBe(false);
    expect(r.feedback).toContain('[NO_UPDATED_DATE]');
    expect(r.feedback).toContain('### Öneriler (PASS\'i engellemez');
    expect(r.feedback.indexOf('[LONG_SENTENCES]')).toBeGreaterThan(r.feedback.indexOf('### Öneriler'));
  });
});

describe('MISSING_AUTHOR_LINE (warn)', () => {
  const noAuthor = PASSING_GUIDE.replace('**Bu makale Örnek Muhasebe tarafından hazırlandı.**\n', '');

  it('yazar satiri yoksa warn; PASS dusmez', () => {
    const r = checkGeoGate(noAuthor);
    expect(r.issues.map((i) => i.code)).toEqual(['MISSING_AUTHOR_LINE']);
    expect(r.issues[0].severity).toBe('warn');
    expect(r.pass).toBe(true);
    expect(r.stats.hasAuthorLine).toBe(false);
  });

  it('"Yazar:" etiketi de yazar satiri sayilir', () => {
    expect(codes(noAuthor.replace('## Sonuç', '**Yazar:** Ayşe Yılmaz\n\n## Sonuç'))).not.toContain('MISSING_AUTHOR_LINE');
  });

  it('kayitli yazar adi verilmisse satir o adi tasimali', () => {
    expect(codes(PASSING_GUIDE, { authorName: 'Ayşe Yılmaz' })).toContain('MISSING_AUTHOR_LINE');
    const withName = PASSING_GUIDE.replace('Örnek Muhasebe', 'Ayşe Yılmaz');
    expect(codes(withName, { authorName: 'ayşe yılmaz' })).not.toContain('MISSING_AUTHOR_LINE');
  });
});

describe('TEMPLATE_STRUCTURE (yalniz rehber disi tip; acik/siralayici: block, siniflandirici: warn)', () => {
  it('siniflandirici tahmininde eksik sablon ogesi yalniz oneri: PASS dusmez', () => {
    for (const src of [undefined, 'classifier', 'default'] as const) {
      const r = checkGeoGate(PASSING_GUIDE, { contentType: 'howto', contentTypeSource: src });
      expect(r.issues.find((i) => i.code === 'TEMPLATE_STRUCTURE')?.severity).toBe('warn');
      expect(r.pass).toBe(true);
      expect(r.feedback).toBe('');
    }
  });

  it('siralayici karari engeller', () => {
    const r = checkGeoGate(PASSING_GUIDE, { contentType: 'howto', contentTypeSource: 'ranker' });
    expect(r.issues.find((i) => i.code === 'TEMPLATE_STRUCTURE')?.severity).toBe('block');
    expect(r.pass).toBe(false);
  });

  it('comparison: tablo + Hizli cevap varsa gecer', () => {
    expect(codes(PASSING_GUIDE, { contentType: 'comparison', contentTypeSource: 'explicit' })).not.toContain('TEMPLATE_STRUCTURE');
  });

  it('comparison: Hizli cevap yoksa eksik ogeyi Turkce adlandirir ve PASS dusurur', () => {
    const md = PASSING_GUIDE.replace(/> \*\*Hızlı cevap:\*\*[^\n]*\n/, 'Doğrudan bir giriş cümlesi ile başlıyoruz.\n');
    const r = checkGeoGate(md, { contentType: 'comparison', contentTypeSource: 'explicit' });
    const issue = r.issues.find((i) => i.code === 'TEMPLATE_STRUCTURE');
    expect(issue?.severity).toBe('block');
    expect(issue?.samples?.[0]).toMatch(/hükmü ilk cümlede/);
    expect(r.pass).toBe(false);
    expect(r.feedback).toContain('[TEMPLATE_STRUCTURE]');
    expect(r.stats.templateMissing.length).toBe(1);
  });

  it('best_for: en az 3 satirli tablo ister', () => {
    expect(codes(PASSING_GUIDE, { contentType: 'best_for', contentTypeSource: 'explicit' })).toContain('TEMPLATE_STRUCTURE');
    const ranked = PASSING_GUIDE.replace('| Oran | Mevzuattaki oran |', '| Oran | Mevzuattaki oran |\n| Süre | Aylık |');
    expect(codes(ranked, { contentType: 'best_for', contentTypeSource: 'explicit' })).not.toContain('TEMPLATE_STRUCTURE');
  });

  it('howto: en az 3 adimlik numarali liste ister', () => {
    expect(codes(PASSING_GUIDE, { contentType: 'howto', contentTypeSource: 'explicit' })).toContain('TEMPLATE_STRUCTURE');
    const steps = PASSING_GUIDE.replace('Hesap basittir.', '1. Matrahı bulun.\n2. Oranı seçin.\n\n3. Çarpın.\n\nHesap basittir.');
    expect(codes(steps, { contentType: 'howto', contentTypeSource: 'explicit' })).not.toContain('TEMPLATE_STRUCTURE');
  });

  it('pricing: tablo ister', () => {
    expect(codes(PASSING_GUIDE, { contentType: 'pricing', contentTypeSource: 'explicit' })).not.toContain('TEMPLATE_STRUCTURE');
    const noTable = PASSING_GUIDE.replace(/\| Kalem[\s\S]*?\| Oran \| Mevzuattaki oran \|\n/, '');
    expect(codes(noTable, { contentType: 'pricing', contentTypeSource: 'explicit' })).toContain('TEMPLATE_STRUCTURE');
    expect(checkGeoGate(noTable, { contentType: 'pricing', contentTypeSource: 'explicit' }).issues.find((i) => i.code === 'NO_TABLE')?.severity).toBe('block');
  });

  it('alternatives: en az 5 alternatif (H3 ya da tablo satiri)', () => {
    expect(codes(PASSING_GUIDE, { contentType: 'alternatives', contentTypeSource: 'explicit' })).toContain('TEMPLATE_STRUCTURE');
    const five = PASSING_GUIDE.replace('Beyan aylıktır.', ['A', 'B', 'C', 'D', 'E'].map((x) => `### ${x} Yazılım\n**Kime uygun:** küçük ekipler.`).join('\n\n') + '\n\nBeyan aylıktır.');
    expect(codes(five, { contentType: 'alternatives', contentTypeSource: 'explicit' })).not.toContain('TEMPLATE_STRUCTURE');
  });

  it('listicle: sablon kontrolu yok (bugunku yapi)', () => {
    expect(codes(PASSING_GUIDE, { contentType: 'listicle', contentTypeSource: 'explicit' })).not.toContain('TEMPLATE_STRUCTURE');
  });
});

describe('UNSOURCED_NUMERIC_CLAIM — fiyat kaliplari', () => {
  const withLine = (line: string) => PASSING_GUIDE.replace('Beyan aylıktır. Süreyi kaçırmayın.', line);
  const price = (md: string, opts?: Parameters<typeof checkGeoGate>[1]) =>
    checkGeoGate(md, opts).issues.filter((i) => i.code === 'UNSOURCED_NUMERIC_CLAIM');

  it('eski kalip ("99 TL") eskisi gibi engeller', () => {
    const r = checkGeoGate(withLine('Başlangıç planı aylık 99 TL.'));
    expect(price(withLine('Başlangıç planı aylık 99 TL.'))).toEqual([expect.objectContaining({ severity: 'block', samples: ['Başlangıç planı aylık 99 TL.'] })]);
    expect(r.pass).toBe(false);
  });

  const NEW_FORMS = [
    'Temel plan aylık $29 ile başlar.',
    'Pro paket 1.039 ₺ olarak satılıyor.',
    'Ekip planı kişi başı 15€.',
    'Kurumsal plan €49 düzeyinde.',
    'Paket 29 € tutuyor.',
    'Sepet 500 ₺ üzeri ise kargo bedava.',
  ];

  it.each(NEW_FORMS.map((x) => [x]))('yeni yakalama rehber yolunda yalniz oneri (warn), PASS dusmez: %s', (line) => {
    const r = checkGeoGate(withLine(line));
    expect(price(withLine(line))).toEqual([expect.objectContaining({ severity: 'warn', samples: [line] })]);
    expect(r.pass).toBe(true);
    expect(r.stats.unsourcedNumericClaims).toBe(0);
    expect(r.stats.unsourcedPriceClaims).toBe(1);
  });

  it('yeni yakalama yalniz ACIK / siralayici urun tipinde engeller', () => {
    const md = withLine('Temel plan aylık $29 ile başlar.');
    expect(price(md, { contentType: 'pricing', contentTypeSource: 'explicit' })[0].severity).toBe('block');
    expect(price(md, { contentType: 'comparison', contentTypeSource: 'ranker' })[0].severity).toBe('block');
    // siniflandirici tahmini, urun disi tip: oneri
    expect(price(md, { contentType: 'pricing', contentTypeSource: 'classifier' })[0].severity).toBe('warn');
    expect(price(md, { contentType: 'howto', contentTypeSource: 'explicit' })[0].severity).toBe('warn');
    expect(price(md, { contentType: 'listicle', contentTypeSource: 'ranker' })[0].severity).toBe('warn');
  });

  it('ayni paragrafta resmi fiyat sayfasi linki varsa yakalanmaz', () => {
    expect(codes(withLine('Temel plan aylık $29 ([fiyat sayfası](https://ornek.com/pricing)).'))).not.toContain('UNSOURCED_NUMERIC_CLAIM');
  });

  it('tutar olmayan "TLS 1.3" ve "100 liralık" kaliplari fiyat sayilmaz', () => {
    expect(codes(withLine('Sunucu TLS 1.3 kullanır.'))).not.toContain('UNSOURCED_NUMERIC_CLAIM');
    expect(codes(withLine('Bir 100 liralık banknot düşün.'))).not.toContain('UNSOURCED_NUMERIC_CLAIM');
  });

  it.each([
    ['satir ici kod: htaccess', 'Kural şu: `RewriteRule ^(.*)$ /index.php?q=$1 [L]` satırını ekleyin.'],
    ['satir ici kod: bash', 'Betikte `echo $1` ilk argümanı yazar.'],
    ['satir ici kod: bcrypt', 'Parola özeti `$2y$10$abcdefghijklmnopqrstuv` biçimindedir.'],
    ['satir ici kod: awk', "Sütunu `awk '{print $1}'` ile alın."],
    ['duz metin: htaccess', 'RewriteRule ^(.*)$ /index.php?q=$1 [L] satırı yönlendirir.'],
    ['duz metin: bash', 'Komut: echo $1 ilk argümanı yazar.'],
    ['duz metin: bcrypt', 'Özet $2y$10$abcdefghijklmnopqrstuv gibi görünür.'],
    ['sembolden sonra yil', 'Türk lirası simgesi ₺ 2012’de kabul edildi.'],
    ['sembol tek basina', '₺ simgesi 2012’de kabul edildi.'],
  ])('kod / yil fiyat sayilmaz (%s)', (_name, line) => {
    expect(codes(withLine(line))).not.toContain('UNSOURCED_NUMERIC_CLAIM');
  });
});

describe('QA kapisi (LLM) — adi gecen urunun fiyati', () => {
  it('unsourced_claim sinifi kaynaksiz urun fiyatini / plan limitini acikca kapsar', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./qa-gate.service.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/2\. unsourced_claim[^\n]*Adi gecen bir urunun\/hizmetin fiyati veya plan limiti/);
    expect(src).toContain('1.039 ₺');
  });
});
