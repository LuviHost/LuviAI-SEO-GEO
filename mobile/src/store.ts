/**
 * Paylaşılan analiz durumu — arama çubuğundan analiz edilen alan adı ve sonucu
 * uygulama genelinde (Görünürlük vb. sekmeler) erişilebilir olsun diye.
 * Girişsiz akış: son analiz edilen site tüm sekmeleri besler.
 */
import React, { createContext, useCallback, useContext, useState } from 'react';
import { analyzeSite, PROVIDER_META, type AnalyzeResult, type ProviderKey } from './api';

interface AnalysisState {
  domain: string | null;
  result: AnalyzeResult | null;
  loading: boolean;
  error: string | null;
  run: (domain: string) => Promise<AnalyzeResult | null>;
  clear: () => void;
}

const Ctx = createContext<AnalysisState | null>(null);

export function AnalysisProvider({ children }: { children: React.ReactNode }) {
  const [domain, setDomain] = useState<string | null>(null);
  const [result, setResult] = useState<AnalyzeResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (raw: string) => {
    const d = raw.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    setDomain(d);
    setLoading(true);
    setError(null);
    try {
      const r = await analyzeSite(d);
      setResult(r);
      return r;
    } catch (e: any) {
      setError(e?.message ?? 'Analiz başarısız.');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setDomain(null);
    setResult(null);
    setError(null);
  }, []);

  return React.createElement(Ctx.Provider, { value: { domain, result, loading, error, run, clear } }, children);
}

export function useAnalysis(): AnalysisState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAnalysis, AnalysisProvider içinde kullanılmalı');
  return v;
}

/* ══════════════ Türetilmiş metrikler (citation-check → görünürlük paneli) ══════════════ */

export interface EngineStat {
  provider: ProviderKey;
  name: string;
  color: string;
  cited: number; // markanın alıntılandığı soru sayısı
  mentioned: number; // sadece adı geçen (alıntısız) soru sayısı
  total: number; // toplam soru sayısı
  rate: number; // görünürlük oranı % (cited / total)
}

export interface VisibilityDerived {
  score: number; // genel görünürlük skoru 0-100
  citedPairs: number; // alıntılanan (soru×motor) sayısı
  totalPairs: number; // toplam (soru×motor) sayısı
  engines: EngineStat[]; // motora göre, alıntı sayısına göre azalan
  answeredQueries: number; // en az bir motorun alıntıladığı soru sayısı
  totalQueries: number;
}

/** Bir citation-check sonucundan motor bazlı gerçek görünürlük metriklerini çıkarır. */
export function deriveVisibility(result: AnalyzeResult): VisibilityDerived {
  const totalQueries = result.queries.length;
  const acc = new Map<ProviderKey, { cited: number; mentioned: number; total: number }>();

  let citedPairs = 0;
  let totalPairs = 0;
  let answeredQueries = 0;

  for (const q of result.queries) {
    if (q.citedCount > 0) answeredQueries++;
    for (const p of q.providers) {
      const cur = acc.get(p.provider) ?? { cited: 0, mentioned: 0, total: 0 };
      cur.total += 1;
      totalPairs += 1;
      if (p.cited) { cur.cited += 1; citedPairs += 1; }
      else if (p.brandMentioned) cur.mentioned += 1;
      acc.set(p.provider, cur);
    }
  }

  const engines: EngineStat[] = Array.from(acc.entries())
    .map(([provider, s]) => {
      const meta = PROVIDER_META[provider];
      return {
        provider,
        name: meta?.name ?? provider,
        color: meta?.color ?? '#F47F46',
        cited: s.cited,
        mentioned: s.mentioned,
        total: s.total,
        rate: s.total > 0 ? Math.round((s.cited / s.total) * 100) : 0,
      };
    })
    .sort((a, b) => b.cited - a.cited || b.mentioned - a.mentioned);

  const score = totalPairs > 0 ? Math.round((citedPairs / totalPairs) * 100) : 0;

  return { score, citedPairs, totalPairs, engines, answeredQueries, totalQueries };
}
