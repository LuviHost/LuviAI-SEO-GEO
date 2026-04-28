import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { PrismaService } from '../prisma/prisma.service.js';

export type EmailTemplate =
  | 'welcome_day0'
  | 'welcome_day1'
  | 'welcome_day3'
  | 'welcome_day7'
  | 'trial_expiry_d11'
  | 'trial_expiry_d13'
  | 'trial_expired'
  | 'weekly_report'
  | 'monthly_report'
  | 'first_article_published'
  | 'article_ready'
  | 'plan_upgraded'
  | 'plan_canceled'
  | 'payment_failed';

@Injectable()
export class EmailService {
  private readonly log = new Logger(EmailService.name);
  private readonly client: Resend | null;
  private readonly from: string;

  constructor(private readonly prisma: PrismaService) {
    const key = process.env.RESEND_API_KEY;
    this.client = key ? new Resend(key) : null;
    this.from = process.env.EMAIL_FROM ?? 'LuviAI <noreply@ai.luvihost.com>';

    if (!this.client) {
      this.log.warn('RESEND_API_KEY yok — email gönderimi devre dışı');
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
  private renderTemplate(template: EmailTemplate, data: Record<string, any>): { subject: string; html: string } {
    const name = data.name ?? 'kullanıcı';
    const baseUrl = process.env.WEB_BASE_URL ?? 'https://ai.luvihost.com';

    const wrapper = (subject: string, body: string) => ({
      subject,
      html: `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,system-ui,sans-serif;background:#f4f1ff;padding:32px 16px;color:#1a1a2e;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
    <div style="font-size:24px;font-weight:700;color:#6c5ce7;margin-bottom:24px;">LuviAI</div>
    ${body}
    <hr style="border:0;border-top:1px solid #eee;margin:32px 0">
    <div style="font-size:12px;color:#888;">
      © 2026 LuviHost · <a href="${baseUrl}" style="color:#6c5ce7;">ai.luvihost.com</a><br>
      <a href="${baseUrl}/billing" style="color:#888;">Abonelik yönet</a> ·
      <a href="${baseUrl}/help" style="color:#888;">Yardım</a>
    </div>
  </div>
</body></html>`,
    });

    switch (template) {
      case 'welcome_day0':
        return wrapper(
          '🎉 LuviAI\'ye hoş geldiniz, ' + name,
          `<h2>Merhaba ${name},</h2>
          <p>LuviAI hesabın oluşturuldu! Kaydolan herkes 1 makaleyi ücretsiz üretebilir (süre sınırı yok). Hesabında:</p>
          <ul>
            <li>1 ücretsiz makale otomatik üretilir</li>
            <li>Sitenin SEO sağlık taraması yapılır</li>
            <li>AI search (GEO) optimizasyonu çalışır</li>
          </ul>
          <p><a href="${baseUrl}/onboarding" style="background:#6c5ce7;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">İlk siteni bağla →</a></p>`,
        );

      case 'welcome_day1':
        return wrapper(
          'LuviAI\'de ilk makaleniz hazır mı?',
          `<h2>Selam ${name}!</h2>
          <p>Onboarding sonrası AI ilk makalenizi üretti. Henüz görmediyseniz:</p>
          <p><a href="${baseUrl}/dashboard" style="color:#6c5ce7;">Dashboard'a git →</a></p>
          <p><strong>Yardımcı kaynaklar:</strong></p>
          <ul>
            <li><a href="${baseUrl}/help/onboarding">Onboarding rehberi</a></li>
            <li><a href="${baseUrl}/help/publish-targets">Publish hedefi nasıl bağlanır</a></li>
          </ul>`,
        );

      case 'welcome_day3':
        return wrapper(
          'GSC bağlantısı yaptınız mı?',
          `<h2>${name}, GSC'yi bağladınız mı?</h2>
          <p>Google Search Console'u bağlamak ${data.gscBenefit ?? 'AI sıralayıcının veri-temelli konu önermesini'} sağlar.</p>
          <p><a href="${baseUrl}/dashboard" style="color:#6c5ce7;">Şimdi bağla →</a></p>`,
        );

      case 'welcome_day7':
        return wrapper(
          'İlk hafta nasıldı? Geri bildiriminiz değerli',
          `<h2>${name}, 7. gün!</h2>
          <p>Şu ana kadar ${data.articleCount ?? 'birkaç'} makale ürettiniz. Plan'a geçmeden önce sorunuz var mı?</p>
          <p>Yanıt verin, e-posta sıkıntınızı çözelim.</p>`,
        );

      case 'trial_expiry_d11':
        return wrapper(
          '⏰ Trial süreniz 3 gün sonra dolar',
          `<h2>${name}, plana geçme zamanı</h2>
          <p>14 günlük ücretsiz denemenizden 11 gün geçti. Plan seçmezseniz hesap pasifleşir.</p>
          <p><a href="${baseUrl}/pricing" style="background:#6c5ce7;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">Plan seç →</a></p>`,
        );

      case 'trial_expiry_d13':
        return wrapper(
          '🚨 Trial yarın dolar — son şans',
          `<h2>${name}, son 24 saat</h2>
          <p>Yarın hesabınız pasifleşecek. Verileriniz 30 gün saklanır.</p>
          <p><a href="${baseUrl}/pricing" style="background:#6c5ce7;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">Aboneliği aktive et →</a></p>`,
        );

      case 'first_article_published':
        return wrapper(
          '🎊 İlk makaleniz hazır!',
          `<h2>Tebrikler ${name}!</h2>
          <p>İlk makaleniz <strong>${data.title}</strong> editörden geçti ve yayına hazır.</p>
          <p><a href="${data.publicUrl}" style="background:#6c5ce7;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">Makaleyi Aç →</a></p>
          <p style="margin-top:24px;">Detaylar:</p>
          <ul>
            <li>${data.wordCount ?? '?'} kelime</li>
            <li>${data.faqs ?? 0} FAQ + Article schema</li>
            <li>Editör skoru: ${data.editorScore ?? '?'}/60</li>
          </ul>
          <p style="font-size:13px;color:#666;margin-top:24px;">İndirebilirsin (Markdown / HTML) veya bir yayın hedefine gönderebilirsin (WordPress, FTP vb.)</p>`,
        );

      case 'article_ready':
        return wrapper(
          `✓ Yeni makale hazır: ${data.title}`,
          `<h2>${name}, yeni makale yayına hazır</h2>
          <p><strong>${data.title}</strong> editörden geçti.</p>
          <p><a href="${data.publicUrl}" style="background:#6c5ce7;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;display:inline-block;">Makaleyi Aç →</a></p>
          <p style="font-size:13px;color:#666;margin-top:16px;">
            ${data.wordCount ?? '?'} kelime · ${data.faqs ?? 0} FAQ · Editör ${data.editorScore ?? '?'}/60
            ${typeof data.articlesPublished === 'number' ? ` · Bu sitede ${data.articlesPublished}. makale` : ''}
          </p>`,
        );

      case 'weekly_report':
        return wrapper(
          `📊 Haftalık rapor: ${data.totalClicks ?? 0} click, ${data.totalImpressions ?? 0} gösterim`,
          `<h2>Bu hafta LuviAI ile</h2>
          <ul>
            <li>${data.articlesPublished ?? 0} makale yayınlandı</li>
            <li>${data.totalClicks ?? 0} tıklama</li>
            <li>${data.totalImpressions ?? 0} gösterim</li>
            <li>Ortalama sıralama: ${data.avgPosition ?? '-'}</li>
          </ul>
          ${data.topArticle ? `<p><strong>En iyi performans:</strong> ${data.topArticle.title} — ${data.topArticle.clicks} click</p>` : ''}
          <p><a href="${baseUrl}/dashboard" style="color:#6c5ce7;">Dashboard'a git →</a></p>`,
        );

      case 'plan_upgraded':
        return wrapper(
          '✅ Plan yükseltildi: ' + (data.planName ?? '?'),
          `<h2>Hoş geldiniz ${data.planName}!</h2>
          <p>Aboneliğiniz aktif. Aylık kotanız: <strong>${data.articleQuota ?? 0} makale, ${data.siteQuota ?? 0} site</strong>.</p>
          <p><a href="${baseUrl}/dashboard" style="color:#6c5ce7;">Dashboard'a git →</a></p>`,
        );

      case 'payment_failed':
        return wrapper(
          '💳 Ödeme başarısız',
          `<h2>${name}, ödemenizi alamadık</h2>
          <p>Kart bilgilerinizi kontrol edip tekrar deneyebilir veya başka bir kart kullanabilirsiniz.</p>
          <p><a href="${baseUrl}/billing" style="background:#6c5ce7;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;">Tekrar dene →</a></p>`,
        );

      default:
        return wrapper(
          'LuviAI bildirimi',
          `<p>${name}, sizinle paylaşacağımız bir güncelleme var.</p>`,
        );
    }
  }
}
