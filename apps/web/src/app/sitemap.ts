import type { MetadataRoute } from 'next';

const SITE_URL = 'https://ai.luvihost.com';

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  // Statik public marketing sayfaları
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`,            lastModified: now, changeFrequency: 'weekly',  priority: 1.0 },
    { url: `${SITE_URL}/pricing`,     lastModified: now, changeFrequency: 'weekly',  priority: 0.9 },
    { url: `${SITE_URL}/faq`,         lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE_URL}/use-cases`,   lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE_URL}/compare`,     lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE_URL}/about`,       lastModified: now, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${SITE_URL}/help`,        lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    // Help center alt sayfaları — SEO + AI cite için kritik (her biri detaylı modül rehberi)
    { url: `${SITE_URL}/help/getting-started`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/help/ai-visibility`,   lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/help/aso`,             lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/help/asa-asc`,         lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/help/studio`,          lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/help/auto-pilot`,      lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/help/api-keys`,        lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/help/social`,          lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/help/billing`,         lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${SITE_URL}/privacy`,     lastModified: now, changeFrequency: 'yearly',  priority: 0.3 },
    { url: `${SITE_URL}/terms`,       lastModified: now, changeFrequency: 'yearly',  priority: 0.3 },
    { url: `${SITE_URL}/kvkk`,        lastModified: now, changeFrequency: 'yearly',  priority: 0.3 },
    { url: `${SITE_URL}/status`,      lastModified: now, changeFrequency: 'daily',   priority: 0.4 },
  ];

  return staticPages;
}
