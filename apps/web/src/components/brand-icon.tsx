'use client';

import { useState } from 'react';
import { Globe, Lock, Wrench, Webhook, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * BrandIcon — yayın hedefi platformları için marka SVG'si.
 * Kaynak: Simple Icons CDN (CC0). API anahtarı yok, public CDN.
 * Brand'in resmî logosu yoksa lucide-react fallback'i.
 *
 * Güven uyandırması için: emoji yerine gerçek brand renk + logo.
 *
 * 12.11.2026 (vitrin dili): logo kucuk BEYAZ karo ustunde durur — GitHub, Ghost ve
 * Markdown logolari siyah; koyu temada kart zemininde kayboluyordu. Markasi olmayan
 * genel teknolojiler (FTP, SFTP, webhook) notr lucide ikonu alir (sus rengi yok);
 * CDN'e ulasilamazsa ya da tip bilinmiyorsa emoji yerine notr ikon gosterilir.
 */

interface BrandConfig {
  /** Simple Icons CDN slug + hex renk (slug.color) — örn 'wordpress/21759b' */
  cdnSlug?: string;
  /** Lucide ikon (CDN'de yoksa veya generic teknolojiyse) */
  lucide?: any;
}

// Backend `type` slug'larıyla uyumlu — apps/api/src/publish-targets/publish-targets.service.ts
const BRAND_MAP: Record<string, BrandConfig> = {
  WORDPRESS_REST:   { cdnSlug: 'wordpress/21759b' },
  WORDPRESS_XMLRPC: { cdnSlug: 'wordpress/21759b' },
  FTP:              { lucide: Globe },
  SFTP:             { lucide: Lock },
  GITHUB:           { cdnSlug: 'github/181717' },
  CPANEL_API:       { cdnSlug: 'cpanel/ff6c2c' },
  WEBFLOW:          { cdnSlug: 'webflow/146ef5' },
  SANITY:           { cdnSlug: 'sanity/f03e2f' },
  CONTENTFUL:       { cdnSlug: 'contentful/2478cc' },
  GHOST:            { cdnSlug: 'ghost/15171a' },
  STRAPI:           { cdnSlug: 'strapi/4945ff' },
  WHMCS_KB:         { lucide: Wrench },
  CUSTOM_PHP:       { cdnSlug: 'php/777bb4' },
  MARKDOWN_ZIP:     { cdnSlug: 'markdown/000000' },
  WEBHOOK:          { lucide: Webhook },
};

export function BrandIcon({
  type,
  // API katalogunun emoji ikonu; artik cizilmiyor (imza cagiranlar icin korunur)
  fallback: _fallback,
  className = 'h-7 w-7',
}: {
  type: string;
  fallback?: string;
  className?: string;
}) {
  const cfg = BRAND_MAP[type?.toUpperCase()];
  const [failed, setFailed] = useState(false);

  if (cfg?.cdnSlug && !failed) {
    return (
      <img
        src={`https://cdn.simpleicons.org/${cfg.cdnSlug}`}
        alt={type}
        // Beyaz karo: marka logosu iki temada da ayni zeminde (sozlesme 7'nin logo istisnasi)
        className={cn('rounded bg-white object-contain p-[3px]', className)}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }

  const Icon = cfg?.lucide ?? Upload;
  return (
    <span className={cn('grid shrink-0 place-items-center rounded border text-muted-foreground', className)} aria-hidden>
      <Icon className="h-[60%] w-[60%]" />
    </span>
  );
}
