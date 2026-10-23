import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isCanonicalSiteId } from '../common/site-id.js';

/**
 * RanksUp Video — sabitler ve yollar (tek yer).
 *
 * Aylik video hakki burada DEGIL: billing/plans.ts VIDEOS_PER_MONTH (fiyat karti ve kota ayni
 * tablodan okur).
 */

/** BullMQ kuyrugu — luviai-jobs'tan AYRI: render uzun ve CPU agir, diger isleri bekletmesin */
export const VIDEO_RENDER_QUEUE = 'video-render';

/**
 * Worker'da bu kuyrugun is eszamanliligi. 1 = ayni anda tek video; bir videonun icindeki kare
 * eszamanliligi ayrica VIDEO_RENDER_CONCURRENCY (apps/video render/article-short.mjs
 * renderConcurrency: cekirdek/2, en cok 4). Ikisi carpilmasin diye is eszamanliligi sabit 1.
 */
export const VIDEO_RENDER_JOB_CONCURRENCY = 1;

/** Video metni modeli — sahip karari: Claude Haiku 5.5 (ucuz, kisa yapisal cikti) */
export const VIDEO_COPY_MODEL = 'claude-haiku-5-5';
export const VIDEO_COPY_CONTEXT = 'article-video-copy';

/** providerRaw.engine — bu ozelligin Video satirlarini eski Video Factory satirlarindan ayirir */
export const ARTICLE_SHORT_ENGINE = 'article-short';

/** Videonun sonunda ve kancada kucuk "ranksup.ai ile uretildi" yazisi (ArticleShort watermark) */
export const VIDEO_WATERMARK = true;

/**
 * Takili video supurucusu: bu sureden uzun PENDING/GENERATING kalan ve BullMQ'da canli isi
 * olmayan video FAILED olur, hakki iade edilir. Kuyrukta bekleyen (waiting/delayed/active) is
 * VIDEO_STUCK_HARD_MS'e kadar beklenir (uzun kuyruk mesru olabilir).
 */
export const VIDEO_STUCK_MS = 45 * 60_000;
export const VIDEO_STUCK_HARD_MS = 6 * 60 * 60_000;

/**
 * Tek render isinin (marka + metin + render + loudnorm + poster) toplam suresi. Asilirsa is
 * FAILED + tek iade olur, Chrome/ffmpeg alt surecleri oldurulur, gecici dosyalar silinir.
 * NEDEN: kuyruk eszamanliligi 1; takilan tek is (yavas logo sunuculari, kilitlenen Chrome)
 * herkesin videosunu saatlerce bekletiyordu. Olculen normal render 1-3 dk.
 */
export const VIDEO_RENDER_TIMEOUT_MS = 15 * 60_000;

/** Kuyruk (Redis) islemlerinin ust siniri: Redis yokken add() sonsuza dek beklemesin */
export const VIDEO_QUEUE_OP_TIMEOUT_MS = 10_000;

/** Ayni kaynak (makale / site / urun sayfasi) icin es zamanli iki istegi (cift tiklama) engelleyen kilidin omru */
export const VIDEO_REQUEST_LOCK_MS = 60_000;

/**
 * Video turleri (21.10.2026 sahip istegi: "site tanitimi" ve "urun tanitimi"). Uc tur de AYNI
 * aylik hakki (users.videosUsedThisMonth) ve ayni 'video-render' kuyrugunu kullanir; tur ve bicim
 * Video satirinda providerRaw.videoType / providerRaw.format olarak durur (migration yok).
 */
export const VIDEO_TYPES = ['article', 'site', 'product'] as const;
export type VideoType = (typeof VIDEO_TYPES)[number];
export const VIDEO_FORMATS = ['vertical', 'horizontal'] as const;
export type VideoFormat = (typeof VIDEO_FORMATS)[number];

/**
 * Tur + bicim -> Remotion kompozisyonu (apps/video src/Root.tsx; render/article-short.mjs
 * VIDEO_COMPOSITIONS ayni listeyi tutar ve liste disini reddeder). null = bu turde o bicim yok.
 */
export const VIDEO_COMPOSITION: Record<VideoType, Record<VideoFormat, string | null>> = {
  article: { vertical: 'ArticleShort', horizontal: null },
  site: { vertical: 'SiteIntro', horizontal: 'SiteIntroWide' },
  product: { vertical: 'ProductShort', horizontal: 'ProductWide' },
};

/**
 * Tempo (21.10.2026 sahip istegi: 15 sn videolar okunamayacak kadar hizli). apps/video
 * src/tempo/plan.mjs TEMPOS ile AYNI liste (video-tempo.spec.ts karsilastirir):
 *   fast   eski sabit izgara (15 sn dikey, 24 sn yatay site) — "kisa metinler icin"
 *   normal okunur: her metin max(2 sn; 0,3 sn x kelime + 1 sn) ekranda; sure metinden (~15-50 sn)
 *   slow   rahat (~1,5 kat normal; en fazla 60 sn)
 * Yeni istekte verilmezse 'normal'. providerRaw.tempo'da durur; alani olmayan eski satir / is 'fast'
 * sayilir (o video eski izgarayla istendi ve oyle render edilir). Uc tempo da tek video hakki.
 */
export const VIDEO_TEMPOS = ['fast', 'normal', 'slow'] as const;
export type VideoTempo = (typeof VIDEO_TEMPOS)[number];
export const DEFAULT_VIDEO_TEMPO: VideoTempo = 'normal';
/** providerRaw.tempo yoksa (bu ozellikten onceki kayit / kuyruktaki is) */
export const LEGACY_VIDEO_TEMPO: VideoTempo = 'fast';
export function videoTempoOf(raw: unknown): VideoTempo {
  const t = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).tempo : undefined;
  return (VIDEO_TEMPOS as readonly unknown[]).includes(t) ? (t as VideoTempo) : LEGACY_VIDEO_TEMPO;
}

/**
 * Gorsel stil (23.10.2026 sahip istegi: denenen acik kaynak video yaklasimlarindan begenilenler secilebilir
 * stil). apps/video src/styles/registry.mjs VIDEO_STYLES ile AYNI liste (video-style.spec.ts karsilastirir):
 *   classic  bugunku tasarim (varsayilan)     panel    acik arayuz kartlari, buyuk yazi, itme kesmeleri
 *   paper    kagit + kinetik yazi + isaretci   swiss    izgara + tek sinyal rengi (marka)
 *   chat     tum video tek sohbet              diagram  noktali kagit, dugum + ok akis semasi
 *   footage  gercek stok goruntu + buzlu cam panel (klipler deploy'da indirilir — prepare:article-short)
 * Stil YALNIZ gorsel: metin, sayi korumasi, tempo plani, muzik, marka rengi / logo ve filigran ayni.
 * providerRaw.style'da durur (migration yok); alani olmayan eski satir / is 'classic'. Her stil tek video hakki.
 */
export const VIDEO_STYLES = ['classic', 'panel', 'paper', 'swiss', 'chat', 'diagram', 'footage'] as const;
export type VideoStyle = (typeof VIDEO_STYLES)[number];
export const DEFAULT_VIDEO_STYLE: VideoStyle = 'classic';
/** DTO ve servisin ortak dogrulama mesaji: "style 'classic', ... ya da 'footage' olmalı." */
export const VIDEO_STYLE_MESSAGE = `style ${VIDEO_STYLES.map((s) => `'${s}'`).join(', ').replace(/, ([^,]*)$/, ' ya da $1')} olmalı.`;
/** providerRaw.style yoksa / liste disiysa (bu ozellikten onceki kayit, elle bozulmus satir) */
export function videoStyleOf(raw: unknown): VideoStyle {
  const s = raw && typeof raw === 'object' ? (raw as Record<string, unknown>).style : undefined;
  return (VIDEO_STYLES as readonly unknown[]).includes(s) ? (s as VideoStyle) : DEFAULT_VIDEO_STYLE;
}

/** Video satirinin en-boy orani (videos.aspectRatio sutunu) */
export const ASPECT_OF: Record<VideoFormat, string> = { vertical: '9:16', horizontal: '16:9' };

/** Tanitim videolarinin kaynak sayfasi (anasayfa / urun sayfasi) indirme tavani */
export const PROMO_PAGE_MAX_BYTES = 2 * 1024 * 1024;
/** Kullanicinin girdigi urun sayfasi adresinin en fazla uzunlugu */
export const PROMO_PAGE_URL_MAX = 2000;

/**
 * Urun gorseli: GUVENILMEYEN ikili. safe-fetch ile en fazla PRODUCT_IMAGE_MAX_BYTES indirilir,
 * sharp piksel tavaniyla (decompression bomb) cozer, en fazla PRODUCT_IMAGE_MAX_PX kenara kucultup
 * JPEG/PNG'ye cevirir; SVG hic kabul edilmez. Cikti tavani asilirsa gorselsiz devam edilir.
 */
export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PRODUCT_IMAGE_MAX_INPUT_PIXELS = 40_000_000;
export const PRODUCT_IMAGE_MIN_PX = 200;
export const PRODUCT_IMAGE_MAX_PX = 1280;
export const PRODUCT_IMAGE_MAX_OUTPUT_BYTES = 900_000;
/** Denenecek en fazla gorsel adayi (Product image, og:image ...) */
export const PRODUCT_IMAGE_MAX_CANDIDATES = 3;

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Cikti dizini: nginx /videos/ yolunu apps/api/public/videos/'a alias'lar (eski Video Factory
 * ile ayni; .gitignore'da). Dosyalar <dizin>/<siteId>/<videoId>.mp4 + .jpg.
 * src/videos (vitest) ve dist/videos (uretim) ikisinden de ../../public/videos = apps/api/public/videos.
 */
export function videoOutputDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.VIDEO_OUTPUT_DIR || path.resolve(HERE, '../../public/videos');
}

/** Herkese acik adres koku (eski Video Factory ile ayni degisken ve varsayilan) */
export function videoPublicBase(env: NodeJS.ProcessEnv = process.env): string {
  return (env.VIDEO_PUBLIC_BASE || 'https://ranksup.ai/videos').replace(/\/+$/, '');
}

/** Dosya yollari ve adresler — kimlikler kanonik cuid (yol enjeksiyonu yok; yine de suzulur) */
export function videoFiles(siteId: string, videoId: string, env: NodeJS.ProcessEnv = process.env) {
  // Site kimligi kanonik alfabede (common/site-id.ts; tohum sitesi 'demo-luvihost' dahil),
  // video kimligi cuid: ikisi de yol ayiraci / '..' tasiyamaz
  if (!isCanonicalSiteId(siteId)) throw new Error(`Gecersiz site kimligi: ${String(siteId).slice(0, 40)}`);
  const safe = (s: string) => {
    if (!/^[a-z0-9]{8,40}$/.test(s)) throw new Error(`Gecersiz video kimligi: ${String(s).slice(0, 40)}`);
    return s;
  };
  const dir = path.join(videoOutputDir(env), siteId);
  const base = videoPublicBase(env);
  return {
    dir,
    mp4: path.join(dir, `${safe(videoId)}.mp4`),
    poster: path.join(dir, `${videoId}.jpg`),
    videoUrl: `${base}/${siteId}/${videoId}.mp4`,
    posterUrl: `${base}/${siteId}/${videoId}.jpg`,
  };
}

/**
 * Bir videonun TUM dosyalari: mp4, poster ve render hattinin gecici dosyalari
 * (<id>.mp4.part.mp4, <id>.mp4.part.ln.mp4, <id>.jpg.part.jpg). Gecici dosyalar normalde
 * render/article-short.mjs finally'sinde silinir; surec cokerse (OOM, SIGKILL) herkese acik
 * dizinde kalirdi. Silme, basarisiz sayma ve supurucu bu yardimciyi kullanir. En iyi caba.
 */
export async function removeVideoFiles(siteId: string, videoId: string, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  let f: ReturnType<typeof videoFiles>;
  try {
    f = videoFiles(siteId, videoId, env);
  } catch {
    return;
  }
  const prefixes = [`${path.basename(f.mp4)}.part`, `${path.basename(f.poster)}.part`];
  const names = await readdir(f.dir).catch(() => [] as string[]);
  const parts = names.filter((n) => prefixes.some((p) => n.startsWith(p))).map((n) => path.join(f.dir, n));
  await Promise.all([f.mp4, f.poster, ...parts].map((p) => rm(p, { force: true }).catch(() => undefined)));
}

/**
 * Sitenin tum video dosyalarini sil (site silme / hesabin kalici silinmesi). Video satirlari
 * silme planlarinda (sites.service siteRemovalSteps, account-purge.plan) DB'den gider ama
 * dosyalar diskte ve herkese acik adreste kalirdi. En iyi caba: hata loglanir, silme durmaz.
 */
export async function removeSiteVideoFiles(siteId: string, env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  if (!isCanonicalSiteId(siteId)) return false;
  try {
    await rm(path.join(videoOutputDir(env), siteId), { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
