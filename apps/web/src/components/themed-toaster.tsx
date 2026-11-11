'use client';

import { useTheme } from 'next-themes';
import { Toaster } from 'sonner';

/**
 * Bildirim kutucuklari sayfanin temasiyla cizilir. Sonner varsayilani acik tema:
 * koyu panelde ve koyu vitrinde beyaz kutucuk cikiyordu. Vitrin sayfalarinda tema
 * zorlanir (theme-provider.tsx forcedTheme), o yuzden once ona bakilir.
 */
export function ThemedToaster() {
  const { forcedTheme, resolvedTheme } = useTheme();
  const theme = (forcedTheme ?? resolvedTheme) === 'light' ? 'light' : 'dark';
  return <Toaster position="top-right" richColors closeButton theme={theme} />;
}
