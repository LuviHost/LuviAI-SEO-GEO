import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildBrainContext } from '@luviai/shared';
import { AdsAuditService, ADS_AUDIT_DEFAULT_MODEL, adsAuditModel, normalizeVerdict } from './ads-audit.service.js';
import type { AccountSnapshot } from './rules/types.js';

/**
 * Kampanya Skoru LLM hakemi. Eskiden agent-runner'a `brain` alani olmayan bir
 * baglamla gidiyordu: buildBrainContext daha model cagrilmadan firlatiyor ve
 * LLM ile degerlendirilen HER kural 'na' / 'LLM değerlendirme hatası'
 * donuyordu; ayrica EDITOR_MODEL hakem modelini eziyordu.
 */

const SNAPSHOT: AccountSnapshot = {
  monthlySpendUsd: 1500,
  campaigns: [
    { id: 'c1', name: 'Marka_Arama_TR', budget: 100, bidStrategy: 'MAXIMIZE_CONVERSIONS' },
    { id: 'c2', name: 'Genel_Arama_TR', budget: 200, bidStrategy: 'MAXIMIZE_CONVERSIONS' },
  ],
  campaignNamingSamples: ['Marka_Arama_TR', 'Genel_Arama_TR', 'kampanya 3'],
  adCopySamples: [{ headline: 'Hızlı Web Hosting' }, { headline: 'Ucuz Alan Adı' }],
};

function setup(chat: (req: any) => Promise<{ output: string }>) {
  const prisma: any = { adsAudit: { create: vi.fn(async () => ({})) } };
  const collector: any = { collect: vi.fn(async () => SNAPSHOT) };
  const llm: any = { chat: vi.fn(chat) };
  return { svc: new AdsAuditService(prisma, collector, llm), prisma, llm };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('AdsAuditService — LLM kurallari gercek karar alir', () => {
  it('eski kok neden: brain alani olmayan baglam buildBrainContext\'i dusururdu', () => {
    expect(() => buildBrainContext({ brand: 'RanksUp Ads Audit', voice: 'analitik', goals: [], stoplist: [] } as any)).toThrow(/brandVoice/);
  });

  it('modelin verdict\'i bulguya yazilir; LLM kurallarinin hicbiri hata nedeniyle na olmaz', async () => {
    const { svc, llm } = setup(async () => ({
      output: 'Değerlendirme:\n```json\n{"verdict": "fail", "finding": "Marka ve genel kampanyalar karışık.", "recommendation": "Ayrı kampanyalara böl."}\n```',
    }));
    const score = await svc.run('s1', 'google', 'saas');
    const calls = llm.chat.mock.calls.length;
    expect(calls).toBeGreaterThan(10);
    // LLM kurali G05: artik gercek karar
    const g05 = score.findings.find((f) => f.ruleId === 'G05');
    expect(g05).toMatchObject({ verdict: 'fail', finding: 'Marka ve genel kampanyalar karışık.', recommendation: 'Ayrı kampanyalara böl.' });
    expect(score.summary.fail).toBeGreaterThanOrEqual(calls);
    expect(score.findings.some((f) => f.finding === 'LLM değerlendirme hatası')).toBe(false);
  });

  it('hakem LLM saglayicisina dogrudan gider: ads-audit-llm baglami, site, dusuk efor, EDITOR_MODEL etkilemez', async () => {
    vi.stubEnv('EDITOR_MODEL', 'claude-haiku-4-5');
    const { svc, llm } = setup(async () => ({ output: '{"verdict":"pass","finding":"ok","recommendation":""}' }));
    await svc.run('s1', 'meta', 'ecommerce');
    const req = llm.chat.mock.calls[0][0];
    expect(req).toMatchObject({ context: 'ads-audit-llm', siteId: 's1', model: ADS_AUDIT_DEFAULT_MODEL, effort: 'low', maxTokens: 4000 });
    expect(req.systemPrompt).toContain('reklam hesabı denetçisi');
    expect(req.messages[0].role).toBe('user');
  });

  it('model ADS_AUDIT_MODEL ile secilir', async () => {
    vi.stubEnv('ADS_AUDIT_MODEL', 'claude-opus-5-5');
    expect(adsAuditModel()).toBe('claude-opus-5-5');
    const { svc, llm } = setup(async () => ({ output: '{"verdict":"pass"}' }));
    await svc.run('s1', 'google');
    expect(llm.chat.mock.calls.every((c: any[]) => c[0].model === 'claude-opus-5-5')).toBe(true);
  });

  it('model hatasi ya da JSON olmayan cevap o kurali na yapar, digerleri etkilenmez', async () => {
    let n = 0;
    const { svc } = setup(async () => {
      n++;
      if (n === 1) throw new Error('rate limit');
      if (n === 2) return { output: 'JSON yok' };
      return { output: '{"verdict":"warning","finding":"kısmen","recommendation":"düzelt"}' };
    });
    const score = await svc.run('s1', 'google');
    expect(score.findings.filter((f) => f.verdict === 'warning').length).toBeGreaterThan(5);
    // na olanlar bulgulara girmez; ozet sayar
    expect(score.summary.na).toBeGreaterThanOrEqual(2);
    expect(Number.isFinite(score.total)).toBe(true);
  });

  it('seyrek hesapta model hic cagrilmaz', async () => {
    const { svc, llm } = setup(async () => ({ output: '{}' }));
    (svc as any).collector.collect.mockResolvedValue({ monthlySpendUsd: 0, campaigns: [] });
    await svc.run('s1', 'google');
    expect(llm.chat).not.toHaveBeenCalled();
  });
});

describe('normalizeVerdict', () => {
  it('buyuk harf, n/a ve bilinmeyen degerler skorlayicinin sozlugune iner', () => {
    expect(normalizeVerdict('PASS')).toBe('pass');
    expect(normalizeVerdict(' Warning ')).toBe('warning');
    expect(normalizeVerdict('warn')).toBe('warning');
    expect(normalizeVerdict('FAIL')).toBe('fail');
    expect(normalizeVerdict('N/A')).toBe('na');
    expect(normalizeVerdict('n_a')).toBe('na');
    expect(normalizeVerdict('belki')).toBe('na');
    expect(normalizeVerdict(undefined)).toBe('na');
  });
});
