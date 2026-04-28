import { Injectable, Logger } from '@nestjs/common';

export interface PlatformDetection {
  platform: 'wordpress' | 'webflow' | 'wix' | 'ghost' | 'shopify' | 'squarespace' | 'cpanel-static' | 'next' | 'unknown';
  confidence: number; // 0..1
  hints: string[];
  suggestedAdapter: 'WORDPRESS_REST' | 'WEBFLOW' | 'GHOST' | 'CPANEL_API' | 'CUSTOM_PHP' | 'MARKDOWN_ZIP' | null;
}

/**
 * Site URL'inden platform tahmini yapar — kullanicinin manuel adapter
 * secimi yapmasini onlemek icin. Tahmin sonucu PublishTarget draft
 * olarak kullanicinin onune gelir, sadece API token girmesi yeterli olur.
 */
@Injectable()
export class PlatformDetectorService {
  private readonly log = new Logger(PlatformDetectorService.name);

  async detect(siteUrl: string): Promise<PlatformDetection> {
    const hints: string[] = [];
    let html = '';
    const headers: Record<string, string> = {};

    try {
      const res = await fetch(siteUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
      });
      html = (await res.text()).slice(0, 50000);
      res.headers.forEach((v, k) => (headers[k.toLowerCase()] = v));
    } catch (err: any) {
      this.log.warn(`Platform fetch fail (${siteUrl}): ${err.message}`);
      return { platform: 'unknown', confidence: 0, hints: [`fetch failed: ${err.message}`], suggestedAdapter: null };
    }

    // Header probe
    const server = (headers['server'] ?? '').toLowerCase();
    const xPoweredBy = (headers['x-powered-by'] ?? '').toLowerCase();
    if (xPoweredBy) hints.push(`x-powered-by: ${xPoweredBy}`);
    if (server) hints.push(`server: ${server}`);

    // Generator meta
    const generatorMatch = html.match(/<meta\s+name=["']generator["']\s+content=["']([^"']+)["']/i);
    const generator = generatorMatch?.[1]?.toLowerCase() ?? '';
    if (generator) hints.push(`generator: ${generator}`);

    // WordPress probe
    if (
      generator.includes('wordpress') ||
      html.includes('/wp-content/') ||
      html.includes('wp-emoji') ||
      headers['link']?.includes('wp.me') ||
      xPoweredBy.includes('wordpress')
    ) {
      // wp-json/wp/v2 endpoint test
      const restOk = await this.probe(`${this.normalize(siteUrl)}/wp-json/wp/v2/types`);
      hints.push(restOk ? 'wp-json/wp/v2 endpoint mevcut' : 'wp-json yok');
      return {
        platform: 'wordpress',
        confidence: restOk ? 0.95 : 0.7,
        hints,
        suggestedAdapter: 'WORDPRESS_REST',
      };
    }

    // Webflow
    if (generator.includes('webflow') || html.includes('webflow.com') || html.includes('w-mod-js')) {
      return { platform: 'webflow', confidence: 0.9, hints, suggestedAdapter: 'WEBFLOW' };
    }

    // Ghost
    if (generator.includes('ghost') || html.includes('ghost-foundation') || html.includes('/ghost/')) {
      return { platform: 'ghost', confidence: 0.9, hints, suggestedAdapter: 'GHOST' };
    }

    // Shopify
    if (xPoweredBy.includes('shopify') || html.includes('cdn.shopify.com') || html.includes('Shopify.theme')) {
      return { platform: 'shopify', confidence: 0.9, hints, suggestedAdapter: null };
    }

    // Wix
    if (html.includes('static.wixstatic.com') || html.includes('wix-code')) {
      return { platform: 'wix', confidence: 0.85, hints, suggestedAdapter: null };
    }

    // Squarespace
    if (generator.includes('squarespace') || html.includes('squarespace-cdn.com')) {
      return { platform: 'squarespace', confidence: 0.85, hints, suggestedAdapter: null };
    }

    // Next.js (custom static)
    if (html.includes('__NEXT_DATA__') || html.includes('/_next/static/')) {
      hints.push('Next.js detected');
      // cPanel ile servisleniyor olabilir — static-html-fixer + cPanel adapter onerilir
      return { platform: 'next', confidence: 0.7, hints, suggestedAdapter: 'CPANEL_API' };
    }

    // cPanel-style static (Apache + LuviHost gibi shared hosting)
    if (server.includes('apache') || server.includes('litespeed') || server.includes('nginx')) {
      hints.push(`static server: ${server} — cPanel API ile yayina alinabilir`);
      return { platform: 'cpanel-static', confidence: 0.5, hints, suggestedAdapter: 'CPANEL_API' };
    }

    return { platform: 'unknown', confidence: 0.1, hints, suggestedAdapter: 'MARKDOWN_ZIP' };
  }

  private async probe(url: string): Promise<boolean> {
    try {
      const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  private normalize(url: string): string {
    return url.replace(/\/+$/, '');
  }
}
