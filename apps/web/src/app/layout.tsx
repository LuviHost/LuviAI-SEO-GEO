import './globals.css';
import type { Metadata, Viewport } from 'next';
import { ThemeProvider } from '@/components/theme-provider';
import { CookieConsent } from '@/components/cookie-consent';
import { AppSessionProvider } from '@/components/session-provider';
import { Toaster } from 'sonner';

export const metadata: Metadata = {
  title: 'LuviAI — SEO + GEO Otomasyonu',
  description: 'Sitenin URL\'ini ver, GSC bağla, AI haftalık 5-50 makale üretip yayınlasın.',
  icons: { icon: '/favicon.ico' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#020617' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" suppressHydrationWarning>
      <body className="antialiased min-h-screen bg-background text-foreground">
        <AppSessionProvider>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
            {children}
            <CookieConsent />
            <Toaster position="top-right" richColors closeButton />
          </ThemeProvider>
        </AppSessionProvider>
      </body>
    </html>
  );
}
