'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { VendorLogo } from '@/components/vendor-logo';
import { cn } from '@/lib/utils';
import {
  Bot,
  Copy,
  Check,
  Globe,
  Code,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileCode,
} from 'lucide-react';

/**
 * TrackerInstall — site sahibine snippet'i kopyalat + 5 platform için talimat.
 *
 * Snippet'i HTML <head>'e yapıştırınca:
 *   - chatgpt.com, perplexity.ai, claude.ai gibi AI referrer'lardan gelen kullanıcılar tespit edilir
 *   - betik dosyasını İNDİREN AI botları kaydedilir (botlar JavaScript çalıştırmaz: sayı eksik çıkar;
 *     eksiksiz akış Canlı Tarayıcı'da — crawler-tracking.middleware.ts, live-crawler.service.ts)
 *
 * Kart ve sonuçları (AI Crawler Trafiği, AI'dan gelen ziyaretçiler) Bot Takibi sayfasında durur
 * (sites/[id]/bot-takibi; 13.11.2026'da Bağlantılar'dan taşındı).
 */

const PLATFORMS = [
  {
    id: 'wordpress',
    name: 'WordPress',
    logo: 'wordpress' as const,
    steps: [
      'WP-Admin → Plugins → Add New → "Insert Headers and Footers" plugin\'ini yükle (veya WPCode, Header Footer Code Manager)',
      'Plugin > Settings > "Scripts in Header" alanına aşağıdaki kodu yapıştır',
      'Save → site cache temizle (cache plugin varsa)',
      'Veya: Yoast SEO Pro varsa SEO > Tools > Headers > Custom HTML',
    ],
  },
  {
    id: 'webflow',
    name: 'Webflow',
    logo: 'webflow' as const,
    steps: [
      'Webflow Designer → Project Settings (sol-alt çark ikon)',
      'Custom Code → Head Code (<head> içi)',
      'Aşağıdaki kodu yapıştır → Save',
      'Yayınla (Publish) — değişiklikler birkaç dakika içinde canlıda',
    ],
  },
  {
    id: 'shopify',
    name: 'Shopify',
    logo: 'shopify' as const,
    steps: [
      'Shopify Admin → Online Store → Themes',
      'Active theme > Actions > Edit code',
      'Layout > theme.liquid dosyasını aç',
      '</head> etiketinden hemen önce aşağıdaki kodu yapıştır → Save',
    ],
  },
  {
    id: 'static',
    name: 'Statik HTML / özel site',
    logo: null,
    steps: [
      'index.html (veya tüm sayfalar) dosyalarını aç',
      'Her sayfanın <head> bölümüne aşağıdaki kodu yapıştır',
      'Tek seferlik bir include kullanıyorsan (header.html / partial), sadece oraya yapıştır',
      'FTP/SFTP ile sunucuya yükle, browser cache temizle (Ctrl+F5)',
    ],
  },
  {
    id: 'ghost-medium',
    name: 'Ghost / Medium / Substack',
    logo: 'ghost' as const,
    steps: [
      'Ghost: Settings > Code Injection > Site Header → kodu yapıştır → Save',
      'Medium/Substack: kendi domain (custom domain) ile yayın yapıyorsan DNS\'e CNAME üzerinden değil, sadece custom HTML embed destekliyorsa kullanılabilir',
      'Hashnode: Site Settings > Custom CSS & JS > Header HTML',
      'Bağımsız blog motorları (Hugo, Jekyll, Astro): tema layout/_default/baseof.html veya benzeri header dosyası',
    ],
  },
];

export function TrackerInstall({ siteId, siteUrl }: { siteId: string; siteUrl?: string }) {
  const [copied, setCopied] = useState(false);
  const [expandedPlatform, setExpandedPlatform] = useState<string | null>('wordpress');

  const apiBase = (typeof window !== 'undefined' && window.location.origin.startsWith('http'))
    ? `https://ranksup.ai`
    : 'https://ranksup.ai';

  const snippet = `<script async src="${apiBase}/api/tracker.js?site=${siteId}"></script>`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      toast.success('Kod kopyalandı');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Kopyalanamadı — kodu elle seçip kopyala');
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border text-muted-foreground">
            <Bot className="h-[18px] w-[18px]" aria-hidden />
          </div>
          <div className="flex-1">
            <h3 className="text-panel-3">AI bot takibi</h3>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Sitenin <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">&lt;head&gt;</code> bölümüne aşağıdaki tek satırı yapıştır.
              chatgpt.com, perplexity.ai gibi AI asistanlarından gelen ziyaretçiler kaydedilir. AI botları JavaScript
              çalıştırmadığı için yalnız kod dosyasını indiren botlar görünür; bot sayıları eksik çıkar.
            </p>
          </div>
        </div>

        {/* Snippet box */}
        <div className="rounded-md border p-3">
          <div className="flex items-center gap-2 mb-2">
            <Code className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <span className="v-rail">
              Bu siteye özel kod
            </span>
            <span className="v-rail ml-auto">site={siteId.slice(0, 12)}…</span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
            <pre className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md bg-muted px-3 py-2.5 font-mono text-xs">
              {snippet}
            </pre>
            <Button onClick={copy} size="default" variant="outline" className="shrink-0">
              {copied ? <><Check className="h-4 w-4 mr-1" /> Kopyalandı</> : <><Copy className="h-4 w-4 mr-1" /> Kopyala</>}
            </Button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Kod asenkron yüklenir, sayfa hızını etkilemez. Yalnız bir AI botu ya da AI asistanından gelen ziyaretçi
            tespit edildiğinde kayıt gönderir; kişisel veri toplamaz, yalnız tarayıcı bilgisi ve sayfa adresi kaydedilir.
          </p>
        </div>

        {/* Verification hint */}
        {siteUrl && (
          <div className="flex items-start gap-2 rounded-md border p-3">
            <Globe className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" aria-hidden />
            <div className="flex-1 text-sm">
              <strong className="font-medium">Kurulumu doğrula:</strong>{' '}
              <span className="text-muted-foreground">
                Kodu yapıştırdıktan sonra{' '}
                <a
                  href={siteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                >
                  {siteUrl.replace(/^https?:\/\//, '')}<ExternalLink className="h-3 w-3" />
                </a>{' '}
                adresini aç ve sayfa kaynağında kodu ara. Kayıtlar bu sayfadaki AI Crawler Trafiği ve
                AI’dan gelen ziyaretçiler bölümlerinde görünür.
              </span>
            </div>
          </div>
        )}

        {/* Platform talimatları (accordion) */}
        <div className="space-y-2">
          <p className="v-rail">
            Platforma göre kurulum rehberi
          </p>
          <div className="divide-y overflow-hidden rounded-md border">
            {PLATFORMS.map((p) => {
              const expanded = expandedPlatform === p.id;
              return (
                <div key={p.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedPlatform(expanded ? null : p.id)}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-muted/50',
                      expanded && 'bg-muted/50',
                    )}
                  >
                    {p.logo ? <VendorLogo name={p.logo} size={20} alt="" /> : <FileCode className="h-5 w-5 text-muted-foreground" aria-hidden />}
                    <span className="flex-1 text-sm font-medium">{p.name}</span>
                    {expanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                  {expanded && (
                    <div className="px-4 py-3">
                      <ol className="space-y-2 text-sm">
                        {p.steps.map((step, i) => (
                          <li key={i} className="flex gap-2.5">
                            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded border font-mono text-xs text-muted-foreground">
                              {i + 1}
                            </span>
                            <span
                              className="leading-relaxed text-foreground/85"
                              dangerouslySetInnerHTML={{ __html: step }}
                            />
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
