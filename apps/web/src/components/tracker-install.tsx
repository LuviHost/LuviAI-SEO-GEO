'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
    icon: '📝',
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
    icon: '🌊',
    steps: [
      'Webflow Designer → Project Settings (sol-alt çark ikon)',
      'Custom Code → Head Code (Inside &lt;head&gt; tag)',
      'Aşağıdaki kodu yapıştır → Save',
      'Yayınla (Publish) — değişiklikler birkaç dakika içinde canlıda',
    ],
  },
  {
    id: 'shopify',
    name: 'Shopify',
    icon: '🛍️',
    steps: [
      'Shopify Admin → Online Store → Themes',
      'Active theme > Actions > Edit code',
      'Layout > theme.liquid dosyasını aç',
      '&lt;/head&gt; etiketinden HEMEN ÖNCE aşağıdaki kodu yapıştır → Save',
    ],
  },
  {
    id: 'static',
    name: 'Static HTML / Custom',
    icon: '📄',
    steps: [
      'index.html (veya tüm sayfalar) dosyalarını aç',
      'Her sayfanın &lt;head&gt; bölümüne aşağıdaki kodu yapıştır',
      'Tek seferlik bir include kullanıyorsan (header.html / partial), sadece oraya yapıştır',
      'FTP/SFTP ile sunucuya yükle, browser cache temizle (Ctrl+F5)',
    ],
  },
  {
    id: 'ghost-medium',
    name: 'Ghost / Medium / Substack',
    icon: '👻',
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
    ? `https://ai.luvihost.com`
    : 'https://ai.luvihost.com';

  const snippet = `<script async src="${apiBase}/api/tracker.js?site=${siteId}"></script>`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      toast.success('Snippet kopyalandı');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Kopyalama başarısız — manuel seç-kopyala dene');
    }
  };

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-violet-500/10 text-violet-600 dark:text-violet-400 grid place-items-center shrink-0">
            <Bot className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-base">AI Crawler Tracker — Sitene Yapıştır</h3>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
              Sitenin <code className="bg-muted/50 px-1 py-0.5 rounded text-[10px]">&lt;head&gt;</code> kısmına aşağıdaki tek satır kodu yapıştır.
              GPTBot, ClaudeBot, PerplexityBot gibi AI bot ziyaretleri ile chatgpt.com / perplexity.ai gibi
              AI referrer'lardan gelen kullanıcılar **otomatik kaydedilir**.
            </p>
          </div>
        </div>

        {/* Snippet box */}
        <div className="rounded-xl border-2 border-violet-500/30 bg-violet-500/[0.04] p-3">
          <div className="flex items-center gap-2 mb-2">
            <Code className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />
            <span className="text-[10px] font-bold uppercase tracking-widest text-violet-600 dark:text-violet-400">
              Bu site için özel snippet
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
          <p className="text-[10px] text-muted-foreground mt-2 leading-relaxed">
            ⚡ Async yüklenir, sayfanın hızını etkilemez (~2 KB).
            🔒 Sadece AI bot/referrer tespit edilince beacon atar.
            🌐 GDPR/KVKK uyumlu (kişisel veri toplamaz, sadece UA + URL kaydeder).
          </p>
        </div>

        {/* Verification hint */}
        {siteUrl && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex items-start gap-2">
            <Globe className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1 text-xs">
              <strong className="text-amber-700 dark:text-amber-400">Doğrulama:</strong>{' '}
              <span className="text-foreground/80">
                Snippet'i yapıştırdıktan sonra{' '}
                <a
                  href={siteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline decoration-dotted hover:text-brand inline-flex items-center gap-0.5"
                >
                  {siteUrl.replace(/^https?:\/\//, '')}<ExternalLink className="h-3 w-3" />
                </a>{' '}
                aç, sayfa kaynağında snippet olduğunu kontrol et. İlk AI bot ziyareti 1-7 gün içinde gelir
                (Genel Bakış'ta görünür).
              </span>
            </div>
          </div>
        )}

        {/* Platform talimatları (accordion) */}
        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
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
                    <span className="text-xl">{p.icon}</span>
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
