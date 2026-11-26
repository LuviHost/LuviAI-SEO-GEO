/**
 * Claude ile LinkedIn gonderimi — saf kurallar (26.11.2026).
 *
 * Akis: panel listeyi gosterir → kurucu "Claude ile gönder"e basar (= bu kisiler ve bu notlar icin
 * onay) → sunucu is kaydi acar → kurucunun Mac'indeki ajan isi alir, her kisi icin Claude Code'u
 * Chrome baglantisiyla calistirir → sonucu kisi kisi geri yazar.
 *
 * Komut metni (prompt) SUNUCUDA uretilir: LinkedIn arayuzu degisince ya da kural eklenince Mac'teki
 * ajani guncellemek gerekmesin.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { istanbulParts } from './linkedin-outreach-rules.js';

export const IS_DURUMLARI = ['BEKLIYOR', 'CALISIYOR', 'BITTI', 'HATA', 'IPTAL'] as const;
export type IsDurumu = (typeof IS_DURUMLARI)[number];

/** Ajanin kisi basina dondurdugu sonuc */
export const KISI_SONUCLARI = ['GONDERILDI', 'KURU_TAMAM', 'ZATEN_BAGLI', 'BEKLIYOR', 'BULUNAMADI', 'EPOSTA_ISTIYOR', 'KABUL_TAMAM', 'ENGEL', 'HATA'] as const;
export type KisiSonucu = (typeof KISI_SONUCLARI)[number];

/** Tek iste en fazla kisi (bir tur ~2-6 dk arayla; 10 kisi ~1 saat) */
export const IS_KISI_TAVANI = 10;
/** CALISIYOR kalan is bu sureden sonra HATA sayilir (Mac uyudu / ajan coktu) */
export const IS_ZAMAN_ASIMI_MS = 3 * 60 * 60_000;
/** Ajan bu kadar suredir sormadiysa panel "Mac servisi kapali" der */
export const AJAN_CANLI_MS = 3 * 60_000;
/**
 * Is surerken ajan yalniz sonuc yazarken haber verir: kisiler arasi 2-6 dk bekleme + kisi basi en fazla
 * 8 dk calisma. 3 dk sinir bu arada "kapali" gosteriyordu (26.11 ilk gercek tur) → is surerken 15 dk.
 */
export const AJAN_CANLI_IS_SURERKEN_MS = 15 * 60_000;

export function ajanCanli(sonGorulme: Date | null, isSuruyor: boolean, simdi: Date = new Date()): boolean {
  if (!sonGorulme) return false;
  return simdi.getTime() - sonGorulme.getTime() < (isSuruyor ? AJAN_CANLI_IS_SURERKEN_MS : AJAN_CANLI_MS);
}

export function kisiSonucuGecerli(x: unknown): x is KisiSonucu {
  return typeof x === 'string' && (KISI_SONUCLARI as readonly string[]).includes(x);
}

/**
 * Teknik rol mu (CTO, yazilim, muhendis...). Satis/pazarlama hedefinde bu kisiler aday
 * listesinde gosterilmez (26.11 sahip: "pazarlama, satis, reklam tarafindaki kisiler lazim").
 * Kayit silinmez; eski kuyruktaki teknik kisiler yalniz listeye girmez.
 */
export function teknikUnvanMi(unvan: string | null | undefined): boolean {
  const u = (unvan ?? '').toLocaleLowerCase('tr');
  if (!u) return false;
  // Pazarlama/satis gecen unvan teknik sayilmaz ("satis ve pazarlama direktoru, yazilim" gibi)
  if (/pazarlama|marketing|satış|satis|sales|marka|brand|e-?ticaret|e-?commerce|growth|reklam|iletişim|cmo/.test(u)) return false;
  return /\bcto\b|chief technology|yazılım|software|developer|geliştirici|engineer|mühendis|teknoloji direktörü|it müdürü|\bit\b|devops|architect|mimar|data scientist|veri bilim/.test(u);
}

// ── Ajan anahtari ──────────────────────────────────────────────
// Anahtar panelde bir kez gosterilir, sunucuda yalniz SHA-256 ozeti durur.

export function yeniAnahtar(): string {
  return `lca_${randomBytes(24).toString('base64url')}`;
}

export function anahtarOzeti(anahtar: string): string {
  return createHash('sha256').update(anahtar, 'utf8').digest('hex');
}

export function anahtarDogru(kayitliOzet: string | null | undefined, gelen: string | null | undefined): boolean {
  if (!kayitliOzet || !gelen || typeof gelen !== 'string' || gelen.length > 200) return false;
  const a = Buffer.from(kayitliOzet, 'hex');
  const b = Buffer.from(anahtarOzeti(gelen), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Kayit guncellemesi ─────────────────────────────────────────

export interface ProspectGuncelleme {
  status?: 'REQUESTED' | 'ACCEPTED' | 'FAILED';
  requestedAt?: Date;
  acceptedAt?: Date;
  noteText?: string;
  lastError?: string | null;
}

/**
 * Kisi sonucunun linkedin_prospects kaydina etkisi. null = kayda dokunma.
 * Kuru turda HIC yazilmaz (kayit kuyrukta kalir). HATA/ENGEL kaydi kuyrukta birakir ama
 * lastError yazar (aday listesinde sona duser, ayni kisi hemen tekrar denenmez).
 */
export function prospectGuncellemesi(sonuc: KisiSonucu, kuru: boolean, not: string, aciklama: string, simdi: Date): ProspectGuncelleme | null {
  if (kuru) return null;
  const neden = `Claude: ${aciklama}`.slice(0, 500);
  switch (sonuc) {
    case 'GONDERILDI': return { status: 'REQUESTED', requestedAt: simdi, noteText: not, lastError: null };
    // Zaten bekleyen davet: tarihini bilmiyoruz; kabul kontrolu icin REQUESTED yeterli
    case 'BEKLIYOR': return { status: 'REQUESTED', requestedAt: simdi, lastError: null };
    case 'ZATEN_BAGLI': return { status: 'ACCEPTED', acceptedAt: simdi, lastError: null };
    case 'BULUNAMADI': return { status: 'FAILED', lastError: neden };
    // Kisi davetleri yalniz e-postasini bilenlerden kabul ediyor: tekrar denemek anlamsiz
    case 'EPOSTA_ISTIYOR': return { status: 'FAILED', lastError: neden };
    case 'ENGEL':
    case 'HATA': return { lastError: neden };
    case 'KURU_TAMAM':
    case 'KABUL_TAMAM': return null;
  }
}

/** Ajan ciktisindan son {"durum": ...} JSON'unu cikarir */
export function sonucuAyikla(metin: string): { durum: KisiSonucu; aciklama: string } | null {
  if (typeof metin !== 'string') return null;
  const adaylar = metin.match(/\{[^{}]*"durum"[^{}]*\}/g);
  if (!adaylar) return null;
  for (let i = adaylar.length - 1; i >= 0; i--) {
    try {
      const j = JSON.parse(adaylar[i]);
      if (kisiSonucuGecerli(j?.durum)) return { durum: j.durum, aciklama: String(j.aciklama ?? '').slice(0, 300) };
    } catch { /* sonraki aday */ }
  }
  return null;
}

// ── Komut metni ────────────────────────────────────────────────

export interface AjanKisi {
  ad: string;
  soyad: string;
  firma: string;
  unvan: string | null;
  profileUrl: string;
  not: string;
}

export function ajanKomutu(k: AjanKisi, kuru: boolean): string {
  const adSoyad = `${k.ad} ${k.soyad}`.trim();
  const son = kuru
    ? `KURU DENEME: "Gönder" (Send) düğmesine BASMA. Not yazılı hâlde pencerenin ekran görüntüsünü al, sonra pencereyi "Vazgeç"/X ile kapat → durum "KURU_TAMAM".`
    : `"Gönder" (Send) düğmesine bas. Ardından profilde düğmenin "Bekliyor" (Pending) olduğunu doğrula → durum "GONDERILDI". Doğrulayamazsan → "HATA".`;
  return [
    `Sen RanksUp kurucusu Emir Burgazlı'nın LinkedIn bağlantı isteği asistanısın. Emir bu kişiyi ve aşağıdaki notu RanksUp yönetim panelinde inceleyip "Claude ile gönder" düğmesine basarak onayladı. Yalnız bu kişi için, yalnız bu notla bağlantı isteği gönder.`,
    ``,
    `Kişi: ${adSoyad}${k.unvan ? ` — ${k.unvan}` : ''} (${k.firma})`,
    `Profil: ${k.profileUrl}`,
    `Not (300 karakter sınırı içinde, AYNEN yazılacak, tek karakter değiştirme):`,
    `<<<`,
    k.not,
    `>>>`,
    ``,
    `Adımlar:`,
    `1. Chrome araçlarını yükle, tabs_context ile sekmeleri al, YENİ bir sekme aç ve profili orada aç. Kullanıcının mevcut sekmelerine dokunma.`,
    `2. Profilin üst kartındaki ad "${adSoyad}" ile uyuşmalı (Türkçe karakter / büyük-küçük harf farkı olabilir). Uyuşmuyorsa ya da sayfa bulunamadıysa hiçbir şeye tıklama → "BULUNAMADI".`,
    `3. Kişi zaten 1. derece bağlantıysa (üst kartta "Bağlantı kur" yok, ana düğme "Mesaj") hiçbir şeye tıklama → "ZATEN_BAGLI".`,
    `4. Üst kartta "Bekliyor" (Pending) görünüyorsa tıklama → "BEKLIYOR".`,
    `5. "Bağlantı kur" (Connect) üst kartta yoksa üst karttaki "Daha fazla" (More) menüsüne bak. YALNIZ bu kişinin üst kartındaki düğmeyi kullan; yan paneldeki "Diğer kişiler" vb. önerilere asla tıklama.`,
    `6. LinkedIn davet için kişinin e-posta adresini isterse ("tanıdığınızı doğrulamak için e-posta adresini girin") hiçbir şey yazma, pencereyi kapat → "EPOSTA_ISTIYOR". Bu ENGEL değildir.`,
    `7. Açılan pencerede "Not ekle" (Add a note) seç, notu aynen yaz. Not alanı yoksa ya da LinkedIn not eklemeye izin vermiyorsa (aylık not sınırı vb.) notsuz GÖNDERME → "HATA", açıklamaya nedenini yaz.`,
    `8. ${son}`,
    ``,
    `Durma kuralları:`,
    `- Haftalık davet sınırı, "çok fazla istek", güvenlik doğrulaması, captcha, giriş ekranı ya da hesap kısıtlaması uyarısı görürsen hiçbir şeye tıklamadan dur → "ENGEL".`,
    `- LinkedIn oturumu açık değilse giriş yapmaya çalışma, parola girme → "ENGEL".`,
    `- Başka hiçbir kişiye istek ya da mesaj gönderme, hiçbir ayarı değiştirme, başka sayfaya gitme.`,
    `- İş bitince yalnız kendi açtığın sekmeyi kapat.`,
    ``,
    `Cevabının SON satırı yalnız şu JSON olsun (başka metin yok):`,
    `{"durum":"GONDERILDI|KURU_TAMAM|ZATEN_BAGLI|BEKLIYOR|BULUNAMADI|EPOSTA_ISTIYOR|ENGEL|HATA","aciklama":"kısa Türkçe açıklama"}`,
  ].join('\n');
}

/**
 * Ust uste 2 kisi e-posta istediyse tek tek kisi ayari degil, hesap duzeyinde uyari olabilir
 * (cok sayida kabul edilmemis davet sonrasi LinkedIn her davette e-posta ister) → is durur.
 * `onceki`: bu isteki sonuclar, zaman sirasiyla (bu kisi haric).
 */
export function epostaSerisiEngelMi(onceki: Array<{ durum: string }>, simdiki: KisiSonucu): boolean {
  return simdiki === 'EPOSTA_ISTIYOR' && onceki.length > 0 && onceki[onceki.length - 1].durum === 'EPOSTA_ISTIYOR';
}

// ── Kabul kontrolu (26.11.2026) ────────────────────────────────
// Profillere tek tek girilmez: tek sayfa (Bağlantılar, "Son eklenenler") okunur, istek
// gonderilmis kisilerle eslestirilir. Salt okuma; bildirim sayfasi acilmaz (bildirimleri okundu yapar).

/** Hafta ici Istanbul saatiyle kontrol saatleri */
export const KABUL_SAATLERI = [10, 14, 17] as const;
/** Tek kontrolde bakilan en fazla kisi (komut boyu) */
export const KABUL_KISI_TAVANI = 150;

/** Bugunun simdiye kadar gelmis en son kontrol saati (UTC an); hafta sonu / ilk saatten once null */
export function sonKabulSlotu(simdi: Date): Date | null {
  const { weekday, hour, ymd } = istanbulParts(simdi);
  if (weekday === 0 || weekday === 6) return null;
  const gecmis = KABUL_SAATLERI.filter((h) => h <= hour);
  if (gecmis.length === 0) return null;
  const h = gecmis[gecmis.length - 1];
  return new Date(`${ymd}T${String(h).padStart(2, '0')}:00:00+03:00`);
}

export interface KabulKisi { no: number; adSoyad: string; profileUrl: string }

export function kabulKomutu(liste: KabulKisi[]): string {
  return [
    `Sen RanksUp kurucusu Emir Burgazlı'nın LinkedIn asistanısın. Bu görev YALNIZ OKUMA: hiçbir kişiye istek ya da mesaj gönderme, hiçbir şeyi kabul etme ya da silme.`,
    ``,
    `Amaç: Emir'in bağlantı isteği gönderdiği aşağıdaki kişilerden hangilerinin isteği kabul ettiğini bulmak.`,
    ``,
    `Adımlar:`,
    `1. Chrome araçlarını yükle, tabs_context ile sekmeleri al, YENİ bir sekme aç ve https://www.linkedin.com/mynetwork/invite-connect/connections/ adresini aç. Kullanıcının mevcut sekmelerine dokunma.`,
    `2. Sıralama "Son eklenenler" (Recently added) değilse onu seç (sıralamayı değiştirmek serbest).`,
    `3. En yeni bağlantılardan başlayarak son 3 hafta içinde eklenenleri oku; gerekirse en fazla 3 kez aşağı kaydır.`,
    `4. Aşağıdaki listede olup bağlantılarda görünen kişilerin NUMARALARINI bul. Eşleştirmeyi profil adresiyle (linkedin.com/in/... kısmı) yap; adres okunamıyorsa ad ve soyad birebir uyuşmalı (Türkçe karakter / büyük-küçük harf farkı olabilir). Emin değilsen ekleme.`,
    `5. Bildirimler sayfasını açma (bildirimleri okundu yapar). İş bitince yalnız kendi açtığın sekmeyi kapat.`,
    `- LinkedIn giriş ekranı, güvenlik doğrulaması, captcha ya da hesap kısıtlaması görürsen dur → durum "ENGEL".`,
    ``,
    `İstek gönderilen kişiler:`,
    ...liste.map((k) => `${k.no}. ${k.adSoyad} — ${k.profileUrl}`),
    ``,
    `Cevabının SON satırı yalnız şu JSON olsun (başka metin yok):`,
    `{"durum":"KABUL_TAMAM","kabul":[kabul edenlerin numaraları],"aciklama":"kısa Türkçe açıklama"}`,
  ].join('\n');
}

/** Ajanin dondurdugu numaralar → gecerli, tekil, 1..n araliginda */
export function kabulNumaralari(veri: unknown, n: number): number[] {
  const ham = (veri as { kabul?: unknown } | null)?.kabul;
  if (!Array.isArray(ham)) return [];
  const out = new Set<number>();
  for (const x of ham) {
    const v = typeof x === 'string' ? Number(x) : x;
    if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= n) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

