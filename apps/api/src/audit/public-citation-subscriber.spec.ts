import { describe, it, expect, vi } from 'vitest';
import { BadRequestException, HttpException } from '@nestjs/common';
import { PublicCitationService } from './public-citation.service.js';
import { PublicCitationSubscriberService, normalizeSubscriberEmail } from './public-citation-subscriber.service.js';
import { SUBSCRIBE_EMAIL_LIMIT_MESSAGE } from './public-subscribe-limits.js';

/**
 * Abone retest e-postasi ve abonelik baslatma.
 *
 * Retest:
 *  - Retest abonelik tabaninin (abonelik anina en yakin anonim kayit) soru
 *    listesini, markasini ve nisini AYNEN yeniden sorar; yalniz o tabanla
 *    kiyaslar. Eskiden her retest soru setini bastan uretiyor ve alan adinin
 *    baska bir kaydiyla kiyasliyordu.
 *  - Ayni soru seti + ayni kademe + ayni yontem: fark (artis/dusus) yazilir.
 *  - Soru seti farkli / taban yok / ortak yanit orani dusuk: "karsilastirma
 *    yapilamadi" notu; yontem surumu farkli: yontem notu. Ikisinde de fark yok.
 *  - Sayi birimi cevap (saglayici x soru): "N motor" ve "/ 7" yazilmaz.
 *  - Abone formundan gelen marka HTML olarak e-postaya gecmez.
 *
 * Abonelik: marka/nis istemciden degil kontrol kaydindan; e-posta bicimi;
 * adres basina 24 saatlik onay e-postasi siniri; yeniden abonelik dongusu.
 *
 * Vitest dekorator metadata'si uretmedigi icin servisler elle kurulur; gercek
 * PublicCitationService (findRetestBaseline/compareWithBaseline) kullanilir,
 * yalniz check() (ag + LLM) sahtelenir.
 */

const GUN = 24 * 60 * 60 * 1000;
const SORULAR = [
  'En güvenilir ilan siteleri hangileri?',
  'Kiralık daire ararken hangi platform kullanılır?',
  'Satılık konut için hangi siteyi önerirsin?',
];
const KILITLI = 'Ev alırken nelere dikkat etmeli?';
const SAGLAYICILAR = ['openai', 'anthropic', 'gemini', 'perplexity', 'xai', 'deepseek'];

/**
 * Kayitli sonuc JSON'u — 3 olculen soru x 6 saglayici = 18 hucre (satir
 * sirasiyla). Ilk `anilan` hucrede marka anildi; `hatali` hucreleri HATA.
 */
function sonuc(anilan: number, o: { matchVersion?: number; tier?: 'anon' | 'member'; sorular?: string[]; hatali?: number[] } = {}) {
  const sorular = o.sorular ?? SORULAR;
  let i = 0;
  return {
    ...(o.matchVersion === undefined ? {} : { matchVersion: o.matchVersion }),
    domain: 'emlak.com',
    brand: 'Emlak',
    access: { tier: o.tier ?? 'anon', unlockedQueries: sorular.length, totalQueries: sorular.length + 1, lockedQueries: 1 },
    queries: [
      ...sorular.map((query) => ({
        query,
        locked: false,
        brandInQuery: false,
        providers: SAGLAYICILAR.map((provider) => {
          const idx = i++;
          if (o.hatali?.includes(idx)) {
            return { provider, label: provider, measured: false, cited: false, brandMentioned: false, excerpt: 'HATA: rate_limited' };
          }
          const ok = idx < anilan;
          return { provider, label: provider, measured: true, cited: false, brandMentioned: ok, excerpt: ok ? 'Emlak öne çıkıyor.' : 'Başka siteler öne çıkıyor.' };
        }),
      })),
      { query: KILITLI, locked: true, providers: [], citedCount: 0, totalProviders: 6, brandInQuery: false },
    ],
  };
}

/** measured alani olmayan eski (v3) kayit: ayrica anahtarsiz Meta satiri tasir. */
function eskiSonuc(anilan: number) {
  const r = sonuc(anilan);
  delete (r as any).matchVersion;
  for (const q of r.queries) {
    if (q.locked) continue;
    q.providers = [
      ...q.providers.map((p) => {
        const eskiSatir: Record<string, unknown> = { ...p };
        delete eskiSatir.measured;
        return eskiSatir as any;
      }),
      { provider: 'meta', label: 'Meta AI (Llama)', cited: false, brandMentioned: false },
    ];
  }
  return r;
}

function kur(o: { taban?: unknown | null; taze: unknown; sub?: Record<string, unknown>; tabanKademe?: 'anon' | 'member' }) {
  const abone = {
    id: 'abone-1', email: 'ziyaretci@ornek.com', domain: 'emlak.com', brand: 'Emlak',
    unsubscribeToken: 'cikis-token', locale: 'tr', retestsSent: 0, status: 'ACTIVE',
    createdAt: new Date(Date.now() - 15 * GUN), consentAt: new Date(Date.now() - 15 * GUN), ...o.sub,
  };
  const tabanSatiri = o.taban === null || o.taban === undefined
    ? null
    : { id: 'taban-1', createdAt: new Date(Date.now() - 15 * GUN - 60_000), brand: 'Emlak', niche: 'gayrimenkul', customNiche: null, result: o.taban };
  const prisma = {
    publicCitationCheck: {
      // findRetestBaseline: once abonelik anindan oncekiler (desc), sonra sonrakiler (asc)
      findMany: vi.fn(async (args: any) => (args?.where?.createdAt?.lte && tabanSatiri ? [tabanSatiri] : [])),
      create: vi.fn(async () => ({ id: 'kontrol-1' })),
    },
    publicCitationSubscriber: {
      findMany: vi.fn(async () => [abone]),
      update: vi.fn(async () => ({})),
    },
    publicCitationEmailLog: { create: vi.fn(async () => ({})) },
  };
  const email = { sendRaw: vi.fn(async () => ({ ok: true })) };
  const citation = new PublicCitationService(prisma as never, {} as never, {} as never);
  const check = vi.spyOn(citation, 'check').mockResolvedValue({ ...(o.taze as object), checkId: 'kontrol-yeni' } as never);
  const svc = new PublicCitationSubscriberService(prisma as never, email as never, citation);
  return { svc, prisma, email, check };
}

const gonderilen = (email: { sendRaw: ReturnType<typeof vi.fn> }) => (email.sendRaw.mock.calls[0] as any[])[0] as { to: string; subject: string; html: string };
const kayit = (prisma: any) => (prisma.publicCitationEmailLog.create.mock.calls[0] as any[])[0].data;

describe('retest — tabanin soru seti aynen yeniden sorulur', () => {
  it('check() tabanin olculen + kilitli sorulari, markasi ve nisiyle cagrilir (soru uretimi yok)', async () => {
    const t = kur({ taban: sonuc(5, { matchVersion: 4 }), taze: sonuc(5, { matchVersion: 4 }) });
    await t.svc.runScheduledRetests();
    expect(t.check).toHaveBeenCalledWith('emlak.com', '', 'retest_cron', {
      fixed: {
        brand: 'Emlak',
        niche: 'gayrimenkul',
        customNiche: undefined,
        measured: SORULAR.map((query) => ({ query, category: undefined })),
        locked: [{ query: KILITLI, category: undefined }],
      },
    });
    // Taban abonelik anindan ONCEKI kayitlarda aranir
    expect(t.prisma.publicCitationCheck.findMany.mock.calls[0][0]).toMatchObject({
      where: { domain: 'emlak.com', createdAt: { lte: expect.any(Date) } },
      orderBy: { createdAt: 'desc' },
    });
    // Raporun dayandigi olcum kaydi e-posta kaydina yazilir
    expect(kayit(t.prisma).citationCheckId).toBe('kontrol-yeni');
  });

  it('taban yoksa: taze olcum (sabit set yok), kiyas yapilmaz — notr not', async () => {
    const t = kur({ taban: null, taze: sonuc(4, { matchVersion: 4 }) });
    const r = await t.svc.runScheduledRetests();
    expect(r).toEqual({ processed: 1, sent: 1, failed: 0 });
    expect(t.check).toHaveBeenCalledWith('emlak.com', '', 'retest_cron', {});
    const m = gonderilen(t.email);
    expect(m.subject).toBe('Emlak 15d AI Visibility raporu');
    expect(m.html).toContain('Bu dönem karşılaştırma yapılamadı');
    expect(m.html).toContain('aynı koşullarda (aynı sorular, aynı AI asistanlarının yanıtları) karşılaştıramadık');
    expect(m.html).not.toContain('Önceki</div>');
    expect(kayit(t.prisma).delta).toMatchObject({ methodChanged: true, methodChangeReason: 'no_baseline', delta: 0 });
  });
});

describe('retest — ayni soru seti, ayni yontem: fark yazilir', () => {
  it('dusus: konu satiri 📉, fark ve iki sayi yan yana', async () => {
    const t = kur({ taban: sonuc(5, { matchVersion: 4 }), taze: sonuc(1, { matchVersion: 4 }) });
    await t.svc.runScheduledRetests();
    const m = gonderilen(t.email);
    expect(m.subject).toBe('📉 Emlak 15d AI Visibility raporu');
    expect(m.html).toContain('-4 cevap');
    expect(m.html).toContain('Bu dönemde markanız 4 cevapta daha az anıldı veya kaynak gösterildi.');
    expect(m.html).toContain('Önceki</div>');
    expect(m.html).not.toContain('Ölçüm yöntemi güncellendi');
    expect(m.html).not.toContain('karşılaştırma yapılamadı');
    expect(kayit(t.prisma).delta).toMatchObject({ methodChanged: false, delta: -4, deltaPct: -80, comparedAnswers: 18, partialCoverage: false });
    expect(t.prisma.publicCitationSubscriber.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'abone-1' },
      data: expect.objectContaining({ retestsSent: 1, status: 'ACTIVE' }),
    }));
  });

  it('artis: konu satiri 📈, yuzdeli fark', async () => {
    const t = kur({ taban: sonuc(3, { matchVersion: 4 }), taze: sonuc(6, { matchVersion: 4 }) });
    await t.svc.runScheduledRetests();
    const m = gonderilen(t.email);
    expect(m.subject).toBe('📈 Emlak 15d AI Visibility raporu');
    expect(m.html).toContain('+3 cevap (+100%)');
  });

  it('degisim yok: konu satiri ⏸️', async () => {
    const t = kur({ taban: sonuc(2, { matchVersion: 4 }), taze: sonuc(2, { matchVersion: 4 }) });
    await t.svc.runScheduledRetests();
    expect(gonderilen(t.email).subject).toBe('⏸️ Emlak 15d AI Visibility raporu');
    expect(gonderilen(t.email).html).toContain('Değişim yok');
  });

  it('bir hucre retest te HATA: sayilar iki olcumde de yanit alinan cevaplardan, not yazilir', async () => {
    // Taban: ilk 5 hucrede anildi. Retest: ayni 5 hucre ama 0. hucre HATA (rate limit).
    // Ham toplamla 5 → 4 "1 cevap dustu" derdi; ortak 17 hucrede ikisi de 4.
    const t = kur({ taban: sonuc(5, { matchVersion: 4 }), taze: sonuc(5, { matchVersion: 4, hatali: [0] }) });
    await t.svc.runScheduledRetests();
    const m = gonderilen(t.email);
    expect(m.subject).toBe('⏸️ Emlak 15d AI Visibility raporu');
    expect(m.html).toContain('Değişim yok');
    expect(m.html).toContain('Karşılaştırma, iki ölçümde de yanıt alınan 17 cevap üzerinden yapıldı');
    expect(kayit(t.prisma).delta).toMatchObject({
      methodChanged: false, delta: 0, comparedAnswers: 17, partialCoverage: true,
      current: { totalCited: 4, total: 17 }, past: { totalCited: 4, total: 17 },
    });
  });
});

describe('retest — ayni kosul degilse fark yazilmaz', () => {
  it('farkli soru seti: notr not, iki sayi yan yana konmaz', async () => {
    const baska = ['Hangi emlak sitesi daha çok ilan sunuyor?', ...SORULAR.slice(1)];
    const t = kur({ taban: sonuc(5, { matchVersion: 4 }), taze: sonuc(1, { matchVersion: 4, sorular: baska }) });
    await t.svc.runScheduledRetests();
    const m = gonderilen(t.email);
    expect(m.subject).toBe('Emlak 15d AI Visibility raporu');
    for (const yon of ['📈', '📉', '⏸️']) expect(m.html).not.toContain(yon);
    expect(m.html).toContain('Bu dönem karşılaştırma yapılamadı');
    expect(m.html).not.toContain('Önceki</div>');
    expect(m.html).not.toContain('-4 cevap');
    expect(m.html).not.toContain('Ölçüm yöntemi güncellendi');
    expect(kayit(t.prisma).delta).toMatchObject({ methodChanged: true, methodChangeReason: 'question_set', delta: 0, deltaPct: 0 });
  });

  it('bir saglayici retest te tamamen yanit vermedi (ortak oran < %90): kiyas yok', async () => {
    // openai'nin 3 hucresi (0, 6, 12) HATA → 15/18 ortak hucre
    const t = kur({ taban: sonuc(5, { matchVersion: 4 }), taze: sonuc(5, { matchVersion: 4, hatali: [0, 6, 12] }) });
    await t.svc.runScheduledRetests();
    expect(gonderilen(t.email).html).toContain('Bu dönem karşılaştırma yapılamadı');
    expect(kayit(t.prisma).delta).toMatchObject({ methodChanged: true, methodChangeReason: 'providers', delta: 0 });
  });

  it('v3 (alansiz, eski bicim) taban → v4 retest: yontem notu, abonelik ilerler', async () => {
    const t = kur({ taban: eskiSonuc(5), taze: sonuc(1, { matchVersion: 4 }) });
    const r = await t.svc.runScheduledRetests();
    expect(r).toEqual({ processed: 1, sent: 1, failed: 0 });
    const m = gonderilen(t.email);
    expect(m.subject).toBe('Emlak 15d AI Visibility raporu');
    for (const yon of ['📈', '📉', '⏸️']) {
      expect(m.subject).not.toContain(yon);
      expect(m.html).not.toContain(yon);
    }
    expect(m.html).toContain('Ölçüm yöntemi güncellendi');
    expect(m.html).toContain('Önceki ölçüm eski yöntemle yapıldığı için bugünkü sonucu onunla karşılaştırmıyoruz');
    expect(m.html).not.toContain('Önceki</div>');
    expect(m.html).not.toContain('daha az anıldı');
    expect(m.html).toContain('Bugün</div>');
    expect(kayit(t.prisma).delta).toMatchObject({ methodChanged: true, methodChangeReason: 'match_version', delta: 0 });
    expect(t.prisma.publicCitationSubscriber.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ retestsSent: 1, status: 'ACTIVE' }),
    }));
  });

  it('ingilizce abone: ayni kural, EN not', async () => {
    const t = kur({ taban: eskiSonuc(5), taze: sonuc(1, { matchVersion: 4 }), sub: { locale: 'en' } });
    await t.svc.runScheduledRetests();
    const m = gonderilen(t.email);
    expect(m.subject).toBe('Emlak 15d AI Visibility report');
    expect(m.html).toContain('Measurement method updated');
    expect(m.html).not.toContain('fewer');

    const t2 = kur({ taban: null, taze: sonuc(1, { matchVersion: 4 }), sub: { locale: 'en' } });
    await t2.svc.runScheduledRetests();
    expect(gonderilen(t2.email).html).toContain('No comparison this period');
  });
});

describe('retest e-postasi — sayi birimi ve icerik dogrulugu', () => {
  it('"motor" ve "/ 7" yazilmaz; kanitsiz "+4 motor" vaadi yok', async () => {
    // 3 soruda 6 saglayici: toplam 8 cevap — eskiden "8 / 7" ve "+3 motor" yaziyordu
    const t = kur({ taban: sonuc(5, { matchVersion: 4 }), taze: sonuc(8, { matchVersion: 4 }) });
    await t.svc.runScheduledRetests();
    const { html } = gonderilen(t.email);
    expect(html).not.toMatch(/\/ 7/);
    expect(html).not.toMatch(/motor/i);
    expect(html).not.toContain('+4');
    expect(html).toContain('markanızın anıldığı cevap');
  });

  it('onceki deger 0 iken yuzde yazilmaz ("+%0" yok)', async () => {
    const t = kur({ taban: sonuc(0, { matchVersion: 4 }), taze: sonuc(2, { matchVersion: 4 }) });
    await t.svc.runScheduledRetests();
    const { html } = gonderilen(t.email);
    expect(html).toContain('+2 cevap</h2>');
    expect(html).not.toContain('(+0%)');
  });

  it('marka HTML olarak gecmez (abone kaydindan gelir)', async () => {
    const t = kur({ taban: sonuc(2, { matchVersion: 4 }), taze: sonuc(2, { matchVersion: 4 }), sub: { brand: '<a href="https://kotu.example">Odulu al</a>' } });
    await t.svc.runScheduledRetests();
    const { html } = gonderilen(t.email);
    expect(html).not.toContain('<a href="https://kotu.example">');
    expect(html).toContain('&lt;a href=&quot;https://kotu.example&quot;&gt;');
  });
});

// ─── Abonelik baslatma ──────────────────────────────────────────────────────

function kurAbonelik(o: { kontrol?: { brand: string; niche?: string | null; customNiche?: string | null } | null; mevcut?: Record<string, unknown> | null; sonGunGonderilen?: number } = {}) {
  const kontrol = o.kontrol === undefined ? { brand: 'Ornek', niche: 'diğer', customNiche: 'kredi karşılaştırma' } : o.kontrol;
  const prisma = {
    publicCitationCheck: { findFirst: vi.fn(async () => kontrol) },
    publicCitationSubscriber: {
      findUnique: vi.fn(async () => o.mevcut ?? null),
      upsert: vi.fn(async ({ create }: any) => ({ id: 'abone-1', ...create })),
    },
    publicCitationEmailLog: {
      create: vi.fn(async () => ({})),
      count: vi.fn(async () => o.sonGunGonderilen ?? 0),
    },
  };
  const email = { sendRaw: vi.fn(async () => ({ ok: true })) };
  const svc = new PublicCitationSubscriberService(prisma as never, email as never, {} as never);
  return { svc, email, prisma };
}

describe('abonelik — hos geldin e-postasi', () => {
  it('olculen 6 asistani yazar (Llama kosulsuz vaat edilmez), marka kacislanir', async () => {
    const t = kurAbonelik({ kontrol: { brand: 'Ornek <b>X</b>' } });
    await t.svc.subscribe({ email: 'Kisi@Ornek.com', domain: 'https://www.ornek.com/x', locale: 'tr' });
    const m = gonderilen(t.email);
    expect(m.to).toBe('kisi@ornek.com');
    expect(m.html).toContain('6 AI asistanındaki (ChatGPT, Claude, Gemini, Perplexity, Grok, DeepSeek)');
    expect(m.html).not.toMatch(/Meta AI|Llama|7 AI/);
    expect(m.html).not.toContain('<b>X</b>');
    expect(m.html).toContain('Ornek &lt;b&gt;X&lt;/b&gt;');
  });
});

describe('abonelik — marka ve nis istemciden degil kontrol kaydindan', () => {
  it('istemcinin gonderdigi marka/nis kayda ve e-postaya yazilmaz', async () => {
    const t = kurAbonelik();
    await t.svc.subscribe({
      email: 'kisi@ornek.com', domain: 'ornek.com', brand: 'Kazandınız! hemen tıklayın',
      niche: 'sahte', customNiche: 'sahte', locale: 'tr',
    });
    // Kayit anahtari check() ile ayni alan adi kuralindan, son 7 gunun en yeni kaydi
    expect(t.prisma.publicCitationCheck.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { domain: 'ornek.com', createdAt: { gte: expect.any(Date) } },
      orderBy: { createdAt: 'desc' },
    }));
    const yazilan = (t.prisma.publicCitationSubscriber.upsert.mock.calls[0] as any[])[0];
    expect(yazilan.create).toMatchObject({ brand: 'Ornek', niche: 'diğer', customNiche: 'kredi karşılaştırma' });
    const m = gonderilen(t.email);
    expect(m.subject).toContain('Ornek');
    expect(`${m.subject}${m.html}`).not.toContain('Kazandınız');
  });

  it('alan adi icin son 7 gunde kontrol yoksa abonelik baslamaz, e-posta gitmez', async () => {
    const t = kurAbonelik({ kontrol: null });
    const err = await t.svc.subscribe({ email: 'kisi@ornek.com', domain: 'ornek.com' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toContain('önce bu alan adı için ücretsiz testi çalıştırın');
    expect(t.prisma.publicCitationSubscriber.upsert).not.toHaveBeenCalled();
    expect(t.email.sendRaw).not.toHaveBeenCalled();
  });

  it('80 karakteri asan marka alani reddedilir', async () => {
    const t = kurAbonelik();
    await expect(t.svc.subscribe({ email: 'kisi@ornek.com', domain: 'ornek.com', brand: 'x'.repeat(81) }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(t.email.sendRaw).not.toHaveBeenCalled();
    // 80 karakter kabul
    await t.svc.subscribe({ email: 'kisi@ornek.com', domain: 'ornek.com', brand: 'x'.repeat(80) });
    expect(t.email.sendRaw).toHaveBeenCalledTimes(1);
  });

  it('IP/port/tek etiketli alan adi check() ile ayni kuralla reddedilir', async () => {
    const t = kurAbonelik();
    for (const domain of ['127.0.0.1', 'ornek.com:6379', 'localhost']) {
      await expect(t.svc.subscribe({ email: 'kisi@ornek.com', domain })).rejects.toMatchObject({ status: 400 });
    }
    expect(t.email.sendRaw).not.toHaveBeenCalled();
  });
});

describe('abonelik — e-posta bicimi', () => {
  it.each([
    ['kisi@ornek.com', 'kisi@ornek.com'],
    ['  Kisi.Soyad+takip@Alt.Ornek.com.tr ', 'kisi.soyad+takip@alt.ornek.com.tr'],
    ['kisi@ornek', null],
    ['kisi@ornek.c', null],
    ['ki si@ornek.com', null],
    ['<kisi>@ornek.com', null],
    ['kisi@ornek.com,diger@ornek.com', null],
    ['a@b@ornek.com', null],
    [`${'x'.repeat(65)}@ornek.com`, null],
    [`kisi@${'x'.repeat(250)}.com`, null],
    [42, null],
  ])('%s → %s', (girdi, beklenen) => {
    expect(normalizeSubscriberEmail(girdi)).toBe(beklenen);
  });

  it('gecersiz e-posta 400, DB sorgusu yapilmaz', async () => {
    const t = kurAbonelik();
    await expect(t.svc.subscribe({ email: 'kisi@ornek', domain: 'ornek.com' })).rejects.toBeInstanceOf(BadRequestException);
    expect(t.prisma.publicCitationCheck.findFirst).not.toHaveBeenCalled();
  });
});

describe('abonelik — adres basina onay e-postasi siniri', () => {
  it('24 saatte 3 onay e-postasi gonderilmis adrese yenisi gitmez (429), kayit degismez', async () => {
    const t = kurAbonelik({ sonGunGonderilen: 3 });
    const err = await t.svc.subscribe({ email: 'kurban@ornek.com', domain: 'ornek.com' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getStatus()).toBe(429);
    expect((err as HttpException).message).toBe(SUBSCRIBE_EMAIL_LIMIT_MESSAGE);
    // Sayim adres uzerinden, tum alan adlari toplami, son 24 saat
    expect(t.prisma.publicCitationEmailLog.count).toHaveBeenCalledWith({
      where: { type: 'welcome', sentAt: { gte: expect.any(Date) }, subscriber: { is: { email: 'kurban@ornek.com' } } },
    });
    expect(t.prisma.publicCitationSubscriber.upsert).not.toHaveBeenCalled();
    expect(t.email.sendRaw).not.toHaveBeenCalled();
  });

  it('siki kademe (token siz mobil): 24 saatte 1 onay e-postasi', async () => {
    const t = kurAbonelik({ sonGunGonderilen: 1 });
    await expect(t.svc.subscribe({ email: 'kisi@ornek.com', domain: 'ornek.com' }, { welcomePerEmail: 1 }))
      .rejects.toMatchObject({ status: 429 });
    const t2 = kurAbonelik({ sonGunGonderilen: 0 });
    await t2.svc.subscribe({ email: 'kisi@ornek.com', domain: 'ornek.com' }, { welcomePerEmail: 1 });
    expect(t2.email.sendRaw).toHaveBeenCalledTimes(1);
  });

  it('zaten aktif abonelik: e-posta yok, sayac sorgulanmaz', async () => {
    const t = kurAbonelik({ mevcut: { status: 'ACTIVE', unsubscribeToken: 'u' }, sonGunGonderilen: 99 });
    await expect(t.svc.subscribe({ email: 'kisi@ornek.com', domain: 'ornek.com' }))
      .resolves.toEqual({ ok: true, status: 'ACTIVE', alreadyActive: true });
    expect(t.prisma.publicCitationEmailLog.count).not.toHaveBeenCalled();
    expect(t.email.sendRaw).not.toHaveBeenCalled();
  });

  it('yeniden abonelik yeni 15/30/60/90 dongusu baslatir (sayac sifirlanir)', async () => {
    const t = kurAbonelik({ mevcut: { status: 'COMPLETED', unsubscribeToken: 'eski-cikis', retestsSent: 4 } });
    await t.svc.subscribe({ email: 'kisi@ornek.com', domain: 'ornek.com' });
    const yazilan = (t.prisma.publicCitationSubscriber.upsert.mock.calls[0] as any[])[0];
    expect(yazilan.update).toMatchObject({ status: 'PENDING_OPTIN', retestsSent: 0, nextRetestAt: null, brand: 'Ornek' });
    expect(yazilan.create.unsubscribeToken).toBe('eski-cikis');
  });
});

describe('getJourneyForUser — farkli yontemli ilk/son kayit kiyaslanmaz', () => {
  const eskiKayit = (id: string, gunOnce: number, citedCount: number, matchVersion?: number) => ({
    id,
    createdAt: new Date(Date.now() - gunOnce * GUN),
    source: 'manual',
    brand: 'Emlak',
    result: {
      ...(matchVersion === undefined ? {} : { matchVersion }),
      queries: [{ query: 'en guvenilir ilan siteleri', citedCount, totalProviders: 7, brandInQuery: false }],
    },
  });
  function kurYolculuk(history: any[]) {
    const prisma = {
      publicCitationCheck: { findMany: vi.fn(async () => history) },
      publicCitationSubscriber: { findMany: vi.fn(async () => [{ domain: 'emlak.com', brand: 'Emlak' }]) },
    };
    const citation = new PublicCitationService(prisma as never, {} as never, {} as never);
    return new PublicCitationSubscriberService(prisma as never, {} as never, citation);
  }

  it('v3 → v4: delta yok, methodChanged true; satirlar surumu tasir', async () => {
    const [j] = await kurYolculuk([eskiKayit('son', 0, 1, 4), eskiKayit('ilk', 30, 5)]).getJourneyForUser('u1');
    expect(j.methodChanged).toBe(true);
    expect(j.delta).toBeUndefined();
    expect(j.history.map((h) => h.matchVersion)).toEqual([3, 4]);
  });

  it('v4 → v4: delta eskisi gibi', async () => {
    const [j] = await kurYolculuk([eskiKayit('son', 0, 1, 4), eskiKayit('ilk', 30, 5, 4)]).getJourneyForUser('u1');
    expect(j.methodChanged).toBe(false);
    expect(j.delta).toEqual({ before: 5, after: 1, total: 7 });
  });
});
