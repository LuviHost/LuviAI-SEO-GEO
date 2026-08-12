'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plug2, Copy, ChevronDown, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * RanksUp MCP kurulum kartı — "Claude & ChatGPT üstünde RanksUp".
 * Kullanıcı kendi AI istemcisinden RanksUp verisini sorgular:
 * görünürlük raporları, rakip kıyasları, aksiyonlar, prompt'lar, ASO. 24 tool.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'https://api.ranksup.ai';
const MCP_URL = `${API_BASE.replace(/\/$/, '')}/api/mcp`;

export function McpSetupCard() {
  const [open, setOpen] = useState(false);

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success('Kopyalandı'),
      () => toast.error('Kopyalanamadı'),
    );
  };

  const claudeCmd = `claude mcp add ranksup ${MCP_URL} --transport http --header "Authorization: Bearer luvi_API_ANAHTARIN"`;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 grid place-items-center">
              <Plug2 className="h-4.5 w-4.5" />
            </div>
            <div>
              <div className="text-sm font-semibold flex items-center gap-2">
                RanksUp — Claude & ChatGPT üstünde
                <Badge className="text-[9px]">YENİ</Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                MCP sunucusu: kendi Claude/ChatGPT/Cursor'undan RanksUp verini sorgula — görünürlük, rakipler, aksiyonlar, prompt'lar + ASO. 24 tool, API anahtarıyla güvenli.
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
            Kurulum <ChevronDown className={cn('h-3.5 w-3.5 ml-1 transition-transform', open && 'rotate-180')} />
          </Button>
        </div>

        {open && (
          <div className="space-y-3 pt-2 border-t text-xs">
            <div>
              <div className="font-semibold mb-1">1. API anahtarı oluştur</div>
              <p className="text-muted-foreground">
                <Link href="/api-keys" className="underline">API Anahtarları</Link> sayfasından yeni bir anahtar üret (<code className="font-mono">luvi_…</code>).
              </p>
            </div>
            <div>
              <div className="font-semibold mb-1 flex items-center gap-1.5"><Bot className="h-3.5 w-3.5" /> 2a. Claude Code / Claude Desktop</div>
              <div className="rounded-md bg-muted/60 p-2.5 font-mono text-[11px] break-all flex items-start gap-2">
                <span className="flex-1">{claudeCmd}</span>
                <button type="button" onClick={() => copy(claudeCmd)} className="shrink-0 text-muted-foreground hover:text-foreground">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div>
              <div className="font-semibold mb-1">2b. ChatGPT / Cursor / diğer MCP istemcileri</div>
              <p className="text-muted-foreground">
                Sunucu URL: <code className="font-mono">{MCP_URL}</code> (Streamable HTTP) ·
                Header: <code className="font-mono">Authorization: Bearer luvi_…</code>
              </p>
            </div>
            <div>
              <div className="font-semibold mb-1">3. Dene</div>
              <p className="text-muted-foreground italic">
                "RanksUp'taki sitelerimi listele ve en düşük GEO skorlu olanın bu haftaki planını çıkar."
              </p>
            </div>
            <div className="pt-2 border-t">
              <div className="font-semibold mb-1">Bonus: Looker Studio / BI bağlantısı (ajanslar için)</div>
              <p className="text-muted-foreground">
                Aynı API anahtarıyla düz-tablo veri uçları: <code className="font-mono">{API_BASE.replace(/\/$/, '')}/api/looker/mention-rate?site_id=…</code>,{' '}
                <code className="font-mono">/api/looker/citations</code>, <code className="font-mono">/api/looker/prompts</code>,{' '}
                <code className="font-mono">/api/looker/crawler-hits</code>. Müşteri dashboard'larını RanksUp verisiyle kur.
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
