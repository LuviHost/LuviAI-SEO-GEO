'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ChevronDown, Plus, Trophy } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { siteHref } from '@/lib/site-routes';
import { PROVIDER_LABELS } from '@/lib/chart-colors';
import {
  degisimMetni, kaynakMetni, listedeVar, olcumVar, oneridenRakip, ozetMetni, payYuzdesi,
  type RakipGorunurlugu, type RakipOnerisi, type RakipSatiri,
} from '@/lib/rakip-gorunurlugu';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FilterChip } from '@/components/ui/filter-chip';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { EngineLogo } from '@/components/engine-logo';

/**
 * AI cevaplarında rakipler — takip edilen soruların SON ölçümünde markanın ve rakiplerin
 * kaç cevapta, kaç soruda, hangi asistanda anıldığı (sunucu: GET /audit/competitor-visibility).
 * 13.11.2026, ICM Turkey: "AI'larda hangi rakiplerimiz geçti, hangileri ön planda".
 * Yeni ölçüm YAPMAZ; Prompt Lab'in kayıtlı cevaplarını okur. Seçili durum nötr, turuncu yok.
 */

const providerName = (p: string) => PROVIDER_LABELS[p] ?? p;

function Asistanlar({ list }: { list: string[] }) {
  if (list.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <ul className="flex flex-wrap items-center gap-1" aria-label="Anan asistanlar">
      {list.map((p) => (
        <li key={p} className="grid h-6 w-6 place-items-center rounded-full border border-border bg-white" title={providerName(p)}>
          <EngineLogo provider={p} size={14} />
          <span className="sr-only">{providerName(p)}</span>
        </li>
      ))}
    </ul>
  );
}

const DEGISIM_TON: Record<ReturnType<typeof degisimMetni>['yon'], string> = {
  artti: 'text-success',
  azaldi: 'text-danger',
  ayni: 'text-muted-foreground',
  yok: 'text-muted-foreground',
};

function Satir({ row, sira, toplam, acik, onToggle }: { row: RakipSatiri; sira: number; toplam: number; acik: boolean; onToggle: () => void }) {
  const pay = payYuzdesi(row.answers, toplam);
  const degisim = degisimMetni(row.change);
  const acilabilir = row.byQuestion.length > 0;
  return (
    <Fragment>
      <tr className={cn('border-t', row.isBrand && 'bg-muted/50')}>
        <td className="w-8 py-2.5 pl-3 pr-2 font-mono text-xs tabular-nums text-muted-foreground">{sira}</td>
        <td className="py-2.5 pr-3">
          <button
            type="button"
            onClick={onToggle}
            disabled={!acilabilir}
            aria-expanded={acilabilir ? acik : undefined}
            className="inline-flex max-w-full items-center gap-1.5 rounded-sm text-left text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
          >
            <span className="truncate">{row.name}</span>
            {row.isBrand && <Badge variant="secondary">Sen</Badge>}
            {!row.listed && <Badge variant="outline" title="Bu ad eski ölçümlerde geçiyor ama rakip listende artık yok.">listede değil</Badge>}
            {acilabilir && <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', acik && 'rotate-180')} aria-hidden />}
          </button>
        </td>
        <td className="whitespace-nowrap py-2.5 pr-3 text-sm tabular-nums">
          {row.answers}<span className="text-muted-foreground"> / {toplam}</span>
          {/* Telefonda Pay sutunu yok (tablo yana kayar, sutun ekran disinda kalirdi): yuzde burada kalir */}
          <span className="ml-2 text-xs text-muted-foreground sm:hidden">%{pay}</span>
        </td>
        {/* Pay kendi sutununda (14.11.2026): yuzde eskiden cevap sayisinin yaninda kucuk ve basliksizdi */}
        <td className="hidden py-2.5 pr-3 sm:table-cell">
          <div className="flex items-center gap-2.5">
            <span className="w-10 shrink-0 text-sm font-medium tabular-nums">%{pay}</span>
            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted" aria-hidden>
              <span className="block h-full rounded-full bg-foreground/70" style={{ width: `${pay}%` }} />
            </span>
          </div>
        </td>
        <td className="py-2.5 pr-3 text-sm tabular-nums">{row.questions}</td>
        <td className="py-2.5 pr-3"><Asistanlar list={row.providers} /></td>
        <td className={cn('py-2.5 pr-3 text-sm tabular-nums', row.citedAnswers === null && 'text-xs text-muted-foreground')}>{kaynakMetni(row.citedAnswers)}</td>
        <td className={cn('py-2.5 pr-3 text-sm tabular-nums', DEGISIM_TON[degisim.yon])} title={degisim.title}>{degisim.text}</td>
      </tr>
      {acik && acilabilir && (
        <tr className={cn(row.isBrand && 'bg-muted/50')}>
          <td />
          <td colSpan={7} className="pb-3 pr-3">
            <ul className="space-y-1.5 rounded-md border p-3">
              {row.byQuestion.map((q) => (
                <li key={q.promptId} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="min-w-0 flex-1 basis-64 text-muted-foreground">{q.text}</span>
                  <Asistanlar list={q.providers} />
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

export function RakipGorunurluguCard({ siteId, onListChanged }: { siteId: string; onListChanged?: () => void }) {
  const [days, setDays] = useState<30 | 90>(30);
  const [data, setData] = useState<RakipGorunurlugu | null>(null);
  const [loading, setLoading] = useState(true);
  const [hata, setHata] = useState<string | null>(null);
  const [acik, setAcik] = useState<string | null>(null);
  const [ekleniyor, setEkleniyor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setHata(null);
    try {
      setData(await api.getCompetitorVisibility(siteId, days));
    } catch (err: any) {
      setHata(err?.message ?? 'Rakip görünürlüğü okunamadı.');
    } finally {
      setLoading(false);
    }
  }, [siteId, days]);

  useEffect(() => { load(); }, [load]);

  const ekle = async (o: RakipOnerisi) => {
    const aday = oneridenRakip(o.domain);
    setEkleniyor(o.domain);
    try {
      const liste = await api.listCompetitors(siteId);
      if (listedeVar(liste, aday)) {
        toast.message(`${aday.name} zaten rakip listende.`);
      } else {
        await api.setCompetitors(siteId, [...liste, aday]);
        toast.success(`${aday.name} rakip listene eklendi. Adı bir sonraki ölçümden itibaren aranır.`);
        onListChanged?.();
      }
      await load();
    } catch (err: any) {
      toast.error(err?.message ?? 'Rakip eklenemedi.');
    } finally {
      setEkleniyor(null);
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <SectionHeader
          as="h3"
          icon={Trophy}
          title="AI cevaplarında rakipler"
          description="Takip ettiğin soruların son ölçümünde kimin adı kaç cevapta geçti. Yeni ölçüm yapmaz; Prompt Lab’deki kayıtlı cevapları okur."
          actions={
            <div className="inline-flex gap-1.5" role="group" aria-label="Dönem">
              {([30, 90] as const).map((d) => (
                <FilterChip key={d} selected={days === d} onClick={() => setDays(d)}>{d}g</FilterChip>
              ))}
            </div>
          }
        />

        {loading && !data ? (
          <div className="space-y-2" aria-busy="true" aria-label="Yükleniyor">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : hata ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            {hata}{' '}
            <button type="button" onClick={load} className="text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground">Yeniden dene</button>
          </div>
        ) : !olcumVar(data) ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            Son {days} günde ölçülmüş soru yok. Sorularını{' '}
            <Link href={siteHref(siteId, 'geoLab') as any} className="text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground">GEO Lab’deki Prompt Lab</Link>
            ’e ekleyip ölçtüğünde rakipler burada sıralanır.
          </div>
        ) : data && (
          <>
            <p className="v-rail">{ozetMetni(data.totals)}</p>

            <div className="-mx-5 overflow-x-auto px-5">
              <table className="w-full min-w-[48rem] text-left">
                <thead>
                  <tr className="text-xs font-medium text-muted-foreground">
                    <th className="pb-2 pl-3 pr-2 font-medium">#</th>
                    <th className="pb-2 pr-3 font-medium">Ad</th>
                    <th className="pb-2 pr-3 font-medium">Adının geçtiği cevap</th>
                    <th className="hidden pb-2 pr-3 font-medium sm:table-cell" title="Adının geçtiği cevapların, ölçülen bütün cevaplara oranı">Pay</th>
                    <th className="pb-2 pr-3 font-medium">Soru</th>
                    <th className="pb-2 pr-3 font-medium">Asistanlar</th>
                    <th className="pb-2 pr-3 font-medium" title="Sitesinin kaynak olarak gösterildiği cevap sayısı">Kaynak</th>
                    <th className="pb-2 pr-3 font-medium" title="Aynı soru ve asistanın bir önceki ölçümüne göre">Önceki ölçüme göre</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, i) => (
                    <Satir
                      key={`${row.isBrand ? 'marka' : 'rakip'}:${row.name}`}
                      row={row}
                      sira={i + 1}
                      toplam={data.totals.answers}
                      acik={acik === row.name}
                      onToggle={() => setAcik((v) => (v === row.name ? null : row.name))}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-label font-normal text-muted-foreground">
              Rakip adları ölçüm sırasında listende olanlar arasında aranır: listeye yeni eklediğin rakip bir sonraki ölçümden itibaren sayılır.
              “Kaynak” sütunu rakibin sitesinin kaç cevapta kaynak gösterildiğidir; adresi tanımlıysa eski ölçümlerde de dolar.
              {data.truncated && ' Çok fazla kayıt olduğu için yalnız en yeni ölçümler okundu.'}
            </p>

            {data.suggestions.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Listende olmayan, sık kaynak gösterilen siteler</h4>
                <p className="text-xs text-muted-foreground">Asistanların bu sorularda kaynak gösterdiği ama rakip listende bulunmayan siteler. Rakibinse ekle; adı sonraki ölçümlerde aranır.</p>
                <ul className="divide-y rounded-md border">
                  {data.suggestions.map((o) => (
                    <li key={o.domain} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
                      <span className="min-w-0 flex-1 basis-40 truncate font-mono text-sm">{o.domain}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{o.answers} cevap · {o.questions} soru</span>
                      <Asistanlar list={o.providers} />
                      <Button size="sm" variant="outline" onClick={() => ekle(o)} disabled={ekleniyor !== null}>
                        <Plus className="h-3.5 w-3.5 mr-1" aria-hidden /> {ekleniyor === o.domain ? 'Ekleniyor…' : 'Rakip olarak ekle'}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
