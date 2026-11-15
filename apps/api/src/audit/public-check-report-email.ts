import { FONT, MARKA, MONO, dugme, duzen, ekranBolucu, ekranKarti, h, kacisla, p, ray } from '../email/email-layout.js';
import { ENGINE_LABELS } from '../billing/plans.js';
import { ATTEMPT_LABEL_TR, type AttemptOutcome, type AttemptSummary } from './public-check-attempt.js';

/**
 * Ucretsiz test bildirimi — yoneticiye giden E-POSTANIN govdesi (saf; I/O yok).
 *
 * NEDEN VAR (15.11.2026, sahip: "mail tasarimini degistirelim; sitemize uygun olsun ve raporu
 * gorebilelim"): bildirim e-postasi iki satir metin + "Panelde aç" dugmesiydi ve acik renkli
 * eski e-posta duzeniyle gidiyordu. Sahip, ziyaretcinin NE GORDUGUNU e-postada okumak istiyor:
 * skor, soru soru hangi asistan andi, markayi anan cevabin metni, rakip siralamasi.
 *
 * NE GIDER: ziyaretcinin ekraninda gordugu sonucun aynisi (PublicCheckResult) + kilitli
 * sorularin metni. Kisi bilgisi YOK (public-check-attempt.ts ile ayni sinir: alan adi ve
 * sonuc). Alici yalniz yonetici hesabidir.
 *
 * SAYILAR sonuc ekraniyla AYNI kuraldan (web components/landing/checker-overlay.tsx summarize):
 * skor = acik ve markasiz sorularda, olculen cevaplarin yuzde kaci markayi andi; markasiz soru
 * yoksa acik sorularin tamami. Asistan "andi" = bu sorulardan en az birinde andi ya da kaynak
 * gosterdi. Hata veren saglayici (measured false) sayilara girmez.
 *
 * E-POSTA KURALLARI (email-layout.ts): tablo yerlesimi, satir ici stil, SVG ve dis gorsel yok.
 * Asistan logolari bu yuzden yok; ad + isaret yazilir. Sonuc metinleri (soru, cevap alintisi,
 * rakip adi) disaridan gelir: HEPSI kacislanir.
 */

/** Bir e-postaya girecek en fazla satir (buyuk / bozuk kayit e-postayi sisirmesin) */
const MAX_OPEN_QUESTIONS = 10;
const MAX_LOCKED_QUESTIONS = 12;
const MAX_COMPETITORS = 8;
const MAX_QUERY_CHARS = 300;
const MAX_NAME_CHARS = 120;
/** Sunucu cevabin ilk 220 karakterini yollar; bu uzunluga yakin alinti kesilmis sayilir (web ile ayni) */
const EXCERPT_TRUNCATED_FROM = 210;
const MAX_EXCERPT_CHARS = 400;

const CATEGORY_TR: Record<string, string> = {
  DISCOVERY: 'Keşif',
  COMPARISON: 'Karşılaştırma',
  BRAND: 'Marka',
  PROBLEM: 'Problem',
  BUYING_INTENT: 'Satın alma niyeti',
};

export type ProviderState = 'cited' | 'absent' | 'unmeasured';

export interface AttemptReport {
  brand: string | null;
  /** 0-100; olculen cevap yoksa null (0 "hic anilmadi" diye okunurdu) */
  score: number | null;
  /** Skora giren sorularda olculen asistanlar */
  engines: Array<{ label: string; cited: boolean }>;
  questions: Array<{
    no: number;
    query: string;
    category: string | null;
    /** Soruda marka adi geciyor: anilmak beklenen sonuc, skora girmez */
    branded: boolean;
    cited: number;
    total: number;
    providers: Array<{ label: string; state: ProviderState }>;
    /** Markayi anan / kaynak gosteren asistanlarin cevap alintisi */
    answers: Array<{ label: string; excerpt: string; truncated: boolean }>;
  }>;
  /** Listelenen ama olculmeyen sorular (ziyaretci kilitli gordu) */
  locked: Array<{ no: number; query: string }>;
  competitors: Array<{ name: string; pct: number; isBrand: boolean }>;
  /** Kayitli sonucun olcum ani (ISO); taze olcumde null */
  measuredAt: string | null;
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

function engineLabel(p: { provider?: unknown; label?: unknown }): string {
  const id = typeof p.provider === 'string' ? p.provider : '';
  return (ENGINE_LABELS as Record<string, string>)[id] || str(p.label, 40) || id || 'Asistan';
}

/**
 * Sonuctan e-posta raporu. Sonuc yoksa ya da soru listesi okunamiyorsa null: e-posta raporsuz
 * (yalniz durum notuyla) gider — eski / bozuk kayit bildirimi dusurmez.
 */
export function reportOfResult(result: unknown): AttemptReport | null {
  const r = result as Record<string, any> | null | undefined;
  if (!r || !Array.isArray(r.queries)) return null;
  const rows: any[] = r.queries.filter((q: any) => q && typeof q.query === 'string' && q.query.trim());
  if (rows.length === 0) return null;

  const numbered = rows.map((q, i) => ({ q, no: i + 1 }));
  const open = numbered.filter(({ q }) => q.locked !== true);
  const scored = open.filter(({ q }) => q.brandInQuery !== true);
  const base = scored.length > 0 ? scored : open;

  const total = base.reduce((n, { q }) => n + num(q.totalProviders), 0);
  const cited = base.reduce((n, { q }) => n + num(q.citedCount), 0);

  const engines = new Map<string, { label: string; cited: boolean }>();
  for (const { q } of base) {
    for (const p of Array.isArray(q.providers) ? q.providers : []) {
      if (!p || p.measured === false) continue;
      const key = typeof p.provider === 'string' && p.provider ? p.provider : engineLabel(p);
      const e = engines.get(key) ?? { label: engineLabel(p), cited: false };
      e.cited = e.cited || p.cited === true || p.brandMentioned === true;
      engines.set(key, e);
    }
  }

  const questions = open.slice(0, MAX_OPEN_QUESTIONS).map(({ q, no }) => {
    const providers: any[] = Array.isArray(q.providers) ? q.providers.filter(Boolean) : [];
    return {
      no,
      query: str(q.query, MAX_QUERY_CHARS),
      category: typeof q.category === 'string' ? CATEGORY_TR[q.category] ?? null : null,
      branded: q.brandInQuery === true,
      cited: num(q.citedCount),
      total: num(q.totalProviders),
      providers: providers.map((p) => ({
        label: engineLabel(p),
        state: (p.measured === false ? 'unmeasured' : p.cited === true || p.brandMentioned === true ? 'cited' : 'absent') as ProviderState,
      })),
      answers: providers
        .filter((p) => p.measured !== false && (p.cited === true || p.brandMentioned === true))
        .map((p) => ({ label: engineLabel(p), raw: typeof p.excerpt === 'string' ? p.excerpt.replace(/\s+/g, ' ').trim() : '' }))
        // "HATA:" ile baslayan alinti olculemeyen bir denemenin izidir; cevap degildir
        .filter((a) => a.raw && !a.raw.startsWith('HATA:'))
        .map((a) => ({ label: a.label, excerpt: a.raw.slice(0, MAX_EXCERPT_CHARS), truncated: a.raw.length >= EXCERPT_TRUNCATED_FROM })),
    };
  });

  const competitors = (Array.isArray(r.competitorRanking) ? r.competitorRanking : [])
    .filter((c: any) => c && str(c.name, MAX_NAME_CHARS))
    .slice(0, MAX_COMPETITORS)
    .map((c: any) => ({ name: str(c.name, MAX_NAME_CHARS), pct: num(c.pct), isBrand: c.isBrand === true }));

  const cachedAt = r.fromCache === true && r.cachedAt ? new Date(r.cachedAt) : null;

  return {
    brand: str(r.brand, MAX_NAME_CHARS) || null,
    score: total > 0 ? Math.round((cited / total) * 100) : null,
    engines: [...engines.values()],
    questions,
    locked: numbered.filter(({ q }) => q.locked === true).slice(0, MAX_LOCKED_QUESTIONS).map(({ q, no }) => ({ no, query: str(q.query, MAX_QUERY_CHARS) })),
    competitors,
    measuredAt: cachedAt && !Number.isNaN(cachedAt.getTime()) ? cachedAt.toISOString() : null,
  };
}

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

/** "12 Kasım 2026" — Turkiye saatiyle (UTC+3, yaz saati yok). ICU'ya bagli degil. */
export function trTarih(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const d = new Date(t + 3 * 60 * 60 * 1000);
  return `${d.getUTCDate()} ${AYLAR[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const M = MARKA;
const sans = `font-family:${FONT};`;
const CIP = 'display:inline-block;margin:0 6px 6px 0;padding:6px 10px;border-radius:6px;font-size:13px;line-height:16px;';

/** Asistan cipi, koyu zeminde: ad + isaret. Durum yalniz renkle anlatilmaz (isaret de var). */
function cip(label: string, state: ProviderState): string {
  if (state === 'cited') {
    return `<span style="${CIP}border:1px solid ${M.yesilCizgi};background:${M.yesilZemin};color:${M.yesil};">${kacisla(label)} &#10003;</span>`;
  }
  if (state === 'unmeasured') {
    return `<span style="${CIP}border:1px dashed ${M.cizgi};color:${M.silik};">${kacisla(label)} &ndash; yanıt yok</span>`;
  }
  return `<span style="${CIP}border:1px solid ${M.cizgi};color:${M.soluk};">${kacisla(label)} &#10005;</span>`;
}

/** Asistan cipi, ekran kartinda */
function ekranCip(label: string, cited: boolean): string {
  return cited
    ? `<span style="${CIP}border:1px solid ${M.iyiCizgi};background:${M.iyiZemin};color:${M.iyi};font-weight:600;">${kacisla(label)} &#10003;</span>`
    : `<span style="${CIP}border:1px solid ${M.ekranCizgi};color:${M.ekranSoluk};">${kacisla(label)} &#10005;</span>`;
}

/**
 * Cevap alintisinda marka adini belirginlestir. HAM metin marka desenine gore bolunur, parcalar
 * AYRI AYRI kacislanir. Eskiden kacislanmis metin uzerinde araniyordu: markasi "Amp" olan sitede
 * "Tom & Jerry" alintisi `&amp;` varliginin ORTASINDAN bolunuyor, e-postada "Tom &amp; Jerry"
 * gorunuyordu.
 */
export function markala(excerpt: string, brand: string | null): string {
  const b = brand ? brand.trim() : '';
  if (b.length < 3) return kacisla(excerpt);
  // Yakalama grubu: split eslesen parcalari da dondurur (tek indeksler = marka)
  const desen = new RegExp(`(${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return excerpt
    .split(desen)
    .map((parca, i) => (i % 2 === 1 ? `<span style="color:${M.ink};font-weight:600;">${kacisla(parca)}</span>` : kacisla(parca)))
    .join('');
}

/** Koyu zeminde cerceveli kart (ayrinti bolumleri) */
function kart(icerik: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${M.kart}" style="margin:0 0 10px;background:${M.kart};border:1px solid ${M.cizgi};border-radius:10px;">${icerik}</table>`;
}

/**
 * Ustteki EKRAN KARTI (email-layout.ts): e-postanin "gorseli". Kim test edildi, skor ve hangi
 * asistanin andigi tek bakista; resim degil, sonucun kendisi.
 */
function ozetKarti(a: AttemptEmailInput, report: AttemptReport, kim: string): string {
  const anan = report.engines.filter((e) => e.cited).length;
  const cumle = report.engines.length > 0
    ? `${report.engines.length} AI asistanının ${anan} tanesinde anıldı`
    : 'Bu testte ölçülen cevap yok';
  return ekranKarti(`
    <div style="font-family:${MONO};font-size:12px;line-height:16px;color:${M.ekranSoluk};">Ücretsiz test · ${kacisla(ATTEMPT_LABEL_TR[a.outcome].toLocaleLowerCase('tr-TR'))}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="top" style="padding-top:8px;${sans}">
        <div style="font-size:24px;line-height:1.2;font-weight:700;letter-spacing:-.6px;color:${M.ekranInk};word-break:break-word;">${kacisla(a.domain)}</div>
        ${kim ? `<div style="margin-top:4px;font-size:14px;line-height:1.45;color:${M.ekranSoluk};">${kacisla(kim)}</div>` : ''}
      </td>
      <td valign="top" align="right" style="padding:2px 0 0 16px;white-space:nowrap;${sans}">
        <div style="font-size:44px;line-height:1;font-weight:700;letter-spacing:-2px;color:${M.ekranInk};">${report.score === null ? '&mdash;' : report.score}</div>
        <div style="font-family:${MONO};font-size:11px;color:${M.ekranSoluk};margin-top:4px;">skor / 100</div>
      </td>
    </tr></table>
    ${ekranBolucu()}
    <div style="font-size:15px;font-weight:600;color:${M.ekranInk};margin-bottom:12px;">${cumle}</div>
    ${report.engines.length > 0 ? `<div>${report.engines.map((e) => ekranCip(e.label, e.cited)).join('')}</div>` : ''}`);
}

function soruKarti(q: AttemptReport['questions'][number], brand: string | null): string {
  const etiketStili = `display:inline-block;margin-right:6px;padding:2px 6px;border-radius:4px;font-family:${MONO};font-size:11px;line-height:14px;font-weight:400;color:${M.soluk};`;
  const etiketler = [
    q.category ? `<span style="${etiketStili}border:1px solid ${M.cizgi};">${kacisla(q.category)}</span>` : '',
    q.branded ? `<span style="${etiketStili}background:${M.secili};">markalı soru, skora girmez</span>` : '',
  ].join('');
  // Markali soruda yesil sayi yok: adi soruda gecen markanin anilmasi beklenen sonuc (web ile ayni)
  const sayiRengi = !q.branded && q.cited > 0 ? M.yesil : M.soluk;
  const alintilar = q.answers.map((a) => `
      <tr><td colspan="3" style="padding:0 20px 10px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${M.alintiZemin}" style="background:${M.alintiZemin};border:1px solid ${M.alintiCizgi};border-radius:8px;">
          <tr><td style="padding:12px 14px;${sans}font-size:13px;line-height:1.6;color:${M.soluk};text-align:left;">
            <div style="font-weight:600;color:${M.ink};margin-bottom:4px;">${kacisla(a.label)} <span style="font-weight:400;color:${M.soluk};">&middot; AI cevabı</span></div>
            ${markala(a.excerpt, brand)}${a.truncated ? ` <span style="color:${M.silik};">(kısaltıldı)</span>` : ''}
          </td></tr>
        </table>
      </td></tr>`).join('');
  return kart(`
      <tr>
        <td valign="top" style="padding:18px 0 0 20px;width:30px;">
          <div style="width:26px;height:26px;line-height:26px;text-align:center;background:${M.ink};color:${M.zemin};border-radius:4px;font-family:${MONO};font-size:12px;">${q.no}</div>
        </td>
        <td valign="top" style="padding:20px 12px 0;${sans}font-size:15px;line-height:1.45;font-weight:500;color:${M.ink};text-align:left;">
          ${kacisla(q.query)}
          ${etiketler ? `<div style="margin-top:8px;">${etiketler}</div>` : ''}
        </td>
        <td valign="top" align="right" style="padding:18px 20px 0 0;white-space:nowrap;${sans}font-size:22px;line-height:1.2;font-weight:500;color:${M.soluk};"><span style="color:${sayiRengi};">${q.cited}</span> / ${q.total}</td>
      </tr>
      <tr><td colspan="3" style="padding:14px 20px ${q.answers.length > 0 ? 6 : 12}px;${sans}text-align:left;">${q.providers.map((p) => cip(p.label, p.state)).join('')}</td></tr>
      ${alintilar}
      ${q.answers.length > 0 ? '<tr><td colspan="3" style="height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr>' : ''}`);
}

function rakipKarti(competitors: AttemptReport['competitors']): string {
  const satirlar = competitors.map((c, i) => {
    const sira = c.isBrand ? `background:${M.ink};color:${M.zemin};` : `border:1px solid ${M.cizgi};color:${M.soluk};`;
    return `
          <tr${c.isBrand ? ` bgcolor="${M.secili}" style="background:${M.secili};"` : ''}>
            <td style="padding:8px 10px;width:26px;${c.isBrand ? 'border-radius:6px 0 0 6px;' : ''}"><div style="width:22px;height:22px;line-height:22px;text-align:center;border-radius:4px;font-family:${MONO};font-size:11px;${sira}">${i + 1}</div></td>
            <td style="padding:8px 4px;${sans}font-size:14px;font-weight:500;color:${M.ink};text-align:left;">${kacisla(c.name)}${c.isBrand ? ` <span style="font-size:12px;font-weight:400;color:${M.soluk};">(test edilen marka)</span>` : ''}</td>
            <td align="right" style="padding:8px 10px;${c.isBrand ? 'border-radius:0 6px 6px 0;' : ''}font-family:${MONO};font-size:13px;color:${c.isBrand ? M.ink : M.soluk};">${c.pct}%</td>
          </tr>`;
  }).join('');
  return kart(`<tr><td style="padding:8px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${satirlar}</table></td></tr>`);
}

/** Ayrinti bolumu basligi (sola hizali mono etiket + bosluk) */
const bolumBasligi = (metin: string, ust: number) => `<div style="margin:${ust}px 0 10px;">${ray(metin)}</div>`;

/** Basligin ne oldugunu soyleyen cumlesi (alan adi basta; h() kacislar) */
const BASLIK: Record<AttemptOutcome, (alan: string) => string> = {
  measured: (alan) => `${alan} için ücretsiz test yapıldı`,
  cached: (alan) => `${alan} için kayıtlı sonuç gösterildi`,
  rate_limited: (alan) => `${alan} denemesi haftalık sınıra takıldı`,
  budget: (alan) => `${alan} denemesi günlük tavana takıldı`,
  failed: (alan) => `${alan} testi tamamlanamadı`,
};

export interface AttemptEmailInput {
  /** Konu satiri (attemptNotification title) */
  title: string;
  domain: string;
  outcome: AttemptOutcome;
  /** Durumu anlatan tek cumle (attemptNotification note) */
  note: string;
  summary?: AttemptSummary;
  report?: AttemptReport | null;
  /** "Panelde aç" hedefi (tam adres) */
  panelUrl: string;
  baseUrl?: string;
}

/**
 * Yoneticiye giden ucretsiz test bildiriminin tam HTML belgesi.
 * Kompozisyon (email-layout.ts): ekran karti (ozet) → baslik → durum cumlesi → "Panelde aç" →
 * raporun ayrintisi (soru soru sonuc, rakipler, kilitli sorular).
 */
export function attemptEmailHtml(a: AttemptEmailInput): string {
  const report = a.report && (a.outcome === 'measured' || a.outcome === 'cached') ? a.report : null;
  const kim = [a.summary?.brand ?? report?.brand, a.summary?.niche].filter(Boolean).join(' · ');
  const tarih = report ? trTarih(report.measuredAt) : null;
  const govde: string[] = [];

  if (report) govde.push(ozetKarti(a, report, kim));
  govde.push(h(BASLIK[a.outcome](a.domain)));
  // Raporsuz e-postada (olcum yapilmayan / okunamayan kayit) kim oldugu basligin altinda yazar
  if (!report && kim) govde.push(p(kacisla(kim)));
  govde.push(p(`${kacisla(a.note)}${tarih ? ` Ölçüm tarihi: ${tarih}.` : ''}`));
  govde.push(dugme('Panelde aç', kacisla(a.panelUrl)));
  const siteUrl = `https://${encodeURI(a.domain)}`;
  govde.push(`<p style="margin:14px auto 0;${sans}font-size:14px;line-height:1.6;color:${M.soluk};text-align:center;">Siteyi aç: <a href="${kacisla(siteUrl)}" target="_blank" style="color:${M.ink};text-decoration:underline;">${kacisla(a.domain)}</a></p>`);

  if (report && (report.questions.length > 0 || report.competitors.length > 0 || report.locked.length > 0)) {
    const ayrinti: string[] = [];
    if (report.questions.length > 0) {
      ayrinti.push(bolumBasligi('Marka bu AI cevaplarında geçti mi?', 0));
      for (const q of report.questions) ayrinti.push(soruKarti(q, report.brand));
    }
    if (report.competitors.length > 0) {
      ayrinti.push(bolumBasligi('Rakip karşılaştırması', 24));
      ayrinti.push(rakipKarti(report.competitors));
    }
    if (report.locked.length > 0) {
      ayrinti.push(bolumBasligi(`Ziyaretçinin görmediği ${report.locked.length} soru (kilitli, ölçülmedi)`, 24));
      ayrinti.push(report.locked.map((q, i) => `<div style="padding:10px 0;border-top:1px solid ${M.cizgi};${i === report.locked.length - 1 ? `border-bottom:1px solid ${M.cizgi};` : ''}${sans}font-size:14px;line-height:1.55;color:${M.soluk};text-align:left;">${q.no} &nbsp; ${kacisla(q.query)}</div>`).join(''));
    }
    govde.push(`<div style="border-top:1px solid ${M.cizgi};margin:40px 0 28px;font-size:0;line-height:0;">&nbsp;</div>`);
    govde.push(`<div style="text-align:left;">${ayrinti.join('\n')}</div>`);
  }

  return duzen(a.title, govde.join('\n'), {
    onizleme: [kim, a.note].filter(Boolean).join(' — '),
    baseUrl: a.baseUrl,
    gorsel: 'hedef',
    altNot: 'Bu e-posta yönetici hesabına gönderilen bir bildirimdir.',
  });
}
