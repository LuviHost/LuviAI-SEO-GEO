'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { formatNum } from '@/lib/format';
import { Skeleton } from '@/components/ui/skeleton';
import { FilterChip } from '@/components/ui/filter-chip';

/**
 * AI'dan gelen ziyaretciler — ChatGPT / Perplexity / Claude cevabindaki baglantiya tiklayan
 * gercek kullanicilar (izleme kodundan). Bot trafigi DEGIL.
 *
 * 13.11.2026: GEO Lab'deki "AI trafik konsolu" sekmesinden Bot Takibi sayfasina tasindi
 * (sites/[id]/bot-takibi); kod ile sonucu ayni yerde dursun.
 */
export function AiZiyaretciler({ siteId }: { siteId: string }) {
  const [data, setData] = useState<any>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.getAiReferrerHistory(siteId, days);
      setData(res);
    } catch (err: any) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [days, siteId]);

  if (loading || !data) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Yükleniyor">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  const sortedReferrers = Object.entries(data.byReferrer ?? {}).sort((a, b) => (b[1] as number) - (a[1] as number));

  return (
    <div className="space-y-3 [&_strong]:font-medium [&_strong]:text-foreground">
      {/*
        Eski metin "gercek satin alma niyetli ziyaretci", "cogu site icin %1'in altinda" ve
        "ChatGPT trafiginin buyuk bolumu Direct gorunur" diyordu — olculmemis niyet ve
        kaynaksiz oranlar. Dogrulanan: Ahrefs, Mart 2026, 74.752 site — AI sohbet botlari
        toplam web trafiginin %0,28'i; bazi asistanlar yonlendiren adresi iletmedigi icin
        AI ziyaretleri eksik sayilabiliyor. https://ahrefs.com/blog/ai-chatbot-traffic/
      */}
      <p className="text-xs text-muted-foreground">
        <strong>AI cevaplarındaki bağlantılardan gelen kullanıcı trafiği.</strong> ChatGPT, Perplexity ya da Claude cevabında sitenin bağlantısı yer alıp kullanıcı tıkladığında kaynak, tarayıcının gönderdiği yönlendiren adresten (referrer) ya da bağlantıdaki utm etiketinden (ör. ChatGPT&apos;nin eklediği <code>utm_source=chatgpt.com</code>) anlaşılır; aynı oturumdaki ziyaret bir kez sayılır. <strong>Bot trafiği değil; AI cevabındaki bağlantıya tıklayan gerçek ziyaretçi.</strong>
      </p>
      <p className="text-label text-muted-foreground">
        Bağlam: bağımsız ölçümler AI asistanlarından gelen ziyaretin toplam web trafiğinin küçük bir bölümü olduğunu gösteriyor (Ahrefs, Mart 2026: %0,28). Bazı AI uygulamaları yönlendiren adresi iletmediği ve bağlantıya utm etiketi eklemediği için bu ziyaretlerin bir kısmı analitikte &quot;Direct&quot; görünür; buradaki sayı <strong>ölçülebilen alt küme</strong>dir, tamamı değil.
      </p>

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="inline-flex gap-1.5">
          {[7, 30, 90].map((d) => (
            <FilterChip key={d} selected={days === d} onClick={() => setDays(d)}>{d}g</FilterChip>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">Toplam: <strong className="tabular-nums">{formatNum(data.totalHits)}</strong> tıklama</span>
      </div>

      {data.totalHits === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          Henüz AI&apos;dan gelen ziyaret kaydı yok. Yukarıdaki kodu sitene ekledikten sonra, bir kullanıcı AI cevabındaki bağlantına tıkladığında burada görünür. Sıfır olması olağandır: AI asistanlarından gelen ziyaret çoğu sitede toplam trafiğin küçük bir bölümüdür ve tıklama için önce cevapta kaynak (bağlantı) olarak yer almak gerekir.
        </div>
      ) : (
        <div className="space-y-2">
          {sortedReferrers.map(([key, hits]) => {
            const reg = (data.registry ?? []).find((r: any) => r.key === key);
            const label = reg?.label ?? key;
            const pct = (data.totalHits > 0 ? (hits as number) / data.totalHits * 100 : 0);
            return (
              <div key={key} className="rounded-md border p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">{label}</span>
                  <span className="font-mono text-xs text-muted-foreground">{formatNum(hits as number)} (%{pct.toFixed(1)})</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-foreground/70" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
