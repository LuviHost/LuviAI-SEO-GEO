/**
 * Kurum karnesi soru bankasi — sektor basina 10 MARKASIZ Turkce musteri sorusu.
 *
 * NEDEN MARKASIZ: sorguda markanin adi gecince asistanin markayi anmasi
 * totolojiktir (bkz. audit/brand-in-query.ts). Karne "musteri sizi
 * istemeden bulur mu?" sorusunu olcer; bu yuzden hicbir soruda marka adi,
 * marka adiyla cakisan gunluk kelime (getir, param, garanti, ziraat, sok,
 * mavi, anadolu, vatan, divan...) veya "X alternatifleri" kalibi yoktur.
 * karne-html.spec.ts bunu containsBrand ile ornek marka listesine karsi
 * dogrular; yeni soru eklerken o listeye karsi da kontrol et.
 *
 * NEDEN ALT SEKTOR: banka ile sigorta sirketine ayni 10 soru sorulunca
 * karne "hic gorunmuyorsunuz" der ama sebep alan disi sorulardir. Alt
 * sektor eslesirse son 3 genel soru o alana ozel 3 soruyla degisir; ilk 7
 * sektor geneli kalir ki ayni sektordeki kurumlar karsilastirilabilsin.
 * Plan (Faz 1) finans alt sektorlerini "banka, odeme/e-para, sigorta,
 * leasing/faktoring" + KAP yatirim kuruluslari olarak sayar; hepsi burada
 * karsiliklidir. Eslesmeyen alt sektorde script sessizce genel sorulara
 * DUSMEZ, sert uyari verir (bkz. scripts/prospect-karne.ts).
 *
 * SAF modul: DB/LLM/ag yok.
 */
import { SEKTORLER, translit, type Sektor } from './prospect-utils.js';

/** Alt sektor anahtari — sorulariGetir bunlardan birine cozumler. */
export type AltSektorAnahtari =
  | 'banka' | 'odeme' | 'sigorta' | 'leasing' | 'yatirim'
  | 'eticaret' | 'perakende' | 'teknoloji'
  | 'havayolu' | 'otel' | 'telekom' | 'otomotiv';

/** Ilk 7'si sektor geneli (sabit), son 3'u alt sektorle degisebilen genel sorular. */
const TEMEL: Record<Sektor, string[]> = {
  finans: [
    'Yeni başlayan biri için Türkiye\'de hangi dijital bankayı önerirsin?',
    'Ücretsiz para transferi (EFT/FAST) yapabileceğim hesap seçenekleri neler?',
    'KOBİ\'ler için en uygun sanal POS ve komisyon oranları hangi kuruluşlarda?',
    'Yurt dışından ödeme almak için hangi ödeme kuruluşunu kullanmalıyım?',
    'Düşük faizli ihtiyaç kredisi için hangi bankalara bakmalıyım?',
    'Türkiye\'de güvenilir yatırım ve hisse alım-satım uygulamaları hangileri?',
    'Kredi kartı başvurusunda en avantajlı puan veya mil programı hangi bankada?',
    'Trafik ve kasko sigortası için hangi şirketi önerirsin, neye göre seçmeliyim?',
    'Bireysel emeklilik (BES) için hangi şirketi seçmeliyim?',
    'Öğrenciler için masrafsız banka hesabı ve kart hangi kuruluşta var?',
  ],
  'eticaret-perakende-teknoloji': [
    'Türkiye\'de online alışveriş için en güvenilir siteler hangileri?',
    'Hızlı market teslimatı için hangi uygulamayı kullanmalıyım?',
    'Telefon ve bilgisayar almak için hangi teknoloji mağazasını önerirsin?',
    'Yılın en iyi indirim ve kampanya dönemleri hangileri, nereden takip edilir?',
    'Online giyim alışverişinde iade süreci kolay olan siteler hangileri?',
    'Türkiye\'de ürün fiyatı karşılaştırmak için hangi siteleri kullanmalıyım?',
    'Beyaz eşya ve küçük ev aletlerinde hangi yerli markalar öne çıkıyor?',
    'Evden yemek siparişi için hangi uygulama daha iyi?',
    'Süpermarket alışverişini online yapmak için hangi zincirin uygulaması iyi?',
    'Kurumsal laptop ve yazılım lisansı alımı için hangi tedarikçiler güvenilir?',
  ],
  'turizm-havayolu-telekom-otomotiv': [
    'İstanbul–Londra uçuşu için hangi havayolunu önerirsin?',
    'Yurt dışında internet kullanmak için hangi operatörün paketleri uygun?',
    'Aile için güvenli ve ekonomik bir SUV alacağım; hangi markalara bakmalıyım?',
    'Antalya\'da her şey dahil 5 yıldızlı otel önerir misin?',
    'Türkiye\'de ev interneti (fiber) için hangi sağlayıcı daha iyi?',
    'Yeni telefon hattı alırken hangi operatörün öğrenci tarifesi avantajlı?',
    'İkinci el araba alırken hangi siteleri ve markaları tercih etmeliyim?',
    'Kapadokya için otel ve tur nereden ayarlanır?',
    'Yurt içi uçak bileti en ucuza nereden alınır?',
    'Elektrikli araba almak istiyorum; Türkiye\'de hangi modeller ve şarj altyapısı uygun?',
  ],
};

/** Alt sektor eslesince TEMEL'in son 3 sorusunun yerine gecen 3 soru. */
const OZEL: Record<AltSektorAnahtari, string[]> = {
  banka: [
    'Vadeli mevduat faizi en yüksek olan bankalar hangileri?',
    'Konut kredisi için hangi bankalar daha uygun koşullar sunuyor?',
    'Mobil bankacılık uygulaması en iyi olan bankalar hangileri?',
  ],
  odeme: [
    'Küçük bir e-ticaret sitesi için sanal POS entegrasyonu en kolay ödeme sağlayıcısı hangisi?',
    'Türkiye\'de ön ödemeli kart ve e-cüzdan seçenekleri neler, hangisini önerirsin?',
    'Pazaryerinde satış yapanlar için link ile tahsilat ve ödeme altyapısı hangi kuruluşlarda var?',
  ],
  sigorta: [
    'Tamamlayıcı sağlık sigortası için hangi şirketleri karşılaştırmalıyım?',
    'Kasko fiyatı en uygun sigorta şirketleri hangileri?',
    'Seyahat sağlık sigortasını nereden yaptırmalıyım?',
  ],
  // NEDEN B2B: leasing/faktoring/finansman musterisi bireysel degil isletmedir;
  // "dijital banka" veya "ogrenci hesabi" sorusu bu kuruma alan disi kalir.
  leasing: [
    'KOBİ için iş makinesi ve ekipman leasing\'i hangi şirketlerde daha uygun koşullarla yapılır?',
    'Alacaklarımı vadesinden önce nakde çevirmek için hangi faktoring şirketine başvurmalıyım?',
    'Sıfır araç alımında bankaya alternatif taşıt finansmanı hangi finansman şirketlerinde var?',
  ],
  yatirim: [
    'Hisse senedi ve halka arz işlemleri için hangi aracı kurumu önerirsin?',
    'Portföy yönetimi ve yatırım fonu için hangi kuruluşlara bakmalıyım?',
    'Yurt dışı borsalarda işlem yapmak için komisyonu düşük aracı kurum hangisi?',
  ],
  eticaret: [
    'İkinci el ürün alıp satmak için güvenilir platformlar hangileri?',
    'Kozmetik ve kişisel bakım ürünleri için hangi online mağazayı önerirsin?',
    'Online alışverişte taksit ve kapıda ödeme sunan siteler hangileri?',
  ],
  perakende: [
    'Ev tekstili ve mobilya için hangi mağaza zincirini önerirsin?',
    'Uygun fiyatlı gıda ve temizlik ürünleri için hangi indirim marketi tercih edilmeli?',
    'Çocuk giyim ve oyuncakta hangi mağazalar güvenilir?',
  ],
  teknoloji: [
    'Türkiye\'de kurumsal bulut ve sunucu hizmeti veren firmalar hangileri?',
    'KOBİ\'ler için muhasebe ve ERP yazılımı önerir misin?',
    'Oyun bilgisayarı toplamak için parçaları nereden almalıyım?',
  ],
  havayolu: [
    'Avrupa\'ya ekonomik uçuş için hangi havayolu şirketi tercih edilmeli?',
    'Bagaj hakkı ve gecikme tazminatında müşteri memnuniyeti yüksek havayolları hangileri?',
    'Sık uçanlar için mil programı en avantajlı hangi havayolunda?',
  ],
  otel: [
    'Bodrum\'da balayı için butik otel önerir misin?',
    'İstanbul\'da iş seyahati için merkezi ve uygun fiyatlı oteller hangileri?',
    'Kayak tatili için Uludağ veya Erciyes\'te hangi otelde kalınmalı?',
  ],
  telekom: [
    'Kurumsal hat ve filo için hangi operatörün paketleri uygun?',
    'Türkiye\'de 5G kapsaması en iyi operatör hangisi?',
    'Numara taşırken hangi operatör daha iyi kampanya sunuyor?',
  ],
  otomotiv: [
    'Türkiye\'de üretilen otomobil markaları hangileri, hangisi tavsiye edilir?',
    'Şehir içi kullanım için hibrit bir hatchback önerir misin?',
    'Uzun dönem araç kiralama için hangi firmayı önerirsin?',
  ],
};

/**
 * Alt sektor metnini anahtara cozumler. Eslesme sirasi onemli: "dijital-banka"
 * ve "odeme-epara" gibi tohum CSV degerleri anahtar kelime iceren serbest
 * metindir; sektor disi anahtar (finans kurumuna "otel") kabul edilmez.
 * Finans'ta "yatirim bankasi" → yatirim, "katilim bankasi" → banka: bu yuzden
 * banka en sona konur. "finansal kiralama" → leasing ("finans" tek basina
 * eslesmez; kelime "finansman"/"kiralama"dir).
 */
const ALT_KURALLAR: Record<Sektor, Array<[AltSektorAnahtari, string[]]>> = {
  finans: [
    ['sigorta', ['sigorta', 'reasurans', 'emeklilik', 'bes']],
    ['odeme', ['odeme', 'epara', 'e para', 'fintech', 'pos', 'cuzdan']],
    ['leasing', ['leasing', 'faktoring', 'factoring', 'finansman', 'kiralama']],
    // NEDEN 'menkul kiymet': yalin 'menkul', 'gayrimenkul'un icinde gecip GYO'yu yatirima dusuruyordu.
    ['yatirim', ['yatirim', 'araci kurum', 'portfoy', 'menkul kiymet', 'borsa']],
    ['banka', ['banka', 'bank', 'katilim']],
  ],
  'eticaret-perakende-teknoloji': [
    ['eticaret', ['eticaret', 'e ticaret', 'pazaryeri', 'pazar yeri', 'online', 'marketplace']],
    ['perakende', ['perakende', 'market', 'magaza', 'giyim', 'moda', 'zincir']],
    ['teknoloji', ['teknoloji', 'yazilim', 'bilisim', 'elektronik', 'donanim', 'saas']],
  ],
  'turizm-havayolu-telekom-otomotiv': [
    ['havayolu', ['havayolu', 'hava yolu', 'ucus', 'airline', 'havacilik']],
    ['otel', ['otel', 'turizm', 'tatil', 'konaklama', 'seyahat', 'acente']],
    ['telekom', ['telekom', 'operator', 'gsm', 'internet', 'iletisim']],
    ['otomotiv', ['otomotiv', 'oto', 'arac', 'bayi', 'distributor', 'otomobil']],
  ],
};

export function sektorDogrula(sektor: string): Sektor {
  if ((SEKTORLER as readonly string[]).includes(sektor)) return sektor as Sektor;
  throw new Error(`Bilinmeyen sektör "${sektor}". Geçerli: ${SEKTORLER.join(' | ')}`);
}

/** Serbest alt sektor metni → anahtar; eslesme yoksa null (cagiran uyarmali). */
export function altsektorAnahtari(sektor: string, altsektor?: string | null): AltSektorAnahtari | null {
  const s = sektorDogrula(sektor);
  const metin = translit(altsektor ?? '');
  if (!metin) return null;
  for (const [anahtar, kelimeler] of ALT_KURALLAR[s]) {
    if (kelimeler.some((k) => metin.includes(k))) return anahtar;
  }
  return null;
}

/** Bir sektorde gecerli alt sektor anahtarlari (uyari/yardim metni icin). */
export function sektorAltAnahtarlari(sektor: string): AltSektorAnahtari[] {
  return ALT_KURALLAR[sektorDogrula(sektor)].map(([anahtar]) => anahtar);
}

/**
 * Sektor (ve varsa alt sektor) icin 10 markasiz soru.
 * Alt sektor eslesirse son 3 genel soru alana ozel 3 soruyla degisir.
 */
export function sorulariGetir(sektor: string, altsektor?: string | null): string[] {
  const s = sektorDogrula(sektor);
  const temel = TEMEL[s];
  const anahtar = altsektorAnahtari(s, altsektor);
  if (!anahtar) return [...temel];
  return [...temel.slice(0, temel.length - 3), ...OZEL[anahtar]];
}

/** Spec ve denetim icin: tum sorular (sektor geneli + alt sektor ozel), tekil. */
export function tumSorular(): string[] {
  const hepsi = [...Object.values(TEMEL).flat(), ...Object.values(OZEL).flat()];
  return [...new Set(hepsi)];
}

export const ALT_SEKTOR_ANAHTARLARI = Object.keys(OZEL) as AltSektorAnahtari[];
