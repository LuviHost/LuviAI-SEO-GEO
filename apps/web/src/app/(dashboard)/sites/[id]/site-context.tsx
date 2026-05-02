'use client';

import { createContext, useContext } from 'react';

type SiteContextValue = {
  site: any;
  audit: any;
  queue: any;
  articles: any[];
  publishTargets: any[];
  loading: boolean;
  refresh: () => Promise<void>;
  onboardingMode: boolean;
};

export const SiteContext = createContext<SiteContextValue | null>(null);

export function useSiteContext() {
  const ctx = useContext(SiteContext);
  if (!ctx) throw new Error('useSiteContext must be used within /sites/[id] layout');
  return ctx;
}
