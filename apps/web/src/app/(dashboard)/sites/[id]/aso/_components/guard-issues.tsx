'use client';

import { ShieldCheck } from 'lucide-react';
import type { GuardIssue, Store } from './types';

/**
 * API'deki politika bekçisinin raporu. AI metni kullanıcıya gelmeden önce
 * doğrulanamayan iddia (puan, kullanıcı sayısı, ödül), fiyat/indirim ve
 * Google Play'in istemediği ifadelerden arındırılır; burada neyin çıkarıldığı
 * ya da kontrol edilmesi gerektiği açıkça söylenir.
 */

function fieldLabel(field: string, store?: Store): string {
  if (field === 'title') return 'Ad';
  if (field === 'subtitle') return store === 'ANDROID' ? 'Kısa açıklama' : 'Alt başlık';
  if (field === 'description') return 'Açıklama';
  if (field === 'keywordField') return 'Anahtar kelimeler';
  if (field === 'whatsNew') return "What's New";
  const caption = field.match(/^captions\[(\d+)\]\.(hook|subtitle)$/);
  if (caption) return `Görsel ${caption[1]} · ${caption[2] === 'hook' ? 'başlık' : 'alt metin'}`;
  return field;
}

export function GuardIssues({ issues, store }: { issues?: GuardIssue[] | null; store?: Store }) {
  if (!issues?.length) return null;
  const removed = issues.filter((i) => i.action === 'removed').length;
  return (
    <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm">
      <p className="mb-1 flex items-center gap-1.5 font-medium">
        <ShieldCheck className="h-4 w-4 text-warning" aria-hidden /> Mağaza politikası denetimi
      </p>
      {removed > 0 && (
        <p className="mb-1.5 text-label text-muted-foreground">
          AI önerisinden {removed} ifade çıkarıldı: uygulamanın mağaza verisiyle doğrulanamayan iddia ya da mağaza politikasına aykırı ifade.
        </p>
      )}
      <ul className="space-y-1">
        {issues.map((i, idx) => (
          <li key={`${i.field}-${i.code}-${idx}`} className="text-label">
            <span className="font-medium">{fieldLabel(i.field, store)}</span>
            {' · '}
            {i.action === 'removed' ? 'Çıkarıldı' : 'Kontrol et'}: “{i.excerpt}” — {i.message}{' '}
            <span className="text-muted-foreground">({i.source})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
