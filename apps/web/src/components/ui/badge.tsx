import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-brand text-white',
        secondary: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
        // Durum tonlari token'dan (globals.css --success/--warning/--danger/--info)
        success: 'bg-success/10 text-success',
        warning: 'bg-warning/10 text-warning',
        destructive: 'bg-danger/10 text-danger',
        danger: 'bg-danger/10 text-danger',
        info: 'bg-info/10 text-info',
        brand: 'bg-brand/10 text-brand-700 dark:text-brand-300',
        outline: 'border border-slate-300 text-slate-700 dark:border-slate-700 dark:text-slate-200',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
