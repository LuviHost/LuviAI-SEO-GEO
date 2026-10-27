'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, PenLine, RefreshCw, Send, Sparkles, Star } from 'lucide-react';
import { api, type GbpYorum, type GbpYorumListesi } from '@/lib/api';
import { gbpHataMetni, yorumlariSirala } from '@/lib/google-isletme';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBanner } from '@/components/ui/status-banner';
import { Textarea } from '@/components/ui/textarea';
import { useConfirm } from '@/components/ui/confirm-dialog';

const tarihMetni = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
};

function Yildizlar({ n }: { n: GbpYorum['yildiz'] }) {
  if (!n) return <span className="text-label text-muted-foreground">Puansız</span>;
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${n} yıldız`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`h-3.5 w-3.5 ${i <= n ? 'fill-current text-warning' : 'text-muted-foreground/40'}`} aria-hidden />
      ))}
    </span>
  );
}

/** Tek yorum — taslak AI ile hazirlanir, sahip duzenler ve onaylayarak gonderir (otomatik gonderim yok) */
function YorumSatiri({ siteId, yorum, onYanitlandi }: {
  siteId: string;
  yorum: GbpYorum;
  onYanitlandi: (metin: string) => void;
}) {
  const confirm = useConfirm();
  const [acik, setAcik] = useState(false);
  const [metin, setMetin] = useState('');
  const [taslakYukleniyor, setTaslakYukleniyor] = useState(false);
  const [gonderiliyor, setGonderiliyor] = useState(false);

  async function taslak() {
    setAcik(true);
    setTaslakYukleniyor(true);
    try {
      const r = await api.gbpYanitTaslagi(siteId, yorum.reviewId);
      setMetin(r.taslak);
    } catch (err) {
      toast.error(gbpHataMetni(err, 'panel'));
    } finally {
      setTaslakYukleniyor(false);
    }
  }

  async function gonder() {
    const temiz = metin.trim();
    if (temiz.length < 2) return;
    const ok = await confirm({
      title: 'Yanıt Google’da yayınlansın mı?',
      description: 'Yanıt herkese açık olarak yorumun altında görünür. Kişisel bilgi, telefon ya da indirim teklifi içermediğinden emin olun.',
      confirmLabel: 'Yanıtı gönder',
    });
    if (!ok) return;
    setGonderiliyor(true);
    try {
      await api.gbpYanitGonder(siteId, yorum.reviewId, temiz);
      toast.success('Yanıt gönderildi');
      onYanitlandi(temiz);
      setAcik(false);
    } catch (err) {
      toast.error(gbpHataMetni(err, 'panel'));
    } finally {
      setGonderiliyor(false);
    }
  }

  return (
    <li className="space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{yorum.yazar || 'Google kullanıcısı'}</span>
        <Yildizlar n={yorum.yildiz} />
        {tarihMetni(yorum.tarih) && <span className="text-label text-muted-foreground">{tarihMetni(yorum.tarih)}</span>}
        {!yorum.yanit && <Badge variant="warning">Yanıtsız</Badge>}
      </div>
      <p className="whitespace-pre-line text-sm">{yorum.metin || <span className="text-muted-foreground">(Metinsiz yorum)</span>}</p>

      {yorum.yanit ? (
        <div className="rounded-md border-l-2 border-brand/50 bg-muted/40 px-3 py-2">
          <p className="text-label font-medium text-muted-foreground">
            Yanıtınız{tarihMetni(yorum.yanitTarih) ? ` · ${tarihMetni(yorum.yanitTarih)}` : ''}
          </p>
          <p className="whitespace-pre-line text-sm">{yorum.yanit}</p>
        </div>
      ) : !acik ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={taslak} disabled={taslakYukleniyor}>
            <Sparkles className="h-3 w-3" /> Taslak oluştur
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAcik(true)}>
            <PenLine className="h-3 w-3" /> Kendim yazacağım
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {taslakYukleniyor ? (
            <Skeleton className="h-20 w-full" />
          ) : (
            <Textarea
              value={metin}
              onChange={(e) => setMetin(e.target.value)}
              maxLength={4000}
              rows={4}
              placeholder="Yanıtınızı yazın"
              aria-label="Yorum yanıtı"
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={gonder} disabled={gonderiliyor || taslakYukleniyor || metin.trim().length < 2}>
              {gonderiliyor ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
              Yanıtı gönder
            </Button>
            <Button size="sm" variant="outline" onClick={taslak} disabled={taslakYukleniyor || gonderiliyor}>
              <RefreshCw className="h-3 w-3" /> Yeni taslak
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAcik(false)} disabled={gonderiliyor}>Vazgeç</Button>
            <span className="text-label text-muted-foreground">Taslak otomatik gönderilmez; okuyup düzenleyin.</span>
          </div>
        </div>
      )}
    </li>
  );
}

export function YorumlarSekmesi({ siteId }: { siteId: string }) {
  const [liste, setListe] = useState<GbpYorumListesi | null>(null);
  const [yukleniyor, setYukleniyor] = useState(true);
  const [dahaYukleniyor, setDahaYukleniyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const yukle = useCallback(async () => {
    setYukleniyor(true);
    setHata(null);
    try {
      setListe(await api.getGbpYorumlar(siteId));
    } catch (err) {
      setHata(gbpHataMetni(err, 'panel'));
    } finally {
      setYukleniyor(false);
    }
  }, [siteId]);

  useEffect(() => { void yukle(); }, [yukle]);

  async function dahaFazla() {
    if (!liste?.sonraki) return;
    setDahaYukleniyor(true);
    try {
      const r = await api.getGbpYorumlar(siteId, liste.sonraki);
      setListe({ ...r, yorumlar: [...liste.yorumlar, ...r.yorumlar], yanitsiz: liste.yanitsiz + r.yanitsiz });
    } catch (err) {
      toast.error(gbpHataMetni(err, 'panel'));
    } finally {
      setDahaYukleniyor(false);
    }
  }

  const yanitlandi = (reviewId: string, metin: string) => setListe((l) => l && ({
    ...l,
    yanitsiz: Math.max(0, l.yanitsiz - 1),
    yorumlar: l.yorumlar.map((y) => (y.reviewId === reviewId ? { ...y, yanit: metin, yanitTarih: new Date().toISOString() } : y)),
  }));

  return (
    <div className="space-y-3">
      <StatusBanner tone="info" title="Yorum isteme kuralı">
        Yorum bağlantınızı ya da QR kodunuzu hizmet verdiğiniz herkese aynı şekilde gönderin. Yalnız memnun müşterilerden
        yorum istemek, indirim ya da hediye karşılığı yorum istemek Google kurallarına aykırıdır ve yorumların silinmesine yol açabilir.
      </StatusBanner>

      {yukleniyor ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : hata ? (
        <StatusBanner tone="warning" title="Yorumlar alınamadı" action={<Button size="sm" variant="outline" onClick={yukle}>Tekrar dene</Button>}>
          {hata}
        </StatusBanner>
      ) : liste && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            {liste.ortalama !== null && <span><span className="font-semibold">{liste.ortalama.toFixed(1)}</span> / 5 ortalama</span>}
            {liste.toplam !== null && <span>{liste.toplam} yorum</span>}
            <span className={liste.yanitsiz ? 'text-warning' : 'text-muted-foreground'}>{liste.yanitsiz} yanıtsız (yüklenenler içinde)</span>
            <Button size="sm" variant="ghost" onClick={yukle}><RefreshCw className="h-3 w-3" /> Yenile</Button>
          </div>
          {liste.yorumlar.length === 0 ? (
            <p className="text-sm text-muted-foreground">Henüz yorum yok.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {yorumlariSirala(liste.yorumlar).map((y) => (
                <YorumSatiri key={y.reviewId} siteId={siteId} yorum={y} onYanitlandi={(m) => yanitlandi(y.reviewId, m)} />
              ))}
            </ul>
          )}
          {liste.sonraki && (
            <Button size="sm" variant="outline" onClick={dahaFazla} disabled={dahaYukleniyor}>
              {dahaYukleniyor && <Loader2 className="h-3 w-3 animate-spin" />}
              Daha fazla yorum yükle
            </Button>
          )}
        </>
      )}
    </div>
  );
}
