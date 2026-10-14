import { AlertTriangle, CheckCircle2, Info, OctagonAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

type Tone = 'success' | 'warning' | 'danger' | 'info';

const TONE: Record<Tone, { box: string; icon: React.ComponentType<{ className?: string }>; iconCls: string }> = {
  success: { box: 'border-success/25 bg-success/5', icon: CheckCircle2, iconCls: 'text-success' },
  warning: { box: 'border-warning/30 bg-warning/5', icon: AlertTriangle, iconCls: 'text-warning' },
  danger: { box: 'border-danger/30 bg-danger/5', icon: OctagonAlert, iconCls: 'text-danger' },
  info: { box: 'border-info/25 bg-info/5', icon: Info, iconCls: 'text-info' },
};

/**
 * Durum şeridi — QA kararı, eksik bağlantı, takılı sayfa uyarısı gibi.
 * Emoji (⛔ ⚠️ ✅) ve ekran ekran değişen kenarlık renkleri yerine.
 */
export function StatusBanner({
  tone,
  title,
  children,
  action,
  className,
}: {
  tone: Tone;
  title: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const t = TONE[tone];
  const Icon = t.icon;
  return (
    <div
      role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}
      className={cn('flex flex-wrap items-start gap-3 rounded-lg border p-4', t.box, className)}
    >
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', t.iconCls)} aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{title}</p>
        {children && <div className="mt-1 text-sm text-muted-foreground">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
