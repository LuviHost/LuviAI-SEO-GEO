/**
 * Musteri raporu PAYLASIMI — anahtar, token ve snapshot kurallari (saf).
 *
 * DEPOLAMA: kv_store (yeni tablo/migration YOK). NEDEN:
 *  - kv_store'da `expiresAt` kolonu ve gunluk temizlik isi (common/kv-sweep.cron)
 *    zaten var: 30 gunluk sure dolunca satir kendiliginden silinir.
 *  - Site silme ve hesap silme kv_store'da site kimligini ICEREN anahtarlari
 *    siler (sites.service siteKvFilter, account-purge.plan). Anahtar bu yuzden
 *    siteId'yi tasir: site silinince paylasilan rapor da yayindan kalkar.
 *  - SiteReport tablosu donem raporlarinin GECMISI; paylasim snapshot'i oraya
 *    yazilsaydi "calistirilan rapor" listesine karisirdi.
 *
 * ANAHTAR: `musteri-raporu:<token>:<siteId>`. Token onde: herkese acik okuma
 * yalniz token bilir ve `startsWith('musteri-raporu:<token>:')` birincil anahtar
 * araliginda okunur (tam tarama yok). Site listesi `startsWith(onek)` +
 * `endsWith(':<siteId>')` ile okunur.
 *
 * GUVENLIK: token 24 rastgele bayt (base64url, 32 karakter) — tahmin edilemez.
 * Liste ucu herkese acik degil; geri alma satiri siler; sure dolunca 404.
 */
import { randomBytes } from 'node:crypto';
import type { MusteriRaporu } from './client-report.types.js';

export const PAYLASIM_ONEKI = 'musteri-raporu:';
/** Herkese acik uc ve web sayfasi ayni deseni dogrular (DB'ye gitmeden 404) */
export const RAPOR_TOKEN_DESENI = /^[A-Za-z0-9_-]{32,64}$/;
export const VARSAYILAN_GUN = 30;
export const EN_AZ_GUN = 1;
export const EN_COK_GUN = 90;
/** Site basina etkin baglanti siniri — kv_store'u sisirmesin, unutulan linkler birikmesin */
export const SITE_BASINA_PAYLASIM = 20;
/**
 * kv_store.value MySQL TEXT: en fazla 65.535 BAYT. Turkce karakterler 2 bayt;
 * sinir bayt uzerinden, pay birakilarak.
 */
export const SNAPSHOT_EN_COK_BAYT = 60_000;

export function yeniToken(): string {
  return randomBytes(24).toString('base64url');
}

export function gecerliToken(token: unknown): token is string {
  return typeof token === 'string' && RAPOR_TOKEN_DESENI.test(token);
}

export function paylasimAnahtari(token: string, siteId: string): string {
  return `${PAYLASIM_ONEKI}${token}:${siteId}`;
}

/** Herkese acik okuma: token onekiyle birincil anahtar araligi */
export function tokenOneki(token: string): string {
  return `${PAYLASIM_ONEKI}${token}:`;
}

/** Anahtardan token ve site — bicim bozuksa null */
export function anahtarCoz(key: string): { token: string; siteId: string } | null {
  if (!key.startsWith(PAYLASIM_ONEKI)) return null;
  const rest = key.slice(PAYLASIM_ONEKI.length);
  const i = rest.indexOf(':');
  if (i <= 0) return null;
  const token = rest.slice(0, i);
  const siteId = rest.slice(i + 1);
  return gecerliToken(token) && siteId ? { token, siteId } : null;
}

/** Gecerlilik suresi (gun): sayi degilse varsayilan, aralik disi sikistirilir */
export function gecerliGun(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n)) return VARSAYILAN_GUN;
  return Math.min(EN_COK_GUN, Math.max(EN_AZ_GUN, Math.trunc(n)));
}

export interface PaylasimKaydi {
  v: 1;
  siteId: string;
  olusturan: string | null;
  olusturuldu: string;
  sonGecerlilik: string;
  rapor: MusteriRaporu;
}

function bayt(s: string): number {
  return Buffer.byteLength(s, 'utf8');
}

/**
 * Snapshot TEXT kolonuna sigsin. Once ornek adresler 10 → 3 → 0'a, sonra
 * soru listesi kisaltilir; her kisaltma rapora not olarak duser (sessiz veri
 * kaybi yok). Yine sigmazsa hata — kayit yarim yazilmaz.
 */
export function snapshotSigdir(kayit: PaylasimKaydi): string {
  let json = JSON.stringify(kayit);
  if (bayt(json) <= SNAPSHOT_EN_COK_BAYT) return json;
  const kopya: PaylasimKaydi = JSON.parse(json);
  const r = kopya.rapor;
  const notEkle = (n: string) => { if (!r.yontem.includes(n)) r.yontem.push(n); };
  for (const sinir of [3, 0]) {
    if (!r.seo.olculemedi) {
      for (const s of r.seo.sayfaSorunlari) {
        if (s.ornekler.length > sinir) {
          s.ornekler = s.ornekler.slice(0, sinir);
          s.ornekNotu = sinir === 0 ? 'Paylaşılan raporda yer kısıtı nedeniyle örnek adresler çıkarıldı.' : `Paylaşılan raporda ilk ${sinir} örnek gösteriliyor.`;
        }
      }
    }
    notEkle('Paylaşılan rapor boyut sınırı nedeniyle kısaltıldı; tam liste panelde görülebilir.');
    json = JSON.stringify(kopya);
    if (bayt(json) <= SNAPSHOT_EN_COK_BAYT) return json;
  }
  if (!r.ai.olcum.olculemedi && r.ai.olcum.sorgular.length > 20) {
    r.ai.olcum.sorgular = r.ai.olcum.sorgular.slice(0, 20);
    json = JSON.stringify(kopya);
    if (bayt(json) <= SNAPSHOT_EN_COK_BAYT) return json;
  }
  throw new Error('RAPOR_COK_BUYUK');
}
