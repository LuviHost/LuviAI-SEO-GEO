/**
 * Kurumsal (rol) adres secimi — 07-kurumsal-adres.ts'in saf yardimcilari.
 *
 * NE: Firmanin KENDI sitesinde yayimladigi adresler arasindan, bir kisiye ait OLMAYAN ve tanitim
 * iletisine uygun tek kutuyu secer (pazarlama@ > isbirligi@ > info@ > iletisim@ ...).
 *
 * NEDEN yalniz rol adresi (kullanici karari 27.10.2026): "sahsa degil sirket maillerine atalim".
 * Isimli adres (ayse.yilmaz@) kisisel veridir (KVKK 2022/861); rol adresi tuzel kisinin iletisim
 * kanalidir. Bu yuzden isim gibi gorunen, ya da destek/IK/KVKK/muhasebe gibi tanitima KAPALI kutular
 * hic secilmez — yanlis kutuya giden tanitim hem sikayet hem spam sinyali.
 */
import { translit } from './prospect-utils.js';

/**
 * Tercih sirasi (dusuk indeks = once). NEDEN pazarlama once: alici dogru birimse cevap ihtimali en yuksek;
 * info@ genel kutu, cogu zaman yonlendirilir ama okunur. Liste disi yerel parca SECILMEZ.
 */
export const ROL_ONCELIK: readonly string[] = [
  'pazarlama', 'marketing', 'dijital', 'digital', 'isbirligi', 'partnership', 'partners', 'partner',
  'kurumsal', 'corporate', 'kurumsaliletisim', 'iletisim', 'contact', 'hello', 'merhaba', 'hi',
  'info', 'bilgi', 'satis', 'sales', 'newbusiness', 'yeniis', 'teklif', 'genelmudurluk', 'office', 'ofis',
];

/**
 * Tanitima KAPALI kutular: destek, IK, KVKK/hukuk, muhasebe, basvuru, sistem adresleri, cagri merkezi.
 * Yerel parcanin herhangi bir parcasi bunlardan biriyse secilmez ("kvkk.basvuru@", "ik-info@").
 */
const KAPALI = new Set([
  'destek', 'support', 'help', 'yardim', 'ik', 'hr', 'insankaynaklari', 'kariyer', 'career', 'careers', 'jobs',
  'cv', 'basvuru', 'kvkk', 'gdpr', 'privacy', 'gizlilik', 'hukuk', 'legal', 'uyum', 'compliance', 'etik', 'ethics',
  'muhasebe', 'accounting', 'fatura', 'invoice', 'finans', 'finance', 'satinalma', 'procurement', 'tedarik',
  'noreply', 'donotreply', 'mailer', 'daemon', 'postmaster', 'abuse', 'webmaster', 'admin', 'root', 'hostmaster',
  'musterihizmetleri', 'musteri', 'customer', 'callcenter', 'cagri', 'sikayet', 'complaint', 'rezervasyon',
  'reservation', 'booking', 'ir', 'investor', 'yatirimci', 'basin', 'press', 'media', 'medya', 'pr', 'bulten',
  'newsletter', 'unsubscribe', 'test', 'ornek', 'example', 'kep',
]);

/** "ali.veli", "aveli" gibi isim; rol listesinde olmayan her yerel parca kisisel kabul edilir (guvenli taraf) */
function parcala(local: string): string[] {
  return translit(local.toLowerCase().replace(/[._+-]+/g, ' ')).split(' ').filter(Boolean);
}

export type RolSonuc = { email: string; rol: string; oncelik: number } | null;

/**
 * Sube kutulari ("ankara@", "istanbul@"): firmanin kendi kutusu ama genel merkez degil → info@'dan SONRA.
 * Liste bilincli kisa: buyuk sube sehirleri; kisi adi olabilecek sehir adlari ("Aydin", "Mus") YOK.
 */
const SEHIR_KUTU = new Set(['istanbul', 'ankara', 'izmir', 'bursa', 'antalya', 'adana', 'konya', 'kocaeli', 'gaziantep', 'kayseri', 'mersin', 'eskisehir', 'samsun', 'trabzon', 'denizli']);

/** Alan adinin marka etiketi: "acme.com.tr" → "acme", "tr.acme.com" → "acme" */
export function alanEtiketi(domain: string): string {
  const parts = domain.toLowerCase().split('.');
  const ikili = /\.(com|net|org|gov|edu|k12|gen|web|bel|biz|info)\.tr$/.test(domain) || /\.co\.uk$/.test(domain);
  return parts[Math.max(0, parts.length - (ikili ? 3 : 2))] ?? domain;
}

/** Iki kisa dize arasi Levenshtein (alan adi etiketi icin; 40 karakter ustu hesaplanmaz) */
function mesafe(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length > 40 || b.length > 40) return 99;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

/**
 * Adresin alan adi firmanin alan adiyla "ayni firma" sayilir mi? Ayni alan / alt alan adi, YA DA firmanin
 * kendi sitesinde yayimlanmis ve etiketi en fazla 2 harf farkli (acarfactoring.com.tr sitesindeki
 * @acarfaktoring.com.tr). Kisa etiketlerde (< 6) yalniz tam esitlik: "abc" ile "abd" farkli firmalardir.
 */
export function ayniFirmaAlani(adresDomain: string, siteDomain: string): boolean {
  if (adresDomain === siteDomain || adresDomain.endsWith('.' + siteDomain) || siteDomain.endsWith('.' + adresDomain)) return true;
  const a = alanEtiketi(adresDomain), b = alanEtiketi(siteDomain);
  if (a.length < 6 || b.length < 6) return a === b;
  return mesafe(a, b) <= 2;
}

/**
 * Yerel parca tanitim icin uygun bir ROL kutusu mu? Donus: tercih sirasi (0 en iyi) ya da -1.
 * Tum parcalar rol listesinde olmali ("info", "kurumsal.iletisim", "info-tr" degil → -1, cunku "tr"
 * rol degil; bilincli dar: "tr" bir kisinin bas harfi de olabilir).
 */
export function rolOnceligi(local: string, domain?: string): number {
  const parts = parcala(local);
  if (parts.length === 0) return -1;
  if (parts.some((p) => KAPALI.has(p))) return -1;
  const birlesik = parts.join('');
  const tam = ROL_ONCELIK.indexOf(birlesik);
  if (tam >= 0) return tam;
  // Marka kutusu: "atleasing@atleasing.com.tr" — firmanin kendi adini tasiyan kutu, info@ ile ayni sirada
  if (domain && birlesik.length >= 4 && birlesik === alanEtiketi(domain).replace(/[^a-z0-9]/g, '')) return ROL_ONCELIK.indexOf('info');
  if (parts.length === 1 && SEHIR_KUTU.has(birlesik)) return ROL_ONCELIK.length; // sube: tum rollerden sonra
  const idx = parts.map((p) => ROL_ONCELIK.indexOf(p));
  if (idx.some((i) => i < 0)) return -1;
  return Math.min(...idx);
}

/**
 * Adres listesinden en uygun tek rol kutusu. Yalniz firmanin alan adi kabul edilir (bkz. ayniFirmaAlani);
 * baska alan adindaki adres (ajansin, ust sirketin, gmail, KEP) secilmez.
 */
export function enIyiRolAdresi(adresler: readonly string[], domain: string): RolSonuc {
  let best: RolSonuc = null;
  for (const raw of adresler) {
    const email = raw.trim().toLowerCase();
    const m = email.match(/^([a-z0-9._%+-]+)@([a-z0-9.-]+\.[a-z]{2,})$/);
    if (!m) continue;
    const [, local, d] = m;
    if (!ayniFirmaAlani(d, domain)) continue;
    const o = rolOnceligi(local, d);
    if (o < 0) continue;
    if (!best || o < best.oncelik || (o === best.oncelik && email < best.email)) best = { email, rol: local, oncelik: o };
  }
  return best;
}

/**
 * Cloudflare e-posta gizleme (data-cfemail / /cdn-cgi/l/email-protection#...) cozumu. NEDEN: TR kurumsal
 * sitelerin onemli kismi Cloudflare arkasinda ve iletisim adresi HTML'de bu bicimde duruyor; cozulmezse
 * adres "yok" sanilir. Bu bir erisim engeli degil, tarayicinin da yaptigi standart XOR cozumudur.
 */
export function cfemailCoz(hex: string): string | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length < 4 || hex.length % 2 !== 0) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out) ? out : null;
}

/**
 * Sayfadaki ham adresler: mailto: + duz metin + Cloudflare gizlemesi. "ad [at] alan [dot] com" gibi
 * kasitli gizlemeler COZULMEZ — sahibi otomatik okunmasini istememis demektir.
 */
export function sayfadakiAdresler(html: string): string[] {
  const found = new Set<string>();
  const temiz = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  for (const m of temiz.matchAll(/mailto:([^"'?\s>]+)/gi)) found.add(decodeURIComponent(m[1]).toLowerCase());
  for (const m of temiz.replace(/<[^>]+>/g, ' ').matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)) found.add(m[0].toLowerCase());
  for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) { const e = cfemailCoz(m[1]); if (e) found.add(e.toLowerCase()); }
  for (const m of html.matchAll(/email-protection#([0-9a-f]+)/gi)) { const e = cfemailCoz(m[1]); if (e) found.add(e.toLowerCase()); }
  return [...found].map((e) => e.replace(/[.,;:]+$/, ''));
}
