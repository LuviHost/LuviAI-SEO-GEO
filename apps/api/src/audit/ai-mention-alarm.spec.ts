import { describe, it, expect, vi } from 'vitest';
import { AiMentionAlarmService, snapshotTrend } from './ai-mention-alarm.service.js';

const snap = (provider: string, probes: any[], extra: any = {}) => ({ provider, available: true, probes, matchVersion: 2, ...extra });
const q = (query: string, cited: boolean, brandMentioned = cited, more: any = {}) => ({ query, cited, brandMentioned, ...more });

describe('snapshotTrend — alarm karsilastirmasi', () => {
  it('ayni sorular: puanlar citation-score ile ayni (alinti 100, anilma 50)', () => {
    const t = snapshotTrend(
      [snap('anthropic', [q('en iyi hosting', false, true), q('ucuz vps', false, false)])],
      [snap('anthropic', [q('en iyi hosting', true), q('ucuz vps', true)])],
      'anthropic',
    );
    expect(t.state).toBe('comparable');
    expect(t.previous).toBe(100);
    expect(t.current).toBe(25);
  });

  it('beyin yenilendi, sorular degisti → karsilastirma YOK (eskiden sahte dusus e-postasi)', () => {
    const t = snapshotTrend(
      [snap('anthropic', [q('yeni soru 1', false), q('yeni soru 2', false)])],
      [snap('anthropic', [q('eski soru 1', true), q('eski soru 2', true)])],
      'anthropic',
    );
    expect(t.state).toBe('scope_changed');
  });

  it('alinti olcum yontemi degisti (matchVersion 1 → 2) → method_changed', () => {
    const t = snapshotTrend(
      [snap('openai', [q('a', false)], { matchVersion: 2 })],
      [snap('openai', [q('a', true)], { matchVersion: 1 })],
      'openai',
    );
    expect(t.state).toBe('method_changed');
  });

  it('olculemeyen snapshot, HATA probe ve markali soru sayilmaz', () => {
    const t = snapshotTrend(
      [snap('gemini', [q('a', true), q('b', false, false, { excerpt: 'HATA: 429' }), q('marka x', true, true, { brandInQuery: true })])],
      [snap('gemini', [q('a', true)]), snap('gemini', [q('a', false)], { available: false })],
      'gemini',
    );
    expect(t).toMatchObject({ state: 'comparable', current: 100, previous: 100, matchedCells: 1 });
  });
});

describe('scanAndAlert — silme talebi olan hesap', () => {
  // Iki donemde ayni soru: once alintilandi (100), simdi hic (0) → %100 dusus
  const onceki = Array.from({ length: 4 }, () => snap('anthropic', [q('en iyi hosting', true)], { matchVersion: 4 }));
  const simdi = Array.from({ length: 4 }, () => snap('anthropic', [q('en iyi hosting', false, false)], { matchVersion: 4 }));

  function kur() {
    const sites = [
      { id: 'site-silinecek', name: 'Silinecek', user: { id: 'u-sil', email: 'sil@ornek.com', deletionRequestedAt: new Date('2026-10-10T00:00:00Z') } },
      { id: 'site-normal', name: 'Normal', user: { id: 'u-normal', email: 'normal@ornek.com', deletionRequestedAt: null } },
    ];
    const prisma = {
      site: { findMany: vi.fn(async () => sites) },
      aiCitationSnapshot: { findMany: vi.fn(async ({ where }: any) => (where.date.lt ? onceki : simdi)) },
    };
    const email = { sendRaw: vi.fn(async () => ({ ok: true })) };
    const svc = new AiMentionAlarmService(prisma as never, email as never);
    const debug = vi.spyOn((svc as any).log, 'debug').mockImplementation(() => undefined);
    vi.spyOn((svc as any).log, 'log').mockImplementation(() => undefined);
    return { svc, prisma, email, debug };
  }

  it('silme talebi olan hesabin sitesi taranmaz, e-posta gitmez; digerleri degismedi', async () => {
    const t = kur();
    const r = await t.svc.scanAndAlert();

    expect(t.email.sendRaw).toHaveBeenCalledTimes(1);
    expect(t.email.sendRaw).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u-normal', to: 'normal@ornek.com' }));
    expect(r.alerts.every((a) => a.siteId === 'site-normal')).toBe(true);
    expect(r.alerts.map((a) => a.type)).toEqual(['drop-anthropic', 'drop-overall']);
    // Atlanan site icin snapshot sorgusu bile yapilmaz
    expect(t.prisma.aiCitationSnapshot.findMany.mock.calls.every(([a]: any) => a.where.siteId === 'site-normal')).toBe(true);
    expect(t.debug).toHaveBeenCalledWith(expect.stringContaining('silme talebi'));
    // Kontrol ek sorgu acmaz: site sorgusunun kullanici seciminde
    expect(t.prisma.site.findMany).toHaveBeenCalledWith(expect.objectContaining({
      include: { user: { select: expect.objectContaining({ deletionRequestedAt: true }) } },
    }));
  });

  it('alarm e-postasi kanitlanamayan saat/otomatik olcum vaadi tasimaz', async () => {
    const t = kur();
    await t.svc.scanAndAlert();
    const html = (t.email.sendRaw.mock.calls[0] as any[])[0].html as string;
    expect(html).not.toContain('04:00');
    expect(html).toContain('son 7 günün AI görünürlük ölçümleri önceki 7 günle karşılaştırılarak');
  });
});
