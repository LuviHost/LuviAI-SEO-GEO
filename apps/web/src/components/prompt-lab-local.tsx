'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Info, Loader2, MapPin, Play, Plus, RefreshCw, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { MeasurementLimitNote } from '@/components/measurement-limit-note';
import { isWeeklyMeasurementLimitError, refreshMeasurementAllowance, useMeasurementAllowance } from '@/lib/measurement-allowance';
import {
  ADDRESS_LABEL, PHONE_LABEL, TONE_CLASS, placeLabel,
  type LocalPromptDraft, type LocalPromptMeta, type LocalRunSummary, type SiteNapView,
} from '@/lib/local-visibility';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Prompt Lab — yerel mod.
 *
 * Il/ilce + hizmetten sabit kalipli sorular uretir (sunucu: audit/local-prompts.ts),
 * secilenleri takibe alir ve mevcut olcum yolundan calistirir (haftalik olcum
 * hakki aynen gecerli). Cevapta markanin yaninda telefon/adres gecerse sitenin
 * kendi LocalBusiness verisi ve tel: baglantilariyla karsilastirilir.
 */

const TEMPLATE_LABEL: Record<LocalPromptDraft['template'], string> = {
  arama: 'Arama dili',
  oneri: 'Soru',
  'en-iyi': 'Karşılaştırma',
};

const SOURCE_LABEL: Record<string, string> = {
  'json-ld': 'LocalBusiness yapılandırılmış verisi',
  'tel-link': 'tel: bağlantısı',
};

const splitList = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Listede yerel soru rozeti: "Yerel · Kadikoy / Istanbul" */
export function LocalPromptBadge({ meta }: { meta: LocalPromptMeta | null | undefined }) {
  const place = placeLabel(meta);
  return (
    <Badge variant="info" className="text-label px-1 py-0 gap-0.5">
      <MapPin className="h-2.5 w-2.5" aria-hidden /> Yerel{place ? ` · ${place}` : ''}
    </Badge>
  );
}

/** Olcumun durustluk notlari — yerel sekmede ve sonuc kutusunda */
function HonestyNotes({ compact = false }: { compact?: boolean }) {
  return (
    <ul className={`space-y-1 text-label text-muted-foreground ${compact ? '' : 'rounded-md border bg-muted/30 p-2.5'}`}>
      <li className="flex gap-1.5">
        <Info className="h-3 w-3 mt-0.5 shrink-0" aria-hidden />
        <span>
          Ölçüm isteklerinde konum bilgisi göndermiyoruz; konumu sorunun içine açıkça yazıyoruz. Gerçek bir kullanıcının
          gördüğü cevap, bulunduğu yere, cihazına ve hesap ayarlarına göre farklı olabilir.
        </span>
      </li>
      <li className="flex gap-1.5">
        <Info className="h-3 w-3 mt-0.5 shrink-0" aria-hidden />
        <span>
          AI cevapları aynı soruda bile çalıştırmadan çalıştırmaya değişir. Bu bir ölçümdür; önerilme ya da sıralama
          garantisi değildir.
        </span>
      </li>
      {!compact && (
        <li className="flex gap-1.5">
          <Info className="h-3 w-3 mt-0.5 shrink-0" aria-hidden />
          <span>
            Cevapta markanın yanında telefon ya da adres geçerse sitendeki bilgiyle karşılaştırırız: telefon numarası
            birebir, adres ilçe ve il adıyla. Sitende bu bilgi yoksa sonuç &quot;karşılaştırılamadı&quot; görünür.
          </span>
        </li>
      )}
    </ul>
  );
}

// ══════════════════════════════════════════════════════════════
//  Olcum sonucu — saglayici bazinda marka + telefon + adres
// ══════════════════════════════════════════════════════════════
export function LocalResultView({ result }: { result: LocalRunSummary }) {
  const measured = result.providers.filter((p) => p.measured);
  return (
    <div className="rounded-md border bg-background p-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-label font-medium flex items-center gap-1">
          <MapPin className="h-3 w-3" aria-hidden /> Yerel sonuç
          {placeLabel(result.location) && <span className="text-muted-foreground font-normal">· {placeLabel(result.location)}</span>}
        </p>
        <span className="text-label text-muted-foreground">{new Date(result.runAt).toLocaleString('tr-TR')}</span>
      </div>

      {!result.napChecked && measured.length > 0 && (
        <p className="text-label text-muted-foreground">
          Bu ölçümde cevap metinleri telefon/adres için incelenemedi; yalnız markanın geçip geçmediği gösteriliyor.
        </p>
      )}

      {measured.length === 0 ? (
        <p className="text-label text-muted-foreground">Bu ölçümde hiçbir sağlayıcıdan geçerli cevap alınamadı.</p>
      ) : (
        <div className="divide-y">
          {measured.map((p) => {
            // Eski kayitta bilinmeyen durum kodu gelirse "kontrol edilemedi"ye dus
            const phone = PHONE_LABEL[p.phone.status] ?? PHONE_LABEL.olculmedi;
            const address = ADDRESS_LABEL[p.address.status] ?? ADDRESS_LABEL.olculmedi;
            return (
              <div key={p.provider} className="py-1.5 space-y-0.5">
                <div className="flex items-center gap-2 flex-wrap text-label">
                  <span className="font-medium">{p.label}</span>
                  <span className={p.mentioned ? 'text-success' : 'text-muted-foreground'}>
                    {p.mentioned ? 'Markan cevapta geçti' : 'Markan cevapta geçmedi'}
                  </span>
                  {p.cited && <span className="text-success">· site bağlantısı verildi</span>}
                </div>
                <p className={`text-label ${TONE_CLASS[phone.tone]}`}>
                  {phone.text}
                  {p.phone.found.length > 0 && <span className="text-muted-foreground"> — cevapta: {p.phone.found.join(', ')}</span>}
                </p>
                <p className={`text-label ${TONE_CLASS[address.tone]}`}>
                  {address.text}
                  {p.address.status === 'eslesmiyor' && p.address.otherCity && ` (${p.address.otherCity})`}
                  {p.address.snippet && <span className="text-muted-foreground"> — «{p.address.snippet}»</span>}
                </p>
              </div>
            );
          })}
        </div>
      )}
      <HonestyNotes compact />
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  Sitede bulunan NAP
// ══════════════════════════════════════════════════════════════
function SiteNapCard({ nap, loading, refreshing, onRefresh }: {
  nap: SiteNapView | null;
  loading: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="rounded-md border p-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs font-medium">Sitende bulunan iletişim bilgisi</p>
        <Button size="sm" variant="outline" onClick={onRefresh} disabled={refreshing || loading}>
          {refreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Sitemden yeniden oku
        </Button>
      </div>
      {loading ? (
        <Skeleton className="h-10 w-full" />
      ) : !nap ? (
        <p className="text-label text-muted-foreground">
          Henüz okunmadı. İlk yerel ölçümde sitenin ana sayfasından (gerekirse iletişim sayfasından) okunur; şimdi okumak
          için yukarıdaki düğmeyi kullanabilirsin.
        </p>
      ) : nap.status === 'ok' ? (
        <div className="space-y-1 text-label">
          {nap.phones.length > 0 ? (
            <p><span className="text-muted-foreground">Telefon:</span> {nap.phones.join(', ')}</p>
          ) : (
            <p className="text-muted-foreground">Telefon bulunamadı — telefon karşılaştırması yapılamaz.</p>
          )}
          {nap.addresses.some((a) => a.district || a.city) ? (
            nap.addresses.map((a, i) => (
              <p key={i}>
                <span className="text-muted-foreground">Adres:</span>{' '}
                {[a.district, a.city].filter(Boolean).join(' / ') || '—'}
                {a.street && <span className="text-muted-foreground"> ({a.street})</span>}
              </p>
            ))
          ) : (
            <p className="text-muted-foreground">İlçe/il içeren adres bulunamadı — adres karşılaştırması yapılamaz.</p>
          )}
          <p className="text-muted-foreground">
            Kaynak: {nap.sources.map((s) => SOURCE_LABEL[s] ?? s).join(', ') || '—'}
            {formatDate(nap.collectedAt) && ` · okunma: ${formatDate(nap.collectedAt)}`}
          </p>
        </div>
      ) : (
        <div className="space-y-1 text-label">
          <p className={nap.status === 'unavailable' ? 'text-warning' : 'text-muted-foreground'}>{nap.reason}</p>
          {nap.status === 'empty' && (
            <p className="text-muted-foreground">
              Karşılaştırma için LocalBusiness yapılandırılmış verine (ya da işletmene uyan alt türe, ör. HairSalon,
              Dentist) telephone ve address ekle; telefonu tıklanabilir tel: bağlantısı olarak ver.
            </p>
          )}
        </div>
      )}
      {nap?.lastError && (
        <p className="text-label text-warning">
          Son okuma denemesi başarısız oldu: {nap.lastError} Gösterilen bilgi önceki okumadan.
        </p>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
//  SEKME — Yerel sorular
// ══════════════════════════════════════════════════════════════
export function LocalPromptsTab({ siteId }: { siteId: string }) {
  const [il, setIl] = useState('');
  const [ilce, setIlce] = useState('');
  const [hizmet, setHizmet] = useState('');
  const [drafts, setDrafts] = useState<LocalPromptDraft[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [nap, setNap] = useState<SiteNapView | null>(null);
  const [napLoading, setNapLoading] = useState(true);
  const [napRefreshing, setNapRefreshing] = useState(false);
  const { blocked: measurementBlocked } = useMeasurementAllowance();

  const loadNap = useCallback(async () => {
    setNapLoading(true);
    try {
      setNap(await api.getLocalSiteNap(siteId));
    } catch {
      setNap(null);
    } finally {
      setNapLoading(false);
    }
  }, [siteId]);

  useEffect(() => { void loadNap(); }, [loadNap]);

  const input = () => ({ il: il.trim(), ilceler: splitList(ilce), hizmetler: splitList(hizmet) });

  async function preview() {
    setPreviewing(true);
    try {
      const res = await api.previewLocalPrompts(siteId, input());
      setDrafts(res.drafts);
      setSelected(new Set(res.drafts.filter((d) => !d.exists).map((d) => d.text)));
    } catch (err: any) {
      toast.error(err?.message ?? 'Sorular oluşturulamadı');
    } finally {
      setPreviewing(false);
    }
  }

  async function save() {
    if (!selected.size) return;
    setSaving(true);
    try {
      const res = await api.createLocalPrompts(siteId, { ...input(), texts: [...selected] });
      toast.success(
        `${res.created} yerel soru takibe alındı${res.skipped ? `, ${res.skipped} atlandı` : ''}${res.limitReached ? ' (soru sınırına ulaşıldı)' : ''}`,
      );
      setDrafts(null);
      setSelected(new Set());
    } catch (err: any) {
      toast.error(err?.message ?? 'Kaydedilemedi');
    } finally {
      setSaving(false);
    }
  }

  async function runLocal() {
    setRunning(true);
    try {
      const res = await api.runAllPrompts(siteId, { withFanout: false, limit: 25, scope: 'local' });
      toast.success(res.ran > 0
        ? `${res.ran} yerel soru çalıştırıldı — sonuçlar Sorular sekmesinde her sorunun altında`
        : 'Çalıştırılacak yerel soru yok');
      refreshMeasurementAllowance();
      void loadNap();
    } catch (err: any) {
      if (isWeeklyMeasurementLimitError(err)) refreshMeasurementAllowance();
      toast.error(err?.message ?? 'Çalıştırılamadı');
    } finally {
      setRunning(false);
    }
  }

  async function refreshNap() {
    setNapRefreshing(true);
    try {
      setNap(await api.refreshLocalSiteNap(siteId));
      toast.success('Sitendeki iletişim bilgisi yeniden okundu');
    } catch (err: any) {
      toast.error(err?.message ?? 'Okunamadı');
    } finally {
      setNapRefreshing(false);
    }
  }

  const toggle = (text: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(text)) next.delete(text); else next.add(text);
    return next;
  });

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Yerel sorular, hizmetin ve bölgenle kurulan, müşterilerin AI asistanlara sorabileceği sorulardır (ör. &quot;Kadıköy
        kuaför&quot;). Sorular sabit kalıplardan oluşur; kaydetmeden önce görür ve seçersin. Oluşturmak ölçüm hakkı harcamaz.
      </p>

      <div className="grid gap-2 sm:grid-cols-3">
        <label className="space-y-1">
          <span className="text-label text-muted-foreground">İl</span>
          <input
            value={il}
            onChange={(e) => setIl(e.target.value)}
            placeholder="Örn: İstanbul"
            className="w-full rounded-md border bg-background px-3 py-1.5 text-xs"
          />
        </label>
        <label className="space-y-1">
          <span className="text-label text-muted-foreground">İlçe ya da semt (isteğe bağlı, virgülle en fazla 5)</span>
          <input
            value={ilce}
            onChange={(e) => setIlce(e.target.value)}
            placeholder="Örn: Kadıköy, Üsküdar"
            className="w-full rounded-md border bg-background px-3 py-1.5 text-xs"
          />
        </label>
        <label className="space-y-1">
          <span className="text-label text-muted-foreground">Hizmetler (virgülle en fazla 5)</span>
          <input
            value={hizmet}
            onChange={(e) => setHizmet(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !previewing) void preview(); }}
            placeholder="Örn: kuaför, saç boyama"
            className="w-full rounded-md border bg-background px-3 py-1.5 text-xs"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={preview} disabled={previewing || !il.trim() || !hizmet.trim()}>
          {previewing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          Soruları oluştur
        </Button>
        <Button size="sm" variant="outline" onClick={runLocal} disabled={running || measurementBlocked}>
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          Yerel soruları çalıştır
        </Button>
      </div>
      <MeasurementLimitNote />

      {drafts && (
        <div className="rounded-md border">
          <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 bg-muted/50 flex-wrap">
            <span className="text-label font-medium">{drafts.length} soru — takibe alınacakları seç</span>
            <Button size="sm" onClick={save} disabled={saving || selected.size === 0}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Seçilenleri takibe al ({selected.size})
            </Button>
          </div>
          <div className="divide-y">
            {drafts.map((d) => (
              <label key={d.text} className={`flex items-center gap-2 px-2.5 py-1.5 text-xs ${d.exists ? 'opacity-60' : 'cursor-pointer'}`}>
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-brand-500"
                  checked={!d.exists && selected.has(d.text)}
                  disabled={d.exists}
                  onChange={() => toggle(d.text)}
                />
                <span className="flex-1 min-w-0">{d.text}</span>
                <Badge variant="outline" className="text-label px-1 py-0 shrink-0">{TEMPLATE_LABEL[d.template]}</Badge>
                {d.exists && <span className="text-label text-muted-foreground shrink-0">takipte</span>}
              </label>
            ))}
          </div>
        </div>
      )}

      <SiteNapCard nap={nap} loading={napLoading} refreshing={napRefreshing} onRefresh={refreshNap} />
      <HonestyNotes />
    </div>
  );
}
