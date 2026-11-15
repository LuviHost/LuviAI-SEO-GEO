import type { EmailTemplate } from './email.service.js';

/**
 * Panel bildirimi (kenar cubugundaki zil) — olay e-postalarinin panel karsiligi. Saf.
 *
 * NEDEN VAR (sahip, 16.11.2026: "burdaki bildirimleri kullanalım"): zil ve bildirim tablosu
 * vardi ama musteriye neredeyse hicbir sey dusmuyordu. Makale hazir, rapor, deneme ve odeme
 * olaylari YALNIZ e-postayla gidiyordu; e-postayi kacirmis musteri panelde hicbir iz gormuyordu.
 *
 * NASIL: sablon e-postalarinin tek gecidi EmailService.send. Olay niteligindeki her sablon
 * gonderilirken ayni anda bir panel bildirimi yazilir. Baslik = e-postanin konusu, metin =
 * e-postanin onizleme cumlesi (ikisi de sablonla birlikte yazilir ve test edilir; ayri bir metin
 * kopyasi tutulmaz), baglanti = bu dosyadaki esleme (panel ICI yol; e-postadaki dugme vitrine
 * gidebilir).
 *
 * ZILE DUSMEYENLER (null):
 *  - Karsilama dizisi (welcome_*): olay degil, kullanim ipuclari.
 *  - weekly_plan: WeeklyPlanCron kendi bildirimini yazar (cift olmasin).
 *
 * `Record<EmailTemplate, …>`: yeni sablon eklenince zile dusup dusmeyecegi YAZILMADAN derlenmez.
 */

export interface PanelNotification {
  title: string;
  body: string | null;
  /** Panel ici yol ("/billing", "/sites/<id>/report?rapor=<id>") */
  link: string;
  /** Kaydin `refKind` degeri: PANEL_REF_KIND ya da PANEL_BILLING_REF_KIND */
  refKind: string;
}

/** Olay e-postasindan yazilan bildirimin `refKind` degeri (`refId` = sablon adi) */
export const PANEL_REF_KIND = 'email';
/**
 * Deneme / odeme / abonelik olaylarinin `refKind` degeri — AYRI tutulur cunku bu satirlar
 * MOBIL UYGULAMADA GOSTERILMEZ. Uygulamanin ana sayfasi GET /notifications'in ilk satirlarini
 * basligi ve metniyle basar (mobile/src/screens/Home.tsx); "planlara göz atabilirsin", "Ödeme
 * alınamadı" gibi metinler uygulama ici satin alma disi bir cagri sayilip App Store incelemesinde
 * sorun cikarabilir (surum 1.0 bir kez reddedildi). Bu yuzden bildirim uclari bu satirlari
 * yalniz panel istediginde (`?scope=panel`) doner; mevcut uygulama surumu parametre gondermez.
 */
export const PANEL_BILLING_REF_KIND = 'email_billing';

/**
 * Ayni olayin bildirimi bu sure icinde bir kez yazilir. E-posta gonderilemeyince cagiran
 * ertesi gun yeniden dener (aylik rapor 4–7'si, "deneme süren doldu" uc gun); her denemede
 * yeni bir satir yazilsaydi zilde ayni bildirim dort kez gorunurdu. Haftalik olaylar (7 gun
 * arayla) bu pencereye girmez.
 */
export const PANEL_DEDUPE_WINDOW_MS = 5 * 86_400_000;

/** Notification.title ve .link sutunlari VARCHAR(191) */
const SUTUN_SINIRI = 191;
const ABONELIK = '/billing';
const PANEL = '/dashboard';

type Veri = Record<string, unknown>;

/**
 * Tam adresten panel ici yol. Kendi sitemizin adresiyse yol kismi; zaten "/" ile basliyorsa
 * aynen; baska bir site ya da bozuk degerse null (zil disariya baglanti vermez).
 */
export function panelPath(url: unknown, baseUrl: string): string | null {
  if (typeof url !== 'string' || !url) return null;
  // Ters egik cizgi tarayicida "/" sayilir ("/\\kotu.example" disariya gider): hic kabul edilmez
  if (url.includes('\\')) return null;
  const kok = baseUrl.replace(/\/+$/, '');
  const yol = url.startsWith('/') ? url : kok && url.startsWith(`${kok}/`) ? url.slice(kok.length) : null;
  if (yol === null) return null;
  // Bastaki egik cizgiler TEKE iner. Site adresi "/" ile bitiyorsa cagiran "https://site//sites/…"
  // kurar; kok atilinca kalan "//sites/…" protokole goreli bir adrestir ("sites" adli sunucu).
  // Girdinin kendisi "//…" ise (protokole goreli) reddedilir.
  if (url.startsWith('//')) return null;
  return `/${yol.replace(/^\/+/, '')}`;
}

const kimlik = (v: unknown): string | null => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null);

/** Sablon → panel ici baglanti; null = bu sablon zile dusmez */
const BAGLANTI: Record<EmailTemplate, ((d: Veri, baseUrl: string) => string) | null> = {
  welcome_day0: null,
  welcome_day1: null,
  welcome_day3: null,
  welcome_day7: null,
  weekly_plan: null,

  trial_expiry_d11: () => ABONELIK,
  trial_expiry_d13: () => ABONELIK,
  trial_expired: () => ABONELIK,

  first_article_published: (d, b) => panelPath(d.publicUrl, b) ?? PANEL,
  article_ready: (d, b) => panelPath(d.publicUrl, b) ?? PANEL,

  weekly_report: () => PANEL,
  monthly_report: (d) => {
    const site = kimlik(d.siteId);
    if (!site) return PANEL;
    const rapor = kimlik(d.reportId);
    return `/sites/${site}/report${rapor ? `?rapor=${rapor}` : ''}`;
  },

  plan_upgraded: () => ABONELIK,
  plan_canceled: () => ABONELIK,
  payment_failed: () => ABONELIK,
  renewal_failed: () => ABONELIK,
  renewal_required: () => ABONELIK,
  subscription_expired: () => ABONELIK,
  grandfathering_expiring: () => ABONELIK,
  grandfathering_expired: () => ABONELIK,
};

/** Bu sablon zile duser mi */
export function mirrorsToPanel(template: EmailTemplate): boolean {
  return BAGLANTI[template] != null;
}

/**
 * Gonderilen sablon e-postasinin panel bildirimi; zile dusmeyen sablonda null.
 * `rendered`: sablonun urettigi konu ve onizleme cumlesi (duz metin).
 */
export function panelNotificationFor(
  template: EmailTemplate,
  data: Veri,
  rendered: { subject: string; onizleme: string },
  baseUrl: string,
): PanelNotification | null {
  const baglanti = BAGLANTI[template];
  if (!baglanti) return null;
  const title = rendered.subject.trim();
  if (!title) return null;
  const link = baglanti(data, baseUrl).slice(0, SUTUN_SINIRI);
  return {
    title: title.slice(0, SUTUN_SINIRI),
    body: rendered.onizleme.trim() || null,
    link,
    // Abonelik sayfasina giden her olay deneme / odeme / abonelik olayidir
    refKind: link === ABONELIK ? PANEL_BILLING_REF_KIND : PANEL_REF_KIND,
  };
}
