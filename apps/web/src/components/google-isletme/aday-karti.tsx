import { ExternalLink, Globe, MapPin, Star } from 'lucide-react';
import type { GbpAday } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Google Haritalar arama adayi — panel profil secimi ve ucretsiz karne ayni karti kullanir.
 * Ayni adli subeler (kampusler) yalniz yaziyla ayirt edilemiyordu: foto, puan, kategori, web sitesi ve
 * "Haritada gor" baglantisi dogru profili secmeyi kolaylastirir. Foto yazari varsa gosterilir (Google kosulu).
 * Eylem dugmesi `aksiyon` ile verilir; kart buton degil (icindeki baglantilar gecerli HTML kalsin).
 */

export function Yildizlar({ puan, className }: { puan: number; className?: string }) {
  const dolu = Math.round(puan);
  return (
    <span className={cn('inline-flex', className)} aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cn('h-3.5 w-3.5', i <= dolu ? 'fill-warning text-warning' : 'text-muted-foreground/40')} />
      ))}
    </span>
  );
}

export function AdayKarti({ aday: a, aksiyon }: { aday: GbpAday; aksiyon: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-3 p-3 sm:grid-cols-[auto_1fr_auto] sm:items-center">
      <div className="shrink-0">
        {a.foto ? (
          // Google fotografi (googleusercontent, anahtarsiz); next/image optimize etmesin — kosul geregi degistirilmeden gosterilir
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={a.foto.url}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-20 w-20 rounded-lg border object-cover"
          />
        ) : (
          <div className="flex h-20 w-20 items-center justify-center rounded-lg border bg-muted/40">
            <MapPin className="h-6 w-6 text-muted-foreground" aria-hidden />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium leading-tight">{a.ad}</p>
          {a.siteEslesme && <Badge variant="success">Sitenizle eşleşiyor</Badge>}
          {a.kapali && <Badge variant="danger">Kalıcı olarak kapalı</Badge>}
        </div>

        <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
          {a.puan != null ? (
            <>
              <span className="font-medium text-foreground">{a.puan.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</span>
              <Yildizlar puan={a.puan} />
              <span>({(a.yorumSayisi ?? 0).toLocaleString('tr-TR')})</span>
              <span className="sr-only">{`5 üzerinden ${a.puan}, ${a.yorumSayisi ?? 0} yorum`}</span>
            </>
          ) : (
            <span>Henüz yorum yok</span>
          )}
          {a.kategori && <><span aria-hidden>·</span><span>{a.kategori}</span></>}
        </p>

        <p className="flex items-start gap-1 text-label text-muted-foreground">
          <MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> {a.adres}
        </p>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-label text-muted-foreground">
          {a.web && (
            <span className={cn('inline-flex items-center gap-1', a.siteEslesme && 'font-medium text-success')}>
              <Globe className="h-3 w-3" aria-hidden /> {a.web}
            </span>
          )}
          {a.mapsUri && (
            <a
              href={a.mapsUri}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-brand hover:underline"
            >
              Haritada gör <ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          )}
          {a.foto?.yazar && (
            <span>
              Foto:{' '}
              {a.foto.yazar.uri ? (
                <a href={a.foto.yazar.uri} target="_blank" rel="noopener noreferrer" className="hover:underline">{a.foto.yazar.ad}</a>
              ) : a.foto.yazar.ad}
            </span>
          )}
        </div>
      </div>

      <div className="col-span-2 flex justify-end sm:col-span-1">{aksiyon}</div>
    </div>
  );
}
