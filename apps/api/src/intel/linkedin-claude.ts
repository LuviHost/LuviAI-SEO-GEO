/**
 * Claude ile LinkedIn gonderimi — saf kurallar (26.11.2026).
 *
 * Akis: panel listeyi gosterir → yonetici "Claude ile gönder"e basar (= bu kisiler ve bu notlar icin
 * onay) → sunucu is kaydi acar → O YONETICININ Mac'indeki ajan isi alir (27.11.2026: her yoneticinin
 * kendi anahtari, kendi LinkedIn hesabi, kendi kotasi), her kisi icin Claude Code'u
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
export const KISI_SONUCLARI = ['GONDERILDI', 'KURU_TAMAM', 'ZATEN_BAGLI', 'BEKLIYOR', 'BULUNAMADI', 'EPOSTA_ISTIYOR', 'KABUL_TAMAM', 'MESAJ_TAMAM', 'ENGEL', 'HATA'] as const;
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
    case 'KABUL_TAMAM':
    case 'MESAJ_TAMAM': return null;
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

/**
 * Komutta gecen gonderen adi (27.11.2026, iki yonetici): istegi kimin hesabi gonderiyorsa o.
 * Ad bos ise e-postanin @ oncesi; o da yoksa "RanksUp yöneticisi".
 */
/** Panelde kisa gosterim: "Talat Yılmaz" → "Talat" */
export function ilkAd(u: { name?: string | null; email?: string | null } | null | undefined): string {
  return gonderenAdi(u).split(' ')[0];
}

export function gonderenAdi(u: { name?: string | null; email?: string | null } | null | undefined): string {
  const ad = (u?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (ad) return ad;
  const yerel = (u?.email ?? '').split('@')[0]?.trim().slice(0, 80);
  return yerel || 'RanksUp yöneticisi';
}

export function ajanKomutu(k: AjanKisi, kuru: boolean, gonderen: string): string {
  const adSoyad = `${k.ad} ${k.soyad}`.trim();
  const son = kuru
    ? `KURU DENEME: "Gönder" (Send) düğmesine BASMA. Not yazılı hâlde pencerenin ekran görüntüsünü al, sonra pencereyi "Vazgeç"/X ile kapat → durum "KURU_TAMAM".`
    : `"Gönder" (Send) düğmesine bas. Ardından profilde düğmenin "Bekliyor" (Pending) olduğunu doğrula → durum "GONDERILDI". Doğrulayamazsan → "HATA".`;
  return [
    `Sen RanksUp ekibinden ${gonderen} adlı kişinin LinkedIn bağlantı isteği asistanısın. ${gonderen} bu kişiyi ve aşağıdaki notu RanksUp yönetim panelinde inceleyip "Claude ile gönder" düğmesine basarak onayladı. İstek, bu Chrome'da açık olan LinkedIn hesabından gider. Yalnız bu kişi için, yalnız bu notla bağlantı isteği gönder.`,
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

export function kabulKomutu(liste: KabulKisi[], gonderen: string): string {
  return [
    `Sen RanksUp ekibinden ${gonderen} adlı kişinin LinkedIn asistanısın. Bu görev YALNIZ OKUMA: hiçbir kişiye istek ya da mesaj gönderme, hiçbir şeyi kabul etme ya da silme.`,
    ``,
    `Amaç: ${gonderen} adlı kişinin bu Chrome'da açık LinkedIn hesabından bağlantı isteği gönderdiği aşağıdaki kişilerden hangilerinin isteği kabul ettiğini bulmak.`,
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



// ── Mesaj taramasi (28.11.2026) ────────────────────────────────
// Sahip: "Talat LinkedIn uzerinden mesaj atti, bunu tarayip buradaki veriyi guncellemek gerekli ki ben de
// gorebileyim." Her yoneticinin Mac'i kendi LinkedIn mesaj kutusunu okur (salt okuma), takip
// listesindeki kisilerle yapilan konusmalari geri yazar; panel kimin ne yazdigini gosterir.
// Kabul kontrolunun hemen ardindan, ayni saatlerde (10/14/17) kendiliginden acilir.

/** Tek taramada eslestirme listesi (komut boyu) */
export const MESAJ_KISI_TAVANI = 300;
/** Mesaj kutusunda geriye bakilan gun ve en fazla konusma */
export const MESAJ_GUN = 14;
export const MESAJ_KONUSMA_TAVANI = 20;
/** Tek mesaj metni siniri (karakter) */
export const MESAJ_METIN_SINIRI = 2000;

export interface MesajKisi { no: number; adSoyad: string; firma: string; profileUrl: string }

/**
 * NEDEN duz JSON (ic ice nesne yok): Mac'teki ajan cevaptaki son {"durum": ...} nesnesini
 * /\{[^{}]*"durum"[^{}]*\}/ ile buluyor; ic ice {} olursa sonuc okunamaz. Mesajlar dizi icinde dizi.
 */
export function mesajKomutu(liste: MesajKisi[], gonderen: string): string {
  return [
    `Sen RanksUp ekibinden ${gonderen} adlı kişinin LinkedIn asistanısın. Bu görev YALNIZ OKUMA: hiç kimseye mesaj ya da istek gönderme, mesaj yazma kutusuna bir şey yazma, hiçbir şeyi silme, arşivleme ya da kabul etme.`,
    ``,
    `Amaç: ${gonderen} adlı kişinin bu Chrome'da açık LinkedIn hesabının mesaj kutusunda, aşağıdaki listedeki kişilerle son ${MESAJ_GUN} günde yapılan yazışmaları okumak.`,
    ``,
    `Adımlar:`,
    `1. Chrome araçlarını yükle, tabs_context ile sekmeleri al, YENİ bir sekme aç ve https://www.linkedin.com/messaging/ adresini aç. Kullanıcının mevcut sekmelerine dokunma.`,
    `2. Soldaki konuşma listesinde en yeniden başlayarak son ${MESAJ_GUN} gün içinde yazışılan en fazla ${MESAJ_KONUSMA_TAVANI} konuşmaya bak; gerekirse listeyi aşağı kaydır.`,
    `3. Konuşmadaki kişi aşağıdaki listede ise (profil adresi linkedin.com/in/... kısmı ya da ad soyad birebir; Türkçe karakter / büyük-küçük harf farkı olabilir) konuşmayı aç ve son ${MESAJ_GUN} gündeki mesajları oku. Listede olmayan konuşmaları AÇMA ve hiçbir bilgisini yazma. Emin değilsen o kişiyi atla.`,
    `4. Okunmamış bir konuşmayı açmak onu okundu yapar: yalnız listedeki kişilerin konuşmalarını aç.`,
    `5. İş bitince yalnız kendi açtığın sekmeyi kapat.`,
    `- LinkedIn giriş ekranı, güvenlik doğrulaması, captcha ya da hesap kısıtlaması görürsen dur → durum "ENGEL".`,
    ``,
    `Her mesaj için bir dizi yaz: [kişi numarası, "GIDEN" ya da "GELEN", "YYYY-MM-DD HH:MM", "mesaj metni"]`,
    `- GIDEN = ${gonderen} yazdı, GELEN = karşı taraf yazdı. Saat İstanbul saati; saat görünmüyorsa yalnız "YYYY-MM-DD".`,
    `- Mesaj metnini olduğu gibi yaz (en fazla ${MESAJ_METIN_SINIRI} karakter); satır sonlarını \\n yaz; metindeki { ve } işaretlerini ( ve ) yap.`,
    `- Bağlantı isteği notu, "bağlantı kuruldu" gibi sistem satırları ve ek / görsel adları mesaj sayılmaz.`,
    ``,
    `Liste:`,
    ...liste.map((k) => `${k.no}. ${k.adSoyad} (${k.firma}) — ${k.profileUrl}`),
    ``,
    `Cevabının SON satırı yalnız şu JSON olsun (başka metin yok; mesaj yoksa "mesajlar":[]):`,
    `{"durum":"MESAJ_TAMAM","mesajlar":[[3,"GIDEN","2026-11-27 14:05","Merhaba ..."],[3,"GELEN","2026-11-27 15:10","Teşekkürler ..."]],"aciklama":"kısa Türkçe açıklama"}`,
  ].join('\n');
}

export interface TaranmisMesaj { no: number; yon: 'GIDEN' | 'GELEN'; at: Date; metin: string }

/** "2026-11-27 14:05" / "2026-11-27" (Istanbul) → an; gelecekte ya da cok eskiyse null */
export function mesajZamani(v: unknown, simdi: Date = new Date()): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(v ?? '').trim());
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4] ?? '12'}:${m[5] ?? '00'}:00+03:00`);
  if (Number.isNaN(d.getTime())) return null;
  // Saat dilimi / yuvarlama payi: 1 saat ileri tolere edilir
  if (d.getTime() > simdi.getTime() + 3_600_000) return null;
  if (d.getTime() < simdi.getTime() - 120 * 86_400_000) return null;
  return d;
}

/** Ajanin dondurdugu mesaj dizileri → gecerli kayitlar (numara 1..n, yon, zaman, bos olmayan metin) */
export function mesajlariAyikla(veri: unknown, n: number, simdi: Date = new Date()): TaranmisMesaj[] {
  const ham = (veri as { mesajlar?: unknown } | null)?.mesajlar;
  if (!Array.isArray(ham)) return [];
  const out: TaranmisMesaj[] = [];
  for (const x of ham.slice(0, 500)) {
    if (!Array.isArray(x) || x.length < 4) continue;
    const no = typeof x[0] === 'string' ? Number(x[0]) : x[0];
    if (typeof no !== 'number' || !Number.isInteger(no) || no < 1 || no > n) continue;
    const yon = String(x[1]).toUpperCase();
    if (yon !== 'GIDEN' && yon !== 'GELEN') continue;
    const at = mesajZamani(x[2], simdi);
    if (!at) continue;
    const metin = String(x[3] ?? '').replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim().slice(0, MESAJ_METIN_SINIRI);
    if (!metin) continue;
    out.push({ no, yon, at, metin });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Tekrar kontrolu icin metin ozu: harf/rakam disi atilir, kucuk harf */
export function metinOzu(s: string | null | undefined): string {
  return String(s ?? '').toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Bu mesaj kayitta zaten var mi (bot mesaji, elle kayit, baglanti notu) — ilk 200 harflik oz ile */
export function mesajKayitliMi(metin: string, mevcut: Array<string | null | undefined>): boolean {
  const oz = metinOzu(metin).slice(0, 200);
  if (oz.length < 4) return true;
  return mevcut.some((m) => metinOzu(m).includes(oz));
}
