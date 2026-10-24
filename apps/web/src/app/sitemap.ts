import type { MetadataRoute } from 'next';
// Goreli import: page-updated.spec.mts bu dosyayi alias cozumlemesi olmadan calistirir
import { PUBLIC_PAGES, SITE_URL } from '../lib/page-updated';

/**
 * Statik public marketing sayfalari. lastModified sayfanin GERCEK son icerik
 * degisikligidir (lib/page-updated.ts — tek kaynak, nasil guncellenecegi orada).
 * Eskiden her URL `new Date()` aliyordu: sitemap her istekte "hepsi bugun degisti" diyordu.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGES.map((p) => ({
    url: `${SITE_URL}${p.path}`,
    lastModified: p.updated,
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));
}
