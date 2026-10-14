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
 *   - GPTBot, ClaudeBot, PerplexityBot vb. AI crawler ziyaretleri yakalanır
 *   - chatgpt.com, perplexity.ai, claude.ai gibi AI referrer'lardan gelen kullanıcılar tespit edilir
 *
 * Tracking sonuçları Genel Bakış'taki "AI Crawler Trafiği" panelinde görünür.
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
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl border bg-muted/50 text-foreground/70 grid place-items-center shrink-0">
            <Bot className="h-5 w-5" aria-hidden />
          </div>
          <div className="flex-1">
            <h3 className="font-brand font-semibold text-base">AI bot takibi</h3>
            <p className="text-sm text-muted-foreground mt-0.5 max-w-2xl">
              Sitenin <code className="bg-muted/60 px-1 py-0.5 rounded text-label">&lt;head&gt;</code> bölümüne aşağıdaki tek satırı yapıştır.
              GPTBot, ClaudeBot, PerplexityBot gibi AI botlarının ziyaretleri ve chatgpt.com, perplexity.ai gibi
              AI asistanlarından gelen ziyaretçiler otomatik kaydedilir.
            </p>
          </div>
        </div>

        {/* Snippet box */}
        <div className="rounded-xl border bg-muted/30 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Code className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <span className="text-label font-medium text-muted-foreground">
              Bu siteye özel kod
            </span>
            <span className="text-[10px] font-mono text-muted-foreground ml-auto">site={siteId.slice(0, 12)}…</span>
          </div>
          <div className="flex items-stretch gap-2">
            <pre className="flex-1 bg-card border rounded-lg px-3 py-2.5 text-[11px] font-mono overflow-x-auto whitespace-nowrap">
              {snippet}
            </pre>
            <Button onClick={copy} size="default" className="shrink-0">
              {copied ? <><Check className="h-4 w-4 mr-1" /> Kopyalandı</> : <><Copy className="h-4 w-4 mr-1" /> Kopyala</>}
            </Button>
          </div>
          <p className="text-label text-muted-foreground mt-2 leading-relaxed">
            Kod asenkron yüklenir, sayfa hızını etkilemez. Yalnız bir AI botu ya da AI asistanından gelen ziyaretçi
            tespit edildiğinde kayıt gönderir; kişisel veri toplamaz, yalnız tarayıcı bilgisi ve sayfa adresi kaydedilir.
          </p>
        </div>

        {/* Verification hint */}
        {siteUrl && (
          <div className="rounded-lg border p-3 flex items-start gap-2">
            <Globe className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" aria-hidden />
            <div className="flex-1 text-sm">
              <strong>Kurulumu doğrula:</strong>{' '}
              <span className="text-foreground/80">
                Kodu yapıştırdıktan sonra{' '}
                <a
                  href={siteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-dotted hover:text-brand inline-flex items-center gap-0.5"
                >
                  {siteUrl.replace(/^https?:\/\//, '')}<ExternalLink className="h-3 w-3" />
                </a>{' '}
                adresini aç ve sayfa kaynağında kodu ara. İlk AI bot ziyareti genelde 1–7 gün içinde gelir
                ve Genel Bakış'ta görünür.
              </span>
            </div>
          </div>
        )}

        {/* Platform talimatları (accordion) */}
        <div className="space-y-2">
          <p className="text-label font-medium text-muted-foreground">
            Platforma göre kurulum rehberi
          </p>
          <div className="rounded-lg border divide-y overflow-hidden">
            {PLATFORMS.map((p) => {
              const expanded = expandedPlatform === p.id;
              return (
                <div key={p.id}>
                  <button
                    type="button"
                    onClick={() => setExpandedPlatform(expanded ? null : p.id)}
                    className={cn(
                      'w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-muted/30 transition-colors',
                      expanded && 'bg-muted/30',
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
                    <div className="px-4 py-3 bg-card">
                      <ol className="space-y-2 text-sm">
                        {p.steps.map((step, i) => (
                          <li key={i} className="flex gap-2.5">
                            <span className="grid place-items-center h-5 w-5 rounded-full bg-brand text-white text-[10px] font-bold shrink-0 mt-0.5">
                              {i + 1}
                            </span>
                            <span
                              className="text-foreground/85 leading-relaxed"
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
