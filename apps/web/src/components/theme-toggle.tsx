'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Sun, Moon } from 'lucide-react';
import { Button } from './ui/button';
import { nextTheme, shownTheme, themeToggleLabel } from '@/lib/theme-cycle';

/**
 * Tema dugmesi — yalniz acik (gunes) ve koyu (ay). "Sistem" secenegi ve bilgisayar ikonu
 * kaldirildi (lib/theme-cycle.ts).
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="h-8 w-8" />;

  const Icon = shownTheme(resolvedTheme) === 'light' ? Sun : Moon;
  const etiket = themeToggleLabel(resolvedTheme);

  return (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 text-muted-foreground hover:text-foreground"
      onClick={() => setTheme(nextTheme(resolvedTheme))}
      title={etiket}
      aria-label={etiket}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </Button>
  );
}
