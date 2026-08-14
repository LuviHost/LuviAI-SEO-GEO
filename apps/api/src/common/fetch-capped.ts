/**
 * Ucuncu taraf sayfa govdesini TAVANLI okuma — tek uygulama.
 *
 * NEDEN VAR: kendi sunucumuz olmayan bir adresten `res.text()` cagirmak,
 * karsi tarafin ne gonderdigine gore sinirsiz bellek ayirmak demektir.
 * Uretimde olculdu:
 *   - ofsayt.com taramasi 100 sayfa icin 137 MB indiriyordu; iceride TEK bir
 *     sayfa 14.1 MB HTML'di (gecerli text/html, hata degil).
 *   - GEO calistiricisi ayrica 9 sayfanin HTML'ini AYNI ANDA bellekte tutuyor.
 *   - Worker RSS'i 205 MB'tan 1440 MB'a cikiyor, PM2'nin bellek siniri SIGTERM
 *     gonderiyor, tarama yarida oluyor, DB'deki is PROCESSING'de asili kaliyor,
 *     BullMQ takilan isi yeniden veriyor ve ayni tarama tekrar cokuyordu.
 *     Uretim logunda ayni is 7 kez bastan basladi.
 *
 * Ayni hata bagimsiz olarak IKI yerde vardi (site-crawler ve geo-runner).
 * Ucuncu bir kopya cikmasin diye mantik buraya alindi.
 *
 * KESMEK, SAYFAYI ATMAKTAN IYI: SEO/GEO icin cikardigimiz sinyallerin tamami
 * (<title>, meta, canonical, OG, JSON-LD) belgenin <head> kismindadir — yani
 * ilk kilobaytlarda. Sayfayi tamamen elemek onu link grafiginden de dusurur ve
 * baska sayfalari yanlislikla "orphan" gosterirdi.
 */

/** Metin disi govdeler icin varsayilan suzgec — bunlarda ayristirilacak bir sey yok. */
const METIN_TIPI = /(text\/|xml|json|javascript|xhtml)/i;

export interface CappedFetchResult {
  text: string;
  /** Tavana takilip baglantinin kesildigi durum — cagiran taraf loglayabilsin. */
  truncated: boolean;
}

/**
 * Govdeyi tavana kadar okur ve tavanda BAGLANTIYI KESER.
 *
 * Onemli nokta: once tamamini indirip sonra kirpmak islevsizdir — bellek zaten
 * harcanmis olur. Burada akis okunurken tavana ulasilinca reader iptal edilir.
 */
export async function readBodyCapped(res: Response, maxBytes: number): Promise<CappedFetchResult | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;

  const decoder = new TextDecoder('utf-8');
  const parts: string[] = [];
  let total = 0;
  let truncated = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      const kalan = maxBytes - total;
      if (value.length >= kalan) {
        parts.push(decoder.decode(value.subarray(0, kalan)));
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
      total += value.length;
      parts.push(decoder.decode(value, { stream: true }));
    }
  } catch {
    await reader.cancel().catch(() => {});
    return parts.length ? { text: parts.join(''), truncated } : null;
  }

  return { text: parts.join(''), truncated };
}

/**
 * Metin disi content-type mi? Oyleyse govdeyi hic indirmemeli.
 *
 * Baslik hic yoksa `false` doner: bazi sunucular content-type gondermiyor ve
 * onlari elemek gecerli sayfalari kaybettirirdi.
 */
export function isBinaryContentType(res: Response): boolean {
  const ct = res.headers.get('content-type') ?? '';
  return !!ct && !METIN_TIPI.test(ct);
}
