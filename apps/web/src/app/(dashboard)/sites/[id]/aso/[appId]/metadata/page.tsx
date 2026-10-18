'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ArrowDownToLine, FileText, KeyRound, ListChecks, Loader2, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { FilterChip } from '@/components/ui/filter-chip';
import { Skeleton } from '@/components/ui/skeleton';
import { SectionHeader } from '@/components/ui/section-header';
import { ErrorState } from '@/components/ui/async-state';
import { InfoTooltip } from '@/components/info-tooltip';
import { KeywordFieldAuditCard } from '@/components/keyword-field-audit-card';
import { AscMetadataPanel, type AscMetadataPrefill } from '@/components/asc-metadata-panel';
import { useAsoApp, useAudit } from '../../_components/app-context';
import { FieldCompare } from '../../_components/field-compare';
import { CREATIVE_FIELDS, FindingsAccordion } from '../../_components/findings';
import { AscGate } from '../../_components/asc-gate';
import { GuardIssues } from '../../_components/guard-issues';
import { APP_STORE_LIMITS, GOOGLE_PLAY_LIMITS } from '../../_components/store-limits';
import { STORE_LABEL, type OptimizeResult, type Store } from '../../_components/types';

/**
 * Metadata (eski "Optimize" sekmesi). Eski sıra: skor → bulgular → mevcut iOS
 * → mevcut Android → AI üretici → anahtar kelime denetimi → 5 adımlık rehber;
 * ana eylem üç ekran aşağıdaydı ve kelime seçimi başka sekmeye bağlıydı.
 * Yeni sıra: kelime seç + üret (en üstte) → alan alan "mevcut ↔ önerilen" →
 * ASC'ye uygula → bulgular (akordeon) → anahtar kelime alanı denetimi → rehber.
 */
export default function AsoMetadataPage() {
  const { siteId, app, base, optimize, setOptimize } = useAsoApp();
  const audit = useAudit();
  const keywords = app.keywords ?? [];

  const [store, setStore] = useState<Store>(optimize?.store ?? (app.appStoreId ? 'IOS' : 'ANDROID'));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);
  const [prefill, setPrefill] = useState<AscMetadataPrefill | null>(null);

  const result: OptimizeResult | null = optimize?.store === store ? optimize.result : null;
  const storeKeywords = useMemo(
    () => keywords.filter((k) => k.store === store).sort((a, b) => (b.traffic ?? 0) - (a.traffic ?? 0)),
    [keywords, store],
  );
  const selectedInStore = storeKeywords.filter((k) => selected.has(k.id));

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };

  const run = async () => {
    const targetKeywords = selectedInStore.map((k) => k.keyword);
    if (targetKeywords.length === 0) {
      toast.error('En az bir hedef anahtar kelime seç');
      return;
    }
    setRunning(true);
    try {
      const r = await api.request<OptimizeResult>(`/sites/${siteId}/aso/apps/${app.id}/optimize-metadata`, {
        method: 'POST',
        body: JSON.stringify({ targetKeywords, store, locale: app.country === 'tr' ? 'tr' : 'en' }),
      });
      setOptimize({ store, result: r });
      toast.success('Öneriler hazır — aşağıda mevcut metinle yan yana');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRunning(false);
    }
  };

  const findings = (audit.data?.findings ?? []).filter((f) => !CREATIVE_FIELDS.has(f.field));
  const ios = audit.data?.currentMetadata?.ios ?? null;
  const android = audit.data?.currentMetadata?.android ?? null;
  const counts = {
    error: findings.filter((f) => f.severity === 'error').length,
    warning: findings.filter((f) => f.severity === 'warning').length,
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        as="h3"
        icon={FileText}
        title="Metadata"
        description="Mağaza metinlerin: mevcut hali ile AI önerisi yan yana, farkı vurgulu."
        actions={
          app.appStoreId && app.playStoreId ? (
            <div className="flex gap-1.5" role="group" aria-label="Mağaza">
              {(['IOS', 'ANDROID'] as Store[]).map((s) => (
                <FilterChip key={s} selected={store === s} onClick={() => setStore(s)}>{STORE_LABEL[s]}</FilterChip>
              ))}
            </div>
          ) : undefined
        }
      />

      {/* 1 — Ana eylem: hedef kelimeleri seç ve öneri üret */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="flex items-center gap-2 font-semibold">
              <Sparkles className="h-4 w-4 text-brand" aria-hidden /> AI ile yeni metin öner
              <InfoTooltip
                text={`Seçtiğin hedef kelimelerle ${store === 'IOS' ? 'Ad, Alt başlık, Anahtar kelimeler ve Açıklama' : 'Ad, Kısa açıklama ve Açıklama'} için öneri üretir; sınırı aşan alan kırmızı görünür. Mağaza verisinde olmayan puan, kullanıcı sayısı ve ödül iddiaları ile fiyat ifadeleri çıkarılır. Hiçbir şey mağazaya kendiliğinden yazılmaz.`}
              />
            </h4>
            <span className="text-label text-muted-foreground">{selectedInStore.length} kelime seçili · {STORE_LABEL[store]}</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {storeKeywords.length === 0 ? (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed p-3 text-sm">
              <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden />
              <span className="flex-1">{STORE_LABEL[store]} için takip edilen anahtar kelime yok.</span>
              <Button asChild size="sm" variant="outline"><Link href={`${base}/keywords`}>Anahtar kelime ekle</Link></Button>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Hedef anahtar kelimeler">
                {storeKeywords.map((k) => (
                  <FilterChip key={k.id} selected={selected.has(k.id)} onClick={() => toggle(k.id)} title={k.traffic ? `Trafik ${Math.round(k.traffic)}` : undefined}>
                    {k.keyword}
                    {k.currentRank != null && <span className="text-muted-foreground">#{k.currentRank}</span>}
                  </FilterChip>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={run} disabled={running || selectedInStore.length === 0}>
                  {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
                  {running ? 'AI yazıyor (~30 sn)…' : 'Önerileri üret'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(storeKeywords.slice(0, 5).map((k) => k.id)))}>
                  En yüksek trafikli 5'i seç
                </Button>
                {selected.size > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Temizle</Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* 2 — Alan alan mevcut ↔ önerilen */}
      <section aria-labelledby="md-fields" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 id="md-fields" className="font-semibold">{STORE_LABEL[store]} alanları</h4>
          {audit.data && (counts.error > 0 || counts.warning > 0) && (
            <div className="flex gap-1.5">
              {counts.error > 0 && <Badge variant="danger">{counts.error} hata</Badge>}
              {counts.warning > 0 && <Badge variant="warning">{counts.warning} uyarı</Badge>}
            </div>
          )}
        </div>

        {audit.loading && !audit.data ? (
          <div className="space-y-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-28" />)}</div>
        ) : audit.error && !audit.data ? (
          <ErrorState error={audit.error} onRetry={audit.reload} />
        ) : store === 'IOS' ? (
          <div className="space-y-3">
            <FieldCompare label="Ad" current={ios?.title} suggested={result?.title} limit={APP_STORE_LIMITS.name} />
            <FieldCompare label="Alt başlık" current={ios?.subtitle} suggested={result?.subtitle} limit={APP_STORE_LIMITS.subtitle} />
            <FieldCompare
              label="Anahtar kelimeler"
              current={null}
              currentNote="Mağazada herkese açık değil — aşağıdaki denetime ASC'den yapıştırabilirsin."
              suggested={result?.keywordField}
              limit={APP_STORE_LIMITS.keywords}
              hint="Virgülle ayır, boşluk bırakma"
            />
            <FieldCompare
              label="Açıklama"
              current={ios?.description}
              suggested={result?.description}
              limit={APP_STORE_LIMITS.description}
              multiline
              hint="App Store açıklamayı arama sıralamasında kullanmaz"
            />
            <FieldCompare label="Yenilikler" current={ios?.releaseNotes} limit={APP_STORE_LIMITS.whatsNew} multiline hint="Sürüm notları — AI bu alanı yazmaz" />
          </div>
        ) : (
          <div className="space-y-3">
            <FieldCompare label="Ad" current={android?.title} suggested={result?.title} limit={GOOGLE_PLAY_LIMITS.title} />
            <FieldCompare label="Kısa açıklama" current={android?.summary} suggested={result?.subtitle} limit={GOOGLE_PLAY_LIMITS.shortDescription} />
            <FieldCompare label="Açıklama" current={android?.description} suggested={result?.description} limit={GOOGLE_PLAY_LIMITS.fullDescription} multiline />
          </div>
        )}

        <GuardIssues issues={result?.issues} store={store} />

        {Array.isArray(result?.suggestions) && result!.suggestions!.length > 0 && (
          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-sm font-medium"><ListChecks className="h-4 w-4 text-brand" aria-hidden /> AI&apos;ın ek önerileri</p>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {result!.suggestions!.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        )}
      </section>

      {/* 3 — App Store Connect'e uygula (yalnız eşleşen ASC uygulaması) */}
      {store === 'IOS' && (
        <section aria-labelledby="md-asc" className="space-y-3">
          <h4 id="md-asc" className="font-semibold">App Store Connect&apos;e uygula</h4>
          <AscGate purpose="Önerileri doğrudan App Store Connect'e yazmak">
            {(ascApp) => (
              <Card>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-muted-foreground">
                      Eşleşen kayıt: <span className="font-medium text-foreground">{ascApp.name}</span>
                      {ascApp.latestVersion && <> · sürüm {ascApp.latestVersion}</>}
                    </p>
                    {result && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPrefill({
                          nonce: Date.now(),
                          fields: { name: result.title, subtitle: result.subtitle, keywords: result.keywordField, description: result.description },
                        })}
                      >
                        <ArrowDownToLine className="h-4 w-4" aria-hidden /> Önerileri taslağa aktar
                      </Button>
                    )}
                  </div>
                  <AscMetadataPanel siteId={siteId} ascAppId={ascApp.id} prefill={prefill} />
                </CardContent>
              </Card>
            )}
          </AscGate>
        </section>
      )}

      {/* 4 — Bulgular (akordeon) */}
      <section aria-labelledby="md-findings" className="space-y-3">
        <h4 id="md-findings" className="font-semibold">Mağaza denetimi</h4>
        {audit.data ? (
          <FindingsAccordion findings={findings.filter((f) => f.store === store || f.store === 'BOTH')} />
        ) : audit.loading ? (
          <Skeleton className="h-24" />
        ) : null}
      </section>

      {/* 5 — Anahtar kelime alanı denetimi (yalnız App Store) */}
      {store === 'IOS' && app.appStoreId && (
        <KeywordFieldAuditCard
          siteId={siteId}
          appId={app.id}
          defaultSubtitle={ios?.subtitle ?? null}
          aiKeywordField={result?.keywordField ?? null}
        />
      )}

      {/* 6 — Kısa rehber */}
      <GuideStepper store={store} appName={app.name} keywordsHref={`${base}/keywords`} />
    </div>
  );
}

function GuideStepper({ store, appName, keywordsHref }: { store: Store; appName: string; keywordsHref: string }) {
  const steps: React.ReactNode[] = [
    <>Hedef kelimeleri seç, <strong>Önerileri üret</strong>.</>,
    <>Alanları karşılaştır, beğendiğini <strong>Kopyala</strong>.</>,
    store === 'IOS' ? (
      <>Bağlıysa <strong>taslağa aktar → uygula</strong>; değilse{' '}
        <a href="https://appstoreconnect.apple.com/" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">App Store Connect</a>
        {' '}→ {appName} → Uygulama Bilgileri.</>
    ) : (
      <><a href="https://play.google.com/console" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">Play Console</a>
        {' '}→ {appName} → Ana mağaza girişi.</>
    ),
    store === 'IOS' ? <>Kaydet ve yeni sürümle incelemeye gönder (Apple 1-2 gün).</> : <>Kaydet — Play genelde kısa sürede yayına alır.</>,
    <>1-2 hafta sonra <Link href={keywordsHref} className="text-brand hover:underline">sıraları güncelle</Link>; yukarı ok = başarı.</>,
  ];
  return (
    <section aria-labelledby="md-guide" className="rounded-lg border p-4">
      <h4 id="md-guide" className="mb-3 text-sm font-semibold">Nasıl uygularsın?</h4>
      <ol className="grid gap-3 md:grid-cols-5">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-2 text-sm md:flex-col">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand/10 text-label font-semibold text-brand">{i + 1}</span>
            <span className="text-muted-foreground">{s}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
