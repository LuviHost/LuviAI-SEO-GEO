import type { RunComparison } from './citation-run-compare.js';

/**
 * GEO Karsilastirma Raporu — iki AI gorunurluk kosumunun A4 yazdirilabilir raporu.
 *
 * NEDEN ayri dosya (panel bileseni degil): rapor musteriye gonderilir/yazdirilir; tek dosya HTML
 * (inline CSS, break-inside kurallari) olmasi gerekir. Panel bunu iframe/yeni sekmede acar.
 * Tasarim: koyu kapak + numarali bolumler, marka turuncusu #F97316, Inter.
 *
 * KURAL: rapordaki her sayi `compareCitationRuns` ciktisindan gelir; burada hesap YAPILMAZ,
 * yalniz bicimlendirme olur. Markali sorular zaten karsilastirmaya girmez (brand-in-query.ts).
 */

const R = {
  koyu: '#0B0F17',
  metin: '#0F172A',
  gri: '#64748B',
  soluk: '#94A3B8',
  cizgi: '#E2E8F0',
  zemin: '#F1F5F9',
  cubuk: '#CBD5E1',
  marka: '#F97316',
  artiFg: '#059669',
  artiBg: '#ECFDF5',
  eksiFg: '#DC2626',
  eksiBg: '#FEF2F2',
} as const;

/** Saglayici renkleri — panel grafigiyle ayni dil */
const MOTOR_RENK: Record<string, string> = {
  openai: '#10B981',
  perplexity: '#F59E0B',
  anthropic: '#8B5CF6',
  gemini: '#3B82F6',
  deepseek: '#0EA5E9',
  xai: '#EF4444',
  meta: '#94A3B8',
};

const MOTOR_AD: Record<string, string> = {
  openai: 'ChatGPT',
  perplexity: 'Perplexity',
  anthropic: 'Claude',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  xai: 'Grok (xAI)',
  // Olcum servisinin etiketiyle ayni (ai-citation.service runProvider)
  meta: 'Meta AI (Llama)',
};

const motorAdi = (p: { provider: string; label?: string }) => MOTOR_AD[p.provider] ?? p.label ?? p.provider;

/**
 * Kosum tetigi → etiket; panelin test listesiyle ayni kural
 * (citation-history-chart.tsx: 'system' otomatik, digeri senin testin).
 * Eskiden 'manual' ile karsilastiriliyordu; kosumlar 'user' | 'system'
 * yazdigi icin (ai-citation-tracker snapshotSite) musterinin kendi testi de
 * "otomatik" basiliyordu. Bilinmeyen deger icin etiket basilmaz.
 */
export function tetikEtiketi(trigger: string | undefined): string | null {
  if (trigger === 'system') return 'otomatik';
  if (trigger === 'user') return 'senin testin';
  return null;
}

/**
 * Olcum yontemi surumlerinin (host-match.ts CITATION_MATCH_VERSION) musteriye
 * anlatimi. Eski not her zaman v2'yi ("benzer alan adlari") anlatiyordu; v3 →
 * v4 gecisinde degisen ise anilma ve HATA kuraliydi.
 */
const YONTEM_DEGISIKLIGI: Record<number, string> = {
  2: 'benzer alan adları artık atıf sayılmıyor (ör. ornek.com için notornek.com ya da ornek.com.tr)',
  3: 'web araması yapan motorlarda (ChatGPT, Gemini, Claude) cevabın kaynak listesindeki alan adı da atıf sayılıyor',
  4: 'alan adından türetilen jenerik marka adı (ör. eticaret.com için “eticaret”) tek başına anılma sayılmıyor ve hata veren cevaplar ölçüme girmiyor',
};

export function yontemNotu(v: { a: number; b: number } | undefined): string {
  const degisiklikler: string[] = [];
  if (v) {
    const [alt, ust] = v.a <= v.b ? [v.a, v.b] : [v.b, v.a];
    for (let s = alt + 1; s <= ust; s++) if (YONTEM_DEGISIKLIGI[s]) degisiklikler.push(YONTEM_DEGISIKLIGI[s]);
  }
  return `Ölçüm yöntemi iki test arasında güncellendi${degisiklikler.length ? `: ${degisiklikler.join('; ')}` : ''}. ` +
    'Farklar yöntemden kaynaklanabileceği için hesaplanmadı; iki testin sayıları ayrı ayrı okunmalı.';
}

export interface GeoRaporGirdi {
  karsilastirma: RunComparison;
  brand: string;
  host: string;
  /** Trend grafigi icin gunluk manset serisi (opsiyonel) */
  trend?: Array<{ date: string; score: number | null }>;
  /** Rapor numarasi (yoksa tarihten uretilir) */
  raporNo?: string;
}

function e(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

const saat =(iso: string) => new Date(iso).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** Delta rozeti — pozitif yesil, negatif kirmizi, sifir gri */
function rozet(d: number | null): { metin: string; bg: string; fg: string } {
  if (d === null) return { metin: '—', bg: R.zemin, fg: R.gri };
  if (d > 0) return { metin: `+${d}`, bg: R.artiBg, fg: R.artiFg };
  if (d < 0) return { metin: `−${Math.abs(d)}`, bg: R.eksiBg, fg: R.eksiFg };
  return { metin: '0', bg: R.zemin, fg: R.gri };
}

function bolumBasligi(no: string, baslik: string, sagNot?: string): string {
  return `<div style="display:flex;align-items:baseline;gap:10px;border-bottom:2px solid ${R.metin};padding-bottom:8px;margin-bottom:14px;">
  <span style="font-size:11px;font-weight:800;color:${R.marka};">${no}</span>
  <h2 style="margin:0;font-size:14px;font-weight:800;letter-spacing:0.04em;">${e(baslik)}</h2>
  ${sagNot ? `<span style="margin-left:auto;font-size:9.5px;color:${R.soluk};">${e(sagNot)}</span>` : ''}
</div>`;
}

/** 02 — gunluk manset serisi; nokta yoksa bolum hic basilmaz */
function trendSvg(seri: Array<{ date: string; score: number | null }>): string {
  const noktalar = seri.filter((d): d is { date: string; score: number } => typeof d.score === 'number');
  if (noktalar.length < 2) return '';
  const G = { sol: 40, sag: 20, ust: 16, alt: 44 };
  const W = 700;
  const H = 224;
  const ic = { w: W - G.sol - G.sag, h: H - G.ust - G.alt };
  const enB = Math.max(100, ...noktalar.map((n) => n.score));
  const x = (i: number) => G.sol + (noktalar.length === 1 ? ic.w / 2 : (i / (noktalar.length - 1)) * ic.w);
  const y = (v: number) => G.ust + ic.h - (v / enB) * ic.h;
  const d = noktalar.map((n, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(n.score).toFixed(1)}`).join(' ');
  const alan = `${d} L${x(noktalar.length - 1).toFixed(1)},${(G.ust + ic.h).toFixed(1)} L${x(0).toFixed(1)},${(G.ust + ic.h).toFixed(1)} Z`;
  const etiketAralik = Math.max(1, Math.ceil(noktalar.length / 6));
  const etiketler = noktalar
    .map((n, i) => (i % etiketAralik === 0 || i === noktalar.length - 1
      ? `<text x="${x(i).toFixed(1)}" y="${H - 18}" font-size="9" fill="${R.soluk}" text-anchor="middle">${e(n.date.slice(8, 10))}.${e(n.date.slice(5, 7))}</text>`
      : ''))
    .join('');
  const yatay = [0, 25, 50, 75, 100]
    .filter((v) => v <= enB)
    .map((v) => `<line x1="${G.sol}" y1="${y(v).toFixed(1)}" x2="${W - G.sag}" y2="${y(v).toFixed(1)}" stroke="${R.cizgi}" stroke-width="1"/><text x="${G.sol - 8}" y="${(y(v) + 3).toFixed(1)}" font-size="9" fill="${R.soluk}" text-anchor="end">${v}</text>`)
    .join('');
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;display:block;" role="img" aria-label="Genel skor trendi">
  ${yatay}
  <path d="${alan}" fill="${R.marka}" opacity="0.10"/>
  <path d="${d}" fill="none" stroke="${R.marka}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
  ${noktalar.map((n, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(n.score).toFixed(1)}" r="2.6" fill="${R.marka}"/>`).join('')}
  ${etiketler}
</svg>`;
}

/**
 * 05 — Aksiyon onerileri. KURAL TABANLI (LLM yok): her madde raporun kendi sayisindan cikar,
 * cikmiyorsa yazilmaz. NEDEN: musteriye giden belgede uydurma tavsiye olmamali.
 */
function aksiyonlar(k: RunComparison): Array<{ baslik: string; metin: string; oncelik: 'YÜKSEK' | 'ORTA' }> {
  const out: Array<{ baslik: string; metin: string; oncelik: 'YÜKSEK' | 'ORTA' }> = [];
  // Olculmeyen (score null: 429, kota, anahtar yok, tanimsiz Llama) motor 0
  // puan DEGILDIR. Eskiden `?? 0` ile "hala 0 puan" diye oneriye giriyordu;
  // A'da 100 alan Claude B'de olculemeyince "Claude icin sinyal uret" deniyordu.
  const son = k.b.headlineScore;
  const sifirlar = k.providers.filter((p) => typeof p.after === 'number' && p.after === 0);
  const sifir = sifirlar.map(motorAdi);
  // "hala" yalniz A'da da olculup 0 alan motorlar icin dogru; A'da puani olan
  // ya da A'da olculemeyen motor icin B testindeki durum soylenir.
  const hepOnceden0 = sifirlar.every((p) => p.before === 0);
  const dusen = k.providers.filter((p) => typeof p.delta === 'number' && p.delta < 0);
  const m = k.mentions;

  if (typeof son === 'number' && son < 40) {
    // Eski metin "IndexNow + Google Indexing API ile indeksle. Motorlar siteyi
    // web aramasinda bulup atif vermeye baslar" diyordu: Google Indexing API
    // yalniz JobPosting / BroadcastEvent sayfalari icindir ve RanksUp artik
    // kullanmaz (ai-indexing-pinger.service.ts); bildirim de dizine alinmayi
    // ya da atifi garanti etmez ("it doesn't guarantee indexing" —
    // https://www.indexnow.org/faq).
    out.push({
      baslik: 'İçerik üret ve arama motorlarına bildir',
      metin: 'Test edilen sorulara cevap veren makaleler yayınla; yeni sayfaları site haritası ve Search Console ile bildir. Web araması yapan motorlar genellikle arama dizinindeki sayfaları kaynak gösterir; bildirim dizine alınmayı garanti etmez.',
      oncelik: 'YÜKSEK',
    });
  }
  if (m.after.cited > m.after.mentioned) {
    // Gercek sayi: atif var + anilma yok (cited && !mentioned). cited - mentioned
    // yalniz alt sinirdi (anilip atif almayan cevaplar farki kucultuyordu).
    const anilmayan = m.after.citedNotMentioned ?? m.after.cited - m.after.mentioned;
    out.push({
      baslik: 'Atıfı anılmaya çevir',
      metin: `${m.after.cited} ölçümde kaynak oldun ama adın ${anilmayan} tanesinde anılmadı. Marka adını başlıklara, tanım ve istatistik cümlelerine taşı.`,
      oncelik: 'YÜKSEK',
    });
  }
  for (const p of dusen.slice(0, 2)) {
    out.push({
      baslik: `${motorAdi(p)} düşüşünü araştır`,
      metin: `${p.before} → ${p.after} geriledi. Kaynak sayfaların erişilebilirliğini, robots kurallarını ve içerik güncelliğini kontrol et.`,
      oncelik: 'ORTA',
    });
  }
  if (sifir.length > 0) {
    // Eski metin "sosyal paylasimlar ve topluluk icerikleri ilk gorunurlugu
    // tetikler" diye bir sonuc vaat ediyordu; bunu gosteren bir olcum yok.
    // Oneri raporun kendi verisine (cevaplarin kaynaklari) yonlendirir.
    out.push({
      baslik: `${sifir.slice(0, 2).join(' & ')} için sinyal üret`,
      metin: `${sifir.length} motorda ${hepOnceden0 ? 'hâlâ' : 'B testinde'} 0 puan. Motorlar farklı kaynaklardan beslenir: bu motorların cevaplarında hangi sitelerin kaynak gösterildiğine bak ve markanın o tür kaynaklarda yer almasını hedefle. Etkisi garanti değildir.`,
      oncelik: 'ORTA',
    });
  }
  return out.slice(0, 5);
}

export function geoRaporHtml(g: GeoRaporGirdi): string {
  const k = g.karsilastirma;
  const raporNo = g.raporNo ?? `GEO-${new Date(k.b.runAt).getFullYear()}-${String(new Date(k.b.runAt).getMonth() + 1).padStart(2, '0')}${String(new Date(k.b.runAt).getDate()).padStart(2, '0')}`;
  const bugun = new Date().toLocaleDateString('tr-TR');
  const olcum = k.mentions.after.measured;
  const yontemDegisti = k.methodChanged === true;

  // Manset: iki testte de olculen motorlar uzerinden (citation-run-compare
  // headlineBasis). Eskiden kapak k.providers.length'i ("7 motor ort.")
  // yaziyordu: iki kosumun BIRLESIMI, olculemeyen Llama/429 alan motor dahil;
  // oysa manset yalniz olculenlerin ortalamasi. Alan yoksa (eski cagiran)
  // B'de sayisal skoru olan motorlar sayilir.
  const temel = k.headlineBasis;
  const ortakMotor = temel ? temel.providers.length : k.providers.filter((p) => typeof p.after === 'number').length;
  // "skor > 0 motor" kapaktaki motor sayisiyla AYNI kumeden sayilir (R23).
  // Eskiden B'de skoru olan HER motor sayiliyordu: A'da 429 alip yalniz B'de
  // olculen Claude dahil; ayni kapakta "5 motor" yanina "6 skor > 0 motor"
  // yaziliyordu. Yalniz B'de olculen motorlar kapak notunda ayrica soylenir
  // (kapsamNotu, tumMotorlarNotu).
  const tabanMotorlar = temel ? new Set(temel.providers) : null;
  const aktifMotor = k.providers.filter(
    (p) => (!tabanMotorlar || tabanMotorlar.has(p.provider)) && typeof p.after === 'number' && p.after > 0,
  ).length;
  const kumeAyni = !temel || (temel.aProviders === ortakMotor && temel.bProviders === ortakMotor);
  const onceSkor = temel && ortakMotor > 0 ? temel.before : k.a.headlineScore;
  const sonraSkor = temel && ortakMotor > 0 ? temel.after : k.b.headlineScore;
  const hDelta = rozet(k.headlineDelta);
  const yalnizA = k.providers.filter((p) => p.before !== null && p.after === null).map(motorAdi);
  const yalnizB = k.providers.filter((p) => p.before === null && p.after !== null).map(motorAdi);
  const skorAltYazi = !temel
    ? `/ 100 · ${ortakMotor} motor ort.`
    : ortakMotor === 0
      ? '/ 100 · iki testte de ölçülen motor yok; fark hesaplanmadı'
      : kumeAyni
        ? `/ 100 · ${ortakMotor} motor ort.`
        : `/ 100 · iki testte de ölçülen ${ortakMotor} motorun ortalaması`;
  const tumMotorlarNotu = temel && !kumeAyni
    ? `Tüm ölçülen motorlarla: A ${k.a.headlineScore ?? '—'} (${temel.aProviders} motor) · B ${k.b.headlineScore ?? '—'} (${temel.bProviders} motor).`
    : '';
  const kapsamNotu = yalnizA.length + yalnizB.length > 0
    ? `${[
      yalnizA.length ? `${yalnizA.join(', ')} yalnız A'da` : '',
      yalnizB.length ? `${yalnizB.join(', ')} yalnız B'de` : '',
    ].filter(Boolean).join(', ')} ölçüldü; farklar yalnız iki testte de ölçülen motorlardan hesaplandı. `
    : '';
  const tetikA = tetikEtiketi(k.a.trigger);
  const tetikB = tetikEtiketi(k.b.trigger);

  // 01 — motor bazli. Iki testte de olculmeyen motor (orn. tanimsiz Llama)
  // bilgi tasimaz: "— → —" satiri basilmaz.
  const motorSatirlari = k.providers
    .filter((p) => p.before !== null || p.after !== null)
    .sort((a, b) => (b.after ?? -1) - (a.after ?? -1))
    .map((p) => {
      const renk = MOTOR_RENK[p.provider] ?? R.soluk;
      const ad = motorAdi(p);
      const b = rozet(p.delta);
      return `<div style="display:grid;grid-template-columns:118px 1fr 92px 58px;gap:14px;align-items:center;padding:9px 2px;border-bottom:1px solid ${R.zemin};break-inside:avoid;">
  <div style="display:flex;align-items:center;gap:8px;"><span style="width:9px;height:9px;border-radius:50%;background:${renk};flex-shrink:0;"></span><span style="font-size:12.5px;font-weight:600;">${e(ad)}</span></div>
  <div style="display:grid;gap:3px;">
    <div style="height:6px;background:${R.zemin};border-radius:3px;overflow:hidden;"><div style="height:100%;width:${Math.max(0, Math.min(100, p.before ?? 0))}%;background:${R.cubuk};border-radius:3px;"></div></div>
    <div style="height:6px;background:${R.zemin};border-radius:3px;overflow:hidden;"><div style="height:100%;width:${Math.max(0, Math.min(100, p.after ?? 0))}%;background:${renk};border-radius:3px;"></div></div>
  </div>
  <div style="font-size:12px;text-align:right;font-variant-numeric:tabular-nums;"><span style="color:${R.soluk};">${p.before ?? '—'}</span> <span style="color:${R.cubuk};">→</span> <span style="font-weight:700;">${p.after ?? '—'}</span></div>
  <div style="text-align:right;"><span style="display:inline-block;font-size:10.5px;font-weight:700;padding:3px 8px;border-radius:20px;background:${b.bg};color:${b.fg};font-variant-numeric:tabular-nums;">${b.metin}</span></div>
</div>`;
    })
    .join('');

  // 03 — yukselen / dusen
  const kutu = (baslik: string, renk: string, liste: typeof k.providers) => `<div style="border:1px solid ${R.cizgi};border-radius:12px;padding:14px 16px;">
  <div style="font-size:10px;font-weight:800;letter-spacing:0.1em;color:${renk};margin-bottom:10px;">${e(baslik)}</div>
  <div style="display:grid;gap:8px;">${liste.length === 0
    ? `<div style="font-size:11px;color:${R.soluk};">Bu turda yok.</div>`
    : liste.map((p) => `<div style="display:flex;align-items:center;gap:8px;font-size:12px;"><span style="width:8px;height:8px;border-radius:50%;background:${MOTOR_RENK[p.provider] ?? R.soluk};"></span><span style="font-weight:600;">${e(motorAdi(p))}</span><span style="color:${R.soluk};font-size:11px;">${p.before ?? '—'} → ${p.after ?? '—'}</span><span style="margin-left:auto;font-weight:800;color:${renk};">${(p.delta ?? 0) > 0 ? '+' : '−'}${Math.abs(p.delta ?? 0)}</span></div>`).join('')}</div>
</div>`;
  const yukselen = k.providers.filter((p) => (p.delta ?? 0) > 0).sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0));
  const dusen = k.providers.filter((p) => (p.delta ?? 0) < 0).sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0));

  // 04 — anilma / atif
  // Sayaclar iki testte de olculen ayni soru×motor ciftlerinden (citation-run-compare
  // anilmaSayaci); yontem degistiyse fark yontemden olabilir — rozet '—'.
  const sayacKarti = (baslik: string, alt: string, once: number, sonra: number) => {
    const b = rozet(yontemDegisti ? null : sonra - once);
    return `<div style="border:1px solid ${R.cizgi};border-radius:12px;padding:14px 16px;">
  <div style="font-size:11px;font-weight:700;">${e(baslik)}</div>
  <div style="font-size:10px;color:${R.soluk};margin-top:1px;">${e(alt)}</div>
  <div style="font-size:22px;font-weight:800;margin-top:8px;font-variant-numeric:tabular-nums;"><span style="color:${R.soluk};">${once}</span> <span style="color:${R.cubuk};font-size:15px;">→</span> ${sonra} <span style="font-size:11px;font-weight:800;color:${b.fg};">${b.metin}</span></div>
</div>`;
  };

  // 02 — trend. Seri, raporu cagiran uctan (audit.controller citationRunsRapor)
  // SON 30 GUNUN gunluk mansetidir; A ile B arasina kirpilmaz. Eski baslik
  // "İKİ TARİH ARASI TREND · günlük otomatik koşumlar" diyordu: gunluk otomatik
  // olcum uretimde kapali (AI_CITATION_DAILY_CRON=false, apps/worker/src/index.ts),
  // noktalar yalniz olcum yapilan gunlerdir.
  const trend = trendSvg(g.trend ?? []);

  // 05 — aksiyonlar
  const aks = aksiyonlar(k);
  const aksiyonHtml = aks
    .map((a, i) => `<div style="display:grid;grid-template-columns:26px 1fr auto;gap:12px;align-items:start;border:1px solid ${R.cizgi};border-radius:12px;padding:13px 16px;break-inside:avoid;">
  <span style="width:24px;height:24px;border-radius:7px;background:${R.koyu};color:#fff;font-size:11px;font-weight:800;display:grid;place-items:center;">${i + 1}</span>
  <div><div style="font-size:12.5px;font-weight:700;">${e(a.baslik)}</div><div style="font-size:11px;color:${R.gri};margin-top:3px;line-height:1.5;">${e(a.metin)}</div></div>
  <span style="font-size:9px;font-weight:800;letter-spacing:0.08em;color:${a.oncelik === 'YÜKSEK' ? R.eksiFg : R.gri};background:${a.oncelik === 'YÜKSEK' ? R.eksiBg : R.zemin};border-radius:20px;padding:4px 9px;">${a.oncelik}</span>
</div>`)
    .join('');

  // 06 — soru bazli
  // Bir kosumda OLCULMEYEN soru (o turda yoktu ya da tum cevaplar HATA) 0
  // puanla gelir (citation-run-compare.ts QueryRollup); "0" yazmak "hic
  // anilmadi" gibi okunur. Olculmeyen taraf '—', fark rozeti de '—': kiyas yok.
  // Alan eski cagiranda yoksa (undefined) olculmus sayilir. Soru iki testte
  // ortak bir motorda olculmediyse ya da yontem degistiyse (comparable=false)
  // fark rozeti de '—': "0" degisim yok gibi okunurdu.
  const soruSatirlari = k.queries
    .map((q) => {
      const onceOlculdu = q.beforeMeasured !== false;
      const sonraOlculdu = q.afterMeasured !== false;
      const kiyaslanir = onceOlculdu && sonraOlculdu && q.comparable !== false && !yontemDegisti;
      const b = rozet(kiyaslanir ? q.delta : null);
      return `<tr style="break-inside:avoid;">
  <td style="padding:8px 2px;border-bottom:1px solid ${R.zemin};">${e(q.query)}</td>
  <td style="padding:8px 6px;border-bottom:1px solid ${R.zemin};text-align:right;color:${R.soluk};font-variant-numeric:tabular-nums;">${onceOlculdu ? q.before : '—'}</td>
  <td style="padding:8px 6px;border-bottom:1px solid ${R.zemin};text-align:right;font-weight:700;font-variant-numeric:tabular-nums;">${sonraOlculdu ? q.after : '—'}</td>
  <td style="padding:8px 6px;border-bottom:1px solid ${R.zemin};text-align:right;"><span style="font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:20px;background:${b.bg};color:${b.fg};">${b.metin}</span></td>
  <td style="padding:8px 2px;border-bottom:1px solid ${R.zemin};color:${R.gri};font-size:10.5px;">${q.providers.length ? e(q.providers.join(', ')) : '<span style="color:#CBD5E1;">—</span>'}</td>
</tr>`;
    })
    .join('');

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${e(g.brand)} — GEO Karşılaştırma Raporu</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box}
  body{margin:0;padding:24px;background:#F8FAFC;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${R.metin};}
  .sayfa{max-width:820px;margin:0 auto;background:#fff;padding:32px 34px 28px;border-radius:14px;box-shadow:0 1px 3px rgba(15,23,42,.08);}
  a{color:${R.marka};text-decoration:none}
  table{width:100%;border-collapse:collapse;font-size:11.5px}
  th{padding:8px 2px;font-size:9.5px;font-weight:700;letter-spacing:0.06em;border-bottom:1px solid ${R.cizgi};color:${R.gri};text-align:left}
  @page{size:A4;margin:12mm}
  @media print{body{background:#fff;padding:0}.sayfa{box-shadow:none;border-radius:0;max-width:none;padding:0}}
</style>
</head>
<body>
<div class="sayfa">

<div style="background:${R.koyu};border-radius:16px;padding:26px 28px 24px;color:#fff;break-inside:avoid;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;">
    <div style="display:flex;align-items:center;gap:10px;">
      <span style="font-size:19px;font-weight:800;letter-spacing:-0.02em;">Ranks<span style="color:${R.marka};">↗Up</span></span>
      <span style="font-size:8.5px;font-weight:700;letter-spacing:0.14em;color:${R.gri};border:1px solid #1E293B;border-radius:4px;padding:3px 7px;">GEO RAPOR</span>
    </div>
    <div style="text-align:right;font-size:10px;color:${R.soluk};line-height:1.5;">Rapor No: ${e(raporNo)}<br>${e(bugun)}</div>
  </div>
  <h1 style="margin:22px 0 6px;font-size:27px;font-weight:800;letter-spacing:-0.02em;line-height:1.15;">GEO Karşılaştırma Raporu</h1>
  <div style="font-size:12.5px;color:${R.soluk};margin-bottom:18px;">AI motorlarında görünürlük analizi · <a href="https://${e(g.host)}" style="color:#E2E8F0;font-weight:600;">${e(g.host)}</a></div>
  <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
    <div style="background:#151B26;border-radius:10px;padding:9px 13px;font-size:11px;color:${R.soluk};">A · ${e(saat(k.a.runAt))}${tetikA ? ` · ${e(tetikA)}` : ''}</div>
    <span style="color:${R.gri};">→</span>
    <div style="background:#151B26;border-radius:10px;padding:9px 13px;font-size:11px;color:#E2E8F0;">B · ${e(saat(k.b.runAt))}${tetikB ? ` · ${e(tetikB)}` : ''}</div>
    <div style="margin-left:auto;font-size:10.5px;color:${R.gri};">${k.daysBetween} gün ara · ${ortakMotor} motor · ${olcum} ölçüm</div>
  </div>
  <div style="display:flex;align-items:flex-end;gap:26px;margin-top:20px;padding-top:18px;border-top:1px solid #1E293B;">
    <div>
      <div style="font-size:10px;color:${R.gri};letter-spacing:0.06em;">AI GÖRÜNÜRLÜK SKORU</div>
      <div style="font-size:40px;font-weight:800;line-height:1.05;font-variant-numeric:tabular-nums;">
        <span style="color:${R.soluk};font-size:24px;">${onceSkor ?? '—'}</span>
        <span style="color:${R.gri};font-size:20px;">→</span> ${sonraSkor ?? '—'}
        <span style="font-size:15px;font-weight:800;color:${k.headlineDelta !== null && k.headlineDelta > 0 ? '#34D399' : k.headlineDelta !== null && k.headlineDelta < 0 ? '#F87171' : R.gri};">${hDelta.metin}</span>
      </div>
      <div style="font-size:10px;color:${R.gri};margin-top:4px;">${e(skorAltYazi)}</div>
      ${tumMotorlarNotu ? `<div style="font-size:9.5px;color:${R.gri};margin-top:2px;">${e(tumMotorlarNotu)}</div>` : ''}
    </div>
    <div style="display:flex;gap:22px;padding-bottom:4px;">
      <div><div style="font-size:19px;font-weight:800;color:#34D399;font-variant-numeric:tabular-nums;">${yontemDegisti ? '—' : k.gained}</div><div style="font-size:9.5px;color:${R.gri};">soru kazanıldı</div></div>
      <div><div style="font-size:19px;font-weight:800;color:#F87171;font-variant-numeric:tabular-nums;">${yontemDegisti ? '—' : k.lost}</div><div style="font-size:9.5px;color:${R.gri};">kaybedildi</div></div>
      <div><div style="font-size:19px;font-weight:800;color:#E2E8F0;font-variant-numeric:tabular-nums;">${aktifMotor}</div><div style="font-size:9.5px;color:${R.gri};">skor &gt; 0 motor</div></div>
    </div>
  </div>
  ${(k.added ?? 0) + (k.removed ?? 0) > 0 || yontemDegisti || kapsamNotu ? `<div style="margin-top:12px;font-size:10px;color:${R.gri};line-height:1.5;">
    ${e(kapsamNotu)}
    ${(k.added ?? 0) + (k.removed ?? 0) > 0 ? `${k.added ?? 0} soru × motor ölçümü yalnız B'de, ${k.removed ?? 0} tanesi yalnız A'da var — bunlar kazanç/kayıp sayılmadı. ` : ''}
    ${yontemDegisti ? e(yontemNotu(k.matchVersions)) : ''}
  </div>` : ''}
</div>

<div style="margin-top:26px;break-inside:avoid;">
  ${bolumBasligi('01', 'MOTOR BAZLI KARŞILAŞTIRMA', '0–100 görünürlük skoru · A gri, B renkli')}
  ${motorSatirlari}
</div>

${trend ? `<div style="margin-top:26px;break-inside:avoid;">
  ${bolumBasligi('02', 'SON 30 GÜN TRENDİ', 'Genel skor · ölçüm yapılan günler')}
  ${trend}
</div>` : ''}

<div style="margin-top:26px;break-inside:avoid;">
  ${bolumBasligi('03', 'EN ÇOK YÜKSELEN & DÜŞEN')}
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
    ${kutu('▲ YÜKSELENLER', R.artiFg, yukselen)}
    ${kutu('▼ DÜŞENLER', R.eksiFg, dusen)}
  </div>
</div>

<div style="margin-top:26px;break-inside:avoid;">
  ${bolumBasligi('04', 'ANILMA & ATIF DEĞİŞİMİ', `iki testte de ölçülen ${olcum} soru × motor`)}
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;">
    ${sayacKarti('Anılma', 'cevapta adın geçiyor', k.mentions.before.mentioned, k.mentions.after.mentioned)}
    ${sayacKarti('Atıf', 'kaynak olarak gösteriliyorsun', k.mentions.before.cited, k.mentions.after.cited)}
    ${sayacKarti('Ölçülen', 'markasız soru × motor', k.mentions.before.measured, k.mentions.after.measured)}
  </div>
</div>

${aks.length ? `<div style="margin-top:26px;break-inside:avoid;">
  ${bolumBasligi('05', 'AKSİYON ÖNERİLERİ')}
  <div style="display:grid;gap:10px;">${aksiyonHtml}</div>
</div>` : ''}

<div style="margin-top:26px;">
  ${bolumBasligi('06', 'SORU BAZLI DETAY', 'test edilen sorular · 0–100 skor')}
  <table>
    <thead><tr>
      <th>SORU / PROMPT</th>
      <th style="text-align:right;width:44px;">A</th>
      <th style="text-align:right;width:44px;">B</th>
      <th style="text-align:right;width:52px;">Δ</th>
      <th style="width:170px;">ANAN MOTORLAR (B)</th>
    </tr></thead>
    <tbody>${soruSatirlari}</tbody>
  </table>
</div>

<div style="margin-top:22px;padding-top:14px;border-top:1px solid ${R.cizgi};font-size:10px;color:${R.gri};line-height:1.6;">
  Ölçümler sağlayıcıların API yüzeyinde, her motora <strong>aynı soru seti</strong> sorularak yapılır. Sorular <strong>markasızdır</strong>: hiçbirinde marka adı geçmez — marka adı geçen soruda anılmak görünürlük değil tanınırlıktır, o satırlar skora girmez.
  Soru skoru: atıf 2, anılma 1 puan üzerinden, o soruyu iki testte de ölçen motor sayısına oranlanır; yalnız bir testte ölçülebilen motor (hata, kota, bütçe) farklara katılmaz. AI cevapları koşumdan koşuma oynaktır; tek karşılaştırma <strong>anlık görüntüdür</strong>, kesin hüküm için aynı soruların en az iki farklı günde sorulması gerekir.
</div>

<div style="margin-top:14px;display:flex;justify-content:space-between;align-items:center;font-size:8.5px;color:${R.soluk};padding-top:8px;border-top:1px solid ${R.cizgi};">
  <span style="font-weight:600;">RanksUp · GEO Karşılaştırma Raporu</span>
  <span>${e(g.host)} · Oluşturma: ${e(bugun)}</span>
</div>

</div>
</body>
</html>`;
}
