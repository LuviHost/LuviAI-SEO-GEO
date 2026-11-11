import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        // Vitrin dugmeleri (globals.css .v-btn / .v-btn-line) ile ayni dil:
        // birincil = duz turuncu + SIYAH metin, uzerine gelince zemin/metin tersine doner;
        // ikincil = yalniz ince cerceve. Golge ve olcekleme yok.
        default: 'bg-brand text-black hover:bg-foreground hover:text-background',
        secondary: 'bg-muted text-foreground hover:bg-foreground/15',
        outline: 'border border-foreground/20 bg-transparent text-foreground hover:border-foreground/70',
        ghost: 'text-foreground hover:bg-muted',
        destructive: 'bg-danger text-white hover:bg-danger/90 dark:text-black',
        link: 'text-brand underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 px-3',
        lg: 'h-11 px-6',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
