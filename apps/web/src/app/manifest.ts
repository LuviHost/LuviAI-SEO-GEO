import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'LuviAI — SEO + İçerik + Sosyal Medya Otomasyonu',
    short_name: 'LuviAI',
    description: 'Site denetimi, AI içerik üretimi, sosyal medya planlama ve reklam denetimi tek panelden.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0c0a14',
    theme_color: '#7c3aed',
    orientation: 'portrait',
    lang: 'tr',
    categories: ['business', 'productivity', 'marketing'],
    icons: [
      { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
