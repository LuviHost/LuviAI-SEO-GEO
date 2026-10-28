import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  duzen, dugme, olcuSatiri, bilgiKutusu, kacisla, h, etiket, p, liste, baglanti,
  kahramanOlcu, karsilastirmaCubugu, sutunGrafik, bolucu, MARKA,
} from './email-layout.js';

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

/**
 * Deneme bittiginde ne olur — e-postadaki tek cumle. readOnlyAtEnd true: satin alma
 * acik, hesap salt okunur olur (trial-expiry.guard.ts). false/yok: satin alma kapali
 * (PayTR test modu); kilit yok, plan secimi istenecek.
 */
export function denemeSonu(readOnlyAtEnd: unknown): string {
  return readOnlyAtEnd === true
    ? 'Deneme bittiğinde hesabın salt okunur olur: sitelerini, makalelerini ve raporlarını görmeye ve indirmeye devam edersin; yapay zekâ ile yeni üretim, ölçüm ve analiz için bir plan seçmen gerekir. Verilerin hesabında kalır.'
    : 'Deneme bittiğinde yapay zekâ ile yeni üretim ve ölçüm için bir plan seçmen istenecek. Ödeme altyapımız şu an test aşamasında; satın alma açılana kadar kalan deneme haklarınla devam edebilirsin. Verilerin hesabında kalır.';
}

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
  }): Promise<{ ok: boolean; resendId?: string; skipped?: 'account_deletion' }> {
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
      // Dev mode: log
      this.log.log(`[EMAIL] ${opts.template} → ${opts.to}: ${subject}`);
      await this.logEmail(opts, subject, 'sent', null);
      return { ok: true };
    }

    try {
      const result = await this.client.emails.send({
        from: this.from,
        to: opts.to,
        subject,
        html,
      });

      await this.logEmail(opts, subject, 'sent', result.data?.id ?? null);
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
  }): Promise<{ ok: boolean; resendId?: string }> {
    if (!this.client) {
      this.log.log(`[EMAIL RAW] → ${opts.to}: ${opts.subject}`);
      try {
        await this.prisma.emailLog.create({
          data: {
            userId: opts.userId,
            to: opts.to,
            template: 'weekly_report' as EmailTemplate,
            subject: opts.subject,
            status: 'sent',
            metadata: { kind: 'raw' } as any,
          },
        });
      } catch {
        // Gelistirme modu: kayit yazilamamasi gonderim sonucunu degistirmez
      }
      return { ok: true };
    }
    try {
      const result = await this.client.emails.send({
        from: this.from,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
      });
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
        subject,
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
        // Asistan listesi plans.ts ile ayni 6 asistan.
        return yap(
          `RanksUp'a hoş geldin, ${name}`,
          'Hesabın hazır: 14 gün ücretsiz, kart gerekmez. İlk siteni bağlayınca tarama hemen başlar.',
          h(`Hoş geldin, ${name}`) +
            p('Hesabın oluşturuldu ve 14 günlük ücretsiz denemen başladı; kart bilgisi gerekmez. İlk siteni bağladığında seni şunlar bekliyor:') +
            liste([
              '<strong>SEO sağlık taraması</strong> — 14 kontrol, sayfa sayfa; siteni eklediğin anda başlar',
              '<strong>AI görünürlük ölçümü</strong> — ChatGPT, Claude, Gemini, Perplexity, Grok ve DeepSeek seni kaynak gösteriyor mu; ilk ölçüm kurulumda yapılır, sonrakileri haftada 1 kez sen başlatırsın',
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
          h(`Selam ${name}`) +
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
          h(`${name}, Search Console'u bağladın mı?`) +
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
          h(`${name}, ilk hafta doldu`) +
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
      case 'trial_expiry_d11':
        return yap(
          'Deneme süreni bitmesine 3 gün kaldı',
          'Daha fazla makale, site ve aylık AI görünürlük çalıştırması için planlara göz atabilirsin.',
          h(`${name}, deneme süreni bitmesine 3 gün kaldı`) +
            p('14 günlük ücretsiz denemenin 11 günü doldu. Daha fazla makale, site ve aylık AI görünürlük çalıştırması için bir plan seçebilirsin; plan seçtiğinde sitelerin, içeriklerin ve ölçüm geçmişin olduğu gibi kalır.') +
            p(denemeSonu(data.readOnlyAtEnd)) +
            dugme('Planları gör', `${baseUrl}/pricing`),
        );

      case 'trial_expiry_d13':
        return yap(
          'Deneme süren yarın bitiyor',
          'Plan seçtiğinde sitelerin, içeriklerin ve ölçüm geçmişin olduğu gibi kalır.',
          h(`${name}, deneme süren yarın bitiyor`) +
            p('Daha fazla makale, site ve aylık AI görünürlük çalıştırması için bir plan seçebilirsin. Plan seçtiğinde sitelerin, içeriklerin ve ölçüm geçmişin olduğu gibi kalır; kaldığın yerden devam edersin.') +
            p(denemeSonu(data.readOnlyAtEnd)) +
            dugme('Planları gör', `${baseUrl}/pricing`),
        );

      case 'trial_expired':
        return yap(
          'Deneme süren doldu',
          'Sitelerin, içeriklerin ve ölçüm geçmişin hesabında duruyor.',
          h(`${name}, deneme süren doldu`) +
            p('Sitelerin, içeriklerin ve ölçüm geçmişin hesabında duruyor. Daha fazla makale, site ve aylık AI görünürlük çalıştırması için bir plan seçebilirsin; plan seçtiğinde kaldığın yerden devam edersin.') +
            p(denemeSonu(data.readOnlyAtEnd)) +
            dugme('Planları gör', `${baseUrl}/pricing`),
        );

      case 'first_article_published':
        return yap(
          'İlk makalen yayına hazır',
          `${kacisla(String(data.title ?? ''))} — editörden geçti, onayını bekliyor.`,
          h('İlk makalen hazır') +
            p(`<strong>${kacisla(String(data.title ?? ''))}</strong> editörden geçti ve <strong>yayına hazır</strong>.`) +
            bilgiKutusu(
              'Henüz yayında değil',
              'İncelemen ve onayın gerekiyor. Düzenleyebilir, yayın hedefini seçebilir, sonra yayına alabilirsin.',
            ) +
            olcuSatiri([
              { etiket: 'Kelime', deger: sayi(data.wordCount) },
              { etiket: 'FAQ', deger: sayi(data.faqs ?? 0) },
              { etiket: 'Editör skoru', deger: data.editorScore != null ? `${data.editorScore}/${EDITOR_SCORE_MAX}` : null },
            ]) +
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
            ? `Güncelleme onayını bekliyor: ${kacisla(String(data.title ?? ''))}`
            : `Makalen hazır: ${kacisla(String(data.title ?? ''))}`,
          guncelleme
            ? 'Yayındaki yazının güncellenmiş hali onayını bekliyor; onaylayana kadar eski hali yayında kalır.'
            : 'Editörden geçti, onayını bekliyor.',
          etiket(guncelleme ? 'Güncelleme onay bekliyor' : 'Onay bekliyor') +
            h(kacisla(String(data.title ?? 'Makalen hazır'))) +
            p(guncelleme
              ? 'Editörden geçti. <strong>Yayındaki yazının güncellenmiş hali onayını bekliyor</strong>; onaylayana kadar eski hali yayında kalır.'
              : 'Editörden geçti ve onayını bekliyor. <strong>Henüz yayında değil</strong> — inceleyip yayına alman gerekiyor.') +
            olcuSatiri([
              { etiket: 'Kelime', deger: sayi(data.wordCount) },
              { etiket: 'FAQ', deger: sayi(data.faqs ?? 0) },
              { etiket: 'Editör', deger: data.editorScore != null ? `${data.editorScore}/${EDITOR_SCORE_MAX}` : null },
              ...(!guncelleme && typeof data.articlesPublished === 'number'
                ? [{ etiket: 'Bu sitede', deger: `${data.articlesPublished}.` as string | number | null, alt: 'makale' }]
                : []),
            ]) +
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
          etiket('Haftalık rapor') +
            h('Bu hafta') +
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
            bolucu() +
            olcuSatiri([
              { etiket: 'Gösterim', deger: gos === null ? null : sayi(gos) },
              { etiket: 'Ort. sıra', deger: data.avgPosition ?? null },
              { etiket: 'Makale', deger: sayi(data.articlesPublished ?? 0) },
            ]) +
            (data.topArticle
              ? p(`<strong>En çok tıklanan:</strong> ${kacisla(String(data.topArticle.title))} — ${sayi(data.topArticle.clicks)} tıklama`)
              : '') +
            dugme('Raporu aç', `${baseUrl}/dashboard`),
        );
      }

      case 'monthly_report': {
        // Bu sablon tip listesinde vardi ama case'i YOKTU — mailler sessizce
        // "RanksUp bildirimi" basligiyla bos govdeye dusuyordu.
        const siteAdi = kacisla(String(data.siteName ?? 'siten'));
        const link = data.siteId ? `${baseUrl}/sites/${data.siteId}/report` : `${baseUrl}/dashboard`;
        const oncekiTik = typeof data.prevClicks === 'number' ? data.prevClicks : null;
        const tik = typeof data.totalClicks === 'number' ? data.totalClicks : null;
        const fark = tik !== null && oncekiTik !== null ? tik - oncekiTik : null;

        return yap(
          `${siteAdi} — aylık rapor hazır`,
          `${sayi(data.totalClicks)} tıklama, ${sayi(data.articlesPublished ?? 0)} makale. Dönem raporu panelde.`,
          etiket(kacisla(String(data.periodLabel ?? 'Aylık rapor'))) +
            h(siteAdi) +
            kahramanOlcu({
              deger: tik === null ? null : sayi(tik),
              etiket: 'organik tıklama',
              degisim:
                fark === null
                  ? null
                  : {
                      yon: fark > 0 ? 'artis' : fark < 0 ? 'dusus' : 'yok',
                      metin: `önceki döneme göre ${fark > 0 ? '+' : ''}${sayi(fark)}`,
                    },
              alt: fark === null && tik !== null ? 'Önceki dönemde ölçüm yok' : undefined,
            }) +
            // Dönem karsilastirmasi: cubuk, sayidan cok daha hizli okunuyor.
            karsilastirmaCubugu([
              { etiket: 'SEO skoru', once: data.prevSeoScore ?? null, sonra: data.seoScore ?? null },
              { etiket: 'GEO skoru', once: data.prevGeoScore ?? null, sonra: data.geoScore ?? null },
              { etiket: 'AI görünürlük', once: data.prevAiVisibility ?? null, sonra: data.aiVisibility ?? null },
            ]) +
            bolucu() +
            p('Rapor <strong>oluşturulduğu andaki sayılarla donduruldu</strong> — sonradan açtığında aynı rakamları görürsün.') +
            olcuSatiri([
              { etiket: 'Yayınlanan makale', deger: sayi(data.articlesPublished ?? 0) },
              { etiket: 'Çalıştırılan tarama', deger: sayi(data.auditCount ?? 0) },
            ]) +
            dugme('Raporu aç', link),
        );
      }

      case 'weekly_plan': {
        // Icerik LLM'den geliyor — kacislamadan basilirsa tek bir '<' maili
        // bozar. Diger sablonlarda veri bizim uretimimiz, burada degil.
        const siteName = kacisla(String(data.siteName ?? 'siten'));
        const items: string[] = Array.isArray(data.items) ? data.items : [];
        const planLink = data.siteId ? `${baseUrl}/sites/${data.siteId}/action-plan` : `${baseUrl}/dashboard`;
        return yap(
          `Bu haftanın planı: ${siteName}`,
          items.length ? `${items.length} maddelik öncelik listesi hazır.` : 'Bu hafta öne çıkan madde çıkmadı.',
          h(`${siteName} için bu haftanın planı`) +
            p(`Asistan sitenin görünürlük verisine baktı ve ${items.length} maddelik öncelik listesi çıkardı. Maddeler Aksiyon Planına eklendi.`) +
            (items.length
              ? `<ol style="margin:0 0 16px;padding-left:20px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.7;color:${MARKA.govde};">${items
                  .map((t) => `<li style="margin-bottom:8px;">${kacisla(String(t))}</li>`)
                  .join('')}</ol>`
              : p('<span style="color:#6b6b70;">Bu hafta öne çıkan bir madde çıkmadı — durum stabil.</span>')) +
            dugme('Aksiyon planını aç', planLink) +
            p('<span style="font-size:13px;">Her maddenin gerekçesi ve dayandığı ölçüm açıklamasında.</span>'),
        );
      }

      case 'plan_upgraded':
        return yap(
          `Plan aktif: ${kacisla(String(data.planName ?? ''))}`,
          `Aylık kotan: ${sayi(data.articleQuota ?? 0)} makale, ${sayi(data.siteQuota ?? 0)} site.`,
          h(`${kacisla(String(data.planName ?? 'Planın'))} aktif`) +
            p('Aboneliğin başladı.') +
            olcuSatiri([
              { etiket: 'Aylık makale', deger: sayi(data.articleQuota ?? 0) },
              { etiket: 'Site', deger: sayi(data.siteQuota ?? 0) },
            ]) +
            dugme('Panele git', `${baseUrl}/dashboard`),
        );

      case 'renewal_failed': {
        const kalan = Math.max(0, Number(data.maxAttempts ?? 3) - Number(data.attempt ?? 1));
        return yap(
          'Abonelik yenilemesi alınamadı',
          kalan > 0 ? `Yarın tekrar deneyeceğiz (${kalan} deneme kaldı).` : 'Son deneme de başarısız oldu.',
          h(`${name}, aboneliğini yenileyemedik`) +
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
          `${kacisla(String(data.deadlineText ?? '7 gün içinde'))} tarihine kadar yenilemezsen hesabın deneme düzeyine geçer.`,
          h(`${name}, aboneliğini yenilemen gerekiyor`) +
            p(`<strong>${kacisla(String(data.planName ?? 'Planın'))}</strong> aboneliğinin ödenen dönemi ${data.periodEndText ? `<strong>${kacisla(String(data.periodEndText))}</strong> tarihinde bitiyor` : 'bitti'}. ${data.recurringEnabled === true ? ' Kayıtlı bir kartın olmadığı için otomatik yenileyemiyoruz.' : ' Abonelikler şu an otomatik yenilenmiyor; yenilemeyi abonelik sayfasından sen yaparsın.'}`) +
            p(`<strong>${kacisla(String(data.deadlineText ?? '7 gün içinde'))}</strong> tarihine kadar ödeme yapmazsan hesabın deneme düzeyine geçer; sitelerin ve içeriklerin silinmez.${data.recurringEnabled === true ? ' Yenilerken kartını kaydedersen sonraki dönemler otomatik yenilenir.' : ''}`) +
            dugme('Aboneliği yenile', `${baseUrl}/pricing`),
        );

      case 'subscription_expired':
        return yap(
          'Aboneliğin sona erdi',
          'Ödeme alınamadığı için hesabın deneme düzeyine geçti.',
          h(`${name}, aboneliğin sona erdi`) +
            p(`Ödeme alınamadığı için <strong>${kacisla(String(data.planName ?? 'aboneliğin'))}</strong> sona erdi ve hesabın deneme düzeyine geçti. Sitelerin, içeriklerin ve raporların silinmedi.`) +
            p('Aboneliği yeniden başlatarak tüm özelliklere hemen dönebilirsin.') +
            dugme('Aboneliği yeniden başlat', `${baseUrl}/pricing`),
        );

      case 'payment_failed':
        return yap(
          'Ödeme alınamadı',
          'Kartını kontrol edip tekrar deneyebilirsin. Hesabın hemen kapanmıyor.',
          h(`${name}, ödemeni alamadık`) +
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
          data.accessUntilText ? `${kacisla(String(data.accessUntilText))} tarihine kadar erişimin devam ediyor.` : 'Mevcut dönem sonuna kadar erişimin devam ediyor.',
          h(`${name}, aboneliğin iptal edildi`) +
            p(`${data.planName ? `<strong>${kacisla(String(data.planName))}</strong> planın iptal edildi. ` : ''}${data.accessUntilText ? `<strong>${kacisla(String(data.accessUntilText))}</strong> tarihine kadar` : 'Mevcut dönem sonuna kadar'} tüm özelliklerin açık kalır; sonra hesabın deneme düzeyine geçer.`) +
            p('Sonrasında ürettiğin makaleleri indirip saklayabilir, ya da tekrar abone olup kaldığın yerden devam edebilirsin.') +
            dugme('Planları gör', `${baseUrl}/pricing`) +
            p('<span style="font-size:13px;">Bir sorun yaşadıysan bu maili yanıtla — okuyoruz.</span>'),
        );

      case 'grandfathering_expiring':
        return yap(
          'Fiyatın 30 gün sonra güncelleniyor',
          `${kacisla(String(data.expiryDateText ?? 'Yakında'))} tarihinde yeni fiyata geçiş yapılacak.`,
          h(`${name}, fiyatın 30 gün sonra güncelleniyor`) +
            p(`Yeni fiyatlandırmaya geçişin <strong>${kacisla(String(data.expiryDateText ?? 'yakında'))}</strong> tarihinde yapılacak.`) +
            olcuSatiri([
              { etiket: 'Şu anki', deger: `₺${(data.legacyPriceTry ?? 0).toLocaleString('tr-TR')}`, alt: 'aylık' },
              { etiket: 'Yeni', deger: `$${(data.newPriceUsd ?? 0).toLocaleString('tr-TR')}`, alt: 'aylık' },
            ]) +
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
          h(`${name}, yeni fiyatın aktif`) +
            p('Geçiş tamamlandı. Bir sonraki faturan yeni fiyat üzerinden kesilecek.') +
            olcuSatiri([
              { etiket: 'Eski (sona erdi)', deger: `₺${(data.legacyPriceTry ?? 0).toLocaleString('tr-TR')}` },
              { etiket: 'Yeni aylık', deger: `$${(data.newPriceUsd ?? 0).toLocaleString('tr-TR')}` },
            ]) +
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
