'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api, type KarneBaslatYaniti, type KarnelerYaniti, type KarneSatiri } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/ui/page-header';
import { StatusBanner } from '@/components/ui/status-banner';
import { cn } from '@/lib/utils';
import { Eye, Link2, Loader2, Play, RefreshCw, RotateCcw, X } from 'lucide-react';

/**
 * Ucretsiz AI gorunurluk karnesi — uretim ve takip (API: /api/karneler, KarneService).
 *
 * Akis: firma cevap verdi → alan adi + kuruma ozel sorular → olcum arka planda (6 asistan, 4-6 dk) →
 * paylasim linki listeye duser → link musteriye gider → "Goruntulenme" sayaci acip acmadigini gosterir.
 * Terminalden (CLI --kaydet) uretilen karneler de burada listelenir.
 *
 * NEDEN onizleme sayfa icinde ve sandbox'li iframe'de: paylasim linkini kendimiz acinca sayac artiyor ve
 * "musteri bakti" sinyali bozuluyordu; ayrica rapor AI cevaplarindan alinti tasir, admin oturumuyla ayni
 * kokene yazilmamali.
 */

const SEKTOR_ETIKET: Record<string, string> = {
  finans: 'Finans',
  'eticaret-perakende-teknoloji': 'E-ticaret / perakende / teknoloji',
  'turizm-havayolu-telekom-otomotiv': 'Turizm / havayolu / telekom / otomotiv',
};

const ORNEK_SORULAR = [
  "Türkiye'de dijital pazarlama ajansı önerir misin?",
  'Otomotiv markaları için kampanya yapan ajans önerir misin?',
].join('\n');

const tarih = (s: string | null | undefined) =>
  s
    ? new Date(s).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' })
    : '—';
const saat = (s: string) => new Date(s).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });

/** Sunucudaki ozelSorulariOku ile ayni sayim (bos ve # satiri atlanir); tekrarlar sunucuda elenir */
const soruSay = (metin: string) =>
  metin
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#')).length;

/** "Bugun olculdu" uyarisi gelirse onay sorup tekrar dener */
async function baslatOnayla(f: (onay: boolean) => Promise<KarneBaslatYaniti>): Promise<boolean> {
  let r = await f(false);
  if (!r.started && r.ayniGun) {
    if (!window.confirm(r.reason)) return false;
    r = await f(true);
  }
  if (!r.started) {
    toast.error(r.reason);
    return false;
  }
  toast.success(`${r.is.brand} için ölçüm başladı (${r.is.soruSayisi} soru). 4-6 dk sürer, bitince listeye düşer.`);
  return true;
}

export default function KarnelerPage() {
  const [d, setD] = useState<KarnelerYaniti | null>(null);
  const [mesgul, setMesgul] = useState(false);
  const [q, setQ] = useState('');
  const [onizleme, setOnizleme] = useState<{ brand: string; html: string } | null>(null);

  // Form
  const [brand, setBrand] = useState('');
  const [host, setHost] = useState('');
  const [kaynak, setKaynak] = useState<'ozel' | 'banka'>('ozel');
  const [sorular, setSorular] = useState('');
  const [etiket, setEtiket] = useState('');
  const [sektor, setSektor] = useState('finans');
  const [altsektor, setAltsektor] = useState('');
  const [rakipler, setRakipler] = useState('');

  const yukle = useCallback(async () => {
    try {
      setD(await api.getKarneler());
    } catch (e: any) {
      toast.error(e?.message ?? 'Karneler alınamadı');
    }
  }, []);

  useEffect(() => {
    void yukle();
  }, [yukle]);

  // E-posta kampanyasindan gelince firma ve alan adi dolu gelir (?firma=&host=)
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const f = p.get('firma');
    const h = p.get('host');
    if (f) setBrand(f);
    if (h) setHost(h);
  }, []);

  const calisiyor = !!d?.isler.some((i) => i.durum === 'CALISIYOR');
  // Olcum surerken liste kendini yeniler (biten karne duser)
  useEffect(() => {
    if (!calisiyor) return;
    const t = setInterval(() => void yukle(), 15_000);
    return () => clearInterval(t);
  }, [calisiyor, yukle]);

  useEffect(() => {
    if (!onizleme) return;
    const kapat = (e: KeyboardEvent) => e.key === 'Escape' && setOnizleme(null);
    window.addEventListener('keydown', kapat);
    return () => window.removeEventListener('keydown', kapat);
  }, [onizleme]);

  const liste = useMemo(() => {
    const t = q.trim().toLocaleLowerCase('tr-TR');
    const k = d?.karneler ?? [];
    return t ? k.filter((r) => `${r.brand} ${r.host} ${r.sektor}`.toLocaleLowerCase('tr-TR').includes(t)) : k;
  }, [d, q]);

  if (!d) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-72" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  const n = kaynak === 'ozel' ? soruSay(sorular) : 0;
  const sinirAsildi = n > d.secenekler.soruSiniri;
  const tavan = kaynak === 'ozel' ? n * d.tahmin.soruBasiTavanUsd : 10 * d.tahmin.soruBasiTavanUsd;
  const altlar = d.secenekler.altSektorler[sektor] ?? [];
  const calisanlar = d.isler.filter((i) => i.durum === 'CALISIYOR');
  const hatalar = d.isler.filter((i) => i.durum === 'HATA');

  const baslat = async () => {
    if (kaynak === 'ozel' && n === 0) return toast.error('En az bir soru yazın');
    const tahminMetni = kaynak === 'ozel'
      ? `${d.tahmin.saglayici} asistan × ${n} soru = ${d.tahmin.saglayici * n} çağrı, tavan ≈ $${tavan.toFixed(2)}`
      : `${d.tahmin.saglayici} asistan × en fazla 10 banka sorusu, tavan ≈ $${tavan.toFixed(2)}`;
    if (!window.confirm(`${brand.trim()} (${host.trim()}) ölçülsün mü?\n${tahminMetni}. Gerçek tutar genelde daha düşük.`)) return;
    setMesgul(true);
    try {
      const ok = await baslatOnayla((ayniGunOnay) =>
        api.karneBaslat({
          brand,
          host,
          sektor: kaynak === 'ozel' ? etiket : sektor,
          altsektor: kaynak === 'banka' ? altsektor || null : null,
          sorular: kaynak === 'ozel' ? sorular : undefined,
          rakipler: rakipler.trim() || undefined,
          ayniGunOnay,
        }),
      );
      if (ok) await yukle();
    } catch (e: any) {
      toast.error(e?.message ?? 'Ölçüm başlatılamadı');
    } finally {
      setMesgul(false);
    }
  };

  const tekrar = async (k: KarneSatiri) => {
    if (!window.confirm(`${k.brand} aynı ${k.soruSayisi} soruyla yeniden ölçülsün mü? Tavan ≈ $${(k.soruSayisi * d.tahmin.soruBasiTavanUsd).toFixed(2)}.`)) return;
    setMesgul(true);
    try {
      if (await baslatOnayla((onay) => api.karneTekrar(k.id, onay))) await yukle();
    } catch (e: any) {
      toast.error(e?.message ?? 'Ölçüm başlatılamadı');
    } finally {
      setMesgul(false);
    }
  };

  const onizle = async (k: KarneSatiri) => {
    try {
      setOnizleme(await api.karneOnizleme(k.id));
    } catch (e: any) {
      toast.error(e?.message ?? 'Karne açılamadı');
    }
  };

  const kopyala = async (k: KarneSatiri) => {
    try {
      await navigator.clipboard.writeText(k.url);
      toast.success('Link kopyalandı. Kendiniz açarsanız görüntülenme sayacı artar; kontrol için Önizle kullanın.');
    } catch {
      window.prompt('Linki kopyalayın:', k.url);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Karneler"
        description="Ücretsiz AI görünürlük karnesi: firmaya marka adı geçmeyen sorular, altı AI asistanı. Panelden ve terminalden üretilenlerin hepsi burada."
        actions={
          <Button variant="outline" size="sm" onClick={() => void yukle()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />Yenile
          </Button>
        }
      />

      {calisanlar.length > 0 && (
        <StatusBanner tone="info" title={`Ölçüm sürüyor (${calisanlar.length})`}>
          <ul className="space-y-0.5">
            {calisanlar.map((i) => (
              <li key={i.id} className="flex items-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {i.brand} ({i.host}) · {i.soruSayisi} soru · {saat(i.basladi)}&apos;de başladı
              </li>
            ))}
          </ul>
          <div className="mt-1 text-xs">4-6 dk sürer; sayfa 15 sn&apos;de bir kendini yeniler. Sunucu bu arada yeniden başlarsa ölçüm yarıda kalır.</div>
        </StatusBanner>
      )}
      {hatalar.length > 0 && (
        <StatusBanner tone="danger" title="Tamamlanamayan ölçüm">
          <ul className="space-y-0.5">
            {hatalar.map((i) => (
              <li key={i.id}>
                {i.brand} ({i.host}) · {saat(i.basladi)}: {i.hata}
              </li>
            ))}
          </ul>
        </StatusBanner>
      )}

      <Card>
        <CardContent className="space-y-4 p-5">
          <div>
            <div className="font-semibold">Yeni ölçüm</div>
            <div className="text-sm text-muted-foreground">
              Cevap veren firmaya karne çıkarmak için. Sorular firmanın müşterisinin AI&apos;a gerçekten soracağı gibi yazılmalı ve firma adı geçmemeli.
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium">Firma adı</span>
              <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Acme Ajans" />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium">Alan adı</span>
              <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="acmeajans.com" />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={kaynak === 'ozel' ? 'default' : 'outline'} onClick={() => setKaynak('ozel')}>
              Kendi sorularım (önerilen)
            </Button>
            <Button size="sm" variant={kaynak === 'banka' ? 'default' : 'outline'} onClick={() => setKaynak('banka')}>
              Hazır soru bankası
            </Button>
          </div>

          {kaynak === 'ozel' ? (
            <div className="space-y-3">
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Sorular (her satıra bir soru, en fazla {d.secenekler.soruSiniri})</span>
                <Textarea rows={8} value={sorular} onChange={(e) => setSorular(e.target.value)} placeholder={ORNEK_SORULAR} />
                <span className={cn('text-xs', sinirAsildi ? 'text-danger' : 'text-muted-foreground')}>
                  {n} soru{sinirAsildi ? ` · sınır ${d.secenekler.soruSiniri}` : ''} · # ile başlayan satır not sayılır. 8 soru genelde yeterli.
                </span>
              </label>
              <label className="block space-y-1 text-sm">
                <span className="font-medium">Karnede görünecek sektör</span>
                <Input value={etiket} onChange={(e) => setEtiket(e.target.value)} placeholder={`Dijital pazarlama ajansı (boşsa "${d.secenekler.ozelEtiket}")`} />
              </label>
            </div>
          ) : (
            <div className="space-y-3">
              <StatusBanner tone="warning" title="Banka yalnız üç tüketici sektörünü kapsar">
                Ajans, BT entegratörü ya da başka bir B2B firmaya banka soruları sorulursa karne alan dışı sorularla yanlış bir &ldquo;görünmüyorsunuz&rdquo; sonucu verir. Bu firmalar için kendi sorularınızı yazın.
              </StatusBanner>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Sektör</span>
                  <select
                    value={sektor}
                    onChange={(e) => { setSektor(e.target.value); setAltsektor(''); }}
                    className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  >
                    {d.secenekler.sektorler.map((s) => <option key={s} value={s}>{SEKTOR_ETIKET[s] ?? s}</option>)}
                  </select>
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium">Alt sektör</span>
                  <select value={altsektor} onChange={(e) => setAltsektor(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                    <option value="">Genel sorular</option>
                    {altlar.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </label>
              </div>
            </div>
          )}

          <label className="block space-y-1 text-sm">
            <span className="font-medium">Bilinen rakipler (isteğe bağlı)</span>
            <Input value={rakipler} onChange={(e) => setRakipler(e.target.value)} placeholder="rakip1.com, rakip2.com.tr" />
            <span className="text-xs text-muted-foreground">Cevaplarda ayrıca aranır ve karnede ★ ile işaretlenir.</span>
          </label>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <div className="text-sm text-muted-foreground">
              {kaynak === 'ozel'
                ? `${d.tahmin.saglayici} asistan × ${n} soru · tavan ≈ $${tavan.toFixed(2)}`
                : `${d.tahmin.saglayici} asistan × banka soruları · tavan ≈ $${tavan.toFixed(2)}`}
              {' · '}tek ölçüm anlık görüntüdür; başka bir gün &ldquo;Tekrar ölç&rdquo;.
            </div>
            <Button
              disabled={mesgul || !brand.trim() || !host.trim() || sinirAsildi || (kaynak === 'ozel' && n === 0)}
              onClick={() => void baslat()}
            >
              {mesgul ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}
              Ölçümü başlat
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">Karneler ({d.karneler.length})</div>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Firma ya da alan adı ara" className="h-8 w-full sm:w-64" />
          </div>
          {liste.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{d.karneler.length ? 'Aramaya uyan karne yok.' : 'Henüz karne yok.'}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Firma</th>
                    <th className="py-2 pr-3 font-medium">Ölçüm</th>
                    <th className="py-2 pr-3 font-medium">Sonuç</th>
                    <th className="py-2 pr-3 font-medium">Görüntülenme</th>
                    <th className="py-2 pr-3 font-medium">Maliyet</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {liste.map((k) => (
                    <tr key={k.id} className="border-b align-top last:border-0">
                      <td className="py-2 pr-3">
                        <div className="font-medium">{k.brand}</div>
                        <div className="text-xs text-muted-foreground">
                          {k.host} · {SEKTOR_ETIKET[k.sektor] ?? k.sektor}
                          {k.altsektor ? ` / ${k.altsektor}` : ''}
                        </div>
                        {k.linkedinFirma && <div className="text-xs text-muted-foreground">LinkedIn adayı</div>}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        <div>{tarih(k.createdAt)}</div>
                        {k.olcumNo > 1 && <Badge className="mt-1 bg-info/15 font-normal text-info">{k.olcumNo}. ölçüm</Badge>}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        <div className={cn('font-medium', k.anilanCevap > 0 ? 'text-foreground' : 'text-muted-foreground')}>
                          {k.anilanCevap}/{k.olculenCevap} cevapta anıldı
                        </div>
                        <div className="text-muted-foreground">
                          {k.anilanSaglayici}/{k.olculenSaglayici} asistan · {k.soruSayisi} soru
                          {k.hataliCevap > 0 ? ` · ${k.hataliCevap} ölçülemedi` : ''}
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {k.gorulmeSayisi > 0 ? (
                          <span className="text-success">
                            {k.gorulmeSayisi} kez · son {tarih(k.sonGorulmeAt)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Açılmadı</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs">${k.maliyetUsd.toFixed(2)}</td>
                      <td className="py-2 text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="sm" title="Panelde aç — görüntülenme sayılmaz" onClick={() => void onizle(k)}>
                            <Eye className="mr-1 h-3.5 w-3.5" />Önizle
                          </Button>
                          <Button variant="ghost" size="sm" title="Müşteriye gönderilecek linki kopyala" onClick={() => void kopyala(k)}>
                            <Link2 className="mr-1 h-3.5 w-3.5" />Link
                          </Button>
                          <Button variant="ghost" size="sm" disabled={mesgul} title="Aynı sorularla başka bir gün yeniden ölç" onClick={() => void tekrar(k)}>
                            <RotateCcw className="mr-1 h-3.5 w-3.5" />Tekrar ölç
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {onizleme && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background" role="dialog" aria-modal="true" aria-label={`${onizleme.brand} karnesi`}>
          <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
            <div className="text-sm">
              <span className="font-medium">{onizleme.brand}</span>
              <span className="text-muted-foreground"> · önizleme, görüntülenme sayılmaz</span>
            </div>
            <Button size="sm" variant="outline" onClick={() => setOnizleme(null)}>
              <X className="mr-1 h-3.5 w-3.5" />Kapat
            </Button>
          </div>
          {/* sandbox: betik yok, admin oturumuyla ayni koken yok; linkler yeni sekmede acilabilir */}
          <iframe
            title={`${onizleme.brand} karnesi`}
            srcDoc={onizleme.html}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            className="w-full flex-1 border-0 bg-background"
          />
        </div>
      )}
    </div>
  );
}
