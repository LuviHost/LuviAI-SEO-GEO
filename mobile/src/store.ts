/**
 * Paylaşılan analiz durumu — arama çubuğundan analiz edilen alan adı ve sonucu
 * uygulama genelinde (Görünürlük vb. sekmeler) erişilebilir olsun diye.
 * Girişsiz akış: son analiz edilen site tüm sekmeleri besler.
 */
import React, { createContext, useCallback, useContext, useState } from 'react';
import { analyzeSite, type AnalyzeResult } from './api';

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
// Hesap src/visibility.ts'te (saf modul, test edilir; web summarize() ile ayni tanim).
// Buradan yeniden disa aktarilir ki mevcut importlar degismesin.
export { deriveVisibility, type EngineStat, type VisibilityDerived } from './visibility';
