/**
 * Musteri raporunun sabit metinleri: kontrol adlari, "neden onemli" ve
 * "onerilen duzeltme" cumleleri, sayfa sorunu basliklari.
 *
 * NEDEN burada (taramada degil): taramanin urettigi `description` metinleri
 * site sahibine yazilmis bulgu cumleleridir ve rapora AYNEN tasinir (bulgu).
 * Musteriye ayrica "bu neden onemli / ne yapilmali" anlatilmasi gerekiyordu;
 * bu metinler taramada hic yoktu. Kontrol adlari da API'de Ingilizce
 * ("H1 Uniqueness", "Image alt text") — panel ayni Turkce adlari
 * audit-delta-panel KONTROL_ADI'nda kullaniyor; burada ayni adlar kullanildi.
 *
 * llms.txt metni taramanin durust cercevesini korur: buyuk saglayicilar
 * dosyayi kullanacagini taahhut etmiyor, faydasi kucuk (audit-checks.service).
 */

export interface KontrolMetni {
  ad: string;
  neden: string;
  oneri: string;
}

export const KONTROL_METINLERI: Readonly<Record<string, KontrolMetni>> = {
  sitemap_xml: {
    ad: 'Site haritası (sitemap.xml)',
    neden: 'Arama motorlarına ve AI tarayıcılarına sitedeki sayfaların listesini verir; yeni sayfalar daha hızlı keşfedilir.',
    oneri: 'sitemap.xml dosyasını oluşturup site köküne yükleyin ve robots.txt içinde adresini belirtin.',
  },
  robots_txt: {
    ad: 'robots.txt',
    neden: 'Hangi botların siteyi tarayabileceğini belirler. AI arama botları engellenirse site, AI cevaplarında kaynak olarak gösterilemez.',
    oneri: 'robots.txt içinde site haritası satırı bulunsun; AI arama botlarına (OAI-SearchBot, PerplexityBot vb.) erişim bilinçli bir kararla verilsin.',
  },
  llms_txt: {
    ad: 'llms.txt',
    neden: 'AI asistanlarına sitenin özetini sunan, isteğe bağlı bir dosyadır. Büyük AI sağlayıcıları bu dosyayı kullanacağını taahhüt etmiyor; olası faydası küçük, zararı yoktur.',
    oneri: 'Site kökünde kısa bir llms.txt yayınlayın; düşük maliyetli bir hijyen adımıdır.',
  },
  schema_markup: {
    ad: 'Yapısal veri (Schema.org)',
    neden: 'Google ve AI sistemlerinin sayfanın neyi anlattığını (kurum, ürün, makale, SSS) makinece okunur biçimde anlamasını sağlar; zengin sonuçların ön koşuludur.',
    oneri: 'Organization ve BreadcrumbList ile içerik türüne uygun (Article, FAQPage, Product) JSON-LD işaretlemesi ekleyin.',
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
    neden: 'Çok dilli sitelerde ziyaretçiye doğru dil sürümünün gösterilmesini sağlar; tek dilli sitelerde gerekmez.',
    oneri: 'Sitenin birden çok dil sürümü varsa her sürüme hreflang etiketleri ekleyin.',
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
  geo_faq: { baslik: 'Soru-cevap (SSS) içeriği ve FAQ şeması ekleyin', efor: 'orta' },
  geo_definition: { baslik: '"X nedir?" biçiminde tanım içerikleri ekleyin', efor: 'orta' },
  geo_citation_format: { baslik: 'Önemli bilgileri liste ve tablo biçiminde sunun', efor: 'orta' },
  geo_freshness: { baslik: 'Sayfalara yayın ve güncelleme tarihi ekleyin', efor: 'kolay' },
  ai_citation: { baslik: 'AI asistanlarının alıntılayacağı soru-cevap içerikleri yayınlayın', efor: 'orta' },
  pagespeed: { baslik: 'Sayfa hızını iyileştirin', efor: 'orta' },
};

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
  return `${bas}: AI asistanları marka adı geçmeyen sorulara verdikleri yanıtlarda siteyi nadiren kaynak gösteriyor ya da markayı nadiren anıyor. Soru-cevap biçiminde GEO içeriği ve schema işaretlemesi önerilir; llms.txt düşük maliyetli, opsiyonel bir adımdır.`;
}
