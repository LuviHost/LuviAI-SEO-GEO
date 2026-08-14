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
  | 'grandfathering_expiring'   // 2026-05 Premium Pricing — 30 gün uyari
  | 'grandfathering_expired';   // 2026-05 Premium Pricing — yeni fiyata gectigi gun

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
  }): Promise<{ ok: boolean; resendId?: string }> {
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
      } catch {}
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
        return yap(
          `RanksUp'a hoş geldin, ${name}`,
          'Hesabın hazır — ilk siteni bağlayınca tarama ve ilk makale otomatik başlar.',
          h(`Hoş geldin, ${name}`) +
            p('Hesabın oluşturuldu. İlk siteni bağladığın anda üç şey kendiliğinden çalışmaya başlar:') +
            liste([
              '<strong>SEO sağlık taraması</strong> — 14 kontrol, sayfa sayfa',
              '<strong>GEO ölçümü</strong> — ChatGPT, Claude, Gemini ve Perplexity seni kaynak gösteriyor mu',
              '<strong>İlk makalen</strong> — ücretsiz, süre sınırı yok',
            ]) +
            dugme('İlk siteni bağla', `${baseUrl}/onboarding`),
        );

      case 'welcome_day1':
        return yap(
          'İlk makalen hazır mı?',
          'Onboarding sonrası ilk makalen üretildi. Henüz görmediysen panelde bekliyor.',
          h(`Selam ${name}`) +
            p('Onboarding sonrası ilk makalen üretildi. Henüz bakmadıysan panelde seni bekliyor.') +
            dugme('Panele git', `${baseUrl}/dashboard`) +
            p('Takıldığın yer olursa: ' + baglanti('Onboarding rehberi', `${baseUrl}/help/onboarding`) + ' · ' +
              baglanti('Yayın hedefi bağlama', `${baseUrl}/help/publish-targets`)),
        );

      case 'welcome_day3':
        return yap(
          'Search Console bağlantısını yaptın mı?',
          'GSC bağlanınca konu önerileri tahminle değil, gerçek arama verisiyle üretilir.',
          h(`${name}, Search Console bağlı değil`) +
            p(`Google Search Console'u bağladığında ${kacisla(String(data.gscBenefit ?? 'konu önerileri tahminle değil, sitenin gerçek arama verisiyle üretilir'))}.`) +
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
            p(`Şu ana kadar ${kacisla(String(data.articleCount ?? 'birkaç'))} makale üretildi.`) +
            p('Takıldığın, beklediğin gibi çalışmayan bir şey varsa <strong>bu maili yanıtlaman yeterli</strong> — doğrudan bize ulaşır.') +
            dugme('Panele git', `${baseUrl}/dashboard`),
        );

      case 'trial_expiry_d11':
        return yap(
          'Deneme sürene 3 gün kaldı',
          'Plan seçilmezse hesap pasifleşir; verilerin 30 gün saklanır.',
          h(`${name}, deneme sürene 3 gün kaldı`) +
            p('14 günlük ücretsiz denemenin 11 günü doldu. Plan seçilmezse hesap pasifleşir — verilerin silinmez, 30 gün saklanır.') +
            dugme('Planları gör', `${baseUrl}/pricing`),
        );

      case 'trial_expiry_d13':
        return yap(
          'Deneme süren yarın doluyor',
          'Son 24 saat. Verilerin 30 gün saklanır, istediğinde kaldığın yerden devam edersin.',
          h(`${name}, son 24 saat`) +
            p('Yarın hesabın pasifleşecek. Ürettiğin içerikler ve ölçümler <strong>30 gün saklanır</strong>; plan seçtiğinde kaldığın yerden devam edersin.') +
            dugme('Aboneliği başlat', `${baseUrl}/pricing`),
        );

      case 'trial_expired':
        return yap(
          'Deneme süren doldu',
          'Verilerin 30 gün saklanıyor — plan seçtiğinde kaldığın yerden devam edersin.',
          h(`${name}, deneme süren doldu`) +
            p('Hesabın pasife alındı. Ürettiğin içerikler ve ölçüm geçmişin <strong>30 gün</strong> saklanıyor.') +
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
              { etiket: 'Editör skoru', deger: data.editorScore != null ? `${data.editorScore}/60` : null },
            ]) +
            dugme('Makaleyi aç ve incele', String(data.publicUrl ?? `${baseUrl}/dashboard`)) +
            p('<span style="font-size:13px;">Markdown veya HTML olarak indirebilir, ya da WordPress/FTP gibi bir yayın hedefine gönderebilirsin.</span>'),
        );

      case 'article_ready':
        return yap(
          `Makalen hazır: ${kacisla(String(data.title ?? ''))}`,
          'Editörden geçti, onayını bekliyor.',
          etiket('Onay bekliyor') +
            h(kacisla(String(data.title ?? 'Makalen hazır'))) +
            p('Editörden geçti ve onayını bekliyor. <strong>Henüz yayında değil</strong> — inceleyip yayına alman gerekiyor.') +
            olcuSatiri([
              { etiket: 'Kelime', deger: sayi(data.wordCount) },
              { etiket: 'FAQ', deger: sayi(data.faqs ?? 0) },
              { etiket: 'Editör', deger: data.editorScore != null ? `${data.editorScore}/60` : null },
              ...(typeof data.articlesPublished === 'number'
                ? [{ etiket: 'Bu sitede', deger: `${data.articlesPublished}.` as string | number | null, alt: 'makale' }]
                : []),
            ]) +
            dugme('Makaleyi incele', String(data.publicUrl ?? `${baseUrl}/dashboard`)),
        );

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
          'Mevcut dönem sonuna kadar erişimin devam ediyor.',
          h(`${name}, aboneliğin iptal edildi`) +
            p(`${data.planName ? `<strong>${kacisla(String(data.planName))}</strong> planın iptal edildi. ` : ''}Mevcut dönem sonuna kadar erişimin devam eder.`) +
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
              { etiket: 'Yeni', deger: `₺${(data.newPriceTry ?? 0).toLocaleString('tr-TR')}`, alt: 'aylık' },
            ]) +
            p('Bu dönemde eklenen ve planına dahil olan özellikler:') +
            liste([
              'Daha yüksek aylık makale kotası',
              'AI Video Studio',
              'Takılan sayfa kurtarma + AI görünürlük takibi',
              'ASO, Apple Search Ads ve App Store Connect entegrasyonu',
            ]) +
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
              { etiket: 'Yeni aylık', deger: `₺${(data.newPriceTry ?? 0).toLocaleString('tr-TR')}` },
            ]) +
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
