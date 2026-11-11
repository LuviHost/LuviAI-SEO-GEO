import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-brand text-black',
        secondary: 'bg-muted text-foreground/80',
        // Durum tonlari token'dan (globals.css --success/--warning/--danger/--info)
        success: 'bg-success/10 text-success',
        warning: 'bg-warning/10 text-warning',
        destructive: 'bg-danger/10 text-danger',
        danger: 'bg-danger/10 text-danger',
        info: 'bg-info/10 text-info',
        brand: 'bg-brand/10 text-brand-700 dark:text-brand-300',
        outline: 'border border-border text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

// span: rozet satir ici bir ogedir. <div> iken <p> icinde kullanildiginda
// (or. ASA otopilot basligi) gecersiz HTML → React hidrasyon hatasi veriyordu.
function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
