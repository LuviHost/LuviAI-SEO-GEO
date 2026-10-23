/**
 * RanksUp Video stilleri — TEK KAYNAK. Remotion sablonlari (src/styles/StyledVideo.tsx), render hatti
 * (render/article-short.mjs: izin listesi + varlik denetimi), deploy adimi (scripts/prepare-article-short.mjs:
 * stok goruntu indirme), okunurluk denetimi (scripts/check-video-readability.mjs) ve api testleri
 * (apps/api/src/videos/video-style.spec.ts) bu modulu yukler. Saf JavaScript: tarayici paketinde ve Node'da
 * calisir.
 *
 * NEDEN: 23.10.2026 sahip istegi — denenen ~20 acik kaynak video yaklasimindan begenilenler musterinin
 * panelde secebilecegi stillere donustu. Stil YALNIZ gorseldir: metin (sayi korumasi, validateScript),
 * tempo plani (src/tempo/plan.mjs), muzik (scripts/audio/styles.mjs), marka rengi / logo / ad ve filigran
 * her stilde ayni. Kaynaklar ve lisanslar: src/styles/CREDITS.md.
 *
 *   classic  bugunku sablonlar (varsayilan; stil alani olmayan eski kayit / is da bu)
 *   panel    acik Apple-yumusak arayuz kartlari, buyuk yazi, vurusa kilitli itme kesmeleri
 *   paper    kagit zemin, dar kinetik buyuk yazi, elle cizilmis isaretci notlari, sert acik/koyu donusler
 *   swiss    kagit + tek sinyal rengi (marka), siki izgara, tarama / bicak kesigi, izgaraya oturan modul
 *   chat     tum video tek sohbet: buyuyen giris kutusu, kullanici balonu, yaziyor noktalari, cevap balonu
 *   diagram  noktali kagit, akis semasi: dugumler + oklar, tarama cizgisi, cevreleme vurgulari
 *   footage  gercek stok goruntu zemini (yavas yakinlasma, sicak renk) + buzlu cam metin panelleri
 */

export const VIDEO_STYLES = ['classic', 'panel', 'paper', 'swiss', 'chat', 'diagram', 'footage'];
/** Yeni isteklerin ve stil alani olmayan eski kayitlarin stili (bugunku tasarim, pikseli pikseline) */
export const DEFAULT_STYLE = 'classic';

/**
 * Izin listesi denetimi. Bos / tanimsiz = classic (eski kayitlar, eski kuyruk isleri). Liste disi bir
 * deger HATA: istekten gelen bir dize asla dosya / modul secmez; api DTO zaten reddeder, buraya gelirse
 * kayit bozulmus demektir (sessizce classic'e donmek hatayi saklardi).
 */
export function parseStyle(v) {
  if (v === undefined || v === null || v === '') return DEFAULT_STYLE;
  if (typeof v === 'string' && VIDEO_STYLES.includes(v)) return v;
  throw new Error(`Bilinmeyen video stili: ${String(v).slice(0, 40)}`);
}

/** Remotion tarafi icin hatasiz okuma: liste disi deger (yalniz Studio'da elle girilebilir) classic */
export function normalizeStyle(v) {
  return typeof v === 'string' && VIDEO_STYLES.includes(v) ? v : DEFAULT_STYLE;
}

/**
 * Stil basina ek fontlar (public/fonts, OFL — public/fonts/OFL.txt). Sora + Plus Jakarta Sans her stilde
 * yuklenir. Hepsi tam (latin-ext) dosya: ş ğ ı İ â ç ö ü glifleri var (Google Fonts 'latin' alt kumesi
 * Turkce glifleri dusurur — kullanilmaz).
 */
export const STYLE_FONTS = {
  classic: [],
  panel: [],
  paper: [
    { family: 'Anton', file: 'fonts/Anton.ttf', weight: '400' },
    { family: 'Caveat', file: 'fonts/Caveat.ttf', weight: '400 700' },
  ],
  swiss: [{ family: 'Inter', file: 'fonts/Inter.ttf', weight: '100 900' }],
  chat: [],
  diagram: [{ family: 'Inter', file: 'fonts/Inter.ttf', weight: '100 900' }],
  footage: [],
};

/**
 * Okunurluk sozlesmesi: bir sahnenin metinleri sahne bitisinden kac kare ONCE cikmaya baslar (plan.mjs
 * EXIT ile ayni ya da daha gec — daha erken cikis okuma suresini kisaltirdi). Stiller sahne gecislerini
 * (itme, savrulma, sayfa cevirme) bu pencerenin icinde yapar; giris yaylari tempo cizelgesinin yaylaridir
 * (TL.snap / TL.soft). scripts/check-video-readability.mjs her stili bu degerlerle denetler.
 *   hook   kanca sahnesinin cikisi (makale e-6, site e-10, urun e-12)
 *   point  makale maddesinin cikisi (e-6); liste (site/urun) kartlari kapanisa dek kalir (endS-6)
 *   list   listenin cikisi: kapanistan kac kare once
 */
const CLASSIC_EXITS = {
  ArticleShort: { hook: 6, point: 6, list: 6 },
  SiteIntro: { hook: 10, point: 6, list: 6 },
  SiteIntroWide: { hook: 10, point: 6, list: 6 },
  ProductShort: { hook: 12, point: 6, list: 6 },
  ProductWide: { hook: 12, point: 6, list: 6 },
};
export const STYLE_EXITS = Object.fromEntries(VIDEO_STYLES.map((s) => [s, CLASSIC_EXITS]));

/**
 * 'footage' stilinin stok klipleri — Mixkit Stock Video Free License (https://mixkit.co/license/#videoFree):
 * ticari kullanim serbest, atif gerekmez, klipler TEK BASINA yeniden dagitilamaz -> git'e girmez
 * (apps/video/.gitignore public/stock/). Deploy'da `prepare:article-short` asagidaki adreslerden indirir ve
 * boyut + sha256 dogrular (degerler yerel kopyalardan kaydedildi, 23.10.2026). Secim notr: yuz one cikmayan
 * eller / omuz ustu cekimler — ekrandaki metin goruntudeki kisinin sozu ya da yorumu gibi okunmasin.
 *   use: [baslangic sn, bitis sn] klipte kullanilan aralik (42652'nin ikinci yarisinda yuz var)
 *   focus: dikey kirpmada yatay odak (0 sol .. 1 sag)
 */
export const STOCK_CLIPS = [
  {
    id: 'phone-hands',
    file: 'mixkit-4915-hands-typing-phone.mp4',
    url: 'https://assets.mixkit.co/videos/4915/4915-1080.mp4',
    page: 'https://mixkit.co/free-stock-video/hands-of-a-person-typing-on-a-cell-phone-4915/',
    bytes: 45616676,
    sha256: 'b086286c4ebd67f802b1d7acd4327a131033bc1003aad6865ffbabd8ad5136c1',
    use: [0, 15],
    focus: 0.52,
  },
  {
    id: 'laptop-hands',
    file: 'mixkit-42652-laptop-typing.mp4',
    url: 'https://assets.mixkit.co/videos/42652/42652-1080.mp4',
    page: 'https://mixkit.co/free-stock-video/entrepreneur-woman-typing-on-her-laptop-42652/',
    bytes: 38379427,
    sha256: '7fa316b8007b7a46b77c19737d8ab981b72a9ccd4ad7ac31caae2561024c8b40',
    use: [0, 5.2],
    focus: 0.3,
  },
  {
    id: 'office-desk',
    file: 'mixkit-42656-office-desk.mp4',
    url: 'https://assets.mixkit.co/videos/42656/42656-1080.mp4',
    page: 'https://mixkit.co/free-stock-video/thoughtful-woman-working-in-her-office-42656/',
    bytes: 29467886,
    sha256: '542055c001db9645e5c04fce8c818adf80e426b3da3822c9f6d23358161607ea',
    use: [0, 8.3],
    focus: 0.32,
  },
];
export const STOCK_DIR = 'stock';

/** Stilin render aninda public/ altinda bulunmasi gereken dosyalari (yalniz bu listeden; istekten yol gelmez) */
export function styleAssets(style) {
  const s = parseStyle(style);
  const fonts = STYLE_FONTS[s].map((f) => f.file);
  const stock = s === 'footage' ? STOCK_CLIPS.map((c) => ({ file: `${STOCK_DIR}/${c.file}`, bytes: c.bytes })) : [];
  return { fonts, stock };
}
