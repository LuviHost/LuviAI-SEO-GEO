'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { api, type PublicSeoAnalysis, type PublicSeoFinding } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AiVisibilityChecker } from '@/components/landing/ai-visibility-checker';

/**
 * Ucretsiz SEO analizi formu ve sonucu (ranksup.ai/seo-analizi). Analiz worker'da kosar
 * (api audit/public-seo-analysis.service.ts); istemci 3 sn'de bir durumu sorar, en fazla 4 dk.
 * Dil: arayuz useT ile TR/EN (25.11.2026). Bulgu metinleri API'den Turkce gelir; EN'de bu belirtilir.
 * Sonucun altinda ayni alan adiyla ucretsiz AI gorunurluk testi (sahip 25.11.2026: "SEO'su taranan
 * kisi yapay zekadaki gorunurlugunu de olcmek ister mi?").
 */
const SORGU_MS = 3000;
const EN_FAZLA_MS = 4 * 60 * 1000;

const COPY = {
  tr: {
    onem: { critical: 'Kritik', warning: 'Uyarı', info: 'Bilgi' } as Record<PublicSeoFinding['severity'], string>,
    okunamadi: (d: string) => `${d} okunamadı`,
    botIpucu: ['Sitenizde bot koruması varsa ', 'RanksUpBot’a nasıl izin verileceğini', ' anlattık.'],
    sahaGecti: (site: boolean) => `Gerçek ziyaretçiler Core Web Vitals eşiklerini geçiyor (son 28 gün${site ? ', sitenin geneli' : ''}).`,
    sahaGecmedi: (site: boolean) => `Gerçek ziyaretçilerde Core Web Vitals eşiklerinden en az biri aşılıyor (son 28 gün${site ? ', sitenin geneli' : ''}).`,
    labYalniz: 'Bu site için gerçek ziyaretçi verisi yok; aşağıdaki değerler tek bir mobil laboratuvar ölçümü.',
    puan: 'Teknik SEO puanı', taranan: (n: number) => `${n} sayfa tarandı`,
    hiz: 'Mobil hız', hizPuani: 'Hız puanı', lcp: 'En büyük içerik (LCP)', inp: 'Etkileşim (INP)', cls: 'Kayma (CLS)',
    hizYok: 'Hız ölçülemedi (PageSpeed yanıt vermedi). Analizin geri kalanı geçerli.',
    sorunYok: 'Kritik ya da uyarı düzeyinde sorun bulunmadı. Aşağıdaki kontrollerde yalnız bilgi notları olabilir.',
    once: 'Önce bunlara bakın', kontrolKontrol: 'Kontrol kontrol sonuç', puansiz: 'puansız', bulguDili: null as string | null,
    aiBaslik: (d: string) => `${d} yapay zekâ cevaplarında görünüyor mu?`,
    aiMetin: 'Teknik SEO’nun sağlam olması ChatGPT, Gemini ve Perplexity’nin cevaplarında kaynak gösterilmenin ön şartı, ama yeterli değil. Aynı site için alıcı sorularını bu asistanlara soralım; markanın anılıp anılmadığını görün. Ücretsiz.',
    sinirBaslik: 'Bu analiz sitenin en fazla 10 sayfasına bakar.',
    sinirMetin: 'RanksUp’ta sitenin tamamını tarar, sorunları sayfa sayfa listeler ve markanın ChatGPT, Gemini, Claude, Perplexity ile Google AI Modu’nda anılıp anılmadığını ölçeriz.',
    dene: 'Ücretsiz dene',
    epostaBaslik: (d: string, bitti: boolean) => `${d} ${bitti ? 'analizi hazır.' : 'analiz ediliyor.'} Sonucu görmek için e-posta adresini yaz.`,
    epostaEtiket: 'E-posta adresi', epostaYer: 'ad@sirket.com', goster: 'Sonucu göster',
    izin: 'RanksUp’tan SEO ve yapay zekâ görünürlüğü ipuçları ile kampanya e-postaları almak istiyorum (isteğe bağlı).',
    epostaNot: 'Adresin bu analizin sonucunu göstermek ve analizle ilgili sana ulaşmak için kullanılır.',
    kvkk: 'KVKK aydınlatma metni', epostaHata: 'E-posta kaydedilemedi. Tekrar dene.',
    uzun: 'Analiz beklenenden uzun sürdü. Birkaç dakika sonra aynı adresi tekrar yazın; sonuç hazırsa hemen görünür.',
    baslatilamadi: 'Analiz başlatılamadı. Lütfen tekrar deneyin.',
    alanEtiket: 'Web sitenizin adresi', analizEt: 'Analiz et',
    ipucu: 'Ücretsiz, üyelik gerekmez; sonucu görmek için e-posta adresi istenir. Sitenin en fazla 10 sayfası taranır; aynı ağdan günde en fazla 3 farklı site analiz edilebilir.',
    taraniyor: (d: string) => `${d} taranıyor ve mobil hızı ölçülüyor. Bu genelde 30–90 saniye sürer.`,
    ondalik: ',', sn: 'sn',
  },
  en: {
    onem: { critical: 'Critical', warning: 'Warning', info: 'Info' } as Record<PublicSeoFinding['severity'], string>,
    okunamadi: (d: string) => `${d} could not be read`,
    botIpucu: ['If your site uses bot protection, see ', 'how to allow RanksUpBot', '.'],
    sahaGecti: (site: boolean) => `Real visitors pass the Core Web Vitals thresholds (last 28 days${site ? ', whole site' : ''}).`,
    sahaGecmedi: (site: boolean) => `Real visitors exceed at least one Core Web Vitals threshold (last 28 days${site ? ', whole site' : ''}).`,
    labYalniz: 'No real-visitor data for this site; the values below come from a single mobile lab test.',
    puan: 'Technical SEO score', taranan: (n: number) => `${n} pages crawled`,
    hiz: 'Mobile speed', hizPuani: 'Speed score', lcp: 'Largest content (LCP)', inp: 'Interaction (INP)', cls: 'Layout shift (CLS)',
    hizYok: 'Speed could not be measured (PageSpeed did not respond). The rest of the analysis is valid.',
    sorunYok: 'No critical or warning-level issues found. The checks below may still contain notes.',
    once: 'Fix these first', kontrolKontrol: 'Check by check', puansiz: 'not scored',
    bulguDili: 'Findings are written in Turkish.' as string | null,
    aiBaslik: (d: string) => `Does ${d} appear in AI answers?`,
    aiMetin: 'Solid technical SEO is a precondition for being cited by ChatGPT, Gemini and Perplexity, but not enough on its own. We ask these assistants buyer questions for the same site and show whether your brand is mentioned. Free.',
    sinirBaslik: 'This analysis looks at up to 10 pages of the site.',
    sinirMetin: 'In RanksUp we crawl the whole site, list the issues page by page and measure whether your brand is mentioned in ChatGPT, Gemini, Claude, Perplexity and Google AI Mode.',
    dene: 'Try it free',
    epostaBaslik: (d: string, bitti: boolean) => `${bitti ? `The analysis of ${d} is ready.` : `Analysing ${d}.`} Enter your e-mail to see the result.`,
    epostaEtiket: 'E-mail address', epostaYer: 'you@company.com', goster: 'Show result',
    izin: 'I’d like to receive SEO and AI visibility tips and campaign e-mails from RanksUp (optional).',
    epostaNot: 'Your address is used to show the result of this analysis and to contact you about it.',
    kvkk: 'Privacy notice (KVKK)', epostaHata: 'Could not save the e-mail. Please try again.',
    uzun: 'The analysis is taking longer than expected. Enter the same address again in a few minutes; if it is ready it shows immediately.',
    baslatilamadi: 'Could not start the analysis. Please try again.',
    alanEtiket: 'Your website address', analizEt: 'Analyse',
    ipucu: 'Free, no sign-up; an e-mail address is required to see the result. Up to 10 pages are crawled; up to 3 different sites per network per day.',
    taraniyor: (d: string) => `Crawling ${d} and measuring mobile speed. This usually takes 30–90 seconds.`,
    ondalik: '.', sn: 's',
  },
};
type Copy = (typeof COPY)['tr'];

/** Kontrol adlari API'den Turkce gelir (api public-seo-analysis.ts KONTROL_ADI_TR); EN arayuzde kimlige gore */
const KONTROL_ADI_EN: Record<string, string> = {
  sitemap_xml: 'Sitemap (sitemap.xml)', robots_txt: 'robots.txt', llms_txt: 'llms.txt (info)',
  schema_markup: 'Structured data (schema.org)', meta_title: 'Page titles', meta_description: 'Meta descriptions',
  open_graph: 'Open Graph (social sharing)', twitter_card: 'X (Twitter) card', canonical: 'Canonical tag',
  https: 'HTTPS and redirects', h1_uniqueness: 'H1 headings', image_alt: 'Images (alt text, size, loading)',
  internal_linking: 'Internal links', hreflang: 'Language tags (hreflang)', google_ai_eligibility: 'Google and AI Overviews eligibility',
};

function sn(ms: number | null | undefined, c: Copy): string | null {
  return typeof ms === 'number' ? `${(ms / 1000).toFixed(1).replace('.', c.ondalik)} ${c.sn}` : null;
}

function puanRengi(p: number): string {
  return p >= 80 ? 'text-success' : p >= 50 ? 'text-warning' : 'text-destructive';
}

function Sonuc({ a, c }: { a: NonNullable<PublicSeoAnalysis['result']>; c: Copy }) {
  if (a.engel) {
    return (
      <div className="mt-8 rounded-lg border border-border bg-card p-6">
        <p className="text-base font-medium text-foreground">{c.okunamadi(a.domain)}</p>
        <p className="mt-2 text-sm leading-[1.8] text-muted-foreground">
          {a.engel} {c.botIpucu[0]}<Link href="/bot" className="underline underline-offset-4">{c.botIpucu[1]}</Link>{c.botIpucu[2]}
        </p>
      </div>
    );
  }
  const h = a.hiz;
  const site = h?.saha?.kapsam === 'site';
  const hizSatiri = h?.saha && h.sahaGecti !== null
    ? (h.sahaGecti ? c.sahaGecti(site) : c.sahaGecmedi(site))
    : h?.puan !== null && h?.puan !== undefined ? c.labYalniz : null;
  return (
    <div className="mt-8 space-y-8">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs text-muted-foreground">{c.puan}</p>
          <p className={`mt-1 text-4xl font-semibold tabular-nums ${puanRengi(a.puan)}`}>{a.puan}<span className="text-base text-muted-foreground">/100</span></p>
          <p className="mt-1 text-xs text-muted-foreground">{c.taranan(a.taranan)}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5 sm:col-span-2">
          <p className="text-xs text-muted-foreground">{c.hiz}</p>
          {h ? (
            <>
              <p className="mt-1 text-sm text-foreground">{hizSatiri}</p>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                {h.puan !== null && (<><dt className="text-muted-foreground">{c.hizPuani}</dt><dd className="tabular-nums">{h.puan}/100</dd></>)}
                {sn(h.saha?.lcpMs ?? h.lcpMs, c) && (<><dt className="text-muted-foreground">{c.lcp}</dt><dd className="tabular-nums">{sn(h.saha?.lcpMs ?? h.lcpMs, c)}</dd></>)}
                {h.saha?.inpMs !== null && h.saha?.inpMs !== undefined && (<><dt className="text-muted-foreground">{c.inp}</dt><dd className="tabular-nums">{h.saha.inpMs} ms</dd></>)}
                {(h.saha?.cls ?? h.cls) !== null && (<><dt className="text-muted-foreground">{c.cls}</dt><dd className="tabular-nums">{String(h.saha?.cls ?? h.cls).replace('.', c.ondalik)}</dd></>)}
              </dl>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">{c.hizYok}</p>
          )}
        </div>
      </div>

      {c.bulguDili && <p className="text-xs text-muted-foreground">{c.bulguDili}</p>}
      {a.oncelikli.length === 0 && (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-foreground">{c.sorunYok}</p>
      )}
      {a.oncelikli.length > 0 && (
        <div>
          <h3 className="text-base font-medium text-foreground">{c.once}</h3>
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
            {a.oncelikli.map((b, i) => (
              <li key={i} className="flex gap-3 p-4 text-sm">
                <span className={`shrink-0 font-medium ${b.severity === 'critical' ? 'text-destructive' : 'text-warning'}`}>{c.onem[b.severity]}</span>
                <span className="min-w-0"><span className="text-muted-foreground">{b.kontrol}: </span>{b.metin}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Yapay zeka gorunurlugu: ayni alan adiyla ucretsiz test (sahip 25.11.2026) */}
      <div className="rounded-lg border border-brand-vivid/40 bg-card p-6">
        <p className="text-base font-medium text-foreground">{c.aiBaslik(a.domain)}</p>
        <p id="seo-ai-ipucu" className="mt-2 max-w-2xl text-sm leading-[1.8] text-muted-foreground">{c.aiMetin}</p>
        <div className="mt-5 max-w-[34rem]">
          <AiVisibilityChecker mode="seo-analizi" hintId="seo-ai-ipucu" initialDomain={a.domain} />
        </div>
      </div>

      <div>
        <h3 className="text-base font-medium text-foreground">{c.kontrolKontrol}</h3>
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
          {a.kontroller.map((k) => (
            <li key={k.id} className="p-4 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-foreground">{(c.bulguDili && KONTROL_ADI_EN[k.id]) || k.ad}</span>
                <span className={`tabular-nums ${k.puan === null ? 'text-muted-foreground' : puanRengi(k.puan)}`}>{k.puan === null ? c.puansiz : `${k.puan}/100`}</span>
              </div>
              {k.bulgular.length > 0 && (
                <ul className="mt-2 space-y-1 text-muted-foreground">
                  {k.bulgular.slice(0, 4).map((b, i) => <li key={i}>· {b.metin}</li>)}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg border border-border bg-card p-6">
        <p className="text-base font-medium text-foreground">{c.sinirBaslik}</p>
        <p className="mt-2 text-sm leading-[1.8] text-muted-foreground">{c.sinirMetin}</p>
        <div className="mt-4">
          <Button asChild><Link href="/signin?signup=1">{c.dene}</Link></Button>
        </div>
      </div>
    </div>
  );
}

/** Sonucu gormek icin e-posta formu (analiz surerken de doldurulabilir) */
function EpostaFormu({ analiz, onDone, c }: { analiz: PublicSeoAnalysis; onDone: (d: PublicSeoAnalysis) => void; c: Copy }) {
  const [email, setEmail] = useState('');
  const [izin, setIzin] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const gonder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || gonderiliyor) return;
    setHata(null); setGonderiliyor(true);
    try { onDone(await api.publicSeoAnalysisEmail(analiz.id, email.trim(), izin)); }
    catch (err: any) { setHata(err?.message || c.epostaHata); }
    finally { setGonderiliyor(false); }
  };
  return (
    <form onSubmit={gonder} className="mt-6 max-w-[34rem] rounded-lg border border-border bg-card p-5" aria-describedby="seo-eposta-not">
      <p className="text-base font-medium text-foreground">{c.epostaBaslik(analiz.domain, analiz.status === 'done')}</p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <label htmlFor="seo-eposta" className="sr-only">{c.epostaEtiket}</label>
        <Input id="seo-eposta" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={c.epostaYer} autoComplete="email" className="h-11 flex-1" required />
        <Button type="submit" className="h-11" disabled={gonderiliyor || !email.trim()}>
          {gonderiliyor ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {c.goster}
        </Button>
      </div>
      <label className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={izin} onChange={(e) => setIzin(e.target.checked)} className="mt-0.5" />
        <span>{c.izin}</span>
      </label>
      <p id="seo-eposta-not" className="mt-2 text-xs text-muted-foreground">
        {c.epostaNot}{' '}
        <Link href="/kvkk#ucretsiz-seo-analizi" className="underline underline-offset-4">{c.kvkk}</Link>
      </p>
      {hata && <p className="mt-2 text-sm text-destructive">{hata}</p>}
    </form>
  );
}

export function SeoAnalizAraci() {
  const { locale } = useT();
  const c = COPY[locale === 'en' ? 'en' : 'tr'];
  const [domain, setDomain] = useState('');
  const [analiz, setAnaliz] = useState<PublicSeoAnalysis | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const zamanlayici = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baslangic = useRef(0);

  useEffect(() => () => { if (zamanlayici.current) clearTimeout(zamanlayici.current); }, []);

  const sor = (id: string) => {
    zamanlayici.current = setTimeout(async () => {
      try {
        const d = await api.publicSeoAnalysisGet(id);
        setAnaliz(d);
        if ((d.status === 'queued' || d.status === 'running') && Date.now() - baslangic.current < EN_FAZLA_MS) sor(id);
        else if (d.status !== 'done' && d.status !== 'error') setHata(c.uzun);
      } catch {
        if (Date.now() - baslangic.current < EN_FAZLA_MS) sor(id);
      }
    }, SORGU_MS);
  };

  const gonder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domain.trim() || gonderiliyor) return;
    if (zamanlayici.current) clearTimeout(zamanlayici.current);
    setHata(null); setAnaliz(null); setGonderiliyor(true);
    try {
      const d = await api.publicSeoAnalysisStart(domain.trim());
      setAnaliz(d);
      baslangic.current = Date.now();
      if (d.status === 'queued' || d.status === 'running') sor(d.id);
    } catch (err: any) {
      setHata(err?.message || c.baslatilamadi);
    } finally {
      setGonderiliyor(false);
    }
  };

  const bekliyor = analiz && (analiz.status === 'queued' || analiz.status === 'running');

  return (
    <div>
      <form onSubmit={gonder} className="flex max-w-[34rem] flex-col gap-3 sm:flex-row" aria-describedby="seo-analiz-ipucu">
        <label htmlFor="seo-analiz-alan" className="sr-only">{c.alanEtiket}</label>
        <Input
          id="seo-analiz-alan"
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          placeholder="ornek.com"
          inputMode="url"
          autoComplete="url"
          className="h-11 flex-1"
          disabled={gonderiliyor || !!bekliyor}
        />
        <Button type="submit" className="h-11" disabled={gonderiliyor || !!bekliyor || !domain.trim()}>
          {gonderiliyor || bekliyor ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          {c.analizEt}
        </Button>
      </form>
      <p id="seo-analiz-ipucu" className="mt-3 text-xs text-muted-foreground">{c.ipucu}</p>

      <div aria-live="polite">
        {analiz && !analiz.emailVar && (analiz.status === 'done' || bekliyor) && (
          <EpostaFormu analiz={analiz} c={c} onDone={(d) => setAnaliz(d)} />
        )}
        {bekliyor && analiz!.emailVar && (
          <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {c.taraniyor(analiz!.domain)}
          </p>
        )}
        {hata && <p className="mt-6 text-sm text-destructive">{hata}</p>}
        {analiz?.status === 'error' && !hata && <p className="mt-6 text-sm text-destructive">{analiz.error}</p>}
        {analiz?.status === 'done' && analiz.result && <Sonuc a={analiz.result} c={c} />}
      </div>
    </div>
  );
}
