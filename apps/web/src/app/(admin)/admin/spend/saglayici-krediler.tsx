'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ExternalLink, RefreshCw, Wallet } from 'lucide-react';
import { api, type SaglayiciKrediDurumu, type SaglayiciKrediTablosu } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Saglayici kredileri (27.11.2026, sahip: "kredi durumlarını admin panelde görelim; Yükle deyince
 * ilgili linke yönlendirsin, ordan yükleyeyim"). Gemini kredisi 25.11'de bitmis, iki gun fark
 * edilmemisti. "Yükle" saglayicinin fatura sayfasini YENI SEKMEDE acar; odeme orada yapilir.
 * Bakiye yalniz DeepSeek ve DataForSEO'da sorgulanabiliyor; digerleri son cagri sonucumuzdan.
 */

const ETIKET: Record<SaglayiciKrediDurumu, { metin: string; variant: 'success' | 'warning' | 'danger' | 'secondary' }> = {
  CALISIYOR: { metin: 'Çalışıyor', variant: 'success' },
  AZALDI: { metin: 'Azaldı', variant: 'warning' },
  KREDI_BITTI: { metin: 'Kredi bitti', variant: 'danger' },
  ANAHTAR_YOK: { metin: 'Anahtar yok', variant: 'secondary' },
  BILINMIYOR: { metin: 'Henüz çağrı yok', variant: 'secondary' },
};

function zaman(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function para(tutar: number, birim: string | null): string {
  return `${tutar.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${birim ?? 'USD'}`;
}

export function SaglayiciKrediler() {
  const [veri, setVeri] = useState<SaglayiciKrediTablosu | null>(null);
  const [yukleniyor, setYukleniyor] = useState(false);

  const yukle = useCallback(async (tazele = false) => {
    setYukleniyor(true);
    try {
      setVeri(await api.getSaglayiciKredi(tazele));
    } catch (err: any) {
      toast.error(`Kredi durumu alınamadı: ${err.message}`);
    } finally {
      setYukleniyor(false);
    }
  }, []);

  useEffect(() => { void yukle(); }, [yukle]);

  const sorunlu = (veri?.satirlar ?? []).filter((s) => s.durum === 'KREDI_BITTI' || s.durum === 'AZALDI');

  return (
    <Card className={cn(sorunlu.some((s) => s.durum === 'KREDI_BITTI') && 'border-danger/40')}>
      <CardContent className="p-5 space-y-3">
        <div className="flex flex-wrap items-start gap-2">
          <Wallet className="h-4 w-4 mt-0.5 text-brand" />
          <div className="flex-1 min-w-[200px]">
            <p className="font-semibold">Sağlayıcı kredileri</p>
            <p className="text-xs text-muted-foreground">
              Ölçümlerin kullandığı sistem anahtarları. Bakiye yalnız DeepSeek ve DataForSEO&apos;da sorgulanabiliyor;
              diğerlerinde durum son çağrımızdan çıkar (kredi bitince ölçüm 402 hatası verir). &quot;Yükle&quot; sağlayıcının
              ödeme sayfasını yeni sekmede açar.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => yukle(true)} disabled={yukleniyor}>
            <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', yukleniyor && 'animate-spin')} /> Bakiyeleri yenile
          </Button>
        </div>

        {!veri && <Skeleton className="h-40" />}

        {veri && (
          <div className="divide-y rounded-md border">
            {veri.satirlar.map((s) => {
              const e = ETIKET[s.durum];
              return (
                <div key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 p-3">
                  <div className="min-w-[180px] flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{s.ad}</span>
                      <Badge variant={e.variant}>{e.metin}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">{s.kullanim}</div>
                  </div>
                  <div className="text-xs text-muted-foreground min-w-[150px]">
                    {s.bakiye
                      ? s.bakiye.hata
                        ? <>Bakiye okunamadı ({s.bakiye.hata})</>
                        : s.bakiye.tutar !== null
                          ? <>Bakiye: <b className={cn('text-foreground', s.durum !== 'CALISIYOR' && 'text-danger')}>{para(s.bakiye.tutar, s.bakiye.paraBirimi)}</b></>
                          : <>Bakiye bilinmiyor</>
                      : <>Bakiye API&apos;si yok</>}
                  </div>
                  <div className="text-xs text-muted-foreground min-w-[220px]">
                    Son başarılı çağrı: {zaman(s.sonBasari)}
                    {s.sonKrediHatasi && <> · son kredi hatası: <span className={cn(s.durum === 'KREDI_BITTI' && 'text-danger')}>{zaman(s.sonKrediHatasi)}</span></>}
                  </div>
                  <Button asChild size="sm" variant={s.durum === 'KREDI_BITTI' || s.durum === 'AZALDI' ? 'default' : 'outline'}>
                    <a href={s.yukleUrl} target="_blank" rel="noopener noreferrer">
                      Yükle <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
                    </a>
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
