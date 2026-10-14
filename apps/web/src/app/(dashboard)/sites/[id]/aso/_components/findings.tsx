'use client';

import { AlertTriangle, CheckCircle2, ChevronDown, Info, OctagonAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { STORE_LABEL, type AuditFinding, type Severity } from './types';

/**
 * Mağaza denetim bulguları — Türkçe alan adları ve akordeon görünüm.
 * Sunucu bazı alanları İngilizce adlandırıyor ("Subtitle", "Promotional Text");
 * arayüz tek sözlük kullanır (asc-metadata-panel ile aynı terimler).
 */

const FIELD_LABEL: Record<string, string> = {
  title: 'Ad',
  subtitle: 'Alt başlık',
  description: 'Açıklama',
  shortDesc: 'Kısa açıklama',
  // Sunucu bu bulguyu sürüm notlarından (releaseNotes) üretiyor — mağazada "Yenilikler"
  promo: 'Yenilikler',
  reviews: 'Yorumlar',
  rating: 'Puan',
  screenshots: 'Ekran görüntüleri',
  ipadScreenshots: 'iPad ekran görüntüleri',
  creativeAssetsFreshness: 'Görsel tazeliği',
  video: 'Tanıtım videosu',
  featureGraphic: 'Öne çıkan görsel',
  category: 'Kategori',
};

/** Görsellerle ilgili bulgular — Görseller sekmesi bunları gösterir */
export const CREATIVE_FIELDS = new Set(['screenshots', 'ipadScreenshots', 'creativeAssetsFreshness', 'video', 'featureGraphic']);

export function findingLabel(f: AuditFinding): string {
  if (f.field === 'description' && f.store === 'ANDROID') return 'Uzun açıklama';
  return FIELD_LABEL[f.field] ?? f.label;
}

export function findingMessage(f: AuditFinding): string | undefined {
  // "Promotional text boş" aslında sürüm notlarının boş olduğu anlamına geliyor
  if (f.field === 'promo') return 'Yenilikler (sürüm notları) mağaza verisinde boş görünüyor.';
  return f.message;
}

export const SEVERITY_META: Record<Severity, { label: string; icon: React.ComponentType<{ className?: string }>; text: string; box: string; badge: 'danger' | 'warning' | 'success' | 'info' }> = {
  error: { label: 'Hata', icon: OctagonAlert, text: 'text-danger', box: 'border-danger/25 bg-danger/5', badge: 'danger' },
  warning: { label: 'Uyarı', icon: AlertTriangle, text: 'text-warning', box: 'border-warning/30 bg-warning/5', badge: 'warning' },
  info: { label: 'Bilgi', icon: Info, text: 'text-info', box: 'border-info/25 bg-info/5', badge: 'info' },
  ok: { label: 'İyi', icon: CheckCircle2, text: 'text-success', box: 'border-success/25 bg-success/5', badge: 'success' },
};

const ORDER: Severity[] = ['error', 'warning', 'info', 'ok'];

function FindingRow({ f }: { f: AuditFinding }) {
  const m = SEVERITY_META[f.severity] ?? SEVERITY_META.info;
  const Icon = m.icon;
  const msg = findingMessage(f);
  return (
    <li className="flex items-start gap-3 py-2.5">
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', m.text)} aria-label={m.label} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{findingLabel(f)}</span>
          <Badge variant="outline" className="px-1.5 text-label">{f.store === 'BOTH' ? 'Hepsi' : STORE_LABEL[f.store]}</Badge>
          {f.current != null && f.current !== '' && <span className="text-label text-muted-foreground">{String(f.current)}</span>}
        </div>
        {msg && <p className="mt-0.5 text-sm text-foreground/80">{msg}</p>}
        {f.recommendation && <p className="mt-0.5 text-label text-muted-foreground">Öneri: {f.recommendation}</p>}
      </div>
    </li>
  );
}

/** Önem derecesine göre katlanır gruplar — hatalar açık gelir */
export function FindingsAccordion({ findings }: { findings: AuditFinding[] }) {
  if (findings.length === 0) {
    return <p className="text-sm text-muted-foreground">Bulgu yok.</p>;
  }
  return (
    <div className="divide-y rounded-lg border">
      {ORDER.map((sev) => {
        const list = findings.filter((f) => f.severity === sev);
        if (list.length === 0) return null;
        const m = SEVERITY_META[sev];
        const Icon = m.icon;
        return (
          <details key={sev} className="group" open={sev === 'error' || (sev === 'warning' && !findings.some((f) => f.severity === 'error'))}>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand [&::-webkit-details-marker]:hidden">
              <Icon className={cn('h-4 w-4', m.text)} aria-hidden />
              <span className="text-sm font-medium">{m.label}</span>
              <Badge variant={m.badge} className="px-2 text-label">{list.length}</Badge>
              <ChevronDown className="ml-auto h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <ul className="divide-y px-3">
              {list.map((f, i) => <FindingRow key={`${f.store}-${f.field}-${i}`} f={f} />)}
            </ul>
          </details>
        );
      })}
    </div>
  );
}
