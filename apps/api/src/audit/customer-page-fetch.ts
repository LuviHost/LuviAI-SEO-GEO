import {
  safeFetchText, SafeFetchError, type SafeFetchErrorCode, type SafeTextOptions,
} from '../common/safe-fetch.js';
import { detectBlock, unblockHint, type BlockSignal } from '../common/block-detect.js';

/**
 * Musteri sayfasini (ya da taranan sayfadan gelen adresi) okuma — denetim
 * servislerinin ortak kapisi.
 *
 * NEDEN VAR: GEO calistiricisi, snippet uretici, statik HTML yazicisi, takili
 * sayfa kurtarma ve alt metni dogrulamasi ayni "cek → durum koduna bak →
 * govdeyi tavanla oku" kodunu ayri ayri tasiyordu ve hicbiri
 *   (a) ic aga / bulut metadata adresine giden URL'yi (SSRF) reddetmiyor,
 *   (b) guvenlik duvari / bot dogrulama sayfasini sayfa iceriginden ayirmiyordu.
 * (b) sessiz ama pahali: 200 donen bir "Just a moment..." sayfasi icerik sanilip
 * puanlaniyor, statik HTML yazicisinda ise yamalanip musterinin dosyasinin
 * yerine yazilabiliyordu.
 */

export interface CustomerPageOk {
  kind: 'ok';
  text: string;
  /** Govde tavanda kesildi — yazma yapan cagiran bunu REDDETMELI */
  truncated: boolean;
  /** Yonlendirmelerden sonraki son adres */
  url: string;
  status: number;
  contentType: string;
  /**
   * Sayfanin bildirdigi karakter kumesi (HTTP basligi, yoksa <meta charset>);
   * bildirilmemisse null. Kucuk harf.
   */
  charset: string | null;
}

/** Bize kapali: WAF, bot dogrulamasi, giris, hiz siniri, 503 — sayfa bozuk DEGIL */
export interface CustomerPageBlocked {
  kind: 'blocked';
  signal: BlockSignal;
}

/** Okunamadi: 404/500, zaman asimi, DNS, ic adres, metin disi icerik... */
export interface CustomerPageFailed {
  kind: 'failed';
  code: SafeFetchErrorCode | 'binary';
  /** HTTP yanit geldiyse durum kodu */
  status: number | null;
  contentType?: string;
}

export type CustomerPageFailure = CustomerPageBlocked | CustomerPageFailed;
export type CustomerPage = CustomerPageOk | CustomerPageFailure;

/** Bildirilen karakter kumesi — once HTTP basligi, sonra <meta charset> (safe-fetch.ts ile ayni sira) */
function declaredCharset(rawContentType: string, text: string): string | null {
  const fromHeader = /charset\s*=\s*"?([\w.:-]+)/i.exec(rawContentType)?.[1];
  if (fromHeader) return fromHeader.toLowerCase();
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(text.slice(0, 4096))?.[1];
  return fromMeta ? fromMeta.toLowerCase() : null;
}

/**
 * Sayfayi SSRF korumali okur (bkz. common/safe-fetch.ts), engel sayfasini
 * ayirir. Hata ATMAZ — her durum donus degerindedir.
 */
export async function fetchCustomerPage(url: string, opts: SafeTextOptions = {}): Promise<CustomerPage> {
  let res;
  try {
    res = await safeFetchText(url, opts);
  } catch (err) {
    return { kind: 'failed', code: err instanceof SafeFetchError ? err.code : 'network', status: null };
  }
  // Durum kodundan ONCE: dogrulama ekrani 200 ile de gelebilir
  const signal = detectBlock(res);
  if (signal) return { kind: 'blocked', signal };
  if (!res.ok) return { kind: 'failed', code: 'http', status: res.status };
  if (res.binary) return { kind: 'failed', code: 'binary', status: res.status, contentType: res.contentType };
  return {
    kind: 'ok',
    text: res.text,
    truncated: res.truncated,
    url: res.url,
    status: res.status,
    contentType: res.contentType,
    charset: declaredCharset(res.headers['content-type'] ?? '', res.text),
  };
}

/** UTF-8 disinda bir karakter kumesi bildiriyor mu? (yazicilar UTF-8 yazar) */
export function declaresNonUtf8(page: Pick<CustomerPageOk, 'charset'>): boolean {
  return !!page.charset && !/^utf-?8$/i.test(page.charset);
}

/**
 * Okunan sayfa duzenlenip musterinin dosyasinin YERINE yazilabilir mi?
 * Yazicilar UTF-8 yazar (sftp.ts Buffer.from(.., 'utf8'), cPanel
 * charset=utf-8). Sayfa baska bir karakter kumesi bildiriyorsa geri yazilan
 * dosyada Turkce harfler bozulur; hic bildirmiyor ama govde gecerli UTF-8
 * degilse (cozumde U+FFFD olustu) bozuk karakterler kalici hale gelir.
 * Sorun yoksa null, varsa kullaniciya gosterilecek neden.
 */
export function rewriteCharsetProblem(page: Pick<CustomerPageOk, 'charset' | 'text'>): string | null {
  if (declaresNonUtf8(page)) {
    return `Sayfa ${page.charset} karakter kümesiyle sunuluyor; otomatik yazım UTF-8 yaptığı için Türkçe karakterler bozulur — manuel uygula`;
  }
  if (page.text.includes('�')) {
    return 'Sayfa geçerli UTF-8 değil; otomatik yazım bozuk karakterleri kalıcı hale getirir — manuel uygula';
  }
  return null;
}

/** Kullaniciya gosterilecek tek cumlelik neden (engelde: nasil izin verilecegi dahil) */
export function pageFailureText(page: CustomerPageFailure): string {
  if (page.kind === 'blocked') return `${page.signal.reason} ${unblockHint(page.signal)}`;
  switch (page.code) {
    case 'http': return `Sayfa HTTP ${page.status} döndü.`;
    case 'binary': return `Adres bir HTML sayfası değil (${page.contentType || 'bilinmeyen tür'}).`;
    case 'timeout': return 'Sayfa zamanında yanıt vermedi.';
    case 'dns': return 'Alan adı çözülemedi.';
    case 'blocked_address': return 'Adres iç ağa ya da özel bir IP adresine çıkıyor; güvenlik nedeniyle okunmadı.';
    case 'protocol': return 'Adres geçersiz ya da desteklenmiyor (yalnızca http/https).';
    case 'port': return 'Yalnızca standart portlardaki (80/443) adresler okunabilir.';
    case 'redirect': return 'Sayfa çok fazla yönlendirme yapıyor.';
    // Yanit geldi ama govde cozulemedi — "baglanilamadi" yanlis yonlendirirdi
    case 'content_encoding': return 'Sayfa çözülemeyen bir sıkıştırmayla (Content-Encoding) geldi; okunamadı.';
    default: return 'Sayfaya bağlanılamadı.';
  }
}
