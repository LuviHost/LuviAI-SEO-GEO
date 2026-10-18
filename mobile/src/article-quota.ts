/**
 * Ana sayfa makale kutusu — saf modul (article-quota.spec.ts).
 *
 * NEDEN: Home ekrani her hesapta "Bu ay uretilen: articlesUsedThisMonth"
 * gosteriyordu. Deneme hesabinda (plan TRIAL) hak AYLIK SIFIRLANMAZ: sunucuda
 * QuotaService.maybeResetMonthlyQuota TRIAL'da donmeden cikar, limit omur boyu
 * (LIMITS.TRIAL). Sayac "bu ay" degil, denemenin basindan beri kullanilan
 * haktir. GET /me/dashboard artik articleQuota { limit, remaining, used }
 * donuyor (api admin.service getMyDashboard, billing/article-quota-view.ts):
 * denemede "Deneme hakki: 1/2 kaldi", ucretli planda aylik etiket kalir.
 *
 * Ayrim PLAN alanina gore, subscriptionStatus'a gore degil: sifirlama kurali
 * plana bakar ve iptal edilip donemi biten abonelik plan TRIAL + durum EXPIRED
 * olur (QuotaService.expireCanceledSubscriptions); o hesabin hakki da sifirlanmaz.
 * Alan yoksa (eski sunucu ya da kota okunamadi: sunucu null doner) kalan hak
 * uydurulmaz; denemede yalniz kullanilan sayi "Kullanilan deneme hakki" olarak yazar.
 */
import type { MyDashboard } from './api';
import type { Strings } from './i18n';
import { formatInt, type UiLang } from './format';

/** Kota bicimi tek yerden: api.ts MyDashboard.articleQuota (null / yok disinda) */
export type ArticleQuota = NonNullable<MyDashboard['articleQuota']>;

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Sunucunun articleQuota alani; yoksa ya da bicim disiysa null */
export function readArticleQuota(raw: unknown): ArticleQuota | null {
  if (!raw || typeof raw !== 'object') return null;
  const q = raw as Record<string, unknown>;
  return isCount(q.limit) && isCount(q.remaining) && isCount(q.used)
    ? { limit: q.limit, remaining: q.remaining, used: q.used }
    : null;
}

export type ArticleMetricStrings = Pick<Strings, 'home_m_month' | 'home_m_trial' | 'home_trial_left' | 'home_m_trial_used'>;

/**
 * /me/dashboard cevabinin bu kutunun okudugu alanlari. articleQuota api.ts MyDashboard
 * tipinde tanimli; sunucu yine de bicim disi deger dondurebilir, readArticleQuota onu
 * savunmaci okur (sayi uydurulmaz).
 */
export type ArticleMetricInput = Pick<MyDashboard, 'plan' | 'articlesUsedThisMonth' | 'articleQuota'>;

/** Ana sayfadaki makale kutusu: etiket + dile gore bicimli deger */
export function articleMetric(dash: ArticleMetricInput, t: ArticleMetricStrings, lang: UiLang): { label: string; value: string } {
  const quota = readArticleQuota(dash.articleQuota);
  const used = quota?.used ?? (isCount(dash.articlesUsedThisMonth) ? dash.articlesUsedThisMonth : 0);
  if (dash.plan === 'TRIAL') {
    return quota
      ? { label: t.home_m_trial, value: t.home_trial_left(formatInt(quota.remaining, lang), formatInt(quota.limit, lang)) }
      : { label: t.home_m_trial_used, value: formatInt(used, lang) };
  }
  return { label: t.home_m_month, value: formatInt(used, lang) };
}
