import Link from 'next/link';
import { Search, Home, ArrowRight } from 'lucide-react';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sayfa bulunamadı',
  description: 'Aradığın sayfa LuviAI üzerinde mevcut değil.',
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-background to-muted px-4 py-16">
      <div className="max-w-md text-center">
        <div className="text-7xl sm:text-9xl font-black bg-gradient-to-br from-brand to-violet-500 bg-clip-text text-transparent leading-none mb-4">
          404
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
          Sayfa bulunamadı
        </h1>
        <p className="text-muted-foreground mb-8 leading-relaxed">
          Aradığın sayfa taşınmış, silinmiş ya da hiç var olmamış olabilir.
          Aşağıdan ana sayfaya dönebilir veya ihtiyacın olanı arayabilirsin.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-md bg-brand text-white font-semibold hover:bg-brand/90 transition-colors"
          >
            <Home className="h-4 w-4" /> Ana Sayfa
          </Link>
          <Link
            href="/faq"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-md border bg-background hover:bg-muted transition-colors text-sm font-medium"
          >
            <Search className="h-4 w-4" /> Sıkça Sorulan Sorular
          </Link>
        </div>

        <div className="mt-10 pt-6 border-t border-border/50 text-sm text-muted-foreground">
          <p className="mb-3">Muhtemelen bunu arıyordun:</p>
          <div className="grid grid-cols-2 gap-2 text-left">
            <Link href="/pricing" className="inline-flex items-center gap-1 hover:text-brand">
              <ArrowRight className="h-3 w-3" /> Fiyatlandırma
            </Link>
            <Link href="/use-cases" className="inline-flex items-center gap-1 hover:text-brand">
              <ArrowRight className="h-3 w-3" /> Kullanım Senaryoları
            </Link>
            <Link href="/about" className="inline-flex items-center gap-1 hover:text-brand">
              <ArrowRight className="h-3 w-3" /> Hakkımızda
            </Link>
            <Link href="/help" className="inline-flex items-center gap-1 hover:text-brand">
              <ArrowRight className="h-3 w-3" /> Yardım Merkezi
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
