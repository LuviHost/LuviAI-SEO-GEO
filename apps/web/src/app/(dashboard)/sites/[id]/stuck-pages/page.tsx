'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { useSiteContext } from '../site-context';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { InfoTooltip } from '@/components/info-tooltip';
import { PlanLockedCard } from '@/components/plan-locked-card';
import { api } from '@/lib/api';
import { useEntitlements } from '@/lib/entitlements';
import {
  Wrench,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Eye,
  EyeOff,
  Undo2,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  X,
  Lightbulb,
  Send,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SectionHeader } from '@/components/ui/section-header';
import { Skeleton } from '@/components/ui/skeleton';
import { siteHref } from '@/lib/site-routes';
import { formatNum, formatPct } from '@/lib/format';
import {
  batchRecoveryNotice, pageOutcomeNote, pruneBatchSelection, queuedBatchNotice, queuedBatchSettledNotice,
  queuedPageBaseline, readBatchResponse, readStuckBatchStore, sharedPollBudget, stuckBatchStoreKey, stuckBatchWatcher,
  stuckRecheckPages, stuckRecoveryCopy, stuckRecoveryKind, summarizeBatchRecovery, visiblePageOutcome, type BatchPageOutcome,
  type QueuedPageBaseline, type StoredPageOutcome, type StoredQueuedPage, type StuckBatchWatcher, type TrackedQueuedPage,
} from '@/lib/stuck-recovery';
import { showNotice } from '@/lib/notice';

type StuckPageRow = Awaited<ReturnType<typeof api.listStuckPages>>[number];

// Durum tonlari token'dan — ham amber/blue/emerald/red yok
const NEUTRAL_CLS = 'bg-muted text-muted-foreground border-border';
const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  DETECTED:   { text: 'Tespit edildi', cls: 'bg-warning/10 text-warning border-warning/30' },
  RECOVERING: { text: 'Düzeltiliyor',  cls: 'bg-info/10 text-info border-info/30' },
  RECOVERED:  { text: 'Düzeltildi',    cls: 'bg-success/10 text-success border-success/30' },
  FAILED:     { text: 'Başarısız',     cls: 'bg-danger/10 text-danger border-danger/30' },
  REVERTED:   { text: 'Geri alındı',   cls: NEUTRAL_CLS },
  IGNORED:    { text: 'Gözardı',       cls: NEUTRAL_CLS },
};

// Status icin hover hint (title attribute). Gecisler api stuck-page-recovery.service.ts:
// makale duzeltmesi once RECOVERING kalir, yeniden yayin basarilinca RECOVERED olur;
// geri alma hemen REVERTED yazar, eski metin hicbir hedefe gidemezse geri alma geri alinir.
// Etki iddiasi yalniz olculen sey: 30 gun sonraki otomatik olcum (STUCK_PAGE_PERFORMANCE_CHECK).
function getStatusHint(status: string): string {
  switch (status) {
    case 'DETECTED':   return 'Henüz uygulanmış bir düzeltme yok. RanksUp sayfalarında AI Düzelt ile başlatabilirsin.';
    case 'RECOVERING': return 'Düzeltme hazırlanıyor ya da yazı yeniden yayınlanıyor. Yayın tamamlanınca sayfa “Düzeltildi” olur.';
    case 'RECOVERED':  return 'AI ile iyileştirildi ve sitende yayına alındı. Etkisi 30 gün sonra otomatik ölçülür.';
    case 'FAILED':     return 'Düzeltme tamamlanamadı: sayfa okunamadı ya da çok kısa, AI öneri üretemedi, önerilen cümleler sayfada bulunamadı, sayfa dosyası yazılamadı ya da yeniden yayın başarısız oldu (yayın hedefi hatası veya yayın öncesi kalite kontrolü).';
    case 'REVERTED':   return 'AI iyileştirmesi geri alındı; yazının eski hali yeniden yayınlanır. Eski hal hiçbir yayın hedefine gönderilemezse geri alma iptal edilir ve sayfa yeniden “Düzeltildi” görünür.';
    case 'IGNORED':    return 'Bu sayfa "dokunma" işaretiyle gözardı edildi.';
    default: return '';
  }
}

// Pozisyon icin beklenen CTR (Sistrix ortalamasi) — tooltip'lerde kullaniliyor
function expectedCtrFor(position: number): number {
  const map: Record<number, number> = {
    1: 27, 2: 15, 3: 11, 4: 8, 5: 6, 6: 4.5, 7: 3.5, 8: 3, 9: 2.5, 10: 2.5,
    11: 2, 12: 1.8, 13: 1.5, 14: 1.2, 15: 1,
  };
  const r = Math.max(1, Math.min(15, Math.round(position)));
  return map[r] ?? 1;
}

function ScoreBadge({ score }: { score: number }) {
  const cls = score >= 70
    ? 'bg-danger/10 text-danger border-danger/30'
    : score >= 50
    ? 'bg-warning/10 text-warning border-warning/30'
    : NEUTRAL_CLS;
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium', cls)}>
      <TrendingDown className="h-3 w-3" aria-hidden /> Öncelik {score}
    </span>
  );
}

// Kartta son eylemin sonucu — tonlar token'dan (lib/stuck-recovery.ts pageOutcomeNote)
const OUTCOME_TONE_CLS: Record<'success' | 'info' | 'warning' | 'danger', string> = {
  success: 'text-success',
  info: 'text-info',
  warning: 'text-warning',
  danger: 'text-danger',
};

function StuckPageCard({
  page,
  busy,
  queued,
  outcome,
  onRecover,
  onIgnore,
  onRevert,
  expanded,
  onToggle,
  selected,
  onSelect,
  selectable,
}: {
  page: StuckPageRow;
  busy: boolean;
  /** Toplu onarimla kuyruga alindi, sonucu bekleniyor */
  queued: boolean;
  /** Sayfanin son eyleminin sonucu (toplu onarim isi ya da tekil "AI Düzelt") */
  outcome: BatchPageOutcome | null;
  onRecover: () => void;
  onIgnore: () => void;
  onRevert: (recoveryId: string) => void;
  expanded: boolean;
  onToggle: () => void;
  selected: boolean;
  onSelect: () => void;
  selectable: boolean;
}) {
  const lastRecovery = page.recoveries?.[0];
  // Son kayit oneri mi, yayina giden duzeltme mi? Kayit bunu tasimaz; sayfa durumundan
  // cikar (lib/stuck-recovery.ts). Oneri notu: bu onerinin API'deki kesin nedeni (is sonucu
  // ya da "AI Duzelt" cevabi) biliniyorsa o, yoksa olasi nedenleri sayan notr metin — eski
  // not her oneriye "yerinde güncelleyemiyor" diyordu, WordPress icin yanlisti (S22).
  const recoveryKind = stuckRecoveryKind(page);
  const isProposal = recoveryKind === 'proposal';
  const copy = recoveryKind
    ? stuckRecoveryCopy(recoveryKind, !!page.articleId, outcome?.kind === 'proposal' ? outcome.reason : null)
    : null;
  const outcomeNote = !queued && outcome ? pageOutcomeNote(outcome) : null;
  const paragraph = lastRecovery?.paragraphAdded;
  const status = STATUS_LABEL[page.status] ?? STATUS_LABEL.DETECTED;
  const canRecover = page.status === 'DETECTED' || page.status === 'FAILED';
  const isRecovering = page.status === 'RECOVERING';
  // Geri alma yalniz RanksUp makalesinde var (eski govde yeniden yayinlanir); RanksUp disi
  // sayfanin dosyasini API geri yazmaz — dugme her seferinde hata verirdi
  const canRevert = page.status === 'RECOVERED' && !!page.articleId && lastRecovery && !lastRecovery.revertedAt;

  return (
    <Card className={cn('transition-all', expanded && 'ring-2 ring-brand/30', selected && 'ring-2 ring-brand/50 bg-brand/[0.02]')}>
      <CardContent className="p-5">
        <div className="flex items-start gap-4">
          {selectable && (
            <input
              type="checkbox"
              checked={selected}
              onChange={onSelect}
              className="mt-1 h-4 w-4 rounded border-2 border-muted-foreground/30 text-brand focus:ring-2 focus:ring-brand/30 cursor-pointer shrink-0"
              aria-label="Bu sayfayi sec"
            />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              <span
                className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium', status.cls)}
                title={getStatusHint(page.status)}
              >
                {status.text}
              </span>
              <span title={`Öncelik skoru (0-100): ${page.stuckScore}. Yüksek = daha çok kurtarmaya değer. Formül: impressions × CTR boşluğu × pozisyon.`}>
                <ScoreBadge score={page.stuckScore} />
              </span>
              {page.articleId === null && (
                <span
                  className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium', NEUTRAL_CLS)}
                  title="Bu sayfa RanksUp ile değil, sitende elle yazılmış. Otomatik güncelleme yalnız FTP / SFTP / cPanel ile bağlı statik HTML sitelerde, sayfanın dosyası doğrulanınca yapılır. WordPress ve diğer içerik yönetim sistemlerinde sayfa otomatik yazılmaz; öneriler elle uygulanır."
                >
                  <AlertTriangle className="h-3 w-3" /> RanksUp dışı
                </span>
              )}
              {isProposal && (
                <span
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium bg-info/10 text-info border-info/30"
                  title="Değişiklik önerileri hazırlandı ama sitene yazılmadı. Detay'dan görüp sayfana elle uygula."
                >
                  <Lightbulb className="h-3 w-3" aria-hidden /> Öneri hazır
                </span>
              )}
            </div>
            <h3 className="font-semibold text-base truncate">{page.title || page.url}</h3>
            <a href={page.url} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground hover:underline truncate block">
              {page.url}
            </a>
            {queued && (
              <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                Sırada: sonuç hazır olunca burada görünür.
              </p>
            )}
            {outcomeNote && (
              <p className={cn('mt-1.5 text-xs', OUTCOME_TONE_CLS[outcomeNote.tone])} role="status">
                <span className="font-medium">Son deneme:</span> {outcomeNote.text}
              </p>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-xs">
              <div>
                <div className="text-muted-foreground inline-flex items-center gap-1">
                  Pozisyon
                  <InfoTooltip text={`Google'da ortalama sıralama. Şu an #${Math.round(page.position)}. Top 3'e çıkması hedefleniyor — biraz iyileştirmeyle ulaşılabilir mesafede.`} />
                </div>
                <div className="font-semibold">#{Math.round(page.position)}</div>
              </div>
              <div>
                <div className="text-muted-foreground inline-flex items-center gap-1">
                  Gösterim (30g)
                  <InfoTooltip text="Son 30 günde Google arama sonuçlarında bu sayfa kaç kez gösterildi. Yüksek = sayfa zaten görünüyor, sadece tıklama almıyor." />
                </div>
                <div className="font-semibold tabular-nums">{formatNum(page.impressions)}</div>
              </div>
              <div>
                <div className="text-muted-foreground inline-flex items-center gap-1">
                  Tıklama oranı
                  <InfoTooltip text={`Görenlerin yüzde kaçı tıkladı. Pozisyon #${Math.round(page.position)} için beklenen CTR ~%${expectedCtrFor(page.position).toFixed(1)}. Şu anki: %${(page.ctr * 100).toFixed(2)}. Aradaki fark = kayıp potansiyel.`} />
                </div>
                <div className="font-semibold tabular-nums">{formatPct(page.ctr, 2)}</div>
              </div>
              <div>
                <div className="text-muted-foreground inline-flex items-center gap-1">
                  Tıklama
                  <InfoTooltip text="Son 30 günde gerçek tıklama sayısı (Search Console). Düzeltmenin etkisi 30 gün sonra otomatik ölçülür." />
                </div>
                <div className="font-semibold tabular-nums">{formatNum(page.clicks)}</div>
              </div>
            </div>
            {Array.isArray(page.topQueries) && page.topQueries.length > 0 && (
              <div className="mt-3">
                <div className="flex items-center gap-1 text-label text-muted-foreground mb-1.5">
                  <span>En çok gösterim alan sorgular</span>
                  <InfoTooltip text="Bu sayfanın çıktığı arama terimleri (GSC son 30 gün). AI recovery bu sorgulara optimize cümle önerileri üretir." />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {page.topQueries.slice(0, 5).map((q) => (
                    <span key={q} className="text-label px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {q}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1.5 shrink-0">
            {canRecover && page.articleId && (
              <Button
                onClick={onRecover} disabled={busy} size="sm" className="gap-1.5"
                title="Cümle düzeyinde düzenleme, yaklaşık 30 saniye. Başlık, adres ve yapı korunur; yalnız eksik anahtar kelimeler doğal akışta eklenir. RanksUp yazıyı takılı adreste güvenle güncelleyemezse (yazı sitende değiştirilmiş, kayıtlı adres takılı adresle eşleşmiyor ya da yayın hedefi yerinde güncellemeyi desteklemiyor) değişiklikler yalnız öneri olarak kaydedilir."
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                AI Düzelt
              </Button>
            )}
            {canRecover && !page.articleId && (
              <Link
                href={siteHref(page.siteId, 'publishTargets') as any}
                title="RanksUp dışı bir sayfanın otomatik güncellenmesi için statik HTML sitende FTP / SFTP / cPanel yayın hedefi gerekir. WordPress ve diğer içerik yönetim sistemlerinde sayfa otomatik yazılmaz."
                className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-md text-xs font-medium border border-dashed border-brand/40 text-brand hover:bg-brand/10 transition-colors"
              >
                <Send className="h-3.5 w-3.5" aria-hidden /> Yayın hedefi bağla
              </Link>
            )}
            {isRecovering && (
              <Button disabled size="sm" variant="outline" className="gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Çalışıyor
              </Button>
            )}
            {canRevert && (
              <Button
                onClick={() => onRevert(lastRecovery!.id)} disabled={busy} size="sm" variant="outline" className="gap-1.5"
                title="Yazıyı düzeltme öncesi haline döndürür ve yayında olduğu hedeflerde yeniden yayınlar. Yalnız son düzeltme geri alınabilir."
              >
                <Undo2 className="h-3.5 w-3.5" /> Geri Al
              </Button>
            )}
            {page.status === 'DETECTED' && (
              <Button
                onClick={onIgnore} disabled={busy} size="sm" variant="ghost" className="gap-1.5 text-muted-foreground"
                title="Bu sayfayı bir daha öneri listesinde gösterme. Detay'dan tekrar açabilirsin."
              >
                <EyeOff className="h-3.5 w-3.5" /> Gözardı
              </Button>
            )}
            {(page.recoveries?.length ?? 0) > 0 && (
              <Button
                onClick={onToggle} size="sm" variant="ghost" className="gap-1.5"
                title="Son kayıt: önerilen ya da uygulanan cümle değişiklikleri, varlıklar, öncesi ve sonrası."
              >
                <Eye className="h-3.5 w-3.5" /> {expanded ? 'Detay Kapat' : 'Detay'}
              </Button>
            )}
          </div>
        </div>

        {expanded && lastRecovery && copy && (
          <div className="mt-4 pt-4 border-t space-y-3">
            <div className="flex items-center gap-2">
              {recoveryKind === 'proposal'
                ? <Lightbulb className="h-4 w-4 text-info" aria-hidden />
                : recoveryKind === 'applied'
                  ? <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
                  : recoveryKind === 'pending'
                    ? <RefreshCw className="h-4 w-4 text-info" aria-hidden />
                    : <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />}
              <span className="text-sm font-medium">
                {copy.heading} — {new Date(lastRecovery.appliedAt).toLocaleString('tr-TR')}
              </span>
            </div>
            {copy.note && (
              <p className="text-xs text-muted-foreground">{copy.note}</p>
            )}
            <div className="text-xs">
              <span className="text-muted-foreground">{copy.entitiesLabel}</span>{' '}
              {Array.isArray(lastRecovery.entitiesAdded) && lastRecovery.entitiesAdded.length > 0 ? (
                lastRecovery.entitiesAdded.map((e: string) => (
                  <span key={e} className="inline-block ml-1 px-1.5 py-0.5 rounded bg-success/10 text-success text-label">
                    {e}
                  </span>
                ))
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </div>
            {Array.isArray(lastRecovery.edits) && lastRecovery.edits.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium">
                  {copy.editsLabel} ({lastRecovery.edits.length}):
                </div>
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {lastRecovery.edits.map((e: any, i: number) => (
                    <div key={i} className="rounded-lg border bg-muted/30 p-3 text-xs">
                      <div className="text-danger line-through">{e.before}</div>
                      <div className="text-success mt-1">+ {e.after}</div>
                      {e.reason && <div className="mt-1.5 text-muted-foreground italic">{e.reason}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {paragraph && (
              <div className="space-y-1 text-xs">
                <div className="font-medium">{copy.paragraphLabel}</div>
                <div className="rounded-lg border bg-muted/30 p-3 text-success">+ {paragraph}</div>
              </div>
            )}
            {lastRecovery.revertedAt && (
              <div className="text-xs text-muted-foreground">
                Geri alındı: {new Date(lastRecovery.revertedAt).toLocaleString('tr-TR')}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Guide content — kullanici bu sayfayi anlamak icin
const GUIDE_STEPS = [
  {
    icon: TrendingDown,
    title: 'Takılı sayfa nedir?',
    body: 'Google\'da ilk sayfada (4–15. sıra) ama ilk 3\'te değil. Küçük iyileştirmelerle yukarı çıkabilir.',
  },
  {
    icon: Sparkles,
    title: 'AI ne yapıyor?',
    body: 'Cümle düzeyinde düzenler: eksik anahtar kelimeleri doğal akışta ekler, zayıf paragrafları genişletir. Başlık, adres ve sayfa yapısı değişmez.',
  },
  {
    icon: Send,
    title: 'Etki ne zaman?',
    // Yayin ikinci asamada (api stuck-page-recovery.service.ts republish); dogrulanmamis
    // "Google 24-48 saatte tarar" iddiasi yerine olculen tek sey: 30 gunluk otomatik olcum
    body: 'Düzeltilen yazı yayın sırasına alınır; yayında olduğu hedefte yerinde güncellenince sayfa “Düzeltildi” olur. RanksUp yazıyı takılı adreste güvenle güncelleyemezse (örneğin yazı sitende değiştirilmişse ya da kayıtlı adres takılı adresle eşleşmiyorsa) değişiklikler öneri olarak kaydedilir. Etkisi 30 gün sonra otomatik ölçülür.',
  },
  {
    icon: AlertTriangle,
    title: '"RanksUp dışı" rozeti?',
    body: 'Bu sayfa RanksUp ile yazılmamış. Otomatik güncelleme yalnız FTP, SFTP ya da cPanel ile bağlı statik HTML sitelerde, sayfanın dosyası doğrulandığında yapılır. WordPress ve diğer içerik yönetim sistemlerinde sayfa otomatik yazılmaz; öneriler sayfaya elle uygulanır.',
  },
];

export default function StuckPagesPage() {
  const { site } = useSiteContext();
  const [rows, setRows] = useState<StuckPageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<'all' | 'DETECTED' | 'RECOVERED' | 'FAILED' | 'IGNORED'>('all');
  // ENH#3 — Bulk recovery: multi-select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Guide visibility — localStorage persist
  const [showGuide, setShowGuide] = useState(true);
  useEffect(() => {
    try {
      const dismissed = window.localStorage.getItem('luviai_stuck_guide_dismissed');
      if (dismissed === '1') setShowGuide(false);
    } catch {/* noop */}
  }, []);
  const dismissGuide = () => {
    setShowGuide(false);
    try { window.localStorage.setItem('luviai_stuck_guide_dismissed', '1'); } catch {/* noop */}
  };
  const restoreGuide = () => {
    setShowGuide(true);
    try { window.localStorage.removeItem('luviai_stuck_guide_dismissed'); } catch {/* noop */}
  };
  const [bulkBusy, setBulkBusy] = useState(false);
  // Toplu onarimla kuyruga alinip sonucu beklenen sayfalar (lib/stuck-recovery.ts C4/D4):
  // kartlari mesgul, secilemez; her sayfa kendi sonucu gelince (is kaydi ya da liste)
  // serbest kalir. Tarayicida da tutulur: sayfa yenilenince kart "sırada" kalir, yoklama surer.
  const [tracked, setTracked] = useState<Record<string, StoredQueuedPage>>({});
  const queuedIds = useMemo(() => new Set(Object.keys(tracked)), [tracked]);
  // Sayfanin son eyleminin sonucu (toplu ya da tekil) — kartta kisa not, oneride kesin neden
  const [outcomes, setOutcomes] = useState<Record<string, StoredPageOutcome>>({});
  // Depo bu site icin okundu mu (okunmadan yazilirsa onceki kayit silinirdi)
  const storeSite = useRef<string | null>(null);
  // Gosterilen site: baska siteye gecilince onceki sitenin yoklamasi durur
  const siteRef = useRef(site.id);
  siteRef.current = site.id;
  // Sayfadan cikilinca yoklama dursun, gec gelen sonuc state yazmasin
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const { can, requirementFor } = useEntitlements();
  const allowed = can('stuckPages');

  // Tazelenen satirlar doner (toplu onarim sonucu bu durumlarla siniflanir); okunamazsa null.
  // silent: yoklama — iskelet gosterilmez, hata bildirimi atilmaz (bir sonraki turda yeniden denenir)
  const refresh = useCallback(async (opts: { silent?: boolean } = {}): Promise<StuckPageRow[] | null> => {
    if (!opts.silent) setLoading(true);
    try {
      const data = await api.listStuckPages(site.id);
      if (alive.current) setRows(data);
      return data;
    } catch (err: any) {
      if (!opts.silent) toast.error(err.message || 'Liste alınamadı');
      return null;
    } finally {
      if (!opts.silent && alive.current) setLoading(false);
    }
  }, [site.id]);

  // Haklar KESIN gelene kadar istek atilmaz — kapali planda bos 200/403 gurultusu olmasin.
  useEffect(() => {
    if (allowed !== true) return;
    refresh();
  }, [refresh, allowed]);

  /**
   * Sayfanin son eyleminin sonucunu yazar; status sonucun ait oldugu sayfa durumu, extra.recoveryId
   * sonucun ait oldugu son kurtarma kaydi (undefined: bilinmiyor, kart denetlemez). Sure dolup
   * 'unknown' kalan sayfanin is kimligi de saklanir: sayfa yenilenince is kaydi yeniden okunur.
   */
  const recordOutcome = useCallback((
    id: string,
    outcome: BatchPageOutcome,
    status: string | null,
    extra: { recoveryId?: string | null; jobId?: string | null; base?: QueuedPageBaseline; recheck?: boolean } = {},
  ) => {
    setOutcomes((prev) => {
      // Yenileme okumasi isi hala bitmemis buldu: onceki 'unknown' kaydi ilk zamaniyla kalir
      // (her yenileme 2 saatlik sureyi uzatmasin)
      if (extra.recheck && outcome.kind === 'unknown') return prev;
      const kayit: StoredPageOutcome = { outcome, status, at: Date.now() };
      if (extra.recoveryId !== undefined) kayit.recoveryId = extra.recoveryId;
      if (outcome.kind === 'unknown' && extra.jobId && extra.base) {
        kayit.jobId = extra.jobId;
        kayit.base = extra.base;
      }
      return { ...prev, [id]: kayit };
    });
  }, []);

  // Site basina TEK yoklayici (lib/stuck-recovery.ts stuckBatchWatcher). NEDEN: her gonderim ve
  // her sayfa yenileme kendi dongusunu kendi istek butcesiyle calistiriyordu; iki gonderim +
  // ikinci sekme dakikada ~70 istek atiyor, API'nin dakikada 60 siniri kullanicinin kendi
  // isteklerine 429 donduruyordu (S13 yan etkisi). Yeni gonderim calisan donguye katilir;
  // sekmeler arasi tavan localStorage'daki paylasilan butceyle (sharedPollBudget).
  const watcherRef = useRef<{ siteId: string; w: StuckBatchWatcher } | null>(null);

  /**
   * Kuyruktaki sayfalarin sonucunu okur: her sayfa sonucu gelince serbest kalir ve kartinda
   * sonucu (atlandiysa nedeni) gorunur; hicbiri beklemeyince ozet bildirilir. Eskiden atlanan
   * tek bir sayfa butun secimi 15 dk mesgul tutuyor, ozet hic gelmiyordu (S13).
   */
  const watchQueued = useCallback((pages: TrackedQueuedPage[]) => {
    if (pages.length === 0) return;
    let izleyici = watcherRef.current;
    if (!izleyici || izleyici.siteId !== site.id) {
      const siteId = site.id;
      // Yerine yenisi kurulan yoklayicinin dongusu de durur (A → B → A gecisinde iki dongu olmasin)
      const gecerli = (): boolean => alive.current && siteRef.current === siteId && watcherRef.current?.w === w;
      let depo: Storage | null = null;
      try {
        depo = window.localStorage;
      } catch {
        depo = null;
      }
      const w = stuckBatchWatcher({
        load: () => refresh({ silent: true }),
        getJob: (jobId) => api.getJob(jobId),
        isAlive: gecerli,
        budget: sharedPollBudget(depo),
        onSettle: (id, outcome, status, info) => {
          if (!gecerli()) return;
          setTracked((prev) => {
            if (!(id in prev)) return prev;
            const next = { ...prev };
            delete next[id];
            return next;
          });
          recordOutcome(id, outcome, status, info);
        },
        onAllSettled: (all) => {
          if (gecerli()) showNotice(queuedBatchSettledNotice(all.values()));
        },
      });
      izleyici = { siteId, w };
      watcherRef.current = izleyici;
    }
    izleyici.w.add(pages);
  }, [site.id, refresh, recordOutcome]);

  // Sayfa yenilendiyse: sirada bekleyen sayfalar ve son sonuclar tarayicidan geri gelir,
  // bekleyenlerin yoklamasi surer. Suresi dolup "Sonuç henüz gelmedi" kalan sayfalarin is
  // kaydi bir kez yeniden okunur — kart notunun "yenileyince güncel durumu görürsün" sozu
  // budur; eskiden yenileme isi hic okumuyordu (S13 yan etkisi). Depolama yoksa (gizli
  // pencere, engelli site verisi) liste sunucudaki durumla calisir; API ayni sayfaya ikinci
  // isi zaten reddeder (D4).
  useEffect(() => {
    if (allowed !== true || storeSite.current === site.id) return;
    storeSite.current = site.id;
    let store;
    try {
      store = readStuckBatchStore(window.localStorage.getItem(stuckBatchStoreKey(site.id)), Date.now());
    } catch {
      return;
    }
    setOutcomes(store.outcomes);
    setTracked(Object.fromEntries(store.pages.map((p) => [p.id, p])));
    watchQueued([...store.pages, ...stuckRecheckPages(store.outcomes, store.pages)]);
  }, [allowed, site.id, watchQueued]);

  useEffect(() => {
    if (storeSite.current !== site.id) return;
    try {
      const key = stuckBatchStoreKey(site.id);
      const pages = Object.values(tracked);
      if (pages.length === 0 && Object.keys(outcomes).length === 0) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, JSON.stringify({ pages, outcomes }));
    } catch {/* depolama yok — yalniz bu oturum */}
  }, [tracked, outcomes, site.id]);

  const handleDetect = async () => {
    setDetecting(true);
    try {
      const result = await api.detectStuckPages(site.id);
      if (result.found === 0) {
        toast.success('Tarama tamam — takılı sayfa bulunmadı');
      } else {
        toast.success(`${result.found} takılı sayfa bulundu (${result.created} yeni)`);
      }
      await refresh();
    } catch (err: any) {
      toast.error(err.message || 'Tarama başarısız');
    } finally {
      setDetecting(false);
    }
  };

  const setBusy = (id: string, busy: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id); else next.delete(id);
      return next;
    });
  };

  const handleRecover = async (id: string) => {
    setBusy(id, true);
    // RanksUp makalesi yeniden yayin isiyle, RanksUp disi sayfa dogrulanmis statik
    // dosyaya dogrudan yazilarak duzelir (yayin isi yok) — basari metni buna gore
    const isArticle = !!rows.find((row) => row.id === id)?.articleId;
    try {
      const r = await api.recoverStuckPage(site.id, id);
      let outcome: BatchPageOutcome;
      if (r.success) {
        // Makalede sayfa yeniden yayin basarilinca "Duzeltildi" olur (o ana kadar RECOVERING)
        toast.success(isArticle
          ? `${r.editsCount} değişiklik yazıya uygulandı; yeniden yayın kuyruğa alındı. Yayın tamamlanınca sayfa “Düzeltildi” olur.`
          : `Düzeltildi: ${r.editsCount} değişiklik sayfa dosyasına yazıldı.`);
        outcome = isArticle ? { kind: 'republishing' } : { kind: 'recovered' };
      } else if (r.manual) {
        // Sitede hicbir sey degismedi, oneri kaydedildi: RanksUp disi sayfa otomatik
        // yazilamadi ya da makale yazisi takili adreste guvenle guncellenemedi (neden API
        // metninde; api stuck-page-*-recovery.service.ts). Basarisizlik degil; "Tespit edildi"de.
        toast.message('Öneri kaydedildi; elle uygula', { description: r.reason });
        outcome = { kind: 'proposal', reason: r.reason?.trim() || null };
      } else if (r.skipped) {
        // Sayfa bu istekte islenmedi, hicbir sey degismedi (or. zaten isleniyor ya da
        // duzeltildi): API'nin Turkce nedeni oldugu gibi (sozlesme C5) — "basarisiz" degil
        toast.message(r.reason || 'Bu sayfa şu an işlenmedi; hiçbir şey değişmedi.');
        outcome = { kind: 'skipped', reason: r.reason?.trim() || 'Bu sayfa şu an işlenmedi; hiçbir şey değişmedi.' };
      } else {
        toast.error(`Düzeltme başarısız: ${r.reason ?? 'bilinmiyor'}`);
        outcome = { kind: 'failed', reason: r.reason?.trim() || null };
      }
      const after = await refresh();
      const satir = after?.find((row) => row.id === id);
      // Kartta da kalsin: oneride kesin neden Detay notunda (toast kaybolunca da gorunur). Not
      // kendi kaydina baglanir: oneri / uygulama API'nin actigi kayda (r.recoveryId), digerleri
      // listedeki son kayda; baska cihazdan sonraki yeni oneri bu notla gosterilmez (S22).
      // Liste okunamadiysa son kayit bilinmiyor (undefined): kart denetlemez.
      const kendiKaydi = outcome.kind === 'proposal' || outcome.kind === 'republishing' || outcome.kind === 'recovered'
        ? r.recoveryId ?? undefined
        : undefined;
      const listedeki = after ? satir?.recoveries?.[0]?.id ?? null : undefined;
      recordOutcome(id, outcome, satir?.status ?? null, { recoveryId: kendiKaydi ?? listedeki });
    } catch (err: any) {
      toast.error(err.message || 'Onarım başarısız');
      // Istek zaman asimina ugradiysa sunucu onarimi yine de surduruyor olabilir: kart
      // durumu tazelenir (RECOVERING gorunur), kor yeniden deneme davet edilmez
      void refresh({ silent: true });
    } finally {
      setBusy(id, false);
    }
  };

  const handleIgnore = async (id: string) => {
    setBusy(id, true);
    try {
      await api.ignoreStuckPage(site.id, id);
      toast.success('Bu sayfa gözardı edildi');
      await refresh();
    } catch (err: any) {
      toast.error(err.message || 'İşlem hata');
    } finally {
      setBusy(id, false);
    }
  };

  // ENH#3 — Bulk recovery
  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllVisible = (ids: string[]) => {
    setSelectedIds(new Set(ids));
  };

  const clearSelection = () => setSelectedIds(new Set());

  /**
   * Toplu onarim KUYRUGA alinir (sozlesme C4/D4): uc her uygun sayfa icin bir is acip hemen
   * doner, duzeltme arka planda calisir. Eskiden tum LLM onarimlari tek istekte sirayla
   * calisiyordu; ~100 sn'lik vekil siniri istegi kesiyor, panel "tekrar dene" derken
   * sunucu duzenlemeye devam ediyordu. Kuyruga alinmayan sayfanin nedeni HEMEN kartinda;
   * kuyruktaki her sayfanin sonucu is kaydindan (jobId) ve listeden okunur (watchQueued).
   */
  const handleBulkRecover = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    // Kuyruga alindigi andaki durum: sonuc bundan ayrisinca okunur (yeni kayit, durum)
    const before = new Map(rows.map((row) => [row.id, row]));
    setBulkBusy(true);
    try {
      const raw = await api.recoverStuckPagesBatch(site.id, ids);
      clearSelection();
      const view = readBatchResponse(raw);
      if (view.kind === 'legacy') {
        // Eski (senkron) API — dagitim aninda: sonuc tazelenen durumlarla, ozet sunucudan (K1)
        const after = await refresh();
        const statusOf = new Map((after ?? []).map((row) => [row.id, row.status]));
        showNotice(batchRecoveryNotice(summarizeBatchRecovery(view.results, (id) => statusOf.get(id), view.summary)));
        return;
      }
      showNotice(queuedBatchNotice(view));
      const t = Date.now();
      // Kuyruga alinmayan sayfalar (D4: is kosarken atlanacagi belli olan, durumu uygun
      // olmayan, sinir ustu, kuyruga yazilamayan): API nedeni hemen kartinda. Zaten sirada
      // olan sayfa (bekleyen isin kimligiyle doner) "islenmedi" degil: o is izlenir.
      const alinmayan = view.rows.filter((r) => !r.queued && !r.alreadyQueued && r.id);
      if (alinmayan.length > 0) {
        setOutcomes((prev) => ({
          ...prev,
          ...Object.fromEntries(alinmayan.map((r): [string, StoredPageOutcome] => [r.id, {
            outcome: { kind: 'notProcessed', reason: r.message },
            status: before.get(r.id)?.status ?? null,
            at: t,
            // Not o anki son kayda bagli: sonradan acilan kayit (baska cihazdan oneri) notu eskitir
            recoveryId: before.get(r.id)?.recoveries?.[0]?.id ?? null,
          }])),
        }));
      }
      const pages: StoredQueuedPage[] = view.rows
        .filter((r) => (r.queued || r.alreadyQueued) && r.id && !(r.id in tracked))
        .map((r) => ({ id: r.id, jobId: r.jobId, base: queuedPageBaseline(r.id, before.get(r.id)), queuedAt: t }));
      if (pages.length === 0) {
        await refresh({ silent: true });
        return;
      }
      setTracked((prev) => ({ ...prev, ...Object.fromEntries(pages.map((p) => [p.id, p])) }));
      // Yeni is basladi: onceki denemenin notu kalkar
      setOutcomes((prev) => {
        const next = { ...prev };
        for (const p of pages) delete next[p.id];
        return next;
      });
      watchQueued(pages);
    } catch (err: any) {
      toast.error(err.message || 'Toplu onarım başlatılamadı');
      // Istek zaman asimina ugradiysa sunucu isleri yine de almis olabilir: liste tazelenir,
      // artik uygun olmayan (isleniyor / duzeltildi) sayfalar secimden cikar — kor yeniden
      // deneme ayni yazilari ikinci kez duzenlemesin
      const after = await refresh({ silent: true });
      if (after && alive.current) setSelectedIds((prev) => pruneBatchSelection(prev, after));
    } finally {
      if (alive.current) setBulkBusy(false);
    }
  };

  const handleRevert = async (stuckPageId: string, recoveryId: string) => {
    setBusy(stuckPageId, true);
    try {
      await api.revertStuckPageRecovery(site.id, recoveryId);
      // API eski metni geri yukleyip yeniden yayini kuyruga atar; yayin hicbir hedefe
      // gidemezse geri almayi geri alir (stuck-page-recovery.service.ts republishFailed)
      toast.success('Onarım geri alındı; yazının eski hali yeniden yayın sırasına alındı.');
      await refresh();
    } catch (err: any) {
      toast.error(err.message || 'Geri alma başarısız');
    } finally {
      setBusy(stuckPageId, false);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const filteredRows = useMemo(() => {
    if (filter === 'all') return rows;
    return rows.filter((r) => r.status === filter);
  }, [rows, filter]);

  const counts = useMemo(() => {
    const c = { total: rows.length, detected: 0, recovered: 0, failed: 0, ignored: 0 };
    for (const r of rows) {
      if (r.status === 'DETECTED') c.detected++;
      else if (r.status === 'RECOVERED') c.recovered++;
      else if (r.status === 'FAILED') c.failed++;
      else if (r.status === 'IGNORED') c.ignored++;
    }
    return c;
  }, [rows]);

  if (allowed === false) {
    return (
      <PlanLockedCard
        requirement={requirementFor('stuckPages')}
        description="Sıralaması takılmış sayfaları tespit eder ve tek tıkla toplu kurtarma uygular."
      />
    );
  }

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={Wrench}
        title={
          <span className="inline-flex items-center gap-2">
            Takılı Sayfalar
            <InfoTooltip text="Google'da ilk sayfada (sıra 4-15) ama ilk 3'te olmayan sayfalar. Tarama her hafta otomatik (Pazartesi 06:00 UTC) yapılır; elle başlatmak için sağ üstteki 'Yeniden tara'." />
          </span>
        }
        description={
          <>
            Google&apos;da ilk sayfada ama ilk 3&apos;te değil — AI cümle düzeyinde onarır, başlık ve yapı korunur.
            {!showGuide && (
              <>
                {' · '}
                <button type="button" onClick={restoreGuide} className="text-brand hover:underline">
                  Nasıl çalışır?
                </button>
              </>
            )}
          </>
        }
        actions={
          <Button onClick={handleDetect} disabled={detecting} variant="outline" size="sm">
            <RefreshCw className={cn('h-4 w-4 mr-1.5', detecting && 'animate-spin')} aria-hidden />
            {detecting ? 'Taranıyor…' : 'Yeniden tara'}
          </Button>
        }
      />

      {/* "Nasıl çalışır" guide — dismissible, localStorage persist */}
      {showGuide && (
        <Card className="bg-muted/20">
          <CardContent className="p-5">
            <div className="flex items-start gap-3 mb-4">
              <Lightbulb className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" aria-hidden />
              <div className="flex-1">
                <p className="font-brand font-semibold text-sm">Nasıl çalışır?</p>
              </div>
              <button
                onClick={dismissGuide}
                className="h-7 w-7 rounded-full grid place-items-center text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                aria-label="Rehberi kapat"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {GUIDE_STEPS.map((s, i) => {
                const Icon = s.icon;
                return (
                  <div key={i} className="flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-lg border border-border bg-muted/50 text-foreground/70 grid place-items-center shrink-0">
                        <Icon className="h-3.5 w-3.5" />
                      </div>
                      <p className="text-sm font-medium tracking-[-0.01em]">{s.title}</p>
                    </div>
                    <p className="text-xs text-muted-foreground leading-[1.55]">{s.body}</p>
                  </div>
                );
              })}
            </div>
            <div className="mt-4 pt-4 border-t border-border/60 flex items-center justify-between gap-3 flex-wrap text-xs">
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                İlk önce <strong className="text-foreground">en yüksek gösterim alan</strong> sayfayı dene — etki orada daha hızlı görünür.
              </span>
              <Link href={siteHref(site.id, 'publishTargets') as any} className="text-brand hover:underline font-medium inline-flex items-center gap-1">
                <Send className="h-3 w-3" /> Yayın hedefi ekle
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* KPI filtreleri — buton + bilgi ipucu kardes (ic ice buton yok), aria-pressed */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3" role="group" aria-label="Duruma göre filtrele">
        <KpiCard
          label="Toplam"
          tooltip="Algılanan tüm takılı sayfalar — tespit, düzeltildi, başarısız ve gözardı toplamı."
          value={counts.total} active={filter === 'all'} onClick={() => setFilter('all')}
        />
        {/* Otomatik kurtarma: haftalik tarama, yalniz akis acik + Tam otomatik, yalniz
            yayin hedefi yaziyi yerinde guncelleyebilen RanksUp makalesi, site basina en
            fazla 5 (api audit/stuck-page-autopilot.ts runStuckPageSweep) */}
        <KpiCard
          label="Tespit"
          tooltip={'Henüz uygulanmış bir düzeltme yok. Otomatik akış açık ve Tam otomatik moddaysa RanksUp ile yazılmış sayfalar her hafta otomatik düzeltilip yeniden yayınlanır (yalnız yayında olduğu hedefte yerinde güncellenebilen yazılar, site başına en fazla 5 sayfa); Yarı otomatikte "AI Düzelt" ile sen başlatırsın. Otomatik yazılamayan sayfalar için hazırlanan öneriler de burada, Detay\'da durur.'}
          value={counts.detected} active={filter === 'DETECTED'} onClick={() => setFilter('DETECTED')} accent="warning"
        />
        <KpiCard
          label="Düzeltildi"
          tooltip="AI ile cümle düzeyinde iyileştirme uygulandı ve sayfa sitende güncellendi. Etkisi 30 gün sonra otomatik ölçülür."
          value={counts.recovered} active={filter === 'RECOVERED'} onClick={() => setFilter('RECOVERED')} accent="success"
        />
        <KpiCard
          label="Başarısız"
          tooltip="Düzeltme tamamlanamadı: sayfa okunamadı ya da çok kısa, AI öneri üretemedi, önerilen cümleler sayfada bulunamadı, sayfa dosyası yazılamadı ya da yeniden yayın başarısız oldu. Sitede değişiklik yapılamadığı için hazırlanan öneriler başarısız sayılmaz; 'Tespit' altında, Detay'da durur."
          value={counts.failed} active={filter === 'FAILED'} onClick={() => setFilter('FAILED')} accent="danger"
        />
        <KpiCard
          label="Gözardı"
          tooltip="'Bu sayfaya dokunulmasın' diye işaretledin. Listede bir daha öneri olarak çıkmaz, ama Detay'dan tekrar açabilirsin."
          value={counts.ignored} active={filter === 'IGNORED'} onClick={() => setFilter('IGNORED')} accent="muted"
        />
      </div>

      {/* ENH#3 — Bulk toolbar: DETECTED durumdaki secilecek sayfa varsa goster */}
      {filteredRows.some((r) => r.status === 'DETECTED' && r.articleId) && (
        <Card className="border-brand/30 bg-brand/5">
          <CardContent className="p-3 flex items-center gap-3 flex-wrap">
            <div className="text-sm flex-1 min-w-0 inline-flex items-center gap-1.5">
              <span className="font-semibold">{selectedIds.size}</span>{' '}
              sayfa seçili
              <InfoTooltip text="Toplu düzeltmeye yalnız 'Tespit edildi' durumundaki RanksUp sayfaları alınır; RanksUp dışı sayfalar toplu düzeltilmez. Sıraya alınan sayfalar arka planda sırayla işlenir; her sayfanın sonucu hazır olunca kartında görünür. Sırada bekleyen bir sayfa yeniden sıraya alınmaz." />
              {selectedIds.size > 0 && (
                <button type="button" onClick={clearSelection} className="ml-2 text-xs text-muted-foreground hover:text-foreground underline">
                  temizle
                </button>
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => selectAllVisible(
                filteredRows.filter((r) => r.status === 'DETECTED' && r.articleId && !queuedIds.has(r.id)).map((r) => r.id),
              )}
              title="Görünür listedeki tüm DETECTED + RanksUp içi sayfaları seç (filter aktifse sadece filtreli olanlar; sıradaki sayfalar hariç)"
            >
              Tümünü seç (DETECTED)
            </Button>
            <Button
              size="sm"
              onClick={handleBulkRecover}
              disabled={selectedIds.size === 0 || bulkBusy}
              className="gap-1.5"
              title={`Seçili ${selectedIds.size} sayfa sıraya alınır; her biri arka planda yaklaşık 30 sn sürer. Sonuçlar hazır olunca listede görünür.`}
            >
              {bulkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Seçilenleri AI ile Düzelt ({selectedIds.size})
            </Button>
          </CardContent>
        </Card>
      )}

      {queuedIds.size > 0 && (
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          {queuedIds.size} sayfa sırada; her sayfanın sonucu hazır olunca kartında görünür.
        </p>
      )}

      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Takılı sayfalar yükleniyor">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="p-5 space-y-3">
                <div className="flex gap-2">
                  <Skeleton className="h-5 w-24 rounded-full" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
                <Skeleton className="h-5 w-2/3" />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[0, 1, 2, 3].map((j) => <Skeleton key={j} className="h-8" />)}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredRows.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center space-y-3">
            <div className="h-12 w-12 mx-auto rounded-full bg-success/10 text-success grid place-items-center">
              <TrendingUp className="h-6 w-6" />
            </div>
            <h3 className="font-semibold">
              {filter === 'all' ? 'Takılı sayfa yok' : 'Bu filtrede sonuç yok'}
            </h3>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              {filter === 'all'
                ? 'GSC verilerine göre tüm sayfaların ya ilk 3 sırada ya da yeterli izlenebilir gösterimi yok. Tarama haftalık otomatik çalışır.'
                : 'Filtreyi değiştirerek diğer kayıtları görebilirsin.'}
            </p>
            {filter === 'all' && (
              <Button onClick={handleDetect} disabled={detecting} variant="outline" size="sm">
                Şimdi tara
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredRows.map((row) => (
            <StuckPageCard
              key={row.id}
              page={row}
              busy={busyIds.has(row.id) || queuedIds.has(row.id)}
              queued={queuedIds.has(row.id)}
              outcome={visiblePageOutcome(outcomes[row.id], row.status, row.recoveries?.[0]?.id ?? null)}
              expanded={expandedIds.has(row.id)}
              selected={selectedIds.has(row.id)}
              selectable={row.status === 'DETECTED' && !!row.articleId && !queuedIds.has(row.id)}
              onSelect={() => toggleSelected(row.id)}
              onToggle={() => toggleExpand(row.id)}
              onRecover={() => handleRecover(row.id)}
              onIgnore={() => handleIgnore(row.id)}
              onRevert={(recoveryId) => handleRevert(row.id, recoveryId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function KpiCard({
  label,
  value,
  active,
  onClick,
  accent = 'brand',
  tooltip,
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
  accent?: 'brand' | 'warning' | 'success' | 'danger' | 'muted';
  tooltip?: string;
}) {
  const colorMap: Record<string, string> = {
    brand: 'text-foreground',
    warning: 'text-warning',
    success: 'text-success',
    danger: 'text-danger',
    muted: 'text-muted-foreground',
  };
  // Eskiden <button> icinde InfoTooltip (o da bir button) vardi → gecersiz ic ice
  // etkilesim. Simdi filtre dugmesi ve ipucu kardes; ipucu kosede mutlak konumlu.
  return (
    <div className="relative">
      <button
        type="button"
        aria-pressed={active}
        onClick={onClick}
        className={cn(
          'w-full rounded-lg border bg-card p-3 pr-8 text-left transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1',
          active ? 'border-brand/40 bg-brand/5' : 'hover:bg-muted/50',
        )}
      >
        <span className={cn('block text-label', active ? 'text-brand-700 dark:text-brand-300' : 'text-muted-foreground')}>{label}</span>
        <span className={cn('block text-metric-lg tabular-nums', colorMap[accent])}>{formatNum(value)}</span>
      </button>
      {tooltip && (
        <span className="absolute right-2 top-2.5">
          <InfoTooltip text={tooltip} iconClassName="opacity-60 hover:opacity-100" />
        </span>
      )}
    </div>
  );
}
