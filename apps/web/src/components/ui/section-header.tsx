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
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-brand/10 text-brand" aria-hidden>
            <Icon className="h-[18px] w-[18px]" />
          </span>
        )}
        <div className="min-w-0">
          <Tag className={cn('font-semibold tracking-tight', Tag === 'h2' ? 'text-h6' : 'text-base')}>{title}</Tag>
          {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
