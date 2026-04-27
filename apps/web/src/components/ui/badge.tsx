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
        success: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200',
        warning: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-200',
        destructive: 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200',
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
