import type { ArticleQuota, MyDashboard } from './api';

/**
 * Panel ana sayfasinin makale kutulari — saf, test edilir (article-quota.spec.mts).
 *
 * NEDEN: dashboard deneme hesabini `subscriptionStatus === 'TRIAL'` ile ayiriyordu.
 * Suresi dolan deneme (plan TRIAL, durum EXPIRED; quota.service expireOldTrials) ve
 * iptal edilip donemi biten / odemesi alinamayan abonelik (plan TRIAL, durum EXPIRED;
 * quota.service expireCanceledSubscriptions, paytr.service downgradeForNonPayment)
 * "Bu ay uretilen" ve "Plan: TRIAL" goruyordu. Oysa hak kurali PLANA bakar:
 * QuotaService.maybeResetMonthlyQuota plan TRIAL'da hic calismaz, limit omur boyu
 * LIMITS.TRIAL'dir; o hesaplarin sayaci "bu ay" degildir, ay basinda da sifirlanmaz.
 * Mobil ayni kurali mobile/src/article-quota.ts'te uygular.
 *
 * Sayilar API'nin articleQuota { limit, remaining, used } alanindan (api
 * billing/article-quota-view.ts). Alan yoksa (eski API ya da sunucu kotayi
 * okuyamadi: null) kalan hak uydurulmaz.
 */

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Sunucunun articleQuota alani; yoksa ya da bicim disiysa null */
export function readArticleQuota(raw: unknown): ArticleQuota | null {
  if (!raw || typeof raw !== 'object') return null;
  const q = raw as Record<string, unknown>;
  return isCount(q.limit) && isCount(q.remaining) && isCount(q.used)
    ? { limit: q.limit, remaining: q.remaining, used: q.used }
    : null;
}

export interface DashboardQuotaCards {
  /** Kullanilan hak (denemede omur boyu) ya da bu ay uretilen (ucretli plan) */
  used: { label: string; value: number };
  /** Denemede kalan hak, ucretli planda plan adi */
  plan: { label: string; value: string };
}

export function dashboardQuotaCards(
  me: Pick<MyDashboard, 'plan' | 'articlesUsedThisMonth'> & { articleQuota?: unknown },
): DashboardQuotaCards {
  const quota = readArticleQuota(me.articleQuota);
  const used = quota?.used ?? (isCount(me.articlesUsedThisMonth) ? me.articlesUsedThisMonth : 0);
  if (me.plan === 'TRIAL') {
    return {
      used: { label: 'Kullanılan hak', value: used },
      plan: { label: 'Ücretsiz hak', value: quota ? `${quota.remaining}/${quota.limit} kaldı` : '—' },
    };
  }
  // Ucretli plan (ya da plan bilinmiyor: onceki davranis) — sayac ay basinda sifirlanir
  return {
    used: { label: 'Bu ay üretilen', value: used },
    plan: { label: 'Plan', value: me.plan || '—' },
  };
}

/**
 * Deneme plani mi? /me/dashboard plan alanini enum ('TRIAL') doner; GET
 * /billing/users/:userId/current ise plan TANIMINI ({ id: 'trial', name, monthly... };
 * api billing.service getCurrentPlan, bilinmeyen plan PLANS[0] = trial).
 */
export function isTrialPlan(plan: unknown): boolean {
  if (typeof plan === 'string') return plan.toUpperCase() === 'TRIAL';
  return !!plan && typeof plan === 'object' && String((plan as { id?: unknown }).id ?? '').toLowerCase() === 'trial';
}

/**
 * "%85'ini" — yuzdenin belirtme hali eki (3. tekil iyelik + belirtme: -(s)InI). Ek,
 * sayi okunusunun SON kelimesine gore secilir: unluyle biten kelimede kaynastirma
 * "s" gelir (iki, alti, yedi, yirmi, elli), unlu uyumu son unluye uyar (bes/sekiz/
 * yetmis/seksen ince duz, kirk/altmis/doksan kalin duz, dokuz/on/otuz kalin yuvarlak,
 * uc/dort/yuz ince yuvarlak). Tablo dizileri bu kurali 0-100 icin acik yazar.
 * Eski metin her sayida ayni eki yaziyordu (%90 ve %82 icin yanlis).
 */
export function yuzdeBelirtmeEki(n: number): string {
  const birler = ['', "'ini", "'sini", "'ünü", "'ünü", "'ini", "'sını", "'sini", "'ini", "'unu"];
  const onlar = ['', "'unu", "'sini", "'unu", "'ını", "'sini", "'ını", "'ini", "'ini", "'ını"];
  const k = Math.abs(Math.round(n));
  if (k === 0) return "'ını";
  if (k % 10 !== 0) return birler[k % 10];
  if (k % 100 !== 0) return onlar[Math.floor(k / 10) % 10];
  // yuz (100); bin ve ustu bu ekranda yok
  return k % 1000 === 0 ? "'ini" : "'ünü";
}

export interface BillingArticleUsage {
  /** Satir etiketi */
  label: string;
  /** Sagdaki deger; kota okunamadiysa '—' */
  value: string;
  /** Ilerleme cubugu yuzdesi (0-100); kota okunamadiysa null — cubuk cizilmez */
  pct: number | null;
  /** Cubugun erisilebilir adi */
  ariaLabel: string;
  /** Alttaki not (uyari ya da bilgi); yoksa null */
  note: { tone: 'warning' | 'muted'; text: string } | null;
}

/**
 * Abonelik sayfasinin icerik kullanimi — saf, test edilir.
 *
 * NEDEN: sayfa her hesapta "Bu ay uretilen icerik", "Aylik icerik kotasi" ve "Aylik
 * kotanin %..." yaziyordu. Deneme planinda hak omur boyudur, ay basinda sifirlanmaz
 * (QuotaService.maybeResetMonthlyQuota plan TRIAL'da calismaz). Ayrim PLANA gore
 * (dashboardQuotaCards ile ayni kural): suresi dolan deneme ve iptal edilip dusen
 * abonelik (plan TRIAL, durum EXPIRED) de deneme hakkina tabidir. Sayilar /current'in
 * articleQuota { limit, remaining, used } alanindan; eskiden /quota'nin
 * limit - remaining farki kullaniliyordu (remaining sifirin altina inmez): dusen
 * abonelikte sayac limiti astiginda (used 9, limit 2) kullanim "2 / 2" gorunuyordu.
 * Alan yoksa sayi uydurulmaz.
 */
export function billingArticleUsage(current: { plan?: unknown; articleQuota?: unknown } | null | undefined): BillingArticleUsage {
  const quota = readArticleQuota(current?.articleQuota);
  if (isTrialPlan(current?.plan)) {
    if (!quota) {
      return {
        label: 'Ücretsiz içerik hakkı',
        value: '—',
        pct: null,
        ariaLabel: 'Ücretsiz içerik hakkı kullanımı',
        note: { tone: 'muted', text: 'Kalan hakkın şu an okunamadı. Deneme hakkı aylık yenilenmez.' },
      };
    }
    const pct = quota.limit > 0 ? Math.min(100, Math.round((Math.min(quota.used, quota.limit) / quota.limit) * 100)) : 100;
    return {
      label: 'Ücretsiz içerik hakkı',
      value: `${quota.remaining} / ${quota.limit} kaldı`,
      pct,
      ariaLabel: 'Ücretsiz içerik hakkı kullanımı',
      note: quota.remaining === 0
        ? { tone: 'warning', text: 'Ücretsiz içerik hakkının tamamını kullandın; deneme hakkı aylık yenilenmez. Devam etmek için bir plan seçebilirsin.' }
        : { tone: 'muted', text: 'Deneme hakkı aylık yenilenmez; plan seçtiğinde aylık kotan başlar.' },
    };
  }
  if (!quota) {
    return {
      label: 'Bu ay üretilen içerik',
      value: '—',
      pct: null,
      ariaLabel: 'Aylık içerik kotası kullanımı',
      note: { tone: 'muted', text: 'Bu ayki kullanım şu an okunamadı.' },
    };
  }
  const pct = quota.limit > 0 ? Math.min(100, Math.round((quota.used / quota.limit) * 100)) : 0;
  return {
    label: 'Bu ay üretilen içerik',
    value: `${quota.used} / ${quota.limit}`,
    pct,
    ariaLabel: 'Aylık içerik kotası kullanımı',
    note: pct > 80
      ? { tone: 'warning', text: `Aylık kotanın %${pct}${yuzdeBelirtmeEki(pct)} kullandın. Daha fazlası için planını yükseltebilirsin.` }
      : null,
  };
}
