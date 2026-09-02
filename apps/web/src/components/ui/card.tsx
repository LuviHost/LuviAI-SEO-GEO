import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Kart — token refactor (02.09.2026): slate sabitleri yerine bg-card/border-border,
 * 14px yaricap (rounded-lg = var(--radius)), shadow-apple-sm.
 * `density`: default p-6, dense p-4 (16px — analitik grid sozlesmesi).
 * Header/Content/Footer pad'i Card'daki density'den kalitsal alir.
 */

type Density = 'default' | 'dense';
const DensityContext = React.createContext<Density>('default');
const PAD: Record<Density, string> = { default: 'p-6', dense: 'p-4' };

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { density?: Density }
>(({ className, density = 'default', ...props }, ref) => (
  <DensityContext.Provider value={density}>
    <div
      ref={ref}
      className={cn('rounded-lg border border-border bg-card text-card-foreground shadow-apple-sm', className)}
      {...props}
    />
  </DensityContext.Provider>
));
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const d = React.useContext(DensityContext);
    return <div ref={ref} className={cn('flex flex-col space-y-1.5', PAD[d], className)} {...props} />;
  },
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('text-xl font-semibold leading-none tracking-tight', className)} {...props} />
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
  ({ className, ...props }, ref) => {
    const d = React.useContext(DensityContext);
    return <div ref={ref} className={cn(PAD[d], 'pt-0', className)} {...props} />;
  },
);
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => {
    const d = React.useContext(DensityContext);
    return <div ref={ref} className={cn('flex items-center', PAD[d], 'pt-0', className)} {...props} />;
  },
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
