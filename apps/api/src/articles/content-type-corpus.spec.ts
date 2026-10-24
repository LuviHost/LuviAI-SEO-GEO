import { describe, it, expect } from 'vitest';
import { classifyTopicTitle } from '@luviai/shared';

/**
 * Gercekci baslik derlemi (PR #20 bagimsiz incelemesi, 68 baslik; finans/KOBI,
 * hosting, egitim, e-ticaret, yerel hizmet, Ingilizce). Beklentiler inceleyicinin;
 * tek fark: yerel hizmet / komisyon "ucret / fiyat" basliklari 'guide' (fiyat
 * sablonu yazilim ve abonelik planlari icindir — inceleme maddesi D6).
 *
 * Sablon yanlis tipte dayatilmasin: siniflandirici muhafazakar; supheli baslik guide.
 */
const CORPUS: Array<[string, string]> = [
  // finans / KOBİ
  ['Kredi kartı nasıl alınır', 'howto'],
  ['En iyi POS cihazı hangisi', 'best_for'],
  ['e-Fatura mı e-Arşiv mi', 'comparison'],
  ['Kur farkı faturası nasıl kesilir', 'howto'],
  ['Kur farkı nedir, nasıl hesaplanır?', 'howto'],
  ['Fiyat farkı faturası nedir', 'guide'],
  ['Brüt ve net maaş farkı nedir', 'comparison'],
  ['KDV iadesi nasıl alınır', 'howto'],
  ['Asgari ücret 2026 ne kadar oldu?', 'guide'],
  ['Asgari ücretin işverene maliyeti', 'guide'],
  ['Faiz kararı borsayı nasıl etkiler', 'guide'],
  ['Enflasyon kredi faizlerini nasıl etkiler?', 'guide'],
  ['Kredi notu nasıl yükselir', 'howto'],
  ['Şahıs şirketi mi limited şirket mi?', 'comparison'],
  ['Kredi kartı borcu yapılandırılır mı, faizi silinir mi?', 'guide'],
  ['Şirket kurmak zorunlu mu, vergi muafiyeti var mı?', 'guide'],
  ["Alternatif finansman yöntemleri: KOBİ'ler için rehber", 'guide'],
  ['Altın fiyatları neden yükseliyor?', 'guide'],
  ['Konut kredisi faiz oranları 2026', 'guide'],
  ['Kira artış oranı nasıl hesaplanır', 'howto'],
  ['Vergi levhası nereden alınır', 'howto'],
  ['KOSGEB desteği kimlere verilir', 'guide'],
  ['Damga vergisi nedir, kimler öder?', 'guide'],
  ['Muhasebe programı fiyatları', 'pricing'],
  ['Paraşüt mü Logo İşbaşı mı?', 'comparison'],
  ['Ön muhasebe programı alternatifleri', 'alternatives'],
  ['E-ticarette KDV oranları kaç?', 'guide'],
  ['Serbest meslek makbuzu nasıl kesilir', 'howto'],
  // hosting
  ['WordPress hosting nasıl seçilir', 'guide'],
  ['En iyi WordPress hosting firmaları', 'best_for'],
  ['VPS vs paylaşımlı hosting', 'comparison'],
  ['SSL sertifikası nasıl kurulur', 'howto'],
  ['Hosting fiyatları neden farklı?', 'guide'],
  ['Domain nasıl alınır', 'howto'],
  ['Cloudflare alternatifleri', 'alternatives'],
  ['DNS nasıl çalışır', 'guide'],
  ["Web sitesi hızı SEO'yu nasıl etkiler?", 'guide'],
  ['Nasıl bir hosting paketi seçmeliyim?', 'guide'],
  ['cPanel ile Plesk arasındaki farklar', 'comparison'],
  // eğitim
  ["YKS'ye nasıl çalışılır", 'howto'],
  ['Online eğitim mi yüz yüze eğitim mi daha verimli?', 'comparison'],
  ['Alternatif eğitim modelleri nelerdir', 'guide'],
  ['Özel ders ücretleri 2026', 'guide'],
  ['Çocuklar için en iyi kodlama kursları', 'best_for'],
  ['Montessori yöntemi nedir', 'guide'],
  ['Öğrenciler için 10 verimli çalışma tekniği', 'listicle'],
  ['LGS puanı nasıl hesaplanır', 'howto'],
  // e-ticaret
  ['Shopify vs WooCommerce', 'comparison'],
  ['Kargo ücretleri ne kadar?', 'guide'],
  ['E-ticaret sitesi nasıl kurulur', 'howto'],
  ['Trendyol komisyon oranları', 'guide'],
  ['Pazaryerinde satış yapmanın 7 avantajı', 'listicle'],
  ['E-ticarette iade süreci nasıl işler', 'guide'],
  ['Email marketing best practices', 'guide'],
  ['Ürün fiyatlandırma stratejileri', 'guide'],
  ['İkas mı Ticimax mı? Hangisi daha iyi', 'comparison'],
  // yerel hizmet
  ["İstanbul'da en uygun nakliyat firması", 'best_for'],
  ['Kombi bakımı nasıl yapılır', 'howto'],
  ['Kombi bakım ücreti ne kadar?', 'guide'],
  ['Diş implantı fiyatları 2026', 'guide'],
  ['Evden eve nakliyat kaç para?', 'guide'],
  ['Su kaçağı tespiti nasıl yapılır', 'howto'],
  ['Boya badana yaptırırken dikkat edilmesi gereken 5 şey', 'listicle'],
  ['Halı yıkama fabrikası mı evde yıkama mı?', 'comparison'],
  // english
  ['How AI search affects SEO', 'guide'],
  ['Why are gold prices rising', 'guide'],
  ['Best practices for API design', 'guide'],
  ['Top 5 hosting providers', 'best_for'],
];

describe('classifyTopicTitle — 68 basliklik gercekci derlem', () => {
  it('derlem 68 baslik', () => {
    expect(CORPUS).toHaveLength(68);
  });
  it.each(CORPUS)('%s → %s', (title, expected) => {
    expect(classifyTopicTitle(title) ?? 'guide').toBe(expected);
  });
});

/**
 * Dogrulama incelemesinin ek 50 baslik yoklamasi: evet/hayir sorulari, "nasil
 * etkiler", sifat "alternatif", genel fiyatlandirma konulari ("Pricing strategies
 * for SaaS"), "Top 10 SEO mistakes" (liste), fiyat sozcugu + is tarif eden yuklem
 * ("ücretleri nasıl iade edilir" → howto), bilinen abonelik urunleri.
 */
const PROBES: Array<[string, string]> = [
  ['Kredi kartı aidatı iade edilir mi?', 'guide'],
  ['E-fatura zorunlu mu?', 'guide'],
  ['Vergi borcu silinir mi?', 'guide'],
  ['Bitcoin almak mantıklı mı?', 'guide'],
  ['Kira gelir vergisi beyannamesi verilir mi?', 'guide'],
  ['Asgari ücret artışı enflasyonu nasıl etkiler?', 'guide'],
  ['Kur artışı ihracatçıyı nasıl etkiler', 'guide'],
  ['Alternatif enerji kaynakları nelerdir', 'guide'],
  ['Alternatif yatırım araçları', 'guide'],
  ['Hosting fiyatları neden arttı?', 'guide'],
  ['WordPress eklenti fiyatları neden yüksek', 'guide'],
  ['Noter ücretleri 2026', 'guide'],
  ['Avukatlık ücretleri ne kadar', 'guide'],
  ['Shopify fiyatları ve planları', 'pricing'],
  ['VPS fiyatları', 'pricing'],
  ['Notion fiyatları ne kadar?', 'pricing'],
  ['Google Workspace ücretleri', 'pricing'],
  ['Notion vs Obsidian', 'comparison'],
  ['ChatGPT vs Gemini: hangisi daha iyi?', 'comparison'],
  ['iPhone mu Samsung mu?', 'comparison'],
  ['Kredi kartı mı banka kartı mı daha avantajlı?', 'comparison'],
  ['Ev almak mantıklı mı yoksa kirada oturmak mı?', 'comparison'],
  ['SEO mu Google Ads mi?', 'comparison'],
  ['Faiz ve kâr payı farkı', 'comparison'],
  ['Yaş farkı olan çiftler', 'guide'],
  ['Which is better, Shopify or Wix?', 'comparison'],
  ['Best CRM for small business', 'best_for'],
  ['How to set up a VPS', 'howto'],
  ['Shopify alternatives', 'alternatives'],
  ['Alternatives to Mailchimp', 'alternatives'],
  ["Zoom'un en iyi alternatifleri", 'alternatives'],
  ['Pricing strategies for SaaS', 'guide'],
  ['SaaS pricing models explained', 'guide'],
  ['Top 10 SEO mistakes', 'listicle'],
  ['En çok yapılan 5 SEO hatası', 'listicle'],
  ["2026'da öne çıkan 10 SEO trendi", 'listicle'],
  ['E-ticaret sitesi kurmanın 5 yolu', 'listicle'],
  ['SEO nasıl öğrenilir', 'howto'],
  ['Sigorta poliçesi nasıl iptal edilir', 'howto'],
  ['Vergi dairesine nasıl başvurulur', 'howto'],
  ['Is web hosting worth it?', 'guide'],
  ['How much does a website cost', 'guide'],
  ['Wix vs Squarespace pricing', 'comparison'],
  ['Hangi muhasebe programı daha iyi?', 'guide'],
  ['Kripto para nasıl çalışır?', 'guide'],
  ['Kredi notu neden düşer, nasıl yükselir?', 'howto'],
  ['Mobil uygulama ücretleri', 'pricing'],
  ['Uygulama içi satın alma ücretleri nasıl iade edilir', 'howto'],
  ['Banka hesap işletim ücreti iadesi nasıl alınır', 'howto'],
  ['En iyi kredi kartı hangisi?', 'best_for'],
];

describe('classifyTopicTitle — inceleme yoklamasi (50 baslik)', () => {
  it('yoklama 50 baslik', () => expect(PROBES).toHaveLength(50));
  it.each(PROBES)('%s → %s', (title, expected) => {
    expect(classifyTopicTitle(title) ?? 'guide').toBe(expected);
  });
});
