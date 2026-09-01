/**
 * Kurum karnesi — runPublicProbes sonucundan tek dosya HTML (+ JSON ozet).
 *
 * SAF modul: DB/LLM/ag yok; AiCitationService yalnizca TIP olarak import
 * edilir (calisma zamaninda silinir) ki karne, servisin donus tipiyle
 * ayrisamasin.
 *
 * NEDEN AYRI DOSYA: script (scripts/prospect-karne.ts) orkestrasyon yapar;
 * sayim kurallari burada durur ve karne-html.spec.ts sahte sonucla test
 * eder. LLM cagrisi olmadan HTML'in dogrulugu kanitlanabilir.
 *
 * SAYIM KURALLARI (audit/ai-citation.service.ts aggregateProbes ile ayni):
 *   - Marka kredisi yalnizca MARKASIZ sorulardan (brandInQuery false).
 *     Soru bankasi zaten markasiz ama damga probe'dan okunur; probe damgasi
 *     yoksa containsBrand ile ayni kuralla hesaplanir.
 *   - HATA probe'u (excerpt 'HATA: ...' — saglayici reddi, API hatasi, bos
 *     cevap; servis 8 yerde uretir) OLCULMEMIS sayilir: ne "anilmadi" ne
 *     bosluk ne rakip gozlemi. Servisin kendi tuketicileri de boyle yapar
 *     (prompt-lab isErrorProbe, ai-citation hasRealProbes). Aksi halde
 *     Opus'un 10 soruyu reddettigi kosum musteriye "10 bosluk" diye giderdi.
 *   - Rakip payi birimi "kac cevapta gorundu" (share-of-voice.ts); rakipler
 *     her cevaptan toplanir, marka kredisi yalnizca markasiz cevaptan.
 *   - Bosluk = olculen (en az bir asistanin gercekten cevapladigi) markasiz
 *     soruda markanin HICBIR asistanda anilmamasi.
 *
 * GIZLILIK: bu rapor birebir ve gizlidir; rakip alan adlari acik yazilir
 * (kamuya yalniz toplu istatistik cikar — plan Faz 4). Saglayici hata
 * govdeleri (HTTP 429 govdesi, NO_KEY gibi operasyonel ayrinti) HTML'e
 * GIRMEZ — notr "bu kosumda olculemedi" metnine eslenir; ham neden yalniz
 * JSON ciktisinda kalir.
 */
import type { AiCitationService } from '../audit/ai-citation.service.js';
import { containsBrand } from '../audit/brand-in-query.js';
import {
  shareOfVoiceList,
  rivalsFromCompetitors,
  type SovEntry,
  type SovObservation,
} from '../audit/share-of-voice.js';

/** runPublicProbes'un dondurdugu dizinin tek elemani — servis tipinden turetilir. */
export type KarneSaglayiciSonucu = Awaited<ReturnType<AiCitationService['runPublicProbes']>>[number];
export type KarneProbe = KarneSaglayiciSonucu['probes'][number];

/** Servis, olculemeyen probe'u bu onekle isaretler (ai-citation.service.ts). */
export const HATA_ONEKI = 'HATA:';

/** Probe saglayici hatasi/reddi mi — olcum degil. prompt-lab isErrorProbe ile ayni kural. */
export function hataliProbe(p: Pick<KarneProbe, 'excerpt'> | undefined): boolean {
  return !!p?.excerpt?.startsWith(HATA_ONEKI);
}

export interface KarneGirdi {
  brand: string;
  host: string;
  sektor: string;
  altsektor?: string | null;
  /** Sorulan sorular — sirasi tabloyu belirler. */
  sorular: string[];
  saglayicilar: KarneSaglayiciSonucu[];
  /**
   * Kullanicinin verdigi rakip alan adlari. Script bunlari runPublicProbes'a
   * `competitors` olarak gecirir: cevapta ARANIR ve rivalsFromCompetitors
   * uzerinden rakip payina GIRER (cevaptan kesfedilenlerle birlikte).
   * HTML'de ★ ile isaretlenir.
   */
  rakipler?: string[];
  tarih?: Date;
}

export interface KarneHucre {
  /** Saglayici bu soruyu GERCEKTEN cevapladi mi (anahtar var + hatasiz probe). */
  olculdu: boolean;
  /** Probe var ama saglayici hatasi/reddi (excerpt 'HATA: ...') — olculmedi sayilir. */
  hata: boolean;
  /** Soru markali mi — markaliysa anildi/atif daima false, skora girmez. */
  markali: boolean;
  anildi: boolean;
  atif: boolean;
  /** Markanin cevapta ilk gectigi satir/madde sirasi (1 = en ustte; servis \n ile boler); anilmadiysa null. */
  sira: number | null;
}

export interface KarneSaglayiciOzeti {
  provider: string;
  label: string;
  available: boolean;
  /** Ham neden (NO_KEY, HTTP govdesi...) — yalniz JSON; HTML'e girmez. */
  reason?: string;
  /** Kac markasiz soruda anildi / atif aldi. */
  anilanSoru: number;
  atifSoru: number;
  /** Kac soruda saglayici hatasi/reddi (olculmedi). */
  hataliSoru: number;
  /** girdi.sorular sirasinda. */
  hucreler: KarneHucre[];
}

export interface KarneOzet {
  brand: string;
  host: string;
  sektor: string;
  altsektor: string | null;
  /** ISO 8601 */
  tarih: string;
  /** gg.aa.yyyy — HTML'de gosterilen */
  tarihMetni: string;
  sorular: string[];
  /** Skora girmeyen (marka adi gecen) sorular — beklenen: bos. */
  markaliSorular: string[];
  saglayicilar: KarneSaglayiciOzeti[];
  toplam: {
    saglayici: number;
    aktifSaglayici: number;
    anilanSaglayici: number;
    atifSaglayici: number;
    /** Gercekten olculen markasiz cevap sayisi (hata ve markali haric). */
    olculenCevap: number;
    anilanCevap: number;
    atifCevap: number;
    /** Saglayici hatasi/reddi nedeniyle olculemeyen cevap sayisi. */
    hataliCevap: number;
  };
  rakipPayi: SovEntry[];
  verilenRakipler: string[];
  bosluklar: string[];
  /** En az bir asistanin GERCEKTEN olctugu markasiz soru sayisi — bosluk kartinin paydasi */
  olculenSoruSayisi: number;
  /** Denenen cagri sayisi (hatali olanlar dahil). */
  cagriSayisi: number;
  maliyetUsd: number;
}

export function karneBasligi(brand: string): string {
  return `${brand} — AI görünürlük karnesi (gizli, yalnız kurum için)`;
}

function ggaayyyy(d: Date): string {
  const gg = String(d.getDate()).padStart(2, '0');
  const aa = String(d.getMonth() + 1).padStart(2, '0');
  return `${gg}.${aa}.${d.getFullYear()}`;
}

// ─── Ozet (saf hesap) ───────────────────────────────────────────────────────

export function karneOzeti(girdi: KarneGirdi): KarneOzet {
  const { brand, host, sorular } = girdi;
  const tarih = girdi.tarih ?? new Date();
  const markaliSet = new Set<string>();

  const saglayicilar: KarneSaglayiciOzeti[] = girdi.saglayicilar.map((s) => {
    const hucreler: KarneHucre[] = sorular.map((soru) => {
      const probe = s.available ? s.probes.find((p) => p.query === soru) : undefined;
      // Damga probe'dan; yoksa ayni kuralla metinden (ai-citation ile ayni tanim).
      const markali = probe?.brandInQuery ?? containsBrand(soru, brand);
      if (markali) markaliSet.add(soru);
      if (!probe) return { olculdu: false, hata: false, markali, anildi: false, atif: false, sira: null };
      if (hataliProbe(probe)) return { olculdu: false, hata: true, markali, anildi: false, atif: false, sira: null };
      const anildi = !markali && !!probe.brandMentioned;
      const atif = !markali && !!probe.cited;
      return {
        olculdu: true,
        hata: false,
        markali,
        anildi,
        atif,
        sira: anildi ? (typeof probe.position === 'number' ? probe.position : null) : null,
      };
    });
    return {
      provider: s.provider,
      label: s.label,
      available: s.available,
      reason: s.reason,
      anilanSoru: hucreler.filter((h) => h.anildi).length,
      atifSoru: hucreler.filter((h) => h.atif).length,
      hataliSoru: hucreler.filter((h) => h.hata).length,
      hucreler,
    };
  });

  const tumHucreler = saglayicilar.flatMap((s) => s.hucreler);
  const hucrelerDuz = tumHucreler.filter((h) => h.olculdu && !h.markali);
  const toplam = {
    saglayici: saglayicilar.length,
    aktifSaglayici: saglayicilar.filter((s) => s.available).length,
    anilanSaglayici: saglayicilar.filter((s) => s.anilanSoru > 0).length,
    atifSaglayici: saglayicilar.filter((s) => s.atifSoru > 0).length,
    olculenCevap: hucrelerDuz.length,
    anilanCevap: hucrelerDuz.filter((h) => h.anildi).length,
    atifCevap: hucrelerDuz.filter((h) => h.atif).length,
    hataliCevap: tumHucreler.filter((h) => h.hata).length,
  };

  // Rakip payi — aggregateProbes ile birebir ayni gozlem kurali; hatali probe gozlem degildir.
  const observations: SovObservation[] = girdi.saglayicilar
    .filter((s) => s.available)
    .flatMap((s) => s.probes)
    .filter((p) => !hataliProbe(p))
    .map((p) => ({
      brandPresent: !(p.brandInQuery ?? containsBrand(p.query, brand)) && !!p.brandMentioned,
      rivals: [...rivalsFromCompetitors(p.competitors), ...(p.mentionedDomains ?? [])],
    }));
  const rakipPayi = shareOfVoiceList(observations, brand);

  // Bosluk: en az bir asistanin GERCEKTEN olctugu markasiz soruda hic anilmama.
  const bosluklar = sorular.filter((soru, i) => {
    if (markaliSet.has(soru)) return false;
    const olculen = saglayicilar.map((s) => s.hucreler[i]).filter((h) => h.olculdu);
    return olculen.length > 0 && olculen.every((h) => !h.anildi);
  });
  // NEDEN: kartta "N/M bosluk" paydasi yalniz olculebilen sorular olmali; iki asistanda
  // HATA alan soru "bosluk degil" diye paydada durursa oran yaniltir.
  const olculenSoruSayisi = sorular.filter((soru, i) => !markaliSet.has(soru) && saglayicilar.some((s) => s.hucreler[i].olculdu)).length;

  return {
    brand,
    host,
    sektor: girdi.sektor,
    altsektor: girdi.altsektor ?? null,
    tarih: tarih.toISOString(),
    tarihMetni: ggaayyyy(tarih),
    sorular: [...sorular],
    markaliSorular: sorular.filter((q) => markaliSet.has(q)),
    saglayicilar,
    toplam,
    rakipPayi,
    verilenRakipler: [...new Set((girdi.rakipler ?? []).map((r) => r.trim().toLowerCase()).filter(Boolean))],
    bosluklar,
    olculenSoruSayisi,
    cagriSayisi: girdi.saglayicilar.filter((s) => s.available).reduce((n, s) => n + s.probes.length, 0),
    maliyetUsd: Math.round(girdi.saglayicilar.reduce((n, s) => n + (s.cost ?? 0), 0) * 10000) / 10000,
  };
}

// ─── HTML ───────────────────────────────────────────────────────────────────

export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Tablo basligi icin kisa asistan adi; bilinmeyen saglayicida label kalir. */
const KISA_AD: Record<string, string> = {
  anthropic: 'Claude',
  gemini: 'Gemini',
  openai: 'ChatGPT',
  perplexity: 'Perplexity',
  xai: 'Grok',
  deepseek: 'DeepSeek',
  meta: 'Meta AI',
};

const SEKTOR_ADI: Record<string, string> = {
  finans: 'Finans',
  'eticaret-perakende-teknoloji': 'E-ticaret / perakende / teknoloji',
  'turizm-havayolu-telekom-otomotiv': 'Turizm / havayolu / telekom / otomotiv',
};

/** Musteriye giden tek notr ifade — ham reason (NO_KEY, HTTP govdesi) HTML'e girmez. */
const OLCULEMEDI_METNI = 'bu koşumda ölçülemedi';

function yuzde(pay: number, butun: number): string {
  if (butun <= 0) return '—';
  return `%${Math.round((pay / butun) * 100)}`;
}

/** Saglayici tabloya "olculemedi" olarak girer: anahtar yok VEYA tum sorular hatali. */
function saglayiciOlculemedi(s: KarneSaglayiciOzeti): boolean {
  return !s.available || (s.hucreler.length > 0 && s.hucreler.every((h) => !h.olculdu));
}

const CSS = `
  :root { --turuncu:#f97316; --turuncu-koyu:#c2410c; --turuncu-acik:#fff7ed; --turuncu-orta:#fed7aa;
          --metin:#1c1917; --soluk:#78716c; --cizgi:#e7e5e4; --zemin:#fafaf9; }
  * { box-sizing:border-box; }
  body { margin:0; padding:32px 40px; background:#fff; color:var(--metin);
         font:15px/1.5 -apple-system, "Segoe UI", Inter, Roboto, Helvetica, Arial, sans-serif; }
  .ust { border-left:6px solid var(--turuncu); padding-left:18px; margin-bottom:24px; }
  .marka { font-size:12px; letter-spacing:.12em; text-transform:uppercase; color:var(--turuncu-koyu); font-weight:700; }
  h1 { font-size:26px; margin:6px 0 8px; line-height:1.2; }
  h2 { font-size:18px; margin:32px 0 12px; padding-bottom:6px; border-bottom:2px solid var(--turuncu-orta); }
  .meta { color:var(--soluk); font-size:13px; }
  .gizli { display:inline-block; margin-top:10px; padding:4px 10px; border-radius:999px;
           background:var(--turuncu-acik); color:var(--turuncu-koyu); border:1px solid var(--turuncu-orta);
           font-size:12px; font-weight:600; }
  .kartlar { display:grid; grid-template-columns:repeat(auto-fit, minmax(190px, 1fr)); gap:12px; }
  .kart { background:var(--zemin); border:1px solid var(--cizgi); border-radius:10px; padding:14px 16px; break-inside:avoid; }
  .kart .sayi { font-size:28px; font-weight:800; color:var(--turuncu-koyu); line-height:1.1; }
  .kart .etiket { font-size:13px; color:var(--soluk); margin-top:4px; }
  table { border-collapse:collapse; width:100%; font-size:13px; }
  th, td { border:1px solid var(--cizgi); padding:6px 8px; vertical-align:top; }
  th { background:var(--zemin); text-align:left; font-weight:600; }
  th.asistan { text-align:center; white-space:nowrap; }
  td.h { text-align:center; white-space:nowrap; color:var(--soluk); }
  td.h.anildi { background:var(--turuncu-acik); color:var(--turuncu-koyu); font-weight:700; }
  td.h.atif { background:var(--turuncu-orta); color:var(--turuncu-koyu); font-weight:700; }
  td.h.yok { color:#a8a29e; }
  td.h.hata { color:#a8a29e; font-style:italic; }
  tr.toplam td { font-weight:700; background:var(--zemin); }
  tr.marka-satir td { background:var(--turuncu-acik); font-weight:700; }
  .lejant { font-size:12px; color:var(--soluk); margin-top:8px; }
  .lejant span { display:inline-block; margin-right:14px; }
  ul.bosluk li { margin:4px 0; }
  .not { background:var(--zemin); border:1px solid var(--cizgi); border-radius:10px; padding:14px 16px; font-size:13px; }
  .not li { margin:4px 0; }
  .alt { margin-top:36px; padding-top:12px; border-top:1px solid var(--cizgi); color:var(--soluk); font-size:12px; }
  .sarmal { overflow-x:auto; }
  @page { size:A4; margin:14mm; }
  @media print { body { padding:0; } h2 { break-after:avoid; } .kart, table, .not { break-inside:avoid; } }
`;

export interface KarneHtmlSecenek {
  /** Randevu linki (Settings: SATIS_RANDEVU_URL). Bos ise gorusme cumlesi metinden DUSER. */
  randevuUrl?: string | null;
}

export function karneHtml(o: KarneOzet, secenek: KarneHtmlSecenek = {}): string {
  const baslik = karneBasligi(o.brand);
  const e = escapeHtml;
  const t = o.toplam;
  const sektorAdi = SEKTOR_ADI[o.sektor] ?? o.sektor;
  // Hicbir hucre gercekten olculmediyse (anahtar yok / hepsi hata) bosluk listesi anlamsizdir.
  const olcumYok = !o.saglayicilar.some((s) => s.hucreler.some((h) => h.olculdu));

  // Ozet kartlari
  // NEDEN eksiz etiket: "3'ünde / 2'sinde" gibi Turkce ekler sayiya gore
  // degisir ve kesme isareti HTML'de kacislanir; sayi manset, etiket duz.
  const kartlar = [
    { sayi: `${t.anilanSaglayici}/${t.saglayici}`, etiket: 'asistan en az bir soruda kurumu andı' },
    { sayi: `${t.atifSaglayici}/${t.saglayici}`, etiket: 'asistan atıf (kaynak/link) verdi' },
    { sayi: `${t.anilanCevap}/${t.olculenCevap}`, etiket: `ölçülen cevapta anıldı (${yuzde(t.anilanCevap, t.olculenCevap)})` },
    { sayi: `${t.atifCevap}/${t.olculenCevap}`, etiket: `ölçülen cevapta atıf (${yuzde(t.atifCevap, t.olculenCevap)})` },
    { sayi: `${o.bosluklar.length}/${o.olculenSoruSayisi}`, etiket: 'ölçülen soruda hiçbir asistan anmadı (boşluk)' },
  ]
    .map((k) => `<div class="kart"><div class="sayi">${e(k.sayi)}</div><div class="etiket">${e(k.etiket)}</div></div>`)
    .join('');

  // Asistan x soru tablosu — satir: soru, sutun: asistan
  const basliklar = o.saglayicilar
    .map((s) => {
      const ad = KISA_AD[s.provider] ?? s.label;
      const durum = saglayiciOlculemedi(s) ? ' <span style="font-weight:400;color:#a8a29e">(ölçülemedi)</span>' : '';
      return `<th class="asistan" title="${e(s.label)}">${e(ad)}${durum}</th>`;
    })
    .join('');
  const satirlar = o.sorular
    .map((soru, i) => {
      const markali = o.markaliSorular.includes(soru);
      const hucreler = o.saglayicilar
        .map((s) => {
          const h = s.hucreler[i];
          if (h.hata) return '<td class="h hata" title="sağlayıcı hatası veya reddi — ölçülemedi, sayıma girmez">!</td>';
          if (!h.olculdu) return '<td class="h yok" title="ölçülemedi">—</td>';
          if (h.markali) return '<td class="h yok" title="markalı soru — skora girmez">m</td>';
          if (h.atif) return `<td class="h atif" title="atıf (kaynak/link) + anıldı">◎${h.sira ? ' #' + h.sira : ''}</td>`;
          if (h.anildi) return `<td class="h anildi" title="anıldı">●${h.sira ? ' #' + h.sira : ''}</td>`;
          return '<td class="h" title="anılmadı">·</td>';
        })
        .join('');
      const etiket = markali ? ' <em style="color:#a8a29e">(markalı — skora girmez)</em>' : '';
      return `<tr><td>${i + 1}</td><td>${e(soru)}${etiket}</td>${hucreler}</tr>`;
    })
    .join('');
  const toplamSatir = o.saglayicilar
    .map((s) => (saglayiciOlculemedi(s) ? '<td class="h yok">—</td>' : `<td class="h">${s.anilanSoru} / ${s.atifSoru}</td>`))
    .join('');

  // Rakip payi
  const verilen = new Set(o.verilenRakipler);
  const rakipSatirlar = o.rakipPayi
    .slice(0, 12)
    .map((r) => {
      const ad = r.isBrand ? `${e(r.name)} <span style="font-weight:400;color:var(--soluk)">(${e(o.host)})</span>` : e(r.name);
      const isaret = !r.isBrand && verilen.has(r.name.toLowerCase()) ? ' <span title="karneyi isteyen kurumun verdiği rakip">★</span>' : '';
      return `<tr class="${r.isBrand ? 'marka-satir' : ''}"><td>${ad}${isaret}</td><td class="h">${r.mentions}</td><td class="h">%${r.pct}</td></tr>`;
    })
    .join('');
  const gorunmeyenVerilen = o.verilenRakipler.filter((v) => !o.rakipPayi.some((r) => !r.isBrand && r.name.toLowerCase() === v));
  const rakipBlok = o.rakipPayi.length === 0
    ? '<p class="meta">Ölçülen cevaplarda ne kurum ne de bir rakip alan adı geçti — pay hesaplanamadı.</p>'
    : `<div class="sarmal"><table><thead><tr><th>Kurum / rakip alan adı</th><th class="asistan">Kaç cevapta</th><th class="asistan">Pay</th></tr></thead><tbody>${rakipSatirlar}</tbody></table></div>
       <p class="lejant">Birim "kaç cevapta göründü" — bir cevapta 5 kez geçen rakip 1 sayılır. Rakipler tüm cevaplardan, kurum kredisi yalnız markasız cevaplardan toplanır.${o.verilenRakipler.length ? ' ★ = kurumun bildirdiği rakip; cevaplarda ayrıca arandı.' : ''}${gorunmeyenVerilen.length ? ` Verilen ama hiç görünmeyen rakipler: ${e(gorunmeyenVerilen.join(', '))}.` : ''}</p>`;

  // Bosluk listesi
  const boslukBlok = olcumYok
    ? '<p class="meta">Ölçüm yapılamadı (hiçbir asistan cevap vermedi) — boşluk listesi çıkarılamadı.</p>'
    : o.bosluklar.length === 0
      ? '<p>Boşluk yok — her ölçülen markasız soruda en az bir asistan kurumu andı.</p>'
      : `<ul class="bosluk">${o.bosluklar.map((b) => `<li>${e(b)}</li>`).join('')}</ul>`;

  // NEDEN notr metin: ham reason operasyonel/ic bilgidir (anahtar durumu, HTTP govdesi).
  const olculemeyen = o.saglayicilar.filter(saglayiciOlculemedi);
  const olculemeyenMetin = olculemeyen.length
    ? `<li>Ölçülemeyen asistanlar: ${olculemeyen.map((s) => e(s.label)).join(', ')} — ${OLCULEMEDI_METNI}; sayımlara girmedi.</li>`
    : '';
  const hataMetin = t.hataliCevap > 0
    ? `<li>${t.hataliCevap} cevap sağlayıcı hatası veya reddi nedeniyle ölçülemedi (tabloda "!"); bu hücreler ne "anılmadı" ne boşluk sayıldı.</li>`
    : '';
  const markaliMetin = o.markaliSorular.length
    ? `<li>${o.markaliSorular.length} soruda kurum adı geçtiği için o satırlar skora girmedi ("m" ile işaretli).</li>`
    : '<li>Soruların hiçbirinde kurum adı geçmez; tüm satırlar skora girdi.</li>';

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${e(baslik)}</title>
<style>${CSS}</style>
</head>
<body>
<header class="ust">
  <div class="marka">RanksUp · bağımsız sektör araştırması</div>
  <h1>${e(baslik)}</h1>
  <div class="meta">${e(o.host)} · ${e(sektorAdi)}${o.altsektor ? ' · ' + e(o.altsektor) : ''} · ${e(o.tarihMetni)} · ${t.aktifSaglayici}/${t.saglayici} asistan · ${o.sorular.length} soru</div>
  <div class="gizli">GİZLİ — yalnız ${e(o.brand)} için hazırlandı; üçüncü kişiyle paylaşılmaz</div>
</header>

<h2>Özet</h2>
<div class="kartlar">${kartlar}</div>

<h2>Asistan × soru</h2>
<div class="sarmal">
<table>
  <thead><tr><th>#</th><th>Müşteri sorusu (markasız)</th>${basliklar}</tr></thead>
  <tbody>${satirlar}
  <tr class="toplam"><td></td><td>Toplam (anıldı / atıf)</td>${toplamSatir}</tr></tbody>
</table>
</div>
<p class="lejant"><span>● anıldı</span><span>◎ atıf (kaynak/link verildi)</span><span>#n = cevapta ilk geçtiği satır/madde sırası</span><span>· anılmadı</span><span>! sağlayıcı hatası/reddi (sayıma girmez)</span><span>— ölçülemedi</span></p>

<h2>Rakip payı (share of voice)</h2>
${rakipBlok}

<h2>Boşluklar — kurumun hiç görünmediği sorular</h2>
${boslukBlok}

<h2>Metodoloji</h2>
<div class="not"><ul>
  <li>Sorular gerçek müşteri dilinde ve <strong>markasız</strong>dır: hiçbirinde kurum adı geçmez. Kurum adı geçen soruda anılmak görünürlük değil tanınırlıktır.</li>
  ${markaliMetin}
  <li>Bu karne <strong>tek koşumdur = anlık görüntü</strong>. Asistan cevapları günden güne değişir; kesin hüküm için aynı soruların <strong>en az 2 farklı günde</strong> sorulması gerekir. Buradaki sayılar "şu an böyle görünüyor" der, "hep böyle" demez.</li>
  <li>${t.saglayici} asistan soruldu: ${o.saglayicilar.map((s) => e(s.label)).join(', ')}. Her asistana aynı ${o.sorular.length} soru, aynı gün, aynı sistem yönergesiyle soruldu.</li>
  ${olculemeyenMetin}
  ${hataMetin}
  <li>"Anıldı" = cevapta kurum adı kelime sınırıyla geçti. "Atıf" = cevap kurumun alan adını kaynak/link olarak verdi. Sıra = kurumun cevapta ilk geçtiği satır/madde (1 = en üstte; liste maddeleri ayrı satır sayılır).</li>
  <li>Rakip alan adları cevap metninden otomatik çıkarıldı; arama motorları, sosyal ağlar, ansiklopediler ve AI sağlayıcıları sayılmaz.</li>
  <li>Toplam ${o.cagriSayisi} asistan çağrısı. Ölçüm tarihi: ${e(o.tarihMetni)}.</li>
</ul></div>

<div class="not" style="margin-top:18px">
  <!-- NEDEN tek satir: rapor bagimsiz olcum belgesi; satis brosurune cevrilmez. Sonraki adim
       bir yerde yazmali ama one cikmamali. Randevu linki yoksa o parca hic basilmaz. -->
  Bu ölçümü sürekli takip etmek isterseniz: <a href="https://ranksup.ai/pricing">ranksup.ai/pricing</a>${
    secenek.randevuUrl ? ` · görüşme: <a href="${e(secenek.randevuUrl)}">${e(secenek.randevuUrl)}</a>` : ''
  }
</div>

<div class="alt">RanksUp (Luvi Host) · ${e(o.tarihMetni)} · Bu belge ${e(o.brand)} için hazırlanmış gizli bir çalışmadır; kurum dışına çıkarılmaz, kamuya yalnız isimsiz toplu istatistik açıklanır.</div>
</body>
</html>
`;
}
