import { cn } from '@/lib/utils';
import { VITRIN_WRAP } from '@/lib/vitrin';

/**
 * Vitrin alt sayfalarinin ortak yapi taslari (SSS ve Hakkimizda ile ayni duzen).
 * Hook kullanmazlar: hem sunucu hem istemci sayfalardan cagrilir; metinler
 * hazir dizge / dugum olarak gelir (dil secimi cagiran sayfada cozulur).
 */

/** Kucuk mono bolum etiketi, onunde turuncu kare. Buyuk harf YOK (bkz. globals.css .v-rail). */
export function VitrinRail({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn('v-rail flex items-center gap-2.5', className)}>
      <span className="h-1.5 w-1.5 shrink-0 bg-brand-vivid" aria-hidden />
      {children}
    </p>
  );
}

/**
 * Sayfa basi: etiket + iki tonlu H1 (a parlak, b sonuk) + giris metni.
 *  - `before`: etiketin ustune gelen oge (ornegin Breadcrumbs)
 *  - `children`: girisin altina gelen ogeler (tarih satiri, dugmeler, atlama baglantilari)
 * H1'in kelimeleri sayfanin onceki basligiyla AYNI kalir; yalniz iki satira bolunur.
 */
export function VitrinHero({ rail, a, b, lead, before, children, className }: {
  rail: React.ReactNode;
  a: React.ReactNode;
  b?: React.ReactNode;
  lead?: React.ReactNode;
  before?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className}>
      <div className={cn(VITRIN_WRAP, 'pb-16 lg:pb-20', before ? 'pt-6 lg:pt-10' : 'pt-14 lg:pt-24')}>
        {before}
        <VitrinRail className={cn('mb-10 sm:mb-14', before && 'mt-8 lg:mt-12')}>{rail}</VitrinRail>
        <h1 className="text-vitrin-1">
          <span className="block">{a}</span>
          {b && <>{' '}<span className="block text-dim">{b}</span></>}
        </h1>
        {lead && <div className="mt-8 max-w-2xl text-base leading-[1.75] text-muted-foreground">{lead}</div>}
        {children}
      </div>
    </section>
  );
}

/** Tam genislikte bolum: ustte ince cizgi, icerik vitrin genisliginde */
export function VitrinBand({ id, children, className }: { id?: string; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className="scroll-mt-16 border-t border-border">
      <div className={cn(VITRIN_WRAP, 'py-14 lg:py-20', className)}>{children}</div>
    </section>
  );
}

/** Bolum: solda yapiskan baslik (+ istege bagli not), sagda icerik */
export function VitrinSection({ id, title, note, children }: {
  id?: string;
  title: React.ReactNode;
  note?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <VitrinBand id={id} className="grid gap-8 lg:grid-cols-12 lg:gap-10">
      <div className="lg:col-span-4">
        <div className="lg:sticky lg:top-24">
          <h2 className="text-vitrin-3">{title}</h2>
          {note && <div className="v-rail mt-2">{note}</div>}
        </div>
      </div>
      <div className="min-w-0 lg:col-span-8">{children}</div>
    </VitrinBand>
  );
}

/** Metin ici baglanti: alt cizgili, uzerine gelince turuncu */
export const VITRIN_LINK =
  'border-b border-white/30 pb-0.5 text-foreground transition-colors duration-200 hover:border-brand-vivid hover:text-brand-vivid';

/** Bitisik hucreli izgara (kartlar arasi bosluk yerine tek ince cizgi): kap + hucre siniflari */
export const VITRIN_GRID = 'grid border-l border-t border-border';
export const VITRIN_CELL = 'border-b border-r border-border p-6 sm:p-7';
