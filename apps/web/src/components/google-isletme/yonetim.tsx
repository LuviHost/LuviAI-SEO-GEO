'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { Eye, ExternalLink, Globe, Loader2, Map as MapIcon, MapPin, Navigation, Phone, Plug, RefreshCw, Send } from 'lucide-react';
import { api, type GbpDurum, type GbpGonderi, type GbpKonum, type GbpPerformans } from '@/lib/api';
import { GONDERI_MAX, GONDERI_MIN, gbpHataMetni, gonderiDurumu } from '@/lib/google-isletme';
import { finishOAuthConnect, oauthCallbackErrorText } from '@/lib/oauth-connect';
import { siteHref } from '@/lib/site-routes';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MetricCard } from '@/components/ui/metric';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBanner } from '@/components/ui/status-banner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { YorumlarSekmesi } from './yorumlar';

/**
 * Yonetim — yorum yanitlama, gonderi, performans. Google Business Profile API erisimi onaylanana kadar
 * kapali (sunucu: GBP_API_ENABLED). OAuth donusu GSC ile ayni kalip (settings-tab.tsx):
 * ?gbp=connected | ?gbp=finish&k=KEY (oturum callback'te okunamadi → panel tamamlar) | ?gbp=error&gbperror=KOD
 */
export function Yonetim({ siteId, durum, onYenile }: {
  siteId: string;
  durum: GbpDurum;
  onYenile: () => Promise<void>;
}) {
  const search = useSearchParams();
  const confirm = useConfirm();
  const [baglaniyor, setBaglaniyor] = useState(false);
  const [konumDegisiyor, setKonumDegisiyor] = useState(false);

  useEffect(() => {
    const state = search.get('gbp');
    if (!state) return;
    const temizle = () => window.history.replaceState({}, '', siteHref(siteId, 'googleIsletme'));
    if (state === 'connected') {
      toast.success('Google İşletme hesabınız bağlandı');
      temizle();
      void onYenile();
    } else if (state === 'finish') {
      const key = search.get('k') ?? '';
      temizle();
      finishOAuthConnect('gbp', key)
        .then((r) => { if (r) { toast.success('Google İşletme hesabınız bağlandı'); void onYenile(); } })
        .catch((err: any) => toast.error(err.message));
    } else if (state === 'error') {
      toast.error(oauthCallbackErrorText('gbp', search.get('gbperror')));
      temizle();
    }
    // onYenile her render'da yeni olabilir; yalniz URL degisince calissin
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, siteId]);

  if (!durum.apiAcik) {
    return (
      <StatusBanner tone="info" title="Yönetim araçları Google onayından sonra açılacak">
        Yorum yanıtlama, gönderi paylaşma ve performans raporu Google’ın API onayından sonra açılacak. Profil denetimi ve
        yerel AI soruları şimdiden kullanılabilir.
      </StatusBanner>
    );
  }

  async function bagla() {
    setBaglaniyor(true);
    try {
      const { url } = await api.getGbpAuthUrl(siteId);
      window.location.href = url;
    } catch (err) {
      toast.error(gbpHataMetni(err, 'panel'));
      setBaglaniyor(false);
    }
  }

  async function kes() {
    const ok = await confirm({
      title: 'Google İşletme bağlantısı kesilsin mi?',
      description: 'Yorum, gönderi ve performans araçları durur. Profil denetimi çalışmaya devam eder.',
      confirmLabel: 'Bağlantıyı kes',
      danger: true,
    });
    if (!ok) return;
    setBaglaniyor(true);
    try {
      await api.disconnectGbp(siteId);
      toast.success('Google İşletme bağlantısı kesildi');
      await onYenile();
    } catch (err) {
      toast.error(gbpHataMetni(err, 'panel'));
    } finally {
      setBaglaniyor(false);
    }
  }

  if (!durum.oauth.bagli) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Google İşletme Profili’nizin sahibi ya da yöneticisi olan Google hesabıyla bağlanın. Yorumları yanıtlamak,
          gönderi paylaşmak ve son 28 günün performansını görmek için gerekir. Hiçbir şey onayınız olmadan yayınlanmaz.
        </p>
        <Button onClick={bagla} disabled={baglaniyor}>
          {baglaniyor ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
          Google İşletme hesabını bağla
        </Button>
      </div>
    );
  }

  if (!durum.oauth.konum || konumDegisiyor) {
    return (
      <div className="space-y-3">
        <KonumSecici
          siteId={siteId}
          onSecildi={async () => { setKonumDegisiyor(false); await onYenile(); }}
        />
        <div className="flex gap-2">
          {konumDegisiyor && <Button size="sm" variant="outline" onClick={() => setKonumDegisiyor(false)}>Vazgeç</Button>}
          <Button size="sm" variant="ghost" onClick={kes} disabled={baglaniyor}>Bağlantıyı kes</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3">
        <p className="flex min-w-0 items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-success" aria-hidden />
          <span className="truncate"><span className="text-muted-foreground">Yönetilen konum:</span> {durum.oauth.konumAdi || durum.oauth.konum}</span>
        </p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setKonumDegisiyor(true)}>Konumu değiştir</Button>
          <Button size="sm" variant="ghost" onClick={kes} disabled={baglaniyor}>Bağlantıyı kes</Button>
        </div>
      </div>

      <Tabs defaultValue="yorumlar">
        <TabsList>
          <TabsTrigger value="yorumlar">Yorumlar</TabsTrigger>
          <TabsTrigger value="gonderiler">Gönderiler</TabsTrigger>
          <TabsTrigger value="performans">Performans</TabsTrigger>
        </TabsList>
        <TabsContent value="yorumlar" className="pt-2"><YorumlarSekmesi siteId={siteId} /></TabsContent>
        <TabsContent value="gonderiler" className="pt-2"><GonderilerSekmesi siteId={siteId} /></TabsContent>
        <TabsContent value="performans" className="pt-2"><PerformansSekmesi siteId={siteId} /></TabsContent>
      </Tabs>
    </div>
  );
}

function KonumSecici({ siteId, onSecildi }: { siteId: string; onSecildi: () => Promise<void> }) {
  const [konumlar, setKonumlar] = useState<GbpKonum[] | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [kaydedilen, setKaydedilen] = useState<string | null>(null);

  const yukle = useCallback(async () => {
    setHata(null);
    setKonumlar(null);
    try {
      setKonumlar(await api.getGbpKonumlar(siteId));
    } catch (err) {
      setHata(gbpHataMetni(err, 'panel'));
    }
  }, [siteId]);

  useEffect(() => { void yukle(); }, [yukle]);

  async function sec(k: GbpKonum) {
    setKaydedilen(k.konum);
    try {
      await api.setGbpKonum(siteId, k.hesap, k.konum);
      toast.success(`"${k.ad}" yönetilecek konum olarak seçildi`);
      await onSecildi();
    } catch (err) {
      toast.error(gbpHataMetni(err, 'panel'));
    } finally {
      setKaydedilen(null);
    }
  }

  if (hata) {
    return (
      <StatusBanner tone="warning" title="Konumlar alınamadı" action={<Button size="sm" variant="outline" onClick={yukle}>Tekrar dene</Button>}>
        {hata}
      </StatusBanner>
    );
  }
  if (!konumlar) return <Skeleton className="h-24 w-full" />;
  if (konumlar.length === 0) {
    return (
      <StatusBanner tone="warning" title="Bu Google hesabında işletme konumu yok">
        Bağladığınız hesap hiçbir İşletme Profili’nin sahibi ya da yöneticisi değil. Profilin sahibi olan hesapla yeniden bağlanın.
      </StatusBanner>
    );
  }
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">Yönetilecek konumu seçin</p>
      <ul className="divide-y rounded-lg border">
        {konumlar.map((k) => (
          <li key={`${k.hesap}/${k.konum}`} className="flex flex-wrap items-center justify-between gap-2 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{k.ad || k.konum}</p>
              <p className="text-label text-muted-foreground">{[k.adres, k.hesapAdi].filter(Boolean).join(' · ')}</p>
            </div>
            <Button size="sm" onClick={() => sec(k)} disabled={kaydedilen !== null}>
              {kaydedilen === k.konum && <Loader2 className="h-3 w-3 animate-spin" />}
              Bu konumu yönet
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GonderilerSekmesi({ siteId }: { siteId: string }) {
  const confirm = useConfirm();
  const [liste, setListe] = useState<GbpGonderi[] | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [metin, setMetin] = useState('');
  const [url, setUrl] = useState('');
  const [gonderiliyor, setGonderiliyor] = useState(false);

  const yukle = useCallback(async () => {
    setHata(null);
    try {
      setListe(await api.getGbpGonderiler(siteId));
    } catch (err) {
      setHata(gbpHataMetni(err, 'panel'));
    }
  }, [siteId]);

  useEffect(() => { void yukle(); }, [yukle]);

  const uzunluk = metin.trim().length;
  const gecerli = uzunluk >= GONDERI_MIN && uzunluk <= GONDERI_MAX;

  async function paylas() {
    if (!gecerli) return;
    const ok = await confirm({
      title: 'Gönderi Google’da paylaşılsın mı?',
      description: 'Gönderi işletme profilinizde herkese açık görünür.',
      confirmLabel: 'Paylaş',
    });
    if (!ok) return;
    setGonderiliyor(true);
    try {
      await api.gbpGonderiOlustur(siteId, { metin: metin.trim(), url: url.trim() || null });
      toast.success('Gönderi paylaşıldı; Google incelemesinden sonra yayına girer');
      setMetin('');
      setUrl('');
      void yukle();
    } catch (err) {
      toast.error(gbpHataMetni(err, 'panel'));
    } finally {
      setGonderiliyor(false);
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={(e) => { e.preventDefault(); void paylas(); }} className="space-y-2">
        <label className="block space-y-1">
          <span className="text-sm font-medium">Gönderi metni</span>
          <Textarea
            value={metin}
            onChange={(e) => setMetin(e.target.value)}
            maxLength={GONDERI_MAX}
            rows={5}
            placeholder="Yeni hizmet, kampanya ya da duyuru…"
          />
        </label>
        <div className="flex flex-wrap justify-between gap-2 text-label text-muted-foreground">
          <span>Metne telefon, e-posta, sosyal medya hesabı ya da web adresi yazmayın; Google bu gönderileri kaldırır. Bağlantıyı aşağıdaki alana ekleyin.</span>
          <span className={uzunluk > GONDERI_MAX ? 'text-danger' : ''}>{uzunluk} / {GONDERI_MAX}</span>
        </div>
        <label className="block space-y-1">
          <span className="text-sm font-medium">“Daha fazla bilgi” bağlantısı (isteğe bağlı)</span>
          <Input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
        </label>
        <Button type="submit" disabled={gonderiliyor || !gecerli}>
          {gonderiliyor ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Gönderiyi paylaş
        </Button>
        {uzunluk > 0 && uzunluk < GONDERI_MIN && (
          <p className="text-label text-muted-foreground">Gönderi en az {GONDERI_MIN} karakter olmalı.</p>
        )}
      </form>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Son gönderiler</p>
          <Button size="sm" variant="ghost" onClick={yukle}><RefreshCw className="h-3 w-3" /> Yenile</Button>
        </div>
        {hata ? (
          <StatusBanner tone="warning" title="Gönderiler alınamadı">{hata}</StatusBanner>
        ) : !liste ? (
          <Skeleton className="h-16 w-full" />
        ) : liste.length === 0 ? (
          <p className="text-sm text-muted-foreground">Henüz gönderi yok.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {liste.map((g, i) => (
              <li key={`${g.tarih ?? ''}-${i}`} className="space-y-1 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={g.durum === 'LIVE' ? 'success' : g.durum === 'REJECTED' ? 'danger' : 'secondary'}>{gonderiDurumu(g.durum)}</Badge>
                  {g.tarih && <span className="text-label text-muted-foreground">{new Date(g.tarih).toLocaleDateString('tr-TR')}</span>}
                  {g.url && (
                    <a href={g.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-label text-brand hover:underline">
                      Google’da gör <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                  )}
                </div>
                <p className="line-clamp-3 whitespace-pre-line text-sm">{g.metin}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PerformansSekmesi({ siteId }: { siteId: string }) {
  const [veri, setVeri] = useState<GbpPerformans | null>(null);
  const [hata, setHata] = useState<string | null>(null);

  useEffect(() => {
    let iptal = false;
    api.getGbpPerformans(siteId)
      .then((v) => { if (!iptal) setVeri(v); })
      .catch((err) => { if (!iptal) setHata(gbpHataMetni(err, 'panel')); });
    return () => { iptal = true; };
  }, [siteId]);

  if (hata) return <StatusBanner tone="warning" title="Performans verisi alınamadı">{hata}</StatusBanner>;
  if (!veri) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <MetricCard label="Google Arama’da görüntülenme" value={veri.aramaGorunum} icon={Eye} />
        <MetricCard label="Haritalar’da görüntülenme" value={veri.haritaGorunum} icon={MapIcon} />
        <MetricCard label="Web sitesi tıklaması" value={veri.webTiklama} icon={Globe} />
        <MetricCard label="Arama (telefon) tıklaması" value={veri.arama} icon={Phone} />
        <MetricCard label="Yol tarifi isteği" value={veri.yolTarifi} icon={Navigation} />
      </div>
      <p className="text-label text-muted-foreground">
        Son {veri.gun} gün. Google bu veriyi birkaç gün gecikmeyle verir; son 3 gün dahil değildir.
      </p>
    </div>
  );
}
