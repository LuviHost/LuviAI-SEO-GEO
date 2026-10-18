'use client';

import { siteHref } from '@/lib/site-routes';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Megaphone, Play, Pause, Target, Zap, Link2, Check, X, Loader2, TrendingUp, Trophy, Ban } from 'lucide-react';
import { api } from '@/lib/api';
import { abPausedAdsText, abTestDetail, abWinnerRateLabel, historyReasonLabel } from '@/lib/ads-history';
import { finishOAuthConnect } from '@/lib/oauth-connect';
import { SectionHeader } from '@/components/ui/section-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { InfoTooltip } from '@/components/info-tooltip';

/**
 * Reklam paneli — Google Ads + Meta Marketing API (direkt entegrasyon).
 * 3 sekme: Yayındakiler / Performans / Otopilot geçmişi.
 *
 * "Yeni kampanya" sihirbazi KALDIRILDI: cagirdigi POST /sites/:id/ads/build
 * (ve audience / copy / images) 0db5a1c'de API'den silindi, sihirbaz her
 * kullaniciya 404 donduruyordu. Liste yalniz RanksUp'ta kayitli (eskiden
 * sihirbazla olusturulmus) kampanyalari gosterir: Google Ads / Meta'da elle
 * kurulan kampanyalari ice aktaran bir uc yok (ads.controller.ts).
 *
 * Reklam Hesapları (Google + Meta OAuth bağlama) burada DEĞIL —
 * Ayarlar > Entegrasyonlar altında (Faz 11.6 UX birleşik hub).
 */
export function AdsLabPanel({ site }: { site: any }) {
  const [tab, setTab] = useState<'active' | 'performance' | 'autopilot'>('active');
  // autopilotRules: API (ads.controller connections) env'deki emniyet sinirlarini doner
  const [conn, setConn] = useState<{ google: boolean; meta: boolean; autopilotRules?: AdsAutopilotRules } | null>(null);

  useEffect(() => {
    api.getAdsConnections(site.id).then(setConn).catch(() => setConn({ google: false, meta: false }));
  }, [site.id]);

  const noAccounts = conn !== null && !conn.google && !conn.meta;

  return (
    <div className="rounded-lg border bg-card p-5 space-y-4">
      <SectionHeader
        as="h3"
        icon={Megaphone}
        title="Kampanyalar"
        description="RanksUp'ta kayıtlı Google Ads ve Meta kampanyalarının durumu, performansı ve otopilot geçmişi."
      />

      <p className="text-xs text-muted-foreground">
        RanksUp'tan yeni kampanya oluşturulamıyor. Google Ads ya da Meta'da kendin kurduğun kampanyalar bu listeye
        gelmez; onları kendi panellerinden yönetirsin. Reklam hesabını{' '}
        <a
          href={siteHref(site.id, 'adsHealth')}
          className="font-medium text-foreground underline decoration-brand underline-offset-4 hover:text-brand"
        >
          Kampanya Skoru
        </a>{' '}
        ile denetleyebilirsin.
      </p>

      {noAccounts && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 flex items-start gap-3">
          <Link2 className="h-4 w-4 text-warning shrink-0 mt-0.5" aria-hidden />
          <div className="flex-1 text-sm">
            <p className="font-medium">Önce reklam hesabı bağla</p>
            <p className="text-muted-foreground mt-0.5">
              Kampanyaları yayına almak, duraklatmak ve performanslarını almak için en az bir Google Ads veya Meta Ads hesabı bağlı olmalı.
            </p>
            <a
              href={siteHref(site.id, 'connections')}
              className="mt-2 inline-flex items-center gap-1 font-medium text-foreground underline decoration-brand underline-offset-4 hover:text-brand"
            >
              Bağlantılar sayfasını aç
            </a>
          </div>
        </div>
      )}

      <div className="inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1" role="tablist">
        {([
          ['active', 'Yayındakiler', <Play key="a" className="h-3.5 w-3.5" />],
          ['performance', 'Performans', <Target key="p" className="h-3.5 w-3.5" />],
          ['autopilot', 'Otopilot geçmişi', <Zap key="ap" className="h-3.5 w-3.5" />],
        ] as const).map(([id, label, icon]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === id ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {icon} {label}
          </button>
        ))}
      </div>

      {tab === 'active' && <ActiveTab siteId={site.id} />}
      {tab === 'performance' && <PerformanceTab siteId={site.id} />}
      {tab === 'autopilot' && <AutopilotHistoryTab siteId={site.id} />}

      {!noAccounts && conn && (
        <AutopilotToggle site={site} disabled={!conn.google && !conn.meta} rules={conn.autopilotRules ?? DEFAULT_AUTOPILOT_RULES} />
      )}
    </div>
  );
}

/** api ads/budget-guard.ts AdsAutopilotRules ile ayni sekil */
interface AdsAutopilotRules {
  increasePercent: number;
  shiftPercent: number;
  cooldownHours: number;
  maxIncreasesPerWeek: number;
  maxMultiplier: number;
}

/** API kurallari donmezse (eski surum) budget-guard.ts varsayilanlari */
const DEFAULT_AUTOPILOT_RULES: AdsAutopilotRules = {
  increasePercent: 20,
  shiftPercent: 20,
  cooldownHours: 24,
  maxIncreasesPerWeek: 2,
  maxMultiplier: 2,
};

const trNum = (n: number) => n.toLocaleString('tr-TR', { maximumFractionDigits: 2 });

/**
 * Otopilotun OTOMATIK yaptiklari — metin koda bakilarak yazildi; davranis
 * degisirse burasi da degismeli. Worker ADS_AUTOPILOT 6 saatte bir sirayla
 * calistirir (apps/worker/src/index.ts):
 *  - performance-sync: etkin + platform kimligi olan kampanyalarin metrikleri (son 30 gun),
 *    canli gunluk butcesi ve kalici durumu (platformda kaldirilmis/arsivlenmis → ENDED).
 *    Butce adimlari tutari bu kayittan degil platformdaki canli butceden hesaplar.
 *  - campaign-orchestrator.optimizeAutopilotCampaigns: ROAS < 1,5 ve harcama
 *    > 100 → duraklat; CTR > %3 ve ROAS > 5 → gunluk butce x1,2, YALNIZ
 *    budget-guard izin verirse: kampanya basina cooldownHours'ta 1, 7 gunde
 *    maxIncreasesPerWeek artis, tavan = otopilotun ilk degisiklik yaptigi
 *    andaki butce x maxMultiplier (sayilar env'den; API connections cevabi
 *    autopilotRules ile verir). Toplam (omur boyu) butceye dokunulmaz.
 *  - ab-test-manager.pickWinners (S10): 7+ gun once baslamis ve platformda
 *    yayinda olan kampanyada reklamlar YALNIZ kendi reklam grubunda (Meta'da
 *    reklam setinde) karsilastirilir. Uygun reklam: Google'da arama
 *    kampanyasinin metin reklami, reklam grubu etkin, birincil durumu ELIGIBLE;
 *    Meta'da reklam ve reklam seti ACTIVE, takvimi suruyor, hedefi LINK_CLICKS
 *    (karsilastirma baglanti tiklamasiyla). Gruptaki uygun ve >= 1.000
 *    gosterimli reklamlardan en iyisi tiklama oraninda hem 0,3 puandan fazla
 *    hem %99 guvenle (iki oran z-testi) ondeyse geride kalan duraklatilir;
 *    gosterim basina daha cok donusum ya da donusum degeri getirene (Google
 *    metrics.conversions, Meta satin alma + potansiyel musteri) dokunulmaz.
 *    Kazanan hic duraklatilmaz; RanksUp'in duraklattigi reklami musteri
 *    yeniden acarsa bir daha duraklatilmaz (KvStore defteri).
 *  - keyword-optimizer: Google'da son 30 gunun arama terimlerinden AI'in
 *    sectikleri negatif anahtar kelime olur.
 *  - budget-shifter: ayni hedefli Google + Meta cifti, ikisi de >= 100
 *    harcama, ROAS orani >= 1,5 → zayifin butcesinin %20'si gucluye; gucluye
 *    eklenen ayni emniyetten gecer, iki hesap ayni para biriminde degilse
 *    kaydirma yok.
 *  - Her degisiklik platform onayladiktan sonra kayda ve otopilot gecmisine
 *    (once → sonra) yazilir.
 *  - auto-boost: RanksUp'in paylastigi Facebook gonderisi (socialPost, kanal
 *    FACEBOOK_PAGE) son 7 gunde ortalamanin 2 katindan fazla etkilesim aldiysa
 *    gunluk 50, 7 gunluk yeni Meta kampanyasi (TR, 18-65; auto-boost.service.ts
 *    AUTO_BOOST_*). daily_budget hesabin para biriminin en kucuk biriminde gider
 *    (Meta: "at ad account currencies minimum denomination level",
 *    https://developers.facebook.com/documentation/ads-commerce/marketing-api/bidding/overview/budgets)
 *    — USD hesapta 50 USD olur. Bu kampanya adCampaign'e yazilmaz (listede
 *    gorunmez). Sosyal paylasim 0db5a1c'de kaldirildi, socialPost yazan kod
 *    yok → su an aday cikmaz.
 * Esik ve butceler hesabin para biriminde: metrikler platformdan oldugu gibi gelir.
 */
function AutopilotToggle({ site, disabled, rules }: { site: any; disabled: boolean; rules: AdsAutopilotRules }) {
  const [autopilot, setAutopilot] = useState(!!site.adsAutopilot);
  const [saving, setSaving] = useState(false);
  // Sahip env ile artisi kapatabilir (haftalik sinir 0): metin bunu soylemeli. Carpan 1
  // artisi tamamen kapatmaz (azaltilmis kampanya ilk butcesine donebilir), normal metin dogru.
  const increaseOff = rules.maxIncreasesPerWeek <= 0;

  const save = async (next: boolean) => {
    setSaving(true);
    setAutopilot(next);
    try {
      await api.updateAdsSettings(site.id, { adsAutopilot: next });
      toast.success(`Ads Otopilot ${next ? 'açıldı' : 'kapatıldı'}`);
    } catch (err: any) { toast.error(err.message); setAutopilot(!next); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-2 rounded-md border bg-brand-500/5 p-3 text-xs">
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={autopilot}
          disabled={disabled || saving}
          onChange={(e) => save(e.target.checked)}
        />
        <span>
          <strong>Ads Otopilot</strong> — açıkken her 6 saatte bir, onay sormadan reklam hesabında aşağıdaki
          değişiklikleri yapar. Bu değişiklikler harcamanı doğrudan etkiler.
        </span>
      </label>
      <ul className="list-disc space-y-1 pl-9 text-muted-foreground">
        <li>ROAS'ı 1,5'in altında kalan ve son 30 günde harcaması 100'ü geçen kampanyayı duraklatır.</li>
        {increaseOff ? (
          <li>Bütçe artışı emniyet ayarıyla kapalı: otopilot kampanya bütçesini artırmaz ve kampanyalar arasında bütçe kaydırmaz.</li>
        ) : (
          <>
            <li>
              Tıklama oranı %3'ün, ROAS'ı 5'in üstündeki kampanyanın günlük bütçesini %{rules.increasePercent} artırır.
              Emniyet sınırları: aynı kampanyada {trNum(rules.cooldownHours)} saatte en fazla bir, 7 günde en fazla{' '}
              {rules.maxIncreasesPerWeek} artış yapılır; bütçe, otopilotun o kampanyada ilk değişiklik yaptığı andaki
              bütçenin {trNum(rules.maxMultiplier)} katını geçmez (son artış bu sınıra göre küçültülür). Toplam (ömür
              boyu) bütçeli kampanyanın bütçesine dokunmaz.
            </li>
            <li>
              Aynı hedefli bir Google ve bir Meta kampanyasının ikisi de son 30 günde en az 100 harcadıysa ve birinin
              ROAS'ı diğerinin en az 1,5 katıysa, zayıf olanın günlük bütçesini %{rules.shiftPercent} azaltıp aynı
              tutarı güçlü olana ekler; ikisinin toplam bütçesi değişmez. Güçlü kampanyaya eklenen tutar yukarıdaki
              emniyet sınırlarına tabidir; iki reklam hesabının para birimi farklıysa ya da okunamıyorsa kaydırma
              yapılmaz.
            </li>
          </>
        )}
        <li>
          A/B testi: en az 7 gün önce başlamış ve yayında olan kampanyada, reklamları yalnız aynı reklam grubunun
          (Meta'da aynı reklam setinin) içinde karşılaştırır. Google Ads'te arama kampanyalarının yayında
          olan metin reklamlarına, Meta'da bağlantı tıklaması için optimize edilen reklam setlerinin yayında
          olan reklamlarına bakar. Son 7 günde her biri en az 1.000 gösterim almışsa ve en iyisi tıklama oranında
          (Meta'da bağlantı tıklama oranında) 0,3 puandan fazla ve %99 güvenle öndeyse geride kalanı duraklatır.
          Gösterim başına daha çok dönüşüm ya da dönüşüm değeri getiren reklama (Google'da Google Ads'teki
          Dönüşümler sütunu, Meta'da satın alma ve potansiyel müşteri) dokunmaz. Kazanan reklamı ve
          tek reklamı olan grupları duraklatmaz; otopilotun duraklattığı bir reklamı yeniden açarsan onu bir daha
          duraklatmaz.
        </li>
        <li>Google kampanyalarında son 30 günün arama terimlerinden AI'ın alakasız bulduklarını negatif anahtar kelime olarak ekler.</li>
        <li>
          Auto-Boost: RanksUp'ın Facebook sayfanda paylaştığı bir gönderi son 7 günde ortalamanın 2 katından
          fazla etkileşim alırsa, onu öne çıkarmak için Meta reklam hesabında 7 gün süren, günlük bütçesi 50 olan
          yeni bir kampanya açar (Türkiye, 18-65 yaş). Bu kampanya buradaki listede görünmez. RanksUp artık sosyal
          medyada paylaşım yapmadığı için şu an aday gönderi oluşmuyor.
        </li>
      </ul>
      <p className="text-muted-foreground">
        Bu kurallar yalnız RanksUp'ta kayıtlı kampanyalara uygulanır; Auto-Boost ise yeni kampanya açar. Tutarlar
        reklam hesabının para birimindedir: TL hesapta 50 = 50 TL, USD hesapta 50 = 50 USD. Bir değişiklik ancak
        reklam platformu onayladıktan sonra RanksUp'a yazılır; duraklatmalar ve bütçe değişiklikleri (önceki →
        yeni bütçe) Otopilot geçmişi sekmesinde görünür.
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Otopilot Geçmişi — AdCampaign.autopilotActions akışı
// ──────────────────────────────────────────────────────────────────

/**
 * Gecmise yazan adimlar: optimizeAutopilotCampaigns ({ actions: [...] } duraklatma,
 * { action: 'budget-up', budgetBefore, budgetAfter, ceiling, clamped }),
 * budget-shifter ({ action: 'budget-shift-in' | 'budget-shift-out', budgetBefore,
 * budgetAfter, counterpart, currency, completed, uncertain }), ab-test-manager
 * (reklam grubu / reklam seti basina { action: 'ab-test-winner', groupId,
 * groupName?, pausedCount, failedCount, uncertainCount?, pausedAdIds?, reason? }
 * ya da hicbir duraklatma onaylanmadiysa 'ab-test-pause-failed') ve
 * keyword-optimizer ({ action }). 'budget-up-20%' emniyet rayindan onceki
 * kayitlar. Tutarlar reklam platformundaki canli butceden (api live-budget.ts).
 * A/B ayrinti metni lib/ads-history.ts: eski surum pausedCount'u onaysiz
 * yaziyordu; failedCount'suz kayitta "duraklatildi" denmez. groupId'siz A/B
 * kaydi S10 oncesinden (grup gozetilmiyordu); grup adi uydurulmaz. Istisna:
 * gecmise sigmayan gruplarin ozet kaydi (groupCount, toplam sayilar); kesilen
 * kimlik listesi "ilk N" diye gosterilir (pausedAdIdsTotal).
 * Auto-Boost kayit YAZMAZ — metin bunu soyler.
 */
const ACTION_META: Record<string, { label: string; icon: typeof Pause; tone: string }> = {
  'pause-low-roas': { label: 'Düşük ROAS — kampanya duraklatıldı', icon: Pause, tone: 'border-danger/30 bg-danger/5' },
  'budget-up-20%': { label: 'Bütçe %20 artırıldı', icon: TrendingUp, tone: 'border-success/30 bg-success/5' },
  'budget-up': { label: 'Günlük bütçe artırıldı', icon: TrendingUp, tone: 'border-success/30 bg-success/5' },
  'budget-shift-in': { label: 'Bütçe kaydırma — bu kampanyaya eklendi', icon: TrendingUp, tone: 'border-success/30 bg-success/5' },
  'budget-shift-out': { label: 'Bütçe kaydırma — bu kampanyadan alındı', icon: Target, tone: 'border-warning/30 bg-warning/5' },
  // Kac varyantin duraklatildigi ayrintida (pausedCount): etiket "hepsi duraklatildi" demez
  'ab-test-winner': { label: 'A/B kazananı seçildi', icon: Trophy, tone: 'border-info/30 bg-info/5' },
  // Eski kayitlarda reklam kimligi eksik varyant da sayilir (platforma hic sorulmadi): "platform reddetti" denmez
  'ab-test-pause-failed': { label: 'A/B kazananı seçildi ama diğer varyantlar duraklatılamadı', icon: Trophy, tone: 'border-danger/30 bg-danger/5' },
  'add-negative-keywords': { label: 'Negatif anahtar kelime eklendi', icon: Ban, tone: 'border-warning/30 bg-warning/5' },
};

function AutopilotHistoryTab({ siteId }: { siteId: string }) {
  const [campaigns, setCampaigns] = useState<any[]>([]);

  useEffect(() => { api.listAdCampaigns(siteId).then(setCampaigns).catch(() => {}); }, [siteId]);

  const allActions = campaigns.flatMap((c) =>
    (Array.isArray(c.autopilotActions) ? c.autopilotActions : []).map((a: any) => ({
      ...a,
      campaignName: c.name,
      campaignId: c.id,
      platform: c.platform,
    }))
  ).sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Otopilotun bu listedeki kampanyalarda yaptığı duraklatma, bütçe artışı ve bütçe kaydırma (önceki → yeni
        bütçeyle), A/B kazananı ve negatif anahtar kelime değişiklikleri burada görünür. Auto-Boost'un açtığı
        kampanyalar bu geçmişe yazılmaz. Otopilotun ne yaptığının tam listesi, reklam hesabı bağlıyken aşağıdaki Ads
        Otopilot kutusunda yer alır.
      </p>

      {allActions.length === 0 ? (
        <p className="text-sm text-muted-foreground p-6 text-center">Henüz otopilot değişikliği yok.</p>
      ) : (
        <div className="space-y-2">
          {allActions.slice(0, 30).map((a, i) => {
            const action = a.action ?? a.actions?.[0] ?? 'unknown';
            const meta = ACTION_META[action];
            const Icon = meta?.icon ?? Zap;
            const abDetail = abTestDetail(a, a.platform);
            const abPausedAds = abPausedAdsText(a);
            const reasonLabel = historyReasonLabel(action);
            return (
              <div key={i} className={`rounded-md border p-2.5 ${meta?.tone ?? ''}`}>
                <div className="flex items-start gap-2">
                  <Icon className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" aria-hidden />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold truncate">{a.campaignName}</p>
                    <p className="text-label text-muted-foreground mt-0.5">
                      {meta?.label ?? action} · {new Date(a.time).toLocaleString('tr-TR')}
                    </p>
                    {a.reason && (
                      <p className="text-label mt-1 italic">{reasonLabel ? `${reasonLabel}: ` : ''}"{a.reason}"</p>
                    )}
                    {a.budgetBefore !== undefined && a.budgetAfter !== undefined && (
                      <p className="text-label mt-1 font-mono">
                        Günlük bütçe {trNum(Number(a.budgetBefore))} → {trNum(Number(a.budgetAfter))}
                        {a.currency ? ` ${a.currency}` : ' (hesap para birimi)'}
                        {a.clamped ? ' · üst sınıra göre küçültüldü' : ''}
                        {a.counterpart ? ` · karşı kampanya: ${a.counterpart}` : ''}
                      </p>
                    )}
                    {a.completed === false && (
                      <p className="text-label mt-1 text-danger">
                        {a.uncertain
                          ? 'Karşı kampanyanın artışı platformda doğrulanamadı; toplam bütçe artmasın diye bu azaltma geri alınmadı. Reklam hesabındaki bütçeleri kontrol et.'
                          : 'Karşı kampanyanın artışı platformda onaylanmadı ve bu azaltma geri alınamadı; toplam bütçe düştü.'}
                      </p>
                    )}
                    {(a.winnerCtr !== undefined || abDetail) && (
                      <p className="text-label mt-1">
                        {a.winnerCtr !== undefined ? `${abWinnerRateLabel(a, a.platform)} %${(a.winnerCtr * 100).toFixed(2)}` : ''}
                        {a.winnerCtr !== undefined && abDetail ? ' · ' : ''}
                        {abDetail ?? ''}
                      </p>
                    )}
                    {abPausedAds && <p className="text-label mt-1 font-mono">{abPausedAds}</p>}
                    {Array.isArray(a.keywords) && (
                      <p className="text-label mt-1">{a.keywords.length} negatif: {a.keywords.slice(0, 5).join(', ')}{a.keywords.length > 5 ? '…' : ''}</p>
                    )}
                    {a.ctr !== undefined && a.roas !== undefined && (
                      <p className="text-label mt-1 font-mono">Tıklama oranı %{(a.ctr * 100).toFixed(2)} · ROAS {Number(a.roas).toFixed(2)}x</p>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Aktif Kampanyalar
// ──────────────────────────────────────────────────────────────────

// "Etkin": RanksUp kaydindaki durum; platform kampanyayi yine de inceleme / odeme gibi nedenlerle durdurmus olabilir.
// "Sona erdi": performance-sync platformda kaldirilmis (Google) ya da arsivlenmis/silinmis (Meta) kampanyayi isaretler.
const STATUS_LABEL: Record<string, string> = { ACTIVE: 'Etkin', PAUSED: 'Duraklatıldı', DRAFT: 'Taslak', ENDED: 'Sona erdi' };
const PLATFORM_LABEL: Record<string, string> = { google_ads: 'Google Ads', meta_ads: 'Meta' };
const OBJECTIVE_LABEL: Record<string, string> = {
  traffic: 'Trafik',
  leads: 'Potansiyel müşteri',
  conversions: 'Dönüşüm',
  brand_awareness: 'Marka bilinirliği',
  sales: 'Satış',
};

function ActiveTab({ siteId }: { siteId: string }) {
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api.listAdCampaigns(siteId);
      setCampaigns(res);
    } catch (err: any) { toast.error(err.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [siteId]);

  const launch = async (id: string) => {
    try { const r = await api.launchCampaign(siteId, id); if (r.ok) toast.success('Yayına alındı'); else toast.error(r.error ?? 'Hata'); load(); }
    catch (err: any) { toast.error(err.message); }
  };

  // API duraklatmayi yalniz platform onaylarsa kaydeder; onaylanmadiysa { ok:false, error } doner
  const pause = async (id: string) => {
    try {
      const r = await api.pauseCampaign(siteId, id);
      if (r?.ok === false) toast.error(r.error ?? 'Reklam platformu duraklatmayı onaylamadı');
      else toast.success('Kampanya duraklatıldı');
      load();
    }
    catch (err: any) { toast.error(err.message); }
  };

  if (loading) return <div className="text-sm text-muted-foreground p-6 text-center">Yükleniyor…</div>;
  if (campaigns.length === 0) {
    return <div className="text-sm text-muted-foreground p-6 text-center">RanksUp'ta kayıtlı kampanya yok.</div>;
  }

  return (
    <div className="space-y-2">
      {/* Butce RanksUp'a girilen sayi; platform onu reklam hesabinin para biriminde uygular */}
      <p className="text-label text-muted-foreground">Tutarlar reklam hesabının para birimindedir.</p>
      {campaigns.map((c) => (
        <div key={c.id} className="rounded-md border p-3">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div>
              <p className="font-semibold text-sm">{c.name}</p>
              <p className="text-label text-muted-foreground">
                {PLATFORM_LABEL[c.platform] ?? c.platform} · {OBJECTIVE_LABEL[c.objective] ?? c.objective} · bütçe {c.budgetAmount} ({c.budgetType === 'lifetime' ? 'toplam' : 'günlük'})
              </p>
            </div>
            <Badge variant={c.status === 'ACTIVE' ? 'default' : c.status === 'PAUSED' ? 'outline' : 'secondary'}>
              {STATUS_LABEL[c.status] ?? c.status}
            </Badge>
          </div>
          <div className="grid grid-cols-4 gap-2 text-xs mb-2">
            <div>
              <p className="text-muted-foreground">
                <InfoTooltip term="Impression">Gösterim</InfoTooltip>
              </p>
              <p className="font-mono font-bold">{c.impressions}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Tıklama</p>
              <p className="font-mono font-bold">{c.clicks}</p>
            </div>
            <div>
              <p className="text-muted-foreground">
                <InfoTooltip term="CTR">CTR</InfoTooltip>
              </p>
              <p className="font-mono font-bold">{(c.ctr * 100).toFixed(1)}%</p>
            </div>
            <div>
              <p className="text-muted-foreground">
                <InfoTooltip term="ROAS">ROAS</InfoTooltip>
              </p>
              <p className={`font-mono font-bold ${c.roas >= 2 ? 'text-green-500' : c.roas > 0 ? 'text-yellow-500' : ''}`}>{c.roas.toFixed(1)}x</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* externalId'siz taslak platformda hic olusturulmadi: launch her zaman reddeder (ads.controller) */}
            {c.status === 'DRAFT' && c.externalId && <Button size="sm" onClick={() => launch(c.id)}><Play className="h-3 w-3 mr-1" /> Yayına al</Button>}
            {c.status === 'DRAFT' && !c.externalId && (
              <span className="text-label text-muted-foreground">Bu taslak reklam platformunda oluşturulmadı; RanksUp'tan yayına alınamaz.</span>
            )}
            {c.status === 'ACTIVE' && <Button size="sm" variant="outline" onClick={() => pause(c.id)}><Pause className="h-3 w-3 mr-1" /> Duraklat</Button>}
            {c.externalId && <span className="text-label text-muted-foreground">ID: {c.externalId}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
// Performans
// ──────────────────────────────────────────────────────────────────
function PerformanceTab({ siteId }: { siteId: string }) {
  const [campaigns, setCampaigns] = useState<any[]>([]);

  useEffect(() => { api.listAdCampaigns(siteId).then(setCampaigns).catch(() => {}); }, [siteId]);

  // Harcama platformdan oldugu gibi gelir (Google cost_micros / 1e6, Meta spend):
  // reklam hesabinin para birimi. "₺" yalniz TL hesapta dogru olurdu.
  const totalSpend = campaigns.reduce((a, c) => a + Number(c.spend ?? 0), 0);
  const totalConv = campaigns.reduce((a, c) => a + (c.conversions ?? 0), 0);
  const avgRoas = campaigns.length > 0 ? campaigns.reduce((a, c) => a + (c.roas ?? 0), 0) / campaigns.length : 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md border p-3 text-center">
          <p className="text-2xl font-bold">{totalSpend.toFixed(0)}</p>
          <p className="text-label text-muted-foreground">Toplam harcama (hesap para birimi)</p>
        </div>
        <div className="rounded-md border p-3 text-center">
          <p className="text-2xl font-bold">{totalConv}</p>
          <p className="text-label text-muted-foreground">Dönüşüm</p>
        </div>
        <div className="rounded-md border p-3 text-center">
          <p className={`text-2xl font-bold ${avgRoas >= 2 ? 'text-green-500' : avgRoas > 0 ? 'text-yellow-500' : ''}`}>{avgRoas.toFixed(1)}x</p>
          <p className="text-label text-muted-foreground">Ort. ROAS</p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground italic">
        Etkin ve reklam platformunda kimliği olan kampanyaların verileri her 6 saatte bir Google Ads API ve Meta
        Marketing API'den alınır.
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────
//  OAuth popup-based connection cards (Faz 11.5)
// ──────────────────────────────────────────────────────────────────

/**
 * OAuth popup'i acar, bitince postMessage bekler.
 * Provider: 'google-ads' | 'meta-ads'
 */
function useOAuthPopup(provider: 'google-ads' | 'meta-ads', siteId: string) {
  const [busy, setBusy] = useState(false);

  const start = async (onResult: (data: any) => void) => {
    setBusy(true);
    try {
      const { url } = await api.getOAuthStartUrl(provider, siteId);
      const w = 600, h = 700;
      const left = window.screenX + (window.outerWidth - w) / 2;
      const top = window.screenY + (window.outerHeight - h) / 2;
      const popup = window.open(url, 'oauth-popup', `width=${w},height=${h},left=${left},top=${top},toolbar=no,location=no,status=no,menubar=no,scrollbars=yes`);
      if (!popup) throw new Error('Popup engellendi — tarayıcı izni ver');

      let resolved = false;
      const handler = (e: MessageEvent) => {
        const msg = e.data;
        // 'oauth-pending': API oturumu goremedi, kodu park etti → oturumlu istekle tamamla.
        // Yalniz actigimiz popup'tan kabul edilir; callback API alan adinda olabilecegi
        // icin koken esitligi aranmaz. Anahtar tek basina ise yaramaz: sunucu, akisi
        // baslatan kullaniciyla bu oturum eslesmezse reddeder.
        if (msg?.type === 'oauth-pending' && msg.provider === provider && e.source === popup && typeof msg.key === 'string') {
          resolved = true;
          window.removeEventListener('message', handler);
          finishOAuthConnect(provider, msg.key)
            .then((data) => { if (data) onResult(data); })
            .catch((err: any) => toast.error(err.message))
            .finally(() => setBusy(false));
          return;
        }
        if (e.origin !== window.location.origin) return;
        if (!msg || (msg.type !== 'oauth-success' && msg.type !== 'oauth-error')) return;
        if (msg.provider !== provider) return;
        resolved = true;
        window.removeEventListener('message', handler);
        if (msg.type === 'oauth-error') {
          toast.error(msg.message ?? 'Bağlantı hatası');
        } else {
          onResult(msg.data ?? {});
        }
        setBusy(false);
      };
      window.addEventListener('message', handler);

      // Popup kapanmasi watchdog
      const timer = setInterval(() => {
        if (popup.closed) {
          clearInterval(timer);
          if (!resolved) {
            window.removeEventListener('message', handler);
            setBusy(false);
          }
        }
      }, 500);
    } catch (err: any) {
      toast.error(err.message);
      setBusy(false);
    }
  };

  return { busy, start };
}

export function GoogleAdsOAuthCard({ site, connected, onChanged }: { site: any; connected: boolean; onChanged: () => void }) {
  const oauth = useOAuthPopup('google-ads', site.id);
  const [picker, setPicker] = useState<{ id: string; resourceName: string; descriptiveName?: string; currencyCode?: string; isManager?: boolean }[] | null>(null);
  const [savingPick, setSavingPick] = useState(false);

  const connect = () => {
    oauth.start(async (data) => {
      onChanged();
      if (data.autoSelected) {
        toast.success('Google Ads bağlandı ✓');
      } else if (data.customers?.length > 1) {
        setPicker(data.customers);
        toast.message('Birden fazla hesap bulundu — birini seç');
      } else if (!data.customers?.length) {
        // customersError: liste alinamadi (erisim/surum) — "hesap yok" ile karistirma
        toast.warning(data.customersError
          ? `Google Ads hesapları okunamadı: ${data.customersError}`
          : 'Google Ads hesabı bulunamadı — bu Google hesabında reklam hesabı yok mu?');
      }
    });
  };

  const disconnect = async () => {
    if (!confirm('Google Ads bağlantısı kaldırılacak. Emin misin?')) return;
    try {
      await api.connectGoogleAds(site.id, { customerId: undefined, refreshToken: undefined });
      toast.success('Bağlantı kaldırıldı');
      onChanged();
    } catch (err: any) { toast.error(err.message); }
  };

  const pick = async (customerId: string) => {
    setSavingPick(true);
    try {
      await api.selectOAuthAccount('google-ads', site.id, { customerId });
      toast.success('Hesap seçildi ✓');
      setPicker(null);
      onChanged();
    } catch (err: any) { toast.error(err.message); }
    finally { setSavingPick(false); }
  };

  const showPicker = async () => {
    try {
      const r = await api.getOAuthOptions('google-ads', site.id);
      setPicker(r.customers ?? []);
    } catch (err: any) { toast.error(err.message); }
  };

  return (
    <div className={`rounded-md border p-3 ${connected ? 'border-green-500/40 bg-green-500/5' : 'bg-muted/10'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`h-7 w-7 rounded-full grid place-items-center ${connected ? 'bg-green-500/20' : 'bg-muted'}`}>
            {connected ? <Check className="h-4 w-4 text-green-600" /> : <X className="h-4 w-4 text-muted-foreground" />}
          </span>
          <div>
            <p className="text-sm font-semibold flex items-center gap-2">
              <GoogleIcon /> Google Ads
            </p>
            <p className="text-[11px] text-muted-foreground">
              {connected
                ? <>Bağlı{site.googleAdsCustomerId && <> · <span className="font-mono">{site.googleAdsCustomerId}</span></>} · {site.googleAdsConnectedAt && new Date(site.googleAdsConnectedAt).toLocaleDateString('tr-TR')}</>
                : 'Tek tık bağlan — Google izin ekranı'}
            </p>
          </div>
        </div>
        {connected ? (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={showPicker}>Hesap Değiştir</Button>
            <Button size="sm" variant="outline" onClick={disconnect}>Kaldır</Button>
          </div>
        ) : (
          <Button size="sm" onClick={connect} disabled={oauth.busy} className="gap-1.5">
            {oauth.busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <GoogleIcon />}
            {oauth.busy ? 'Açılıyor…' : 'Google ile Bağla'}
          </Button>
        )}
      </div>

      {picker && (
        <div className="mt-3 pt-3 border-t space-y-2">
          <p className="text-xs font-medium">Hangi Google Ads hesabı?</p>
          {picker.length === 0 ? (
            <p className="text-xs text-muted-foreground">Bu Google hesabıyla erişilebilir Google Ads hesabı yok.</p>
          ) : (
            picker.map((c) => (
              <button
                key={c.id}
                onClick={() => pick(c.id)}
                disabled={savingPick}
                className={`w-full flex items-start justify-between gap-2 px-3 py-2 rounded border text-xs hover:border-brand/40 hover:bg-brand/5 transition-colors ${site.googleAdsCustomerId === c.id ? 'border-green-500/40 bg-green-500/5' : ''}`}
              >
                <div className="flex flex-col items-start gap-0.5 min-w-0">
                  <span className="font-medium truncate">{c.descriptiveName || (c.isManager ? 'Manager hesabı' : 'İsimsiz hesap')}</span>
                  <span className="text-muted-foreground font-mono text-[10px]">{c.id.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3')}{c.currencyCode ? ` · ${c.currencyCode}` : ''}{c.isManager ? ' · Manager' : ''}</span>
                </div>
                {site.googleAdsCustomerId === c.id && <Check className="h-3 w-3 text-green-600 mt-0.5 shrink-0" />}
              </button>
            ))
          )}
          <Button size="sm" variant="ghost" onClick={() => setPicker(null)} className="w-full">İptal</Button>
        </div>
      )}
    </div>
  );
}

export function MetaAdsOAuthCard({ site, connected, onChanged }: { site: any; connected: boolean; onChanged: () => void }) {
  const oauth = useOAuthPopup('meta-ads', site.id);
  const [opts, setOpts] = useState<{ adAccounts: any[]; pages: any[] } | null>(null);
  const [showOpts, setShowOpts] = useState(false);

  const connect = () => {
    oauth.start(async (data) => {
      onChanged();
      if (data.autoSelected) {
        toast.success('Meta Ads bağlandı ✓');
      } else {
        // birden fazla varsa picker'i hemen ac
        setOpts({ adAccounts: data.adAccounts ?? [], pages: data.pages ?? [] });
        setShowOpts(true);
      }
    });
  };

  const disconnect = async () => {
    if (!confirm('Meta Ads bağlantısı kaldırılacak. Emin misin?')) return;
    try {
      await api.connectMetaAds(site.id, { accountId: undefined, accessToken: undefined, pageId: undefined, instagramActorId: undefined });
      toast.success('Bağlantı kaldırıldı');
      onChanged();
    } catch (err: any) { toast.error(err.message); }
  };

  const loadOpts = async () => {
    try {
      const r = await api.getOAuthOptions('meta-ads', site.id);
      setOpts({ adAccounts: r.adAccounts ?? [], pages: r.pages ?? [] });
      setShowOpts(true);
    } catch (err: any) { toast.error(err.message); }
  };

  const save = async (selection: { adAccountId?: string; pageId?: string; instagramActorId?: string }) => {
    try {
      await api.selectOAuthAccount('meta-ads', site.id, selection);
      toast.success('Seçim kaydedildi ✓');
      setShowOpts(false);
      onChanged();
    } catch (err: any) { toast.error(err.message); }
  };

  return (
    <div className={`rounded-md border p-3 ${connected ? 'border-green-500/40 bg-green-500/5' : 'bg-muted/10'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`h-7 w-7 rounded-full grid place-items-center ${connected ? 'bg-green-500/20' : 'bg-muted'}`}>
            {connected ? <Check className="h-4 w-4 text-green-600" /> : <X className="h-4 w-4 text-muted-foreground" />}
          </span>
          <div>
            <p className="text-sm font-semibold flex items-center gap-2">
              <MetaIcon /> Meta Ads (Facebook + Instagram)
            </p>
            <p className="text-[11px] text-muted-foreground">
              {connected
                ? <>Bağlı{site.metaAdsAccountId && <> · <span className="font-mono">{site.metaAdsAccountId}</span></>}{site.metaPageId && <> · Page {site.metaPageId}</>}</>
                : 'Tek tık bağlan — Facebook izin ekranı'}
            </p>
          </div>
        </div>
        {connected ? (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={loadOpts}>Hesap/Sayfa Değiştir</Button>
            <Button size="sm" variant="outline" onClick={disconnect}>Kaldır</Button>
          </div>
        ) : (
          <Button size="sm" onClick={connect} disabled={oauth.busy} className="gap-1.5">
            {oauth.busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <MetaIcon />}
            {oauth.busy ? 'Açılıyor…' : 'Facebook ile Bağla'}
          </Button>
        )}
      </div>

      {showOpts && opts && (
        <MetaPicker
          opts={opts}
          current={{ adAccountId: site.metaAdsAccountId, pageId: site.metaPageId, instagramActorId: site.metaInstagramActorId }}
          onCancel={() => setShowOpts(false)}
          onSave={save}
        />
      )}
    </div>
  );
}

function MetaPicker({ opts, current, onCancel, onSave }: {
  opts: { adAccounts: any[]; pages: any[] };
  current: { adAccountId?: string; pageId?: string; instagramActorId?: string };
  onCancel: () => void;
  onSave: (s: { adAccountId?: string; pageId?: string; instagramActorId?: string }) => Promise<void>;
}) {
  const [adAccountId, setAdAccountId] = useState(current.adAccountId ?? '');
  const [pageId, setPageId] = useState(current.pageId ?? '');
  const [saving, setSaving] = useState(false);

  const selectedPage = opts.pages.find((p) => p.id === pageId);
  const igId = selectedPage?.instagramId ?? '';

  const submit = async () => {
    if (!adAccountId) { toast.error('Reklam hesabı seç'); return; }
    if (!pageId) { toast.error('Facebook Page seç'); return; }
    setSaving(true);
    try {
      await onSave({ adAccountId, pageId, instagramActorId: igId || undefined });
    } finally { setSaving(false); }
  };

  return (
    <div className="mt-3 pt-3 border-t space-y-3">
      <div>
        <p className="text-xs font-medium mb-1.5">Reklam Hesabı (Ad Account)</p>
        {opts.adAccounts.length === 0 ? (
          <p className="text-[11px] text-muted-foreground p-2 border rounded">Aktif reklam hesabı bulunamadı.</p>
        ) : (
          <div className="space-y-1">
            {opts.adAccounts.map((a) => (
              <button
                key={a.id}
                onClick={() => setAdAccountId(a.id)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded border text-xs hover:border-brand/40 transition-colors ${adAccountId === a.id ? 'border-brand bg-brand/5' : ''}`}
              >
                <span className="truncate"><strong>{a.name}</strong> · <span className="font-mono text-muted-foreground">{a.id}</span></span>
                {adAccountId === a.id && <Check className="h-3 w-3 text-brand shrink-0" />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <p className="text-xs font-medium mb-1.5">Facebook Page (zorunlu — kampanya + boost için)</p>
        {opts.pages.length === 0 ? (
          <p className="text-[11px] text-muted-foreground p-2 border rounded">Sayfa bulunamadı. Facebook'ta sayfa kur, sonra tekrar bağla.</p>
        ) : (
          <div className="space-y-1">
            {opts.pages.map((p) => (
              <button
                key={p.id}
                onClick={() => setPageId(p.id)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded border text-xs hover:border-brand/40 transition-colors ${pageId === p.id ? 'border-brand bg-brand/5' : ''}`}
              >
                <span className="truncate">
                  <strong>{p.name}</strong>
                  {p.instagramId && <span className="ml-1.5 text-[10px] inline-flex items-center gap-0.5 text-pink-500">📷 IG bağlı</span>}
                </span>
                {pageId === p.id && <Check className="h-3 w-3 text-brand shrink-0" />}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={submit} disabled={saving} className="flex-1">
          {saving ? 'Kaydediliyor…' : 'Seçimi Kaydet'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>İptal</Button>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden>
      <path fill="#EA4335" d="M12 5c1.6 0 3 .55 4.13 1.62l3.07-3.07A11.92 11.92 0 0 0 12 0C7.31 0 3.26 2.69 1.28 6.6l3.58 2.78A7.02 7.02 0 0 1 12 5Z" />
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.68-.22-2.47H12v4.68h6.46a5.53 5.53 0 0 1-2.39 3.63l3.69 2.86c2.16-1.99 3.4-4.92 3.4-8.7Z" />
      <path fill="#FBBC05" d="M4.86 14.62a7.04 7.04 0 0 1 0-5.24L1.28 6.6a11.97 11.97 0 0 0 0 10.8l3.58-2.78Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.95-2.92l-3.69-2.86a7.16 7.16 0 0 1-10.4-3.6L1.28 17.4C3.26 21.31 7.31 24 12 24Z" />
    </svg>
  );
}

function MetaIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden>
      <circle cx="12" cy="12" r="12" fill="#1877F2" />
      <path fill="#fff" d="M14.7 12.5h-2.2v7H9.6v-7H8v-2.5h1.6V8.4c0-1.7 1-2.9 3.1-2.9.9 0 1.6.1 1.6.1v2.1h-1c-.9 0-1.2.5-1.2 1.1v1.7h2.4l-.4 2.5Z" />
    </svg>
  );
}

