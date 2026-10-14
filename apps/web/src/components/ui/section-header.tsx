import { cn } from '@/lib/utils';

/**
 * Sayfa içi bölüm başlığı — h2, PageHeader (h1, text-h6) ile UYUMLU boyutta.
 * Eskiden her sayfa layout'un küçük h1'inin altında daha BÜYÜK bir
 * `text-2xl font-bold` h2 açıyordu (başlık hiyerarşisi tersti) ve ikon
 * kutusunu kendi renginde kopyalıyordu.
 */
export function SectionHeader({
  icon: Icon,
  title,
  description,
  actions,
  as: Tag = 'h2',
  className,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  as?: 'h2' | 'h3';
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {Icon && (
          // Notr ikon kutusu: turuncu yalniz eylem ve vurguya kalir (her basligin turuncu olmasi vurguyu oldururdu)
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-muted/50 text-foreground/70" aria-hidden>
            <Icon className="h-[18px] w-[18px]" />
          </span>
        )}
        <div className="min-w-0">
          <Tag className={cn('font-brand font-semibold tracking-tight', Tag === 'h2' ? 'text-h6' : 'text-base')}>{title}</Tag>
          {description && <div className="mt-0.5 text-sm text-muted-foreground">{description}</div>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
