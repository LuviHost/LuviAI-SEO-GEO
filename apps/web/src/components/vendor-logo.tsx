import { cn } from '@/lib/utils';

/**
 * Marka logoları için tek tip API: `<VendorLogo name="anthropic" size={20} />`.
 *
 * SVG'ler `public/brands/` altında — developer-icons (MIT) repo'sundan
 * seçici alındı. Renkli marka logoları (lucide-react'taki tekil renkli UI
 * ikonlarının tersine). AI Citation, Integrations, platform tespit
 * rozetleri gibi yerlerde kullanılır.
 *
 * Mevcut `BrandIcon` farklı amaca hizmet ediyor (publish target enum +
 * Simple Icons CDN). VendorLogo local SVG ile çalışır, CDN bağımlılığı yok.
 *
 * Eksik logolar (developer-icons'da yok, başka kaynaktan eklenebilir):
 * perplexity, grok (xai), gemini, mistral, ghost, webflow, shopify
 */
export type VendorName =
  // AI providers (8)
  | 'anthropic' | 'claude-ai' | 'chatgpt' | 'openai' | 'deepseek'
  | 'perplexity' | 'grok' | 'gemini' | 'mistral'
  // Search engines (2)
  | 'google' | 'bing'
  // Tech stack (8)
  | 'nextjs' | 'tailwindcss' | 'shadcnui' | 'nestjs' | 'prisma' | 'mysql'
  | 'vercel-dark' | 'vercel-light'
  // CMS / Platforms (5)
  | 'wordpress' | 'cloudflare' | 'webflow' | 'shopify' | 'ghost'
  // Social (9)
  | 'linkedin' | 'twitter' | 'facebook' | 'instagram' | 'tiktok'
  | 'youtube' | 'pinterest' | 'threads' | 'bluesky';

const VENDOR_TO_FILE: Record<VendorName, string> = {
  'anthropic':   '/brands/anthropic.svg',
  'claude-ai':   '/brands/claude-ai.svg',
  'chatgpt':     '/brands/chatgpt.svg',
  'openai':      '/brands/openai.svg',
  'deepseek':    '/brands/deepseek.svg',
  'perplexity':  '/brands/perplexity.svg',
  'grok':        '/brands/grok.svg',
  'gemini':      '/brands/gemini.svg',
  'mistral':     '/brands/mistral.svg',
  'google':      '/brands/google.svg',
  'bing':        '/brands/bing.svg',
  'nextjs':      '/brands/nextjs.svg',
  'tailwindcss': '/brands/tailwindcss.svg',
  'shadcnui':    '/brands/shadcnui.svg',
  'nestjs':      '/brands/nestjs.svg',
  'prisma':      '/brands/prisma.svg',
  'mysql':       '/brands/mysql.svg',
  'vercel-dark': '/brands/vercel-dark.svg',
  'vercel-light':'/brands/vercel-light.svg',
  'wordpress':   '/brands/wordpress.svg',
  'cloudflare':  '/brands/cloudflare.svg',
  'webflow':     '/brands/webflow.svg',
  'shopify':     '/brands/shopify.svg',
  'ghost':       '/brands/ghost.svg',
  'linkedin':    '/brands/linkedin.svg',
  'twitter':     '/brands/twitter.svg',
  'facebook':    '/brands/facebook.svg',
  'instagram':   '/brands/instagram.svg',
  'tiktok':      '/brands/tiktok.svg',
  'youtube':     '/brands/youtube.svg',
  'pinterest':   '/brands/pinterest.svg',
  'threads':     '/brands/threads-light.svg',
  'bluesky':     '/brands/bluesky.svg',
};

/** Marka logosunun açıkça gösterilen adı (insan-okunabilir) */
export const VENDOR_LABEL: Record<VendorName, string> = {
  'anthropic':   'Anthropic',
  'claude-ai':   'Claude',
  'chatgpt':     'ChatGPT',
  'openai':      'OpenAI',
  'deepseek':    'DeepSeek',
  'perplexity':  'Perplexity',
  'grok':        'xAI Grok',
  'gemini':      'Gemini',
  'mistral':     'Mistral AI',
  'google':      'Google',
  'bing':        'Bing',
  'nextjs':      'Next.js',
  'tailwindcss': 'Tailwind CSS',
  'shadcnui':    'shadcn/ui',
  'nestjs':      'NestJS',
  'prisma':      'Prisma',
  'mysql':       'MySQL',
  'vercel-dark': 'Vercel',
  'vercel-light':'Vercel',
  'wordpress':   'WordPress',
  'cloudflare':  'Cloudflare',
  'webflow':     'Webflow',
  'shopify':     'Shopify',
  'ghost':       'Ghost',
  'linkedin':    'LinkedIn',
  'twitter':     'X (Twitter)',
  'facebook':    'Facebook',
  'instagram':   'Instagram',
  'tiktok':      'TikTok',
  'youtube':     'YouTube',
  'pinterest':   'Pinterest',
  'threads':     'Threads',
  'bluesky':     'Bluesky',
};

interface VendorLogoProps {
  name: VendorName;
  size?: number;       // px (kare)
  className?: string;
  alt?: string;        // a11y; default VENDOR_LABEL
}

export function VendorLogo({ name, size = 20, className, alt }: VendorLogoProps) {
  const src = VENDOR_TO_FILE[name];
  return (
    <img
      src={src}
      alt={alt ?? VENDOR_LABEL[name]}
      width={size}
      height={size}
      className={cn('inline-block object-contain shrink-0', className)}
      loading="lazy"
      decoding="async"
    />
  );
}
