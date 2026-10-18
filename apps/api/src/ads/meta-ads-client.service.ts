import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { decrypt } from '@luviai/shared';
import { sameBudget, type BudgetWriteResult, type LiveBudgetResult, type LiveCampaignBudget, type LiveCampaignStatus } from './live-budget.js';
import type { AdStatusWriteResult, AdVariant } from './ads-client.service.js';

/**
 * Meta butce alanlari (daily_budget) hesabin para biriminin EN KUCUK biriminde
 * gider: "The amount you set for bid and budget are at ad accounts currencies
 * minimum denomination level, such as cents for USD."
 * (https://developers.facebook.com/documentation/ads-commerce/marketing-api/bidding/overview/budgets)
 * Para birimi "offset"i cogu birimde 100'dur (TRY, USD, EUR); asagidakilerde 1
 * (https://developers.facebook.com/docs/marketing-api/currencies). Eski kod her
 * birimde x100 yapiyordu: JPY ya da KRW hesapta butce 100 kat yazilirdi.
 */
export const META_OFFSET_ONE_CURRENCIES: ReadonlySet<string> = new Set([
  'CLP', 'COP', 'CRC', 'HUF', 'ISK', 'IDR', 'JPY', 'KRW', 'PYG', 'TWD', 'VND',
]);

/** Hesap para birimindeki tutar → Meta'nin bekledigi en kucuk birim (tamsayi) */
export function metaMinorUnits(amount: number, currency: string): number {
  return Math.round(amount * (META_OFFSET_ONE_CURRENCIES.has(currency) ? 1 : 100));
}

/** En kucuk birim → hesap para birimindeki tutar (metaMinorUnits'in tersi) */
export function metaAmountFromMinor(minor: number, currency: string): number {
  return minor / (META_OFFSET_ONE_CURRENCIES.has(currency) ? 1 : 100);
}

/**
 * Meta butce alani (daily_budget / lifetime_budget: en kucuk birimde sayisal
 * dize) → pozitif tamsayi; alan yok, bos ya da "0" ise null (o seviyede butce yok).
 */
export function parseMetaMinor(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * Yeni toplami ad set'lere MEVCUT ORANLARIYLA dagitir (en buyuk kalan yontemi,
 * BigInt ile tam hesap): toplam tam olarak hedef olur, hicbir ad set'in payi
 * digerine kaymaz. Eski kod toplami ad set sayisina esit boluyordu (80/20
 * dagilimi 60/60 oluyor, kurus artigi kayboluyordu). Bir pay 0'a duserse ya
 * da girdi gecersizse null: o dagitim yazilmaz.
 */
export function distributeMetaBudget(current: number[], targetTotal: number): number[] | null {
  if (current.length === 0 || !Number.isSafeInteger(targetTotal) || targetTotal <= 0) return null;
  if (current.some((c) => !Number.isSafeInteger(c) || c <= 0)) return null;
  const total = current.reduce((a, b) => a + BigInt(b), 0n);
  const target = BigInt(targetTotal);
  const parts = current.map((c, i) => {
    const p = BigInt(c) * target;
    return { i, q: p / total, r: p % total };
  });
  let rest = target - parts.reduce((a, x) => a + x.q, 0n);
  const byRemainder = [...parts].sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (const p of byRemainder) {
    if (rest <= 0n) break;
    p.q += 1n;
    rest -= 1n;
  }
  const out = parts.map((p) => Number(p.q));
  return out.some((x) => x <= 0) ? null : out;
}

/**
 * Meta datetime alani (ad set end_time, kampanya stop_time) → epoch ms.
 *
 * Graph API okuma ciktisinda datetime ISO-8601 dizedir
 * ("2026-10-01T23:59:59+0300"; resmi Ad Set referansindaki guncelleme ornegi
 * de ayni bicimi kullanir: end_time=2013-10-02T00:00:00-0700); date_format=U
 * istenirse UNIX saniye gelir — ikisi de okunur.
 *  - Alan yok / bos / 0 / 1970 ve oncesi → null: bitis tarihi YOK. "When
 *    creating a set with a daily budget, specify end_time=0 to set the set to
 *    be ongoing and have no end date" (Ad Set referansi).
 *  - Okunamayan deger → undefined: cagiran butceyi "okunamadi" sayar ve
 *    yazmaz (bitip bitmedigi bilinmeyen ad set'e para yazilmaz).
 */
export function metaTimeMs(v: unknown): number | null | undefined {
  if (v === undefined || v === null || v === '' || v === 0) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return undefined;
    return v > 0 ? v * 1000 : null;
  }
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (/^\d{1,12}$/.test(s)) {
    const n = Number(s);
    return n > 0 ? n * 1000 : null;
  }
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|[+-]\d{2}:?\d{2})$/);
  if (!m) return undefined;
  const [y, mo, d, h, mi, se] = m.slice(1, 7).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return undefined;
  let ms = Date.UTC(y, mo - 1, d, h, mi, se);
  const tz = m[7];
  if (tz !== 'Z') {
    const sign = tz.startsWith('-') ? -1 : 1;
    const digits = tz.slice(1).replace(':', '');
    const offMin = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4));
    if (offMin > 18 * 60) return undefined;
    ms -= sign * offMin * 60_000;
  }
  return ms > 0 ? ms : null;
}

/** Insights sayaci (dize) → negatif olmayan tamsayi; yok/gecersiz → null (bilinmiyor) */
export function metaCount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v >= 0 ? v : null;
  return typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : null;
}

/**
 * A/B'nin "geride kalan daha cok donusum getirdiyse duraklatma" emniyeti icin
 * donusum aileleri. Ad adlari resmi Ads Action Stats referansindan
 * (https://developers.facebook.com/docs/marketing-api/reference/ads-action-stats/:
 * lead "All offsite leads plus all On-Facebook leads", omni_purchase
 * "Purchases", offsite_conversion.fb_pixel_purchase "Purchases",
 * onsite_conversion.purchase "On-Facebook Purchases",
 * onsite_conversion.lead_grouped "All On-Facebook Leads",
 * offsite_conversion.fb_pixel_lead "Leads"); 'purchase' getCampaignInsights'in
 * okudugu tur. Ayni olay birden cok adla gelebildigi icin aile icinde EN BUYUK
 * deger alinir (toplanmaz). Bu sayi yalniz duraklatmayi ENGELLER: yanitta
 * olmayan bir ad hicbir islemi tetiklemez, yalniz o turun donusumleri emniyete
 * girmez (A/B zaten yalniz baglanti tiklamasi hedefli reklam setlerinde calisir).
 */
const META_PURCHASE_ACTIONS: ReadonlySet<string> = new Set(['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_conversion.purchase']);
const META_LEAD_ACTIONS: ReadonlySet<string> = new Set(['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead']);

/** actions/action_values listesinde bir ailenin en buyuk degeri; liste bozuksa null */
function metaFamilyMax(list: unknown, family: ReadonlySet<string>): number | null {
  // Meta hic eylem yoksa alani gondermez: yok = 0
  if (list === undefined || list === null) return 0;
  if (!Array.isArray(list)) return null;
  let best = 0;
  for (const a of list) {
    if (!family.has(a?.action_type)) continue;
    const n = typeof a.value === 'number' ? a.value : typeof a.value === 'string' && a.value.trim() !== '' ? Number(a.value) : Number.NaN;
    if (!Number.isFinite(n) || n < 0) return null;
    if (n > best) best = n;
  }
  return best;
}

/** Satin alma + potansiyel musteri (aile basina en buyuk); okunamazsa null */
export function metaConversions(actions: unknown): number | null {
  const p = metaFamilyMax(actions, META_PURCHASE_ACTIONS);
  const l = metaFamilyMax(actions, META_LEAD_ACTIONS);
  return p === null || l === null ? null : p + l;
}

/** Satin alma degeri (action_values); okunamazsa null */
export function metaPurchaseValue(actionValues: unknown): number | null {
  return metaFamilyMax(actionValues, META_PURCHASE_ACTIONS);
}

const ISO_CURRENCY = /^[A-Z]{3}$/;
/** Meta nesne kimlikleri sayisal; kimlik Graph API yoluna yazilir (ads-settings.dto AdsLaunchDto ile ayni kural) */
const META_ID = /^\d{1,32}$/;
const GRAPH_HOST = 'https://graph.facebook.com/';

/**
 * Kampanya effective_status → RanksUp kumesi. Degerler: ACTIVE, PAUSED,
 * DELETED, ARCHIVED, IN_PROCESS, WITH_ISSUES
 * (https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/
 * ve facebook-python-business-sdk adobjects/campaign.py Campaign.EffectiveStatus).
 */
const META_CAMPAIGN_STATUS: Record<string, LiveCampaignStatus> = {
  ACTIVE: 'ACTIVE',
  PAUSED: 'PAUSED',
  ARCHIVED: 'ENDED',
  DELETED: 'ENDED',
};

/**
 * Butcesi yazilabilen kampanya durumlari. "An ARCHIVED object has only two
 * fields you can change: name and status" ve arsivlenen/silinen kampanyanin
 * alt nesneleri bu durumu devralir; arsivlenmis alt nesneler kenarlardan
 * filtresiz donmez (https://developers.facebook.com/docs/marketing-api/best-practices/manage-your-ad-object-status,
 * https://developers.facebook.com/ads/blog/post/2014/09/24/deleted-vs-archived/).
 * Eski kod once kampanyaya yazmayi deniyor, reddedilince bos ad set listesinde
 * hicbir sey yazmadan { ok: true } donuyordu: arsivlenmis kampanyada sahte
 * "butce artirildi", kaydiricida Meta azaltilmadan Google artiriliyordu.
 */
const META_WRITABLE_CAMPAIGN = new Set(['ACTIVE', 'PAUSED']);

/**
 * Ad set listesinde istenen effective_status degerleri: arsivlenmis/silinmis
 * DISINDAKI belgelenmis degerlerin hepsi (AdSet.EffectiveStatus: ACTIVE,
 * PAUSED, CAMPAIGN_PAUSED, IN_PROCESS, WITH_ISSUES, ARCHIVED, DELETED).
 * Butce hesabina yalniz yapilandirilmis durumu (status) ACTIVE olanlar girer:
 * duraklatilmis ad set harcamaz, butcesi kampanyanin gunluk harcamasi degildir.
 */
const META_LIVE_ADSET_STATUSES = ['ACTIVE', 'PAUSED', 'CAMPAIGN_PAUSED', 'IN_PROCESS', 'WITH_ISSUES'];
/** Sayfa boyu ve en fazla sayfa: sonsuz sayfalama turu kilitlemesin, eksik liste yazilmasin */
const META_PAGE_LIMIT = 100;
const META_MAX_PAGES = 20;

/**
 * Etkin (status ACTIVE) ama yayin takvimi bitmis kampanyanin platformStatus
 * eki. NEDEN: Meta'da bitis tarihi gecen ad set icin ayri bir effective_status
 * YOK — AdSet.EffectiveStatus yalniz ACTIVE, PAUSED, DELETED, CAMPAIGN_PAUSED,
 * ARCHIVED, IN_PROCESS, WITH_ISSUES (resmi Ad Set referansi ve
 * facebook-python-business-sdk adobjects/adset.py EffectiveStatus); bitmislik
 * ayri tutulur: kampanyanin /adsets kenarinda `is_completed` ("Filter adsets
 * by completed status") suzgeci ve ad set'in end_time alani ("End time, in UTC
 * UNIX timestamp"). Reklam Yoneticisi "Completed" durumunu "no longer running
 * because the scheduled end date has passed" diye tanimlar (Meta Isletme
 * Yardim Merkezi 650774041651557); bitmis ad set'teki reklam duzenlenemez
 * (Marketing API hata 1487007 "part of a scheduled ad set that has reached its
 * end date"). Yani effective_status ACTIVE goruneni bitmis ad set harcamaz;
 * eskiden canli toplama ve yazim hedeflerine giriyordu.
 */
const META_COMPLETED_SUFFIX = '/COMPLETED';

/**
 * Etkin (status ACTIVE) ama yayin takvimi henuz BASLAMAMIS kampanyanin
 * platformStatus eki — Google'daki serving_status PENDING'in karsiligi.
 * NEDEN: baslangic tarihi gelmemis ad set icin de ayri bir effective_status
 * YOK (yukaridaki listede "scheduled" degeri yok; resmi Ad Set referansi
 * https://developers.facebook.com/docs/marketing-api/reference/ad-campaign/ ve
 * facebook-python-business-sdk adobjects/adset.py EffectiveStatus). Baslangic
 * ad set'in start_time alaninda: "Start time, in UTC UNIX timestamp" (Ad Set
 * referansi; SDK adset.py 'start_time': 'datetime'). Reklam Yoneticisi bu
 * durumu "Scheduled: The ad set is scheduled to run at a future date" ve
 * "PENDING: ... isn't running yet. It's usually in review or scheduled to
 * begin running at a later start date" diye tanimlar (Meta Isletme Yardim
 * Merkezi 650774041651557, 2026-10-18'de okundu). Yani gelecekte baslayacak ad
 * set bugun harcamaz; eskiden butcesi canli gunluk toplama giriyor (budget-guard
 * tabani ve tavani sisiyordu) ve otopilotun +%20'si ad set'in henuz
 * baslamamis yayinina da yaziliyordu.
 */
const META_SCHEDULED_SUFFIX = '/SCHEDULED';

const META_BAD_CAMPAIGN_ID = 'Meta kampanya kimliği geçersiz; kimlik yalnız rakamlardan oluşmalı.';
const META_CAMPAIGN_ENDED = 'Meta kampanyası arşivlenmiş ya da silinmiş; bütçesi değiştirilemez.';
const META_CAMPAIGN_COMPLETED = 'Meta kampanyasının yayın takvimi bitmiş (reklam setlerinin bitiş tarihi geçmiş); kampanya yayında olmadığı için bütçesi değiştirilmedi.';
/**
 * CBO: Meta kampanyanin (ad set'lerden birlestirilen) baslangic tarihini
 * gelecekte gosteriyor. "Merging" kesin tanimli olmadigi icin metin yalniz
 * Meta'nin bildirdigini soyler, "hicbir ad set yayinda degil" demez.
 */
const META_CAMPAIGN_NOT_STARTED = 'Meta, kampanyanın başlangıç tarihini gelecekte gösteriyor; bu yüzden bütçesi değiştirilmedi.';
/** Ad set butceli: hicbir etkin ad set su an yayinda degil, bitmemis olanlarin baslangici gelmedi */
const META_ADSETS_NOT_STARTED = 'Meta kampanyasında şu an yayında olan reklam seti yok; kalan reklam setlerinin başlangıç tarihi henüz gelmedi. Bütçesi değiştirilmedi.';
const META_BUDGET_NOT_DAILY = 'Meta kampanyasının bütçesi günlük değil (toplam bütçe ya da hem günlük hem toplam bütçeli reklam setleri); yalnız günlük bütçe değiştirilebilir.';
const META_BUDGET_STALE = 'Kampanyanın bütçesi Meta\'da değişmiş; RanksUp yazmadan önce yeniden okudu ve değişikliği yapmadı.';

interface MetaAdSetBudget {
  id: string;
  /** Simdiki gunluk butce, en kucuk birimde */
  minor: number;
}

/** Canli butce + yazim hedefi: CBO ise kampanya, degilse etkin ad set'ler */
interface MetaBudgetPlan {
  live: LiveCampaignBudget;
  target: { kind: 'campaign'; minor: number } | { kind: 'adsets'; adsets: MetaAdSetBudget[] } | null;
  /** Etkin kampanya yayin takvimi baslamadigi icin 'OTHER' sayildiysa musteriye donecek neden */
  notStartedError?: string;
}

type MetaWriteOutcome = 'ok' | 'failed' | 'unknown';

/**
 * Meta Marketing API client — resmi Graph API.
 * Docs: https://developers.facebook.com/docs/marketing-api
 *
 * Auth: Long-lived user access token (60 gun).
 *
 * Env:
 *   META_APP_ID
 *   META_APP_SECRET
 */
@Injectable()
export class MetaAdsClientService {
  private readonly log = new Logger(MetaAdsClientService.name);
  // SURUM NOTU: Meta surum tablosuna gore Marketing API v21.0 2025-09-09'da sona
  // erdi (https://developers.facebook.com/docs/graph-api/changelog/versions).
  // Graph API politikasi suresi dolan surume gelen cagriyi bir sonraki
  // kullanilabilir surume yonlendirmek; Marketing API icin ayrica yazmiyor.
  // Yukseltme davranis farki dogrulanarak ayri is olarak yapilmali.
  private readonly apiVersion = 'v21.0';

  constructor(private readonly prisma: PrismaService) {}

  private async getToken(siteId: string): Promise<string | null> {
    const site: any = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    if (!site.metaAdsAccessToken) return null;
    try { return decrypt(site.metaAdsAccessToken); } catch { return site.metaAdsAccessToken; }
  }

  /**
   * Reklam hesabinin para birimi (ISO 4217) — Ad Account `currency`: "The
   * currency used for the account, based on the corresponding value in the
   * account settings." (https://developers.facebook.com/docs/marketing-api/reference/ad-account/)
   * Okunamazsa null: cagiran tutari tahminle yazmaz (birim yanlissa butce 100 kat sapar).
   */
  async getAccountCurrency(siteId: string): Promise<string | null> {
    const token = await this.getToken(siteId);
    if (!token) return null;
    const site: any = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    const accountId = String(site.metaAdsAccountId ?? '').replace(/^act_/, '');
    if (!accountId) return null;
    try {
      const res = await fetch(`https://graph.facebook.com/${this.apiVersion}/act_${accountId}?fields=currency&access_token=${token}`);
      if (!res.ok) {
        this.log.warn(`[${siteId}] Meta hesap para birimi alinamadi: HTTP ${res.status}`);
        return null;
      }
      const code = ((await res.json()) as any)?.currency;
      return typeof code === 'string' && ISO_CURRENCY.test(code) ? code : null;
    } catch (err: any) {
      this.log.warn(`[${siteId}] Meta hesap para birimi alinamadi: ${err?.message ?? err}`);
      return null;
    }
  }

  /**
   * Kampanya metrikleri (insights) — son 30g.
   */
  async getCampaignInsights(siteId: string, campaignId: string) {
    const token = await this.getToken(siteId);
    if (!token) throw new Error('Meta Ads bagli degil — Reklam Hesaplari sekmesinden bağla');

    const fields = 'impressions,clicks,spend,actions,action_values,ctr,cpc,reach';
    const url = `https://graph.facebook.com/${this.apiVersion}/${campaignId}/insights?fields=${fields}&date_preset=last_30d&access_token=${token}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Meta insights ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json() as any;
    const row = data?.data?.[0];
    if (!row) return null;

    // actions array: [{action_type:"purchase", value:"5"}, ...]
    const actions: any[] = Array.isArray(row.actions) ? row.actions : [];
    const actionValues: any[] = Array.isArray(row.action_values) ? row.action_values : [];
    const purchases = parseInt(actions.find((a) => a.action_type === 'purchase')?.value ?? '0', 10);
    const purchaseValue = parseFloat(actionValues.find((a) => a.action_type === 'purchase')?.value ?? '0');
    const spend = parseFloat(row.spend ?? '0');

    return {
      impressions: parseInt(row.impressions ?? '0', 10),
      clicks: parseInt(row.clicks ?? '0', 10),
      spend,
      conversions: purchases,
      ctr: parseFloat(row.ctr ?? '0') / 100,
      cpc: parseFloat(row.cpc ?? '0'),
      roas: spend > 0 ? purchaseValue / spend : 0,
      reach: parseInt(row.reach ?? '0', 10),
    };
  }

  /**
   * Kampanya status update.
   */
  async setCampaignStatus(siteId: string, campaignId: string, status: 'ACTIVE' | 'PAUSED'): Promise<{ ok: boolean }> {
    const token = await this.getToken(siteId);
    if (!token) return { ok: false };

    try {
      const res = await fetch(`https://graph.facebook.com/${this.apiVersion}/${campaignId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          status,
          access_token: token,
        }),
      });
      return { ok: res.ok };
    } catch (err: any) {
      this.log.warn(`Meta status fail: ${err.message}`);
      return { ok: false };
    }
  }

  /**
   * Meta hata govdesinden log satiri (kod/alt kod/mesaj). Mesaj bir adres
   * yansitirsa icindeki access_token loga girmesin diye maskelenir.
   */
  private async describeMetaError(res: Response): Promise<string> {
    const body: any = await res.json().catch(() => null);
    const e = body?.error;
    const code = e?.code ? ` · kod ${e.code}${e.error_subcode ? `/${e.error_subcode}` : ''}` : '';
    const msg = typeof e?.message === 'string'
      ? ` · "${e.message.replace(/access_token=[^&\s"']+/g, 'access_token=***').slice(0, 160)}"`
      : '';
    return `HTTP ${res.status}${code}${msg}`;
  }

  /**
   * Kampanyanin su an yayindaki ad set'leri (yapilandirilmis durum ACTIVE,
   * yayin takvimi baslamis ve bitmemis), butce alanlariyla, TUM sayfalar.
   * Sayfalama paging.next ile: "If not included, this is the last page of data"
   * (https://developers.facebook.com/docs/graph-api/results; resmi SDK'nin
   * Cursor'u da next varken sonraki sayfayi ister). Eski kod yalniz ilk sayfayi
   * (varsayilan 25) guncelliyordu. Bir sayfa okunamazsa ya da sinir asilirsa
   * null: eksik listeyle toplam hesaplanip yazilmaz.
   *
   * end_time'i gecmis ad set listeye girmez (META_COMPLETED_SUFFIX notu):
   * effective_status'u ACTIVE kalsa da harcamaz; canli toplama ve yazim
   * hedeflerine girerse kaydirici yayindaki kampanyanin butcesini harcanamayan
   * ad set'e aktarir. `ended` bu yuzden disarida birakilan etkin ad set sayisi.
   * end_time okunamayan ad set varsa liste null (bitip bitmedigi bilinmiyor).
   *
   * start_time'i GELECEKTE olan ad set de listeye girmez (META_SCHEDULED_SUFFIX
   * notu): bugun harcamaz; canli toplama girerse budget-guard tabani ve tavani
   * sisiyor, otopilot artisi henuz baslamamis yayinin butcesine de yaziliyordu.
   * `scheduled` disarida birakilan bu ad set'lerin sayisi; start_time okunamayan
   * (bitmemis) ad set varsa liste null (baslayip baslamadigi bilinmiyor).
   */
  private async listActiveAdSets(siteId: string, token: string, campaignId: string, now: number): Promise<{ adsets: any[]; ended: number; scheduled: number } | null> {
    const statuses = encodeURIComponent(JSON.stringify(META_LIVE_ADSET_STATUSES));
    let url: string | null =
      `${GRAPH_HOST}${this.apiVersion}/${campaignId}/adsets?fields=id,status,daily_budget,lifetime_budget,end_time,start_time` +
      `&effective_status=${statuses}&limit=${META_PAGE_LIMIT}&access_token=${token}`;
    const out: any[] = [];
    let ended = 0;
    let scheduled = 0;
    for (let page = 0; url; page++) {
      if (page >= META_MAX_PAGES) {
        this.log.warn(`[${siteId}/${campaignId}] Meta ad set listesi ${META_MAX_PAGES} sayfayi asti; butce okunmadi`);
        return null;
      }
      const res = await fetch(url);
      if (!res.ok) {
        this.log.warn(`[${siteId}/${campaignId}] Meta ad set listesi alinamadi: ${await this.describeMetaError(res)}`);
        return null;
      }
      const body: any = await res.json();
      if (!Array.isArray(body?.data)) return null;
      for (const a of body.data) {
        if (typeof a?.id !== 'string' || !META_ID.test(a.id)) return null;
        if (a.status !== 'ACTIVE') continue;
        const end = metaTimeMs(a.end_time);
        if (end === undefined) {
          this.log.warn(`[${siteId}/${campaignId}] Meta ad set ${a.id} bitis zamani okunamadi (${String(a.end_time).slice(0, 40)}); butce okunmadi`);
          return null;
        }
        if (end !== null && end <= now) {
          ended++;
          continue;
        }
        // Bitmis ad set'in baslangici sorulmaz; bitmemis olanin okunamayan baslangici "bilinmiyor"
        const start = metaTimeMs(a.start_time);
        if (start === undefined) {
          this.log.warn(`[${siteId}/${campaignId}] Meta ad set ${a.id} baslangic zamani okunamadi (${String(a.start_time).slice(0, 40)}); butce okunmadi`);
          return null;
        }
        if (start !== null && start > now) {
          scheduled++;
          continue;
        }
        out.push(a);
      }
      const next = body?.paging?.next;
      if (next === undefined || next === null) url = null;
      else if (typeof next === 'string' && next.startsWith(GRAPH_HOST)) url = next;
      else return null; // beklenmeyen sonraki sayfa adresi: listeyi tamamlanmis sayma
    }
    return { adsets: out, ended, scheduled };
  }

  /**
   * Canli durum + gunluk butce + yazim hedefi. Kampanya butcesi (Advantage /
   * CBO) VARSA tutar kampanyadadir; "You can either set budget at the campaign
   * level or at the adset level, not both"
   * (https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/).
   * Yoksa kampanyanin gunluk butcesi etkin ad set'lerin gunluk butcelerinin
   * toplamidir. Butce alanlari en kucuk birimdedir (dosya basindaki not).
   * Okunamazsa null.
   *
   * Yayin takvimi bitmis etkin kampanya 'OTHER' (platformStatus
   * ACTIVE/COMPLETED) olur: otopilot, kaydirici ve updateDailyBudget dokunmaz.
   * 'ENDED' DEGIL — liveSyncPatch ENDED'i kayda kalici yazar; musteri bitis
   * tarihini uzatirsa kampanya yeniden yayina girer.
   *  - CBO: kampanyanin stop_time'i ("Merging of stop_times for the ad sets
   *    belonging to this campaign, if available" — resmi Campaign referansi;
   *    facebook-python-business-sdk adobjects/campaign.py 'stop_time':
   *    'datetime') gecmisse. "Merging" kesin tanimli degil; en erken bitis
   *    anlamina gelse bile sonuc butceye DOKUNMAMAK olur (temkinli yon).
   *  - Ad set butceli: tum etkin ad set'lerin end_time'i gecmisse; bir kismi
   *    bittiyse yalniz bitmeyenler toplanir ve yazilir (listActiveAdSets).
   *
   * Yayin takvimi henuz BASLAMAMIS etkin kampanya da 'OTHER' olur
   * (platformStatus ACTIVE/SCHEDULED; Google PENDING'in karsiligi), kalici
   * degildir: baslangic tarihi gelince kampanya kendiliginden yayina girer.
   *  - CBO: kampanyanin start_time'i ("Merging of start_times for the ad sets
   *    belonging to this campaign. At the campaign level, start_time is a read
   *    only field" — resmi Campaign referansi; SDK campaign.py 'start_time':
   *    'datetime') gelecekteyse. stop_time ile ayni temkin: "merging" kesin
   *    tanimli degil, en gec baslangic anlamina gelse bile sonuc butceye
   *    DOKUNMAMAK olur.
   *  - Ad set butceli: baslangici gelecekte olan ad set toplama ve yazim
   *    hedeflerine girmez (listActiveAdSets); yayinda olan hic kalmazsa ve
   *    baslamamis olan varsa kampanya ACTIVE/SCHEDULED.
   */
  private async readBudgetPlan(siteId: string, token: string, campaignId: string, currency: string): Promise<MetaBudgetPlan | null> {
    const res = await fetch(`${GRAPH_HOST}${this.apiVersion}/${campaignId}?fields=effective_status,daily_budget,lifetime_budget,stop_time,start_time&access_token=${token}`);
    if (!res.ok) {
      this.log.warn(`[${siteId}/${campaignId}] Meta kampanyasi okunamadi: ${await this.describeMetaError(res)}`);
      return null;
    }
    const c: any = await res.json();
    const now = Date.now();
    const platformStatus = typeof c?.effective_status === 'string' ? c.effective_status : 'UNKNOWN';
    const live: LiveCampaignBudget = {
      status: META_CAMPAIGN_STATUS[platformStatus] ?? 'OTHER',
      platformStatus,
      budgetType: null,
      amount: null,
    };
    // Etkin gorunen ama takvimi bitmis kampanya: kalici olmayan 'OTHER'
    const completed = (l: LiveCampaignBudget): LiveCampaignBudget =>
      (l.status === 'ACTIVE' ? { ...l, status: 'OTHER', platformStatus: `${l.platformStatus}${META_COMPLETED_SUFFIX}` } : l);
    // Etkin gorunen ama takvimi henuz baslamamis kampanya: kalici olmayan 'OTHER'
    const scheduled = (l: LiveCampaignBudget): LiveCampaignBudget =>
      (l.status === 'ACTIVE' ? { ...l, status: 'OTHER', platformStatus: `${l.platformStatus}${META_SCHEDULED_SUFFIX}` } : l);

    const campaignDaily = parseMetaMinor(c?.daily_budget);
    const campaignLifetime = parseMetaMinor(c?.lifetime_budget);
    if (campaignDaily !== null || campaignLifetime !== null) {
      // Bitis ve baslangic yalniz etkin kampanyanin durumunu degistirir; digerlerinde okunmaz
      const stop = live.status === 'ACTIVE' ? metaTimeMs(c?.stop_time) : null;
      if (stop === undefined) {
        this.log.warn(`[${siteId}/${campaignId}] Meta kampanyasinin bitis zamani okunamadi (${String(c?.stop_time).slice(0, 40)}); butce okunmadi`);
        return null;
      }
      const ended = stop !== null && stop <= now;
      const start = live.status === 'ACTIVE' && !ended ? metaTimeMs(c?.start_time) : null;
      if (start === undefined) {
        this.log.warn(`[${siteId}/${campaignId}] Meta kampanyasinin baslangic zamani okunamadi (${String(c?.start_time).slice(0, 40)}); butce okunmadi`);
        return null;
      }
      const notStarted = start !== null && start > now;
      const cbo = ended ? completed(live) : notStarted ? scheduled(live) : live;
      const notStartedError = notStarted ? META_CAMPAIGN_NOT_STARTED : undefined;
      if (campaignDaily !== null) {
        return { live: { ...cbo, budgetType: 'daily', amount: metaAmountFromMinor(campaignDaily, currency) }, target: { kind: 'campaign', minor: campaignDaily }, notStartedError };
      }
      return { live: { ...cbo, budgetType: 'lifetime', amount: metaAmountFromMinor(campaignLifetime as number, currency) }, target: null, notStartedError };
    }
    // Arsivlenen/silinen kampanyanin ad set'leri kenardan okunamaz; yazilacak bir sey de yok
    if (live.status === 'ENDED') return { live, target: null };

    const listed = await this.listActiveAdSets(siteId, token, campaignId, now);
    if (!listed) return null;
    const { adsets } = listed;
    if (adsets.length === 0) {
      // Yayinda olan etkin ad set yok ama baslangici gelecekte olan var: kampanya henuz/yeniden baslamadi
      if (listed.scheduled > 0) {
        return { live: scheduled(live), target: null, notStartedError: live.status === 'ACTIVE' ? META_ADSETS_NOT_STARTED : undefined };
      }
      // Etkin ad set'lerin HEPSI bitmis: kampanya yayinda degil
      return { live: listed.ended > 0 ? completed(live) : live, target: null };
    }
    const dailies = adsets.map((a) => parseMetaMinor(a.daily_budget));
    if (dailies.every((d) => d !== null)) {
      const minors = dailies as number[];
      const total = minors.reduce((s, m) => s + m, 0);
      return {
        live: { ...live, budgetType: 'daily', amount: metaAmountFromMinor(total, currency) },
        target: { kind: 'adsets', adsets: adsets.map((a, i) => ({ id: a.id as string, minor: minors[i] })) },
      };
    }
    const lifetimes = adsets.map((a) => parseMetaMinor(a.lifetime_budget));
    if (dailies.every((d) => d === null) && lifetimes.every((l) => l !== null)) {
      const total = (lifetimes as number[]).reduce((s, m) => s + m, 0);
      return { live: { ...live, budgetType: 'lifetime', amount: metaAmountFromMinor(total, currency) }, target: null };
    }
    // Gunluk ve toplam butceli ad set'ler karisik (ya da butcesiz ad set): tek bir gunluk tutar yok
    return { live, target: null };
  }

  /** Kampanyanin canli durumu ve gunluk butcesi (otopilot her degisiklikten once okur) */
  async getLiveBudget(siteId: string, campaignId: string): Promise<LiveBudgetResult> {
    if (!META_ID.test(String(campaignId))) return { ok: false, error: META_BAD_CAMPAIGN_ID };
    const token = await this.getToken(siteId);
    if (!token) return { ok: false };
    const currency = await this.getAccountCurrency(siteId);
    if (!currency) return { ok: false };
    try {
      const plan = await this.readBudgetPlan(siteId, token, campaignId, currency);
      return plan ? { ok: true, live: plan.live } : { ok: false };
    } catch (err: any) {
      this.log.warn(`[${siteId}/${campaignId}] Meta canli butce okunamadi: ${err?.message ?? err}`);
      return { ok: false };
    }
  }

  /** Tek nesneye daily_budget yazar; ag hatasinda sonuc bilinmez ('unknown') */
  private async postDailyBudget(siteId: string, token: string, objectId: string, minor: number): Promise<MetaWriteOutcome> {
    try {
      const res = await fetch(`${GRAPH_HOST}${this.apiVersion}/${objectId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ daily_budget: String(minor), access_token: token }),
      });
      if (res.ok) return 'ok';
      this.log.warn(`[${siteId}/${objectId}] Meta butce yazimi reddedildi: ${await this.describeMetaError(res)}`);
      return 'failed';
    } catch (err: any) {
      this.log.warn(`[${siteId}/${objectId}] Meta butce yazimi sonucu bilinmiyor: ${err?.message ?? err}`);
      return 'unknown';
    }
  }

  /**
   * Gunluk butceyi yazar — YALNIZ canli butce hala expectedCurrent ise
   * (tutarlar hesabin para biriminde; en kucuk birim para birimine gore 100 ya
   * da 1, bilinmiyorsa butceye dokunulmaz).
   *
   * Sira: (1) kampanya okunur: arsivlenmis/silinmis ya da baska bir durumdaysa
   * yazilmaz; (2) CBO ise kampanyanin butcesi, degilse etkin ad set'lerin
   * butceleri mevcut oranlariyla olceklenir; (3) bir ad set yazimi basarisiz
   * olursa onceden yazilanlar eski degerlerine dondurulur, donusturulemezse
   * sonuc "uncertain" doner. ok: true yalniz tum yazimlar onaylandiysa.
   */
  async updateDailyBudget(siteId: string, campaignId: string, dailyBudget: number, expectedCurrent: number): Promise<BudgetWriteResult> {
    if (!META_ID.test(String(campaignId))) return { ok: false, error: META_BAD_CAMPAIGN_ID };
    if (!Number.isFinite(dailyBudget) || dailyBudget <= 0) return { ok: false };
    if (!Number.isFinite(expectedCurrent) || expectedCurrent <= 0) return { ok: false };
    const token = await this.getToken(siteId);
    if (!token) return { ok: false };
    const currency = await this.getAccountCurrency(siteId);
    if (!currency) {
      this.log.warn(`[${siteId}] Meta butcesi degistirilmedi: hesap para birimi okunamadi`);
      return { ok: false };
    }
    try {
      const plan = await this.readBudgetPlan(siteId, token, campaignId, currency);
      if (!plan) return { ok: false };
      if (!META_WRITABLE_CAMPAIGN.has(plan.live.platformStatus)) {
        this.log.log(`[${siteId}/${campaignId}] Meta kampanyasi ${plan.live.platformStatus}; butce degistirilmedi`);
        if (plan.live.status === 'ENDED') return { ok: false, error: META_CAMPAIGN_ENDED };
        // Baslamamis takvim (ACTIVE/SCHEDULED): nedeni CBO / ad set durumuna gore
        if (plan.notStartedError) return { ok: false, error: plan.notStartedError };
        return plan.live.platformStatus.endsWith(META_COMPLETED_SUFFIX) ? { ok: false, error: META_CAMPAIGN_COMPLETED } : { ok: false };
      }
      if (plan.live.budgetType !== 'daily' || plan.live.amount === null || !plan.target) {
        this.log.log(`[${siteId}/${campaignId}] Meta butcesi gunluk degil ya da okunamadi (${plan.live.budgetType ?? 'belirsiz'}); degistirilmedi`);
        return plan.live.budgetType === null ? { ok: false } : { ok: false, error: META_BUDGET_NOT_DAILY };
      }
      if (!sameBudget(plan.live.amount, expectedCurrent)) {
        this.log.warn(`[${siteId}/${campaignId}] Meta butcesi ${expectedCurrent} beklenirken ${plan.live.amount}; yazilmadi`);
        return { ok: false, stale: true, live: plan.live.amount, error: META_BUDGET_STALE };
      }

      const targetMinor = metaMinorUnits(dailyBudget, currency);
      if (targetMinor <= 0) return { ok: false };
      const applied = metaAmountFromMinor(targetMinor, currency);

      if (plan.target.kind === 'campaign') {
        const outcome = await this.postDailyBudget(siteId, token, campaignId, targetMinor);
        if (outcome === 'ok') return { ok: true, applied };
        if (outcome === 'failed') return { ok: false };
        // Sonuc bilinmiyor: eski degeri geri yazmayi dene (yazilmadiysa zararsiz)
        const back = await this.postDailyBudget(siteId, token, campaignId, plan.target.minor);
        return back === 'ok' ? { ok: false } : { ok: false, uncertain: true };
      }

      const adsets = plan.target.adsets;
      const next = distributeMetaBudget(adsets.map((a) => a.minor), targetMinor);
      if (!next) {
        this.log.warn(`[${siteId}/${campaignId}] Meta butcesi ${adsets.length} reklam setine dagitilamadi; degistirilmedi`);
        return { ok: false };
      }
      const touched: MetaAdSetBudget[] = [];
      for (let i = 0; i < adsets.length; i++) {
        if (next[i] === adsets[i].minor) continue;
        const outcome = await this.postDailyBudget(siteId, token, adsets[i].id, next[i]);
        if (outcome === 'ok') {
          touched.push(adsets[i]);
          continue;
        }
        // Bilinmeyen sonuclu yazim da geri alinacaklara girer (yazildiysa geri doner)
        if (outcome === 'unknown') touched.push(adsets[i]);
        let restored = true;
        for (const a of touched) {
          if ((await this.postDailyBudget(siteId, token, a.id, a.minor)) !== 'ok') restored = false;
        }
        if (!restored) {
          this.log.error(`[${siteId}/${campaignId}] Meta butcesi kismen yazildi ve geri alinamadi; reklam setlerini Ads Manager'da kontrol edin`);
        }
        return restored ? { ok: false } : { ok: false, uncertain: true };
      }
      return { ok: true, applied };
    } catch (err: any) {
      this.log.warn(`Meta budget fail: ${err.message}`);
      return { ok: false };
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Faz 11.3 — Campaign Creation
  // ────────────────────────────────────────────────────────────────

  /**
   * End-to-end Meta kampanya olusturur:
   *   1. campaign create (objective + status PAUSED)
   *   2. adset create (audience + budget + placements + dates)
   *   3. adcreative create (image_url + headline + primary_text + cta)
   *   4. ad create (creative + adset)
   *
   * Donus: campaignId
   *
   * Not: Meta API objective kodlari farklidir (OUTCOME_*) — payload.objective
   * frontend friendly mapping yapilir.
   */
  async createCampaign(siteId: string, payload: {
    name: string;
    objective: 'traffic' | 'leads' | 'conversions' | 'brand_awareness' | 'sales';
    /** Hesabin para biriminde (TL varsayilmaz) */
    dailyBudget: number;
    primaryText: string;
    headline: string;
    description?: string;
    imageUrl: string;            // public URL — Meta upload ile hash'a cevirilir
    landingUrl: string;
    cta?: string;                // SHOP_NOW, LEARN_MORE, SIGN_UP, BOOK_TRAVEL...
    pageId: string;              // Facebook Page (zorunlu)
    instagramActorId?: string;   // IG account (opsiyonel)
    countries?: string[];        // ['TR']
    ageMin?: number;
    ageMax?: number;
    interests?: { id: string; name: string }[]; // Meta interest IDs
  }): Promise<{ ok: boolean; campaignId?: string; error?: string }> {
    const token = await this.getToken(siteId);
    if (!token) return { ok: false, error: 'Meta Ads bagli degil' };
    const site: any = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    const accountId = String(site.metaAdsAccountId).replace(/^act_/, '');
    const currency = await this.getAccountCurrency(siteId);
    if (!currency) return { ok: false, error: 'Meta reklam hesabının para birimi okunamadı; bütçe yazılmadı' };

    // Objective mapping (yeni "ODAX" kategorileri)
    const objectiveMap: Record<string, string> = {
      traffic: 'OUTCOME_TRAFFIC',
      leads: 'OUTCOME_LEADS',
      conversions: 'OUTCOME_SALES',
      sales: 'OUTCOME_SALES',
      brand_awareness: 'OUTCOME_AWARENESS',
    };
    const metaObjective = objectiveMap[payload.objective] ?? 'OUTCOME_TRAFFIC';

    try {
      // 1) Image upload (URL → hash)
      const imgRes = await fetch(`https://graph.facebook.com/${this.apiVersion}/act_${accountId}/adimages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ url: payload.imageUrl, access_token: token }),
      });
      if (!imgRes.ok) throw new Error(`adimages ${imgRes.status}: ${(await imgRes.text()).slice(0, 200)}`);
      const imgData = await imgRes.json() as any;
      const imgKey = Object.keys(imgData.images ?? {})[0];
      const imageHash = imgData.images?.[imgKey]?.hash;
      if (!imageHash) throw new Error('image hash yok');

      // 2) Campaign
      const campRes = await fetch(`https://graph.facebook.com/${this.apiVersion}/act_${accountId}/campaigns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          name: payload.name,
          objective: metaObjective,
          status: 'PAUSED',
          special_ad_categories: '[]',
          access_token: token,
        }),
      });
      if (!campRes.ok) throw new Error(`campaign ${campRes.status}: ${(await campRes.text()).slice(0, 200)}`);
      const campData = await campRes.json() as any;
      const campaignId = campData.id;

      // 3) Ad set
      const targeting: any = {
        geo_locations: { countries: payload.countries ?? ['TR'] },
        age_min: payload.ageMin ?? 18,
        age_max: payload.ageMax ?? 65,
      };
      if (payload.interests && payload.interests.length > 0) {
        targeting.flexible_spec = [{ interests: payload.interests }];
      }

      const billingEvent = payload.objective === 'brand_awareness' ? 'IMPRESSIONS' : 'IMPRESSIONS';
      const optimizationGoal =
        payload.objective === 'leads' ? 'LEAD_GENERATION'
        : payload.objective === 'conversions' || payload.objective === 'sales' ? 'OFFSITE_CONVERSIONS'
        : payload.objective === 'brand_awareness' ? 'REACH'
        : 'LINK_CLICKS';

      const adsetParams = new URLSearchParams({
        name: `${payload.name} - AdSet`,
        campaign_id: campaignId,
        daily_budget: String(metaMinorUnits(payload.dailyBudget, currency)),
        billing_event: billingEvent,
        optimization_goal: optimizationGoal,
        targeting: JSON.stringify(targeting),
        status: 'PAUSED',
        start_time: new Date(Date.now() + 60_000).toISOString(),
        access_token: token,
      });
      const adsetRes = await fetch(`https://graph.facebook.com/${this.apiVersion}/act_${accountId}/adsets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: adsetParams,
      });
      if (!adsetRes.ok) throw new Error(`adset ${adsetRes.status}: ${(await adsetRes.text()).slice(0, 200)}`);
      const adsetData = await adsetRes.json() as any;
      const adsetId = adsetData.id;

      // 4) Ad creative
      const creativeSpec: any = {
        link_data: {
          message: payload.primaryText,
          link: payload.landingUrl,
          name: payload.headline,
          description: payload.description ?? '',
          image_hash: imageHash,
          call_to_action: { type: payload.cta ?? 'LEARN_MORE', value: { link: payload.landingUrl } },
        },
      };
      const creativePayload: any = {
        object_story_spec: {
          page_id: payload.pageId,
          link_data: creativeSpec.link_data,
          ...(payload.instagramActorId ? { instagram_actor_id: payload.instagramActorId } : {}),
        },
      };
      const creativeRes = await fetch(`https://graph.facebook.com/${this.apiVersion}/act_${accountId}/adcreatives`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          name: `${payload.name} - Creative`,
          object_story_spec: JSON.stringify(creativePayload.object_story_spec),
          access_token: token,
        }),
      });
      if (!creativeRes.ok) throw new Error(`creative ${creativeRes.status}: ${(await creativeRes.text()).slice(0, 200)}`);
      const creativeData = await creativeRes.json() as any;
      const creativeId = creativeData.id;

      // 5) Ad
      const adRes = await fetch(`https://graph.facebook.com/${this.apiVersion}/act_${accountId}/ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          name: `${payload.name} - Ad`,
          adset_id: adsetId,
          creative: JSON.stringify({ creative_id: creativeId }),
          status: 'PAUSED',
          access_token: token,
        }),
      });
      if (!adRes.ok) throw new Error(`ad ${adRes.status}: ${(await adRes.text()).slice(0, 200)}`);

      this.log.log(`[${siteId}] Meta campaign created: ${campaignId}`);
      return { ok: true, campaignId };
    } catch (err: any) {
      this.log.error(`Meta createCampaign fail: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Faz 11.3 — Page Post Insights + Boost (auto-boost)
  // ────────────────────────────────────────────────────────────────

  /**
   * Bir Facebook page post'unun son 7 gunluk insights'ini ceker.
   * postId formati: {pageId}_{postId} (Graph API page-post ID'si)
   */
  async getPagePostInsights(siteId: string, postId: string) {
    const token = await this.getToken(siteId);
    if (!token) return null;
    try {
      const metric = 'post_impressions,post_engaged_users,post_reach,post_clicks,post_reactions_by_type_total';
      const res = await fetch(`https://graph.facebook.com/${this.apiVersion}/${postId}/insights?metric=${metric}&access_token=${token}`);
      if (!res.ok) return null;
      const data = await res.json() as any;
      const map: Record<string, number> = {};
      for (const m of data.data ?? []) {
        const v = m.values?.[0]?.value;
        map[m.name] = typeof v === 'number' ? v : 0;
      }
      const reach = map.post_reach ?? 0;
      const engaged = map.post_engaged_users ?? 0;
      return {
        impressions: map.post_impressions ?? 0,
        reach,
        engagedUsers: engaged,
        clicks: map.post_clicks ?? 0,
        engagementRate: reach > 0 ? engaged / reach : 0,
      };
    } catch (err: any) {
      this.log.warn(`Meta page post insights fail: ${err.message}`);
      return null;
    }
  }

  /**
   * Bir page post'u boost et — campaign + adset + creative (object_story_id) + ad zinciri.
   * dailyBudget hesabin PARA BIRIMINDEDIR (50 = TL hesapta 50 TL, USD hesapta 50 USD);
   * cevapta kullanilan para birimi doner.
   */
  async boostPagePost(siteId: string, payload: {
    pageId: string;
    postId: string;          // Page post ID (full: pageId_postId)
    dailyBudget: number;
    days: number;            // 7
    countries?: string[];
  }): Promise<{ ok: boolean; campaignId?: string; currency?: string; error?: string }> {
    const token = await this.getToken(siteId);
    if (!token) return { ok: false, error: 'Meta Ads bagli degil' };
    const site: any = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    const accountId = String(site.metaAdsAccountId).replace(/^act_/, '');
    const currency = await this.getAccountCurrency(siteId);
    if (!currency) return { ok: false, error: 'Meta reklam hesabının para birimi okunamadı; bütçe yazılmadı' };

    try {
      // 1) Campaign
      const campRes = await fetch(`https://graph.facebook.com/${this.apiVersion}/act_${accountId}/campaigns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          name: `Boost - ${payload.postId} - ${new Date().toISOString().slice(0, 10)}`,
          objective: 'OUTCOME_ENGAGEMENT',
          status: 'ACTIVE',
          special_ad_categories: '[]',
          access_token: token,
        }),
      });
      if (!campRes.ok) throw new Error(`campaign ${campRes.status}: ${(await campRes.text()).slice(0, 200)}`);
      const campaignId = ((await campRes.json()) as any).id;

      // 2) Ad set (post engagement)
      const targeting = { geo_locations: { countries: payload.countries ?? ['TR'] }, age_min: 18, age_max: 65 };
      const start = new Date(Date.now() + 60_000);
      const end = new Date(start.getTime() + payload.days * 86400000);
      const adsetRes = await fetch(`https://graph.facebook.com/${this.apiVersion}/act_${accountId}/adsets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          name: `Boost AdSet - ${payload.postId}`,
          campaign_id: campaignId,
          daily_budget: String(metaMinorUnits(payload.dailyBudget, currency)),
          billing_event: 'IMPRESSIONS',
          optimization_goal: 'POST_ENGAGEMENT',
          targeting: JSON.stringify(targeting),
          start_time: start.toISOString(),
          end_time: end.toISOString(),
          status: 'ACTIVE',
          access_token: token,
        }),
      });
      if (!adsetRes.ok) throw new Error(`adset ${adsetRes.status}: ${(await adsetRes.text()).slice(0, 200)}`);
      const adsetId = ((await adsetRes.json()) as any).id;

      // 3) Ad creative — object_story_id (mevcut post)
      const fullPostId = payload.postId.includes('_') ? payload.postId : `${payload.pageId}_${payload.postId}`;
      const creativeRes = await fetch(`https://graph.facebook.com/${this.apiVersion}/act_${accountId}/adcreatives`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          name: `Boost Creative - ${fullPostId}`,
          object_story_id: fullPostId,
          access_token: token,
        }),
      });
      if (!creativeRes.ok) throw new Error(`creative ${creativeRes.status}: ${(await creativeRes.text()).slice(0, 200)}`);
      const creativeId = ((await creativeRes.json()) as any).id;

      // 4) Ad
      const adRes = await fetch(`https://graph.facebook.com/${this.apiVersion}/act_${accountId}/ads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          name: `Boost Ad - ${fullPostId}`,
          adset_id: adsetId,
          creative: JSON.stringify({ creative_id: creativeId }),
          status: 'ACTIVE',
          access_token: token,
        }),
      });
      if (!adRes.ok) throw new Error(`ad ${adRes.status}: ${(await adRes.text()).slice(0, 200)}`);

      this.log.log(`[${siteId}] Page post boosted: ${fullPostId}, campaign ${campaignId}, gunluk ${payload.dailyBudget} ${currency}`);
      return { ok: true, campaignId, currency };
    } catch (err: any) {
      this.log.error(`Meta boostPagePost fail: ${err.message}`);
      return { ok: false, error: err.message };
    }
  }

  // ────────────────────────────────────────────────────────────────
  // Faz 11.3 — Ad-level metrics (A/B test)
  // ────────────────────────────────────────────────────────────────

  /**
   * Graph API kenarinin TUM sayfalari (paging.next; listActiveAdSets ile ayni
   * kurallar). Bir sayfa okunamazsa, sinir asilirsa ya da sonraki sayfa adresi
   * Graph disina giderse null: eksik listeyle karar verilmez.
   */
  private async readAllMetaPages(siteId: string, campaignId: string, firstUrl: string, label: string): Promise<any[] | null> {
    const out: any[] = [];
    let url: string | null = firstUrl;
    for (let page = 0; url; page++) {
      if (page >= META_MAX_PAGES) {
        this.log.warn(`[${siteId}/${campaignId}] Meta ${label} ${META_MAX_PAGES} sayfayi asti; A/B atlandi`);
        return null;
      }
      const res = await fetch(url);
      if (!res.ok) {
        this.log.warn(`[${siteId}/${campaignId}] Meta ${label} alinamadi: ${await this.describeMetaError(res)}`);
        return null;
      }
      const body: any = await res.json();
      if (!Array.isArray(body?.data)) return null;
      out.push(...body.data);
      const next = body?.paging?.next;
      if (next === undefined || next === null) url = null;
      else if (typeof next === 'string' && next.startsWith(GRAPH_HOST)) url = next;
      else return null;
    }
    return out;
  }

  /**
   * A/B adimi icin kampanyadaki reklamlarin son 7 gunluk metrikleri, reklam
   * seti ve yayin uygunluguyla (AdVariant, ads-client.service.ts). Okuma hatasi
   * ya da kimligi eksik / tekrarlanan satir → null: A/B o kampanyada hicbir sey
   * yapmaz (eskiden hata bos liste donuyordu).
   *
   * NEDEN: eski okuma kampanya insights'ini reklam seti olmadan istiyordu; A/B
   * farkli kitlelere giden reklam setlerinin reklamlarini birlikte siralayip
   * baska bir reklam setinin TEK reklamini duraklatiyor, o reklam seti yayindan
   * dusuyordu. Bitis tarihi gecmis reklam setinin reklamlari da effective_status
   * ACTIVE gorundugu icin (META_COMPLETED_SUFFIX notu) kazanan secilebiliyordu.
   *
   * Uc okuma (her biri tum sayfalariyla):
   *  1) /{kampanya}/insights level=ad: ad_id, adset_id, adset_name, impressions,
   *     inline_link_clicks, actions, action_values (resmi Insights referansi
   *     https://developers.facebook.com/docs/marketing-api/reference/ad-campaign-group/insights/
   *     — adset_id "The unique ID of the ad set you're viewing in reporting",
   *     inline_link_clicks "The number of clicks on links to select destinations
   *     or experiences" — ve facebook-python-business-sdk adobjects/adsinsights.py
   *     Field). ad.effective_status suzgeci satir sayisini azaltir ama ona
   *     guvenilmez; durum 2. okumadan denetlenir.
   *  2) /{kampanya}/ads?effective_status=["ACTIVE"]: reklamin SU ANKI
   *     effective_status'u ve adset_id'si (kenar parametresi "Filter ads by
   *     effective status" — resmi Campaign /ads referansi ve SDK campaign.py
   *     get_ads; Ad effective_status degerleri ACTIVE, PAUSED, PENDING_REVIEW,
   *     DISAPPROVED, ADSET_PAUSED, CAMPAIGN_PAUSED, ... — resmi Ad referansi ve
   *     SDK ad.py EffectiveStatus).
   *  3) /{kampanya}/adsets?effective_status=["ACTIVE"]: reklam setinin
   *     effective_status'u ("The status could be effective either because of its
   *     own status, or the status of its parent campaign" — resmi Ad Set
   *     referansi; SDK adset.py EffectiveStatus), end_time / start_time
   *     (listActiveAdSets'teki bitmis / baslamamis kurali) ve optimization_goal.
   *
   * Uygun (eligible) reklam: kendisi ACTIVE, reklam seti ACTIVE, takvimi
   * baslamis ve bitmemis, reklam setinin optimization_goal'u LINK_CLICKS
   * ("Optimize for people more likely to click in the link of the ad" — resmi
   * Ad Set referansi; SDK adset.py OptimizationGoal.link_clicks) ve satirdaki
   * reklam seti 2. okumadakiyle ayni. NEDEN yalniz LINK_CLICKS: A/B tiklama
   * oranini karsilastirir; mesaj, potansiyel musteri ya da donusum hedefli
   * reklam setinde Meta teslimi o hedefe gore yapar ve tiklama orani dusuk
   * reklam o hedefte daha iyi olabilir; bu hedeflerin sonucunu tek bir metrikle
   * olcmek kesin degil. Karsilastirma bu yuzden baglanti tiklamasiyla
   * (inline_link_clicks) yapilir.
   */
  async getAdVariantMetrics(siteId: string, campaignId: string): Promise<AdVariant[] | null> {
    if (!META_ID.test(String(campaignId))) return null;
    const token = await this.getToken(siteId);
    if (!token) return null;
    try {
      const now = Date.now();
      const base = `${GRAPH_HOST}${this.apiVersion}/${campaignId}`;
      const active = encodeURIComponent(JSON.stringify(['ACTIVE']));
      const filtering = encodeURIComponent(JSON.stringify([{ field: 'ad.effective_status', operator: 'IN', value: ['ACTIVE'] }]));
      const insights = await this.readAllMetaPages(siteId, campaignId,
        `${base}/insights?level=ad&fields=ad_id,adset_id,adset_name,impressions,inline_link_clicks,actions,action_values` +
        `&date_preset=last_7d&filtering=${filtering}&limit=${META_PAGE_LIMIT}&access_token=${token}`, 'reklam metrikleri');
      if (!insights) return null;
      const ads = await this.readAllMetaPages(siteId, campaignId,
        `${base}/ads?fields=id,adset_id,effective_status&effective_status=${active}&limit=${META_PAGE_LIMIT}&access_token=${token}`, 'reklam listesi');
      if (!ads) return null;
      const adsets = await this.readAllMetaPages(siteId, campaignId,
        `${base}/adsets?fields=id,effective_status,optimization_goal,end_time,start_time&effective_status=${active}&limit=${META_PAGE_LIMIT}&access_token=${token}`, 'reklam seti listesi');
      if (!adsets) return null;

      const adState = new Map<string, { adsetId: string; active: boolean }>();
      for (const a of ads) {
        if (typeof a?.id !== 'string' || !META_ID.test(a.id) || typeof a.adset_id !== 'string' || !META_ID.test(a.adset_id) || adState.has(a.id)) return null;
        adState.set(a.id, { adsetId: a.adset_id, active: a.effective_status === 'ACTIVE' });
      }
      const setLive = new Map<string, boolean>();
      for (const s of adsets) {
        if (typeof s?.id !== 'string' || !META_ID.test(s.id) || setLive.has(s.id)) return null;
        // Okunamayan tarih (undefined) → bitip bitmedigi / baslayip baslamadigi bilinmiyor: uygun degil
        const end = metaTimeMs(s.end_time);
        const start = metaTimeMs(s.start_time);
        setLive.set(s.id,
          s.effective_status === 'ACTIVE'
          && s.optimization_goal === 'LINK_CLICKS'
          && end !== undefined && (end === null || end > now)
          && start !== undefined && (start === null || start <= now));
      }
      const out: AdVariant[] = [];
      const seen = new Set<string>();
      for (const r of insights) {
        if (typeof r?.ad_id !== 'string' || !META_ID.test(r.ad_id) || typeof r.adset_id !== 'string' || !META_ID.test(r.adset_id) || seen.has(r.ad_id)) {
          this.log.warn(`[${siteId}/${campaignId}] A/B: beklenmeyen Meta insights satiri; kampanya atlandi`);
          return null;
        }
        seen.add(r.ad_id);
        const st = adState.get(r.ad_id);
        out.push({
          adId: r.ad_id,
          target: r.ad_id,
          groupId: r.adset_id,
          groupName: typeof r.adset_name === 'string' ? r.adset_name.slice(0, 120) : '',
          eligible: !!st && st.active && st.adsetId === r.adset_id && setLive.get(r.adset_id) === true,
          impressions: metaCount(r.impressions),
          clicks: metaCount(r.inline_link_clicks),
          conversions: metaConversions(r.actions),
          conversionValue: metaPurchaseValue(r.action_values),
        });
      }
      return out;
    } catch (err: any) {
      this.log.warn(`[${siteId}/${campaignId}] Meta reklam varyantlari okunamadi: ${err?.message ?? err}`);
      return null;
    }
  }

  /**
   * Tek bir ad'in status'unu degistir. uncertain: yanit gelmedi ya da 5xx —
   * reklam duraklatilmis da olabilir (AdStatusWriteResult).
   */
  async setAdStatus(siteId: string, adId: string, status: 'ACTIVE' | 'PAUSED'): Promise<AdStatusWriteResult> {
    // Kimlik Graph API yoluna yazilir
    if (!META_ID.test(String(adId))) return { ok: false };
    const token = await this.getToken(siteId);
    if (!token) return { ok: false };
    try {
      const res = await fetch(`https://graph.facebook.com/${this.apiVersion}/${adId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ status, access_token: token }),
      });
      if (res.ok) return { ok: true };
      this.log.warn(`[${siteId}/${adId}] Meta reklam durumu (${status}) reddedildi: ${await this.describeMetaError(res)}`);
      return res.status >= 500 ? { ok: false, uncertain: true } : { ok: false };
    } catch (err: any) {
      this.log.warn(`Meta ad status fail: ${err.message}`);
      return { ok: false, uncertain: true };
    }
  }
}
