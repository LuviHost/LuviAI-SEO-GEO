import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException, GoneException } from '@nestjs/common';
import { AscMetadataService, explainAscError } from './asc-metadata.service.js';
import { AscApiError } from './asc-api.client.js';

const USER = { id: 'u1', role: 'USER' as const };
const OTHER = { id: 'u2', role: 'USER' as const };

function asc(values: { subtitle?: string; keywords?: string; versionState?: string } = {}) {
  return {
    listAppStoreVersions: vi.fn(async () => ({ data: [
      { id: 'v2', attributes: { versionString: '1.1', appVersionState: values.versionState ?? 'PREPARE_FOR_SUBMISSION' } },
      { id: 'v1', attributes: { versionString: '1.0', appVersionState: 'READY_FOR_DISTRIBUTION' } },
    ] })),
    listAppInfos: vi.fn(async () => ({ data: [{ id: 'ai2', attributes: { state: 'PREPARE_FOR_SUBMISSION' } }] })),
    listAppInfoLocalizations: vi.fn(async () => ({ data: [{ id: 'ail-tr', attributes: { locale: 'tr', name: 'Takvimim', subtitle: values.subtitle ?? 'Günlük plan' } }] })),
    listVersionLocalizations: vi.fn(async () => ({ data: [{ id: 'vl-tr', attributes: { locale: 'tr', description: 'D', keywords: values.keywords ?? 'ajanda,takvim', promotionalText: '', whatsNew: 'W' } }] })),
    updateAppInfoLocalization: vi.fn(async () => ({ data: {} })),
    updateVersionLocalization: vi.fn(async () => ({ data: {} })),
  };
}

function build(client = asc()) {
  const kv = new Map<string, { key: string; value: string; expiresAt: Date | null }>();
  const fixes: any[] = [];
  const prisma = {
    kvStore: {
      create: vi.fn(async ({ data }: any) => { kv.set(data.key, data); return data; }),
      findUnique: vi.fn(async ({ where }: any) => kv.get(where.key) ?? null),
      delete: vi.fn(async ({ where }: any) => { kv.delete(where.key); }),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    appliedFix: {
      create: vi.fn(async ({ data }: any) => { const f = { id: `fix${fixes.length + 1}`, ...data }; fixes.push(f); return f; }),
      findUnique: vi.fn(async ({ where }: any) => fixes.find((f) => f.id === where.id) ?? null),
      update: vi.fn(async ({ where, data }: any) => Object.assign(fixes.find((f) => f.id === where.id), data)),
    },
  };
  const ascService = {
    loadApp: vi.fn(async (id: string, user: any) => {
      if (user.id !== 'u1' && user.role !== 'ADMIN') throw new ForbiddenException('Bu site sana ait değil');
      return { id, name: 'Takvimim', appleAppId: '6800', accountId: 'acc', account: { siteId: 's1' } };
    }),
    getClient: vi.fn(async () => client),
  };
  const appliedFix = { kaydet: vi.fn(async () => undefined) };
  const svc = new AscMetadataService(prisma as any, ascService as any, appliedFix as any);
  return { svc, prisma, kv, fixes, client, appliedFix };
}

describe('AscMetadataService', () => {
  let t: ReturnType<typeof build>;
  beforeEach(() => { t = build(); });

  it('plan: yalnız uygulanabilir değişiklikler saklanır; keyword denetimi döner', async () => {
    const p = await t.svc.plan('s1', 'app1', USER, { locale: 'tr', fields: { subtitle: 'Ajanda', keywords: 'ajanda, plan', name: 'x'.repeat(31) } });
    expect(p.planId).toBeTruthy();
    expect(p.changes.map((c) => [c.field, c.ok])).toEqual([['name', false], ['subtitle', true], ['keywords', true]]);
    expect(p.keywordAudit?.findings.map((f) => f.code)).toContain('SPACES_AROUND_COMMA');
    const stored = JSON.parse([...t.kv.values()][0].value);
    expect(stored.changes.map((c: any) => c.field)).toEqual(['subtitle', 'keywords']);
    expect(t.client.updateVersionLocalization).not.toHaveBeenCalled();
  });

  it('plan: uygulanabilir değişiklik yoksa planId yok', async () => {
    const p = await t.svc.plan('s1', 'app1', USER, { locale: 'tr', fields: { subtitle: 'Günlük plan' } });
    expect(p.planId).toBeNull();
    expect(t.kv.size).toBe(0);
  });

  it('apply: onay yoksa 400; başka kullanıcı 403; süre dolduysa 410 ve plan silinir', async () => {
    const p = await t.svc.plan('s1', 'app1', USER, { locale: 'tr', fields: { subtitle: 'Ajanda' } });
    await expect(t.svc.apply('s1', 'app1', USER, { planId: p.planId })).rejects.toBeInstanceOf(BadRequestException);
    await expect(t.svc.apply('s1', 'app1', OTHER, { planId: p.planId, confirm: true })).rejects.toBeInstanceOf(ForbiddenException);
    const row = t.kv.get(`asc-meta-plan:${p.planId}`)!;
    row.expiresAt = new Date(Date.now() - 1000);
    await expect(t.svc.apply('s1', 'app1', USER, { planId: p.planId, confirm: true })).rejects.toBeInstanceOf(GoneException);
    expect(t.kv.size).toBe(0);
    expect(t.client.updateAppInfoLocalization).not.toHaveBeenCalled();
  });

  it('apply: plandan sonra ASC değiştiyse 409, HİÇBİR şey yazılmaz', async () => {
    const p = await t.svc.plan('s1', 'app1', USER, { locale: 'tr', fields: { subtitle: 'Ajanda', keywords: 'ajanda,plan' } });
    t.client.listVersionLocalizations.mockResolvedValue({ data: [{ id: 'vl-tr', attributes: { locale: 'tr', description: 'D', keywords: 'baskasi,degistirdi', promotionalText: '', whatsNew: 'W' } }] });
    const err = await t.svc.apply('s1', 'app1', USER, { planId: p.planId, confirm: true }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().conflicts).toEqual([{ locale: 'tr', field: 'keywords', expected: 'ajanda,takvim', actual: 'baskasi,degistirdi' }]);
    expect(t.client.updateAppInfoLocalization).not.toHaveBeenCalled();
    expect(t.client.updateVersionLocalization).not.toHaveBeenCalled();
  });

  it('apply: yerelleştirme başına tek PATCH, eski/yeni değer kaydı, plan tek kullanımlık', async () => {
    const p = await t.svc.plan('s1', 'app1', USER, { locale: 'tr', fields: { subtitle: 'Ajanda', keywords: 'ajanda,plan', promotionalText: 'Yeni' } });
    const r = await t.svc.apply('s1', 'app1', USER, { planId: p.planId, confirm: true });
    expect(r.ok).toBe(true);
    expect(t.client.updateAppInfoLocalization).toHaveBeenCalledWith('ail-tr', { subtitle: 'Ajanda' });
    expect(t.client.updateVersionLocalization).toHaveBeenCalledWith('vl-tr', { keywords: 'ajanda,plan', promotionalText: 'Yeni' });
    expect(t.fixes[1].detail.fields).toEqual({ keywords: { from: 'ajanda,takvim', to: 'ajanda,plan' }, promotionalText: { from: '', to: 'Yeni' } });
    await expect(t.svc.apply('s1', 'app1', USER, { planId: p.planId, confirm: true })).rejects.toThrow(/Plan bulunamadı/);
  });

  it('apply: Apple 409 → anlaşılır hata, FAILED kaydı; diğer yerelleştirme yazılır', async () => {
    t.client.updateVersionLocalization.mockRejectedValue(new AscApiError('x', 409, 'STATE_ERROR.ENTITY_STATE_INVALID', 'Version is not editable'));
    const p = await t.svc.plan('s1', 'app1', USER, { locale: 'tr', fields: { subtitle: 'Ajanda', keywords: 'ajanda,plan' } });
    const r = await t.svc.apply('s1', 'app1', USER, { planId: p.planId, confirm: true });
    expect(r.ok).toBe(false);
    expect(r.results).toEqual([
      { locale: 'tr', scope: 'appInfo', fields: ['subtitle'], ok: true },
      { locale: 'tr', scope: 'version', fields: ['keywords'], ok: false, error: 'Apple bu değişikliği şu an kabul etmiyor (STATE_ERROR.ENTITY_STATE_INVALID): Version is not editable' },
    ]);
    expect(t.appliedFix.kaydet).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED', kind: 'asc_metadata' }));
  });

  it('geri alma: eski değerlere yeni plan (onay ister); uygulanınca asıl kayıt REVERTED', async () => {
    const p = await t.svc.plan('s1', 'app1', USER, { locale: 'tr', fields: { keywords: 'ajanda,plan' } });
    await t.svc.apply('s1', 'app1', USER, { planId: p.planId, confirm: true });
    t.client.listVersionLocalizations.mockResolvedValue({ data: [{ id: 'vl-tr', attributes: { locale: 'tr', description: 'D', keywords: 'ajanda,plan', promotionalText: '', whatsNew: 'W' } }] });
    const rp = await t.svc.planRevert('s1', 'app1', USER, 'fix1');
    expect(rp.changes).toEqual([expect.objectContaining({ field: 'keywords', from: 'ajanda,plan', to: 'ajanda,takvim', ok: true })]);
    await t.svc.apply('s1', 'app1', USER, { planId: rp.planId, confirm: true });
    expect(t.fixes[0]).toMatchObject({ status: 'REVERTED' });
    await expect(t.svc.planRevert('s1', 'app1', USER, 'fix1')).rejects.toThrow(/zaten geri alınmış/);
  });

  it('explainAscError: 403 rol mesajı', () => {
    expect(explainAscError(new AscApiError('x', 403, 'FORBIDDEN_ERROR', null))).toMatch(/App Manager ya da Admin/);
  });
});
