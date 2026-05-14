/**
 * Site niş (sektör) seçenekleri — onboarding ve site settings'te paylaşılır.
 *
 * AI Citation servisi nişi sorgu üretirken kullanır (brain'in seoStrategy
 * alanları boşsa fallback). 'diğer' seçilirse sorgular çok generic olur,
 * mümkünse spesifik seçenek tercih edilmeli.
 */
export const NICHES = [
  'web hosting',
  'e-ticaret',
  'SaaS',
  'eğitim',
  'sağlık',
  'finans',
  'gayrimenkul',
  'turizm',
  'restoran',
  'ajans',
  'haber/medya',
  'otomotiv',
  'inşaat',
  'spor/fitness',
  'moda/giyim',
  'teknoloji/yazılım',
  'hukuk',
  'danışmanlık',
  'üretim/sanayi',
  'diğer',
] as const;

export type Niche = (typeof NICHES)[number];

/** Free-text dahil — kullanıcı kendi yazsa bile geçerli */
export type NicheValue = Niche | string;
