/**
 * Musteri raporunun sabit metinleri: kontrol adlari, "neden onemli" ve
 * "onerilen duzeltme" cumleleri, sayfa sorunu basliklari.
 *
 * NEDEN burada (taramada degil): taramanin urettigi `description` metinleri
 * PANEL icin yazilmistir — site sahibine "sen" diye seslenir, Ingilizce terim
 * ve ic not tasir ("crawler kontrolü yapamıyorsun", "duplicate content riski",
 * "GEO ağırlığı 6", "(mevcut skor 0/100)", "snippet üretici hazır"). Rapor
 * bunlari eskiden AYNEN basiyordu; musteriye giden belgede "sen" ile "siz"
 * karisiyor, ic notlar gorunuyordu (labenko.com raporu, 12.11.2026).
 *
 * KURAL: rapora ham tarama metni GIRMEZ. Her sorun tipinin raporda kendi
 * cumlesi vardir (BULGU_METINLERI); sayilar kontrolun `details` alanindan
 * okunur. Burada karsiligi olmayan (ileride eklenen) bir sorun tipi rapora
 * metinsiz girer — panel dili sizmaz. client-report-dil.spec taramanin
 * uretebildigi her tipin burada karsiligi oldugunu ve cikan raporda panel
 * dili / ic not kalmadigini dener.
 *
 * Kontrol adlari API'de Ingilizce ("H1 Uniqueness", "Image alt text") — panel
 * ayni Turkce adlari audit-delta-panel KONTROL_ADI'nda kullaniyor; burada
 * ayni adlar kullanildi.
 *
 * llms.txt metni taramanin durust cercevesini korur: buyuk saglayicilar
 * dosyayi kullanacagini taahhut etmiyor, faydasi kucuk (audit-checks.service).
 *
 * KANIT DENETIMI (08.11.2026): FAQ zengin sonucu 7 Mayis 2026'dan beri
 * gosterilmiyor (HowTo 2023'te kaldirildi). Sema "zengin sonucun on kosulu"
 * diye satilmaz, FAQPage onerilmez; gorunur SSS icerik olarak faydali olabilir
 * ve sema sayfada gorunen metinle eslesmeli.
 */

export interface KontrolMetni {
  ad: string;
  neden: string;
  oneri: string;
}

export const KONTROL_METINLERI: Readonly<Record<string, KontrolMetni>> = {
  sitemap_xml: {
    ad: 'Site haritası (sitemap.xml)',
    // "Az sayfali sitede etkisi sinirli": Google ~500 sayfadan kucuk ve sayfalari birbirine bagli sitede site
    // haritasinin gerekmeyebilecegini soyler; sitemaps.org tarayicilarin sayfalari cogunlukla baglantilardan buldugunu.
    neden: 'Arama motorlarına ve AI tarayıcılarına sitedeki sayfaların listesini verir; yeni sayfalar daha hızlı keşfedilir. Az sayfalı ve sayfaları birbirine bağlı sitelerde etkisi sınırlıdır.',
    oneri: 'sitemap.xml dosyasını oluşturup site köküne yükleyin ve robots.txt içinde adresini belirtin.',
  },
  robots_txt: {
    ad: 'robots.txt',
    neden: 'Hangi botların siteyi tarayabileceğini belirler ve site haritasının adresini bildirir. Googlebot ya da Bingbot engellenirse site o arama motorunda görünmez; AI arama botları (OAI-SearchBot, PerplexityBot, Claude-SearchBot, Claude-User) engellenirse AI cevaplarında kaynak olarak gösterilemez.',
    oneri: 'robots.txt içinde site haritası satırı bulunsun; Googlebot, Bingbot ve AI arama botları engellenmesin. Botları tek tek adıyla anmak gerekmez.',
  },
  llms_txt: {
    ad: 'llms.txt',
    neden: 'AI asistanlarına sitenin özetini sunan, isteğe bağlı bir dosyadır. Google Arama bu dosyayı yok sayıyor, bağımsız ölçümlerde görünürlüğe etkisi görülmedi; bu yüzden skora girmez, yalnız bilgi olarak gösterilir.',
    oneri: 'Site kökünde kısa bir llms.txt yayınlayın; düşük maliyetli bir hijyen adımıdır.',
  },
  schema_markup: {
    ad: 'Yapısal veri (Schema.org)',
    neden: 'Google ve AI sistemlerinin sayfanın neyi anlattığını (kurum, ürün, makale) makinece okunur biçimde anlamasına yardım eder. İşaretleme sayfada görünen metinle eşleşmelidir. Google, SSS (FAQ) zengin sonucunu artık göstermiyor.',
    oneri: 'Organization ve BreadcrumbList ile içerik türüne uygun (Article, Product) JSON-LD işaretlemesi ekleyin; şemaya yalnız sayfada görünen bilgiyi yazın.',
  },
  meta_title: {
    ad: 'Sayfa başlığı (title)',
    neden: 'Arama sonucunda tıklanan başlıktır; sıralamayı ve tıklanma oranını doğrudan etkiler.',
    oneri: 'Her sayfaya 30–60 karakterlik, o sayfaya özgü bir başlık yazın.',
  },
  meta_description: {
    ad: 'Meta açıklama',
    neden: 'Arama sonucundaki açıklama metnidir. Yoksa Google sayfadan rastgele bir parça seçer ve tıklanma oranı düşebilir.',
    oneri: 'Her sayfaya 100–160 karakterlik, sayfayı özetleyen bir meta açıklama ekleyin.',
  },
  open_graph: {
    ad: 'Open Graph',
    neden: 'Sayfa sosyal medyada ya da mesajlaşma uygulamalarında paylaşıldığında görünen başlığı ve görseli belirler.',
    oneri: 'Sayfa şablonuna og:title, og:description ve og:image etiketlerini ekleyin.',
  },
  twitter_card: {
    ad: 'X (Twitter) kartı',
    neden: 'X üzerindeki paylaşımların kart görünümünü belirler; etkisi sınırlıdır.',
    oneri: 'Sayfa şablonuna twitter:card etiketini ekleyin.',
  },
  canonical: {
    ad: 'Canonical etiketi',
    neden: 'Aynı içerik birden çok adresten açılıyorsa hangi adresin asıl olduğunu söyler; yinelenen içerik sorununu önler.',
    oneri: 'Her sayfaya kendi asıl adresini gösteren rel="canonical" etiketini ekleyin.',
  },
  https: {
    ad: 'HTTPS',
    neden: 'Tarayıcılar HTTP siteleri "Güvenli değil" diye işaretler; HTTPS aynı zamanda bir sıralama sinyalidir.',
    oneri: 'SSL sertifikası kurup tüm HTTP adreslerini HTTPS adreslerine kalıcı (301) yönlendirin.',
  },
  h1_uniqueness: {
    ad: 'H1 başlığı',
    neden: 'Sayfanın ana konusunu okuyucuya ve arama motorlarına söyler. Eksik ya da birçok sayfada aynı olan H1 konuyu bulanıklaştırır.',
    oneri: 'Her sayfada tek ve o sayfaya özgü bir H1 başlığı kullanın.',
  },
  image_alt: {
    ad: 'Görsel alt metni',
    neden: 'Görme engelli kullanıcılar ve arama motorları görselin içeriğini alt metinden anlar; görsel aramadaki görünürlüğü etkiler.',
    oneri: 'İçerik görsellerine görseli anlatan kısa ve özgül alt metinler yazın; süs görsellerinde alt="" bırakın.',
  },
  internal_linking: {
    ad: 'İç bağlantılar',
    neden: 'Hiçbir sayfadan bağlantı almayan (yetim) sayfalar zor keşfedilir ve sitenin otoritesinden pay alamaz.',
    oneri: 'Yetim sayfalara ilgili sayfalardan ve menüden bağlantı verin.',
  },
  hreflang: {
    ad: 'Hreflang',
    neden: 'Çok dilli sitelerde arama motorunun her ziyaretçiye doğru dil sürümünü göstermesine yardım eder; tek dilli sitelerde gerekmez.',
    oneri: 'Her dil sürümünün sayfalarına, diğer dil sürümlerini gösteren hreflang etiketlerini ekleyin.',
  },
};

/** Bilinmeyen kontrol: taramanin kendi adi, genel metin — bos kalmaz */
export function kontrolMetni(id: string, taramaAdi?: unknown): KontrolMetni {
  return KONTROL_METINLERI[id] ?? {
    ad: typeof taramaAdi === 'string' && taramaAdi ? taramaAdi : id,
    neden: 'Taramanın kontrol ettiği teknik bir SEO sinyalidir.',
    oneri: 'Bulgu metnindeki adımı uygulayın.',
  };
}

export interface SayfaSorunuMetni {
  baslik: string;
  birim: 'sayfa' | 'görsel' | 'başlık';
}

/**
 * Sayfa duzeyi sorun tipleri (audit-checks.service `type` alanlari). Sayilar
 * ve ornek adresler kontrolun details alaninden okunur (client-report-build).
 */
export const SAYFA_SORUNU_METINLERI: Readonly<Record<string, SayfaSorunuMetni>> = {
  meta_desc_missing: { baslik: 'Meta açıklaması olmayan sayfalar', birim: 'sayfa' },
  meta_desc_short: { baslik: 'Meta açıklaması 100 karakterden kısa sayfalar', birim: 'sayfa' },
  meta_title_missing: { baslik: 'Başlık etiketi (title) olmayan sayfalar', birim: 'sayfa' },
  meta_title_short: { baslik: 'Başlığı 30 karakterden kısa sayfalar', birim: 'sayfa' },
  meta_title_long: { baslik: 'Başlığı 60 karakteri aşan sayfalar', birim: 'sayfa' },
  h1_missing: { baslik: 'H1 başlığı olmayan sayfalar', birim: 'sayfa' },
  h1_duplicate: { baslik: 'Birden çok sayfada tekrarlanan H1 başlıkları', birim: 'başlık' },
  js_shell_pages: { baslik: 'İçeriği yalnız JavaScript ile oluşan sayfalar', birim: 'sayfa' },
  image_alt_missing: { baslik: 'Alt metni olmayan görseller', birim: 'görsel' },
  image_alt_suspicious: { baslik: 'Alt metni dosya adı ya da genel bir kelime olan görseller', birim: 'görsel' },
  orphan_pages: { baslik: 'Hiçbir sayfadan bağlantı almayan (yetim) sayfalar', birim: 'sayfa' },
};

// ─── Bulgu metinleri (musteri dili) ─────────────────────────────────

export interface BulguBaglami {
  /** Sorunun ait oldugu kontrolun `details` alani (sayilar buradan) */
  details: Record<string, any>;
  /** Taramanin kendi metni — YALNIZ sayi okumak icin; rapora basilmaz */
  description: string;
  /** GEO sinyali sorunlarinda sinyalin 0-100 skoru (biliniyorsa) */
  sinyalSkoru?: number | null;
}

function sayiOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Tarama metninin basindaki sayi: "12 orphan sayfa ..." → 12 */
function ilkSayiOf(metin: string): number | null {
  const m = /^(\d+)\s/.exec(metin.trim());
  return m ? Number(m[1]) : null;
}

/** Tarama metnindeki "a/b" kapsami: "Canonical URL 35/48 sayfada ..." → [35, 48] */
function oranOf(metin: string): [number, number] | null {
  const m = /(\d+)\s*\/\s*(\d+)/.exec(metin);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** Sayi details'te yoksa tarama metninden okunur; ikisi de yoksa null (uydurulmaz) */
function adet(b: BulguBaglami, alan: string): number | null {
  return sayiOf(b.details[alan]) ?? ilkSayiOf(b.description);
}

const KLASIK_ARAMA_BOTLARI = new Set(['Googlebot', 'Bingbot']);

interface EngelliBot { ad: string; adiyla: boolean | null }

/**
 * robots.txt'in etkin olarak engelledigi botlar (details.searchBots, yontem
 * v3). `adiyla`: bot kendi "User-agent" grubunda mi engelli (true), "*"
 * grubuyla mi (false); eski taramada bilgi yok (null).
 */
function engelliBotlar(details: Record<string, any>, klasik: boolean): EngelliBot[] {
  const liste = Array.isArray(details.searchBots) ? details.searchBots : [];
  return liste
    .filter((b: any) => typeof b?.name === 'string' && b.effective === 'block' && KLASIK_ARAMA_BOTLARI.has(b.name) === klasik)
    .map((b: any) => ({ ad: b.name as string, adiyla: b.declared === 'block' ? true : typeof b.declared === 'string' ? false : null }));
}

function engelOnerisi(botlar: EngelliBot[]): string {
  const adiyla = botlar.filter((b) => b.adiyla === true).map((b) => b.ad);
  const yildizla = botlar.filter((b) => b.adiyla === false).map((b) => b.ad);
  const parcalar: string[] = [];
  if (adiyla.length > 0) {
    parcalar.push(`robots.txt dosyasında ${adiyla.join(', ')} için ayrılmış "User-agent" grubundaki "Disallow: /" satırını kaldırın.`);
  }
  if (yildizla.length > 0) {
    parcalar.push(`${yildizla.join(', ')} adıyla anılmadığı için "User-agent: *" grubundaki "Disallow: /" kuralına uyuyor; ${yildizla.length > 1 ? 'bu botlar' : 'bu bot'} için "Allow: /" içeren ayrı bir "User-agent" grubu eklemek, diğer botların kuralını değiştirmeden erişimi açar.`);
  }
  if (parcalar.length === 0) parcalar.push('robots.txt dosyasında bu botları engelleyen "Disallow: /" kuralını kaldırın.');
  return parcalar.join(' ');
}

function kapsam(b: BulguBaglami, a: string, t: string): [number, number] | null {
  const x = sayiOf(b.details[a]);
  const y = sayiOf(b.details[t]);
  return x !== null && y !== null ? [x, y] : oranOf(b.description);
}

/** "Taranan 48 sayfanın 12 tanesinde bulundu." / "Taranan 2 sayfanın hiçbirinde bulunamadı." */
export function kapsamCumlesi(ne: string, bulunan: number, toplam: number): string {
  return bulunan === 0
    ? `${ne} taranan ${toplam} sayfanın hiçbirinde bulunamadı.`
    : `${ne} taranan ${toplam} sayfanın ${bulunan} tanesinde bulundu.`;
}

/**
 * Sorun tipi → raporda gorunen bulgu cumlesi. Cumleler olgu bildirir
 * ("… yok", "… bulundu"); ne yapilacagi kontrolun "Önerilen düzeltme"
 * alanindadir. Sayi okunamazsa cumle sayisiz kurulur — uydurulmaz.
 */
export const BULGU_METINLERI: Readonly<Record<string, (b: BulguBaglami) => string>> = {
  sitemap_missing: () => 'Site haritası (sitemap.xml) bulunamadı.',
  // Iki kaynak: Google 4xx donen robots.txt'i "tarama kisiti yok" sayar; RFC 9309 2.3.1.3 ayni
  robots_missing: () => 'robots.txt dosyası yok. Dosya olmadığında arama motorları ve AI botları siteyi kısıtlama olmadan tarar; eksik kalan, site haritasının adresini botlara bildiren satırdır.',
  robots_no_sitemap: () => 'robots.txt dosyasında site haritasının adresini bildiren "Sitemap:" satırı yok.',
  robots_search_engine_blocked: (b) => {
    const adlar = engelliBotlar(b.details, true).map((x) => x.ad);
    return adlar.length > 0
      ? `robots.txt şu arama motoru ${adlar.length > 1 ? 'botlarını' : 'botunu'} tamamen engelliyor: ${adlar.join(', ')}. Site ${adlar.length > 1 ? 'bu arama motorlarında' : 'bu arama motorunda'} ve bu dizine dayanan AI cevaplarında görünmez.`
      : 'robots.txt bir arama motoru botunu tamamen engelliyor. Site o arama motorunda ve o dizine dayanan AI cevaplarında görünmez.';
  },
  robots_ai_search_blocked: (b) => {
    const adlar = engelliBotlar(b.details, false).map((x) => x.ad);
    return adlar.length > 0
      ? `robots.txt şu AI arama ${adlar.length > 1 ? 'botlarını' : 'botunu'} engelliyor: ${adlar.join(', ')}. Bu asistanlar siteyi canlı cevaplarında kaynak olarak gösteremez.`
      : 'robots.txt bir AI arama botunu engelliyor. O asistan siteyi canlı cevaplarında kaynak olarak gösteremez.';
  },
  robots_ai_training_blocked: (b) => {
    const adlar = Array.isArray(b.details.trainingBlocked) ? b.details.trainingBlocked.filter((x: unknown): x is string => typeof x === 'string') : [];
    return `Eğitim botları engelli${adlar.length > 0 ? ` (${adlar.slice(0, 5).join(', ')}${adlar.length > 5 ? ' ve diğerleri' : ''})` : ''}. Bu, canlı AI cevaplarını etkilemez; bilinçli bir tercihse sorun değildir.`;
  },
  llms_missing: () => 'llms.txt dosyası yok. Bu dosya isteğe bağlıdır.',
  schema_low_coverage: (b) => {
    const k = kapsam(b, 'pagesWithSchema', 'total');
    return k ? kapsamCumlesi('Yapısal veri (JSON-LD)', k[0], k[1]) : 'Yapısal veri (JSON-LD) sayfaların çoğunda yok.';
  },
  breadcrumb_missing: () => 'Sayfaların çoğunda sayfa yolu (BreadcrumbList) işaretlemesi yok.',
  meta_title_missing: (b) => {
    const n = adet(b, 'missing');
    return n !== null ? `${n} sayfada başlık etiketi (title) yok.` : 'Bazı sayfalarda başlık etiketi (title) yok.';
  },
  meta_title_short: (b) => {
    const n = adet(b, 'tooShort');
    return n !== null ? `${n} sayfanın başlığı 30 karakterden kısa.` : 'Bazı sayfaların başlığı 30 karakterden kısa.';
  },
  meta_title_long: (b) => {
    const n = adet(b, 'tooLong');
    return n !== null ? `${n} sayfanın başlığı 60 karakterden uzun; arama sonucunda kesilebilir.` : 'Bazı sayfaların başlığı 60 karakterden uzun; arama sonucunda kesilebilir.';
  },
  meta_desc_missing: (b) => {
    const n = adet(b, 'missing');
    return n !== null ? `${n} sayfada meta açıklama yok.` : 'Bazı sayfalarda meta açıklama yok.';
  },
  meta_desc_short: (b) => {
    const n = adet(b, 'tooShort');
    return n !== null ? `${n} sayfanın meta açıklaması 100 karakterden kısa.` : 'Bazı sayfaların meta açıklaması 100 karakterden kısa.';
  },
  og_low_coverage: (b) => {
    const k = oranOf(b.description);
    return k ? kapsamCumlesi('Open Graph etiketleri', k[0], k[1]) : 'Open Graph etiketleri sayfaların çoğunda yok.';
  },
  twitter_low_coverage: (b) => {
    const k = oranOf(b.description);
    return k ? kapsamCumlesi('X (Twitter) kartı etiketi', k[0], k[1]) : 'X (Twitter) kartı etiketi sayfaların çoğunda yok.';
  },
  canonical_missing: (b) => {
    const k = oranOf(b.description);
    return k ? kapsamCumlesi('Canonical etiketi', k[0], k[1]) : 'Canonical etiketi sayfaların çoğunda yok.';
  },
  no_https: () => 'Site HTTP üzerinden yayınlanıyor; HTTPS kullanılmıyor.',
  // "Tarayicilar cogunlukla tamamlar": AIA ile eksik sertifikayi indirirler. Hangi botlarin
  // baglanamadigi olculmedi — "baglanamayabilir".
  tls_chain_incomplete: () => 'Sunucu HTTPS sertifika zincirini eksik gönderiyor: sertifikayı imzalayan ara sertifikalar yanıtta yok. Tarayıcılar eksik sertifikayı çoğunlukla kendisi tamamlar; tamamlamayan programlar ve botlar siteye bağlanamayabilir.',
  h1_duplicate: (b) => {
    const n = adet(b, 'duplicates');
    return n !== null ? `${n} farklı H1 başlığı birden çok sayfada tekrarlanıyor.` : 'Bazı H1 başlıkları birden çok sayfada tekrarlanıyor.';
  },
  h1_missing: (b) => {
    const n = adet(b, 'missing');
    return n !== null ? `${n} sayfada H1 başlığı yok.` : 'Bazı sayfalarda H1 başlığı yok.';
  },
  js_shell_pages: (b) => {
    const n = adet(b, 'jsShellCount');
    return `${n !== null ? `${n} sayfa` : 'Bazı sayfalar'} sunucudan boş bir JavaScript iskeleti olarak geliyor; başlık, metin ve bağlantılar tarayıcıda oluşuyor. Google JavaScript çalıştırır; ChatGPT, Claude ve Perplexity'nin tarayıcıları çalıştırmadığı için bu sayfaların içeriğini göremez.`;
  },
  image_alt_missing: (b) => {
    const n = adet(b, 'absent');
    return n !== null ? `${n} görselde alt metni yok.` : 'Bazı görsellerde alt metni yok.';
  },
  image_alt_suspicious: (b) => {
    const n = adet(b, 'suspicious');
    return `${n !== null ? `${n} görselin` : 'Bazı görsellerin'} alt metni dosya adı ya da "resim", "görsel" gibi genel bir kelime; görseli anlatmıyor.`;
  },
  orphan_pages: (b) => {
    const n = ilkSayiOf(b.description);
    return n !== null ? `${n} sayfa, taranan hiçbir sayfadan bağlantı almıyor.` : 'Bazı sayfalar, taranan hiçbir sayfadan bağlantı almıyor.';
  },
  hreflang_missing: (b) => {
    const diller = Array.isArray(b.details.languages) ? b.details.languages.filter((x: unknown): x is string => typeof x === 'string') : [];
    return `Sitede birden çok dil sürümü var${diller.length > 0 ? ` (${diller.map((d: string) => d.toUpperCase()).join(', ')})` : ''} ama sayfalarda hreflang etiketi yok.`;
  },
  faq_missing: (b) => geoBulgusu('Sayfalarda görünür soru-cevap bölümü yok ya da çok az.', b),
  definition_missing: (b) => geoBulgusu('Sayfalarda "X nedir?" sorusuna doğrudan cevap veren tanım içeriği az.', b),
  citation_format_missing: (b) => geoBulgusu('Sayfalarda liste ve tablo biçimi az kullanılıyor.', b),
  freshness_missing: (b) => geoBulgusu('Sayfalarda yayın ya da güncelleme tarihi bilgisi bulunamadı.', b),
  evidence_missing: (b) => geoBulgusu('İçerik sayfalarında kaynaklı rakam, karşılaştırma tablosu ya da adım listesi gibi kanıt blokları az.', b),
  thin_content_geo: (b) => geoBulgusu('İçerik sayfaları kısa: az kelime ve az alt başlık içeriyor.', b),
};

/** GEO sinyali bulgusu: skor biliniyorsa cumlenin sonuna eklenir (tarama metnindeki "(mevcut skor N/100)" yedegi) */
function geoBulgusu(cumle: string, b: BulguBaglami): string {
  const skor = sayiOf(b.sinyalSkoru) ?? (() => {
    const m = /mevcut skor (\d+)\/100/.exec(b.description);
    return m ? Number(m[1]) : null;
  })();
  return skor !== null ? `${cumle} Bu sinyalin skoru ${skor}/100.` : cumle;
}

/**
 * Bir sorunun rapordaki cumlesi. Karsiligi olmayan tip → null: ham tarama
 * metni rapora ASLA dusmez (bkz. dosya basi).
 */
export function bulguMetni(tip: unknown, b: BulguBaglami): string | null {
  const uret = typeof tip === 'string' ? BULGU_METINLERI[tip] : undefined;
  return uret ? uret(b) : null;
}

/**
 * Sorun tipine OZEL "neden onemli" / "onerilen duzeltme". Kontrolun genel
 * metni (KONTROL_METINLERI) cogu sorun icin dogrudur; burada yalniz genel
 * metnin YANLIS yonlendirdigi tipler var: dosyasi hic olmayan siteye
 * "robots.txt'i duzenleyin" demek, zinciri eksik siteye "SSL kurun" demek,
 * icerigi JavaScript ile olusan sayfaya "H1 ekleyin" demek gibi.
 */
export const TIP_NEDENI: Readonly<Record<string, string>> = {
  tls_chain_incomplete: 'Zincir eksik olduğunda site tarayıcıda açılsa bile, eksik sertifikayı kendisi tamamlamayan programlar güvenli bağlantı kuramaz.',
  js_shell_pages: 'İçeriği yalnız JavaScript ile oluşan sayfayı, JavaScript çalıştırmayan tarayıcılar boş görür.',
};

export const TIP_ONERISI: Readonly<Record<string, (b: BulguBaglami) => string>> = {
  robots_missing: () => 'Site köküne, site haritasının adresini bildiren bir robots.txt dosyası yükleyin.',
  robots_no_sitemap: () => 'robots.txt dosyasına, site haritasının tam adresini içeren bir "Sitemap:" satırı ekleyin.',
  robots_search_engine_blocked: (b) => engelOnerisi(engelliBotlar(b.details, true)),
  robots_ai_search_blocked: (b) => `${engelOnerisi(engelliBotlar(b.details, false))} Engel bilinçli bir tercihse değişiklik gerekmez.`,
  tls_chain_incomplete: () => 'Sunucuyu tam sertifika zincirini gönderecek şekilde ayarlayın (Let’s Encrypt kullanılıyorsa cert.pem yerine fullchain.pem).',
  js_shell_pages: () => 'Bu sayfaların içeriğini sunucu tarafında oluşturun (sunucu tarafı render ya da statik üretim).',
};

/** Bilgi amacli kontrollerin (skor/sayac disi) rapordaki notu */
export const BILGI_NOTLARI = {
  llmsVar: 'Dosya var. İsteğe bağlı bir dosyadır; site skoruna girmez.',
  llmsYok: 'Dosya yok. İsteğe bağlı bir dosyadır; site skoruna girmez.',
  llmsDogrulanamadi: 'Dosya doğrulanamadı. İsteğe bağlı bir dosyadır; site skoruna girmez.',
  /** Yeni tarama: dil surumu arandi, gorulmedi */
  hreflangTekDil: 'Taramada sitenin başka dil sürümü görülmedi. hreflang yalnız birden çok dil sürümü olan sitelerde gerekir.',
  /** Eski tarama: dil surumu hic aranmadi — "gecti" denemez, "gerekmez" de denemez */
  hreflangBilinmiyor: 'Sitede hreflang etiketi bulunmadı. Bu etiket yalnız birden çok dil sürümü olan sitelerde gerekir; sitede başka dil sürümü varsa eklenmesi önerilir.',
} as const;

/** GEO sinyal adlari — geo-runner etiketleri ASCII ve teknik; musteriye Turkce */
export const GEO_SINYAL_ADI: Readonly<Record<string, string>> = {
  llms_txt: 'llms.txt',
  structured_data: 'Yapısal veri (JSON-LD) kapsamı',
  faq_qa: 'SSS / soru-cevap biçimi',
  definition: 'Tanım içeriği ("X nedir?")',
  heading: 'Başlık hiyerarşisi (H1 > H2 > H3)',
  og_canonical: 'Canonical ve sosyal paylaşım etiketleri',
  freshness: 'Tarih sinyali (yayın / güncelleme tarihi)',
  citation_format: 'Liste ve tablo biçimi',
  evidence: 'Kanıt blokları (rakam, karşılaştırma, adım)',
  depth: 'İçerik derinliği (kelime ve alt başlık)',
};

/**
 * AI gorunurluk skorunun yontemi — citation-score.ts citationCounts formulunun
 * musteri dilinde anlatimi. Formul degisirse bu metin de degismeli
 * (client-report-build.spec bunu formulle birlikte dener).
 */
export const AI_SKOR_YONTEMI =
  'AI görünürlük skoru: her AI asistanına marka adının geçmediği sorular sorulur. ' +
  'Yanıtta sitenin adresi kaynak olarak gösterilirse 100, yalnız marka adı geçerse 50, ' +
  'ikisi de yoksa 0 puan verilir. Asistan skoru bu puanların ortalamasıdır; genel skor ' +
  'ölçülebilen asistanların ortalamasıdır. Marka adını içeren sorular ve hata veren ' +
  'yanıtlar skora katılmaz.';

export const OLCULMEDI = 'Henüz ölçülmedi';

/**
 * Taramadan TURETILEN aksiyonlarin kisa basligi ve varsayilan eforu.
 *
 * Etki bulgunun onem duzeyinden gelir (kritik → yuksek, uyari → orta);
 * `etki` yalniz taramanin kendisinin "faydasi kucuk" dedigi kontrollerde
 * asagi cekilir (llms.txt, X karti). Efor: RanksUp'in otomatik duzeltebildigi
 * kok dosyalar (fix-routes.ts auto_fix) kolay; digerleri sablon/icerik isi.
 * Bu etiketler KURAL TABANLIDIR; rapor "Yontem" bolumunde bunu soyler.
 */
export interface AksiyonMetni {
  baslik: string;
  efor: 'kolay' | 'orta' | 'zor';
  etki?: 'yuksek' | 'orta' | 'dusuk';
}

export const AKSIYON_METINLERI: Readonly<Record<string, AksiyonMetni>> = {
  sitemap_xml: { baslik: 'Site haritasını (sitemap.xml) yayınlayın', efor: 'kolay' },
  robots_txt: { baslik: 'robots.txt dosyasını düzenleyin', efor: 'kolay' },
  llms_txt: { baslik: 'llms.txt dosyası yayınlayın', efor: 'kolay', etki: 'dusuk' },
  schema_markup: { baslik: 'Sayfalara yapısal veri (JSON-LD) ekleyin', efor: 'orta' },
  meta_title: { baslik: 'Eksik ve kısa sayfa başlıklarını düzeltin', efor: 'orta' },
  meta_description: { baslik: 'Eksik meta açıklamaları yazın', efor: 'orta' },
  open_graph: { baslik: 'Şablona Open Graph etiketlerini ekleyin', efor: 'kolay' },
  twitter_card: { baslik: 'Şablona X (Twitter) kartı etiketini ekleyin', efor: 'kolay', etki: 'dusuk' },
  canonical: { baslik: 'Sayfalara canonical etiketi ekleyin', efor: 'kolay' },
  https: { baslik: 'Siteyi HTTPS üzerinden sunun', efor: 'orta' },
  h1_uniqueness: { baslik: 'Her sayfaya özgü bir H1 başlığı ekleyin', efor: 'orta' },
  image_alt: { baslik: 'Görsellere alt metin yazın', efor: 'orta' },
  internal_linking: { baslik: 'Yetim sayfalara iç bağlantı verin', efor: 'orta' },
  hreflang: { baslik: 'Dil sürümlerine hreflang ekleyin', efor: 'orta' },
  // FAQ zengin sonucu 7 Mayis 2026'dan beri gosterilmiyor: oneri sema degil, gorunur SSS icerigi
  geo_faq: { baslik: 'Okurların sorduğu soruları sayfada görünür soru-cevap olarak yanıtlayın', efor: 'orta' },
  geo_definition: { baslik: '"X nedir?" biçiminde tanım içerikleri ekleyin', efor: 'orta' },
  geo_citation_format: { baslik: 'Önemli bilgileri liste ve tablo biçiminde sunun', efor: 'orta' },
  geo_freshness: { baslik: 'Sayfalara yayın ve güncelleme tarihi ekleyin', efor: 'kolay' },
  geo_evidence: { baslik: 'İçeriğe kaynaklı rakam, karşılaştırma tablosu ve adım listesi ekleyin', efor: 'orta' },
  geo_depth: { baslik: 'İnce sayfaları alt başlıklarla genişletin', efor: 'orta' },
  ai_citation: { baslik: 'AI asistanlarının alıntılayacağı soru-cevap içerikleri yayınlayın', efor: 'orta' },
  pagespeed: { baslik: 'Sayfa hızını iyileştirin', efor: 'orta' },
};

/**
 * Sorun TIPINE ozel aksiyon basligi — kontrolun genel basligi yanlis
 * yonlendiriyorsa. Ör. dosyasi hic olmayan sitede "robots.txt dosyasını
 * düzenleyin" degil "yayınlayın"; icerigi JavaScript ile olusan sayfada
 * "H1 ekleyin" degil sunucu tarafi render.
 *
 * `etki: 'dusuk'` — robots.txt'in YOKLUGU gorunurlugu kesmez (botlar kisitsiz
 * tarar; BULGU_METINLERI.robots_missing kaynaklari), eksik kalan yalniz site
 * haritasi satiridir. Eskiden "kritik → yuksek etki" ile raporun ilk onceligi
 * oluyordu.
 */
export const AKSIYON_TIP_METINLERI: Readonly<Record<string, AksiyonMetni>> = {
  robots_missing: { baslik: 'robots.txt dosyası yayınlayın', efor: 'kolay', etki: 'dusuk' },
  robots_no_sitemap: { baslik: 'robots.txt dosyasına site haritası satırını ekleyin', efor: 'kolay', etki: 'dusuk' },
  robots_search_engine_blocked: { baslik: 'Arama motoru botlarının robots.txt engelini kaldırın', efor: 'kolay' },
  robots_ai_search_blocked: { baslik: 'AI arama botlarının robots.txt engelini gözden geçirin', efor: 'kolay' },
  tls_chain_incomplete: { baslik: 'Sunucuyu tam sertifika zincirini gönderecek şekilde ayarlayın', efor: 'kolay' },
  hreflang_missing: { baslik: 'Dil sürümlerine hreflang etiketleri ekleyin', efor: 'orta' },
  js_shell_pages: { baslik: 'Sayfa içeriğini sunucu tarafında oluşturun', efor: 'zor' },
  h1_duplicate: { baslik: 'Tekrarlanan H1 başlıklarını sayfaya özgü yapın', efor: 'orta' },
  meta_desc_short: { baslik: 'Kısa meta açıklamaları genişletin', efor: 'orta' },
  meta_title_short: { baslik: 'Kısa sayfa başlıklarını genişletin', efor: 'orta' },
  schema_low_coverage: { baslik: 'Sayfalara yapısal veri (JSON-LD) ekleyin', efor: 'orta' },
};

/** Tipe ozel baslik varsa o; yoksa kontrolun genel basligi */
export function aksiyonMetni(anahtar: string, tip: unknown): AksiyonMetni | null {
  const ozel = typeof tip === 'string' ? AKSIYON_TIP_METINLERI[tip] : undefined;
  return ozel ?? AKSIYON_METINLERI[anahtar] ?? null;
}

/**
 * Rapor onem duzeltmesi — ESKI taramalar icin. Tarama 12.11.2026'dan beri bu
 * tipleri "uyari" yaziyor (audit-checks.service checkSitemap,
 * robots-check.ts); kayitli eski taramalarda hâlâ "critical" duruyor ve rapor
 * yeniden tarama beklemeden dogru etiketi gostermeli.
 */
export const RAPOR_ONEM_DUZELTMESI: Readonly<Record<string, 'warning' | 'info'>> = {
  robots_missing: 'warning',
  sitemap_missing: 'warning',
};

/**
 * Sayfa hizi aksiyonunun aciklamasi. PageSpeed firsat basliklari Lighthouse'un
 * kendi metnidir (Ingilizce gelebilir) ve rapora basilmaz; yalniz kac firsat
 * bulundugu ve en buyuk tahmini kazanc yazilir.
 */
export function hizAksiyonAciklamasi(firsatMetinleri: string[]): string {
  const kazanclar = firsatMetinleri
    .map((m) => /(\d+(?:\.\d+)?)s\s+tasarruf/.exec(m))
    .map((m) => (m ? Number(m[1]) : 0));
  const enBuyuk = Math.max(0, ...kazanclar);
  const n = firsatMetinleri.length;
  return `PageSpeed ölçümü, sayfaların yüklenmesini hızlandırabilecek ${n} iyileştirme alanı buldu${enBuyuk > 0 ? `; en büyük tahmini kazanç ${String(enBuyuk).replace('.', ',')} saniye` : ''}.`;
}

/**
 * audit.service ai_citation_low esigi: tarama kendi AI ortalamasi bunun
 * altindaysa "AI arama gorunurlugu dusuk" bulgusu uretir. Rapor ayni esigi
 * raporun KENDI AI olcumune uygular.
 */
export const AI_DUSUK_ESIGI = 30;

/**
 * "AI gorunurlugu dusuk" aksiyonunun aciklamasi — sayi HER ZAMAN raporun
 * AI gorunurluk mansetinden gelir (ya da hic yazilmaz).
 *
 * NEDEN: tarama bulgusunun metni taramanin kendi AI adiminin skorunu tasir
 * ("(20/100)"). Taramadan sonra daha yeni bir AI olcumu varsa rapor
 * mansette o skoru (17/100) yazar; ayni belgede iki farkli AI skoru musteriye
 * celiski gibi okunur (mukellef.co, 22.10.2026).
 */
export function aiGorunurlukAksiyonAciklamasi(skor: number | null): string {
  const bas = typeof skor === 'number' ? `AI görünürlük skoru ${skor}/100` : 'AI görünürlüğü düşük';
  return `${bas}: AI asistanları marka adı geçmeyen sorulara verdikleri yanıtlarda siteyi nadiren kaynak gösteriyor ya da markayı nadiren anıyor. Bu sorulara doğrudan cevap veren görünür içerik önerilir; arama botlarının (Googlebot, Bingbot, OAI-SearchBot, PerplexityBot, Claude-SearchBot) robots.txt'te engelli olmadığından emin olun. Şema işaretlemesi sayfada görünen metinle eşleşmelidir.`;
}
