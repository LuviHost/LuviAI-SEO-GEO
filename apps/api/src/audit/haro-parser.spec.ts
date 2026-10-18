import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
const { HaroParserService, HARO_MAX_BLOCKS, HARO_PITCH_TOP_N } = await import('./haro-parser.service.js');

/**
 * HARO ozeti — servis duzeyi tavanlar.
 *
 * NEDEN VAR: servis her "N) Summary:" blogu icin AYRI ve SIRAYLA bir model
 * cagrisi yapiyordu ve blok sayisini sinirlamiyordu; 30 blok tavani yalniz
 * controller'daydi (MCP / worker gibi dogrudan cagiranlar gecebilirdi).
 * Vitest dekorator metadata'si uretmedigi icin servis elle kurulur.
 */

function digest(n: number, fit: (i: number) => { category?: string; summary?: string } = () => ({})): string {
  let s = 'HARO Daily Digest\n';
  for (let i = 1; i <= n; i++) {
    const f = fit(i);
    s += `\n${i}) Summary: ${f.summary ?? `Konu ${i}`}\nName: Muhabir ${i}\nCategory: ${f.category ?? 'General'}\nEmail: m${i}@gazete.example\nMedia Outlet: Gazete ${i}\nDeadline: 20 Ekim\nQuery: Soru ${i} hakkinda gorus?\nRequirements: Kisa yanit\n`;
  }
  return s;
}

describe('HaroParserService.parseDigest', () => {
  const backup = process.env.ANTHROPIC_API_KEY;
  beforeEach(() => { delete process.env.ANTHROPIC_API_KEY; });
  afterEach(() => {
    if (backup === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = backup;
  });

  function svc() {
    const prisma = { site: { findUniqueOrThrow: vi.fn(async () => ({ id: 's1', name: 'Lavanta', niche: 'kuaför', brain: { brandVoice: { tone: 'samimi' } } })) } };
    const s = new HaroParserService(prisma as any);
    const generatePitch = vi.fn(async (o: { reporterName: string }) => `Merhaba ${o.reporterName}`);
    (s as any).generatePitch = generatePitch;
    return { s, prisma, generatePitch };
  }

  it(`${HARO_MAX_BLOCKS} bloktan fazlasi 400; DB'ye ve modele gidilmez`, async () => {
    const { s, prisma, generatePitch } = svc();
    const err = await s.parseDigest('s1', digest(HARO_MAX_BLOCKS + 1)).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(String(err.message)).toContain(`en fazla ${HARO_MAX_BLOCKS} HARO sorusu`);
    expect(String(err.message)).toContain(`${HARO_MAX_BLOCKS + 1} soru var`);
    expect(prisma.site.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(generatePitch).not.toHaveBeenCalled();
  });

  it(`tavanda (${HARO_MAX_BLOCKS} blok) calisir; taslak yalniz en uygun ${HARO_PITCH_TOP_N} soru icin`, async () => {
    const { s, generatePitch } = svc();
    // 3, 7 ve 21. sorular nis kelimesini ("kuaför") iceriyor → en uygun
    const out = await s.parseDigest('s1', digest(HARO_MAX_BLOCKS, (i) => ([3, 7, 21].includes(i) ? { summary: `kuaför trendleri ${i}` } : {})));
    expect(out).toHaveLength(HARO_MAX_BLOCKS);
    expect(generatePitch).toHaveBeenCalledTimes(HARO_PITCH_TOP_N);
    // Siralama: puan azalan, esitte e-postadaki sira korunur
    expect(out.slice(0, 3).map((q) => q.reporter)).toEqual(['Muhabir 3', 'Muhabir 7', 'Muhabir 21']);
    const withPitch = out.filter((q) => !q.pitchSkipped);
    expect(withPitch).toHaveLength(HARO_PITCH_TOP_N);
    for (const q of withPitch) expect(q.draftPitch).toBe(`Merhaba ${q.reporter}`);
    const skipped = out.filter((q) => q.pitchSkipped);
    expect(skipped).toHaveLength(HARO_MAX_BLOCKS - HARO_PITCH_TOP_N);
    for (const q of skipped) expect(q.draftPitch).toBe('');
    // Taslaksiz kalanlarin puani taslakli olanlarin hicbirinden yuksek degil
    const minWith = Math.min(...withPitch.map((q) => q.brandFitScore));
    expect(Math.max(...skipped.map((q) => q.brandFitScore))).toBeLessThanOrEqual(minWith);
  });

  it('az soruda hepsine taslak; Query olmayan blok atlanir; dize disi govde bos liste', async () => {
    const { s, generatePitch } = svc();
    const metin = `${digest(2)}\n3) Summary: Sorusuz blok\nName: X\n`;
    const out = await s.parseDigest('s1', metin);
    expect(out.map((q) => q.reporter)).toEqual(['Muhabir 1', 'Muhabir 2']);
    expect(out.every((q) => !q.pitchSkipped && q.draftPitch.startsWith('Merhaba'))).toBe(true);
    expect(generatePitch).toHaveBeenCalledTimes(2);
    expect(await s.parseDigest('s1', { x: 1 } as any)).toEqual([]);
  });

  it('taslak cagrilari en fazla 5 paralel', async () => {
    const { s } = svc();
    let active = 0;
    let peak = 0;
    (s as any).generatePitch = vi.fn(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return 'taslak';
    });
    await s.parseDigest('s1', digest(12));
    expect(peak).toBeLessThanOrEqual(5);
    expect((s as any).generatePitch).toHaveBeenCalledTimes(HARO_PITCH_TOP_N);
  });
});
