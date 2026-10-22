'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Check, Copy, Link2, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { api } from '@/lib/api';
import {
  PAYLASIM_GUNLERI, VARSAYILAN_PAYLASIM_GUNU, kalanGun, paylasimAdresi, trTarih, type PaylasimOzeti,
} from '@/lib/musteri-raporu';

/**
 * "Bağlantı paylaş" — raporun o anki halini dondurup herkese acik baglanti
 * uretir; etkin baglantilari listeler ve geri alir.
 *
 * Musteri baglantida PAYLASIM ANINDAKI raporu gorur: sonradan yapilan tarama
 * baglantiyi degistirmez (yeni durum icin yeni baglanti). Bu, ekranda acikca
 * yaziyor ki sahip "neden eski sayi" diye sasirmasin.
 */
export function RaporPaylasim({ siteId }: { siteId: string }) {
  const confirm = useConfirm();
  const [liste, setListe] = useState<PaylasimOzeti[] | null>(null);
  const [gun, setGun] = useState<number>(VARSAYILAN_PAYLASIM_GUNU);
  const [olusturuluyor, setOlusturuluyor] = useState(false);
  const [kopyalanan, setKopyalanan] = useState<string | null>(null);
  const [origin, setOrigin] = useState('');

  const yenile = useCallback(async () => {
    try {
      setListe(await api.listClientReportShares(siteId));
    } catch {
      setListe([]);
    }
  }, [siteId]);

  useEffect(() => {
    setOrigin(window.location.origin);
    yenile();
  }, [yenile]);

  const kopyala = async (p: PaylasimOzeti) => {
    const adres = paylasimAdresi(origin, p);
    try {
      await navigator.clipboard.writeText(adres);
      setKopyalanan(p.token);
      toast.success('Bağlantı kopyalandı');
      setTimeout(() => setKopyalanan((t) => (t === p.token ? null : t)), 2000);
    } catch {
      toast.message('Bağlantıyı elle kopyala', { description: adres });
    }
  };

  const olustur = async () => {
    setOlusturuluyor(true);
    try {
      const p = await api.createClientReportShare(siteId, gun);
      await yenile();
      await kopyala(p);
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Bağlantı oluşturulamadı');
    } finally {
      setOlusturuluyor(false);
    }
  };

  const kaldir = async (p: PaylasimOzeti) => {
    const ok = await confirm({
      title: 'Bağlantı kaldırılsın mı?',
      description: 'Bu bağlantıyı açan herkes artık raporu göremez. Geri alınamaz; gerekirse yeni bağlantı oluşturabilirsin.',
      confirmLabel: 'Bağlantıyı kaldır',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.revokeClientReportShare(siteId, p.token);
      toast.success('Bağlantı kaldırıldı');
      await yenile();
    } catch (err) {
      toast.error((err as Error)?.message ?? 'Bağlantı kaldırılamadı');
    }
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-xl">
          <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
            <Link2 className="h-4 w-4 text-brand" aria-hidden /> Bağlantı paylaş
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Raporun şu anki hâli dondurulur; müşterin giriş yapmadan görür. Sonraki taramalar paylaşılan bağlantıyı değiştirmez.
            Bağlantı arama motorlarına kapalıdır ve istediğin an kaldırılabilir.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="paylasim-sure">Geçerlilik süresi</label>
          <select
            id="paylasim-sure"
            value={gun}
            onChange={(e) => setGun(Number(e.target.value))}
            className="h-9 rounded-lg border border-border bg-background px-2 text-sm"
          >
            {PAYLASIM_GUNLERI.map((g) => <option key={g} value={g}>{g} gün geçerli</option>)}
          </select>
          <Button size="sm" onClick={olustur} disabled={olusturuluyor}>
            {olusturuluyor ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}
            Bağlantı oluştur
          </Button>
        </div>
      </div>

      {liste && liste.length > 0 && (
        <ul className="mt-3 divide-y divide-border rounded-md border border-border">
          {liste.map((p) => {
            const kalan = kalanGun(p.sonGecerlilik, Date.now());
            return (
              <li key={p.token} className="flex flex-wrap items-center justify-between gap-2 p-2.5">
                <div className="min-w-0">
                  <p className="truncate font-mono text-label">{paylasimAdresi(origin, p)}</p>
                  <p className="text-label text-muted-foreground">
                    {trTarih(p.olusturuldu)} tarihinde oluşturuldu · {kalan} gün kaldı ({trTarih(p.sonGecerlilik)})
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button size="sm" variant="outline" className="h-8" onClick={() => kopyala(p)}>
                    {kopyalanan === p.token ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                    Kopyala
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8 text-danger" onClick={() => kaldir(p)} aria-label="Bağlantıyı kaldır">
                    <Trash2 className="h-3.5 w-3.5" aria-hidden /> Kaldır
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
