'use client';

import * as React from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Sıralanabilir veri tablosu — başlığa tıkla/Enter ile sırala (aria-sort),
 * sayılar sağa yaslı ve tabular, dar ekranda yatay kaydırma kapsayıcıda
 * (sayfa kaymaz). Sıralama ayrı bir <select>'te değil, başlıkta.
 */
export type Column<T> = {
  key: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  /** Verilirse sütun sıralanabilir */
  sortValue?: (row: T) => number | string | null | undefined;
  align?: 'left' | 'right';
  /** Dar ekranda gizle */
  hideBelow?: 'sm' | 'md' | 'lg';
  className?: string;
};

type Sort = { key: string; dir: 'asc' | 'desc' } | null;

const HIDE: Record<string, string> = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' };

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  initialSort = null,
  onRowClick,
  caption,
  className,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  initialSort?: Sort;
  onRowClick?: (row: T) => void;
  /** Ekran okuyucu için tablo adı */
  caption?: string;
  className?: string;
}) {
  const [sort, setSort] = React.useState<Sort>(initialSort);

  const sorted = React.useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key);
    if (!col?.sortValue || !sort) return rows;
    const get = col.sortValue;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // boşlar hep sonda
      if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'tr') * dir;
    });
  }, [rows, columns, sort]);

  const toggle = (key: string) =>
    setSort((s) => (s?.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }));

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b text-left text-label text-muted-foreground">
            {columns.map((c) => {
              const active = sort?.key === c.key;
              const ariaSort = active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : c.sortValue ? 'none' : undefined;
              const Icon = active ? (sort!.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
              return (
                <th
                  key={c.key}
                  scope="col"
                  aria-sort={ariaSort}
                  className={cn('px-3 py-2 font-medium', c.align === 'right' && 'text-right', c.hideBelow && HIDE[c.hideBelow], c.className)}
                >
                  {c.sortValue ? (
                    <button
                      type="button"
                      onClick={() => toggle(c.key)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                        active && 'text-foreground',
                      )}
                    >
                      {c.header}
                      <Icon className={cn('h-3 w-3', !active && 'opacity-40')} aria-hidden />
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y">
          {sorted.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn('align-middle', onRowClick && 'cursor-pointer hover:bg-muted/50')}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn('px-3 py-2.5', c.align === 'right' && 'text-right tabular-nums', c.hideBelow && HIDE[c.hideBelow], c.className)}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
