'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Copy, KeyRound, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

/**
 * App Store anahtar kelime alani denetimi. Alan herkese acik degil —
 * kullanici App Store Connect'ten yapistirir. Sinir 100 KARAKTER; 100 bayt
 * asimi yalniz bilgi (Apple belgeleri celisiyor, ASC karakteri uyguluyor).
 */

const SEVERITY_STYLE: Record<string, { box: string; label: string; variant: 'destructive' | 'warning' | 'secondary' }> = {
  error: { box: 'border-rose-500/20 bg-rose-500/5', label: 'Hata', variant: 'destructive' },
  warning: { box: 'border-amber-500/20 bg-amber-500/5', label: 'Uyarı', variant: 'warning' },
  info: { box: 'border-blue-500/20 bg-blue-500/5', label: 'Bilgi', variant: 'secondary' },
};

const COMPETITOR_NOTE: Record<string, string> = {
  similar: 'Rakip adları benzer uygulamalardan kontrol edildi.',
  failed: 'Rakip adları alınamadı — rakip kontrolü yapılmadı.',
  skipped: 'Rakip kontrolü yapılmadı (App Store kimliği yok).',
  body: 'Rakip adları verilen listeden kontrol edildi.',
};

const chars = (s: string) => [...s].length;
const bytes = (s: string) => new TextEncoder().encode(s).length;

export function KeywordFieldAuditCard({
  siteId,
  appId,
  defaultSubtitle,
  aiKeywordField,
}: {
  siteId: string;
  appId: string;
  defaultSubtitle?: string | null;
  aiKeywordField?: string | null;
}) {
  const [keywords, setKeywords] = useState('');
  const [subtitle, setSubtitle] = useState(defaultSubtitle ?? '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  const live = useMemo(() => ({ c: chars(keywords), b: bytes(keywords) }), [keywords]);

  const run = async () => {
    setBusy(true);
    try {
      const r = await api.request<any>(`/sites/${siteId}/aso/apps/${appId}/keyword-audit`, {
        method: 'POST',
        body: JSON.stringify({ keywords, subtitle: subtitle.trim() || undefined }),
      });
      setResult(r);
    } catch (e: any) {
      toast.error(e?.message ?? 'Denetim yapılamadı');
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Temiz alan panoya kopyalandı');
    } catch {
      toast.error('Kopyalanamadı');
    }
  };

  return (
    <Card>
      <CardHeader>
        <h4 className="font-semibold flex items-center gap-2">
          <KeyRound className="h-4 w-4" /> Anahtar kelime alanı denetimi (App Store)
        </h4>
        <p className="text-xs text-muted-foreground mt-1">
          Bu alan mağazada görünmez. App Store Connect → Uygulama Bilgileri → Anahtar Kelimeler alanını kopyalayıp yapıştır.
          Sınır 100 karakter; virgülle ve boşluksuz ayrılır.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="kw-field" className="text-xs font-medium">Anahtar kelimeler</label>
            <span className={cn('text-label', live.c > 100 ? 'text-rose-600' : 'text-muted-foreground')}>
              {live.c}/100 karakter · {live.b} bayt
            </span>
          </div>
          <Textarea
            id="kw-field"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
            placeholder="takvim,ajanda,hatırlatıcı,planlayıcı"
            className="font-mono min-h-[64px]"
          />
        </div>
        <div>
          <label htmlFor="kw-subtitle" className="text-xs font-medium">Alt başlık (örtüşme kontrolü için)</label>
          <Input id="kw-subtitle" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} className="mt-1" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={run} disabled={busy || !keywords.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} Denetle
          </Button>
          {aiKeywordField && aiKeywordField !== keywords && (
            <Button size="sm" variant="outline" onClick={() => setKeywords(aiKeywordField)}>AI önerisini yükle</Button>
          )}
        </div>

        {result && (
          <div className="space-y-3 pt-1">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge variant={result.summary.error ? 'destructive' : 'success'}>{result.summary.error} hata</Badge>
              <Badge variant={result.summary.warning ? 'warning' : 'secondary'}>{result.summary.warning} uyarı</Badge>
              <Badge variant="secondary">{result.summary.info} bilgi</Badge>
              <span className="text-muted-foreground">
                {result.characters}/{result.limit} karakter · {result.remaining} boş
              </span>
            </div>

            {result.findings.length === 0 ? (
              <p className="text-sm text-muted-foreground">Bulgu yok — alan kurallara uygun.</p>
            ) : (
              <div className="space-y-2">
                {result.findings.map((f: any, i: number) => {
                  const st = SEVERITY_STYLE[f.severity] ?? SEVERITY_STYLE.info;
                  return (
                    <div key={`${f.code}-${i}`} className={cn('rounded-md border p-3', st.box)}>
                      <div className="flex items-start gap-2">
                        <Badge variant={st.variant} className="shrink-0">{st.label}</Badge>
                        <div className="min-w-0">
                          <p className="text-sm">{f.message}</p>
                          <p className="text-label text-muted-foreground mt-1">Kaynak: {f.source}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {result.cleanedField && result.cleanedField !== keywords && (
              <div className="rounded-md border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">
                    Temizlenmiş alan ({result.cleanedCharacters} karakter, {result.characters - result.cleanedCharacters} kazanç)
                  </span>
                  <Button size="sm" variant="outline" onClick={() => copy(result.cleanedField)}>
                    <Copy className="h-3.5 w-3.5 mr-1" /> Kopyala
                  </Button>
                </div>
                <p className="font-mono text-xs break-all">{result.cleanedField}</p>
                <p className="text-label text-muted-foreground">
                  Yalnız biçim ve birebir tekrar düzeltildi; örtüşen ya da rakip kelimeleri sen çıkar.
                </p>
              </div>
            )}

            <p className="text-label text-muted-foreground">
              {COMPETITOR_NOTE[result.context?.competitorSource] ?? ''}
              {result.context?.companyName ? ` Şirket: ${result.context.companyName}.` : ''}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
