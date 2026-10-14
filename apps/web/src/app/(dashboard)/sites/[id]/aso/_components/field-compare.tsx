'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Mağaza alanı için "mevcut ↔ önerilen" iki sütunlu görünüm.
 * Kelime düzeyinde fark: önerilende eklenen kelimeler vurgulu, mevcutta
 * çıkarılanlar üstü çizili. Eskiden mevcut metadata ve AI önerisi ekranın
 * ayrı uçlarındaydı; neyin değiştiğini görmek için kaydırmak gerekiyordu.
 */

type Token = { text: string; kind: 'same' | 'add' | 'del' };

const chars = (s: string) => [...s].length;

function tokenize(s: string): string[] {
  return s.split(/(\s+)/).filter((t) => t.length > 0);
}

/** LCS tabanlı kelime farkı. Boşluk parçaları eşleşmeye katılır ama vurgulanmaz. */
function wordDiff(a: string, b: string): { left: Token[]; right: Token[] } {
  const A = tokenize(a);
  const B = tokenize(b);
  const n = A.length;
  const m = B.length;
  // Çok uzun metinlerde (ör. 4000 karakter açıklama) tablo ~ (n*m) — sınırla
  if (n * m > 1_500_000) {
    return { left: [{ text: a, kind: 'same' }], right: [{ text: b, kind: 'same' }] };
  }
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = A[i].toLocaleLowerCase('tr') === B[j].toLocaleLowerCase('tr')
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const left: Token[] = [];
  const right: Token[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i].toLocaleLowerCase('tr') === B[j].toLocaleLowerCase('tr')) {
      left.push({ text: A[i], kind: 'same' });
      right.push({ text: B[j], kind: 'same' });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      left.push({ text: A[i], kind: /^\s+$/.test(A[i]) ? 'same' : 'del' });
      i++;
    } else {
      right.push({ text: B[j], kind: /^\s+$/.test(B[j]) ? 'same' : 'add' });
      j++;
    }
  }
  while (i < n) { left.push({ text: A[i], kind: /^\s+$/.test(A[i]) ? 'same' : 'del' }); i++; }
  while (j < m) { right.push({ text: B[j], kind: /^\s+$/.test(B[j]) ? 'same' : 'add' }); j++; }
  return { left, right };
}

function Tokens({ tokens }: { tokens: Token[] }) {
  return (
    <>
      {tokens.map((t, i) =>
        t.kind === 'same' ? (
          <span key={i}>{t.text}</span>
        ) : t.kind === 'add' ? (
          <mark key={i} className="rounded-sm bg-success/15 px-0.5 text-foreground">{t.text}</mark>
        ) : (
          <del key={i} className="rounded-sm bg-danger/10 px-0.5 text-muted-foreground">{t.text}</del>
        ),
      )}
    </>
  );
}

function Counter({ value, limit }: { value: string; limit?: number }) {
  if (!limit) return null;
  const n = chars(value);
  return (
    <span className={cn('text-label tabular-nums', n > limit ? 'text-danger' : 'text-muted-foreground')}>
      {n}/{limit}
    </span>
  );
}

export function FieldCompare({
  label,
  current,
  suggested,
  limit,
  multiline,
  hint,
  currentNote,
}: {
  label: string;
  current: string | null | undefined;
  suggested?: string | null;
  limit?: number;
  multiline?: boolean;
  hint?: React.ReactNode;
  /** Mevcut değer okunamıyorsa (ör. anahtar kelime alanı herkese açık değil) açıklama */
  currentNote?: string;
}) {
  const cur = current ?? '';
  const sug = suggested ?? '';
  const hasSuggestion = sug.length > 0;
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const diff = useMemo(() => (hasSuggestion && cur ? wordDiff(cur, sug) : null), [cur, sug, hasSuggestion]);
  const long = multiline && Math.max(cur.length, sug.length) > 600;
  const clamp = long && !expanded ? 'line-clamp-6' : '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(sug);
      setCopied(true);
      toast.success(`${label} panoya kopyalandı`);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Kopyalanamadı');
    }
  };

  const overLimit = limit ? chars(sug) > limit : false;

  return (
    <div className="rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
        <span className="text-sm font-medium">{label}</span>
        {hint && <span className="text-label text-muted-foreground">{hint}</span>}
      </div>
      <div className="grid md:grid-cols-2 md:divide-x">
        <div className="min-w-0 p-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-label text-muted-foreground">Mevcut</span>
            {!currentNote && <Counter value={cur} limit={limit} />}
          </div>
          {currentNote && !cur ? (
            <p className="text-sm italic text-muted-foreground">{currentNote}</p>
          ) : !cur ? (
            <p className="text-sm italic text-danger">Boş</p>
          ) : (
            <p className={cn('whitespace-pre-wrap break-words text-sm', clamp)}>
              {diff ? <Tokens tokens={diff.left} /> : cur}
            </p>
          )}
        </div>
        <div className="min-w-0 border-t p-3 md:border-t-0">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-label text-muted-foreground">Önerilen</span>
            <div className="flex items-center gap-2">
              {hasSuggestion && <Counter value={sug} limit={limit} />}
              {hasSuggestion && (
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={copy} aria-label={`${label} önerisini kopyala`}>
                  {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                  <span className="ml-1 text-label">Kopyala</span>
                </Button>
              )}
            </div>
          </div>
          {hasSuggestion ? (
            <>
              <p className={cn('whitespace-pre-wrap break-words text-sm', clamp, multiline ? '' : 'font-medium')}>
                {diff ? <Tokens tokens={diff.right} /> : sug}
              </p>
              {overLimit && <p className="mt-1 text-label text-danger">Karakter sınırını aşıyor — kısalt.</p>}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Öneri üretince burada görünecek.</p>
          )}
        </div>
      </div>
      {long && (
        <div className="border-t px-3 py-1.5">
          <button type="button" onClick={() => setExpanded(!expanded)} className="text-label text-brand hover:underline">
            {expanded ? 'Daralt' : 'Tamamını göster'}
          </button>
        </div>
      )}
    </div>
  );
}
