/**
 * Panel taramasi kuyruk + yoklama ile calisir; senkron istek vekil sunucuda 504'e dusuyordu.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { describe, expect, it } from 'vitest';
import { runQueuedAudit } from './audit-run';
import type { JobSnapshot } from './publish-result';

function sahte(durumlar: JobSnapshot[]) {
  let t = 0;
  let i = 0;
  const sorulan: string[] = [];
  return {
    sorulan,
    deps: {
      queue: async () => ({ id: 'job-1' }),
      getJob: async (id: string) => {
        sorulan.push(id);
        return durumlar[Math.min(i++, durumlar.length - 1)];
      },
    },
    opts: { sleep: async (ms: number) => { t += ms; }, now: () => t },
  };
}

describe('runQueuedAudit', () => {
  it('kuyruga atar, is bitince done doner', async () => {
    const s = sahte([{ status: 'QUEUED' }, { status: 'PROCESSING' }, { status: 'COMPLETED' }]);
    expect(await runQueuedAudit(s.deps, s.opts)).toEqual({ kind: 'done' });
    expect(s.sorulan).toEqual(['job-1', 'job-1', 'job-1']);
  });

  it('erisim engeli gibi kalici hata is kaydindaki metinle doner', async () => {
    const s = sahte([{ status: 'FAILED', error: 'Ana sayfa okunamadı', attempts: 3 }]);
    expect(await runQueuedAudit(s.deps, s.opts)).toEqual({ kind: 'failed', error: 'Ana sayfa okunamadı' });
  });

  it('ara deneme hatasi kesin sonuc sayilmaz; yeniden deneme basarirsa done', async () => {
    const s = sahte([{ status: 'FAILED', error: 'gecici', attempts: 1 }, { status: 'PROCESSING' }, { status: 'COMPLETED' }]);
    expect(await runQueuedAudit(s.deps, s.opts)).toEqual({ kind: 'done' });
  });

  it('metinsiz hata genel metne duser', async () => {
    const s = sahte([{ status: 'CANCELED' }]);
    expect(await runQueuedAudit(s.deps, s.opts)).toEqual({ kind: 'failed', error: 'Tarama başarısız' });
  });

  it('3,5 dakikalik tarama sure sinirina takilmaz', async () => {
    const durumlar: JobSnapshot[] = Array.from({ length: 30 }, () => ({ status: 'PROCESSING' }));
    let t = 0;
    const deps = {
      queue: async () => ({ id: 'job-1' }),
      getJob: async () => (t >= 210_000 ? { status: 'COMPLETED' } : durumlar[0]),
    };
    expect(await runQueuedAudit(deps, { sleep: async (ms) => { t += ms; }, now: () => t })).toEqual({ kind: 'done' });
  });

  it('sure dolarsa pending — tarama arka planda suruyor olabilir', async () => {
    const s = sahte([{ status: 'PROCESSING' }]);
    expect(await runQueuedAudit(s.deps, { ...s.opts, timeoutMs: 60_000 })).toEqual({ kind: 'pending' });
  });

  it('ekran kapandiysa yoklama durur', async () => {
    const s = sahte([{ status: 'PROCESSING' }]);
    expect(await runQueuedAudit(s.deps, { ...s.opts, isAlive: () => false })).toEqual({ kind: 'pending' });
    expect(s.sorulan).toEqual([]);
  });

  it('kuyruga atma hatasi firlatilir', async () => {
    const deps = { queue: async () => { throw new Error('Bu işlem için yetkin yok.'); }, getJob: async () => ({ status: 'COMPLETED' }) };
    await expect(runQueuedAudit(deps)).rejects.toThrow('Bu işlem için yetkin yok.');
  });
});
