'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
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
      {/* Kutular yerine ince cizgiyle ayrilan satirlar */}
      <div className="border-t border-border">
        {faqs.map((f, i) => {
          const isOpen = open === i;
          return (
            <div key={i} className="border-b border-border">
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`faq-${i}`}
                onClick={() => setOpen(isOpen ? null : i)}
                className="flex w-full items-center justify-between gap-6 py-5 text-left transition-colors duration-200 hover:text-brand-vivid"
              >
                <span className="text-base font-medium">{f.q}</span>
                {/* Arti, acikken 45 derece donup carpi olur */}
                <Plus className={cn('h-4 w-4 shrink-0 transition-transform duration-200', isOpen && 'rotate-45')} aria-hidden />
              </button>
              {isOpen && (
                <div id={`faq-${i}`} className="max-w-2xl pb-6 text-sm leading-[1.8] text-muted-foreground">
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
