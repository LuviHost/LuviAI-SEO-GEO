'use client';

import Link from 'next/link';
import { ArrowRight, Image as ImageIcon, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { SectionHeader } from '@/components/ui/section-header';
import { ErrorState } from '@/components/ui/async-state';
import { AscScreenshotsPanel } from '@/components/asc-screenshots-panel';
import { useAsoApp, useAudit } from '../../_components/app-context';
import { CREATIVE_FIELDS, FindingsAccordion } from '../../_components/findings';
import { AscGate } from '../../_components/asc-gate';

/**
 * Görseller — Screenshot Studio'ya giriş, mağazadaki mevcut ekran
 * görüntüleri, görsel bulguları ve (bağlıysa) App Store Connect'e yükleme.
 */
export default function AsoCreativesPage() {
  const { siteId, app, base } = useAsoApp();
  const audit = useAudit();
  const ios = audit.data?.currentMetadata?.ios ?? null;
  const android = audit.data?.currentMetadata?.android ?? null;
  const findings = (audit.data?.findings ?? []).filter((f) => CREATIVE_FIELDS.has(f.field));

  return (
    <div className="space-y-6">
      <SectionHeader as="h3" icon={ImageIcon} title="Görseller" description="Ekran görüntüleri, tanıtım videosu ve öne çıkan görsel." />

      <Card className="border-brand/20 bg-brand/5">
        <CardContent className="flex flex-wrap items-center gap-4 p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand/15 text-brand" aria-hidden>
            <Wand2 className="h-5 w-5" />
          </span>
          <div className="min-w-[200px] flex-1">
            <p className="font-semibold">Screenshot Studio</p>
            <p className="text-sm text-muted-foreground">
              AI başlık ve arka planla mağaza boyutlarında ekran görüntüsü tasarla; tek tıkla tüm iPhone, iPad ve Android boyutlarını indir.
            </p>
          </div>
          <Button asChild>
            <Link href={`${base}/screenshots`}>Studio&apos;yu aç <ArrowRight className="h-4 w-4" aria-hidden /></Link>
          </Button>
        </CardContent>
      </Card>

      <section aria-labelledby="cr-current" className="space-y-3">
        <h4 id="cr-current" className="font-semibold">Mağazadaki ekran görüntüleri</h4>
        {audit.loading && !audit.data ? (
          <Skeleton className="h-48" />
        ) : audit.error && !audit.data ? (
          <ErrorState error={audit.error} onRetry={audit.reload} />
        ) : (
          <div className="space-y-4">
            {app.appStoreId && <Gallery title="App Store" urls={ios?.screenshots ?? []} />}
            {app.playStoreId && <Gallery title="Google Play" urls={android?.screenshots ?? []} />}
          </div>
        )}
      </section>

      {findings.length > 0 && (
        <section aria-labelledby="cr-findings" className="space-y-3">
          <h4 id="cr-findings" className="font-semibold">Görsel denetimi</h4>
          <FindingsAccordion findings={findings} />
        </section>
      )}

      <section aria-labelledby="cr-asc" className="space-y-3">
        <h4 id="cr-asc" className="font-semibold">App Store Connect&apos;e yükle</h4>
        <AscGate purpose="Ekran görüntülerini doğrudan App Store Connect'e yüklemek">
          {(ascApp) => (
            <Card>
              <CardContent className="p-4">
                <p className="text-sm text-muted-foreground">Eşleşen kayıt: <span className="font-medium text-foreground">{ascApp.name}</span></p>
                <AscScreenshotsPanel siteId={siteId} ascAppId={ascApp.id} />
              </CardContent>
            </Card>
          )}
        </AscGate>
      </section>
    </div>
  );
}

function Gallery({ title, urls: raw }: { title: string; urls: string[] }) {
  // Mağaza verisi aynı görseli birden fazla kez döndürebiliyor; adres React anahtarı
  // olduğu için tekrarlar "aynı anahtar" hatası verip görselleri bozuyordu.
  const urls = Array.from(new Set(raw.filter(Boolean)));
  return (
    <div>
      <p className="mb-2 text-label text-muted-foreground">{title} · {urls.length} görsel</p>
      {urls.length === 0 ? (
        <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Mağaza verisinde ekran görüntüsü yok.</p>
      ) : (
        // Tek yatay kaydırıcı — dikeyde sayfa kayar
        <ul className="flex gap-2 overflow-x-auto pb-2">
          {urls.map((u, i) => (
            <li key={u} className="shrink-0">
              <a href={u} target="_blank" rel="noopener noreferrer" className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                <img
                  src={u}
                  alt={`${title} ekran görüntüsü ${i + 1}`}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="h-56 w-auto rounded-md border bg-muted object-contain"
                  onError={(e) => { (e.currentTarget.closest('li') as HTMLElement | null)?.setAttribute('hidden', ''); }}
                />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
