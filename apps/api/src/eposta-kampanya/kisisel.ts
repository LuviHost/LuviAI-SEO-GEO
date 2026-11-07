/**
 * Kisisel kurumsal mail (07.11.2026) — SAF modul: DB/LLM/ag yok.
 *
 * NEDEN: sektor sablonu firmayi tanimiyordu. Kurumsal BT entegratorune "telefon almak icin hangi site guvenilir"
 * gitti; genel sablon da firmanin ne yaptigini bildigimizi gosteren tek kelime icermiyordu. Artik her firmaya
 * gonderimden once:
 *   1) sitesinden okunan bir faaliyet cumlesi ("... sunuyorsunuz."),
 *   2) musterisinin AI asistanina soracagi markasiz bir soru,
 *   3) o sorunun ChatGPT ve Perplexity'deki o gunku cevabi (anildi mi, cevapta kimler gecti)
 * hazirlanir. Uc parca da dogrulanmadan (iki asistan da olculmeden) hedef HAZIR olmaz ve gonderilmez; genel metne
 * geri donus YOK (sahip karari 07.11).
 *
 * Olcum cumlesi LLM'e yazdirilmaz, koddan kurulur: mailde "siz yoktunuz" diyen her cumle olcumun kendisinden gelir.
 */
import { containsBrand } from '../audit/brand-in-query.js';

export const KISISEL_SURUM = 1;
/** Faaliyet + soru uretimi (site basina tek cagri) */
export const KISISEL_MODEL = 'claude-sonnet-5';
/** Olcumun mailde "su tarihte sorduk" diye anilabilecegi en uzun sure; daha eskiyse yeniden hazirlanir */
export const KISISEL_GECERLILIK_MS = 7 * 86_400_000;
/** HAZIRLANIYOR'da kalan satir (surec oldu) bu sureden sonra yeniden denenir */
export const KISISEL_ASILI_MS = 30 * 60_000;
/** Gecici hata (LLM/ag) bu kadar denemeden sonra INCELE olur — sonsuz maliyet dongusu olmasin */
export const KISISEL_AZAMI_DENEME = 2;
/** Olcumun yapildigi asistanlar ve maildeki adlari (sira mailde de bu) */
export const KISISEL_ASISTANLAR = [
  { provider: 'openai', ad: 'ChatGPT' },
  { provider: 'perplexity', ad: 'Perplexity' },
] as const;

export type KisiselAsistan = { ad: string; olculdu: boolean; anildi: boolean };
export type KisiselVeri = {
  surum: number;
  /** Mailde gorunen kisa marka adi ("Avasya") */
  marka: string;
  /** Ikinci cogul sahis tek cumle: "Kurumsal firmalara bulut ve siber guvenlik cozumleri sunuyorsunuz." */
  faaliyet: string;
  /** Musterinin AI'a soracagi markasiz soru */
  soru: string;
  olcum: { tarih: string; asistanlar: KisiselAsistan[]; gecenler: string[] };
  maliyetUsd?: number;
};
/** INCELE satirinda kayitli neden (gonderilmez) */
export type KisiselInceleme = { neden: string; deneme?: number; faaliyet?: string; soru?: string; marka?: string };

// ─── Sayfa ozeti ────────────────────────────────────────────────────────────

const ENTITY: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function entityCoz(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITY[n.toLowerCase()] ?? m);
}
const temizle = (s: string) => entityCoz(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

export type SayfaOzeti = { baslik: string; aciklama: string; basliklar: string[]; metin: string };

/** Ana sayfadan LLM'e gidecek kisa ozet. Script/stil/nav/footer atilir; metin 3000 karakterle kirpilir. */
export function sayfaOzeti(html: string): SayfaOzeti {
  const meta = (ad: string) => {
    const re = new RegExp(`<meta[^>]+(?:name|property)=["']${ad}["'][^>]*>`, 'i');
    const m = html.match(re)?.[0];
    return m ? temizle(m.match(/content=["']([^"']*)["']/i)?.[1] ?? '') : '';
  };
  const baslik = temizle(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '');
  const aciklama = meta('description') || meta('og:description');
  const govde = html
    .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|footer)[\s\S]*?<\/\1>/gi, ' ');
  const basliklar = [...govde.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)]
    .map((m) => temizle(m[1]))
    .filter((t) => t.length >= 3 && t.length <= 160);
  const gorulen = new Set<string>();
  const tekil = basliklar.filter((b) => (gorulen.has(b) ? false : (gorulen.add(b), true))).slice(0, 25);
  const metin = temizle(govde.match(/<body[\s\S]*<\/body>/i)?.[0] ?? govde).slice(0, 3000);
  return { baslik: baslik.slice(0, 200), aciklama: aciklama.slice(0, 400), basliklar: tekil, metin };
}

/** Sayfa LLM'e gidecek kadar icerik tasiyor mu (park sayfasi, bos SPA kabugu, "yapim asamasinda") */
export function sayfaYeterliMi(o: SayfaOzeti): boolean {
  const toplam = `${o.baslik} ${o.aciklama} ${o.basliklar.join(' ')} ${o.metin}`;
  if (/(domain|alan ad[ıi]) (is )?(for sale|sat[ıi]l[ıi]k)|under construction|yap[ıi]m a[şs]amas[ıi]nda|coming soon|yak[ıi]nda hizmetinizde/i.test(toplam)) return false;
  return toplam.replace(/\s+/g, ' ').length >= 200;
}

// ─── LLM ────────────────────────────────────────────────────────────────────

export const KISISEL_SISTEM = `Bir B2B satış e-postası için bir firmanın web sitesini okuyup iki şey yazıyorsun. Kurallar:
- Yalnız sitede yazanı kullan. Sitede olmayan hizmet, şehir, müşteri ya da rakam uydurma.
- Firmanın ne iş yaptığını kesin anlayamıyorsan (park edilmiş alan adı, yalnız giriş sayfası, çok az içerik, holding/kurumsal tanıtım dışında bir şey söylemeyen sayfa) "uygun": false döndür ve nedeni yaz.
- "marka": firmanın kısa marka adı, hukuki ek ve "A.Ş.", "Ltd." olmadan (ör. "Avasya Teknoloji San. ve Dış Tic. Ltd. Şti." → "Avasya"). Alan adı değil.
- "faaliyet": firmaya doğrudan hitap eden, ikinci çoğul şahısla TEK cümle; en çok 150 karakter; sitede yazan somut hizmet ya da ürünleri say; "lider", "öncü", "kaliteli", "yenilikçi" gibi övgü ve pazarlama sıfatı yok; nokta ile biter. Örnek: "Kurumsal firmalara bulut, siber güvenlik ve veri merkezi çözümleri sunuyorsunuz."
- "soru": bu firmanın potansiyel müşterisinin bir yapay zekâ asistanına (ChatGPT gibi) soracağı gerçekçi, Türkçe tek soru. Firmanın ya da markanın adı GEÇMEZ. Firmanın ana işini hedefler; müşteri firma seçmek için sorar (ör. "İstanbul'da kurumsal sistem entegratörü firmalar hangileri?", "Koltuk takımı almak için hangi markalar güvenilir?"). Şehir yalnız sitede firmanın o şehirde hizmet verdiği açıksa geçer. En çok 110 karakter, soru işaretiyle biter.
- Türkçe yazım ve noktalama kurallarına uy.`;

export const KISISEL_SEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['uygun', 'neden', 'marka', 'faaliyet', 'soru'],
  properties: {
    uygun: { type: 'boolean' },
    neden: { type: 'string', description: 'uygun=false ise kısa neden; uygunsa boş' },
    marka: { type: 'string' },
    faaliyet: { type: 'string' },
    soru: { type: 'string' },
  },
};

export function kisiselKullaniciMesaji(o: { firma: string; host: string; sayfa: SayfaOzeti }): string {
  return [
    `Firma (listedeki ad): ${o.firma}`,
    `Alan adı: ${o.host}`,
    `Sayfa başlığı: ${o.sayfa.baslik || '-'}`,
    `Meta açıklama: ${o.sayfa.aciklama || '-'}`,
    `Başlıklar: ${o.sayfa.basliklar.join(' | ') || '-'}`,
    `Sayfa metni (kırpılmış): ${o.sayfa.metin || '-'}`,
  ].join('\n');
}

const OVGU = /\b(lider|öncü|oncu|en iyi|kaliteli|yenilikçi|yenilikci|sektörün|sektorun|eşsiz|essiz|benzersiz|mükemmel|mukemmel)\b/i;
/** Ikinci cogul sahis cumle sonu: sunuyorsunuz, üretiyorsunuz, sağlıyorsunuz, yapıyorsunuz, veriyorsunuz… */
const IKINCI_COGUL = /(s[ıiuü]n[ıiuü]z)\.$/;

export type LlmDogrulama =
  | { ok: true; marka: string; faaliyet: string; soru: string }
  | { ok: false; neden: string; uygunDegil?: boolean };

/** LLM ciktisi mailde kullanilabilir mi? Kurallardan biri tutmazsa neden doner (hedef INCELE olur). */
export function llmCiktisiniDogrula(raw: unknown, o: { host: string; firma: string }): LlmDogrulama {
  if (!raw || typeof raw !== 'object') return { ok: false, neden: 'Model geçerli JSON döndürmedi' };
  const r = raw as Record<string, unknown>;
  if (r.uygun !== true) return { ok: false, uygunDegil: true, neden: `Site uygun değil: ${String(r.neden ?? '').trim().slice(0, 200) || 'neden yok'}` };
  const marka = String(r.marka ?? '').replace(/\s+/g, ' ').trim();
  const faaliyet = String(r.faaliyet ?? '').replace(/\s+/g, ' ').trim();
  const soru = String(r.soru ?? '').replace(/\s+/g, ' ').trim();
  if (marka.length < 2 || marka.length > 40 || !/\p{L}/u.test(marka)) return { ok: false, neden: `Marka adı uygun değil: "${marka}"` };
  if (faaliyet.length < 30 || faaliyet.length > 170) return { ok: false, neden: `Faaliyet cümlesi uzunluğu ${faaliyet.length}` };
  if (!IKINCI_COGUL.test(faaliyet)) return { ok: false, neden: `Faaliyet cümlesi "…sunuyorsunuz." biçiminde değil: "${faaliyet}"` };
  if (OVGU.test(faaliyet)) return { ok: false, neden: `Faaliyet cümlesinde övgü sıfatı var: "${faaliyet}"` };
  if (/[!{}<>]|https?:/.test(faaliyet + soru)) return { ok: false, neden: 'Metinde izin verilmeyen karakter ya da bağlantı var' };
  if (soru.length < 15 || soru.length > 120 || !soru.endsWith('?')) return { ok: false, neden: `Soru biçimi uygun değil: "${soru}"` };
  if (containsBrand(soru, marka, o.host) || soru.toLowerCase().includes(o.host.toLowerCase())) {
    return { ok: false, neden: `Soruda firmanın adı geçiyor: "${soru}"` };
  }
  return { ok: true, marka, faaliyet, soru };
}

// ─── Olcum ──────────────────────────────────────────────────────────────────

type ProbeSonucu = {
  provider: string;
  available: boolean;
  probes: Array<{ brandMentioned?: boolean; cited?: boolean; mentionedDomains?: string[] }>;
};

const kok = (h: string) => h.toLowerCase().replace(/^www\./, '');

/**
 * runPublicProbes sonucundan asistan satirlari + cevapta en cok gecen diger alan adlari (aday rakipler).
 * Olculdu = saglayici calisti ve en az bir cevap dondu. Anildi = marka adi ya da sitenin adresi cevapta.
 */
export function olcumOzeti(sonuc: ProbeSonucu[], host: string): { asistanlar: KisiselAsistan[]; adaylar: string[] } {
  const benim = kok(host);
  const sayac = new Map<string, number>();
  const asistanlar = KISISEL_ASISTANLAR.map(({ provider, ad }) => {
    const r = sonuc.find((x) => x.provider === provider);
    const olculdu = !!r?.available && (r.probes?.length ?? 0) > 0;
    const anildi = olculdu && r!.probes.some((p) => p.brandMentioned || p.cited);
    if (olculdu) {
      for (const p of r!.probes) {
        for (const d of new Set((p.mentionedDomains ?? []).map(kok))) {
          if (!d || d === benim || d.endsWith(`.${benim}`) || benim.endsWith(`.${d}`)) continue;
          sayac.set(d, (sayac.get(d) ?? 0) + 1);
        }
      }
    }
    return { ad, olculdu, anildi };
  });
  const adaylar = [...sayac.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([d]) => d).slice(0, 8);
  return { asistanlar, adaylar };
}

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
/** "7 Kasım" (TR saatiyle) */
export function olcumTarihi(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 3 * 3_600_000);
  return `${d.getUTCDate()} ${AYLAR[d.getUTCMonth()]}`;
}

function listele(xs: string[]): string {
  if (xs.length <= 1) return xs.join('');
  return `${xs.slice(0, -1).join(', ')} ve ${xs[xs.length - 1]}`;
}

/** Olcum cumlesi — yalniz olcumden. Iki asistan da olculmeden cagrilmaz (hazirlik INCELE yapar). */
export function olcumCumlesi(v: KisiselVeri): string {
  const [a, b] = v.olcum.asistanlar;
  const gecen = v.olcum.gecenler.slice(0, 3);
  const ek = gecen.length ? ` Cevaplarda öne çıkanlar: ${listele(gecen)}.` : '';
  if (a.anildi && b.anildi) return `İki asistan da cevabında sizi andı.${ek}`;
  if (a.anildi !== b.anildi) {
    const anan = a.anildi ? a : b;
    const anmayan = a.anildi ? b : a;
    return `${anan.ad} cevabında sizi andı, ${anmayan.ad}'nin cevabında ise yoktunuz.${ek}`;
  }
  return `İki asistanın cevabında da yoktunuz.${ek}`;
}

/** Sablon K degiskenleri (CSV sutun adlariyla ayni) */
export function kisiselDegiskenler(v: KisiselVeri): { faaliyet: string; ornek_soru: string; olcum_tarihi: string; olcum_cumlesi: string } {
  return { faaliyet: v.faaliyet, ornek_soru: v.soru, olcum_tarihi: olcumTarihi(v.olcum.tarih), olcum_cumlesi: olcumCumlesi(v) };
}

/** DB'deki JSON → KisiselVeri; bicim tutmazsa null (o hedef kisisel sayilmaz, gonderilmez) */
export function kisiselOku(json: unknown): KisiselVeri | null {
  if (!json || typeof json !== 'object') return null;
  const v = json as Partial<KisiselVeri>;
  const o = v.olcum as KisiselVeri['olcum'] | undefined;
  if (v.surum !== KISISEL_SURUM || typeof v.marka !== 'string' || typeof v.faaliyet !== 'string' || typeof v.soru !== 'string') return null;
  if (!o || typeof o.tarih !== 'string' || !Array.isArray(o.asistanlar) || o.asistanlar.length !== 2 || !Array.isArray(o.gecenler)) return null;
  if (!o.asistanlar.every((x) => x && typeof x.ad === 'string' && x.olculdu === true && typeof x.anildi === 'boolean')) return null;
  return v as KisiselVeri;
}
