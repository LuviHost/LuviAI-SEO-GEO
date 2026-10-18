/**
 * Takili sayfa kartinin dogrulugu — oneri "uygulandi" diye gosterilmez, kuyruktaki
 * yeniden yayin "duzeltildi" sayilmaz; toplu onarimda her sayfa kendi sonucuyla (atlandiysa
 * nedeniyle) serbest kalir.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 * (.mts: web tsconfig'in src/**\/*.ts deseni ve next build bu dosyayi almaz)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { republishBlockText } from '../../../api/src/audit/stuck-page-autopilot';
import {
  ARTICLE_PROPOSAL_NOTE, STUCK_BATCH_POLL_MS, STUCK_OUTCOME_TTL_MS, STUCK_POLL_BUDGET_KEY, STUCK_POLL_MAX_PER_MIN, batchRecoveryNotice,
  jobReasonText, pageOutcomeNote, pollStuckBatch, pruneBatchSelection, queuedBatchNotice, queuedBatchSettledNotice, queuedPageBaseline,
  queuedPageState, readBatchResponse, readStuckBatchStore, settleQueuedPage, sharedPollBudget, stuckBatchStoreKey, stuckBatchWatcher,
  stuckJobOutcome, stuckRecheckPages, stuckRecoveryCopy, stuckRecoveryKind, summarizeBatchRecovery, visiblePageOutcome,
  type BatchPageOutcome, type SettledPageInfo, type StoredPageOutcome, type TrackedQueuedPage,
} from './stuck-recovery';
import type { JobSnapshot } from './publish-result';

const kayit = [{ id: 'r1' }];

describe('stuckRecoveryKind', () => {
  it('makale onerisi (DETECTED + kayit) oneridir — eski kural articleId===null istiyordu', () => {
    expect(stuckRecoveryKind({ status: 'DETECTED', articleId: 'a1', recoveries: kayit })).toBe('proposal');
    expect(stuckRecoveryCopy('proposal', true).heading).toBe('Öneri');
    expect(stuckRecoveryCopy('proposal', true).editsLabel).toBe('Önerilen değişiklikler');
  });

  it('RanksUp disi sayfada RECOVERED disindaki her durum oneri', () => {
    for (const status of ['DETECTED', 'RECOVERING', 'FAILED', 'IGNORED']) {
      expect(stuckRecoveryKind({ status, articleId: null, recoveries: kayit })).toBe('proposal');
    }
    expect(stuckRecoveryKind({ status: 'RECOVERED', articleId: null, recoveries: kayit })).toBe('applied');
  });

  it('RECOVERED / REVERTED uygulanmis duzeltme', () => {
    expect(stuckRecoveryKind({ status: 'RECOVERED', articleId: 'a1', recoveries: kayit })).toBe('applied');
    expect(stuckRecoveryKind({ status: 'REVERTED', articleId: 'a1', recoveries: kayit })).toBe('applied');
    expect(stuckRecoveryCopy('applied', true)).toMatchObject({ heading: 'Son onarım', editsLabel: 'Uygulanan değişiklikler', note: null });
  });

  it('makalede RECOVERING bekleyen, FAILED belirsiz: ikisinde de "uygulandi" denmez', () => {
    expect(stuckRecoveryKind({ status: 'RECOVERING', articleId: 'a1', recoveries: kayit })).toBe('pending');
    expect(stuckRecoveryKind({ status: 'FAILED', articleId: 'a1', recoveries: kayit })).toBe('unknown');
    for (const kind of ['pending', 'unknown'] as const) {
      const c = stuckRecoveryCopy(kind, true);
      expect(c.heading).not.toBe('Son onarım');
      expect(c.editsLabel).not.toMatch(/Uygulanan/);
      expect(c.note).toBeTruthy();
    }
  });

  it('kayit yoksa tur yok', () => {
    expect(stuckRecoveryKind({ status: 'DETECTED', articleId: 'a1', recoveries: [] })).toBeNull();
    expect(stuckRecoveryKind({ status: 'RECOVERED', articleId: 'a1' })).toBeNull();
  });

  it('makale onerisinin notu yazinin degismedigini ve yayinlanmadigini soyler', () => {
    expect(stuckRecoveryCopy('proposal', true).note).toMatch(/yazıya uygulanmadı ve yayınlanmadı/);
    expect(stuckRecoveryCopy('proposal', false).note).toMatch(/sitene yazılmadı/);
  });
});

describe('S22 — makale onerisinin notu "RanksUp güncelleyemiyor" iddia etmez', () => {
  it('neden bilinmiyorsa not WordPress nedenlerini de sayar, yetenek siniri iddiasi yok', () => {
    const not = stuckRecoveryCopy('proposal', true).note!;
    expect(not).toBe(ARTICLE_PROPOSAL_NOTE);
    expect(not).not.toContain('güncelleyemiyor');
    expect(not).not.toContain('yayında olduğu yerde güncelleyemiyor');
    for (const parca of ['değiştirilmiş', 'takılı adresle eşleşmiyor', 'taslak', 'başka bir yazıyı gösteriyor', 'bulunamadı', 'üzerine yazmaz']) {
      expect(not, parca).toContain(parca);
    }
  });

  it('kesin neden biliniyorsa (is sonucu ya da "AI Duzelt" cevabi) not odur', () => {
    const neden = "Takılı adres, RanksUp'ın kayıtlı yayın adresiyle eşleşmiyor (kayıtlı: https://site.example/?p=41). Öneriler kaydedildi, yazı değiştirilmedi; Takılı Sayfalar ekranında Detay'dan görüp yazına elle uygula.";
    expect(stuckRecoveryCopy('proposal', true, neden).note).toBe(neden);
    expect(stuckRecoveryCopy('proposal', true, '   ').note).toBe(ARTICLE_PROPOSAL_NOTE);
  });
});

describe('summarizeBatchRecovery', () => {
  const durum = (m: Record<string, string>) => (id: string) => m[id];

  it('oneri (ok:false, hatasiz, DETECTED) basarisiz sayilmaz; kuyruktaki yayin duzeltildi sayilmaz', () => {
    const s = summarizeBatchRecovery(
      [{ id: 'p1', ok: true }, { id: 'p2', ok: false }, { id: 'p3', ok: false, error: 'ANTHROPIC_API_KEY eksik' }],
      durum({ p1: 'RECOVERING', p2: 'DETECTED', p3: 'DETECTED' }),
    );
    expect(s).toEqual({ queued: 1, recovered: 0, proposals: 1, failed: 1, notProcessed: 0, errors: ['ANTHROPIC_API_KEY eksik'] });
    const n = batchRecoveryNotice(s);
    expect(n.title).toContain('1 sayfada değişiklik yazıya uygulandı, yeniden yayın sırada');
    expect(n.title).toContain('1 sayfa için öneri kaydedildi');
    expect(n.title).toContain('1 sayfa düzeltilemedi');
    expect(n.title).not.toMatch(/\d+ sayfa düzeltildi/);
    expect(n.tone).toBe('warning');
    expect(n.description).toBe('ANTHROPIC_API_KEY eksik');
  });

  it('API manual gonderirse oneri; yayin bu arada basarisiz olduysa (FAILED) kuyrukta sayilmaz', () => {
    const s = summarizeBatchRecovery(
      [{ id: 'p1', ok: false, manual: true }, { id: 'p2', ok: true }, { id: 'p3', ok: true }, { id: 'p4', ok: false }],
      durum({ p1: 'FAILED', p2: 'FAILED', p3: 'RECOVERED', p4: 'FAILED' }),
    );
    expect(s).toMatchObject({ queued: 0, recovered: 1, proposals: 1, failed: 2 });
  });

  it('sinir ustundeki satir (notProcessed) "duzeltilemedi" sayilmaz, ayri ve uyari olarak soylenir', () => {
    const sinir = 'Tek seferde en fazla 50 sayfa onarılır; bu sayfa işlenmedi, tekrar deneyin.';
    const s = summarizeBatchRecovery(
      [{ id: 'a', ok: true }, { id: 'b', ok: false, notProcessed: true, error: sinir }, { id: 'c', ok: false, notProcessed: true, error: sinir }],
      durum({ a: 'RECOVERED', b: 'DETECTED', c: 'DETECTED' }),
    );
    expect(s).toEqual({ queued: 0, recovered: 1, proposals: 0, failed: 0, notProcessed: 2, errors: [] });
    const n = batchRecoveryNotice(s);
    expect(n.title).not.toMatch(/düzeltilemedi/);
    expect(n.title).toContain('2 sayfa işlenmedi');
    expect(n.tone).toBe('warning');
  });

  it('yanitin summary alani verilirse oneri / islenmeyen / basarisiz sayilari sunucudan; ok satirlari durumla ayrilir', () => {
    const s = summarizeBatchRecovery(
      [
        { id: 'a', ok: true }, { id: 'b', ok: true }, { id: 'c', ok: true },
        { id: 'd', ok: false, manual: true, reason: 'Ghost yerinde güncellenemiyor' },
        { id: 'e', ok: false, error: 'Sayfa okunamadı' },
        { id: 'f', ok: false, notProcessed: true, error: 'sınır' },
      ],
      durum({ a: 'RECOVERING', b: 'RECOVERED', c: 'FAILED', d: 'DETECTED', e: 'FAILED', f: 'DETECTED' }),
      { succeeded: 3, proposals: 1, failed: 1, notProcessed: 1 },
    );
    // c: sunucu "uygulandi" dedi ama yeniden yayin bu arada FAILED oldu (sayfa durumu daha yeni)
    expect(s).toEqual({ queued: 1, recovered: 1, proposals: 1, failed: 2, notProcessed: 1, errors: ['Sayfa okunamadı'] });
  });

  it('summary satir tahmininden onceliklidir (satirda isaret yoksa da sunucunun siniflamasi)', () => {
    const rows = [{ id: 'x', ok: false, error: 'Tek seferde en fazla 50 sayfa onarılır; bu sayfa işlenmedi, tekrar deneyin.' }];
    expect(summarizeBatchRecovery(rows, durum({ x: 'DETECTED' }))).toMatchObject({ failed: 1, notProcessed: 0 });
    expect(summarizeBatchRecovery(rows, durum({ x: 'DETECTED' }), { succeeded: 0, proposals: 0, failed: 0, notProcessed: 1 }))
      .toMatchObject({ failed: 0, notProcessed: 1 });
  });

  it('bicim disi summary yok sayilir (satirlardan hesaplanir)', () => {
    const rows = [{ id: 'a', ok: false, manual: true }];
    const s = summarizeBatchRecovery(rows, durum({ a: 'DETECTED' }), { succeeded: 0, proposals: -1, failed: 0, notProcessed: 0 });
    expect(s.proposals).toBe(1);
  });

  it('yalniz duzeltilen ve kuyruktaki sayfalar → basari; hepsi basarisiz → hata', () => {
    expect(batchRecoveryNotice(summarizeBatchRecovery([{ id: 'a', ok: true }], durum({ a: 'RECOVERED' }))))
      .toMatchObject({ tone: 'success', title: 'Toplu onarım: 1 sayfa düzeltildi' });
    expect(batchRecoveryNotice(summarizeBatchRecovery([{ id: 'a', ok: false, error: 'x' }], durum({ a: 'FAILED' }))).tone)
      .toBe('error');
    expect(batchRecoveryNotice(summarizeBatchRecovery([{ id: 'a', ok: false }], durum({ a: 'DETECTED' }))).tone)
      .toBe('info');
  });
});

describe('readBatchResponse — toplu onarim kuyruga alinir (sozlesme C4/D4)', () => {
  const zaten = 'Bu sayfa zaten işleniyor; yeni bir düzeltme başlatılmadı.';

  it('satirlar results altinda: normalize, is kimligi korunur (D4), ozet sunucudan (K1)', () => {
    const v = readBatchResponse({
      siteId: 's1',
      results: [
        { stuckPageId: 'a', queued: true, jobId: 'j1' },
        { stuckPageId: 'b', queued: true, jobId: 'j2' },
        { stuckPageId: 'c', queued: false, notProcessed: true, reason: zaten },
        { stuckPageId: 'd', queued: false, error: 'Takılı sayfa bulunamadı' },
      ],
      summary: { queued: 2, notProcessed: 1, failed: 1 },
    });
    expect(v).toEqual({
      kind: 'queued',
      rows: [
        { id: 'a', queued: true, notProcessed: false, message: null, jobId: 'j1', alreadyQueued: false },
        { id: 'b', queued: true, notProcessed: false, message: null, jobId: 'j2', alreadyQueued: false },
        { id: 'c', queued: false, notProcessed: true, message: zaten, jobId: null, alreadyQueued: false },
        { id: 'd', queued: false, notProcessed: false, message: 'Takılı sayfa bulunamadı', jobId: null, alreadyQueued: false },
      ],
      summary: { queued: 2, notProcessed: 1, failed: 1 },
    });
  });

  it('D4: zaten sirada olan sayfa bekleyen isin kimligiyle doner — panel onu da izler, "islenmedi" demez', () => {
    const sirada = 'Bu sayfa için bir düzeltme zaten sırada; ikinci kez kuyruğa alınmadı. Sonuç hazır olunca listede görünür.';
    const v = readBatchResponse({
      results: [
        { stuckPageId: 'a', queued: true, jobId: 'j1' },
        { stuckPageId: 'b', queued: false, notProcessed: true, code: 'already_queued', reason: sirada, jobId: 'j0' },
        { stuckPageId: 'c', queued: false, notProcessed: true, code: 'not_eligible', reason: 'Yazı çöp kutusunda.' },
      ],
      summary: { queued: 1, notProcessed: 2, failed: 0 },
    });
    if (v.kind !== 'queued') throw new Error('queued bekleniyordu');
    expect(v.rows[1]).toEqual({ id: 'b', queued: false, notProcessed: true, message: sirada, jobId: 'j0', alreadyQueued: true });
    expect(v.rows[2].alreadyQueued).toBe(false);
    expect(queuedBatchNotice(v)).toEqual({
      tone: 'warning',
      title: '1 sayfa sıraya alındı; her sayfanın sonucu hazır olunca kartında görünür',
      description: '1 sayfa zaten sıradaydı; ikinci kez sıraya alınmadı, sonucu kartında görünür · 1 sayfa işlenmedi: Yazı çöp kutusunda.',
    });
    const yalnizSirada = readBatchResponse({ results: [{ stuckPageId: 'b', queued: false, notProcessed: true, reason: sirada, jobId: 'j0' }], summary: { queued: 0, notProcessed: 1, failed: 0 } });
    if (yalnizSirada.kind !== 'queued') throw new Error('queued bekleniyordu');
    expect(queuedBatchNotice(yalnizSirada)).toMatchObject({ tone: 'info', title: 'Seçilen sayfalar zaten sırada' });
  });

  it('K1: gecerli sunucu ozeti satir tahmininden onceliklidir', () => {
    // Satirda isaret eksik (eski alan adi) ama sunucu "islenmedi" diye saydi
    const v = readBatchResponse({ results: [{ stuckPageId: 'a', queued: true }, { stuckPageId: 'b', queued: false, error: 'sınır' }], summary: { queued: 1, notProcessed: 1, failed: 0 } });
    expect(v).toMatchObject({ kind: 'queued', summary: { queued: 1, notProcessed: 1, failed: 0 } });
  });

  it('satirlar rows altinda da okunur; bicim disi ozet yok sayilip satirlardan sayilir; jobId yoksa null', () => {
    const v = readBatchResponse({ rows: [{ stuckPageId: 'a', queued: true }, { stuckPageId: 'b', queued: false, notProcessed: true }], summary: { queued: -1 } });
    expect(v).toMatchObject({ kind: 'queued', summary: { queued: 1, notProcessed: 1, failed: 0 } });
    if (v.kind !== 'queued') throw new Error('queued bekleniyordu');
    expect(v.rows[0].jobId).toBeNull();
  });

  it('eski senkron cevap (ok satirlari) taninir; sunucu ozeti summarizeBatchRecovery\'ye gider (K1)', () => {
    const v = readBatchResponse({
      siteId: 's1',
      results: [{ id: 'a', ok: true }, { id: 'b', ok: false, error: 'Tek seferde en fazla 50 sayfa onarılır; bu sayfa işlenmedi, tekrar deneyin.' }],
      summary: { succeeded: 1, proposals: 0, failed: 0, notProcessed: 1 },
    });
    if (v.kind !== 'legacy') throw new Error('legacy bekleniyordu');
    expect(v.summary).toEqual({ succeeded: 1, proposals: 0, failed: 0, notProcessed: 1 });
    // Satirda isaret yok ama sunucu "islenmedi" dedi: basarisiz sayilmaz
    const s = summarizeBatchRecovery(v.results, (id) => ({ a: 'RECOVERED', b: 'DETECTED' } as Record<string, string>)[id], v.summary);
    expect(s).toMatchObject({ recovered: 1, failed: 0, notProcessed: 1 });
  });

  it('bos cevap: ozetin bicimine gore; hicbiri yoksa sifir sayilarla kuyruk', () => {
    expect(readBatchResponse({ results: [], summary: { queued: 0, notProcessed: 3, failed: 0 } })).toMatchObject({ kind: 'queued', summary: { notProcessed: 3 } });
    expect(readBatchResponse({ results: [], summary: { succeeded: 0, proposals: 0, failed: 0, notProcessed: 0 } }).kind).toBe('legacy');
    expect(readBatchResponse(null)).toEqual({ kind: 'queued', rows: [], summary: { queued: 0, notProcessed: 0, failed: 0 } });
  });
});

describe('queuedBatchNotice — kuyruga alma bildirimi "duzeltildi" demez', () => {
  const v = (rows: Array<{ id: string; queued: boolean; notProcessed: boolean; message: string | null }>, summary: { queued: number; notProcessed: number; failed: number }) =>
    ({ kind: 'queued' as const, rows: rows.map((r) => ({ ...r, jobId: null, alreadyQueued: false })), summary });

  it('N sayfa sira; islenmeyenlerin nedeni API metniyle', () => {
    const n = queuedBatchNotice(v(
      [{ id: 'a', queued: true, notProcessed: false, message: null }, { id: 'b', queued: true, notProcessed: false, message: null },
        { id: 'c', queued: false, notProcessed: true, message: 'Bu sayfa zaten işleniyor.' }],
      { queued: 2, notProcessed: 1, failed: 0 },
    ));
    expect(n).toEqual({
      tone: 'warning',
      title: '2 sayfa sıraya alındı; her sayfanın sonucu hazır olunca kartında görünür',
      description: '1 sayfa işlenmedi: Bu sayfa zaten işleniyor.',
    });
    expect(n.title).not.toMatch(/düzeltildi/);
  });

  it('yalniz kuyruk → bilgi; hicbiri kuyruga alinamadi → hata; yalniz islenmeyen → uyari', () => {
    expect(queuedBatchNotice(v([{ id: 'a', queued: true, notProcessed: false, message: null }], { queued: 1, notProcessed: 0, failed: 0 })))
      .toEqual({ tone: 'info', title: '1 sayfa sıraya alındı; her sayfanın sonucu hazır olunca kartında görünür', description: undefined });
    expect(queuedBatchNotice(v([{ id: 'a', queued: false, notProcessed: false, message: 'Kuyruğa yazılamadı' }], { queued: 0, notProcessed: 0, failed: 1 })))
      .toEqual({ tone: 'error', title: 'Toplu onarım başlatılamadı', description: '1 sayfa sıraya alınamadı: Kuyruğa yazılamadı' });
    expect(queuedBatchNotice(v([{ id: 'a', queued: false, notProcessed: true, message: null }], { queued: 0, notProcessed: 1, failed: 0 })))
      .toMatchObject({ tone: 'warning', title: 'Toplu onarım: sıraya alınan sayfa yok', description: '1 sayfa işlenmedi' });
  });
});

describe('kuyruktaki sayfanin sonucu — liste ve is kaydi', () => {
  const base = queuedPageBaseline('p', { status: 'DETECTED', recoveries: [{ id: 'eski' }] });
  const satir = (status: string, recoveryId?: string) => ({ id: 'p', status, recoveries: recoveryId ? [{ id: recoveryId }] : [] });

  it('durum ve kayit degismediyse liste sonucu bilmiyor; RECOVERING + kayit yok = LLM calisiyor', () => {
    expect(base).toEqual({ id: 'p', status: 'DETECTED', recoveryId: 'eski' });
    expect(queuedPageState(base, satir('DETECTED', 'eski'))).toBe('waiting');
    expect(queuedPageState(base, satir('RECOVERING', 'eski'))).toBe('waiting');
  });

  it('yeni kayitla RECOVERING = yeniden yayin sirada; DETECTED = oneri; RECOVERED / FAILED kesin', () => {
    expect(queuedPageState(base, satir('RECOVERING', 'yeni'))).toBe('republishing');
    expect(queuedPageState(base, satir('DETECTED', 'yeni'))).toBe('proposal');
    expect(queuedPageState(base, satir('RECOVERED', 'yeni'))).toBe('recovered');
    expect(queuedPageState(base, satir('FAILED', 'eski'))).toBe('failed');
    expect(queuedPageState(base, satir('IGNORED', 'eski'))).toBe('other');
    expect(queuedPageState(base, undefined)).toBe('other');
  });

  it('is sonucu: atlama nedeni (D4), oneri, uygulama, hata; makine kodu Turkcesiyle, ham gosterilmez', () => {
    const tamam = (result: unknown): JobSnapshot => ({ status: 'COMPLETED', result });
    const bekleyen = 'Yazının onay bekleyen yeni bir sürümü var; önce onu onaylayın ya da reddedin. Hiçbir şey değiştirilmedi.';
    expect(stuckJobOutcome(tamam({ success: false, skipped: true, reason: bekleyen }))).toEqual({ kind: 'skipped', reason: bekleyen });
    expect(stuckJobOutcome(tamam({ skipped: true, reason: 'AI_GLOBAL_DISABLED' }))).toMatchObject({ kind: 'skipped', reason: expect.stringContaining('geçici olarak kapalı') });
    expect(stuckJobOutcome(tamam({ skipped: true, reason: 'STUCK_PAGE_NOT_FOUND' })).kind).toBe('skipped');
    expect(stuckJobOutcome(tamam({ skipped: true, reason: 'BILINMEYEN_KOD' }))).toEqual({ kind: 'skipped', reason: 'Sayfa bu işte işlenmedi; hiçbir şey değişmedi.' });
    expect(stuckJobOutcome(tamam({ success: false, manual: true, reason: 'Öneriler kaydedildi.' }))).toEqual({ kind: 'proposal', reason: 'Öneriler kaydedildi.' });
    expect(stuckJobOutcome(tamam({ success: true, needsRepublish: true }))).toEqual({ kind: 'applied' });
    expect(stuckJobOutcome(tamam({ success: false, reason: 'AI bu sayfa için değişiklik önerisi üretemedi.' }))).toEqual({ kind: 'failed', reason: 'AI bu sayfa için değişiklik önerisi üretemedi.' });
    expect(stuckJobOutcome({ status: 'FAILED', error: 'Sayfa okunamadı', attempts: 3 })).toEqual({ kind: 'failed', reason: 'Sayfa okunamadı' });
    expect(stuckJobOutcome({ status: 'CANCELED' }).kind).toBe('skipped');
    expect(stuckJobOutcome({ status: 'PROCESSING' }).kind).toBe('pending');
    expect(stuckJobOutcome(tamam({}))).toEqual({ kind: 'unrecognized' });
    expect(jobReasonText('AI_GLOBAL_DISABLED')).not.toContain('AI_GLOBAL_DISABLED');
  });

  it('worker\'in her atlama kodunun Turkcesi var (api stuck-page-autopilot.ts StuckRecoverSkipCode; kod ham gosterilmez)', () => {
    const src = readFileSync(fileURLToPath(new URL('../../../api/src/audit/stuck-page-autopilot.ts', import.meta.url)), 'utf8');
    const m = src.match(/export type StuckRecoverSkipCode\s*=\s*([^;]+);/);
    expect(m, 'StuckRecoverSkipCode bulunamadi').toBeTruthy();
    const kodlar = [...m![1].matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
    expect(kodlar.length).toBeGreaterThan(0);
    for (const k of kodlar) {
      const t = jobReasonText(k);
      expect(t, k).toBeTruthy();
      expect(t, k).not.toContain(k);
    }
  });

  it('is ve liste birlikte: uygulanan duzeltmede liste daha yeni (yayin bitti / basarisiz / yayin aninda oneriye dondu)', () => {
    expect(settleQueuedPage({ kind: 'applied' }, 'waiting')).toEqual({ kind: 'republishing' });
    expect(settleQueuedPage({ kind: 'applied' }, 'recovered')).toEqual({ kind: 'recovered' });
    expect(settleQueuedPage({ kind: 'applied' }, 'failed')).toEqual({ kind: 'failed', reason: null });
    expect(settleQueuedPage({ kind: 'applied' }, 'proposal')).toEqual({ kind: 'proposal', reason: null });
    expect(settleQueuedPage({ kind: 'skipped', reason: 'x' }, 'waiting')).toEqual({ kind: 'skipped', reason: 'x' });
    expect(settleQueuedPage({ kind: 'unrecognized' }, 'waiting')).toMatchObject({ kind: 'skipped' });
    expect(settleQueuedPage(null, 'waiting')).toBeNull();
    expect(settleQueuedPage(null, 'proposal')).toEqual({ kind: 'proposal', reason: null });
  });

  it('sonuc ozeti: "duzeltildi" yalniz RECOVERED icin; atlanan sayfa ve nedeni soylenir', () => {
    const n = queuedBatchSettledNotice([
      { kind: 'recovered' }, { kind: 'republishing' }, { kind: 'proposal', reason: 'x' },
      { kind: 'skipped', reason: 'Yazının onay bekleyen yeni bir sürümü var.' }, { kind: 'failed', reason: 'Sayfa okunamadı' },
    ]);
    expect(n.title).toBe('Toplu onarım sonucu: 1 sayfa düzeltildi, 1 sayfada değişiklik yazıya uygulandı, yeniden yayın sırada, 1 sayfa için öneri kaydedildi (yazı değişmedi, elle uygulanır), 1 sayfa işlenmedi (hiçbir şey değişmedi), 1 sayfa düzeltilemedi');
    expect(n.tone).toBe('warning');
    expect(n.description).toBe('İşlenmedi: Yazının onay bekleyen yeni bir sürümü var. · Düzeltilemedi: Sayfa okunamadı');
    expect(queuedBatchSettledNotice([{ kind: 'recovered' }, { kind: 'recovered' }]))
      .toEqual({ tone: 'success', title: 'Toplu onarım sonucu: 2 sayfa düzeltildi', description: undefined });
    expect(queuedBatchSettledNotice([{ kind: 'unknown' }]).title).toContain('sonucu henüz gelmedi');
  });

  it('kart notu: atlanan sayfanin nedeni; oneride neden Detay\'da (biliniyorsa)', () => {
    expect(pageOutcomeNote({ kind: 'skipped', reason: 'Yazı çöp kutusunda.' })).toEqual({ tone: 'warning', text: 'İşlenmedi. Yazı çöp kutusunda.' });
    expect(pageOutcomeNote({ kind: 'notProcessed', reason: null }).text).toBe('İşlenmedi; hiçbir şey değişmedi.');
    expect(pageOutcomeNote({ kind: 'proposal', reason: 'x' }).text).toContain('Nedeni');
    expect(pageOutcomeNote({ kind: 'proposal', reason: null }).text).not.toContain('Nedeni');
    expect(pageOutcomeNote({ kind: 'recovered' }).tone).toBe('success');
    expect(pageOutcomeNote({ kind: 'failed', reason: 'Sayfa okunamadı' }).text).toBe('Düzeltilemedi. Sayfa okunamadı');
  });
});

describe('pollStuckBatch — her sayfa kendi sonucuyla serbest kalir (S9/S13)', () => {
  function saat() {
    let t = 0;
    const uykular: number[] = [];
    return { now: () => t, sleep: async (ms: number) => { uykular.push(ms); t += ms; }, uykular };
  }
  const takip = (id: string, jobId: string | null): TrackedQueuedPage => ({ id, jobId, base: queuedPageBaseline(id, { status: 'DETECTED', recoveries: [] }) });

  it('S13: atlanan sayfa (liste degismez, is COMPLETED skipped) diger sayfayi bekletmez; nedeniyle kapanir, ozet hemen gelir', async () => {
    const s = saat();
    const neden = 'Yazının onay bekleyen yeni bir sürümü var; önce onu onaylayın ya da reddedin.';
    const kapanan: Array<[string, BatchPageOutcome, string | null]> = [];
    let ozet: ReadonlyMap<string, BatchPageOutcome> | null = null;
    const sonuc = await pollStuckBatch({
      pages: [takip('a', 'ja'), takip('b', 'jb')],
      now: s.now,
      sleep: s.sleep,
      // a: duzeltme yaziya uygulandi (RECOVERING + kayit); b: worker atladi, sayfa hic degismedi
      load: async () => [
        { id: 'a', status: 'RECOVERING', recoveries: [{ id: 'r1' }] },
        { id: 'b', status: 'DETECTED', recoveries: [] },
      ],
      getJob: async (id) => (id === 'jb'
        ? { status: 'COMPLETED', result: { success: false, skipped: true, reason: neden } }
        : { status: 'COMPLETED', result: { success: true, needsRepublish: true } }),
      onSettle: (id, o, st) => kapanan.push([id, o, st]),
      onAllSettled: (o) => { ozet = o; },
      timeoutMs: 10 * 60_000,
    });
    // a yeniden yayin sirasinda izlenmeye devam eder (sure dolunca doner); b nedeniyle kapandi
    expect(kapanan.find(([id]) => id === 'a')?.[1]).toEqual({ kind: 'republishing' });
    expect(kapanan.find(([id]) => id === 'b')).toEqual(['b', { kind: 'skipped', reason: neden }, 'DETECTED']);
    expect(ozet).not.toBeNull();
    expect([...ozet!.values()]).toEqual([{ kind: 'republishing' }, { kind: 'skipped', reason: neden }]);
    expect(queuedBatchSettledNotice(ozet!.values()).description).toBe(`İşlenmedi: ${neden}`);
    // Ozet ilk dakikada geldi (eskiden 15 dk sonra null donuyordu)
    const ozetAni = s.uykular.slice(0, 3).reduce((x, y) => x + y, 0);
    expect(ozetAni).toBeLessThan(60_000);
    expect(sonuc?.get('b')).toEqual({ kind: 'skipped', reason: neden });
  });

  it('AI_GLOBAL_DISABLED atlamasi da kapanir (Turkce neden); yeniden yayini biten sayfa "duzeltildi" olur', async () => {
    const s = saat();
    let n = 0;
    const kapanan = new Map<string, BatchPageOutcome>();
    const sonuc = await pollStuckBatch({
      pages: [takip('a', 'ja'), takip('b', 'jb')],
      now: s.now,
      sleep: s.sleep,
      load: async () => {
        n++;
        return [
          { id: 'a', status: n < 3 ? 'RECOVERING' : 'RECOVERED', recoveries: [{ id: 'r1' }] },
          { id: 'b', status: 'DETECTED', recoveries: [] },
        ];
      },
      getJob: async (id) => (id === 'jb' ? { status: 'COMPLETED', result: { skipped: true, reason: 'AI_GLOBAL_DISABLED' } } : { status: 'COMPLETED', result: { success: true } }),
      onSettle: (id, o) => kapanan.set(id, o),
    });
    expect(kapanan.get('a')).toEqual({ kind: 'recovered' });
    expect(kapanan.get('b')).toMatchObject({ kind: 'skipped', reason: expect.stringContaining('geçici olarak kapalı') });
    expect(sonuc?.size).toBe(2);
    expect(s.now()).toBeLessThan(60_000);
  });

  it('listede oneriye donen sayfanin kesin nedeni is sonucundan okunur (S22: kartta dogru neden)', async () => {
    const s = saat();
    const neden = "Takılı adres, RanksUp'ın kayıtlı yayın adresiyle eşleşmiyor. Öneriler kaydedildi, yazı değiştirilmedi.";
    const sonuc = await pollStuckBatch({
      pages: [takip('a', 'ja')],
      now: s.now,
      sleep: s.sleep,
      load: async () => [{ id: 'a', status: 'DETECTED', recoveries: [{ id: 'r1' }] }],
      getJob: async () => ({ status: 'COMPLETED', result: { success: false, manual: true, reason: neden } }),
    });
    expect(sonuc?.get('a')).toEqual({ kind: 'proposal', reason: neden });
  });

  it('ara deneme hatasi (FAILED, attempts < 3) kesin sayilmaz; yeniden deneme basarisi beklenir', async () => {
    const s = saat();
    let okuma = 0;
    const sonuc = await pollStuckBatch({
      pages: [takip('a', 'ja')],
      now: s.now,
      sleep: s.sleep,
      load: async () => [{ id: 'a', status: 'DETECTED', recoveries: [] }],
      getJob: async () => {
        okuma++;
        return okuma < 3 ? { status: 'FAILED', attempts: 1, error: 'gecici' } : { status: 'COMPLETED', result: { skipped: true, reason: 'Hiçbir şey değiştirilmedi.' } };
      },
    });
    expect(sonuc?.get('a')).toEqual({ kind: 'skipped', reason: 'Hiçbir şey değiştirilmedi.' });
  });

  it('is kimligi yoksa (eski API) yalniz listeden; sure dolunca bekleyen sayfa "sonuc henuz gelmedi" ile kapanir', async () => {
    const s = saat();
    const kapanan = new Map<string, BatchPageOutcome>();
    let ozetSayisi = 0;
    const sonuc = await pollStuckBatch({
      pages: [takip('a', null)],
      now: s.now,
      sleep: s.sleep,
      load: async () => [{ id: 'a', status: 'DETECTED', recoveries: [] }],
      onSettle: (id, o) => kapanan.set(id, o),
      onAllSettled: () => { ozetSayisi++; },
    });
    expect(kapanan.get('a')).toEqual({ kind: 'unknown' });
    expect(ozetSayisi).toBe(1);
    expect(sonuc?.get('a')).toEqual({ kind: 'unknown' });
    expect(s.now()).toBeGreaterThan(STUCK_BATCH_POLL_MS);
    expect(s.uykular[0]).toBe(5000);
    expect(s.uykular).toContain(10_000);
    expect(s.uykular[s.uykular.length - 1]).toBe(20_000);
  });

  it('istek butcesi: 50 sayfada bile dakikada en fazla 24 istek (API siniri dakikada 60)', async () => {
    const s = saat();
    const istekler: number[] = [];
    const pages = Array.from({ length: 50 }, (_, i) => takip(`p${i}`, `j${i}`));
    await pollStuckBatch({
      pages,
      now: s.now,
      sleep: s.sleep,
      load: async () => { istekler.push(s.now()); return pages.map((p) => ({ id: p.id, status: 'DETECTED', recoveries: [] })); },
      getJob: async () => { istekler.push(s.now()); return { status: 'QUEUED' }; },
      timeoutMs: 10 * 60_000,
    });
    for (let dk = 0; dk < 10; dk++) {
      const bu = istekler.filter((t) => t > dk * 60_000 && t <= (dk + 1) * 60_000).length;
      expect(bu, `${dk}. dakika`).toBeLessThanOrEqual(24);
    }
  });

  it('kendisinden sonra siraya alinan sayfa sonuclandiysa bekleyen sayfanin is kaydi once okunur', async () => {
    const s = saat();
    const okunan: string[] = [];
    let tur = 0;
    await pollStuckBatch({
      pages: [takip('a', 'ja'), takip('b', 'jb'), takip('c', 'jc'), takip('d', 'jd')],
      now: s.now,
      sleep: s.sleep,
      load: async () => {
        tur++;
        // 3. turdan itibaren c (a ve b'den sonra siraya alinmis) duzeltildi; digerleri degismedi
        return ['a', 'b', 'c', 'd'].map((id) => (id === 'c' && tur >= 3
          ? { id, status: 'RECOVERED', recoveries: [{ id: 'r' }] }
          : { id, status: 'DETECTED', recoveries: [] }));
      },
      getJob: async (id) => { okunan.push(id); return { status: 'QUEUED' }; },
      timeoutMs: 20_000,
    });
    // Ilk dakika turda bir okuma: 1. tur a, 2. tur b; 3. turda c sonuclandi — worker sirayla
    // calistigi icin c'den once siraya alinan a (hic okunmamis d'den once) yeniden okunur
    expect(okunan.slice(0, 3)).toEqual(['ja', 'jb', 'ja']);
  });

  it('sayfa kapaninca durur; bos liste hemen doner', async () => {
    let alive = true;
    const sonuc = await pollStuckBatch({ pages: [takip('a', 'ja')], sleep: async () => { alive = false; }, isAlive: () => alive, load: async () => [] });
    expect(sonuc).toBeNull();
    expect((await pollStuckBatch({ pages: [], load: async () => [] }))?.size).toBe(0);
  });
});

describe('S24 — sayfa yenilenince sirada bekleyen sayfalar ve son sonuclar', () => {
  const simdi = Date.parse('2026-10-18T12:00:00.000Z');
  const base = { id: 'a', status: 'DETECTED', recoveryId: null };

  it('suresi gecmemis kuyruk ve sonuclar geri gelir; bozuk / eski / gelecek tarihli kayit yok sayilir', () => {
    const raw = JSON.stringify({
      pages: [
        { id: 'a', jobId: 'ja', base, queuedAt: simdi - 60_000 },
        { id: 'eski', jobId: 'je', base: { ...base, id: 'eski' }, queuedAt: simdi - STUCK_BATCH_POLL_MS - 1 },
        { id: 'bozuk', jobId: 5, queuedAt: simdi },
        { id: 'gelecek', jobId: 'jg', base, queuedAt: simdi + 10 * 60_000 },
      ],
      outcomes: {
        b: { outcome: { kind: 'skipped', reason: 'Yazı çöp kutusunda.' }, status: 'DETECTED', at: simdi - 1000 },
        c: { outcome: { kind: 'recovered' }, status: 'RECOVERED', at: simdi - STUCK_OUTCOME_TTL_MS - 1 },
        d: { outcome: { kind: 'uydurma' }, status: 'DETECTED', at: simdi },
      },
    });
    const store = readStuckBatchStore(raw, simdi);
    expect(store.pages).toEqual([{ id: 'a', jobId: 'ja', base: { id: 'a', status: 'DETECTED', recoveryId: null }, queuedAt: simdi - 60_000 }]);
    expect(store.outcomes).toEqual({
      b: { outcome: { kind: 'skipped', reason: 'Yazı çöp kutusunda.' }, status: 'DETECTED', at: simdi - 1000 },
      // Yoklama siniri sayfa kapaliyken dolan sayfa artik dusmez: is kimligiyle 'unknown' olur,
      // yenilemede is kaydi bir kez okunur (S13 yan etkisi b)
      eski: {
        outcome: { kind: 'unknown' }, status: 'DETECTED', at: simdi - 1, recoveryId: null, jobId: 'je',
        base: { id: 'eski', status: 'DETECTED', recoveryId: null },
      },
    });
    expect(readStuckBatchStore('{bozuk', simdi)).toEqual({ pages: [], outcomes: {} });
    expect(readStuckBatchStore(null, simdi)).toEqual({ pages: [], outcomes: {} });
    expect(stuckBatchStoreKey('s1')).toBe('ranksup:stuck-batch:s1');
  });

  it('sonuc notu sayfanin durumu degisince gizlenir (or. yeniden yayin bitti, kullanici yeniden denedi)', () => {
    const kayitli = { outcome: { kind: 'republishing' } as BatchPageOutcome, status: 'RECOVERING', at: simdi };
    expect(visiblePageOutcome(kayitli, 'RECOVERING')).toEqual({ kind: 'republishing' });
    expect(visiblePageOutcome(kayitli, 'RECOVERED')).toBeNull();
    expect(visiblePageOutcome(undefined, 'DETECTED')).toBeNull();
    expect(visiblePageOutcome({ ...kayitli, status: null }, 'RECOVERED')).toEqual({ kind: 'republishing' });
  });
});

describe('pruneBatchSelection — hata sonrasi kor yeniden deneme yok (R14)', () => {
  it('artik uygun olmayan (isleniyor / duzeltildi / RanksUp disi) sayfalar secimden cikar', () => {
    const rows = [
      { id: 'a', status: 'DETECTED', articleId: 'x' },
      { id: 'b', status: 'RECOVERING', articleId: 'y' },
      { id: 'c', status: 'RECOVERED', articleId: 'z' },
      { id: 'd', status: 'DETECTED', articleId: null },
    ];
    expect([...pruneBatchSelection(['a', 'b', 'c', 'd', 'yok'], rows)]).toEqual(['a']);
  });
});

// ─────────────────────────────────────────────────────────────────────────
//  Dogrulama turu (rv15) yan etkileri — S22 ve S13 yeniden uretimleri
// ─────────────────────────────────────────────────────────────────────────

/** Gercek bekleme olmadan ilerleyen saat (tek dongu testleri) */
function sahteSaat(bas = 0) {
  let t = bas;
  return { now: () => t, sleep: async (ms: number) => { t += ms; } };
}

describe('S22 yan etkisi — oneri nedeni cumle ortasinda kesilmez, not her nedeni sayar, not kendi kaydina bagli', () => {
  // rv15 lengths: gercekci adresler (varsayilan WordPress taslak kurulumunda ?p= baglantisi)
  const ADRES = 'https://www.ornek-isletme-sitesi.com.tr/blog/kdv-beyannamesi-nasil-verilir-2026/';
  const ADRES2 = 'https://www.ornek-isletme-sitesi.com.tr/blog/kdv-beyannamesi-nasil-verilir/';
  const TASLAK = 'https://www.ornek-isletme-sitesi.com.tr/?p=1234';
  const BLOKLAR = [
    'create_only', 'unaddressable', 'slug_changed', 'target_missing', 'export_only', 'url_mismatch', 'draft_link',
    'live_copy_trashed', 'live_copy_missing', 'live_copy_edited', 'live_copy_mismatch', 'live_copy_stale',
  ] as const;
  const etiket = (b: string) => (b === 'url_mismatch' ? [ADRES, ADRES2] : b === 'draft_link' ? [TASLAK] : ['WordPress']);

  it('toplu yolda oneri nedeni API metninin TAMAMI ("…yazı değişt…" diye olumsuzlugun onunde kesilmez)', () => {
    const oneri = (reason: string): JobSnapshot => ({ status: 'COMPLETED', result: { success: false, manual: true, recoveryId: 'r1', reason } });
    // Varsayilan WordPress taslak kurulumunda metin eski 400 sinirini asiyordu
    expect(republishBlockText({ block: 'draft_link', labels: [TASLAK] }, 'proposal').length).toBeGreaterThan(400);
    for (const b of BLOKLAR) {
      const t = republishBlockText({ block: b, labels: etiket(b) }, 'proposal');
      const o = stuckJobOutcome(oneri(t));
      expect(o, b).toEqual({ kind: 'proposal', reason: t });
      expect(stuckRecoveryCopy('proposal', true, o.kind === 'proposal' ? o.reason : null).note, b).toContain('Öneriler kaydedildi, yazı değiştirilmedi;');
    }
  });

  it('kisaltilan neden (atlama, hata) cumle sinirinda biter; cumle sonu yoksa sozcuk sinirinda "…"', () => {
    for (const b of BLOKLAR) {
      for (const ctx of ['proposal', 'skip', 'autopilot', 'revert', 'republish'] as const) {
        const t = republishBlockText({ block: b, labels: etiket(b) }, ctx);
        const k = jobReasonText(t)!;
        expect(t.startsWith(k), `${b}/${ctx}`).toBe(true);
        expect(k.length, `${b}/${ctx}`).toBeLessThanOrEqual(400);
        if (k !== t) {
          expect(k, `${b}/${ctx}`).toMatch(/[.!?]$/);
          expect(t[k.length], `${b}/${ctx}`).toMatch(/\s/);
        }
      }
    }
    const tek = `Beklenmeyen yanıt ${'çok uzun bir açıklama metni '.repeat(30)}`;
    const k = jobReasonText(tek)!;
    expect(k.length).toBeLessThanOrEqual(400);
    expect(k.endsWith('…')).toBe(true);
    expect(tek.startsWith(k.slice(0, -1))).toBe(true);
    expect(tek[k.length - 1]).toMatch(/\s/);
  });

  it('notr not "son metin kopyaya yazılmadı" nedenini de sayar (live_copy_stale)', () => {
    expect(ARTICLE_PROPOSAL_NOTE).toContain('sitendeki kopyaya son metin yazılmamış (son yayında yazılamamış ya da o hedef seçilmemiş)');
    expect(stuckRecoveryCopy('proposal', true).note).toBe(ARTICLE_PROPOSAL_NOTE);
  });

  it('sonuc kendi kurtarma kaydina baglanir: baska cihazdan sonraki oneri onceki nedenle gosterilmez', async () => {
    const neden = republishBlockText({ block: 'draft_link', labels: [TASLAK] }, 'proposal');
    const s = sahteSaat();
    const bilgi = new Map<string, SettledPageInfo>();
    const sonuc = await pollStuckBatch({
      pages: ['a', 'b'].map((id) => ({ id, jobId: `j${id}`, base: queuedPageBaseline(id, { status: 'DETECTED', recoveries: [{ id: 'r0' }] }) })),
      now: s.now,
      sleep: s.sleep,
      // Yaris: liste isin actigi kaydi (r1) henuz gostermiyor, is kaydi ayni turda bitmis
      load: async () => [{ id: 'a', status: 'DETECTED', recoveries: [{ id: 'r0' }] }, { id: 'b', status: 'DETECTED', recoveries: [{ id: 'r0' }] }],
      getJob: async (j) => (j === 'ja'
        ? { status: 'COMPLETED', result: { success: false, manual: true, recoveryId: 'r1', reason: neden } }
        : { status: 'COMPLETED', result: { success: false, skipped: true, reason: 'Hiçbir şey değiştirilmedi.' } }),
      onSettle: (id, _o, _st, info) => bilgi.set(id, info),
    });
    expect(sonuc?.get('a')).toEqual({ kind: 'proposal', reason: neden });
    // Oneri isin actigi kayda (r1) baglanir; atlama kayit acmaz, listede gorulen son kayda (r0)
    expect(bilgi.get('a')?.recoveryId).toBe('r1');
    expect(bilgi.get('b')?.recoveryId).toBe('r0');
    const kayitli: StoredPageOutcome = { outcome: sonuc!.get('a')!, status: 'DETECTED', at: 1000, recoveryId: 'r1' };
    expect(visiblePageOutcome(kayitli, 'DETECTED', 'r1')).toEqual({ kind: 'proposal', reason: neden });
    // Baska cihazdan yeni oneri (r2): durum yine DETECTED ama not eskidi — notr nota duser
    expect(visiblePageOutcome(kayitli, 'DETECTED', 'r2')).toBeNull();
    // Eski bicim kayit (recoveryId yok) ya da cagiran son kaydi vermedi: denetlenmez
    expect(visiblePageOutcome({ outcome: kayitli.outcome, status: 'DETECTED', at: 1000 }, 'DETECTED', 'r2')).toEqual(kayitli.outcome);
    expect(visiblePageOutcome(kayitli, 'DETECTED')).toEqual(kayitli.outcome);
    // Kaydi olmayan sayfanin sonucu (null) sonradan acilan kayitla eskir
    expect(visiblePageOutcome({ ...kayitli, recoveryId: null }, 'DETECTED', 'r2')).toBeNull();
    // Depoya yazilip okununca baglanti korunur
    const geri = readStuckBatchStore(JSON.stringify({ pages: [], outcomes: { a: kayitli, b: { ...kayitli, recoveryId: null } } }), 2000);
    expect(geri.outcomes.a.recoveryId).toBe('r1');
    expect(geri.outcomes.b.recoveryId).toBeNull();
  });
});

describe('S13 yan etkisi a — site basina tek yoklayici; sekmeler ve gonderimler tek istek butcesinde', () => {
  afterEach(() => { vi.useRealTimers(); });

  /** Ortak sunucu: sayfa durumlari, is kayitlari ve TUM sekmelerin istek gunlugu (ayni IP) */
  function sunucu(ids: string[]) {
    const satirlar = new Map(ids.map((id) => [id, { id, status: 'DETECTED', recoveries: [] as Array<{ id: string }> }]));
    const isler = new Map<string, JobSnapshot>(ids.map((id) => [`j-${id}`, { status: 'QUEUED' }]));
    const istekler: number[] = [];
    return {
      istekler,
      load: async () => {
        istekler.push(Date.now());
        return [...satirlar.values()].map((r) => ({ ...r, recoveries: [...r.recoveries] }));
      },
      getJob: async (jobId: string) => {
        istekler.push(Date.now());
        return isler.get(jobId) ?? { status: 'QUEUED' };
      },
      /** Is kuyrugu bosaldi: cift sirali sayfa atlanir (liste degismez), tek sirali oneri olur */
      bitir() {
        ids.forEach((id, i) => {
          if (i % 2 === 0) {
            isler.set(`j-${id}`, { status: 'COMPLETED', result: { success: false, skipped: true, reason: 'Yazının onay bekleyen yeni bir sürümü var; hiçbir şey değiştirilmedi.' } });
          } else {
            satirlar.set(id, { id, status: 'DETECTED', recoveries: [{ id: `r-${id}` }] });
            isler.set(`j-${id}`, { status: 'COMPLETED', result: { success: false, manual: true, recoveryId: `r-${id}`, reason: 'Öneriler kaydedildi, yazı değiştirilmedi.' } });
          }
        });
      },
    };
  }
  /** Kayan 60 sn penceredeki en fazla istek (API ThrottlerModule: dakikada 60, IP basina) */
  function enFazlaDakika(zamanlar: number[]): number {
    const ts = [...zamanlar].sort((a, b) => a - b);
    let enCok = 0;
    for (let i = 0, j = 0; i < ts.length; i++) {
      while (j < ts.length && ts[j] - ts[i] < 60_000) j++;
      enCok = Math.max(enCok, j - i);
    }
    return enCok;
  }
  const izle = (ids: string[], queuedAt: number): TrackedQueuedPage[] =>
    ids.map((id) => ({ id, jobId: `j-${id}`, base: queuedPageBaseline(id, { status: 'DETECTED', recoveries: [] }), queuedAt }));
  /** localStorage yerine: sekmeler arasi paylasilan depo */
  function depo() {
    const veri = new Map<string, string>();
    return { veri, getItem: (k: string) => veri.get(k) ?? null, setItem: (k: string, v: string) => { veri.set(k, v); } };
  }
  async function ilerle(ms: number, dur?: () => boolean) {
    for (let t = 0; t < ms && !(dur?.() ?? false); t += 1000) await vi.advanceTimersByTimeAsync(1000);
  }

  it('rv15 throttle: 100 satirda iki kez "Tümünü seç" — ikinci gonderim calisan donguye katilir, dakikada en fazla 24 istek; ozet bir kez', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(Date.parse('2026-10-19T08:00:00.000Z'));
    const ids = Array.from({ length: 100 }, (_, i) => `p${i}`);
    const s = sunucu(ids);
    const kapanan = new Map<string, BatchPageOutcome>();
    const ozetler: number[] = [];
    const w = stuckBatchWatcher({ load: s.load, getJob: s.getJob, onSettle: (id, o) => kapanan.set(id, o), onAllSettled: (m) => ozetler.push(m.size) });
    // API tek istekte ilk 50 sayfayi alir: ikinci gonderim ilk grup beklerken
    w.add(izle(ids.slice(0, 50), Date.now()));
    await ilerle(10_000);
    w.add(izle(ids.slice(50), Date.now()));
    // Is kuyrugu baska islerle 8 dk dolu (oncelik 50 isler bekler)
    await ilerle(8 * 60_000);
    s.bitir();
    await ilerle(20 * 60_000, () => !w.running);
    // Eskiden her gonderim kendi dongusunu calistiriyordu: dakikada ~47 istek
    expect(enFazlaDakika(s.istekler)).toBeLessThanOrEqual(STUCK_POLL_MAX_PER_MIN);
    expect(kapanan.size).toBe(100);
    expect(kapanan.get('p0')).toMatchObject({ kind: 'skipped' });
    expect(kapanan.get('p1')).toMatchObject({ kind: 'proposal' });
    expect(w.running).toBe(false);
    expect(ozetler).toEqual([100]);
  });

  it('rv15 throttle: ikinci sekme ilk grubu geri yukleyip izlese de toplam dakikada en fazla 24 istek; iki sekme de sonuca ulasir', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(Date.parse('2026-10-19T08:00:00.000Z'));
    const ids = Array.from({ length: 100 }, (_, i) => `p${i}`);
    const s = sunucu(ids);
    const ortak = depo();
    const A = new Map<string, BatchPageOutcome>();
    const B = new Map<string, BatchPageOutcome>();
    const wA = stuckBatchWatcher({ load: s.load, getJob: s.getJob, budget: sharedPollBudget(ortak), onSettle: (id, o) => A.set(id, o) });
    const wB = stuckBatchWatcher({ load: s.load, getJob: s.getJob, budget: sharedPollBudget(ortak), onSettle: (id, o) => B.set(id, o) });
    const t0 = Date.now();
    wA.add(izle(ids.slice(0, 50), t0));
    // Ikinci sekme ayni depodan ilk grubu geri yukledi (kuyruga alinma ani korunur)
    wB.add(izle(ids.slice(0, 50), t0));
    await ilerle(10_000);
    wA.add(izle(ids.slice(50), Date.now()));
    await ilerle(8 * 60_000);
    s.bitir();
    await ilerle(20 * 60_000, () => !wA.running && !wB.running);
    // Eskiden: iki gonderim + ikinci sekme dakikada ~70 istek
    expect(enFazlaDakika(s.istekler)).toBeLessThanOrEqual(STUCK_POLL_MAX_PER_MIN);
    expect(A.size).toBe(100);
    expect(B.size).toBe(50);
    expect(JSON.parse(ortak.veri.get(STUCK_POLL_BUDGET_KEY) ?? '[]').length).toBeLessThanOrEqual(STUCK_POLL_MAX_PER_MIN);
  });

  it('sharedPollBudget: sekmeler ayni depoyu paylasir, pencere kayar; bozuk deger kilitlemez; depo hata verirse sekme ici sayac', () => {
    const ortak = depo();
    const a = sharedPollBudget(ortak, { limit: 3 });
    const b = sharedPollBudget(ortak, { limit: 3 });
    expect([a.take(0), b.take(1), a.take(2), b.take(3)]).toEqual([true, true, true, false]);
    // Ilk istek (0) 60 sn penceresinden cikti
    expect(b.take(60_000)).toBe(true);
    ortak.setItem(STUCK_POLL_BUDGET_KEY, '{bozuk');
    expect(a.take(70_000)).toBe(true);
    ortak.setItem(STUCK_POLL_BUDGET_KEY, JSON.stringify([9e15, 9e15, 9e15]));
    expect(a.take(80_000)).toBe(true);
    const hatali = { getItem: (): string | null => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('QuotaExceededError'); } };
    const c = sharedPollBudget(hatali, { limit: 2 });
    expect([c.take(0), c.take(1), c.take(2)]).toEqual([true, true, false]);
    const d = sharedPollBudget(null, { limit: 1 });
    expect([d.take(0), d.take(1), d.take(60_000)]).toEqual([true, false, true]);
  });

  it('geri yuklenen sayfanin 30 dk siniri kuyruga alindigi andan sayilir (yenileme yeni 30 dk baslatmaz)', async () => {
    const s = sahteSaat(40 * 60_000);
    const bilgi: SettledPageInfo[] = [];
    const sonuc = await pollStuckBatch({
      pages: [{ id: 'a', jobId: 'ja', base: queuedPageBaseline('a', { status: 'DETECTED', recoveries: [] }), queuedAt: 40 * 60_000 - 29 * 60_000 }],
      now: s.now,
      sleep: s.sleep,
      load: async () => [{ id: 'a', status: 'DETECTED', recoveries: [] }],
      getJob: async () => ({ status: 'QUEUED' }),
      onSettle: (_id, _o, _st, info) => bilgi.push(info),
    });
    expect(sonuc?.get('a')).toEqual({ kind: 'unknown' });
    expect(s.now() - 40 * 60_000).toBeLessThanOrEqual(90_000);
    // Yenilemede yeniden okunabilsin diye is kimligi ve taban sonucla gelir
    expect(bilgi[0]).toMatchObject({ jobId: 'ja', base: { id: 'a', status: 'DETECTED', recoveryId: null }, recheck: false });
  });
});

describe('S13 yan etkisi b — "sayfayı yenileyince güncel durumu görürsün": yenilemede is kaydi yeniden okunur', () => {
  const NEDEN = 'Yazının onay bekleyen yeni bir sürümü var; önce onu onaylayın ya da reddedin. Hiçbir şey değiştirilmedi.';
  /** page.tsx recordOutcome ile ayni kural: yenileme okumasi yine 'unknown' bulursa eski kayit kalir */
  function kaydedici(now: () => number) {
    const depoSonuc: Record<string, StoredPageOutcome> = {};
    const kaydet = (id: string, outcome: BatchPageOutcome, status: string | null, info: SettledPageInfo) => {
      if (info.recheck && outcome.kind === 'unknown') return;
      depoSonuc[id] = {
        outcome, status, at: now(), recoveryId: info.recoveryId,
        ...(outcome.kind === 'unknown' && info.jobId ? { jobId: info.jobId, base: info.base } : {}),
      };
    };
    return { depoSonuc, kaydet };
  }

  it('rv15 unknown: is kuyrugu 35 dk dolu, 10 sayfa 30 dk sonunda "henuz gelmedi"; p3 sonradan atlaninca yenilemede nedeni gorunur', async () => {
    const s = sahteSaat();
    const ids = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const isler = new Map<string, JobSnapshot>(ids.map((id) => [`j-${id}`, { status: 'QUEUED' }]));
    const satirlar = ids.map((id) => ({ id, status: 'DETECTED', recoveries: [] as Array<{ id: string }> }));
    const { depoSonuc, kaydet } = kaydedici(s.now);
    const ilk = await pollStuckBatch({
      pages: ids.map((id) => ({ id, jobId: `j-${id}`, base: queuedPageBaseline(id, { status: 'DETECTED', recoveries: [] }), queuedAt: 0 })),
      now: s.now,
      sleep: s.sleep,
      load: async () => satirlar,
      getJob: async (j) => isler.get(j)!,
      onSettle: kaydet,
    });
    expect([...ilk!.values()].every((o) => o.kind === 'unknown')).toBe(true);
    expect(pageOutcomeNote({ kind: 'unknown' }).text).toBe('Sonuç henüz gelmedi; sayfayı yenileyince güncel durumu görürsün.');
    const ilkAn = depoSonuc.p0.at;
    // p3'un isi sonradan calisti ve atlandi (onay bekleyen surum); liste hic degismedi
    isler.set('j-p3', { status: 'COMPLETED', result: { success: false, skipped: true, reason: NEDEN } });
    // 10 dk sonra sayfa yenilendi
    const yenileme = s.now() + 10 * 60_000;
    const store = readStuckBatchStore(JSON.stringify({ pages: [], outcomes: depoSonuc }), yenileme);
    const tekrar = stuckRecheckPages(store.outcomes);
    expect(tekrar.map((p) => p.id).sort()).toEqual([...ids].sort());
    const s2 = sahteSaat(yenileme);
    const okunan: string[] = [];
    const ikinci = await pollStuckBatch({
      pages: tekrar,
      now: s2.now,
      sleep: s2.sleep,
      load: async () => satirlar,
      getJob: async (j) => { okunan.push(j); return isler.get(j)!; },
      onSettle: kaydet,
    });
    expect(ikinci?.get('p3')).toEqual({ kind: 'skipped', reason: NEDEN });
    const kart = visiblePageOutcome(depoSonuc.p3, 'DETECTED', null);
    expect(kart).toEqual({ kind: 'skipped', reason: NEDEN });
    expect(pageOutcomeNote(kart!).text).toBe(`İşlenmedi. ${NEDEN}`);
    // Hala sirada olanlar: kayit (ilk zamani ve is kimligiyle) aynen kalir; her is TEK kez okundu
    expect(depoSonuc.p0).toMatchObject({ outcome: { kind: 'unknown' }, jobId: 'j-p0', at: ilkAn });
    expect(ilkAn).toBeGreaterThan(STUCK_BATCH_POLL_MS);
    expect(okunan).toHaveLength(10);
    expect(new Set(okunan).size).toBe(10);
    expect(s2.now() - yenileme).toBeLessThan(2 * 60_000);
  });

  it('sayfa kapaliyken 30 dk dolan sirali sayfa da yenilemede okunur; 2,5 saatten eski ya da is kimliksiz olan okunmaz', async () => {
    const simdi = Date.parse('2026-10-18T12:00:00.000Z');
    const base = { id: 'a', status: 'DETECTED', recoveryId: 'r0' };
    const raw = JSON.stringify({ pages: [{ id: 'a', jobId: 'ja', base, queuedAt: simdi - 45 * 60_000 }], outcomes: {} });
    const store = readStuckBatchStore(raw, simdi);
    expect(store.pages).toEqual([]);
    expect(store.outcomes.a).toEqual({ outcome: { kind: 'unknown' }, status: 'DETECTED', at: simdi - 15 * 60_000, recoveryId: 'r0', jobId: 'ja', base });
    const s = sahteSaat(simdi);
    const { depoSonuc, kaydet } = kaydedici(s.now);
    const neden = 'Yazının sitendeki kopyası (WordPress) RanksUp\'ın son yayınından sonra sitende değiştirilmiş. Öneriler kaydedildi, yazı değiştirilmedi.';
    await pollStuckBatch({
      pages: stuckRecheckPages(store.outcomes),
      now: s.now,
      sleep: s.sleep,
      load: async () => [{ id: 'a', status: 'DETECTED', recoveries: [{ id: 'r1' }] }],
      getJob: async () => ({ status: 'COMPLETED', result: { success: false, manual: true, recoveryId: 'r1', reason: neden } }),
      onSettle: kaydet,
    });
    expect(depoSonuc.a).toMatchObject({ outcome: { kind: 'proposal', reason: neden }, recoveryId: 'r1' });
    expect(visiblePageOutcome(depoSonuc.a, 'DETECTED', 'r1')).toEqual({ kind: 'proposal', reason: neden });
    const cokEski = simdi - STUCK_BATCH_POLL_MS - STUCK_OUTCOME_TTL_MS - 1;
    expect(readStuckBatchStore(JSON.stringify({ pages: [{ id: 'a', jobId: 'ja', base, queuedAt: cokEski }], outcomes: {} }), simdi).outcomes).toEqual({});
    expect(readStuckBatchStore(JSON.stringify({ pages: [{ id: 'a', jobId: null, base, queuedAt: simdi - 45 * 60_000 }], outcomes: {} }), simdi).outcomes).toEqual({});
    // Baska sekmede zaten sonuclanmis sayfa: o sonuc korunur, yeniden okunmaz
    const sonuclu = readStuckBatchStore(JSON.stringify({
      pages: [{ id: 'a', jobId: 'ja', base, queuedAt: simdi - 45 * 60_000 }],
      outcomes: { a: { outcome: { kind: 'recovered' }, status: 'RECOVERED', at: simdi - 60_000 } },
    }), simdi);
    expect(sonuclu.outcomes.a.outcome).toEqual({ kind: 'recovered' });
    expect(stuckRecheckPages(sonuclu.outcomes)).toEqual([]);
    // Hala sirada izlenen sayfa (tutarsiz depo): tek okuma izlemenin yerine gecmez
    expect(stuckRecheckPages(store.outcomes, [{ id: 'a' }])).toEqual([]);
    expect(stuckRecheckPages(store.outcomes, [{ id: 'b' }]).map((p) => p.id)).toEqual(['a']);
  });
});
