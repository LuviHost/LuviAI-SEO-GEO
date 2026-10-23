/**
 * RanksUp Video (makaleden, site tanitimi, urun tanitimi) — panel kurallari, saf (article-video.spec.mts).
 *
 * Kapi ve hak SUNUCUDA: plan ozelligi `articleVideo` (api billing/plans.ts, Profesyonel ve ustu)
 * ve aylik hak (VIDEOS_PER_MONTH) /sites/:id/videos/quota ile hazir gelir. Panel kural bilmez;
 * yalniz "yayinda mi", durum metni ve renk dogrulamasi gibi sunum kararlarini verir.
 */

export type ArticleVideoStatus = 'queued' | 'rendering' | 'ready' | 'failed';
export type VideoType = 'article' | 'site' | 'product';
export type VideoFormat = 'vertical' | 'horizontal';
/** api article-video.config.ts VIDEO_TEMPOS (= apps/video src/tempo/plan.mjs TEMPOS) */
export type VideoTempo = 'fast' | 'normal' | 'slow';
/** api article-video.config.ts VIDEO_STYLES (= apps/video src/styles/registry.mjs VIDEO_STYLES) */
export type VideoStyle = 'classic' | 'panel' | 'paper' | 'swiss' | 'chat' | 'diagram' | 'footage';

export interface ArticleVideo {
  id: string;
  /** Eski API yanitlarinda yok -> 'article' sayilir (videoTypeOf) */
  type?: VideoType;
  format?: VideoFormat;
  /** Eski API yanitlarinda / eski kayitlarda yok -> 'fast' (videoTempoOf) */
  tempo?: VideoTempo;
  /** Eski API yanitlarinda / eski kayitlarda yok -> 'classic' (videoStyleOf) */
  style?: VideoStyle;
  sourceUrl?: string | null;
  articleId: string | null;
  title: string;
  status: ArticleVideoStatus;
  videoUrl: string | null;
  posterUrl: string | null;
  durationSec: number | null;
  fileSize: number | null;
  error: string | null;
  copyStrategy: 'llm' | 'extractive' | null;
  brand: { name: string; primary: string | null; hasLogo: boolean } | null;
  createdAt: string;
  completedAt: string | null;
}

export interface VideoQuota {
  allowed: boolean;
  used: number;
  limit: number;
  remaining: number;
  unlimited: boolean;
}

export interface VideoBrandPreview {
  name: string;
  domain: string;
  primary: string | null;
  colorSource: string;
  /** Renk bulunamazsa sablonun kullandigi renk (sunucudan; panelde sabit renk yazilmaz) */
  fallbackPrimary: string;
  logoDataUri: string | null;
  notes: string[];
}

/** Urun adi ve kilitli onizleme metinleri — tek yer */
export const ARTICLE_VIDEO_COPY = {
  product: 'RanksUp Video',
  action: 'Video üret',
  lockedTitle: 'RanksUp Video Profesyonel planda',
  lockedBody: 'Yayındaki makalenden, sitenin ana sayfasından ya da sitendeki bir ürün/hizmet sayfasından; sitenin adı, logosu ve rengiyle kısa dikey video (Reels, Shorts, TikTok biçimi; 15–60 saniye, tempo ve görsel stil seçilebilir) üretir. Site ve ürün tanıtımında yatay 16:9 biçim de seçilebilir. Metin yalnız sitenin kendi cümlelerinden ve sayılarından oluşur.',
  lockedNote: 'Aşağıdaki bulanık görsel yalnızca yer tutucudur; video üretilmedi.',
  notPublished: 'Video yalnız yayındaki makaleden üretilir.',
} as const;

export const VIDEO_STATUS_LABEL: Record<ArticleVideoStatus, string> = {
  queued: 'Sırada',
  rendering: 'Hazırlanıyor',
  ready: 'Hazır',
  failed: 'Üretilemedi',
};

export const VIDEO_STATUS_TONE: Record<ArticleVideoStatus, 'neutral' | 'info' | 'success' | 'danger'> = {
  queued: 'neutral',
  rendering: 'info',
  ready: 'success',
  failed: 'danger',
};

/** Video turu etiketleri (liste rozeti ve tur secici) */
export const VIDEO_TYPE_LABEL: Record<VideoType, string> = {
  article: 'Makaleden',
  site: 'Site tanıtımı',
  product: 'Ürün tanıtımı',
};

/** Bicim secenekleri (sure tempoya bagli: VIDEO_TEMPO_SECONDS) */
export const VIDEO_FORMAT_OPTIONS: Record<Exclude<VideoType, 'article'>, Array<{ format: VideoFormat; label: string; hint: string }>> = {
  site: [
    { format: 'vertical', label: 'Dikey 9:16', hint: 'Reels, Shorts, TikTok' },
    { format: 'horizontal', label: 'Yatay 16:9', hint: 'Web sitesi ve YouTube' },
  ],
  product: [
    { format: 'vertical', label: 'Dikey 9:16', hint: 'Reels, Shorts, TikTok' },
    { format: 'horizontal', label: 'Yatay 16:9', hint: 'Web sitesi ve YouTube' },
  ],
};

/**
 * Tempo (21.10.2026): musteri videonun hizini secer; yeni isteklerde varsayilan 'normal'.
 * Hizli = eski sabit izgara (kisa metinler icin); normal ve yavasta sure metnin uzunlugundan
 * hesaplanir, her metin okunacak kadar ekranda kalir. Uc tempo da tek video hakki.
 */
export const VIDEO_TEMPOS: readonly VideoTempo[] = ['fast', 'normal', 'slow'];
export const DEFAULT_VIDEO_TEMPO: VideoTempo = 'normal';
export const VIDEO_TEMPO_LABEL: Record<VideoTempo, string> = { fast: 'Hızlı', normal: 'Normal', slow: 'Yavaş' };
export const VIDEO_TEMPO_HINT: Record<VideoTempo, string> = {
  fast: 'Kısa metinler için; uzun cümleler hızlı geçer.',
  normal: 'Her metin rahatça okunacak kadar ekranda kalır.',
  slow: 'Daha sakin geçişler ve en uzun okuma süresi.',
};

/**
 * Gorsel stil (23.10.2026): musteri videonun gorunumunu secer; yeni isteklerde varsayilan 'classic'
 * (bugunku tasarim). Stil yalniz gorsel: metin, sure (tempo), muzik, marka rengi / logo ve filigran ayni.
 * Her stil bir video hakki. Onizlemeler public/video-styles/<stil>.jpg (ornek render'lardan, mavi ornek marka).
 */
export const VIDEO_STYLES: readonly VideoStyle[] = ['classic', 'panel', 'paper', 'swiss', 'chat', 'diagram', 'footage'];
export const DEFAULT_VIDEO_STYLE: VideoStyle = 'classic';
export const VIDEO_STYLE_LABEL: Record<VideoStyle, string> = {
  classic: 'Klasik',
  panel: 'Panel',
  paper: 'Kâğıt',
  swiss: 'İsviçre',
  chat: 'Sohbet',
  diagram: 'Diyagram',
  footage: 'Gerçek görüntü',
};
export const VIDEO_STYLE_HINT: Record<VideoStyle, string> = {
  classic: 'Bugünkü tasarım: marka renginde sade kartlar.',
  panel: 'Açık arayüz kartları, büyük yazı, vuruşa oturan geçişler.',
  paper: 'Kâğıt zemin, iri kinetik yazı, elle çizilmiş işaretler.',
  swiss: 'Sıkı ızgara, tek vurgu rengi, keskin ve sade geçişler.',
  chat: 'Tüm video bir sohbet: soru, yazıyor, cevap balonları.',
  diagram: 'Noktalı kâğıtta akış şeması: kutular ve oklar.',
  footage: 'Gerçek stok görüntü üstünde buzlu cam paneller.',
};
/** Stil onizlemesi (statik, kucuk JPEG) */
export const videoStylePreview = (s: VideoStyle) => `/video-styles/${s}.jpg`;

/** Eski yanit / kayit (stil yok) bugunku tasarimla uretildi: 'classic' */
export function videoStyleOf(v: Pick<ArticleVideo, 'style'> | null | undefined): VideoStyle {
  return v?.style && (VIDEO_STYLES as readonly string[]).includes(v.style) ? v.style : 'classic';
}

/**
 * Yaklasik sure (sn) — tur.bicim x tempo, [en kisa, en uzun]. ELLE YAZILMAZ: apps/video
 * `node scripts/check-video-readability.mjs` en kisa / en uzun / rastgele metinlerle hesaplar ve bu
 * tabloyu dogrular (fast tam; normal ve yavas 5 sn'ye yuvarlanmis). Tempo ya da sablon degisirse
 * denetim kirilir; degerleri denetimin yazdigi hesapla guncelle.
 */
export const VIDEO_TEMPO_SECONDS: Record<string, Record<VideoTempo, [number, number]>> = {
  'article.vertical': { fast: [15, 15], normal: [20, 50], slow: [25, 60] },
  'site.vertical': { fast: [15, 15], normal: [15, 45], slow: [25, 60] },
  'site.horizontal': { fast: [24, 24], normal: [15, 45], slow: [25, 60] },
  'product.vertical': { fast: [15, 15], normal: [15, 50], slow: [25, 60] },
  'product.horizontal': { fast: [15, 15], normal: [15, 50], slow: [25, 60] },
};

/** "15 sn" ya da "20–50 sn" (tur + bicim + tempo) */
export function tempoDurationLabel(type: VideoType, format: VideoFormat, tempo: VideoTempo): string {
  const row = VIDEO_TEMPO_SECONDS[`${type}.${type === 'article' ? 'vertical' : format}`] ?? VIDEO_TEMPO_SECONDS['article.vertical'];
  const [lo, hi] = row[tempo];
  return lo === hi ? `${lo} sn` : `${lo}–${hi} sn`;
}

/** Eski yanit / kayit (tempo yok) eski sabit izgarayla uretildi: 'fast' */
export function videoTempoOf(v: Pick<ArticleVideo, 'tempo'> | null | undefined): VideoTempo {
  return v?.tempo === 'normal' || v?.tempo === 'slow' || v?.tempo === 'fast' ? v.tempo : 'fast';
}

/** Eski yanitlar (type alani yok) makale videosudur */
export function videoTypeOf(v: Pick<ArticleVideo, 'type'> | null | undefined): VideoType {
  return v?.type === 'site' || v?.type === 'product' ? v.type : 'article';
}

/**
 * Iki etiketli kayitli alan adi sonekleri — api audit/host-match.ts MULTI_PART_SUFFIXES ile AYNI
 * liste (article-video.spec.mts iki dosyayi karsilastirir). Panel yalniz ipucu verir; asil kural
 * sunucuda (videos/promo-video-source.ts assertOwnSitePageUrl).
 */
export const MULTI_PART_SUFFIXES = [
  'com.tr', 'net.tr', 'org.tr', 'gov.tr', 'edu.tr', 'k12.tr', 'gen.tr', 'biz.tr', 'info.tr',
  'web.tr', 'av.tr', 'bel.tr', 'pol.tr', 'tsk.tr', 'name.tr', 'tel.tr', 'dr.tr',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk',
  'com.au', 'net.au', 'org.au', 'co.jp', 'co.nz', 'com.br', 'com.mx', 'co.in', 'co.za', 'com.cy',
];

function registrable(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, '').replace(/\.$/, '').split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  return MULTI_PART_SUFFIXES.includes(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Urun sayfasi adresi ipucu: bos ya da gecerliyse null, degilse Turkce aciklama. Sunucuyla ayni
 * kural: sitenin kayitli alan adi (www ve alt alan adlari dahil), IP yok, http(s), kimlik yok.
 */
export function productUrlProblem(pageUrl: string, siteUrl: string): string | null {
  const text = pageUrl.trim();
  if (!text) return null;
  if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(text) && !/^https?:\/\//i.test(text)) return 'Yalnız http ya da https adresleri kabul edilir.';
  let u: URL;
  let site: URL;
  try {
    u = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    site = new URL(siteUrl);
  } catch {
    return 'Adres geçerli değil. Tam adresi yapıştır (ör. https://siten.com/urun).';
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'Yalnız http ya da https adresleri kabul edilir.';
  if (u.username || u.password) return 'Adres kullanıcı adı ya da şifre içeremez.';
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (IPV4.test(host) || host.includes(':')) return 'IP adresiyle değil, sitenin alan adıyla gir.';
  const reg = registrable(site.hostname);
  const h = host.toLowerCase().replace(/\.$/, '');
  if (registrable(h) !== reg || !(h === reg || h.endsWith(`.${reg}`))) return `Ürün sayfası sitenin kendi alan adında (${reg}) olmalı.`;
  return null;
}

/** Video istenebilir mi (sunucu da ayni kurali uygular: yalniz PUBLISHED) */
export function canRequestVideo(article: { status?: unknown } | null | undefined): boolean {
  return article?.status === 'PUBLISHED';
}

/** Liste yoklamasi: sirada ya da hazirlanan video varsa panel birkac saniyede bir tazeler */
export function hasActiveVideos(videos: ReadonlyArray<Pick<ArticleVideo, 'status'>> | null | undefined): boolean {
  return (videos ?? []).some((v) => v.status === 'queued' || v.status === 'rendering');
}

/** Bu makale icin suren video var mi (ikinci istek sunucuda 409 doner; dugme once kilitlenir) */
export function activeVideoFor(videos: ReadonlyArray<Pick<ArticleVideo, 'status' | 'articleId'>> | null | undefined, articleId: string): boolean {
  return (videos ?? []).some((v) => v.articleId === articleId && (v.status === 'queued' || v.status === 'rendering'));
}

/**
 * Ayni kaynak + bicim icin suren tanitim videosu var mi (sunucu 409 doner; dugme once kilitlenir).
 * Urun adresi karsilastirmasi parcasiz (#) yapilir — sunucu da # kismini atar.
 */
export function activePromoVideo(
  videos: ReadonlyArray<Pick<ArticleVideo, 'status' | 'type' | 'format' | 'sourceUrl'>> | null | undefined,
  type: 'site' | 'product',
  format: VideoFormat,
  pageUrl?: string,
): boolean {
  const strip = (u: string | null | undefined) => String(u ?? '').trim().replace(/#.*$/, '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/$/, '').toLowerCase();
  return (videos ?? []).some((v) =>
    (v.status === 'queued' || v.status === 'rendering')
    && videoTypeOf(v) === type
    && (v.format ?? 'vertical') === format
    && (type === 'site' || strip(v.sourceUrl) === strip(pageUrl)));
}

/** Renk secici degeri: yalniz #rrggbb (kucuk harf); 3 haneli kisa yazim acilir; degilse null */
export function normalizeHex(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return `#${h.toLowerCase()}`;
}

/**
 * Istek govdesi: kullanicinin duzeltmeleri. Renk sayfadakiyle ayniysa gonderilmez (sunucu yine
 * sitenin rengini kullanir); "sablon rengi" secildiyse null. Ad degismediyse gonderilmez.
 */
/** Videonun kaynagi: makale, site tanitimi ya da urun tanitimi (panelden sunucuya) */
export type VideoTarget =
  | { type: 'article'; articleId: string }
  | { type: 'site'; format: VideoFormat }
  | { type: 'product'; pageUrl: string; format: VideoFormat };

export interface VideoRequestBody {
  type?: 'site' | 'product';
  articleId?: string;
  pageUrl?: string;
  format?: VideoFormat;
  tempo?: VideoTempo;
  style?: VideoStyle;
  primaryColor?: string | null;
  useLogo: boolean;
  brandName?: string;
}

export function videoRequestBody(input: {
  /** geriye uyum: yalniz articleId verilirse makale videosu */
  articleId?: string;
  target?: VideoTarget;
  brand: Pick<VideoBrandPreview, 'name' | 'primary'> | null;
  color: string | null;
  useTemplateColor: boolean;
  useLogo: boolean;
  name: string;
  /** secilen tempo; verilmezse alan gonderilmez (sunucu varsayilani 'normal') */
  tempo?: VideoTempo;
  /** secilen gorsel stil; verilmezse alan gonderilmez (sunucu varsayilani 'classic') */
  style?: VideoStyle;
}): VideoRequestBody {
  const target: VideoTarget = input.target ?? { type: 'article', articleId: input.articleId ?? '' };
  // Makale govdesi eskisiyle birebir ({ articleId, ... } — type alani yok): eski API surumleriyle uyumlu
  const body: VideoRequestBody = target.type === 'article'
    ? { articleId: target.articleId, useLogo: input.useLogo }
    : target.type === 'site'
      ? { type: 'site', format: target.format, useLogo: input.useLogo }
      : { type: 'product', pageUrl: target.pageUrl.trim(), format: target.format, useLogo: input.useLogo };
  if (input.tempo && VIDEO_TEMPOS.includes(input.tempo)) body.tempo = input.tempo;
  if (input.style && VIDEO_STYLES.includes(input.style)) body.style = input.style;
  if (input.useTemplateColor) body.primaryColor = null;
  else {
    const c = normalizeHex(input.color);
    if (c && c !== (input.brand?.primary ?? null)) body.primaryColor = c;
  }
  const name = input.name.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (name && name !== (input.brand?.name ?? '')) body.brandName = name;
  return body;
}

/** "3 / 20 video kullanıldı · 17 kaldı" — sinirsiz (yonetici) ve kapali plan ayri metin */
export function quotaLine(q: VideoQuota | null | undefined): string | null {
  if (!q) return null;
  if (q.unlimited) return 'Yönetici hesabı: video hakkı sınırı uygulanmaz.';
  if (!q.allowed || q.limit <= 0) return null;
  return `Bu ay ${q.used} / ${q.limit} video kullanıldı · ${q.remaining} kaldı`;
}

/** Indirme dosya adi: makale basligindan ASCII slug + .mp4 */
export function videoFileName(title: string, id: string): string {
  const map: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', İ: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', Ö: 'o', Ş: 's', Ü: 'u' };
  const slug = title
    .replace(/[çğıİöşüÇĞÖŞÜ]/g, (c) => map[c] ?? c)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'ranksup-video'}-${id.slice(-6)}.mp4`;
}

/** "4,2 MB" */
export function formatVideoSize(bytes: number | null | undefined): string | null {
  if (!bytes || bytes <= 0) return null;
  const mb = bytes / (1024 * 1024);
  return `${mb.toLocaleString('tr-TR', { maximumFractionDigits: 1, minimumFractionDigits: mb < 10 ? 1 : 0 })} MB`;
}
