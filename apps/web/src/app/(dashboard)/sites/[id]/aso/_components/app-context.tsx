'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { AiKeywordSuggestion, AppDetail, AscApp, AuditResult, OptimizeResult, Store } from './types';

/**
 * Uygulama çalışma alanı bağlamı — aso/[appId]/layout.tsx sağlar.
 *
 * NEDEN: çalışma alanı eskiden tek bir modalın içindeydi; sekme değişince
 * hiçbir şey yeniden çekilmiyordu. Rotalara bölünce her sayfa aynı veriyi
 * tekrar istemesin diye uygulama, denetim, yorum istatistiği ve ASC eşleşmesi
 * burada bir kez çekilir; AI sonuçları (30 sn'lik LLM çağrıları) sekmeler
 * arasında gezinirken kaybolmaz.
 */

type Lazy<T> = {
  data: T | null;
  loading: boolean;
  error: unknown;
  loaded: boolean;
  /** İlk ihtiyaçta bir kez çek */
  ensure: () => void;
  reload: () => Promise<void>;
};

function useLazy<T>(fetcher: () => Promise<T>, key: string): Lazy<T> {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: unknown; loaded: boolean }>({
    data: null, loading: false, error: null, loaded: false,
  });
  const inflight = useRef(false);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  // Yalnız anahtar GERÇEKTEN değişince sıfırla (ilk bağlamada değil — çocukların
  // efektleri ebeveynden önce çalışır; ilk mount'ta sıfırlamak çifte istek yapardı)
  const lastKey = useRef(key);
  useEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    setState({ data: null, loading: false, error: null, loaded: false });
    inflight.current = false;
  }, [key]);

  const reload = useCallback(async () => {
    inflight.current = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetcherRef.current();
      setState({ data, loading: false, error: null, loaded: true });
    } catch (error) {
      setState((s) => ({ ...s, loading: false, error, loaded: true }));
    } finally {
      inflight.current = false;
    }
  }, []);

  const ensure = useCallback(() => {
    if (inflight.current || state.loaded) return;
    void reload();
  }, [state.loaded, reload]);

  return { ...state, ensure, reload };
}

type AscState = { loading: boolean; connected: boolean; match: AscApp | null };

type AsoAppContextValue = {
  siteId: string;
  app: AppDetail;
  /** Uygulamayı (anahtar kelimelerle) iskelet göstermeden yeniden çek */
  reloadApp: () => Promise<void>;
  base: string;
  audit: Lazy<AuditResult>;
  reviewStats: Lazy<any>;
  asc: AscState;
  aiSuggestions: AiKeywordSuggestion[];
  setAiSuggestions: (v: AiKeywordSuggestion[]) => void;
  optimize: { store: Store; result: OptimizeResult | null } | null;
  setOptimize: (v: { store: Store; result: OptimizeResult | null } | null) => void;
};

const AsoAppContext = createContext<AsoAppContextValue | null>(null);

export function AsoAppProvider({
  siteId,
  app,
  reloadApp,
  children,
}: {
  siteId: string;
  app: AppDetail;
  reloadApp: () => Promise<void>;
  children: React.ReactNode;
}) {
  const key = `${siteId}/${app.id}`;
  const audit = useLazy<AuditResult>(
    () => api.request<AuditResult>(`/sites/${siteId}/aso/apps/${app.id}/audit`),
    key,
  );
  const reviewStats = useLazy<any>(
    () => api.request<any>(`/sites/${siteId}/aso/apps/${app.id}/reviews/stats`),
    key,
  );

  const [asc, setAsc] = useState<AscState>({ loading: true, connected: false, match: null });
  useEffect(() => {
    let cancelled = false;
    setAsc((s) => ({ ...s, loading: true }));
    api.listAscAccounts(siteId)
      .catch(() => [])
      .then((accounts) => {
        if (cancelled) return;
        const apps = (accounts ?? []).flatMap((a: any) => (a.apps ?? []) as AscApp[]);
        // Eşleşme: izlenen uygulamanın App Store kimliği == ASC uygulamasının Apple kimliği
        const match = app.appStoreId ? apps.find((x) => String(x.appleAppId) === String(app.appStoreId)) ?? null : null;
        setAsc({ loading: false, connected: (accounts ?? []).length > 0, match });
      });
    return () => { cancelled = true; };
  }, [siteId, app.appStoreId]);

  const [aiSuggestions, setAiSuggestions] = useState<AiKeywordSuggestion[]>([]);
  const [optimize, setOptimize] = useState<{ store: Store; result: OptimizeResult | null } | null>(null);

  const value = useMemo<AsoAppContextValue>(
    () => ({
      siteId,
      app,
      reloadApp,
      base: `/sites/${siteId}/aso/${app.id}`,
      audit,
      reviewStats,
      asc,
      aiSuggestions,
      setAiSuggestions,
      optimize,
      setOptimize,
    }),
    [siteId, app, reloadApp, audit, reviewStats, asc, aiSuggestions, optimize],
  );

  return <AsoAppContext.Provider value={value}>{children}</AsoAppContext.Provider>;
}

export function useAsoApp() {
  const ctx = useContext(AsoAppContext);
  if (!ctx) throw new Error('useAsoApp yalnız aso/[appId] altında kullanılır');
  return ctx;
}

/** Denetimi ilk ihtiyaçta çeker ve döndürür */
export function useAudit() {
  const { audit } = useAsoApp();
  const { ensure } = audit;
  useEffect(() => { ensure(); }, [ensure]);
  return audit;
}

export function useReviewStats() {
  const { reviewStats } = useAsoApp();
  const { ensure } = reviewStats;
  useEffect(() => { ensure(); }, [ensure]);
  return reviewStats;
}
