import { describe, expect, it, vi } from 'vitest';
import { LinkedinClaudeService } from './linkedin-claude.service.js';
import { anahtarOzeti } from './linkedin-claude.js';

/**
 * Iki yonetici (27.11.2026): anahtar, is, kota ve sonuc yazma yonetici basina.
 * Prisma sahte: yalniz cagri argumanlari ve donuslere bakilir.
 */

const LIMITS = { MAX_REQUESTS_PER_DAY: 30, MAX_REQUESTS_PER_WEEK: 120, SAME_COMPANY_PER_DAY: 2 };

function kur(over: Record<string, any> = {}) {
  const prisma: any = {
    linkedinClaudeAjan: {
      findUnique: vi.fn(async () => null),
      update: vi.fn(async () => ({})),
      upsert: vi.fn(async () => ({})),
    },
    linkedinClaudeIs: {
      updateMany: vi.fn(async () => ({ count: 1 })),
      count: vi.fn(async () => 0),
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'is1' })),
      update: vi.fn(async () => ({})),
    },
    linkedinProspect: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    user: {
      findUnique: vi.fn(async () => ({ name: 'Talat Yılmaz', email: 'talat@x.com' })),
      findMany: vi.fn(async () => []),
    },
    ...over,
  };
  const outreach: any = { getLimits: vi.fn(async () => LIMITS), setEnabled: vi.fn(async () => undefined) };
  return { prisma, outreach, svc: new LinkedinClaudeService(prisma, outreach) };
}

describe('LinkedinClaudeService — iki yonetici', () => {
  it('anahtar ozetle aranir, sahibini doner; bilinmeyen anahtar reddedilir', async () => {
    const { svc, prisma } = kur();
    prisma.linkedinClaudeAjan.findUnique.mockResolvedValueOnce({ userId: 'u-talat' });
    await expect(svc.ajanDogrula('lca_talat')).resolves.toBe('u-talat');
    expect(prisma.linkedinClaudeAjan.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { anahtarOzeti: anahtarOzeti('lca_talat') } }));
    expect(prisma.linkedinClaudeAjan.update).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'u-talat' } }));
    await expect(svc.ajanDogrula('lca_yok')).rejects.toThrow('geçersiz');
    await expect(svc.ajanDogrula(undefined)).rejects.toThrow('geçersiz');
  });

  it('anahtar yenileme yalniz o yoneticinin kaydini degistirir', async () => {
    const { svc, prisma } = kur();
    const { anahtar } = await svc.anahtarOlustur('u-talat');
    expect(anahtar).toMatch(/^lca_/);
    const arg = prisma.linkedinClaudeAjan.upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ userId: 'u-talat' });
    expect(arg.update.anahtarOzeti).toBe(anahtarOzeti(anahtar));
  });

  it('ajan yalniz kendi yoneticisinin isini alir; komutta onun adi gecer', async () => {
    const { svc, prisma } = kur();
    // Kabul kontrolu bu slotta zaten acilmis say (testi saatten bagimsiz yap)
    prisma.linkedinClaudeIs.count.mockResolvedValue(1);
    prisma.linkedinClaudeIs.findFirst.mockResolvedValueOnce({ id: 'is1', tur: 'ISTEK', kuru: true, kisiler: [{ id: 'p1', not: 'Merhaba' }], sahipId: 'u-talat' });
    prisma.linkedinProspect.findMany.mockResolvedValueOnce([
      { id: 'p1', ad: 'Ayşe', soyad: 'Kaya', firma: 'X', unvan: null, profileUrl: 'https://www.linkedin.com/in/a/', status: 'QUEUED' },
    ]);
    const r: any = await svc.isAl('u-talat');
    expect(prisma.linkedinClaudeIs.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { durum: 'BEKLIYOR', sahipId: 'u-talat' } }));
    expect(r.is.kisiler[0].komut).toContain('Talat Yılmaz adlı kişinin');
  });

  it('kabul kontrolu yonetici basina acilir ve yalniz onun (ya da sahipsiz) isteklerine bakar', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-27T11:30:00+03:00')); // Cuma 11:30 → 10:00 slotu
    try {
      const { svc, prisma } = kur();
      prisma.linkedinProspect.findMany.mockResolvedValueOnce([{ id: 'p9' }]);
      await svc.isAl('u-talat');
      expect(prisma.linkedinClaudeIs.count).toHaveBeenCalledWith({ where: expect.objectContaining({ tur: 'KABUL', sahipId: 'u-talat' }) });
      const where = prisma.linkedinProspect.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([{ gonderenId: 'u-talat' }, { gonderenId: null }]);
      expect(prisma.linkedinClaudeIs.create.mock.calls[0][0].data.sahipId).toBe('u-talat');
    } finally {
      vi.useRealTimers();
    }
  });

  it('baska yoneticinin isine sonuc yazilamaz', async () => {
    const { svc, prisma } = kur();
    prisma.linkedinClaudeIs.findUnique.mockResolvedValueOnce({ id: 'is1', tur: 'ISTEK', durum: 'CALISIYOR', kuru: false, kisiler: [{ id: 'p1', not: 'n' }], sonuc: [], sahipId: 'u-emir' });
    await expect(svc.sonucYaz('u-talat', 'is1', 'p1', 'GONDERILDI', 'ok')).rejects.toThrow('İş yok');
    expect(prisma.linkedinProspect.updateMany).not.toHaveBeenCalled();
  });

  it('gonderilen istek yoneticinin hesabina yazilir (gonderenId)', async () => {
    const { svc, prisma } = kur();
    prisma.linkedinClaudeIs.findUnique.mockResolvedValueOnce({ id: 'is1', tur: 'ISTEK', durum: 'CALISIYOR', kuru: false, kisiler: [{ id: 'p1', not: 'n' }], sonuc: [], sahipId: 'u-talat' });
    await svc.sonucYaz('u-talat', 'is1', 'p1', 'GONDERILDI', 'istek gitti');
    const data = prisma.linkedinProspect.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: 'REQUESTED', gonderenId: 'u-talat' });
  });

  it('bitir yalniz kendi isini kapatir', async () => {
    const { svc, prisma } = kur();
    await svc.bitir('u-talat', 'is1', undefined);
    expect(prisma.linkedinClaudeIs.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'is1', durum: 'CALISIYOR', sahipId: 'u-talat' } }));
  });

  it('kota hesap basina sayilir', async () => {
    const { svc, prisma } = kur();
    prisma.linkedinProspect.count.mockResolvedValueOnce(25).mockResolvedValueOnce(40);
    const r = await svc.adaylar('u-talat');
    expect(r.kalanBugun).toBe(5);
    for (const c of prisma.linkedinProspect.count.mock.calls) {
      expect(c[0].where.OR).toEqual([{ gonderenId: 'u-talat' }, { gonderenId: null }]);
    }
  });

  it('diger yoneticinin isi yeni isi engellemez; kendi aktif isi engeller; onun kisisi secilemez', async () => {
    const { svc, prisma } = kur();
    const queued = (id: string) => ({ id, status: 'QUEUED', kanal: 'LINKEDIN', elle: false, ad: 'A', soyad: 'B', firma: `F-${id}`, unvan: null, kampanya: 'MUSTERI' });
    // Emir'in suren isi var, Talat yeni is acabilir
    prisma.linkedinClaudeIs.findMany.mockResolvedValueOnce([{ sahipId: 'u-emir', kisiler: [{ id: 'p1', not: '' }] }]);
    prisma.linkedinProspect.findMany.mockResolvedValueOnce([queued('p2')]);
    await expect(svc.isOlustur(['p2'], true, { id: 'u-talat', email: 'talat@x.com' })).resolves.toMatchObject({ id: 'is1' });
    expect(prisma.linkedinClaudeIs.create.mock.calls[0][0].data).toMatchObject({ sahipId: 'u-talat', olusturan: 'talat@x.com' });

    // Emir'in isindeki kisi Talat tarafindan secilemez
    prisma.linkedinClaudeIs.findMany.mockResolvedValueOnce([{ sahipId: 'u-emir', kisiler: [{ id: 'p1', not: '' }] }]);
    await expect(svc.isOlustur(['p1'], true, { id: 'u-talat', email: 'talat@x.com' })).rejects.toThrow('diğer yöneticinin');

    // Kendi aktif isi varken ikinci is acilamaz
    prisma.linkedinClaudeIs.findMany.mockResolvedValueOnce([{ sahipId: 'u-talat', kisiler: [] }]);
    await expect(svc.isOlustur(['p2'], true, { id: 'u-talat', email: 'talat@x.com' })).rejects.toThrow('işin var');
  });
});
