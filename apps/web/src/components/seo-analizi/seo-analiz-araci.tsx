'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { api, type PublicSeoAnalysis, type PublicSeoFinding } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Ucretsiz SEO analizi formu ve sonucu (ranksup.ai/seo-analizi). Analiz worker'da kosar
 * (api audit/public-seo-analysis.service.ts); istemci 3 sn'de bir durumu sorar, en fazla 4 dk.
 */
const SORGU_MS = 3000;
const EN_FAZLA_MS = 4 * 60 * 1000;

const ONEM: Record<PublicSeoFinding['severity'], string> = { critical: 'Kritik', warning: 'Uyarı', info: 'Bilgi' };

function sn(ms: number | null | undefined): string | null {
  return typeof ms === 'number' ? `${(ms / 1000).toFixed(1).replace('.', ',')} sn` : null;
}

function puanRengi(p: number): string {
  return p >= 80 ? 'text-success' : p >= 50 ? 'text-warning' : 'text-destructive';
}

function Sonuc({ a }: { a: NonNullable<PublicSeoAnalysis['result']> }) {
  if (a.engel) {
    return (
      <div className="mt-8 rounded-lg border border-border bg-card p-6">
        <p className="text-base font-medium text-foreground">{a.domain} okunamadı</p>
        <p className="mt-2 text-sm leading-[1.8] text-muted-foreground">
          {a.engel} Sitenizde bot koruması varsa <Link href="/bot" className="underline underline-offset-4">RanksUpBot’a nasıl izin verileceğini</Link> anlattık.
        </p>
      </div>
    );
  }
  const h = a.hiz;
  const hizSatiri = h?.saha && h.sahaGecti !== null
    ? (h.sahaGecti
      ? `Gerçek ziyaretçiler Core Web Vitals eşiklerini geçiyor (son 28 gün${h.saha.kapsam === 'site' ? ', sitenin geneli' : ''}).`
      : `Gerçek ziyaretçilerde Core Web Vitals eşiklerinden en az biri aşılıyor (son 28 gün${h.saha.kapsam === 'site' ? ', sitenin geneli' : ''}).`)
    : h?.puan !== null && h?.puan !== undefined
      ? 'Bu site için gerçek ziyaretçi verisi yok; aşağıdaki değerler tek bir mobil laboratuvar ölçümü.'
      : null;
  return (
    <div className="mt-8 space-y-8">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-5">
          <p className="text-xs text-muted-foreground">Teknik SEO puanı</p>
          <p className={`mt-1 text-4xl font-semibold tabular-nums ${puanRengi(a.puan)}`}>{a.puan}<span className="text-base text-muted-foreground">/100</span></p>
          <p className="mt-1 text-xs text-muted-foreground">{a.taranan} sayfa tarandı</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-5 sm:col-span-2">
          <p className="text-xs text-muted-foreground">Mobil hız</p>
          {h ? (
            <>
              <p className="mt-1 text-sm text-foreground">{hizSatiri}</p>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                {h.puan !== null && (<><dt className="text-muted-foreground">Hız puanı</dt><dd className="tabular-nums">{h.puan}/100</dd></>)}
                {sn(h.saha?.lcpMs ?? h.lcpMs) && (<><dt className="text-muted-foreground">En büyük içerik (LCP)</dt><dd className="tabular-nums">{sn(h.saha?.lcpMs ?? h.lcpMs)}</dd></>)}
                {h.saha?.inpMs !== null && h.saha?.inpMs !== undefined && (<><dt className="text-muted-foreground">Etkileşim (INP)</dt><dd className="tabular-nums">{h.saha.inpMs} ms</dd></>)}
                {(h.saha?.cls ?? h.cls) !== null && (<><dt className="text-muted-foreground">Kayma (CLS)</dt><dd className="tabular-nums">{String(h.saha?.cls ?? h.cls).replace('.', ',')}</dd></>)}
              </dl>
            </>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">Hız ölçülemedi (PageSpeed yanıt vermedi). Analizin geri kalanı geçerli.</p>
          )}
        </div>
      </div>

      {a.oncelikli.length === 0 && (
        <p className="rounded-lg border border-border bg-card p-4 text-sm text-foreground">
          Kritik ya da uyarı düzeyinde sorun bulunmadı. Aşağıdaki kontrollerde yalnız bilgi notları olabilir.
        </p>
      )}
      {a.oncelikli.length > 0 && (
        <div>
          <h3 className="text-base font-medium text-foreground">Önce bunlara bakın</h3>
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
            {a.oncelikli.map((b, i) => (
              <li key={i} className="flex gap-3 p-4 text-sm">
                <span className={`shrink-0 font-medium ${b.severity === 'critical' ? 'text-destructive' : 'text-warning'}`}>{ONEM[b.severity]}</span>
                <span className="min-w-0"><span className="text-muted-foreground">{b.kontrol}: </span>{b.metin}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="text-base font-medium text-foreground">Kontrol kontrol sonuç</h3>
        <ul className="mt-3 divide-y divide-border rounded-lg border border-border bg-card">
          {a.kontroller.map((k) => (
            <li key={k.id} className="p-4 text-sm">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-foreground">{k.ad}</span>
                <span className={`tabular-nums ${k.puan === null ? 'text-muted-foreground' : puanRengi(k.puan)}`}>{k.puan === null ? 'puansız' : `${k.puan}/100`}</span>
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
        <p className="text-base font-medium text-foreground">Bu analiz sitenin en fazla 10 sayfasına bakar.</p>
        <p className="mt-2 text-sm leading-[1.8] text-muted-foreground">
          RanksUp’ta sitenin tamamını tarar, sorunları sayfa sayfa listeler ve markanın ChatGPT, Gemini, Claude, Perplexity ile
          Google AI Modu’nda anılıp anılmadığını ölçeriz.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button asChild><Link href="/signin?signup=1">Ücretsiz dene</Link></Button>
          <Button asChild variant="outline"><Link href="/#test">Yapay zekâ görünürlüğünü test et</Link></Button>
        </div>
      </div>
    </div>
  );
}

/** Sonucu gormek icin e-posta formu (analiz surerken de doldurulabilir) */
function EpostaFormu({ analiz, onDone }: { analiz: PublicSeoAnalysis; onDone: (d: PublicSeoAnalysis) => void }) {
  const [email, setEmail] = useState('');
  const [izin, setIzin] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [gonderiliyor, setGonderiliyor] = useState(false);
  const bitti = analiz.status === 'done';
  const gonder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || gonderiliyor) return;
    setHata(null); setGonderiliyor(true);
    try { onDone(await api.publicSeoAnalysisEmail(analiz.id, email.trim(), izin)); }
    catch (err: any) { setHata(err?.message || 'E-posta kaydedilemedi. Tekrar dene.'); }
    finally { setGonderiliyor(false); }
  };
  return (
    <form onSubmit={gonder} className="mt-6 max-w-[34rem] rounded-lg border border-border bg-card p-5" aria-describedby="seo-eposta-not">
      <p className="text-base font-medium text-foreground">
        {bitti ? `${analiz.domain} analizi hazır.` : `${analiz.domain} analiz ediliyor.`} Sonucu görmek için e-posta adresini yaz.
      </p>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
        <label htmlFor="seo-eposta" className="sr-only">E-posta adresi</label>
        <Input id="seo-eposta" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ad@sirket.com" autoComplete="email" className="h-11 flex-1" required />
        <Button type="submit" className="h-11" disabled={gonderiliyor || !email.trim()}>
          {gonderiliyor ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Sonucu göster
        </Button>
      </div>
      <label className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={izin} onChange={(e) => setIzin(e.target.checked)} className="mt-0.5" />
        <span>RanksUp’tan SEO ve yapay zekâ görünürlüğü ipuçları ile kampanya e-postaları almak istiyorum (isteğe bağlı).</span>
      </label>
      <p id="seo-eposta-not" className="mt-2 text-xs text-muted-foreground">
        Adresin bu analizin sonucunu göstermek ve analizle ilgili sana ulaşmak için kullanılır.{' '}
        <Link href="/kvkk#ucretsiz-seo-analizi" className="underline underline-offset-4">KVKK aydınlatma metni</Link>
      </p>
      {hata && <p className="mt-2 text-sm text-destructive">{hata}</p>}
    </form>
  );
}

export function SeoAnalizAraci() {
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
        else if (d.status !== 'done' && d.status !== 'error') setHata('Analiz beklenenden uzun sürdü. Birkaç dakika sonra aynı adresi tekrar yazın; sonuç hazırsa hemen görünür.');
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
      setHata(err?.message || 'Analiz başlatılamadı. Lütfen tekrar deneyin.');
    } finally {
      setGonderiliyor(false);
    }
  };

  const bekliyor = analiz && (analiz.status === 'queued' || analiz.status === 'running');

  return (
    <div>
      <form onSubmit={gonder} className="flex max-w-[34rem] flex-col gap-3 sm:flex-row" aria-describedby="seo-analiz-ipucu">
        <label htmlFor="seo-analiz-alan" className="sr-only">Web sitenizin adresi</label>
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
          Analiz et
        </Button>
      </form>
      <p id="seo-analiz-ipucu" className="mt-3 text-xs text-muted-foreground">
        Ücretsiz, üyelik gerekmez; sonucu görmek için e-posta adresi istenir. Sitenin en fazla 10 sayfası taranır; aynı ağdan günde en fazla 3 farklı site analiz edilebilir.
      </p>

      <div aria-live="polite">
        {analiz && !analiz.emailVar && (analiz.status === 'done' || bekliyor) && (
          <EpostaFormu analiz={analiz} onDone={(d) => setAnaliz(d)} />
        )}
        {bekliyor && analiz!.emailVar && (
          <p className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            {analiz!.domain} taranıyor ve mobil hızı ölçülüyor. Bu genelde 30–90 saniye sürer.
          </p>
        )}
        {hata && <p className="mt-6 text-sm text-destructive">{hata}</p>}
        {analiz?.status === 'error' && !hata && <p className="mt-6 text-sm text-destructive">{analiz.error}</p>}
        {analiz?.status === 'done' && analiz.result && <Sonuc a={analiz.result} />}
      </div>
    </div>
  );
}
