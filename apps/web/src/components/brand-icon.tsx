'use client';

import { Globe, Lock, Wrench, Package, FileCode2, Webhook } from 'lucide-react';

/**
 * BrandIcon — yayın hedefi platformları için marka SVG'si.
 * Kaynak: Simple Icons CDN (CC0). API anahtarı yok, public CDN.
 * Brand'in resmî logosu yoksa lucide-react fallback'i.
 *
 * Güven uyandırması için: emoji yerine gerçek brand renk + logo.
 */

interface BrandConfig {
  /** Simple Icons CDN slug + hex renk (slug.color) — örn 'wordpress/21759b' */
  cdnSlug?: string;
  /** Lucide ikon (CDN'de yoksa veya generic teknolojiyse) */
  lucide?: any;
  /** Lucide kullanılırken renk */
  color?: string;
}

// Backend `type` slug'larıyla uyumlu — apps/api/src/publish-targets/publish-targets.service.ts
const BRAND_MAP: Record<string, BrandConfig> = {
  WORDPRESS_REST:   { cdnSlug: 'wordpress/21759b' },
  WORDPRESS_XMLRPC: { cdnSlug: 'wordpress/21759b' },
  FTP:              { lucide: Globe, color: '#3b82f6' },
  SFTP:             { lucide: Lock, color: '#10b981' },
  GITHUB:           { cdnSlug: 'github/181717' },
  CPANEL_API:       { cdnSlug: 'cpanel/ff6c2c' },
  WEBFLOW:          { cdnSlug: 'webflow/146ef5' },
  SANITY:           { cdnSlug: 'sanity/f03e2f' },
  CONTENTFUL:       { cdnSlug: 'contentful/2478cc' },
  GHOST:            { cdnSlug: 'ghost/15171a' },
  STRAPI:           { cdnSlug: 'strapi/4945ff' },
  WHMCS_KB:         { lucide: Wrench, color: '#0073d4' },
  CUSTOM_PHP:       { cdnSlug: 'php/777bb4' },
  MARKDOWN_ZIP:     { cdnSlug: 'markdown/000000' },
  WEBHOOK:          { lucide: Webhook, color: '#8b5cf6' },
};

export function BrandIcon({
  type,
  fallback,
  className = 'h-7 w-7',
}: {
  type: string;
  fallback?: string;
  className?: string;
}) {
  const cfg = BRAND_MAP[type?.toUpperCase()];

  if (cfg?.cdnSlug) {
    return (
      <img
        src={`https://cdn.simpleicons.org/${cfg.cdnSlug}`}
        alt={type}
        className={className}
        loading="lazy"
        onError={(e) => {
          // CDN ulaşılamazsa fallback emoji'i göster
          const img = e.currentTarget;
          img.style.display = 'none';
          const span = document.createElement('span');
          span.textContent = fallback ?? '📤';
          span.className = 'text-2xl';
          img.parentElement?.appendChild(span);
        }}
      />
    );
  }

  if (cfg?.lucide) {
    const Icon = cfg.lucide;
    return <Icon className={className} style={{ color: cfg.color }} />;
  }

  // Hiçbiri match etmezse fallback emoji
  return <span className="text-2xl">{fallback ?? '📤'}</span>;
}
