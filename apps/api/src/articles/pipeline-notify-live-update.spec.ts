import { describe, it, expect, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { PipelineService } from './pipeline.service.js';
import { EmailService } from '../email/email.service.js';

/**
 * K5 — yayindaki yazinin yeniden yazimi icin "onay bekliyor" e-postasi
 * "Henüz yayında değil" DEMEZ.
 *
 * NEDEN VAR: yari otomatik icerik pivotu (PASS) ve kapali dongu "guncelle"
 * yayindaki yazinin yeni halini onaya birakir; notifyArticleReady her
 * durumda article_ready sablonunu "Henüz yayında değil — inceleyip yayına
 * alman gerekiyor" metniyle gonderiyordu. Yazi zaten yayinda; musteri onay
 * vermezse eski hali yayinda kalir — e-posta bunu soylemeli.
 */

vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

function kur(article: Record<string, unknown>, earlierArticles = 3) {
  const prisma = {
    site: { findUnique: vi.fn(async () => ({ id: 's1', user: { id: 'u1', email: 'sahip@ornek.com', name: 'Ayşe' } })) },
    article: {
      findUnique: vi.fn(async () => ({ id: 'a1', title: 'Kira Artış Oranı', wordCount: 900, frontmatter: {}, editorScore: 80, ...article })),
      count: vi.fn(async () => earlierArticles),
    },
  };
  const email = { send: vi.fn<(o: { template: string; data: Record<string, unknown> }) => Promise<{ ok: boolean }>>(async () => ({ ok: true })) };
  const svc = new PipelineService(prisma as any, {} as any, email as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  return { svc, email };
}

/** Gercek sablon: e-postanin gorunur metni */
const svcEmail = new EmailService({ emailLog: { create: async () => {} } } as never);
const goruntu = (data: Record<string, unknown>) => {
  const { subject, html } = (svcEmail as any).renderTemplate('article_ready', data) as { subject: string; html: string };
  return { subject, metin: html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ') };
};

describe('notifyArticleReady — canli kopyasi olan yazinin guncellemesi', () => {
  it('canli kopya varsa article_ready liveUpdate ile gider; e-posta "eski hali yayında kalır" der', async () => {
    const { svc, email } = kur({ status: 'READY_TO_PUBLISH', publishedAt: new Date('2026-05-01T10:00:00Z'), publishedTo: [{ targetId: 't-wp', ok: true, externalUrl: 'https://ornek.com/kira/' }] });
    await svc.notifyArticleReady('s1', 'a1');
    const gonderilen = email.send.mock.calls[0][0];
    expect(gonderilen.template).toBe('article_ready');
    expect(gonderilen.data.liveUpdate).toBe(true);

    const e = goruntu(gonderilen.data);
    expect(e.metin).toContain('Yayındaki yazının güncellenmiş hali onayını bekliyor; onaylayana kadar eski hali yayında kalır.');
    expect(e.metin).not.toContain('Henüz yayında değil');
    // Yeni makale degil: "Bu sitede 4. makale" yazilmaz
    expect(e.metin).not.toContain('Bu sitede');
    expect(e.subject).toBe('Güncelleme onayını bekliyor: Kira Artış Oranı');
  });

  it('canli kopyasi olmayan yazi (hic yayinlanmamis ya da kopyasi cop kutusunda) "Henüz yayında değil" ile gider', async () => {
    for (const article of [
      { publishedTo: [] },
      { publishedAt: new Date('2026-05-01T10:00:00Z'), publishedTo: [{ targetId: 't-wp', ok: true, trashedAt: '2026-10-10T10:00:00.000Z' }] },
      { publishedTo: [{ targetId: 't-wp', ok: false, error: 'yazilamadi' }] },
    ]) {
      const { svc, email } = kur(article);
      await svc.notifyArticleReady('s1', 'a1');
      const gonderilen = email.send.mock.calls[0][0];
      expect(gonderilen.template).toBe('article_ready');
      expect(gonderilen.data).not.toHaveProperty('liveUpdate');
      const e = goruntu(gonderilen.data);
      expect(e.metin).toContain('Henüz yayında değil — inceleyip yayına alman gerekiyor.');
      expect(e.metin).toContain('Bu sitede');
      expect(e.subject).toBe('Makalen hazır: Kira Artış Oranı');
    }
  });
});
