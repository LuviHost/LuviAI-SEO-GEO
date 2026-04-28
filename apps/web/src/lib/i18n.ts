'use client';

import { useSyncExternalStore } from 'react';

export type Locale = 'tr' | 'en';

// Tek source-of-truth: dictionary
const dictionary = {
  tr: {
    'nav.home': 'Ana Sayfa',
    'nav.pricing': 'Fiyatlar',
    'nav.dashboard': 'Panel',
    'nav.login': 'Giriş Yap',
    'nav.signup': 'Erken Erişim',
    'hero.title': 'Siteni ve sosyal medyanı, AI ile birlikte yönet',
    'hero.subtitle': "SEO ve GEO uyumlu içerikler otomatik üretilir, takvimden saatini seçersin, sitene ve sosyal kanallarına (X, LinkedIn) otomatik yayınlanır.",
    'hero.cta_primary': 'Erken Erişime Katıl',
    'hero.cta_secondary': 'Demo İzle',
    'hero.beta_note': 'Beta — şu anda davet üzeri kayıt',
    'pricing.title': 'Plan Seçenekleri',
    'pricing.subtitle': 'Ücretsiz başla, dilediğin zaman iptal et.',
    'pricing.monthly': 'Aylık',
    'pricing.annual': 'Yıllık',
    'pricing.save': 'kazan',
    'pricing.cta': '1 Makale Ücretsiz Dene',
    'pricing.popular': 'EN POPÜLER',
    'pricing.articles_per_month': 'makale/ay',
    'pricing.sites': 'site',
    'pricing.all_publish_targets': 'Tüm yayın hedefleri',
    'pricing.markdown_only': 'Sadece Markdown ZIP',
    'pricing.security_note': '💳 PayTR güvenli ödeme · ✅ İstediğin zaman iptal · 🇹🇷 KDV dahil',
    'dashboard.title': 'Panel',
    'dashboard.new_site': '+ Yeni Site',
    'dashboard.sites': 'Sitelerim',
    'dashboard.empty': 'Henüz site eklenmemiş.',
    'dashboard.add_first': 'İlk siteni ekle →',
    'common.loading': 'Yükleniyor…',
    'common.error': 'Bir hata oluştu',
    'common.cancel': 'İptal',
    'common.save': 'Kaydet',
    'common.continue': 'Devam',
    'common.back': 'Geri',
    'common.finish': 'Bitir',
  },
  en: {
    'nav.home': 'Home',
    'nav.pricing': 'Pricing',
    'nav.dashboard': 'Dashboard',
    'nav.login': 'Sign In',
    'nav.signup': 'Early Access',
    'hero.title': 'Manage your website and social with AI, on autopilot',
    'hero.subtitle': 'SEO + GEO ready content gets generated automatically, you pick the time on the calendar, and it publishes to your site and social channels (X, LinkedIn).',
    'hero.cta_primary': 'Join Early Access',
    'hero.cta_secondary': 'Watch Demo',
    'hero.beta_note': 'Beta — invite only',
    'pricing.title': 'Plans & Pricing',
    'pricing.subtitle': 'Start free, cancel anytime.',
    'pricing.monthly': 'Monthly',
    'pricing.annual': 'Annual',
    'pricing.save': 'save',
    'pricing.cta': 'Try 1 Article Free',
    'pricing.popular': 'MOST POPULAR',
    'pricing.articles_per_month': 'articles/mo',
    'pricing.sites': 'sites',
    'pricing.all_publish_targets': 'All publish targets',
    'pricing.markdown_only': 'Markdown ZIP only',
    'pricing.security_note': '💳 PayTR secure payment · ✅ Cancel anytime · 🇹🇷 VAT included',
    'dashboard.title': 'Dashboard',
    'dashboard.new_site': '+ New Site',
    'dashboard.sites': 'My Sites',
    'dashboard.empty': 'No sites yet.',
    'dashboard.add_first': 'Add your first site →',
    'common.loading': 'Loading…',
    'common.error': 'An error occurred',
    'common.cancel': 'Cancel',
    'common.save': 'Save',
    'common.continue': 'Continue',
    'common.back': 'Back',
    'common.finish': 'Finish',
  },
} as const;

type Key = keyof typeof dictionary['tr'];

const LOCALE_KEY = 'luviai_locale';
const LOCALE_EVENT = 'luviai:locale-change';

function readLocale(): Locale {
  if (typeof window === 'undefined') return 'tr';
  const saved = window.localStorage.getItem(LOCALE_KEY);
  if (saved === 'en' || saved === 'tr') return saved;
  return navigator.language.startsWith('tr') ? 'tr' : 'en';
}

export function getLocale(): Locale {
  return readLocale();
}

export function setLocale(locale: Locale) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(LOCALE_KEY, locale);
  document.documentElement.lang = locale;
  // Hem custom event (ayni tab) hem storage event (diger taplar) tetiklenir
  window.dispatchEvent(new CustomEvent(LOCALE_EVENT, { detail: locale }));
}

function subscribe(callback: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(LOCALE_EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(LOCALE_EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

const getServerSnapshot = (): Locale => 'tr';

export function useT() {
  const locale = useSyncExternalStore<Locale>(subscribe, readLocale, getServerSnapshot);

  const t = (key: Key) => dictionary[locale][key] ?? key;

  return { t, locale, setLocale };
}
