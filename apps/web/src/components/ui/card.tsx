import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Kart — token'li yuzey: bg-card + ince cizgi, 8px yaricap (rounded-lg =
 * var(--radius)), GOLGE YOK (12.11.2026 vitrin dili: derinlik golgeyle degil
 * zemin tonu ve cizgiyle verilir).
 *
 * `density`: default p-6, dense p-4 (16px — analitik grid sozlesmesi).
 * NEDEN data-attribute + group (Context DEGIL): Card server bilesenlerinden de
 * import ediliyor (orn. admin-unlock/page.tsx). React.createContext server
 * bileseninde build'i dusurur ("Failed to collect page data" — 02.09 prod
 * deploy'unda yakalandi). data-density + group-data varyanti runtime'siz cozer.
 */

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { density?: 'default' | 'dense' }
>(({ className, density = 'default', ...props }, ref) => (
  <div
    ref={ref}
    data-density={density}
    className={cn(
      'group/card rounded-lg border border-border bg-card text-card-foreground',
      className,
    )}
    {...props}
  />
));
Card.displayName = 'Card';

/** Card'in data-density'sine gore pad: default 24px, dense 16px */
const PAD = 'p-6 group-data-[density=dense]/card:p-4';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5', PAD, className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('text-panel-2 leading-tight', className)} {...props} />
  ),
);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn(PAD, 'pt-0', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center', PAD, 'pt-0', className)} {...props} />
  ),
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
