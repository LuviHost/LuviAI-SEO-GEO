import Link from 'next/link';
import { ChevronRight, Home } from 'lucide-react';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

/**
 * Visible breadcrumbs UI + JSON-LD BreadcrumbList aynı anda render eder.
 * Marketing alt sayfalarda kullanılır.
 */
export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  const SITE_URL = 'https://ai.luvihost.com';

  const allItems: BreadcrumbItem[] = [
    { label: 'Ana Sayfa', href: '/' },
    ...items,
  ];

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: allItems.map((item, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: item.label,
      ...(item.href ? { item: `${SITE_URL}${item.href}` } : {}),
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground py-3">
        <ol className="flex items-center gap-1.5 flex-wrap">
          {allItems.map((item, idx) => (
            <li key={idx} className="inline-flex items-center gap-1.5">
              {idx > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />}
              {idx === 0 && <Home className="h-3 w-3 mr-0.5" />}
              {item.href && idx < allItems.length - 1 ? (
                <Link href={item.href as any} className="hover:text-foreground transition-colors">
                  {item.label}
                </Link>
              ) : (
                <span className={idx === allItems.length - 1 ? 'text-foreground font-medium' : ''}>{item.label}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}
