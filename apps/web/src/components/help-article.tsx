import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowLeft, ChevronRight } from 'lucide-react';

export function HelpArticle({
  icon: Icon, badge, title, intro, children, slug, steps,
}: {
  icon: any; badge: string; title: string; intro: string; children: ReactNode;
  /** URL slug (örn: 'getting-started') — schema'da kullanılır */
  slug?: string;
  /** Step listesi — HowTo schema için (Google rich snippet "Step 1, 2, 3"). Her item: { name, text } */
  steps?: Array<{ name: string; text: string }>;
}) {
  const siteUrl = 'https://ranksup.ai';
  const articleUrl = slug ? `${siteUrl}/help/${slug}` : `${siteUrl}/help`;

  return (
    <main className="relative min-h-screen">
      {/* BreadcrumbList schema (her alt help sayfasında) */}
      {slug && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'BreadcrumbList',
              itemListElement: [
                { '@type': 'ListItem', position: 1, name: 'RanksUp', item: siteUrl },
                { '@type': 'ListItem', position: 2, name: 'Yardım', item: `${siteUrl}/help` },
                { '@type': 'ListItem', position: 3, name: title, item: articleUrl },
              ],
            }),
          }}
        />
      )}
      {/* Article schema (TechArticle — AI'lar dokümantasyon olarak tanısın) */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'TechArticle',
            headline: title,
            description: intro,
            url: articleUrl,
            inLanguage: 'tr-TR',
            author: { '@type': 'Organization', name: 'RanksUp', url: siteUrl },
            publisher: { '@type': 'Organization', name: 'RanksUp', url: siteUrl, logo: { '@type': 'ImageObject', url: `${siteUrl}/og-image.png` } },
            // Speakable — Google Voice / Assistant için en üstteki paragraf okunabilir
            speakable: {
              '@type': 'SpeakableSpecification',
              cssSelector: ['h1', '.help-intro'],
            },
          }),
        }}
      />
      {/* HowTo schema — adım adım rehberler için Google rich snippet "Step 1, 2, 3..." */}
      {steps && steps.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'HowTo',
              name: title,
              description: intro,
              inLanguage: 'tr-TR',
              totalTime: 'PT5M',
              step: steps.map((s, i) => ({
                '@type': 'HowToStep',
                position: i + 1,
                name: s.name,
                text: s.text,
                url: `${articleUrl}#step-${i + 1}`,
              })),
            }),
          }}
        />
      )}
      <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-0 -left-20 w-96 h-96 bg-brand-500/8 rounded-full blur-3xl" />
      </div>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Link href={'/help' as any} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="h-4 w-4" /> Tüm rehberler
        </Link>
        <div className="flex items-start gap-4 mb-8">
          <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-brand-500/15 to-brand-600/10 grid place-items-center shrink-0">
            <Icon className="h-6 w-6 text-brand-600" />
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-brand-600 mb-1">{badge}</div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight mb-2">{title}</h1>
            <p className="help-intro text-muted-foreground leading-relaxed">{intro}</p>
          </div>
        </div>
        <article className="prose prose-neutral dark:prose-invert prose-headings:font-bold prose-h2:text-xl prose-h2:mt-10 prose-h2:mb-3 prose-h3:text-base prose-h3:mt-6 prose-h3:mb-2 prose-p:leading-relaxed prose-li:my-1 prose-strong:font-bold prose-a:text-brand-600 prose-a:no-underline hover:prose-a:underline max-w-none">
          {children}
        </article>

        <div className="mt-12 rounded-2xl border bg-card p-5 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="font-semibold">Çözemedin mi?</p>
            <p className="text-xs text-muted-foreground">15 dakika ücretsiz ekran paylaşımı destekleri.</p>
          </div>
          <a
            href="mailto:destek@luvihost.com"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-br from-brand-500 to-brand-600 hover:from-brand-600 hover:to-brand-700 text-white text-sm font-semibold"
          >
            destek@luvihost.com <ChevronRight className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
    </main>
  );
}

/** Adım kartı — "1. Şunu yap" formatlı görselleştirme */
export function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="not-prose flex gap-3 my-4">
      <div className="h-7 w-7 rounded-full bg-brand-500 text-white grid place-items-center text-sm font-bold shrink-0">{n}</div>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm mb-1">{title}</p>
        <div className="text-sm text-muted-foreground leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

/** Bilgi / uyarı kutusu */
export function Tip({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'success'; children: ReactNode }) {
  const styles: Record<string, string> = {
    info: 'border-blue-500/30 bg-blue-500/5 text-blue-900 dark:text-blue-100',
    warn: 'border-amber-500/40 bg-amber-500/5 text-amber-900 dark:text-amber-100',
    success: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-900 dark:text-emerald-100',
  };
  const labels: Record<string, string> = { info: '💡 İPUCU', warn: '⚠️ DİKKAT', success: '✅ KAZANIM' };
  return (
    <div className={`not-prose my-5 rounded-lg border-l-4 ${styles[kind]} p-3.5 text-sm leading-relaxed`}>
      <div className="text-[10px] font-bold tracking-widest mb-1">{labels[kind]}</div>
      <div>{children}</div>
    </div>
  );
}
