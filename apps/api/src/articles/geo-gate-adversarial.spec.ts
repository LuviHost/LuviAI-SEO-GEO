import { describe, it, expect } from 'vitest';
import { checkGeoGate } from '@luviai/shared';
import type { ContentType, ContentTypeSource } from '@luviai/shared';
import { checkGeoGate as checkGeoGateV1 } from './fixtures/geo-gate-v1.js';

/**
 * Cekismeli regresyon derlemi (PR #20 dogrulama incelemesi): 64 gercekci parca
 * (finans, devops, e-ticaret, egitim, yerel hizmet, liste/tablo) x tip/kaynak
 * birlesimleri. Ilke: eski kapi (fixtures/geo-gate-v1.ts) GECIYORSA yeni kapi da
 * gecer — tip acikca (acik secim / siralayici) secilmedikce ve rehber / howto /
 * liste tiplerinde. Tek istisna: acik secilmis howto'da sablon eksigi (TEMPLATE_STRUCTURE).
 */
const LEDE = (t: string) => `# ${t}
> **Hızlı cevap:** Bu rehber konuyu doğrudan cevaplar ve ilk adımda ne yapmanız gerektiğini söyler.

Kısa bir giriş paragrafı.
`;
const SEC = (snippet: string) => `
## Bu iş nasıl yapılır?
> **Kısa cevap:** Önce hazırlık yapın, sonra uygulayın.

${snippet}

| Adım | Açıklama |
|---|---|
| Hazırlık | Gerekli bilgileri toplayın |
| Uygulama | Ayarları yapın |

## Nelere dikkat etmeli?
> **Kısa cevap:** Yedek alın ve test edin.

Değişiklikten önce yedek alın. Sonra test edin.

## Sıkça Sorulan Sorular
### Bu iş zor mu?
Hayır, değildir.

## Sonuç
Adımları izleyin.

*Son güncelleme: 2026-10-24*
`;
const ARTICLE = (t: string, s: string) => LEDE(t) + SEC(s);

// [domain, snippet]
const S: Array<[string, string]> = [
  // finans / KOBİ
  ['fin', 'Şahıs şirketi kurmak için noter onaylı imza beyannamesi gerekir.'],
  ['fin', 'Fatura kesmek için e-Arşiv portalına giriş yapın.'],
  ['fin', 'Muhasebeci ücretleri aylık 2.500 TL civarındadır.'],
  ['fin', 'Muhasebeci ücretleri aylık 2.500 ₺ civarındadır.'],
  ['fin', 'Muhasebeci ücretleri aylık ₺2.500 civarındadır.'],
  ['fin', 'KDV oranı %20 olarak uygulanır. Kaynak: GİB'],
  ['fin', 'KDV oranı %20 olarak uygulanır (bkz. `https://www.gib.gov.tr/kdv`).'],
  ['fin', 'Damga vergisi oranı binde 9,48 olarak uygulanır; ayrıntı `mevzuat.gov.tr` adresinde.'],
  ['fin', 'Paraşüt aylık 1.039 ₺ ile başlar.'],
  ['fin', 'Logo İşbaşı yıllık 7.200 TL tutarındadır.'],
  ['fin', '₺ 2012\'den beri sembolüyle kullanılır.'],
  ['fin', 'Kredi kartı limiti 50.000 lira ile sınırlıdır.'],
  ['fin', 'Kâr marjı genellikle tek haneli kalır.'],
  ['fin', 'KOSGEB desteği 300.000 TL\'ye kadar çıkabilir, ayrıntı için [KOSGEB](https://www.kosgeb.gov.tr) sayfasına bakın.'],
  ['fin', 'Banka havale masrafı € 3 civarındadır.'],
  ['fin', 'Yurt dışı satışta 1.000 $ üstü işlemler bildirilir.'],
  ['fin', 'Yurt dışı satışta $1.000 üstü işlemler bildirilir.'],
  // hosting / devops
  ['dev', 'Sunucuda `echo $HOME` komutunu çalıştırın.'],
  ['dev', 'Fiyat değişkenini `$price = 29;` ile tanımlayın.'],
  ['dev', 'Kabukta $1 ilk argümandır, $2 ikinci argümandır.'],
  ['dev', 'awk ile ilk sütunu alın: awk \'{print $1}\' dosya.txt'],
  ['dev', 'Parola özeti $2y$10$abcdefghijk biçimindedir.'],
  ['dev', 'Ortam değişkeni PATH=$PATH:/usr/local/bin olarak eklenir.'],
  ['dev', 'Ortam değişkeni PATH=$PATH:/usr/local/bin olarak eklenir. `https://nginx.org/en/docs/` kılavuzuna bakın.'],
  ['dev', 'VPS planları aylık $5 ile başlar.'],
  ['dev', 'DigitalOcean droplet aylık 6 $ tutar.'],
  ['dev', 'Hetzner CX22 aylık 4,59 € ücretlidir.'],
  ['dev', 'Bir domain yıllık 300 TL civarındadır.'],
  ['dev', '```bash\nexport PRICE=$29\necho $PRICE\n```'],
  ['dev', 'Regex içinde ^\\$\\d+$ kalıbı tutarı eşler.'],
  ['dev', 'PHP\'de $_SERVER[\'REQUEST_URI\'] değişkeni adresi verir.'],
  ['dev', 'jQuery\'de $(document).ready ile başlayın.'],
  ['dev', 'Sunucu yükü %80\'i geçerse uyarı gelir.'],
  ['dev', 'Docker imajı yaklaşık 120 MB yer kaplar.'],
  ['dev', 'Fiyat: `$9/ay` — kaynak sayfası `https://example.com/pricing`.'],
  // e-ticaret
  ['eco', 'Shopify Basic plan aylık $39 ücretlidir.'],
  ['eco', 'Shopify Basic plan aylık 39$ ücretlidir.'],
  ['eco', 'Kargo ücreti 49,90 TL\'dir.'],
  ['eco', 'Kargo ücreti 49,90 ₺\'dir.'],
  ['eco', 'Trendyol komisyon oranları kategoriye göre %10 ile %25 arasındadır.'],
  ['eco', 'Ürünü 199,99 € fiyatla listeleyin.'],
  ['eco', 'İkas paketleri 2025 yılında yenilendi.'],
  ['eco', 'Sepet ortalaması 450 TL üzerindeyse ücretsiz kargo verin.'],
  ['eco', 'Ürün fiyatı $19.99 olarak gösterilir.'],
  ['eco', 'Stripe her işlemden %2,9 + 0,30 $ alır. Kaynak: stripe.com/pricing'],
  // eğitim
  ['edu', 'YKS başvuru ücreti 750 TL\'dir.'],
  ['edu', 'Kurs ücreti 3.000 ₺ olup taksitle ödenebilir.'],
  ['edu', 'Udemy kursları genelde $10 ile $20 arasında satılır.'],
  ['edu', 'Öğrencilerin çoğu haftada 5 saat çalışır.'],
  ['edu', 'Coursera Plus yıllık 399 $ tutar.'],
  ['edu', 'IELTS sınav ücreti 250 € civarındadır.'],
  // yerel hizmet
  ['loc', 'Kombi bakım ücreti 1.500 ₺ civarındadır.'],
  ['loc', 'Kombi bakım ücreti ₺1.500 civarındadır.'],
  ['loc', 'Boya ustası metrekare başına 150 TL alır.'],
  ['loc', 'Nakliye fiyatları 2024\'te %30 arttı.'],
  ['loc', 'Diş implantı fiyatı 800 € ile başlar.'],
  ['loc', 'Elektrikçi çağırmak servis ücreti olarak ₺ 500 tutabilir.'],
  ['loc', 'Avukat danışmanlık ücreti saatlik $100 olabilir.'],
  // list/table/mixed
  ['mix', '- Başlangıç: $9\n- Pro: $29\n- Kurumsal: iletişime geçin'],
  ['mix', '| Plan | Fiyat |\n|---|---|\n| Basic | $9 |\n| Pro | 29 € |'],
  ['mix', '| Plan | Fiyat |\n|---|---|\n| Basic | 99 TL |\n| Pro | 199 TL |'],
  ['mix', '1. Hesap açın.\n2. Paketi seçin ($12).\n3. Ödemeyi yapın.'],
  ['mix', 'Fiyat `100`% artar.'],
  ['mix', 'Toplam 5`x`% oranında.'],
];


const NON_AUTHORITATIVE: Array<ContentTypeSource | undefined> = ['classifier', 'default', undefined];
const ALL_TYPES: ContentType[] = ['guide', 'howto', 'listicle', 'comparison', 'best_for', 'alternatives', 'pricing'];
const TITLES = ['KOBİ Rehberi', 'VPS Kurulumu', 'E-ticaret Başlangıç'];

describe('cekismeli derlem: eski PASS → yeni PASS (acik secilmemis tip, rehber/howto/liste)', () => {
  it('derlem 64 parca', () => expect(S).toHaveLength(64));

  it.each(S.map(([dom, snip], idx) => [idx, dom, snip] as const))('#%s [%s] %s', (idx, _dom, snip) => {
    const md = ARTICLE(TITLES[idx % 3], snip);
    if (!checkGeoGateV1(md).pass) return; // eski kapi zaten durduruyordu
    const blocked = (o: Parameters<typeof checkGeoGate>[1]) => checkGeoGate(md, o).issues.filter((i) => i.severity === 'block').map((i) => i.code);
    expect(blocked({})).toEqual([]);
    for (const type of ALL_TYPES) {
      for (const src of NON_AUTHORITATIVE) expect(blocked({ contentType: type, contentTypeSource: src })).toEqual([]);
    }
    for (const src of ['explicit', 'ranker'] as const) {
      expect(blocked({ contentType: 'guide', contentTypeSource: src })).toEqual([]);
      expect(blocked({ contentType: 'listicle', contentTypeSource: src })).toEqual([]);
      // acik howto yalniz sablon eksigiyle durabilir (derlem makalesinde numarali liste yok)
      expect(blocked({ contentType: 'howto', contentTypeSource: src }).filter((c) => c !== 'TEMPLATE_STRUCTURE')).toEqual([]);
    }
  });
});

describe('kaynak backtick icinde ya da "$" iceren linkte: silinmez (eski PASS korunur)', () => {
  it.each([
    ['KDV oranı %20 olarak uygulanır (bkz. `https://www.gib.gov.tr/kdv`).'],
    ['Damga vergisi oranı binde 9,48 olarak uygulanır; ayrıntı `mevzuat.gov.tr` adresinde.'],
    ['Komisyon %3 (`https://www.iyzico.com/fiyatlandirma`).'],
    ['İşlem ücreti [$0,30/$0,50](https://stripe.com/pricing) arasındadır.'],
    ['Komisyon %2,9 uygulanır; bkz. https://stripe.com/pricing?a=$x&b=$y'],
  ])('%s', (snip) => {
    const md = ARTICLE('KOBİ Rehberi', snip);
    expect(checkGeoGateV1(md).pass).toBe(true);
    for (const o of [{}, { contentType: 'pricing' as const, contentTypeSource: 'explicit' as const }, { contentType: 'guide' as const, contentTypeSource: 'ranker' as const }]) {
      const r = checkGeoGate(md, o);
      expect(r.issues.filter((i) => i.code === 'UNSOURCED_NUMERIC_CLAIM')).toEqual([]);
      expect(r.pass).toBe(true);
    }
  });
});

describe('urun tipinde kacirilan fiyatlar: parantez ve aralik', () => {
  const price = (snip: string, o: Parameters<typeof checkGeoGate>[1]) =>
    checkGeoGate(ARTICLE('Proje Araçları', snip), o).issues.find((i) => i.code === 'UNSOURCED_NUMERIC_CLAIM')?.severity;
  it.each([
    ['Trello Standard ($5/ay) küçük ekiplere yeter.'],
    ['Pro paket (₺199/ay) daha fazla alan verir.'],
    ['Kurslar $10-$20 arasında satılır.'],
    ['Kurslar $10–$20 arasında satılır.'],
  ])('%s → acik pricing: block, rehber: warn', (snip) => {
    expect(price(snip, { contentType: 'pricing', contentTypeSource: 'explicit' })).toBe('block');
    expect(price(snip, {})).toBe('warn');
    expect(price(snip, { contentType: 'comparison', contentTypeSource: 'classifier' })).toBe('warn');
  });

  it('kabuk konumsal argumani ("$1 ilk argümandır") tutar degil, acik urun tipinde bile', () => {
    expect(price('Komut satırında $1 ilk argümandır.', { contentType: 'pricing', contentTypeSource: 'explicit' })).toBeUndefined();
    expect(price('Komut satırında $1 ilk argümandır, $2 ikinci parametredir.', { contentType: 'pricing', contentTypeSource: 'explicit' })).toBeUndefined();
  });

  it('"$(document)" ve "$_SERVER" tutar degil', () => {
    expect(price("jQuery'de $(document).ready ile başlayın.", { contentType: 'pricing', contentTypeSource: 'explicit' })).toBeUndefined();
    expect(price("PHP'de $_SERVER['REQUEST_URI'] adresi verir.", { contentType: 'pricing', contentTypeSource: 'explicit' })).toBeUndefined();
  });
});
