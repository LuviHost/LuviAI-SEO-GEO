'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Bot, Upload, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const CATEGORY_COLOR: Record<string, string> = {
  'ai-search': 'bg-purple-500',
  'training': 'bg-pink-500',
  'classic-search': 'bg-blue-500',
  'social': 'bg-green-500',
};

/**
 * AI Crawler Hits Panel — sunucu logundan AI bot trafigini gosterir.
 * Kullanici Apache/nginx access.log icerigini upload eder, parse + DB'ye yaz,
 * 30 gunluk bot dagilimi grafigi cizilir.
 */
export function CrawlerHitsPanel({ siteId }: { siteId: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getCrawlerHistory(siteId, 30);
      setData(res);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [siteId]);

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const text = await file.text();
      const res = await api.ingestCrawlerLog(siteId, text);
      toast.success(`${res.entries} satır parse edildi · ${res.bots} bot · ${res.saved} snapshot`);
      await load();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  if (loading || !data) {
    return <div className="text-sm text-muted-foreground p-6 text-center">Crawler analytics yükleniyor…</div>;
  }

  const totalHits = data.totalHits ?? 0;
  const byCategory = data.byCategory ?? {};
  const byBot = data.byBot ?? {};
  const sortedBots = Object.entries(byBot).sort((a, b) => (b[1] as number) - (a[1] as number));

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p className="text-sm font-semibold inline-flex items-center gap-2">
              <Bot className="h-4 w-4 text-brand" /> AI Crawler Trafiği
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              GPTBot · ClaudeBot · PerplexityBot · Google-Extended sitenizi taradı mı?
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 border rounded-md cursor-pointer hover:bg-muted">
              <Upload className="h-3.5 w-3.5" />
              {uploading ? 'Yükleniyor…' : 'Log Upload'}
              <input type="file" accept=".log,.txt" className="hidden" onChange={onFileChange} disabled={uploading} />
            </label>
            <Button size="sm" variant="outline" onClick={load}>
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Yenile
            </Button>
          </div>
        </div>

        {totalHits === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            <p className="mb-2">Henüz crawler verisi yok.</p>
            <p className="text-xs">
              Sunucunuzun <code className="bg-muted px-1 rounded">access.log</code> dosyasını "Log Upload" butonu ile yükleyin
              (cPanel'de <code className="bg-muted px-1 rounded">~/access-logs/&lt;domain&gt;</code>).
              Apache combined format desteklenir.
            </p>
          </div>
        ) : (
          <>
            {/* Toplam ozet */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              <div className="rounded-md border p-3 text-center">
                <p className="text-2xl font-bold">{totalHits.toLocaleString('tr-TR')}</p>
                <p className="text-[11px] text-muted-foreground">Toplam İstek</p>
              </div>
              {Object.entries(byCategory).map(([cat, count]) => (
                <div key={cat} className="rounded-md border p-3 text-center">
                  <div className={`h-1.5 w-full rounded-full ${CATEGORY_COLOR[cat] ?? 'bg-muted'} mb-2`} />
                  <p className="text-2xl font-bold">{(count as number).toLocaleString('tr-TR')}</p>
                  <p className="text-[10px] text-muted-foreground capitalize">{cat.replace('-', ' ')}</p>
                </div>
              ))}
            </div>

            {/* Bot bazinda dagilim */}
            <div className="rounded-md border">
              <div className="px-3 py-2 border-b bg-muted/30">
                <p className="text-xs font-semibold">Bot Dağılımı (son 30 gün)</p>
              </div>
              <div className="divide-y text-xs max-h-[400px] overflow-y-auto">
                {sortedBots.map(([bot, hits]) => {
                  const info = data.registry?.[bot];
                  const pct = totalHits > 0 ? ((hits as number) / totalHits) * 100 : 0;
                  return (
                    <div key={bot} className="px-3 py-2">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${CATEGORY_COLOR[info?.category] ?? 'bg-muted'}`} />
                          <span className="font-medium">{info?.label ?? bot}</span>
                        </div>
                        <span className="font-mono text-[11px]">{(hits as number).toLocaleString('tr-TR')} ({pct.toFixed(1)}%)</span>
                      </div>
                      <div className="h-1 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full ${CATEGORY_COLOR[info?.category] ?? 'bg-muted-foreground'}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
