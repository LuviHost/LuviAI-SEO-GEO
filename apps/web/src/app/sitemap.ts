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
    { url: `${SITE_URL}/privacy`,     lastModified: now, changeFrequency: 'yearly',  priority: 0.3 },
    { url: `${SITE_URL}/terms`,       lastModified: now, changeFrequency: 'yearly',  priority: 0.3 },
    { url: `${SITE_URL}/kvkk`,        lastModified: now, changeFrequency: 'yearly',  priority: 0.3 },
    { url: `${SITE_URL}/status`,      lastModified: now, changeFrequency: 'daily',   priority: 0.4 },
  ];

  return staticPages;
}
