import { describe, it, expect, vi } from 'vitest';
import { KarneService } from './karne.service.js';
import { sorulariGetir } from './karne-sorular.js';

/**
 * Panelden karne uretimi (intel.controller → KarneService.uret).
 *
 * NEDEN VAR: altsektorAnahtari(sektor, altsektor) tek argumanla (alt sektor
 * metni) cagriliyordu; fonksiyon onu sektor diye dogrulayip "Bilinmeyen
 * sektör" hatasi atiyordu. Alt sektor verilen her panel karnesi hic
 * uretilmiyordu (hata yalniz loglaniyordu). Vitest dekorator metadata'si
 * uretmez — servis elle kurulur.
 */
function kur() {
  const runPublicProbes = vi.fn<(opts: { queries: string[] }) => Promise<unknown[]>>(async () => [
    { provider: 'perplexity', label: 'Perplexity', available: true, probes: [], cost: 0.001 },
    { provider: 'meta', label: 'Meta AI (Llama)', available: false, probes: [], reason: 'NO_KEY', cost: 0 },
  ]);
  const create = vi.fn(async () => ({ id: 'k1', token: 'tok' }));
  const prisma = { prospectKarne: { create } };
  const settings = { getString: vi.fn(async () => '') };
  const svc = new KarneService(prisma as any, { runPublicProbes } as any, settings as any);
  return { svc, runPublicProbes, create };
}

describe('KarneService.uret — alt sektor', () => {
  it('eslesen alt sektor: hata yok, alana ozel sorular sorulur ve anahtar kayda gecer', async () => {
    const t = kur();
    const k = await t.svc.uret({ brand: 'Acme Bank', host: 'acmebank.com.tr', sektor: 'finans', altsektor: 'Sigorta şirketi' });
    expect(k.token).toBe('tok');
    const sorulan = t.runPublicProbes.mock.calls[0][0].queries;
    expect(sorulan).toEqual(sorulariGetir('finans', 'sigorta'));
    // Genel setten farkli: son 3 soru alana ozel
    expect(sorulan).not.toEqual(sorulariGetir('finans'));
    expect((t.create.mock.calls[0] as any)[0].data.altsektor).toBe('sigorta');
  });

  it('eslesmeyen alt sektor genel sorulara duser (hata atmaz), ham metin kayda gecer', async () => {
    const t = kur();
    await t.svc.uret({ brand: 'Acme Bank', host: 'acmebank.com.tr', sektor: 'finans', altsektor: 'kuyumcu' });
    expect(t.runPublicProbes.mock.calls[0][0].queries).toEqual(sorulariGetir('finans'));
    expect((t.create.mock.calls[0] as any)[0].data.altsektor).toBe('kuyumcu');
  });

  it('yapilandirilmamis saglayici (NO_KEY) karnede kapsam disi', async () => {
    const t = kur();
    const k = await t.svc.uret({ brand: 'Acme Bank', host: 'acmebank.com.tr', sektor: 'finans' });
    expect(k.ozet.saglayicilar.find((s) => s.provider === 'meta')?.kapsamda).toBe(false);
  });
});
