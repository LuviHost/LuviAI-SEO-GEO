'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleDashed, ListChecks, Phone, FileText } from 'lucide-react';
import { api } from '@/lib/api';
import type { ConversionCheck, ConversionStatus, GaKeyEventSetup } from '@/lib/local-visibility';
import { Card, CardContent } from '@/components/ui/card';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBanner } from '@/components/ui/status-banner';
import { formatNum } from '@/lib/format';

/**
 * GA4 donusum kontrolu — telefon tiklamasi ve form/randevu gonderimi onemli
 * etkinlik (key event) olarak olculuyor mu? Yalniz okur; GA4 ayarina dokunmaz.
 *
 * Kilavuz metinleri Google belgelerine dayanir (2026-10 okundu):
 *  - Gelistirilmis olcum olaylari; giden tiklama tanimi, form_start/form_submit:
 *    https://support.google.com/analytics/answer/9216061
 *  - Onerilen olaylar (generate_lead): https://support.google.com/analytics/answer/9267735
 *    ve https://developers.google.com/analytics/devguides/collection/ga4/reference/events#generate_lead
 *  - Onemli etkinlik olarak isaretleme, 30 siniri: https://support.google.com/analytics/answer/13128484
 *  - Etiket Yoneticisi tiklama tetikleyicisi (Just Links): https://support.google.com/tagmanager/answer/7679320
 * Siralama etkisi iddia edilmez — kontrol yalniz olcumun kurulu olup olmadigina bakar.
 */

const STATUS_VIEW: Record<ConversionStatus, { label: string; icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  tamam: { label: 'Ölçülüyor', icon: CheckCircle2, cls: 'text-success' },
  tetiklenmedi: { label: 'Tanımlı, tetiklenmiyor', icon: AlertTriangle, cls: 'text-warning' },
  anahtar_degil: { label: 'Önemli etkinlik değil', icon: AlertTriangle, cls: 'text-warning' },
  yok: { label: 'Ölçülmüyor', icon: CircleDashed, cls: 'text-danger' },
};

const STAR_HINT =
  "GA4'te Yönetici > Veri görüntüleme > Etkinlikler bölümünde olayın yanındaki yıldız simgesine tıklayarak önemli etkinlik olarak işaretle. İşaretleme geçmiş veriyi değiştirmez; o andan sonrasını sayar.";

const names = (list: Array<{ name: string }>) => list.map((x) => x.name).join(', ');

function summaryText(c: ConversionCheck, days: number): string {
  const total = c.keyEvents.reduce((s, k) => s + k.count, 0);
  switch (c.status) {
    case 'tamam':
      return `${names(c.keyEvents)} önemli etkinlik olarak son ${days} günde ${formatNum(total)} kez tetiklendi.`;
    case 'tetiklenmedi':
      return `${names(c.keyEvents)} önemli etkinlik olarak tanımlı ama son ${days} günde hiç tetiklenmedi.`;
    case 'anahtar_degil':
      return `${names(c.candidates)} olayı geliyor ama önemli etkinlik olarak işaretli değil.`;
    default:
      return c.kind === 'phone'
        ? 'Telefon tıklamasına benzeyen bir olay görünmüyor.'
        : 'Form ya da randevu gönderimine benzeyen bir olay görünmüyor.';
  }
}

function guidance(c: ConversionCheck): string | null {
  if (c.status === 'tamam') return null;
  if (c.status === 'anahtar_degil') return STAR_HINT;
  if (c.status === 'tetiklenmedi') {
    return c.kind === 'phone'
      ? 'Etiketin hâlâ sitede olduğunu ve telefon bağlantısına tıklanınca tetiklendiğini kontrol et; telefon bağlantılarının tel: ile başladığından emin ol.'
      : 'Etiketin formun başarılı gönderiminde tetiklendiğini kontrol et (ör. teşekkür sayfası ya da başarı mesajı).';
  }
  return c.kind === 'phone'
    ? "GA4'ün otomatik (geliştirilmiş ölçüm) olayları arasında telefon tıklaması için ayrı bir olay yok; Google'ın belgesi giden tıklamaları mevcut alanın dışına yönlendiren bağlantılar için tanımlıyor ve tel: bağlantılarından söz etmiyor. Telefon tıklamasını ayrı bir olay olarak gönder: Google Etiket Yöneticisi'nde yalnız bağlantı tıklamalarını dinleyen bir tetikleyici (Just Links) kur, koşulu \"Click URL tel: ile başlar\" yap ve bu tetikleyiciyle bir GA4 olayı gönder (ad örneği: telefon_tiklama). Ardından olayı önemli etkinlik olarak işaretle."
    : "Geliştirilmiş ölçümde Form etkileşimleri açıksa GA4 form_start ve form_submit olaylarını kendisi toplayabilir (Yönetici > Veri toplama ve değiştirme > Veri akışları > akışın > Geliştirilmiş ölçüm). Google'ın form gönderimi için önerdiği olay adı generate_lead; formun başarıyla gönderildiği anda (ör. teşekkür sayfasında) gönderip önemli etkinlik olarak işaretleyebilirsin. Randevu için Google'ın önerdiği ayrı bir olay adı yok.";
}

function CheckRow({ check, days }: { check: ConversionCheck; days: number }) {
  const view = STATUS_VIEW[check.status];
  const Icon = view.icon;
  const KindIcon = check.kind === 'phone' ? Phone : FileText;
  const hint = guidance(check);
  return (
    <div className="py-3 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <KindIcon className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span className="text-sm font-medium">{check.kind === 'phone' ? 'Telefon tıklaması' : 'Form / randevu gönderimi'}</span>
        <span className={`inline-flex items-center gap-1 text-xs font-medium ${view.cls}`}>
          <Icon className="h-3.5 w-3.5" aria-hidden /> {view.label}
        </span>
      </div>
      <p className="text-sm text-muted-foreground">{summaryText(check, days)}</p>
      {check.status === 'tamam' && check.candidates.length > 0 && (
        <p className="text-xs text-muted-foreground">Benzer ama önemli etkinlik olmayan olaylar: {names(check.candidates)}</p>
      )}
      {hint && <p className="text-xs text-muted-foreground leading-relaxed">{hint}</p>}
    </div>
  );
}

export function GaConversionChecklist({ siteId }: { siteId: string }) {
  const [data, setData] = useState<GaKeyEventSetup | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.getGaKeyEvents(siteId, 28)
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err: any) => { if (!cancelled) setData({ status: 'error', message: err?.message ?? 'GA4 olay verisi okunamadı.' }); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [siteId]);

  if (!loading && data?.status === 'not_connected') return null;

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <SectionHeader
          as="h3"
          icon={ListChecks}
          title="Dönüşüm takibi: telefon ve form/randevu"
          description="Telefon tıklamalarının ve form/randevu gönderimlerinin GA4'te önemli etkinlik olarak ölçülüp ölçülmediğine bakar. Ölçülmüyorsa sitenden gelen müşteri taleplerini raporlarda göremezsin. Yalnız okur; GA4 ayarlarına dokunmaz."
        />
        {loading || !data ? (
          <div className="space-y-2" aria-busy="true" aria-label="GA4 olayları yükleniyor">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : data.status === 'error' ? (
          <StatusBanner tone="warning" title="Kontrol yapılamadı">{data.message}</StatusBanner>
        ) : data.status === 'ok' ? (
          <>
            <div className="divide-y">
              {data.checks.map((c) => <CheckRow key={c.kind} check={c} days={data.days} />)}
            </div>
            {data.adminNote && <p className="text-xs text-warning">{data.adminNote}</p>}
            <p className="text-xs text-muted-foreground">
              Sınıflandırma olay adına bakar (ör. phone, tel, call, arama; generate_lead, form_submit, randevu, booking).
              Farklı adla gönderdiğin bir olay varsa burada görünmeyebilir. Standart GA4 mülklerinde en fazla 30 olay önemli
              etkinlik olarak işaretlenebilir.{' '}
              <a className="underline hover:text-foreground" href="https://support.google.com/analytics/answer/13128484?hl=tr" target="_blank" rel="noopener noreferrer">Google: önemli etkinlik olarak işaretleme</a>
              {' · '}
              <a className="underline hover:text-foreground" href="https://support.google.com/analytics/answer/9216061?hl=tr" target="_blank" rel="noopener noreferrer">Google: geliştirilmiş ölçüm</a>
            </p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
