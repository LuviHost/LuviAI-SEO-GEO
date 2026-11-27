import { describe, expect, it, vi } from 'vitest';
import { mesajKayitliMi, mesajKomutu, mesajlariAyikla, mesajZamani, sonucuAyikla } from './linkedin-claude.js';
import { blokBasligi } from './elle-kayit.js';
import { LinkedinClaudeService } from './linkedin-claude.service.js';

/** Mesaj taramasi (28.11.2026): yoneticinin LinkedIn mesaj kutusu → takip kaydi */

const SIMDI = new Date('2026-11-28T12:00:00+03:00');

describe('mesaj taramasi — saf kurallar', () => {
  it('komut ornegindeki JSON ajanin duz-nesne ayiklayicisiyla okunur (ic ice {} yok)', () => {
    const k = mesajKomutu([{ no: 1, adSoyad: 'Ayşe Kaya', firma: 'X', profileUrl: 'https://www.linkedin.com/in/a/' }], 'Talat');
    const son = k.split('\n').pop()!;
    // Mac'teki ajanin ayiklayicisi (scripts/linkedin-claude-ajan.mjs) ile ayni desen
    const m = son.match(/\{[^{}]*"durum"[^{}]*\}/g);
    expect(m).toHaveLength(1);
    expect(JSON.parse(m![0]).durum).toBe('MESAJ_TAMAM');
    expect(k).toContain('YALNIZ OKUMA');
    expect(k).toContain('1. Ayşe Kaya (X) — https://www.linkedin.com/in/a/');
    expect(sonucuAyikla(son)?.durum).toBe('MESAJ_TAMAM');
  });

  it('mesajlar: gecersiz numara / yon / zaman / bos metin elenir, zamana gore siralanir', () => {
    const veri = {
      mesajlar: [
        [2, 'GELEN', '2026-11-27 15:10', 'Teşekkürler'],
        [2, 'GIDEN', '2026-11-27 14:05', 'Merhaba Ayşe Hanım,\\nkarne hazır'],
        [3, 'GIDEN', '2026-11-27 14:05', 'numara yok'],
        [1, 'BILMEM', '2026-11-27 14:05', 'yon yok'],
        [1, 'GIDEN', 'dun', 'zaman yok'],
        [1, 'GIDEN', '2026-12-05', 'gelecek'],
        [1, 'GIDEN', '2026-11-26', '   '],
        ['1', 'giden', '2026-11-26', 'yalniz tarih'],
      ],
    };
    const r = mesajlariAyikla(veri, 2, SIMDI);
    expect(r.map((m) => [m.no, m.yon, m.metin])).toEqual([
      [1, 'GIDEN', 'yalniz tarih'],
      [2, 'GIDEN', 'Merhaba Ayşe Hanım,\nkarne hazır'],
      [2, 'GELEN', 'Teşekkürler'],
    ]);
    expect(r[1].at.toISOString()).toBe('2026-11-27T11:05:00.000Z');
    expect(mesajlariAyikla({ mesajlar: 'x' }, 2)).toEqual([]);
    expect(mesajZamani('2026-11-27', SIMDI)?.toISOString()).toBe('2026-11-27T09:00:00.000Z');
  });

  it('kayitli mesaj tekrar eklenmez (bosluk / noktalama / buyuk harf farki)', () => {
    const kayit = '── 27.11.2026 17:17 · LinkedIn ──\nMerhaba Kudret Bey, karne hazır!';
    expect(mesajKayitliMi('merhaba kudret bey   karne hazır', [kayit])).toBe(true);
    expect(mesajKayitliMi('Yeni bir mesaj', [kayit, null])).toBe(false);
  });

  it('baslikta yazan yonetici', () => {
    expect(blokBasligi('LINKEDIN', new Date('2026-11-27T11:05:00Z'), null, 'GIDEN', 'Talat')).toBe('── 27.11.2026 14:05 · LinkedIn · Yazan: Talat ──');
    expect(blokBasligi('LINKEDIN', new Date('2026-11-27T11:05:00Z'), 'K', 'GELEN')).toBe('── 27.11.2026 14:05 · LinkedIn · Gelen · Konu: K ──');
  });
});

describe('mesaj taramasi — servis', () => {
  function kur(kisiler: any[]) {
    const prisma: any = {
      linkedinClaudeIs: {
        findUnique: vi.fn(async () => ({ id: 'is-m', tur: 'MESAJ', durum: 'CALISIYOR', sahipId: 'u-talat', kisiler: kisiler.map((k) => ({ id: k.id, not: '' })) })),
        update: vi.fn(async () => ({})),
      },
      linkedinProspect: {
        findMany: vi.fn(async ({ where }: any) => kisiler.filter((k) => where.id.in.includes(k.id))),
        update: vi.fn(async () => ({})),
      },
      user: { findUnique: vi.fn(async () => ({ name: 'Talat Yılmaz', email: 't@x.com' })) },
    };
    const svc = new LinkedinClaudeService(prisma, {} as any);
    return { prisma, svc };
  }

  it('yeni giden + gelen: konusmaya eklenir, Cevap verdi, gonderen bossa bu yonetici', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(SIMDI);
    try {
      const { prisma, svc } = kur([
        { id: 'p1', status: 'ACCEPTED', noteText: 'Bağlantı notu', messageText: null, messagedAt: null, repliedAt: null, acceptedAt: new Date('2026-11-26T10:00:00Z'), gonderenId: null },
        { id: 'p2', status: 'MESSAGED', noteText: null, messageText: 'Merhaba, karne hazır', messagedAt: new Date('2026-11-27T10:00:00Z'), repliedAt: null, acceptedAt: null, gonderenId: 'u-emir' },
      ]);
      const r = await svc.sonucYaz('u-talat', 'is-m', 'mesaj', 'MESAJ_TAMAM', 'tamam', {
        mesajlar: [
          [1, 'GIDEN', '2026-11-27 14:05', 'Merhaba Ayşe Hanım'],
          [1, 'GELEN', '2026-11-27 15:10', 'Teşekkürler, bakalım'],
          [2, 'GIDEN', '2026-11-27 13:00', 'Merhaba, karne hazır'], // zaten kayitli
          [1, 'GIDEN', '2026-11-26 09:00', 'Bağlantı notu'], // istek notu, mesaj sayilmaz
        ],
      });
      expect(r).toEqual({ devam: true });
      expect(prisma.linkedinProspect.update).toHaveBeenCalledTimes(1);
      const { where, data } = prisma.linkedinProspect.update.mock.calls[0][0];
      expect(where).toEqual({ id: 'p1' });
      expect(data).toMatchObject({ status: 'REPLIED', gonderenId: 'u-talat', hatirlatmaAt: null });
      expect(data.messageText).toBe('── 27.11.2026 14:05 · LinkedIn · Yazan: Talat ──\nMerhaba Ayşe Hanım\n\n── 27.11.2026 15:10 · LinkedIn · Gelen ──\nTeşekkürler, bakalım');
      expect(data.repliedAt.toISOString()).toBe('2026-11-27T12:10:00.000Z');
      const is = prisma.linkedinClaudeIs.update.mock.calls[0][0].data;
      expect(is.sonuc[0]).toMatchObject({ id: 'mesaj', durum: 'MESAJ_TAMAM', guncellenen: ['p1'] });
    } finally {
      vi.useRealTimers();
    }
  });

  it('yalniz giden: Mesaj gönderildi + hatirlatma; baska yoneticinin gonderen kaydi degismez', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(SIMDI);
    try {
      const { prisma, svc } = kur([
        { id: 'p1', status: 'REQUESTED', noteText: null, messageText: null, messagedAt: null, repliedAt: null, acceptedAt: null, gonderenId: 'u-emir' },
      ]);
      await svc.sonucYaz('u-talat', 'is-m', 'mesaj', 'MESAJ_TAMAM', '', { mesajlar: [[1, 'GIDEN', '2026-11-27 14:05', 'Selam']] });
      const { data } = prisma.linkedinProspect.update.mock.calls[0][0];
      expect(data.status).toBe('MESSAGED');
      expect(data.gonderenId).toBeUndefined();
      expect(data.acceptedAt.toISOString()).toBe('2026-11-27T11:05:00.000Z');
      expect(data.hatirlatmaAt).toBeInstanceOf(Date);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ENGEL isi durdurur; tarama yapilamadiysa HATA', async () => {
    const { prisma, svc } = kur([]);
    await expect(svc.sonucYaz('u-talat', 'is-m', 'mesaj', 'ENGEL', 'captcha')).resolves.toEqual({ devam: false });
    expect(prisma.linkedinClaudeIs.update.mock.calls[0][0].data).toMatchObject({ durum: 'HATA' });
    await expect(svc.sonucYaz('u-talat', 'is-m', 'baska', 'MESAJ_TAMAM', '')).rejects.toThrow('tek sonuç');
  });
});

describe('Konuşmaları güncelle dugmesi', () => {
  it('her ajanli yoneticiye tarama acar; zaten taramasi olana acmaz; Mac durumu doner', async () => {
    const simdi = Date.now();
    const prisma: any = {
      linkedinClaudeAjan: { findMany: vi.fn(async () => [{ userId: 'u-emir', sonGorulme: new Date(simdi - 30_000) }, { userId: 'u-talat', sonGorulme: new Date(simdi - 3_600_000) }, { userId: 'u-uc', sonGorulme: null }]) },
      linkedinClaudeIs: {
        findMany: vi.fn(async () => [{ sahipId: 'u-uc', tur: 'MESAJ', durum: 'BEKLIYOR' }]),
        create: vi.fn(async () => ({ id: 'x' })),
      },
      linkedinProspect: { findMany: vi.fn(async () => [{ id: 'p1' }, { id: 'p2' }]) },
      user: { findMany: vi.fn(async () => [{ id: 'u-emir', name: 'Emir Burgazlı' }, { id: 'u-talat', name: 'Talat Yılmaz' }, { id: 'u-uc', name: 'Üç' }]) },
    };
    const svc = new LinkedinClaudeService(prisma, {} as any);
    const { sonuc } = await svc.konusmalariGuncelle({ id: 'u-emir', email: 'e@x.com' });
    expect(sonuc).toEqual([
      { ad: 'Emir', durum: 'SIRADA', macAcik: true, kisi: 2 },
      { ad: 'Talat', durum: 'SIRADA', macAcik: false, kisi: 2 },
      { ad: 'Üç', durum: 'ZATEN_SIRADA', macAcik: false, kisi: 0 },
    ]);
    expect(prisma.linkedinClaudeIs.create).toHaveBeenCalledTimes(2);
    expect(prisma.linkedinClaudeIs.create.mock.calls[1][0].data).toMatchObject({ tur: 'MESAJ', sahipId: 'u-talat', olusturan: 'elle: e@x.com' });
  });

  it('ajan yoksa acik hata', async () => {
    const prisma: any = { linkedinClaudeAjan: { findMany: vi.fn(async () => []) } };
    await expect(new LinkedinClaudeService(prisma, {} as any).konusmalariGuncelle({ id: 'u', email: 'e' })).rejects.toThrow('Bağlı Mac yok');
  });
});
