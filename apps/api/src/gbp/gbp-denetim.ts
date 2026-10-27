/**
 * Google Isletme Profili denetimi — saf kurallar (ag yok). Girdi: Places API (New) "Place Details" yaniti +
 * istege bagli sitenin kendi NAP'i ve alan adi. Cikti: 0-100 puan + maddeler (ne eksik, neden onemli, ne yapilir).
 *
 * NEDEN bu maddeler: yerel aramada (Haritalar paketi) ve AI asistanlarinin yerel onerilerinde Google'in kendi
 * belirttigi siralama etkenleri ilgililik, mesafe ve one cikmadir; profil bilgisinin eksiksiz ve dogru olmasi,
 * yorum sayisi/puani ve tutarli iletisim bilgisi bu etkenlere dogrudan girer
 * (https://support.google.com/business/answer/7091). Sitedeki adres/telefonla celisen profil hem musteriyi
 * yanlis yere gonderir hem de AI cevabinda yanlis bilgi riskidir (bkz. audit/local-nap.ts).
 *
 * VERI KURALI: Places icerigi (puan, saatler...) veritabanina YAZILMAZ — Google Maps Platform kosullari yalniz
 * place_id'nin saklanmasina izin verir. Bu modul yalniz anlik hesaplar; sonuc istemciye gider, kalici tutulmaz.
 */
import { comparePhone, compareAddress, type AnswerNapSignal, type NapAddress, type SiteNap } from '../audit/local-nap.js';
import { normalizeTrPhone } from '../audit/tr-phone.js';

/** Places API (New) yanitinin denetimde kullanilan alt kumesi */
export interface PlaceDetay {
  id: string;
  displayName?: { text?: string; languageCode?: string };
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
  types?: string[];
  businessStatus?: 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY' | string;
  googleMapsUri?: string;
  formattedAddress?: string;
  addressComponents?: Array<{ longText?: string; shortText?: string; types?: string[] }>;
  rating?: number;
  userRatingCount?: number;
  regularOpeningHours?: { weekdayDescriptions?: string[]; periods?: unknown[] };
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  photos?: unknown[];
}

export type MaddeDurum = 'iyi' | 'uyari' | 'eksik' | 'bilgi';

export interface DenetimMaddesi {
  kod: string;
  baslik: string;
  durum: MaddeDurum;
  /** Ne goruldu (kisa, sayili) */
  bulgu: string;
  /** Ne yapilmali (eylem) — durum 'iyi' ise bos */
  oneri: string;
  /** Puandaki agirlik (toplam 100) */
  agirlik: number;
  /** 0..1 — bu maddeden alinan pay */
  skor: number;
}

export interface DenetimSonucu {
  puan: number;
  maddeler: DenetimMaddesi[];
  /** Kart basligi icin — Places'ten anlik; SAKLANMAZ */
  ozet: { ad: string; adres: string; mapsUri: string; puanOrt: number | null; yorumSayisi: number; kategori: string };
}

/** Genel (belirsiz) Google turleri — birincil kategori bunlardan biriyse "kategori zayif" */
const GENEL_TURLER = new Set(['establishment', 'point_of_interest', 'store', 'food', 'health', 'finance', 'premise', 'local_government_office']);

/**
 * Ad politikasi sezgisi: isletme adina eklenen slogan/sehir/hizmet/iletisim bilgisi Google'in ad kuralina aykiri
 * ve askiya alma sebebi (https://support.google.com/business/answer/3038177). Kesin hukum DEGIL — yalniz uyari.
 */
const AD_IHLAL_IPUCU: Array<[RegExp, string]> = [
  [/[|•–—]| - /u, 'ayırıcı işaret (| • –)'],
  [/\b(en iyi|en ucuz|ucuz|indirim|kampanya|7\/24|724|7 24)\b/iu, 'slogan/kampanya kelimesi'],
  [/(\+?90|0)\s?\d{3}\s?\d{3}\s?\d{2}\s?\d{2}|www\.|\.com/iu, 'telefon ya da web adresi'],
];

// NEDEN lookaround: JS \b yalniz ASCII harfi sinir sayar ("Şişli", "Diyarbakır" kacardi); /i de İ→i katlamaz,
// bu yuzden ad once tr kucultulur ve Unicode harf disi sinir aranir.
const TR_YER = /(?<![\p{L}\d])(istanbul|ankara|izmir|bursa|antalya|adana|konya|gaziantep|kayseri|mersin|eskişehir|samsun|kocaeli|trabzon|denizli|diyarbakır|şanlıurfa|malatya|sakarya|tekirdağ|muğla|aydın|manisa|balıkesir|hatay|kadıköy|beşiktaş|şişli|osmangazi|nilüfer|çankaya|karşıyaka|bornova)(?![\p{L}\d])/u;

function alanAdi(u: string | undefined | null): string | null {
  if (!u) return null;
  try {
    return new URL(u.startsWith('http') ? u : `https://${u}`).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/** Places adres bilesenlerinden il/ilce (Turkiye: administrative_area_level_1 = il, level_2 = ilce) */
export function placeAdresi(p: PlaceDetay): NapAddress {
  const bul = (tur: string) => p.addressComponents?.find((c) => c.types?.includes(tur))?.longText ?? null;
  return {
    street: bul('route'),
    district: bul('administrative_area_level_2') ?? bul('sublocality_level_1') ?? bul('locality'),
    city: bul('administrative_area_level_1'),
    postalCode: bul('postal_code'),
  };
}

const madde = (m: Omit<DenetimMaddesi, 'skor'> & { skor?: number }): DenetimMaddesi => ({
  ...m,
  skor: m.skor ?? (m.durum === 'iyi' ? 1 : m.durum === 'uyari' ? 0.5 : m.durum === 'bilgi' ? 1 : 0),
});

export function profilDenetle(p: PlaceDetay, ctx: { siteHost?: string | null; siteNap?: SiteNap | null } = {}): DenetimSonucu {
  const m: DenetimMaddesi[] = [];
  const ad = p.displayName?.text?.trim() ?? '';

  // 1) Isletme durumu
  const durum = p.businessStatus ?? 'OPERATIONAL';
  m.push(madde({
    kod: 'durum', baslik: 'İşletme durumu', agirlik: 8,
    durum: durum === 'OPERATIONAL' ? 'iyi' : 'eksik',
    bulgu: durum === 'OPERATIONAL' ? 'Açık görünüyor' : durum === 'CLOSED_TEMPORARILY' ? 'Geçici olarak kapalı görünüyor' : 'Kalıcı olarak kapalı görünüyor',
    oneri: durum === 'OPERATIONAL' ? '' : 'İşletme açıksa Google İşletme Profili’nde durumu "Açık" olarak güncelleyin; kapalı görünen işletme önerilmez.',
  }));

  // 2) Birincil kategori
  const kat = p.primaryType ?? '';
  const katAd = p.primaryTypeDisplayName?.text ?? kat;
  m.push(madde({
    kod: 'kategori', baslik: 'Birincil kategori', agirlik: 12,
    durum: !kat ? 'eksik' : GENEL_TURLER.has(kat) ? 'uyari' : 'iyi',
    bulgu: kat ? `"${katAd}"` : 'Birincil kategori yok',
    oneri: !kat || GENEL_TURLER.has(kat)
      ? 'Ana hizmetinizi en dar tanımlayan kategoriyi birincil seçin (ör. "Diş kliniği", "Kafe"); genel kategori aramalarda eşleşmeyi zayıflatır. Ek kategorilerle diğer hizmetleri ekleyin.'
      : '',
  }));

  // 3) Calisma saatleri
  const saat = p.regularOpeningHours?.weekdayDescriptions?.length ?? 0;
  m.push(madde({
    kod: 'saatler', baslik: 'Çalışma saatleri', agirlik: 10,
    durum: saat >= 7 ? 'iyi' : saat > 0 ? 'uyari' : 'eksik',
    bulgu: saat ? `${saat} günün saati girilmiş` : 'Çalışma saati yok',
    oneri: saat >= 7 ? '' : 'Haftanın her günü için saat girin (kapalı günleri "Kapalı" olarak). Saatsiz işletme "şimdi açık" aramalarında çıkmaz; bayram/özel gün saatlerini de ekleyin.',
  }));

  // 4) Web sitesi + sitenin kendisi mi
  const webHost = alanAdi(p.websiteUri);
  const siteHost = ctx.siteHost?.replace(/^www\./, '').toLowerCase() ?? null;
  const webUyumlu = !!webHost && (!siteHost || webHost === siteHost || webHost.endsWith(`.${siteHost}`) || siteHost.endsWith(`.${webHost}`));
  m.push(madde({
    kod: 'web', baslik: 'Web sitesi bağlantısı', agirlik: 10,
    durum: !webHost ? 'eksik' : webUyumlu ? 'iyi' : 'uyari',
    bulgu: !webHost ? 'Profilde web sitesi yok' : webUyumlu ? webHost : `Profil ${webHost} adresini gösteriyor, siteniz ${siteHost}`,
    oneri: !webHost ? 'Profile web sitenizi ekleyin; site ile profil birbirini doğrular.' : webUyumlu ? '' : 'Profildeki web sitesi alanını kendi sitenizle güncelleyin.',
  }));

  // 5) Telefon + sitedeki telefonla tutarlilik
  const tel = normalizeTrPhone(p.internationalPhoneNumber ?? p.nationalPhoneNumber ?? '');
  const siteTel = ctx.siteNap?.phones ?? [];
  // Profil, local-nap'in "cevap" tarafinin yerine gecer: ayni karsilastirma kurallari (E.164, il/ilce)
  const profilSinyal: AnswerNapSignal = { nearPhones: tel ? [tel] : [], allPhones: tel ? [tel] : [], address: p.formattedAddress ?? null };
  const telDurum = tel && siteTel.length ? comparePhone(siteTel, profilSinyal).status : null;
  const telKarsi = telDurum === 'eslesiyor' ? 'match' : telDurum === 'farkli' ? 'mismatch' : null;
  m.push(madde({
    kod: 'telefon', baslik: 'Telefon ve tutarlılık', agirlik: 10,
    durum: !tel ? 'eksik' : telKarsi === 'mismatch' ? 'uyari' : 'iyi',
    bulgu: !tel ? 'Profilde telefon yok' : telKarsi === 'mismatch' ? 'Profildeki telefon sitedekiyle farklı' : telKarsi === 'match' ? 'Profil ve site aynı telefonu gösteriyor' : 'Telefon var (sitede karşılaştırılacak telefon bulunamadı)',
    oneri: !tel ? 'Profile ulaşılabilir bir telefon ekleyin.' : telKarsi === 'mismatch' ? 'Sitedeki ve profildeki telefonu aynı yapın; farklı numara AI asistanlarının yanlış numara vermesine yol açabilir.' : '',
  }));

  // 6) Adres il/ilce tutarliligi (sokak karsilastirilmaz — bkz. local-nap.ts)
  const padr = placeAdresi(p);
  const siteAdr = ctx.siteNap?.addresses ?? [];
  const adrDurum = siteAdr.length && p.formattedAddress ? compareAddress(siteAdr, profilSinyal).status : null;
  const adrKarsi = adrDurum === 'eslesiyor' || adrDurum === 'kismen' ? 'match' : adrDurum === 'eslesmiyor' ? 'mismatch' : null;
  m.push(madde({
    kod: 'adres', baslik: 'Adres tutarlılığı', agirlik: 8,
    durum: adrKarsi === 'mismatch' ? 'uyari' : adrKarsi === 'match' ? 'iyi' : 'bilgi',
    bulgu: adrKarsi === 'mismatch' ? `Profil ${[padr.district, padr.city].filter(Boolean).join(', ')} diyor; sitedeki adres farklı il/ilçede`
      : adrKarsi === 'match' ? 'Profil ve site aynı il/ilçeyi gösteriyor'
        : `${[padr.district, padr.city].filter(Boolean).join(', ') || 'Adres'} (sitede karşılaştırılacak adres yok)`,
    oneri: adrKarsi === 'mismatch' ? 'Sitedeki adresi (LocalBusiness şeması dahil) profille aynı il/ilçeye getirin.'
      : adrKarsi === 'match' ? '' : 'Sitenize LocalBusiness şemasıyla adres ve telefon ekleyin; profil ile site birbirini doğrulasın.',
    skor: adrKarsi === 'mismatch' ? 0.3 : adrKarsi === 'match' ? 1 : 0.6,
  }));

  // 7) Yorum sayisi
  const yorum = p.userRatingCount ?? 0;
  m.push(madde({
    kod: 'yorum-sayisi', baslik: 'Yorum sayısı', agirlik: 15,
    durum: yorum >= 50 ? 'iyi' : yorum >= 10 ? 'uyari' : 'eksik',
    bulgu: `${yorum} yorum`,
    oneri: yorum >= 50 ? '' : 'Hizmet verdiğiniz HER müşteriye aynı yorum bağlantısını/QR kodunu iletin. Yalnız memnun müşteriden yorum istemek, indirim karşılığı yorum ve personel kotası Google kuralına aykırıdır.',
    skor: Math.min(1, yorum / 50),
  }));

  // 8) Ortalama puan
  const puan = typeof p.rating === 'number' ? p.rating : null;
  m.push(madde({
    kod: 'puan', baslik: 'Ortalama puan', agirlik: 12,
    durum: puan === null ? 'eksik' : puan >= 4.5 ? 'iyi' : puan >= 4 ? 'uyari' : 'eksik',
    bulgu: puan === null ? 'Henüz puan yok' : `${puan.toFixed(1)} / 5`,
    oneri: puan !== null && puan >= 4.5 ? '' : 'Olumsuz yorumlara kısa, çözüm odaklı ve kişisel bilgi içermeyen yanıt verin; yanıtlanan şikâyet yeni müşteride güven oluşturur.',
    skor: puan === null ? 0 : Math.max(0, Math.min(1, (puan - 3.5) / 1.3)),
  }));

  // 9) Fotograf (Places en fazla 10 fotograf referansi dondurur)
  const foto = p.photos?.length ?? 0;
  m.push(madde({
    kod: 'fotograf', baslik: 'Fotoğraflar', agirlik: 8,
    durum: foto >= 10 ? 'iyi' : foto >= 3 ? 'uyari' : 'eksik',
    bulgu: foto >= 10 ? '10+ fotoğraf' : `${foto} fotoğraf`,
    oneri: foto >= 10 ? '' : 'Dış cephe, iç mekân, ekip ve ürün/hizmet fotoğrafları ekleyin; düzenli yeni fotoğraf profili güncel gösterir.',
    skor: Math.min(1, foto / 10),
  }));

  // 10) Ad politikasi
  const ihlaller = AD_IHLAL_IPUCU.filter(([re]) => re.test(ad)).map(([, n]) => n);
  if (TR_YER.test(ad.toLocaleLowerCase('tr-TR')) && ad.split(/\s+/).length > 2) ihlaller.push('şehir/semt adı');
  m.push(madde({
    kod: 'ad', baslik: 'İşletme adı kuralı', agirlik: 7,
    durum: ihlaller.length ? 'uyari' : 'iyi',
    bulgu: ihlaller.length ? `"${ad}" — olası ek: ${ihlaller.join(', ')}` : `"${ad}"`,
    oneri: ihlaller.length ? 'Ad, tabelanızdaki gerçek işletme adı olmalı. Şehir, hizmet, slogan veya iletişim bilgisi eklemek Google kuralına aykırıdır ve profili askıya aldırabilir. Bu bir uyarıdır; adınız resmi olarak böyleyse sorun yoktur.' : '',
  }));

  const toplamAgirlik = m.reduce((a, x) => a + x.agirlik, 0);
  const puanSonuc = Math.round((m.reduce((a, x) => a + x.agirlik * x.skor, 0) / toplamAgirlik) * 100);

  return {
    puan: puanSonuc,
    maddeler: m,
    ozet: {
      ad,
      adres: p.formattedAddress ?? '',
      mapsUri: p.googleMapsUri ?? '',
      puanOrt: puan,
      yorumSayisi: yorum,
      kategori: katAd,
    },
  };
}
