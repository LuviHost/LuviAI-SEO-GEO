'use client';

import { useState, useRef, useEffect } from 'react';
import { Info } from 'lucide-react';
import Link from 'next/link';
import { getGlossaryEntry } from '@/lib/glossary';

/**
 * InfoTooltip — yanindaki kucuk gri bilgi ikonu, hover/tap'da popover acar.
 *
 * Kullanim:
 *   <InfoTooltip term="ROAS" />
 *   <InfoTooltip term="ROAS">Custom label</InfoTooltip>
 *   <InfoTooltip text="Manuel aciklama" />
 *
 * 3 mod:
 *  - term: glossary'den otomatik aciklama
 *  - text: manuel aciklama
 *  - children: gorunur metin (ikon yaninda)
 */
export function InfoTooltip({
  term,
  text,
  children,
  side = 'top',
  iconClassName = '',
}: {
  term?: string;
  text?: string;
  children?: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  iconClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  // Click outside ile kapat (mobile icin)
  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const entry = term ? getGlossaryEntry(term) : null;
  const displayText = text ?? entry?.short ?? '';
  const link = entry?.link;

  if (!displayText && !text) {
    // Bilinmeyen terim — ikon yine de render edilir ama boş tooltip
    return <>{children}</>;
  }

  const sidePos: Record<string, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  return (
    <span ref={ref} className="relative inline-flex items-center gap-1 align-middle">
      {children}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => {
          // Mobile için hover yok, sadece desktop için kapat
          if (!('ontouchstart' in window)) setOpen(false);
        }}
        className={`inline-flex items-center justify-center rounded-full text-muted-foreground/60 hover:text-brand transition-colors ${iconClassName}`}
        aria-label={`${term ?? 'Bilgi'} hakkında bilgi`}
      >
        <Info className="h-3 w-3" />
      </button>

      {open && (
        <div
          className={`absolute z-50 w-64 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover text-popover-foreground shadow-lg p-3 text-xs leading-relaxed ${sidePos[side]} pointer-events-auto`}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => {
            if (!('ontouchstart' in window)) setOpen(false);
          }}
        >
          {term && (
            <p className="font-semibold text-brand mb-1 text-[11px] uppercase tracking-wide">{term}</p>
          )}
          <p className="text-muted-foreground">{displayText}</p>
          {link && (
            <Link
              href={link as any}
              className="mt-2 inline-block text-[11px] text-brand hover:underline"
            >
              Daha fazla →
            </Link>
          )}
          {/* Pointer arrow */}
          <div
            className={`absolute h-2 w-2 bg-popover border-l border-t rotate-45 ${
              side === 'top' ? 'bottom-[-5px] left-1/2 -translate-x-1/2' :
              side === 'bottom' ? 'top-[-5px] left-1/2 -translate-x-1/2' :
              side === 'left' ? 'right-[-5px] top-1/2 -translate-y-1/2' :
              'left-[-5px] top-1/2 -translate-y-1/2'
            }`}
          />
        </div>
      )}
    </span>
  );
}
