'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowRight, Loader2, Plus, Sparkles } from 'lucide-react';
import { api, type GbpYerelOneri } from '@/lib/api';
import type { LocalPromptDraft } from '@/lib/local-visibility';
import { listeAyir } from '@/lib/google-isletme';
import { siteHref } from '@/lib/site-routes';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * Profilden yerel AI sorulari — il/ilce/hizmet denetimdeki profilden ON DOLDURULUR (sunucu: gbp-yerel.ts),
 * kullanici duzeltir; sorular Prompt Lab yerel modunun MEVCUT onizleme → olusturma uclariyla kaydedilir
 * (prompt-lab-local.tsx ile ayni akis). Olusturmak olcum hakki harcamaz.
 */
export function YerelSorular({ siteId, oneri }: { siteId: string; oneri: GbpYerelOneri }) {
  const [il, setIl] = useState(oneri.il ?? '');
  const [ilce, setIlce] = useState(oneri.ilceler.join(', '));
  const [hizmet, setHizmet] = useState(oneri.hizmetler.join(', '));
  const [taslaklar, setTaslaklar] = useState<LocalPromptDraft[] | null>(null);
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [onizleniyor, setOnizleniyor] = useState(false);
  const [kaydediliyor, setKaydediliyor] = useState(false);
  const [eklenen, setEklenen] = useState<number | null>(null);

  const girdi = () => ({ il: il.trim(), ilceler: listeAyir(ilce), hizmetler: listeAyir(hizmet) });

  async function olustur() {
    setOnizleniyor(true);
    setEklenen(null);
    try {
      const res = await api.previewLocalPrompts(siteId, girdi());
      setTaslaklar(res.drafts);
      setSecili(new Set(res.drafts.filter((d) => !d.exists).map((d) => d.text)));
    } catch (err: any) {
      toast.error(err?.message ?? 'Sorular oluşturulamadı');
    } finally {
      setOnizleniyor(false);
    }
  }

  async function kaydet() {
    if (!secili.size) return;
    setKaydediliyor(true);
    try {
      const res = await api.createLocalPrompts(siteId, { ...girdi(), texts: [...secili] });
      toast.success(
        `${res.created} yerel soru takibe alındı${res.skipped ? `, ${res.skipped} atlandı` : ''}${res.limitReached ? ' (soru sınırına ulaşıldı)' : ''}`,
      );
      setEklenen(res.created);
      setTaslaklar(null);
      setSecili(new Set());
    } catch (err: any) {
      toast.error(err?.message ?? 'Kaydedilemedi');
    } finally {
      setKaydediliyor(false);
    }
  }

  const degistir = (text: string) => setSecili((prev) => {
    const next = new Set(prev);
    if (next.has(text)) next.delete(text); else next.add(text);
    return next;
  });

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Müşterilerinizin AI asistanlara sorabileceği yerel soruları (ör. “Kadıköy’de iyi bir kafe öner”) profilinizdeki
        il, ilçe ve kategoriden hazırladık. Düzeltip soruları oluşturun; seçtikleriniz GEO Lab’de takip edilir.
      </p>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="space-y-1">
          <span className="text-label text-muted-foreground">İl</span>
          <Input value={il} onChange={(e) => setIl(e.target.value)} placeholder="Örn: İstanbul" />
        </label>
        <label className="space-y-1">
          <span className="text-label text-muted-foreground">İlçe ya da semt (virgülle, en fazla 5)</span>
          <Input value={ilce} onChange={(e) => setIlce(e.target.value)} placeholder="Örn: Kadıköy, Moda" />
        </label>
        <label className="space-y-1">
          <span className="text-label text-muted-foreground">Hizmetler (virgülle, en fazla 5)</span>
          <Input value={hizmet} onChange={(e) => setHizmet(e.target.value)} placeholder="Örn: kafe, kahvaltı" />
        </label>
      </div>
      <Button size="sm" onClick={olustur} disabled={onizleniyor || !il.trim() || !hizmet.trim()}>
        {onizleniyor ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
        Yerel AI soruları oluştur
      </Button>

      {taslaklar && (
        <div className="rounded-lg border">
          <div className="flex flex-wrap items-center justify-between gap-2 bg-muted/50 px-3 py-2">
            <span className="text-label font-medium">{taslaklar.length} soru — takibe alınacakları seçin</span>
            <Button size="sm" onClick={kaydet} disabled={kaydediliyor || secili.size === 0}>
              {kaydediliyor ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Seçilenleri takibe al ({secili.size})
            </Button>
          </div>
          <div className="divide-y">
            {taslaklar.map((d) => (
              <label key={d.text} className={`flex items-center gap-2 px-3 py-2 text-sm ${d.exists ? 'opacity-60' : 'cursor-pointer'}`}>
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-brand-500"
                  checked={!d.exists && secili.has(d.text)}
                  disabled={d.exists}
                  onChange={() => degistir(d.text)}
                />
                <span className="min-w-0 flex-1">{d.text}</span>
                {d.exists && <Badge variant="outline" className="shrink-0">takipte</Badge>}
              </label>
            ))}
          </div>
        </div>
      )}

      {eklenen !== null && (
        <Link
          href={siteHref(siteId, 'geoLab') as any}
          className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline"
        >
          Soruları GEO Lab’de görüntüle ve ölç <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      )}
    </div>
  );
}
