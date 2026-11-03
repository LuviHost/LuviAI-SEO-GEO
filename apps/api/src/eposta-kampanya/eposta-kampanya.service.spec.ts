import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EpostaKampanyaService } from './eposta-kampanya.service.js';

/** Bellek ici sahte Prisma — yalniz servisin kullandigi cagrilar */
function sahtePrisma(hedefler: any[]) {
  const kv = new Map<string, { key: string; value: string; expiresAt: Date | null }>();
  const alan = (h: any, k: string, v: any): boolean => {
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v && !v.in.includes(h[k])) return false;
      if ('notIn' in v && v.notIn.includes(h[k])) return false;
      if ('gte' in v && !(h[k] && h[k] >= v.gte)) return false;
      if ('lt' in v && !(h[k] && h[k] < v.lt)) return false;
      if ('startsWith' in v && !(typeof h[k] === 'string' && h[k].startsWith(v.startsWith))) return false;
      if ('not' in v && (h[k] == null || h[k] === v.not)) return false;
      return true;
    }
    return v === null ? h[k] == null : h[k] === v;
  };
  const eslesir = (h: any, w: any): boolean => {
    if (!w) return true;
    for (const [k, v] of Object.entries<any>(w)) {
      if (k === 'OR') { if (!v.some((x: any) => eslesir(h, x))) return false; continue; }
      if (k === 'NOT') { if (eslesir(h, v)) return false; continue; }
      if (!alan(h, k, v)) return false;
    }
    return true;
  };
  return {
    hedefler,
    kvStore: {
      findUnique: async ({ where }: any) => kv.get(where.key) ?? null,
      create: async ({ data }: any) => { if (kv.has(data.key)) throw new Error('P2002'); kv.set(data.key, { expiresAt: null, ...data }); },
      upsert: async ({ where, create, update }: any) => { kv.set(where.key, { ...(kv.get(where.key) ?? create), ...update, key: where.key }); },
      deleteMany: async ({ where }: any) => { const r = kv.get(where.key); if (r && eslesir(r, { ...where, key: undefined })) kv.delete(where.key); },
    },
    epostaHedef: {
      count: async ({ where }: any = {}) => hedefler.filter((h) => eslesir(h, where)).length,
      findMany: async ({ where, take }: any = {}) => hedefler.filter((h) => eslesir(h, where)).slice(0, take ?? 1e9),
      findUnique: async ({ where }: any) => hedefler.find((h) => h.email === where.email) ?? null,
      findFirst: async ({ where }: any) => hedefler.find((h) => eslesir(h, where)) ?? null,
      updateMany: async ({ where, data }: any) => { const m = hedefler.filter((h) => eslesir(h, where)); m.forEach((h) => Object.assign(h, data)); return { count: m.length }; },
      update: async ({ where, data }: any) => { const h = hedefler.find((x) => x.id === where.id); Object.assign(h, data); return h; },
    },
    linkedinProspect: { findMany: async () => [] },
  };
}

const hedef = (i: number, durum = 'SIRADA') => ({
  id: `h${i}`, email: `info@firma${i}.com.tr`, firma: `Firma${i} A.Ş.`, marka: null, sektor: 'ajans', varyant: 'A',
  durum, sonOlay: null, sonOlayAt: null, gonderildiAt: null, acildiAt: null, tiklandiAt: null, iysYuklendiAt: new Date(),
});

const ENV = {
  MAILJET_API_KEY: 'k', MAILJET_SECRET: 's', MAILJET_FROM_EMAIL: 'emir@ranksup.ai', MAILJET_GONDEREN_ADRES: 'Osmangazi/Bursa',
  MAILJET_KIMLIK: 'Emirhan Burgazlı · VKN 1 · Osmangazi V.D.', NEXTAUTH_SECRET: 'test',
};
const eski: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) { eski[k] = process.env[k]; process.env[k] = v; }
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-27T08:00:00Z')); // Sali 11:00 TR
});
afterEach(() => {
  for (const k of Object.keys(ENV)) { if (eski[k] === undefined) delete process.env[k]; else process.env[k] = eski[k]; }
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('EpostaKampanyaService.tick', () => {
  it('anahtar kapaliyken Mailjet cagrilmaz', async () => {
    const p = sahtePrisma([hedef(1)]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await new EpostaKampanyaService(p as any).tick();
    expect(r.neden).toBe('Kapalı');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('yalniz SIRADA gonderilir; basari/hata satir satir islenir; IYS bekleyen gitmez', async () => {
    const p = sahtePrisma([hedef(1), hedef(2), hedef(3, 'IYS_DOSYADA'), hedef(4, 'YENI')]);
    const fetchMock = vi.fn(async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      expect(body.Messages).toHaveLength(2);
      expect(body.Messages[0].TextPart).toContain('Merhaba {{var:firma}} ekibi,');
      expect(body.Messages[0].Variables.firma).toBe('Firma1');
      expect(body.Messages[0].TextPart).toContain('VKN 1');
      return { status: 200, text: async () => JSON.stringify({ Messages: [{ Status: 'success', To: [{ MessageID: 111 }] }, { Status: 'error', Errors: [{ ErrorMessage: 'x' }] }] }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const svc = new EpostaKampanyaService(p as any);
    await svc.setAcik(true);
    const r = await svc.tick();
    expect(r).toMatchObject({ gonderildi: 1, hata: 1 });
    expect(p.hedefler[0]).toMatchObject({ durum: 'GONDERILDI', messageId: '111', sonOlay: 'sent' });
    expect(p.hedefler[1].durum).toBe('HATA');
    expect(p.hedefler[2].durum).toBe('IYS_DOSYADA');
    expect(p.hedefler[3].durum).toBe('YENI');
  });

  it('pencere disinda ve zorla verilmezse gondermez', async () => {
    vi.setSystemTime(new Date('2026-10-31T09:00:00Z')); // Cumartesi
    const p = sahtePrisma([hedef(1)]);
    const svc = new EpostaKampanyaService(p as any);
    await svc.setAcik(true);
    expect((await svc.tick()).neden).toMatch(/pencere/i);
  });

  it('ag hatasinda isaret kalir ve gonderim duraklar (ikinci mail riski yok)', async () => {
    const p = sahtePrisma([hedef(1)]);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout'); }));
    const svc = new EpostaKampanyaService(p as any);
    await svc.setAcik(true);
    const r = await svc.tick();
    expect(r.neden).toMatch(/ulaşılamadı/);
    expect(p.hedefler[0].durum).toBe('SIRADA');
    expect(p.hedefler[0].sonOlay).toMatch(/^gonderiliyor:/);
    expect((await svc.tick()).neden).toMatch(/Duraklatıldı/);
  });

  it('son 7 gunde geri donme %3 ustundeyse durur', async () => {
    const gonderilmis = Array.from({ length: 40 }, (_, i) => ({ ...hedef(100 + i, i < 3 ? 'BOUNCE' : 'GONDERILDI'), gonderildiAt: new Date('2026-10-26T08:00:00Z') }));
    const p = sahtePrisma([...gonderilmis, hedef(1)]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const svc = new EpostaKampanyaService(p as any);
    await svc.setAcik(true);
    expect((await svc.tick()).neden).toMatch(/geri dönme/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('Mailjet olaylari', () => {
  it('belirtec dogrulanir; olay acilma/ret isler, kapali durumu geri almaz', async () => {
    const h1 = { ...hedef(1, 'GONDERILDI') };
    const h2 = { ...hedef(2, 'RET') };
    const p = sahtePrisma([h1, h2]);
    const svc = new EpostaKampanyaService(p as any);
    expect(svc.belirtecGecerli('yanlis')).toBe(false);
    expect(svc.belirtecGecerli(svc.webhookBelirteci())).toBe(true);
    await svc.olaylariIsle([
      { event: 'open', email: h1.email, time: 1793000000, CustomID: `kurumsal-2026-10:${h1.email}` },
      { event: 'open', email: h1.email, CustomID: 'baska' },
      { event: 'bounce', email: h2.email, hard_bounce: true },
    ]);
    expect(h1.acildiAt).toBeInstanceOf(Date);
    expect(h2.durum).toBe('RET');
  });

  it('gonderiliyor isaretli SIRADA satira bizim olay gelirse GONDERILDI olur (yeniden gonderilmez); baska mesaj dokunmaz', async () => {
    const h = { ...hedef(5), sonOlay: 'gonderiliyor:x', sonOlayAt: new Date() };
    const p = sahtePrisma([h]);
    const svc = new EpostaKampanyaService(p as any);
    await svc.olaylariIsle({ event: 'open', email: h.email, CustomID: 'baska-sistem' });
    expect(h.durum).toBe('SIRADA');
    expect(h.sonOlay).toBe('gonderiliyor:x');
    await svc.olaylariIsle({ event: 'open', email: h.email, CustomID: `kurumsal-2026-10:${h.email}` });
    expect(h.durum).toBe('GONDERILDI');
    expect(h.gonderildiAt).toBeInstanceOf(Date);
  });
});

describe('kilit ve sahiplenme', () => {
  it('ikinci es zamanli tur kilidi alamaz; arada HARIC yapilan satir gonderilmez', async () => {
    const p = sahtePrisma([hedef(1), hedef(2)]);
    let birinciTur: Promise<any> | null = null;
    const svc = new EpostaKampanyaService(p as any);
    const fetchMock = vi.fn(async (_u: string, init: any) => {
      const body = JSON.parse(init.body);
      // POST surerken ikinci tur denenir → kilit yuzunden girmez
      expect((await svc.tick()).neden).toBe('Başka bir tur çalışıyor');
      return { status: 200, text: async () => JSON.stringify({ Messages: body.Messages.map(() => ({ Status: 'success', To: [{ MessageID: 12345678901234567890 }] })) }) };
    });
    vi.stubGlobal('fetch', fetchMock);
    await svc.setAcik(true);
    p.hedefler[1].durum = 'HARIC';
    birinciTur = svc.tick();
    const r = await birinciTur;
    expect(r.gonderildi).toBe(1);
    expect(p.hedefler[1].durum).toBe('HARIC');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sahiplenme isareti sonOlay sutununa sigar (VarChar 64)', async () => {
    const p = sahtePrisma([hedef(1)]);
    let gorulen = '';
    vi.stubGlobal('fetch', vi.fn(async () => {
      gorulen = p.hedefler[0].sonOlay;
      return { status: 200, text: async () => '{"Messages":[{"Status":"success","To":[{"MessageID":1}]}]}' };
    }));
    const svc = new EpostaKampanyaService(p as any);
    await svc.setAcik(true);
    await svc.tick();
    expect(gorulen).toMatch(/^gonderiliyor:/);
    expect(gorulen.length).toBeLessThanOrEqual(64);
  });

  it('64-bit MessageID hassasiyetini kaybetmez', async () => {
    const p = sahtePrisma([hedef(1)]);
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, text: async () => '{"Messages":[{"Status":"success","To":[{"MessageID":1152921510123456789}]}]}' })));
    const svc = new EpostaKampanyaService(p as any);
    await svc.setAcik(true);
    await svc.tick();
    expect(p.hedefler[0].messageId).toBe('1152921510123456789');
  });
});

describe('soguk gonderim araci', () => {
  it('disa aktarim: yalniz SIRADA + bosta satirlar; isaretlenenler DIS_ARAC olur, Mailjet turu artik almaz', async () => {
    const h: any[] = [hedef(1), hedef(2), hedef(3, 'YENI'), { ...hedef(4), sonOlay: 'gonderiliyor:x' }];
    const svc = new EpostaKampanyaService(sahtePrisma(h) as never);
    const r = await svc.sogukDisaAktar({ isaretle: true, limit: 10 });
    expect(r.adet).toBe(2);
    expect(r.csv).toContain('info@firma1.com.tr');
    expect(r.csv).not.toContain('firma3');
    expect(r.csv).not.toContain('firma4');
    expect(r.sablonlar).toContain('{{ret_url}}');
    expect(h.slice(0, 2).map((x) => x.durum)).toEqual(['DIS_ARAC', 'DIS_ARAC']);
    expect(h[0].kampanya).toMatch(/^soguk-\d{4}-\d{2}-\d{2}$/);
    expect(h[3].durum).toBe('SIRADA');
  });

  it('isaretlemeden onizleme durum degistirmez', async () => {
    const h = [hedef(1)];
    const svc = new EpostaKampanyaService(sahtePrisma(h) as never);
    expect((await svc.sogukDisaAktar({})).adet).toBe(1);
    expect(h[0].durum).toBe('SIRADA');
  });

  it('ret: gecerli imza RET yazar (BOUNCE korunur), gecersiz imza hicbir sey yazmaz', async () => {
    const { retImzasi } = await import('./soguk-gonderim.js');
    const h = [{ ...hedef(1), durum: 'DIS_ARAC' }, { ...hedef(2), durum: 'BOUNCE' }];
    const svc = new EpostaKampanyaService(sahtePrisma(h) as never);
    expect(await svc.retIsle(h[0].email, 'yanlis')).toBe(false);
    expect(h[0].durum).toBe('DIS_ARAC');
    expect(await svc.retIsle(h[0].email.toUpperCase(), retImzasi(h[0].email, 'test'))).toBe(true);
    expect(h[0].durum).toBe('RET');
    expect(await svc.retIsle(h[1].email, retImzasi(h[1].email, 'test'))).toBe(true);
    expect(h[1].durum).toBe('BOUNCE');
  });
});

describe('SMTP kanali', () => {
  const SMTP_ENV = {
    EPOSTA_KANAL: 'smtp', EPOSTA_SMTP_HOST: 'mail.getranksup.com', EPOSTA_SMTP_USER: 'emir@getranksup.com', EPOSTA_SMTP_PASS: 'x',
    EPOSTA_SMTP_ARALIK_MS: '0',
  };
  const eskiSmtp: Record<string, string | undefined> = {};
  beforeEach(() => { for (const [k, v] of Object.entries(SMTP_ENV)) { eskiSmtp[k] = process.env[k]; process.env[k] = v; } });
  afterEach(() => { for (const k of Object.keys(SMTP_ENV)) { if (eskiSmtp[k] === undefined) delete process.env[k]; else process.env[k] = eskiSmtp[k]; } });

  const kur = (hedefler: any[], gelen: any[] = [], gonder?: (m: any) => Promise<unknown>) => {
    const p = sahtePrisma(hedefler);
    const svc = new EpostaKampanyaService(p as any);
    const gonderilen: any[] = [];
    svc.smtpFabrika = () => ({ sendMail: async (m: any) => { gonderilen.push(m); return gonder ? gonder(m) : { messageId: m.messageId }; }, close: () => undefined });
    const okuma = vi.fn(async () => ({ imlec: '1:9', mesajlar: gelen }));
    svc.gelenOku = okuma;
    return { p, svc, gonderilen, okuma };
  };

  it('Mailjet cagrilmaz; tek tek gider, Message-ID saklanir, tur basina en fazla 10', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { p, svc, gonderilen, okuma } = kur(Array.from({ length: 12 }, (_, i) => hedef(i + 1)));
    await svc.setAcik(true);
    const r = await svc.tick();
    expect(r).toMatchObject({ gonderildi: 10, hata: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(okuma).toHaveBeenCalledTimes(1);
    expect(gonderilen).toHaveLength(10);
    expect(gonderilen[0]).toMatchObject({ to: 'info@firma1.com.tr', from: { address: 'emir@getranksup.com' } });
    expect(gonderilen[0].text).toContain('Merhaba Firma1 ekibi,');
    const id = p.hedefler[0].messageId;
    expect(id).toMatch(/^rs[0-9a-f]{24}$/);
    expect(gonderilen[0].messageId).toBe(`<${id}@getranksup.com>`);
    expect(p.hedefler.filter((h: any) => h.durum === 'GONDERILDI')).toHaveLength(10);
    expect(p.hedefler[11]).toMatchObject({ durum: 'SIRADA', sonOlay: null });
  });

  it('gelen kutusu: geri donme BOUNCE, bizim mesaja yanit "yanit", "ret" yaniti RET — gonderimden once', async () => {
    const gonderilmis = (i: number, mid: string) => ({ ...hedef(i, 'GONDERILDI'), messageId: mid, gonderildiAt: new Date('2026-10-26T08:00:00Z') });
    const k1 = 'rs' + '1'.repeat(24), k2 = 'rs' + '2'.repeat(24);
    const dsn = 'Content-Type: multipart/report; report-type=delivery-status; boundary="b"\r\n\r\n--b\r\n\r\nFinal-Recipient: rfc822; info@firma7.com.tr\r\nAction: failed\r\nStatus: 5.1.1\r\n--b--';
    const { p, svc } = kur(
      [gonderilmis(7, 'rsx'), gonderilmis(8, k1), gonderilmis(9, k2), hedef(1)],
      [
        { uid: 3, kimden: 'mailer-daemon@sv1.luvihost.com', konu: 'Mail delivery failed', ham: dsn },
        { uid: 4, kimden: 'ali@firma8.com.tr', konu: 'Re: teklif', ham: `In-Reply-To: <${k1}@getranksup.com>\r\n\r\nMerhaba, görüşelim.` },
        { uid: 5, kimden: 'veli@firma9.com.tr', konu: 'Re: teklif', ham: `References: <${k2}@getranksup.com>\r\n\r\nLütfen listeden çıkarın.` },
      ],
    );
    await svc.setAcik(true);
    await svc.tick();
    expect(p.hedefler[0].durum).toBe('BOUNCE');
    expect(p.hedefler[1]).toMatchObject({ durum: 'GONDERILDI', sonOlay: 'yanit' });
    expect(p.hedefler[2].durum).toBe('RET');
    expect(p.hedefler[3].durum).toBe('GONDERILDI');
    expect(await svc['kv']('eposta-kampanya:imap-imlec')).toBe('1:9');
  });

  it('baglanti hatasinda: o satir belirsiz HATA, kalanlar sirada kalir, gonderim durur', async () => {
    let n = 0;
    const { p, svc } = kur([hedef(1), hedef(2), hedef(3)], [], async () => { if (++n === 2) throw Object.assign(new Error('Connection closed'), { code: 'ECONNECTION' }); return {}; });
    await svc.setAcik(true);
    const r = await svc.tick();
    expect(r).toMatchObject({ gonderildi: 1, hata: 1 });
    expect(p.hedefler[0].durum).toBe('GONDERILDI');
    expect(p.hedefler[1]).toMatchObject({ durum: 'HATA', sonOlay: 'belirsiz' });
    expect(p.hedefler[2]).toMatchObject({ durum: 'SIRADA', sonOlay: null });
    expect((await svc.tick()).neden).toMatch(/Duraklatıldı/);
  });

  it('alici reddi (RCPT 550) BOUNCE olur, tur devam eder', async () => {
    const { p, svc } = kur([hedef(1), hedef(2)], [], async (m) => {
      if (m.to === 'info@firma1.com.tr') throw Object.assign(new Error('550 no such user'), { responseCode: 550, command: 'RCPT TO' });
      return {};
    });
    await svc.setAcik(true);
    const r = await svc.tick();
    expect(r).toMatchObject({ gonderildi: 1, hata: 1 });
    expect(p.hedefler[0].durum).toBe('BOUNCE');
    expect(p.hedefler[1].durum).toBe('GONDERILDI');
  });

  it('gelen kutusu okunamazsa gondermez (geri donmeler gorulmeden fren kor kalir)', async () => {
    const { p, svc, gonderilen } = kur([hedef(1)]);
    svc.gelenOku = async () => { throw new Error('IMAP auth'); };
    await svc.setAcik(true);
    expect((await svc.tick()).neden).toMatch(/Gelen kutusu okunamadı/);
    expect(gonderilen).toHaveLength(0);
    expect(p.hedefler[0]).toMatchObject({ durum: 'SIRADA', sonOlay: null });
  });

  it('ranksup.ai adresinden soguk gonderim yapilmaz', async () => {
    process.env.EPOSTA_SMTP_FROM = 'emir@ranksup.ai';
    try {
      const { svc, gonderilen } = kur([hedef(1)]);
      await svc.setAcik(true);
      expect((await svc.tick()).neden).toMatch(/ranksup\.ai/);
      expect(gonderilen).toHaveLength(0);
      expect(svc.hazirlikSorunlari().join()).toMatch(/ranksup\.ai/);
    } finally {
      delete process.env.EPOSTA_SMTP_FROM;
    }
  });
});
