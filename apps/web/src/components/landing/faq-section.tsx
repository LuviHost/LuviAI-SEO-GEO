'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useT, type Key } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const FAQ_KEYS: Array<[Key, Key]> = [
  ['land.faq.q1', 'land.faq.a1'],
  ['land.faq.q2', 'land.faq.a2'],
  ['land.faq.q3', 'land.faq.a3'],
  ['land.faq.q4', 'land.faq.a4'],
  ['land.faq.q5', 'land.faq.a5'],
  ['land.faq.q6', 'land.faq.a6'],
  ['land.faq.q7', 'land.faq.a7'],
];

/** SSS akordeonu + FAQPage JSON-LD (AI asistanlari bunu cevap kaynagi olarak kullanir) */
export function FaqSection() {
  const { t } = useT();
  const [open, setOpen] = useState<number | null>(0);
  const faqs = FAQ_KEYS.map(([q, a]) => ({ q: t(q), a: t(a) }));

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: faqs.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
          }),
        }}
      />
      <div className="space-y-3">
        {faqs.map((f, i) => {
          const isOpen = open === i;
          return (
            <div key={i} className="rounded-xl border bg-background overflow-hidden">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`faq-${i}`}
                onClick={() => setOpen(isOpen ? null : i)}
                className="w-full p-5 flex items-center justify-between gap-4 text-left hover:bg-muted/30 transition"
              >
                <span className="font-semibold">{f.q}</span>
                <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', isOpen && 'rotate-180')} aria-hidden />
              </button>
              {isOpen && (
                <div id={`faq-${i}`} className="px-5 pb-5 text-sm text-muted-foreground leading-relaxed border-t pt-4">
                  {f.a}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
