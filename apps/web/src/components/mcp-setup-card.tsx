'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plug2, Copy, ChevronDown, Bot, ExternalLink, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { mcpScopeGuideText } from '@/lib/mcp-setup';

/**
 * RanksUp MCP kurulum karti — kullanici kendi AI istemcisinden (Claude Code,
 * Cursor, ozel baslik gonderebilen ajanlar) RanksUp verisini sorgular.
 *
 * Metin public/agent-setup.txt ile AYNI kalmali (kaynak orasi):
 *  - Sabit arac sayisi YAZILMAZ: liste tools/list ile gelir ve degisir (eski
 *    "26 tool" metni bayatlamisti).
 *  - ChatGPT ve claude.ai ozel baglayicilari BAGLANAMAZ: ikisi de OAuth ister
 *    (claude.ai'de baslikla kimlik dogrulama yalniz sinirli beta), RanksUp
 *    OAuth desteklemiyor. Eski kart "Claude & ChatGPT ustunde" diyordu.
 *    Kaynaklar (2026-10-18'de okundu): ChatGPT "cannot present custom API keys"
 *    https://developers.openai.com/apps-sdk/build/auth ; claude.ai "Request header
 *    authentication is in beta and available to a limited set of organizations"
 *    https://claude.com/docs/connectors/custom/remote-mcp
 *  - `claude mcp add` yalniz Claude Code komutu (Claude Desktop degil).
 *  - MCP sunucusu ve API anahtari Kurumsal planda (plans.ts mcpAccess / apiAccess).
 *  - Yetki cumlesi lib/mcp-setup.ts'ten: firsattan makale uretimi Site denetimi → Yazma,
 *    create_article Icerikler → Yazma ister (spec agent-setup.txt ve araclarin gercek
 *    scope'lariyla karsilastirir; eski metin makale uretimini yalniz makale yazmaya bagliyordu).
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'https://api.ranksup.ai';
const MCP_URL = `${API_BASE.replace(/\/$/, '')}/api/mcp`;
const SETUP_GUIDE_URL = 'https://ranksup.ai/agent-setup.txt';

export function McpSetupCard() {
  const [open, setOpen] = useState(false);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success('Kopyalandı'),
      () => toast.error('Kopyalanamadı'),
    );
  };

  // agent-setup.txt "2. Claude Code" ile ayni bicim; sira --transport http <ad> <url> --header
  // (https://code.claude.com/docs/en/mcp, 2026-10-18'de okundu)
  const claudeCmd = `claude mcp add --transport http ranksup ${MCP_URL} --header "Authorization: Bearer luvi_ANAHTARIN"`;

  return (
    <Card>
      <CardContent className="space-y-4 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-border text-muted-foreground">
              <Plug2 className="h-[18px] w-[18px]" aria-hidden />
            </div>
            <div className="min-w-0">
              <div className="text-panel-3">RanksUp MCP sunucusu</div>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                Claude Code, Cursor ya da özel başlık gönderebilen kendi ajanından RanksUp verini sorgula: siteler, denetim, GEO skor kartı,
                AI görünürlük ölçümleri, içerik fırsatları, aksiyon planı ve ASO. API anahtarıyla bağlanır; Kurumsal planda açıktır.
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            Kurulum <ChevronDown className={cn('h-3.5 w-3.5 ml-1 transition-transform', open && 'rotate-180')} />
          </Button>
        </div>

        {open && (
          <div className="space-y-4 border-t pt-4 text-sm">
            <div>
              <div className="mb-1 font-medium">1. API anahtarı oluştur</div>
              <p className="text-muted-foreground">
                <Link href="/api-keys" className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">API Anahtarları</Link> sayfasından yeni bir anahtar üret (<code className="font-mono">luvi_…</code>).
                Varsayılan anahtar yalnızca okur. {mcpScopeGuideText()} Anahtarın yetkileri sonradan değiştirilemez.
              </p>
            </div>
            <div>
              <div className="mb-1 flex items-center gap-1.5 font-medium"><Bot className="h-3.5 w-3.5 text-muted-foreground" aria-hidden /> 2. Claude Code</div>
              <div className="flex items-start gap-2 break-all rounded-md bg-muted p-2.5 font-mono text-xs">
                <span className="flex-1">{claudeCmd}</span>
                <button type="button" onClick={() => copy(claudeCmd)} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label="Komutu kopyala">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-muted-foreground mt-1">Kontrol: terminalde <code className="font-mono">claude mcp list</code>, Claude Code içinde <code className="font-mono">/mcp</code>.</p>
            </div>
            <div>
              <div className="mb-1 font-medium">3. Cursor ve özel başlık gönderebilen diğer istemciler</div>
              <p className="text-muted-foreground">
                Sunucu türü: Streamable HTTP · URL: <code className="font-mono">{MCP_URL}</code> ·
                Başlık: <code className="font-mono">Authorization: Bearer luvi_…</code>
              </p>
            </div>
            <div className="flex items-start gap-2 rounded-md border p-3 text-muted-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <p>
                ChatGPT ve claude.ai özel bağlayıcıları şimdilik bağlanamaz: ikisi de OAuth istiyor, RanksUp henüz OAuth desteklemiyor
                (claude.ai’de başlıkla kimlik doğrulama yalnız sınırlı bir betada açık).
              </p>
            </div>
            <div>
              <div className="mb-1 font-medium">4. Dene</div>
              <p className="text-muted-foreground">
                &quot;RanksUp&apos;taki sitelerimi listele; GEO skoru en düşük olanın aksiyon planını özetle.&quot;
              </p>
            </div>
            <p>
              <a href={SETUP_GUIDE_URL} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
                Tam kurulum rehberi (Cursor yapılandırması, sorun giderme) <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            </p>
            <div className="border-t pt-4">
              <div className="mb-1 font-medium">Bonus: Looker Studio / BI bağlantısı (ajanslar için)</div>
              <p className="text-muted-foreground">
                Aynı API anahtarıyla düz-tablo veri uçları: <code className="font-mono">{API_BASE.replace(/\/$/, '')}/api/looker/mention-rate?site_id=…</code>,{' '}
                <code className="font-mono">/api/looker/citations</code>, <code className="font-mono">/api/looker/prompts</code>,{' '}
                <code className="font-mono">/api/looker/crawler-hits</code>. Müşteri dashboard&apos;larını RanksUp verisiyle kur.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
