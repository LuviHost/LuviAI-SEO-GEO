/**
 * Site kimligi (`Site.id`) icin KANONIK bicim kurali.
 *
 * NEDEN: `sites` tablosu utf8mb4_unicode_ci harmanlamasiyla olusturuldu (init
 * migration). Bu harmanlama UCA 4.0.0 agirliklarini kullanir, PAD SPACE'tir ve
 * yok sayilan karakterleri/genislemeleri destekler (MySQL 8.4 Reference Manual,
 * "Unicode Character Sets"). Sonuc: 'CMSQ25...', 'Cmsq25...', sonu bosluklu
 * 'cmsq25... ', tam genislik (U+FF43) 'c' ile baslayan, araya sifir genislikli
 * bosluk (U+200B) ya da kontrol karakteri konmus yazim MySQL'de AYNI satiri
 * bulur (MySQL 8.4.6 uzerinde tek tek denendi). Bellek ici hiz siniri kovalari ise ham dizeyle
 * sayilir: persona sohbetinin gunluk site butcesi, SiteUserThrottlerGuard'in
 * saatlik model tavanlari ve site haritasi siniri her varyantta bos bir
 * kovayla basliyordu. Tek kimligin milyonlarca varyanti vardi.
 *
 * KURAL: kimlik kucuk harf ASCII alfabesindedir — [a-z0-9] ile baslar, devami
 * [a-z0-9_-], en fazla SITE_ID_MAX_LEN karakter. Prisma `@default(cuid())`
 * kucuk harf uretir (or. canli 'cmsq25bko005farswo54hf856'); tohum betigi
 * (prisma/seed.ts) ise sabit 'demo-luvihost' yazar. Bu yuzden kural cuid
 * uzunluguna degil alfabeye dayanir: kati bir cuid deseni tohum sitesini
 * kilitlerdi. Bu alfabedeki farkli dizeler harmanlamada da farklidir (1-3
 * karakterlik 56.354 dizenin tamami ayri cikti; buyuk harf, aksan, tam
 * genislik, bosluk ve yok sayilan karakter alfabede yok). Yani her site icin
 * kurala uyan TEK yazim vardir; kova anahtari olarak guvenlidir.
 *
 * Ikinci kapi: satir okunduktan sonra `site.id === istenen kimlik` denetimi
 * (SiteAccessGuard, herkese acik persona/site haritasi servisleri). Alfabede
 * olmayan bir kimlik semaya elle yazilmissa bile varyanti iceri giremez.
 *
 * Sema degisirse (or. ulid() buyuk harf uretir) bu kural da degismeli —
 * site-id.spec.ts semadaki varsayilani denetler.
 */
export const SITE_ID_MAX_LEN = 64;

const CANONICAL_SITE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Kimlik kanonik bicimde mi (yukaridaki kural)? */
export function isCanonicalSiteId(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_SITE_ID.test(value);
}

/** Kurala uymayan tum degerlerin paylastigi tek kova (bos kova uretilemesin) */
export const NON_CANONICAL_SITE_BUCKET = '!gecersiz';

/**
 * Hiz siniri kova anahtarinin site parcasi. Kanonik kimlik oldugu gibi;
 * parametre yoksa '-'; kurala uymayan HER deger tek ortak kovaya duser.
 *
 * Normalde kurala uymayan kimlik global SiteAccessGuard'da 404 alir ve kovaya
 * hic ulasmaz; bu ikinci savunma guard sirasi degisirse varyantlarin yine
 * yeni kova acamamasi icin.
 */
export function siteBucketKey(value: unknown): string {
  if (value === undefined || value === null || value === '') return '-';
  return isCanonicalSiteId(value) ? value : NON_CANONICAL_SITE_BUCKET;
}
