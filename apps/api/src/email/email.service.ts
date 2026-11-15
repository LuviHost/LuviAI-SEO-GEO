import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  duzen, dugme, olcuSatiri, bilgiKutusu, kacisla, h, etiket, p, liste, baglanti,
  kahramanOlcu, sutunGrafik, ekranKarti, ekranBolucu, MARKA, FONT,
} from './email-layout.js';
import { ENGINE_LABELS, articleOfferPlan, planEngines } from '../billing/plans.js';

/**
 * Deneme hesabinin olctugu asistanlar, e-posta cumlesi olarak ("A, B, C ve D") — plans.ts
 * planEngines('trial'). 11.11.2026 (uc paket): deneme ve Baslangic dort asistan olcer; Grok,
 * DeepSeek ve (anahtari tanimliysa) Muse Profesyonel ve ustunde. Hos geldin e-postasi yeni
 * (deneme) hesaba gider: alti asistan yazmak olcmeyecegimiz ikisini vaat ederdi.
 */
export const DENEME_ASISTANLARI: string = (() => {
  const adlar = planEngines('trial').map((e) => ENGINE_LABELS[e]);
  return adlar.length > 1 ? `${adlar.slice(0, -1).join(', ')} ve ${adlar[adlar.length - 1]}` : adlar.join('');
})();

/**
 * Makale ureten en dusuk SATISTAKI planin adi (plans.ts). 11.11.2026 (uc paket): makale
 * uretimi yalniz Profesyonel ve ustunde, Baslangic'ta yok — deneme bitisi e-postalari
 * "bir plan sec, daha fazla makale" diyemez (trial-expiry-wording.spec.ts).
 */
export const MAKALE_PLANI: string = articleOfferPlan().name_tr;

/** Deneme bitisi e-postalarinin ortak cumle parcasi: plan ne kazandirir */
const PLAN_KAZANCI = `Daha fazla site ve aylık AI görünürlük çalıştırması için bir plan seçebilirsin (makale üretimi ${MAKALE_PLANI} ve üzeri planlarda)`;
/** Plan almak icin yazilacak adres — web lib/checkout-availability PURCHASE_CONTACT_EMAIL ile ayni kutu */
export const PLAN_ILETISIM_EPOSTA = 'destek@luvihost.com';

/**
 * Kartla satin alma KAPALIYKEN (PayTR test modu) plan nasil alinir — d11, d13 ve "süren doldu"
 * e-postalarinda AYNI cumle.
 *
 * NEDEN (sahip, 16.11.2026: "satın alma kapalı ama IBAN ile ödeme alıp üyelik başlatabilirim, o
 * yüzden çalışmalı"): eski metin "Ödeme altyapımız şu an test aşamasında; satın alma açılana
 * kadar kalan deneme haklarınla devam edebilirsin" diyordu. Musteri plan ALAMAYACAGINI saniyordu
 * ve cumle ayni e-postadaki "bir plan seçebilirsin" ile celisiyordu. Gercek: kartla odeme
 * kapali, plan yazarak alinir, odeme havale / EFT ile; plani sahip baslatir.
 *
 * HTML doner (baglanti); `p()` icinde kullanilir.
 */
export const HAVALE_YOLU = `Kartla ödeme altyapımız şu an test aşamasında: plan almak istersen ${baglanti(
  'bize yaz',
  `mailto:${PLAN_ILETISIM_EPOSTA}?subject=${encodeURIComponent('RanksUp planı')}`,
)}, ödemeyi havale / EFT ile alıp planını başlatalım.`;

export type EmailTemplate =
  | 'welcome_day0'
  | 'welcome_day1'
  | 'welcome_day3'
  | 'welcome_day7'
  | 'trial_expiry_d11'
  | 'trial_expiry_d13'
  | 'trial_expired'
  | 'weekly_report'
  | 'weekly_plan'                // Pazartesi sabahi uretilen "Bu haftanin plani" (WeeklyPlanCron)
  | 'monthly_report'
  | 'first_article_published'
  | 'article_ready'
  | 'plan_upgraded'
  | 'plan_canceled'
  | 'payment_failed'
  | 'renewal_failed'             // 2026-10 otomatik yenileme cekimi basarisiz (deneme n/3)
  | 'renewal_required'           // karti kayitli olmayan aboneye: donem bitiyor, yenile
  | 'subscription_expired'       // odeme alinamadi → plan deneme duzeyine dustu
  | 'grandfathering_expiring'   // 2026-05 Premium Pricing — 30 gün uyari
  | 'grandfathering_expired';   // 2026-05 Premium Pricing — yeni fiyata gectigi gun

/**
 * "Makale hazir" e-postalarindaki editor skorunun paydasi.
 *
 * NEDEN 90: first_article_published ve article_ready yalniz
 * pipeline.service notifyArticleReady'den gider; onu runPipeline (PASS
 * sonrasi) ve worker (ayni kosunun hemen ardindan, yayin olmadiysa) cagirir.
 * Ikisi de bugunku editor olcegiyle (9 kategori x 10, pipeline.service
 * EDITOR_MAX_SCORE) yeni puanlanmis yazi icindir. Eski "/60" 16ab0d9
 * (3 Agustos 2026) oncesi hattin olcegiydi; PASS alan bir yazi e-postada
 * "75/60" gibi imkansiz bir skorla gorunuyordu. email-links.spec.ts iki
 * sabitin ayni kaldigini denetler.
 */
export const EDITOR_SCORE_MAX = 90;

const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

/** "2026-10-24".."2026-10-30" → "24–30 Ekim"; ay/yil farkliysa ikisi de yazilir */
export function gscGunAraligi(from: string, to: string): string {
  const [fy, fm, fd] = from.slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = to.slice(0, 10).split('-').map(Number);
  if (![fy, fm, fd, ty, tm, td].every(Number.isFinite)) return `${from} – ${to}`;
  if (fy === ty && fm === tm) return `${fd}–${td} ${AYLAR[tm - 1]}`;
  if (fy === ty) return `${fd} ${AYLAR[fm - 1]} – ${td} ${AYLAR[tm - 1]}`;
  return `${fd} ${AYLAR[fm - 1]} ${fy} – ${td} ${AYLAR[tm - 1]} ${ty}`;
}

/**
 * Deneme bittiginde ne olur — e-postadaki tek cumle. readOnlyAtEnd true: satin alma
 * acik, hesap salt okunur olur (trial-expiry.guard.ts). false/yok: satin alma kapali
 * (PayTR test modu); kilit yok, plan secimi istenecek.
 */
export function denemeSonu(readOnlyAtEnd: unknown): string {
  return readOnlyAtEnd === true
    ? 'Deneme bittiğinde hesabın salt okunur olur: sitelerini, makalelerini ve raporlarını görmeye ve indirmeye devam edersin; yapay zekâ ile yeni üretim, ölçüm ve analiz için bir plan seçmen gerekir. Verilerin hesabında kalır.'
    : `Deneme bittiğinde kalan deneme haklarınla devam edebilirsin; daha fazlası için plan gerekir. ${HAVALE_YOLU} Verilerin hesabında kalır.`;
}

/**
 * Deneme BITTIKTEN sonra durum — `trial_expired` e-postasinin iki paragrafi (denemeSonu'nun
 * simdiki zamanli ikizi; o "bittiğinde … olur" der, bu e-posta bittikten SONRA gider).
 *
 * readOnlyNow true: kartla satin alma ACIK, hesap su an salt okunur; plan panelden secilir.
 * false/yok: kartla satin alma KAPALI (PayTR test modu), kilit yok: kalan deneme haklariyla
 * devam edilir. Plan yine ALINABILIR — yazarak, havale / EFT ile (HAVALE_YOLU). Eskiden burada
 * "satın alma açılana kadar…" yaziyordu; "bir plan seçebilirsin" cumlesiyle celisiyordu.
 */
export function denemeBitti(readOnlyNow: unknown): [string, string] {
  return readOnlyNow === true
    ? [
        `Sitelerin, içeriklerin ve ölçüm geçmişin hesabında duruyor. ${PLAN_KAZANCI}; plan seçtiğinde kaldığın yerden devam edersin.`,
        'Hesabın şu an salt okunur: sitelerini, makalelerini ve raporlarını görmeye ve indirmeye devam edersin; yapay zekâ ile yeni üretim, ölçüm ve analiz için bir plan seçmen gerekir. Verilerin hesabında kalır.',
      ]
    : [
        `Sitelerin, içeriklerin ve ölçüm geçmişin hesabında duruyor; kalan deneme haklarınla devam edebilirsin. ${PLAN_KAZANCI}.`,
        HAVALE_YOLU,
      ];
}

/**
 * Gonderim saglayicisi (RESEND_API_KEY) yokken yazilan kayit durumu.
 *
 * NEDEN AYRI DURUM: anahtar yokken e-posta yalniz loglanip 'sent' kaydediliyor
 * ve { ok: true } donuyordu. Uretimde anahtar dusse kayitlar "gitti" diyor,
 * bildirim emailSentAt / ozet emailedAt damgalari yaziliyor, karsilama kancasi
 * ilk kaydi gorup bir daha denemiyordu — kimse hicbir sey almamisti.
 * Yerel gelistirme bozulmaz: hata firlatilmaz, konu loga yazilir.
 */
export const EMAIL_STATUS_NO_PROVIDER = 'not_sent_no_provider';

/** EmailLog.subject sutununun uzunlugu (prisma `String` = VARCHAR(191)) */
export const EMAIL_LOG_SUBJECT_MAX = 191;

/** Gonderilmemis sayilan kayit durumlari (karsilama kancasi tekrar deneyebilsin) */
export const EMAIL_NOT_SENT_STATUSES = [EMAIL_STATUS_NO_PROVIDER, 'failed'] as const;

@Injectable()
export class EmailService {
  private readonly log = new Logger(EmailService.name);
  private readonly client: Resend | null;
  private readonly from: string;

  constructor(private readonly prisma: PrismaService) {
    const key = process.env.RESEND_API_KEY;
    this.client = key ? new Resend(key) : null;
    this.from = process.env.EMAIL_FROM ?? 'RanksUp <noreply@ranksup.ai>';

    if (!this.client) {
      this.log.warn('RESEND_API_KEY yok — email gönderimi devre dışı');
    }

    // Gonderen alan adi marka alan adiyla uyusmuyorsa ACIKCA soyle.
    //
    // NEDEN: uretimde EMAIL_FROM=noreply@ai.luvihost.com idi, yani butun
    // musteri mailleri baska bir alan adindan gidiyordu ve bunu kimse
    // gormuyordu — kodun varsayilani dogruydu, env eziyordu. Sessiz sapma
    // yerine her acilista tek satir uyari daha iyi.
    //
    // Alan adi DEGISTIRILMEDEN once Resend'de dogrulanmali (DKIM + send MX);
    // dogrulanmamis alandan gonderim Resend tarafindan reddedilir ve TUM
    // mailler duser. Bkz. docs/EMAIL-ALAN-ADI.md
    const alan = this.from.match(/@([^>\s]+)/)?.[1]?.toLowerCase() ?? '';
    if (alan && !alan.endsWith('ranksup.ai')) {
      this.log.warn(
        `E-posta gonderen alan adi marka disi: "${alan}". Musteriye giden mailler ranksup.ai yerine bu alandan gidiyor. ` +
          `Degistirmeden once alan adi Resend'de dogrulanmali (docs/EMAIL-ALAN-ADI.md).`,
      );
    } else if (alan) {
      this.log.log(`E-posta gonderen: ${this.from}`);
    }
  }

  async send(opts: {
    userId?: string;
    to: string;
    template: EmailTemplate;
    data?: Record<string, any>;
  }): Promise<{ ok: boolean; resendId?: string; skipped?: 'account_deletion' | 'no_provider' }> {
    // Silme talebi olan hesaba sablon e-postasi (karsilama serisi, rapor, makale,
    // odeme/plan bildirimi) GITMEZ: erisim kapandi, hesap 30 gun sonra kalici
    // silinecek. Silme talebi ve tamamlandi e-postalari sendRaw ile gider ve bu
    // kontrole bilerek takilmaz (me/account-deletion.service.ts, account-purge.service.ts).
    if (opts.userId && (await this.deletionRequested(opts.userId))) {
      this.log.log(`[EMAIL] ${opts.template} gönderilmedi — hesap için silme talebi var (${opts.userId})`);
      return { ok: false, skipped: 'account_deletion' };
    }

    const { subject, html } = this.renderTemplate(opts.template, opts.data ?? {});

    if (!this.client) {
      // Saglayici yok (yerel gelistirme ya da uretimde eksik anahtar): GITMEDI
      // diye kaydedilir — EMAIL_STATUS_NO_PROVIDER aciklamasi
      this.log.warn(`[EMAIL] ${opts.template} → ${opts.to} GÖNDERİLMEDİ (RESEND_API_KEY yok): ${subject}`);
      await this.logEmail(opts, subject, EMAIL_STATUS_NO_PROVIDER, null);
      return { ok: false, skipped: 'no_provider' };
    }

    try {
      const result = await this.client.emails.send({
        from: this.from,
        to: opts.to,
        subject,
        html,
      });
      // Resend SDK API hatasinda FIRLATMAZ, { data: null, error } doner — eskiden
      // bu da 'sent' kaydediliyordu
      if ((result as any)?.error) {
        this.log.error(`Email send error: ${(result as any).error?.message ?? 'bilinmeyen hata'}`);
        await this.logEmail(opts, subject, 'failed', null);
        return { ok: false };
      }

      // Gonderim BASARILI. Kayit yazilamazsa (gecici veritabani hatasi) sonuc "gitmedi"ye
      // donmez: eskiden bu hata asagidaki catch'e dusuyor, GIDEN e-posta 'failed' sayiliyor ve
      // cagiran (aylik rapor, "deneme süren doldu") ertesi gun AYNI e-postayi yeniden gonderiyordu.
      await this.logEmail(opts, subject, 'sent', result.data?.id ?? null).catch((err: any) =>
        this.log.error(`[EMAIL] ${opts.template} gonderildi ama kaydi yazilamadi: ${err?.message ?? err}`),
      );
      return { ok: true, resendId: result.data?.id };
    } catch (err: any) {
      this.log.error(`Email send error: ${err.message}`);
      await this.logEmail(opts, subject, 'failed', null);
      return { ok: false };
    }
  }

  /**
   * Generic raw HTML email — template sistemini bypass eder.
   * AI alarm, custom bildirim gibi adhoc mailler icin.
   */
  async sendRaw(opts: {
    userId?: string;
    to: string;
    subject: string;
    html: string;
  }): Promise<{ ok: boolean; resendId?: string; skipped?: 'no_provider' }> {
    if (!this.client) {
      // send() ile ayni kural: GITMEDI diye kaydet (EMAIL_STATUS_NO_PROVIDER)
      this.log.warn(`[EMAIL RAW] → ${opts.to} GÖNDERİLMEDİ (RESEND_API_KEY yok): ${opts.subject}`);
      try {
        await this.prisma.emailLog.create({
          data: {
            userId: opts.userId,
            to: opts.to,
            template: 'weekly_report' as EmailTemplate,
            subject: opts.subject,
            status: EMAIL_STATUS_NO_PROVIDER,
            metadata: { kind: 'raw' } as any,
          },
        });
      } catch {
        // Gelistirme modu: kayit yazilamamasi gonderim sonucunu degistirmez
      }
      return { ok: false, skipped: 'no_provider' };
    }
    try {
      const result = await this.client.emails.send({
        from: this.from,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
      });
      if ((result as any)?.error) {
        this.log.error(`Raw email fail: ${(result as any).error?.message ?? 'bilinmeyen hata'}`);
        return { ok: false };
      }
      await this.prisma.emailLog.create({
        data: {
          userId: opts.userId,
          to: opts.to,
          template: 'weekly_report' as EmailTemplate,
          subject: opts.subject,
          status: 'sent',
          resendId: result.data?.id ?? null,
          metadata: { kind: 'raw' } as any,
        },
      });
      return { ok: true, resendId: result.data?.id };
    } catch (err: any) {
      this.log.error(`Raw email fail: ${err.message}`);
      return { ok: false };
    }
  }

  /** Hesapta silme talebi var mi — users.id uzerinden tek sorgu */
  private async deletionRequested(userId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { deletionRequestedAt: true } });
    return !!user?.deletionRequestedAt;
  }

  private async logEmail(
    opts: { userId?: string; to: string; template: EmailTemplate; data?: any },
    subject: string,
    status: string,
    resendId: string | null,
  ) {
    await this.prisma.emailLog.create({
      data: {
        userId: opts.userId,
        to: opts.to,
        template: opts.template,
        // EmailLog.subject VARCHAR(191): konu site adi / makale basligi tasir ve bunlar uzun
        // olabilir. Kesilmezse kayit HER SEFERINDE hata verir (e-posta ise gitmistir).
        subject: subject.slice(0, EMAIL_LOG_SUBJECT_MAX),
        status,
        resendId,
        metadata: opts.data as any,
      },
    });
  }

  /**
   * Template renderer — Faz 3'te react-email'e taşınır.
   * Şimdilik basit HTML template'leri.
   */
  /**
   * Sablon govdesi.
   *
   * Duzen email-layout.ts'te; buradaki her case yalnizca ICERIK uretir.
   * Boyle ayrildi cunku eski surumde her sablon kendi HTML'ini yaziyordu ve
   * marka rengi (mor #6c5ce7) uygulamanin turuncusuyla hic uyusmuyordu,
   * altbilgide "LuviHost" yaziyordu, dugmeler Outlook'ta tiklanamiyordu.
   */
  private renderTemplate(template: EmailTemplate, data: Record<string, any>): { subject: string; html: string } {
    const name = kacisla(String(data.name ?? 'merhaba'));
    // HAM ad — `h()` (baslik) ve konu satiri icin. `h`, `duzen`in <title>'i ve onizlemesi kendi
    // kacislar; oralara kacislanmis `name` verilince cift kacislaniyordu: adinda ya da makale
    // basliginda kesme isareti / & olan musteri "SEO&#39;da 5 Hata" goruyordu (konu satirinda da:
    // konu duz metindir, HTML degil). Govde paragraflari (`p`) HTML alir; orada `name` kullanilir.
    const adHam = String(data.name ?? 'merhaba');
    // Adla baslayan baslik: h(adliBaslik`deneme süren doldu`) → "Ayşe, deneme süren doldu".
    // Ad YOKSA (Apple ile giris yapan hesaplarda sik) ad ve virgul dusurulur, ilk harf buyur:
    // "Deneme süren doldu". Eskiden "merhaba, deneme süren doldu" yaziyordu. Etiketli sablon
    // olarak cagrilir; metinde degisken yoktur.
    const adVar = typeof data.name === 'string' && data.name.trim().length > 0;
    const adliBaslik = (parcalar: TemplateStringsArray) => {
      const metin = parcalar.join('');
      return adVar ? `${adHam.trim()}, ${metin}` : metin.charAt(0).toLocaleUpperCase('tr-TR') + metin.slice(1);
    };
    const baseUrl = process.env.WEB_BASE_URL ?? 'https://ranksup.ai';
    const sayi = (n: any) => (typeof n === 'number' ? n.toLocaleString('tr-TR') : n ?? '—');

    /** Konu + onizleme + govde -> tam mail */
    const yap = (subject: string, onizleme: string, govde: string) => ({
      subject,
      html: duzen(subject, govde, { onizleme, baseUrl }),
    });

    switch (template) {
      case 'welcome_day0':
        // Deneme kurallari tek kaynaktan (billing/trial-policy.ts): 14 gun, kart yok,
        // toplam 2 makale; denemede yapay zeka makaleyi KENDILIGINDEN yazmaz, uretim
        // ancak yayin hedefi bagliyken ve kullanici baslatinca olur. Site eklenince
        // kendiliginden calisan yalniz tarama (worker ONBOARDING_CHAIN runAudit) ve
        // otomatik akis acikken (varsayilan) ilk AI gorunurluk olcumudur; sonraki
        // olcumleri kullanici baslatir (kayan 7 gunde 1, billing/measurement-allowance.ts).
        // Asistan listesi plans.ts ile ayni: DENEME hesabinin olctugu dort asistan
        // (11.11.2026'ya kadar her planda ayni 6 asistandi; simdi Grok ve DeepSeek Profesyonel ve ustunde).
        return yap(
          `RanksUp'a hoş geldin${adVar ? `, ${adHam.trim()}` : ''}`,
          'Hesabın hazır: 14 gün ücretsiz, kart gerekmez. İlk siteni bağlayınca tarama hemen başlar.',
          h(`Hoş geldin${adVar ? `, ${adHam.trim()}` : ''}`) +
            p('Hesabın oluşturuldu ve 14 günlük ücretsiz denemen başladı; kart bilgisi gerekmez. İlk siteni bağladığında seni şunlar bekliyor:') +
            liste([
              '<strong>SEO sağlık taraması</strong> — 14 kontrol, sayfa sayfa; siteni eklediğin anda başlar',
              `<strong>AI görünürlük ölçümü</strong> — ${DENEME_ASISTANLARI} seni kaynak gösteriyor mu; ilk ölçüm kurulumda yapılır, sonrakileri haftada 1 kez sen başlatırsın`,
              '<strong>Makalelerin</strong> — denemede toplam 2 makale. Yapay zekâ konu başlıklarını hazırlar ama makaleyi kendiliğinden yazmaz: sitene bir yayın hedefi (ör. WordPress) bağladıktan sonra “Şimdi üret” ile sen başlatırsın',
            ]) +
            dugme('İlk siteni bağla', `${baseUrl}/onboarding`),
        );

      case 'welcome_day1':
        // Gonderim kosulu yalniz "deneme hesabi, kayittan 1 gun sonra"
        // (email.cron.ts): siteyi hic eklememis kullaniciya da gider. Bu yuzden
        // "ilk makalen uretildi" diye kesin konusulmaz, iki durum da yazilir.
        // Denemede makale kendiliginden uretilmez (billing/trial-policy.ts): eski
        // "tarama ve ilk makale kendiliginden baslar" metni bu kurala aykiriydi.
        // Baglantilar yalniz VAR OLAN yardim sayfalarina gider
        // (apps/web/src/app/(marketing)/help): eski /help/onboarding ve
        // /help/publish-targets hic yoktu, ikisi de 404 veriyordu. Yayin hedefi
        // icin ayri rehber yok; WordPress baglama adimlari SSS'de.
        // email-links.spec.ts her baglantinin web'de bir sayfaya gittigini denetler.
        return yap(
          'İlk makaleni başlattın mı?',
          'Siteni eklediysen konu başlıkların hazır; yayın hedefini bağlayıp ilk makaleni başlatabilirsin.',
          h(`Selam${adVar ? ` ${adHam.trim()}` : ''}`) +
            p('Siteni eklediysen tarama tamamlanmış ve konu başlıkların takvimine yazılmıştır. Denemede yapay zekâ makaleyi kendiliğinden yazmaz: sitene bir yayın hedefi (ör. WordPress) bağla, sonra istediğin konuda “Şimdi üret” ile başlat. Denemede toplam 2 makale hakkın var.') +
            p('Siteni henüz eklemediysen, eklediğin anda SEO taraması hemen başlar ve konu başlıkların hazırlanır.') +
            dugme('Panele git', `${baseUrl}/dashboard`) +
            p('Takıldığın yer olursa: ' + baglanti('Hızlı başlangıç rehberi', `${baseUrl}/help/getting-started`) + ' · ' +
              baglanti('Sık sorulan sorular', `${baseUrl}/faq`) + ' (WordPress bağlama dahil)'),
        );

      case 'welcome_day3':
        // email.cron.ts bunu GSC durumuna bakmadan her deneme hesabina gonderir:
        // baslik "bagli degil" diye kesin konusmaz, bagli olana da dogru kalir.
        return yap(
          'Search Console bağlantısını yaptın mı?',
          'GSC bağlanınca konu önerileri tahminle değil, gerçek arama verisiyle üretilir.',
          h(adliBaslik`Search Console'u bağladın mı?`) +
            p(`Google Search Console'u bağladığında ${kacisla(String(data.gscBenefit ?? 'konu önerileri tahminle değil, sitenin gerçek arama verisiyle üretilir'))}. Zaten bağladıysan yapman gereken bir şey yok.`) +
            bilgiKutusu(
              'Neden önemli',
              'GSC olmadan hangi sorguların sana gösterim aldığını bilemeyiz; öneriler genel kalır. Bağlandıktan sonra veri 2-3 gün içinde birikmeye başlar.',
            ) +
            dugme('Search Console bağla', `${baseUrl}/dashboard`),
        );

      case 'welcome_day7':
        return yap(
          'İlk hafta nasıl geçti?',
          'Bir sorun ya da eksik gördüysen bu maili yanıtlaman yeterli.',
          h(adliBaslik`ilk hafta doldu`) +
            // Sayi yalniz verildiyse yazilir: email.cron.ts articleCount gecirmiyor,
            // eski "birkac" yedegi hic makale uretmemis kullaniciya da gidiyordu
            (typeof data.articleCount === 'number' ? p(`Şu ana kadar ${sayi(data.articleCount)} makale üretildi.`) : '') +
            p('Takıldığın, beklediğin gibi çalışmayan bir şey varsa <strong>bu maili yanıtlaman yeterli</strong> — doğrudan bize ulaşır.') +
            dugme('Panele git', `${baseUrl}/dashboard`),
        );

      // Deneme bitis e-postalari (d11 ve d13'u email.cron.ts her gun trialEndsAt'e
      // gore gonderir). Sahip karari (21.10.2026): deneme 14 gun; bitince hesap SALT
      // OKUNUR olur (yapay zeka ile uretim / olcum / analiz yok; goruntuleme, indirme,
      // hesap silme ve odeme acik; veri silinmez) — ama yalniz satin alma acikken
      // (billing/trial-policy.ts trialAccess, trial-expiry.guard.ts). PayTR test
      // modunda kullanici plan secemez: kilit yok, metin de kilit demez (data.readOnlyAtEnd,
      // email.cron checkoutTestModeOn). Verilmezse (eski cagiran) kilit iddiasi yazilmaz.
      // Plan ne kazandirir: ucretli plan AI olcum SIKLIGINI artirmaz — her hesap
      // kayan 7 gunde 1 AI olcumu yapar (billing/measurement-allowance.ts
      // MEASUREMENT_WINDOW_MS, plana bakmaz). Planlar makale, site ve AYLIK AI
      // gorunurluk calistirmasi tavaninda ayrisir (plans.ts). trial-expiry-wording.spec.ts
      // metni plans.ts sayilarina baglar.
      // 11.11.2026 (uc paket): "daha fazla makale ... icin bir plan sec" artik HER plan icin
      // dogru degil — Baslangic'ta makale uretimi yok (0 < denemenin 2'si). Her satin alinabilir
      // planin denemeden fazla verdigi: site ve aylik calistirma; makale ayri soylenir (MAKALE_PLANI).
      case 'trial_expiry_d11':
        return yap(
          'Deneme süreni bitmesine 3 gün kaldı',
          `Daha fazla site ve aylık AI görünürlük çalıştırması için planlara göz atabilirsin (makale üretimi ${MAKALE_PLANI} ve üzeri planlarda).`,
          h(adliBaslik`deneme süreni bitmesine 3 gün kaldı`) +
            p(`14 günlük ücretsiz denemenin 11 günü doldu. ${PLAN_KAZANCI}; plan seçtiğinde sitelerin, içeriklerin ve ölçüm geçmişin olduğu gibi kalır.`) +
            p(denemeSonu(data.readOnlyAtEnd)) +
            dugme('Planları gör', `${baseUrl}/pricing`),
        );

      case 'trial_expiry_d13':
        return yap(
          'Deneme süren yarın bitiyor',
          'Plan seçtiğinde sitelerin, içeriklerin ve ölçüm geçmişin olduğu gibi kalır.',
          h(adliBaslik`deneme süren yarın bitiyor`) +
            p(`${PLAN_KAZANCI}. Plan seçtiğinde sitelerin, içeriklerin ve ölçüm geçmişin olduğu gibi kalır; kaldığın yerden devam edersin.`) +
            p(denemeSonu(data.readOnlyAtEnd)) +
            dugme('Planları gör', `${baseUrl}/pricing`),
        );

      case 'trial_expired':
        return yap(
          'Deneme süren doldu',
          'Sitelerin, içeriklerin ve ölçüm geçmişin hesabında duruyor.',
          h(adliBaslik`deneme süren doldu`) +
            // Deneme BITTI: gelecek zamanli "bittiğinde … olur" degil, simdiki durum; kartla satin
            // alma kapaliyken plan yazarak, havale ile alinir (denemeBitti, HAVALE_YOLU)
            denemeBitti(data.readOnlyAtEnd).map((paragraf) => p(paragraf)).join('') +
            dugme('Planları gör', `${baseUrl}/pricing`),
        );

      case 'first_article_published':
        return yap(
          'İlk makalen yayına hazır',
          // Onizleme metnini duzen kacislar (adHam aciklamasi): ham baslik
          `${String(data.title ?? '')} — editörden geçti, onayını bekliyor.`,
          // Veri ustte, ekran kartinda (email-layout.ts kompozisyonu); sonra baslik, metin, dugme
          olcuSatiri([
            { etiket: 'Kelime', deger: sayi(data.wordCount) },
            { etiket: 'FAQ', deger: sayi(data.faqs ?? 0) },
            { etiket: 'Editör skoru', deger: data.editorScore != null ? `${data.editorScore}/${EDITOR_SCORE_MAX}` : null },
          ]) +
            h('İlk makalen hazır') +
            p(`<strong>${kacisla(String(data.title ?? ''))}</strong> editörden geçti ve <strong>yayına hazır</strong>.`) +
            bilgiKutusu(
              'Henüz yayında değil',
              'İncelemen ve onayın gerekiyor. Düzenleyebilir, yayın hedefini seçebilir, sonra yayına alabilirsin.',
            ) +
            dugme('Makaleyi aç ve incele', String(data.publicUrl ?? `${baseUrl}/dashboard`)) +
            // Deneme planinda yayin hedefi yalniz Markdown ZIP + WordPress REST
            // (QuotaService.LIMITS.TRIAL); "WordPress/FTP" denemede FTP'yi vaat ediyordu
            p('<span style="font-size:13px;">Markdown veya HTML olarak indirebilir, ya da WordPress gibi bir yayın hedefine gönderebilirsin; FTP, cPanel ve diğer hedefler ücretli planlarda açılır.</span>'),
        );

      case 'article_ready': {
        // liveUpdate: yayindaki yazinin yeniden yazimi onay bekliyor (yari
        // otomatik icerik pivotu PASS, kapali dongu "guncelle"; pipeline.service
        // notifyArticleReady yazinin canli kopyasi varsa verir). NEDEN: tek metin
        // "Henüz yayında değil — inceleyip yayına alman gerekiyor" diyordu; yazi
        // yayindayken bu yanlis ve musteriyi "yayina almazsam sitemde yok" diye
        // yanlis karara itiyordu. Bu sayi da "Bu sitede N. makale" yazmaz: yeni
        // makale degil, var olan yazinin guncellenmis hali.
        const guncelleme = data.liveUpdate === true;
        return yap(
          guncelleme
            ? `Güncelleme onayını bekliyor: ${String(data.title ?? '')}`
            : `Makalen hazır: ${String(data.title ?? '')}`,
          guncelleme
            ? 'Yayındaki yazının güncellenmiş hali onayını bekliyor; onaylayana kadar eski hali yayında kalır.'
            : 'Editörden geçti, onayını bekliyor.',
          olcuSatiri([
            { etiket: 'Kelime', deger: sayi(data.wordCount) },
            { etiket: 'FAQ', deger: sayi(data.faqs ?? 0) },
            { etiket: 'Editör', deger: data.editorScore != null ? `${data.editorScore}/${EDITOR_SCORE_MAX}` : null },
            ...(!guncelleme && typeof data.articlesPublished === 'number'
              // Tek satir etiket ("7." / "Bu sitede" = bu sitedeki 7. makale): eskiden alt satirda
              // ayrica "makale" yaziyor, dar sutunda etiket iki satira iniyordu
              ? [{ etiket: 'Bu sitede', deger: `${data.articlesPublished}.` as string | number | null }]
              : []),
          ]) +
            etiket(guncelleme ? 'Güncelleme onay bekliyor' : 'Onay bekliyor') +
            h(String(data.title ?? 'Makalen hazır')) +
            p(guncelleme
              ? 'Editörden geçti. <strong>Yayındaki yazının güncellenmiş hali onayını bekliyor</strong>; onaylayana kadar eski hali yayında kalır.'
              : 'Editörden geçti ve onayını bekliyor. <strong>Henüz yayında değil</strong> — inceleyip yayına alman gerekiyor.') +
            dugme(guncelleme ? 'Güncellemeyi incele' : 'Makaleyi incele', String(data.publicUrl ?? `${baseUrl}/dashboard`)),
        );
      }

      case 'weekly_report': {
        const tik = data.totalClicks ?? null;
        const gos = data.totalImpressions ?? null;
        const oncekiTik = typeof data.prevClicks === 'number' ? data.prevClicks : null;
        const fark = tik !== null && oncekiTik !== null ? tik - oncekiTik : null;

        return yap(
          `Haftalık rapor: ${sayi(tik)} tıklama`,
          `${sayi(tik)} tıklama, ${sayi(gos)} gösterim, ${sayi(data.articlesPublished ?? 0)} yeni makale.`,
          // Ekran karti: haftanin verisi tek kartta (buyuk sayi + gunluk seyir + uc olcu)
          ekranKarti(
            // Tek buyuk sayi: haftanin en onemli rakami. Fark ancak onceki
            // hafta olculduyse gosterilir — yoksa "sifirdan buyume" yalani.
            kahramanOlcu({
              deger: tik === null ? null : sayi(tik),
              etiket: 'organik tıklama',
              degisim:
                fark === null
                  ? null
                  : {
                      yon: fark > 0 ? 'artis' : fark < 0 ? 'dusus' : 'yok',
                      metin: `geçen haftaya göre ${fark > 0 ? '+' : ''}${sayi(fark)}`,
                    },
              alt: fark === null && tik !== null ? 'Geçen hafta ölçüm yok — karşılaştırma yapılamadı' : undefined,
            }) +
              (Array.isArray(data.clicksSeries) ? sutunGrafik(data.clicksSeries, 'Günlük tıklama') : '') +
              ekranBolucu() +
              olcuSatiri([
                { etiket: 'Gösterim', deger: gos === null ? null : sayi(gos) },
                { etiket: 'Ort. sıra', deger: data.avgPosition ?? null },
                { etiket: 'Makale', deger: sayi(data.articlesPublished ?? 0) },
              ], { kart: false }),
          ) +
            etiket('Haftalık rapor') +
            h('Bu hafta') +
            // GSC ~2-3 gun gecikmeli: hangi gunlerin sayildigi acikca yazilir
            (typeof data.dataFrom === 'string' && typeof data.dataTo === 'string'
              ? p(`Search Console verisi: ${kacisla(gscGunAraligi(data.dataFrom, data.dataTo))}`)
              : '') +
            (data.topArticle
              ? p(`<strong>En çok tıklanan:</strong> ${kacisla(String(data.topArticle.title))} — ${sayi(data.topArticle.clicks)} tıklama`)
              : '') +
            dugme('Raporu aç', `${baseUrl}/dashboard`),
        );
      }

      case 'monthly_report': {
        // Bu sablon tip listesinde vardi ama case'i YOKTU — mailler sessizce
        // "RanksUp bildirimi" basligiyla bos govdeye dusuyordu. Sonra case yazildi ama GONDEREN
        // KOD yoktu; 15.11.2026'da baglandi (analytics/monthly-report.cron.ts, her ayin 4'u).
        //
        // VERI: onceki takvim ayinin DONDURULMUS raporu (SiteReportService.generate; alanlar
        // analytics/monthly-report.ts monthlyReportData). Baglanirken duzeltilenler:
        //  - Baglanti dondurulmus raporu acar (?rapor=<id>, web rapor-gecmisi-panel); "saklandı"
        //    cumlesi yalniz rapor kimligi varken yazilir (kimliksiz baglanti canli sayfaya gider).
        //  - SEO / GEO / AI skorlari icin once/sonra cubugu kalkti: rapor ozetinde onceki donemin
        //    skoru yok; "ölçüm yok" yazan uc cubuk yerine donem sonundaki skorlar yazilir.
        //  - Arama verisi yoksa (Search Console bagli degil) buyuk "0 tıklama" basilmaz:
        //    olculemeyen sey 0 gosterilmez; kart skorlarla baslar.
        //  - Fark "önceki N güne göre" yazilir, "geçen aya göre" degil: kiyas ayni uzunluktaki
        //    hemen onceki donemdir (Ekim icin 31 Agustos–30 Eylul), dondurulmus raporla ayni.
        //  - Fark yoksa NEDENI yazilir: onceki donemde olcum yok / onceki donem bastan sona
        //    olculmedi / bu donemin verisi hangi gunleri kapsiyor.
        //  - Konu satiri HAM site adiyla kurulur (duzen <title> ve onizlemeyi kendi kacislar);
        //    kacislanmis ad konuya girerse gelen kutusunda "Koç &amp; Koç" gorunur.
        const siteAdiHam = String(data.siteName ?? 'siten');
        const donemHam = String(data.periodLabel ?? 'Aylık rapor');
        const raporId = typeof data.reportId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(data.reportId) ? data.reportId : null;
        const link = data.siteId
          ? `${baseUrl}/sites/${data.siteId}/report${raporId ? `?rapor=${raporId}` : ''}`
          : `${baseUrl}/dashboard`;
        const oncekiTik = typeof data.prevClicks === 'number' ? data.prevClicks : null;
        const tik = typeof data.totalClicks === 'number' ? data.totalClicks : null;
        const fark = tik !== null && oncekiTik !== null ? tik - oncekiTik : null;
        const kiyasDonemi =
          typeof data.periodDays === 'number' && data.periodDays > 0 ? `önceki ${data.periodDays} güne göre` : 'önceki döneme göre';
        // Fark yokken nedeni (oncelik sirasiyla): bu donem bastan sona olculmedi / onceki donem
        // bastan sona olculmedi / onceki donemde hic olcum yok
        const farkYok =
          typeof data.dataFrom === 'string' && typeof data.dataTo === 'string'
            ? `Arama verisi ${data.dataFrom} – ${data.dataTo} arası için var; kıyas yapılmadı`
            : data.prevPartial === true
              ? 'Önceki dönem baştan sona ölçülmedi; kıyas yapılmadı'
              : 'Önceki dönemde ölçüm yok';
        const skor = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
        const makale = sayi(data.articlesPublished ?? 0);
        const tarama = sayi(data.auditCount ?? 0);

        return yap(
          `${siteAdiHam} — aylık rapor hazır`,
          tik !== null
            ? `${sayi(tik)} tıklama, ${makale} makale. Dönem raporu panelde.`
            : `${makale} makale, ${tarama} tarama. Dönem raporu panelde.`,
          // Ekran karti: donemin verisi tek kartta (varsa buyuk sayi + skorlar + iki sayac)
          ekranKarti(
            (tik !== null
              ? kahramanOlcu({
                  deger: sayi(tik),
                  etiket: 'organik tıklama',
                  degisim:
                    fark === null
                      ? null
                      : {
                          yon: fark > 0 ? 'artis' : fark < 0 ? 'dusus' : 'yok',
                          metin: `${kiyasDonemi} ${fark > 0 ? '+' : ''}${sayi(fark)}`,
                        },
                  alt: fark === null ? farkYok : undefined,
                }) + ekranBolucu()
              : '') +
              olcuSatiri([
                { etiket: 'SEO skoru', deger: skor(data.seoScore) },
                { etiket: 'GEO skoru', deger: skor(data.geoScore) },
                { etiket: 'AI görünürlük', deger: skor(data.aiVisibility) },
              ], { kart: false }) +
              ekranBolucu() +
              olcuSatiri([
                { etiket: 'Yayınlanan makale', deger: makale },
                { etiket: 'Çalıştırılan tarama', deger: tarama },
              ], { kart: false }),
          ) +
            etiket(donemHam) +
            h(siteAdiHam) +
            p(
              `${kacisla(donemHam)} döneminin özeti yukarıda; sorgular, sayfalar ve tarama ayrıntıları panelde.` +
                (raporId ? ' Rapor, oluşturulduğu andaki sayılarla saklandı; sonradan değişmez.' : ''),
            ) +
            dugme('Raporu aç', link),
        );
      }

      case 'weekly_plan': {
        // Icerik LLM'den geliyor — kacislamadan basilirsa tek bir '<' maili
        // bozar. Diger sablonlarda veri bizim uretimimiz, burada degil.
        // Konu ve baslik HAM adi alir (duzen ve `h` kendi kacislar — adHam aciklamasi)
        const siteName = String(data.siteName ?? 'siten');
        const items: string[] = Array.isArray(data.items) ? data.items : [];
        const planLink = data.siteId ? `${baseUrl}/sites/${data.siteId}/action-plan` : `${baseUrl}/dashboard`;
        return yap(
          `Bu haftanın planı: ${siteName}`,
          items.length ? `${items.length} maddelik öncelik listesi hazır.` : 'Bu hafta öne çıkan madde çıkmadı.',
          h(`${siteName} için bu haftanın planı`) +
            p(`Asistan sitenin görünürlük verisine baktı ve ${items.length} maddelik öncelik listesi çıkardı. Maddeler Aksiyon Planına eklendi.`) +
            (items.length
              // Numarali liste: `liste` ile ayni cerceveli, sola hizali kutu (email-layout.ts)
              ? `<table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${MARKA.kart}" style="margin:6px auto 22px;max-width:520px;background:${MARKA.kart};border:1px solid ${MARKA.cizgi};border-radius:10px;"><tr><td style="padding:18px 20px 8px 8px;text-align:left;"><ol style="margin:0;padding-left:28px;font-family:${FONT};font-size:15px;line-height:1.6;color:${MARKA.govde};">${items
                  .map((t) => `<li style="margin-bottom:10px;">${kacisla(String(t))}</li>`)
                  .join('')}</ol></td></tr></table>`
              : p(`<span style="color:${MARKA.soluk};">Bu hafta öne çıkan bir madde çıkmadı — durum stabil.</span>`)) +
            dugme('Aksiyon planını aç', planLink) +
            p('<span style="font-size:13px;">Her maddenin gerekçesi ve dayandığı ölçüm açıklamasında.</span>'),
        );
      }

      case 'plan_upgraded': {
        // 11.11.2026 (uc paket): ozet olcumle baslar, makale yalniz hakki olan planda yazilir.
        // Eski metin "Aylık kotan: N makale, M site" idi; Baslangic'ta (makale uretimi yok)
        // "0 makale" ve "Aylık makale 0" kutusu cikiyordu. Calistirma sayisi aylik TAVANDIR
        // (olcum haftada 1; plans.ts aiRunsPerMonth) — bu yuzden "en fazla".
        const makale = Number(data.articleQuota ?? 0);
        const calistirma = Number(data.runQuota ?? 0);
        const ozet = [
          ...(calistirma > 0 ? [`en fazla ${sayi(calistirma)} AI görünürlük çalıştırması`] : []),
          `${sayi(data.siteQuota ?? 0)} site`,
          ...(makale > 0 ? [`${sayi(makale)} makale`] : []),
        ];
        return yap(
          `Plan aktif: ${String(data.planName ?? '')}`,
          `Aylık kotan: ${ozet.join(', ')}.`,
          olcuSatiri([
            ...(calistirma > 0 ? [{ etiket: 'Aylık AI çalıştırması (en fazla)', deger: sayi(calistirma) }] : []),
            { etiket: 'Site', deger: sayi(data.siteQuota ?? 0) },
            ...(makale > 0 ? [{ etiket: 'Aylık makale', deger: sayi(makale) }] : []),
          ]) +
            h(`${String(data.planName ?? 'Planın')} aktif`) +
            p('Aboneliğin başladı.') +
            dugme('Panele git', `${baseUrl}/dashboard`),
        );
      }

      case 'renewal_failed': {
        const kalan = Math.max(0, Number(data.maxAttempts ?? 3) - Number(data.attempt ?? 1));
        return yap(
          'Abonelik yenilemesi alınamadı',
          kalan > 0 ? `Yarın tekrar deneyeceğiz (${kalan} deneme kaldı).` : 'Son deneme de başarısız oldu.',
          h(adliBaslik`aboneliğini yenileyemedik`) +
            p(`<strong>${kacisla(String(data.planName ?? 'Planın'))}</strong> aboneliğinin yenileme ödemesi kayıtlı kartından alınamadı (deneme ${kacisla(String(data.attempt ?? 1))}/${kacisla(String(data.maxAttempts ?? 3))}).`) +
            p(kalan > 0
              ? `Yarın otomatik olarak tekrar deneyeceğiz. ${kalan} deneme sonunda da ödeme alınamazsa hesabın deneme düzeyine geçer. Kartını güncellemek için aboneliğini yeniden başlatabilirsin.`
              : 'Hesabın deneme düzeyine geçti. Aboneliği yeniden başlatarak kaldığın yerden devam edebilirsin.') +
            (data.reasonMsg ? bilgiKutusu('Bankadan gelen yanıt', kacisla(String(data.reasonMsg))) : '') +
            dugme('Aboneliği yönet', `${baseUrl}/billing`),
        );
      }

      case 'renewal_required':
        // Elle yenileme yolunda gider (billing/renewal-policy.ts): otomatik yenileme
        // KAPALIYKEN herkese, aciksa yalniz karti kayitli olmayana. "Kartini kaydedersen
        // otomatik yenilenir" yalniz ozellik aciksa dogru: renewal.service
        // recurringEnabled'i veriye koyar; alan yoksa kapali sayilir.
        return yap(
          'Aboneliğinin yenilenmesi gerekiyor',
          `${String(data.deadlineText ?? '7 gün içinde')} tarihine kadar yenilemezsen hesabın deneme düzeyine geçer.`,
          h(adliBaslik`aboneliğini yenilemen gerekiyor`) +
            p(`<strong>${kacisla(String(data.planName ?? 'Planın'))}</strong> aboneliğinin ödenen dönemi ${data.periodEndText ? `<strong>${kacisla(String(data.periodEndText))}</strong> tarihinde bitiyor` : 'bitti'}. ${data.recurringEnabled === true ? ' Kayıtlı bir kartın olmadığı için otomatik yenileyemiyoruz.' : ' Abonelikler şu an otomatik yenilenmiyor; yenilemeyi abonelik sayfasından sen yaparsın.'}`) +
            p(`<strong>${kacisla(String(data.deadlineText ?? '7 gün içinde'))}</strong> tarihine kadar ödeme yapmazsan hesabın deneme düzeyine geçer; sitelerin ve içeriklerin silinmez.${data.recurringEnabled === true ? ' Yenilerken kartını kaydedersen sonraki dönemler otomatik yenilenir.' : ''}`) +
            dugme('Aboneliği yenile', `${baseUrl}/pricing`),
        );

      case 'subscription_expired':
        return yap(
          'Aboneliğin sona erdi',
          'Ödeme alınamadığı için hesabın deneme düzeyine geçti.',
          h(adliBaslik`aboneliğin sona erdi`) +
            p(`Ödeme alınamadığı için <strong>${kacisla(String(data.planName ?? 'aboneliğin'))}</strong> sona erdi ve hesabın deneme düzeyine geçti. Sitelerin, içeriklerin ve raporların silinmedi.`) +
            p('Aboneliği yeniden başlatarak tüm özelliklere hemen dönebilirsin.') +
            dugme('Aboneliği yeniden başlat', `${baseUrl}/pricing`),
        );

      case 'payment_failed':
        return yap(
          'Ödeme alınamadı',
          'Kartını kontrol edip tekrar deneyebilirsin. Hesabın hemen kapanmıyor.',
          h(adliBaslik`ödemeni alamadık`) +
            p('Kart bilgilerini kontrol edip tekrar deneyebilir ya da başka bir kart kullanabilirsin. Hesabın hemen kapanmıyor.') +
            (data.reasonMsg
              ? bilgiKutusu(
                  'Bankadan gelen yanıt',
                  `${kacisla(String(data.reasonMsg))}${data.reasonCode ? ` (kod: ${kacisla(String(data.reasonCode))})` : ''}`,
                )
              : '') +
            dugme('Tekrar dene', `${baseUrl}/billing`),
        );

      case 'plan_canceled':
        return yap(
          'Aboneliğin iptal edildi',
          data.accessUntilText ? `${String(data.accessUntilText)} tarihine kadar erişimin devam ediyor.` : 'Mevcut dönem sonuna kadar erişimin devam ediyor.',
          h(adliBaslik`aboneliğin iptal edildi`) +
            p(`${data.planName ? `<strong>${kacisla(String(data.planName))}</strong> planın iptal edildi. ` : ''}${data.accessUntilText ? `<strong>${kacisla(String(data.accessUntilText))}</strong> tarihine kadar` : 'Mevcut dönem sonuna kadar'} tüm özelliklerin açık kalır; sonra hesabın deneme düzeyine geçer.`) +
            p('Sonrasında ürettiğin makaleleri indirip saklayabilir, ya da tekrar abone olup kaldığın yerden devam edebilirsin.') +
            dugme('Planları gör', `${baseUrl}/pricing`) +
            p('<span style="font-size:13px;">Bir sorun yaşadıysan bu maili yanıtla — okuyoruz.</span>'),
        );

      case 'grandfathering_expiring':
        return yap(
          'Fiyatın 30 gün sonra güncelleniyor',
          `${String(data.expiryDateText ?? 'Yakında')} tarihinde yeni fiyata geçiş yapılacak.`,
          olcuSatiri([
            { etiket: 'Şu anki', deger: `₺${(data.legacyPriceTry ?? 0).toLocaleString('tr-TR')}`, alt: 'aylık' },
            { etiket: 'Yeni', deger: `$${(data.newPriceUsd ?? 0).toLocaleString('tr-TR')}`, alt: 'aylık' },
          ]) +
            h(adliBaslik`fiyatın 30 gün sonra güncelleniyor`) +
            p(`Yeni fiyatlandırmaya geçişin <strong>${kacisla(String(data.expiryDateText ?? 'yakında'))}</strong> tarihinde yapılacak.`) +
            p('<span style="font-size:13px;">Yeni fiyat ABD doları üzerindendir; ödeme günü TCMB kuruyla Türk lirasına çevrilerek tahsil edilir.</span>') +
            p(`${data.planName ? `<strong>${kacisla(String(data.planName))}</strong> planına` : 'Planına'} bu dönemde eklenen özellikler:`) +
            liste((Array.isArray(data.features) ? data.features : []).map((x: unknown) => kacisla(String(x)))) +
            dugme('Yeni fiyatları gör', `${baseUrl}/pricing`) +
            p('<span style="font-size:13px;">İtirazın veya sorun varsa bu maili yanıtlayabilirsin.</span>'),
        );

      case 'grandfathering_expired':
        return yap(
          'Yeni fiyatın bugün itibarıyla aktif',
          'Bir sonraki faturan yeni fiyat üzerinden kesilecek.',
          olcuSatiri([
            { etiket: 'Eski (sona erdi)', deger: `₺${(data.legacyPriceTry ?? 0).toLocaleString('tr-TR')}` },
            { etiket: 'Yeni aylık', deger: `$${(data.newPriceUsd ?? 0).toLocaleString('tr-TR')}` },
          ]) +
            h(adliBaslik`yeni fiyatın aktif`) +
            p('Geçiş tamamlandı. Bir sonraki faturan yeni fiyat üzerinden kesilecek.') +
            p('<span style="font-size:13px;">Tutar ödeme günü TCMB kuruyla Türk lirasına çevrilerek tahsil edilir.</span>') +
            dugme('Panele git', `${baseUrl}/dashboard`) +
            p('<span style="font-size:13px;">Aboneliğini ' + baglanti('abonelik sayfasından', `${baseUrl}/billing`) + ' yönetebilirsin.</span>'),
        );

      default:
        return yap(
          'RanksUp bildirimi',
          'Hesabınla ilgili bir güncelleme var.',
          h('Bir güncelleme var') + p(`${name}, hesabınla ilgili paylaşacağımız bir güncelleme var.`) +
            dugme('Panele git', `${baseUrl}/dashboard`),
        );
    }
  }
}
