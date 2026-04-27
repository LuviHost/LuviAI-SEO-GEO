'use client';

import { useEffect, useState } from 'react';

export type Locale = 'tr' | 'en';

// Tek source-of-truth: dictionary
const dictionary = {
  tr: {
    'nav.home': 'Ana Sayfa',
    'nav.pricing': 'Fiyatlar',
    'nav.dashboard': 'Panel',
    'nav.login': 'Giriş Yap',
    'nav.signup': 'Erken Erişim',
    'hero.title': 'LuviAI',
    'hero.subtitle': "Sitenin URL'ini ver, GSC bağla, AI haftalık 5–50 makale üretip yayınlasın.",
    'hero.cta_primary': 'Erken Erişime Katıl',
    'hero.cta_secondary': 'Fiyatlar',
    'hero.beta_note': 'Beta — şu anda davet üzeri kayıt',
    'pricing.title': 'Plan Seçenekleri',
    'pricing.subtitle': 'Ücretsiz başla, dilediğin zaman iptal et.',
    'pricing.monthly': 'Aylık',
    'pricing.annual': 'Yıllık',
    'pricing.save': 'kazan',
    'pricing.cta': '14 Gün Ücretsiz Başla',
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
    'hero.title': 'LuviAI',
    'hero.subtitle': 'Connect your site URL, link GSC, let AI publish 5–50 articles weekly.',
    'hero.cta_primary': 'Join Early Access',
    'hero.cta_secondary': 'Pricing',
    'hero.beta_note': 'Beta — invite only',
    'pricing.title': 'Plans & Pricing',
    'pricing.subtitle': 'Start free, cancel anytime.',
    'pricing.monthly': 'Monthly',
    'pricing.annual': 'Annual',
    'pricing.save': 'save',
    'pricing.cta': 'Start 14-Day Free Trial',
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

export function getLocale(): Locale {
  if (typeof window === 'undefined') return 'tr';
  const saved = localStorage.getItem(LOCALE_KEY);
  if (saved === 'en' || saved === 'tr') return saved;
  // Browser dilinden tahmin
  return navigator.language.startsWith('tr') ? 'tr' : 'en';
}

export function setLocale(locale: Locale) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LOCALE_KEY, locale);
  document.documentElement.lang = locale;
}

export function useT() {
  const [locale, setLoc] = useState<Locale>('tr');
  useEffect(() => setLoc(getLocale()), []);

  const t = (key: Key) => dictionary[locale][key] ?? key;
  const change = (l: Locale) => {
    setLocale(l);
    setLoc(l);
  };

  return { t, locale, setLocale: change };
}
