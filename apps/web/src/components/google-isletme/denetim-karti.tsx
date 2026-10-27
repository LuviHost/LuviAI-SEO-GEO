import { ExternalLink, MapPin, Star } from 'lucide-react';
import type { GbpDenetim } from '@/lib/api';
import { MADDE_DURUM, TON_METIN, maddeleriSirala, puanEtiketi } from '@/lib/google-isletme';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/**
 * Google Isletme Profili denetim sonucu — panel sayfasi ve ucretsiz karne (/google-isletme-karnesi)
 * ayni karti kullanir. Hook yok; istemci bilesenlerinin icinde render edilir.
 *
 * "Veriler: Google Haritalar" satiri Google Maps Platform kosullari geregi (Places verisi gosterilen
 * her yerde kaynak belirtilir). Sonuc saklanmaz; her denetim Google'dan canli alinir.
 */

const BADGE_VARIANT = { success: 'success', warning: 'warning', danger: 'danger', info: 'info' } as const;

export function GoogleAttribution({ className }: { className?: string }) {
  return <p className={cn('text-label text-muted-foreground', className)}>Veriler: Google Haritalar</p>;
}

export function DenetimKarti({ sonuc, not }: { sonuc: GbpDenetim; not?: React.ReactNode }) {
  const { etiket, ton } = puanEtiketi(sonuc.puan);
  const o = sonuc.ozet;
  const maddeler = maddeleriSirala(sonuc.maddeler);
  const acik = maddeler.filter((m) => m.durum === 'eksik' || m.durum === 'uyari').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 rounded-lg border bg-card p-4 sm:flex-row sm:items-center">
        <div className="flex shrink-0 items-baseline gap-1" aria-label={`Profil puanı ${sonuc.puan} / 100`}>
          <span className={cn('font-brand text-h2 font-semibold tabular-nums', TON_METIN[ton])}>{sonuc.puan}</span>
          <span className="text-sm text-muted-foreground">/ 100</span>
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className={cn('text-sm font-semibold', TON_METIN[ton])}>{etiket}</p>
          <p className="truncate font-brand text-h6 font-semibold">{o.ad || 'İşletme'}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            {o.kategori && <span>{o.kategori}</span>}
            <span className="inline-flex items-center gap-1">
              <Star className="h-3.5 w-3.5" aria-hidden />
              {o.puanOrt !== null ? `${o.puanOrt.toFixed(1)} / 5` : 'Puan yok'} · {o.yorumSayisi} yorum
            </span>
          </div>
          {o.adres && (
            <p className="flex items-start gap-1 text-label text-muted-foreground">
              <MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> {o.adres}
            </p>
          )}
        </div>
        {o.mapsUri && (
          <a
            href={o.mapsUri}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-lg border px-3 py-2 text-sm font-medium hover:bg-muted/50 sm:self-center"
          >
            Google Haritalar’da aç <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {acik ? `${acik} madde iyileştirilebilir` : 'Tüm maddeler iyi görünüyor'}
        </p>
        <GoogleAttribution />
      </div>

      <ul className="divide-y rounded-lg border">
        {maddeler.map((m) => {
          const d = MADDE_DURUM[m.durum] ?? MADDE_DURUM.bilgi;
          return (
            <li key={m.kod} className="flex gap-3 p-3">
              <Badge variant={BADGE_VARIANT[d.ton]} className="mt-0.5 h-fit shrink-0">{d.etiket}</Badge>
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium">{m.baslik}</p>
                <p className="text-sm text-muted-foreground">{m.bulgu}</p>
                {m.oneri && <p className="text-sm"><span className="font-medium">Öneri:</span> {m.oneri}</p>}
              </div>
            </li>
          );
        })}
      </ul>

      {not && <div className="text-label text-muted-foreground">{not}</div>}
    </div>
  );
}
