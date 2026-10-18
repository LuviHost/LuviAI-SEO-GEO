/**
 * Yayin sonucu gercege gore gosterilir: hedef hatasi ve kopya acilmamasi icin
 * atlanan yayin (skipped) API metniyle; ara deneme hatasi kesin sonuc sayilmaz.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { describe, expect, it } from 'vitest';
import {
  JOB_RETRY_GRACE_MS, overwriteRemoteEditsConfirm, pollJob, publishJobOutcome, publishOutcomeNotices, publishOutcomeView,
  publishedEntryView, rememberRemoteSkips, skipReasonText, type JobSnapshot, type PublishTargetResult,
} from './publish-result';

const ad = (r: PublishTargetResult) => ({ t1: 'Blog (WordPress)', t2: 'Sunucu (FTP)' } as Record<string, string>)[r.targetId] ?? r.targetId;

describe('publishOutcomeNotices', () => {
  it('atlanan hedef API metniyle uyari olur — genel "basarisiz" degil', () => {
    const metin = 'Bu yazı Ghost üzerinde zaten yayında. Bu yayın hedefi mevcut yazıyı yerinde güncelleyemediği için kopya açılmadı; güncel metni Ghost panelinden elle güncelleyin.';
    const notices = publishOutcomeNotices(
      publishJobOutcome({ status: 'COMPLETED', result: [{ targetId: 't1', targetType: 'GHOST', ok: false, error: metin, skipped: 'already_live_create_only' }] }),
      ad,
    );
    expect(notices).toEqual([{ tone: 'warning', title: 'Blog (WordPress): yeniden yayınlanmadı', description: `Blog (WordPress): ${metin}` }]);
  });

  it('hedef hatasi metni oldugu gibi; basarili hedef ayri, eylemiyle', () => {
    const notices = publishOutcomeNotices(
      publishJobOutcome({
        status: 'COMPLETED',
        result: [
          { targetId: 't1', targetType: 'WORDPRESS_REST', ok: true, externalUrl: 'https://ornek.com/yazi/', action: 'updated' },
          { targetId: 't2', targetType: 'FTP', ok: false, error: 'FTP bağlantısı reddedildi (530 Login incorrect)' },
        ],
      }),
      ad,
    );
    expect(notices).toEqual([
      { tone: 'success', title: '1 hedefte yayınlandı: Blog (WordPress) (yerinde güncellendi)' },
      { tone: 'error', title: 'Sunucu (FTP): yayınlanamadı', description: 'Sunucu (FTP): FTP bağlantısı reddedildi (530 Login incorrect)' },
    ]);
  });

  it('hepsi basariliysa tek basari bildirimi', () => {
    expect(publishOutcomeNotices(publishJobOutcome({ status: 'COMPLETED', result: [{ targetId: 't2', ok: true }] }), ad))
      .toEqual([{ tone: 'success', title: 'Yayınlandı: Sunucu (FTP)' }]);
  });

  it('is basarisizsa hata metni (QA_BLOCKED oneki atilarak) gosterilir', () => {
    expect(publishOutcomeNotices(publishJobOutcome({ status: 'FAILED', error: 'QA_BLOCKED: Yayin engellendi — kaynaksiz istatistik' }), ad))
      .toEqual([{ tone: 'error', title: 'Yayınlanamadı', description: 'Yayin engellendi — kaynaksiz istatistik' }]);
  });

  it('hedef yoksa (bos dizi) "yayinlandi" denmez; zaman asiminda "suruyor"', () => {
    expect(publishOutcomeNotices(publishJobOutcome({ status: 'COMPLETED', result: [] }), ad)[0].tone).toBe('error');
    expect(publishOutcomeNotices(publishJobOutcome({ status: 'COMPLETED', result: {} }), ad)[0].tone).toBe('error');
    expect(publishOutcomeNotices(publishJobOutcome(null), ad)[0]).toMatchObject({ tone: 'info', title: 'Yayın sürüyor' });
    expect(publishOutcomeNotices(publishJobOutcome({ status: 'CANCELED' }), ad)[0].tone).toBe('info');
  });
});

describe('C2 — WordPress\'te elle duzenlenmis / kimligi tutmayan canli kopya', () => {
  const duzenlendi = "Bu yazı WordPress üzerinde, RanksUp'ın son yazımından sonra değiştirilmiş: orada düzenlenmiş olabilir. Yapılan değişikliklerin üzerine yazılmadı ve kopya açılmadı.";
  const tutmuyor = 'WordPress üzerinde kayıtlı yazı kimliği (#41) artık bu yazıya ait görünmüyor. Başka bir yazının üzerine yazmamak için güncellenmedi ve kopya açılmadı.';
  const edited: PublishTargetResult = { targetId: 't1', targetType: 'WORDPRESS_REST', ok: false, skipped: 'live_entry_edited', error: duzenlendi };
  const mismatch: PublishTargetResult = { targetId: 't1', targetType: 'WORDPRESS_REST', ok: false, skipped: 'live_entry_mismatch', error: tutmuyor };

  it('live_entry_edited ayri bildirimde (uzerine yazma eylemi baglanir), API metni oldugu gibi', () => {
    const v = publishOutcomeView(publishJobOutcome({ status: 'COMPLETED', result: [edited] }), ad);
    expect(v.notices).toEqual([]);
    expect(v.remoteEdited?.results).toEqual([edited]);
    expect(v.remoteEdited?.notice).toEqual({
      tone: 'warning',
      title: 'Blog (WordPress): WordPress’te düzenlenmiş, üzerine yazılmadı',
      description: `Blog (WordPress): ${duzenlendi}`,
    });
  });

  it('live_entry_mismatch genel uyarida, API metniyle; uzerine yazma SUNULMAZ', () => {
    const v = publishOutcomeView(publishJobOutcome({ status: 'COMPLETED', result: [mismatch] }), ad);
    expect(v.remoteEdited).toBeNull();
    expect(v.notices).toEqual([{ tone: 'warning', title: 'Blog (WordPress): yeniden yayınlanmadı', description: `Blog (WordPress): ${tutmuyor}` }]);
  });

  it('bir hedef yazildi, digeri duzenleme yuzunden atlandi: "Yayinlandi" (hepsi) denmez', () => {
    const v = publishOutcomeView(publishJobOutcome({ status: 'COMPLETED', result: [edited, { targetId: 't2', targetType: 'FTP', ok: true, action: 'overwritten' }] }), ad);
    expect(v.notices).toEqual([{ tone: 'success', title: '1 hedefte yayınlandı: Sunucu (FTP) (üzerine yazıldı)' }]);
    expect(v.remoteEdited?.results.map((r) => r.targetId)).toEqual(['t1']);
    // Eylem baglamayan cagiran icin tek liste: hicbir sonuc kaybolmaz
    expect(publishOutcomeNotices(publishJobOutcome({ status: 'COMPLETED', result: [edited] }), ad)).toHaveLength(1);
  });

  it('API metni yoksa genel karsilik', () => {
    expect(skipReasonText({ targetId: 't1', ok: false, skipped: 'live_entry_edited' })).toContain('üzerine yazmadı');
    expect(skipReasonText({ targetId: 't1', ok: false, skipped: 'live_entry_mismatch' })).toContain('kopya açmadı');
  });

  it('onay penceresi musterinin WordPress duzenlemelerinin gidecegini acikca soyler', () => {
    const c = overwriteRemoteEditsConfirm(['Blog']);
    expect(c.title).toBe('WordPress’teki değişikliklerin üzerine yazılsın mı?');
    expect(c.description).toContain('Blog hedefindeki yazı');
    expect(c.description).toContain('WordPress’te yapılan değişiklikler yazıdan çıkar');
    expect(c.confirmLabel).toBe('Üzerine yaz');
  });

  it('hafiza: secilmedigi icin yazilmayan hedef (D1) onceki C2 kaydini silmez — yayinci o kopyaya bakmadi', () => {
    const m = rememberRemoteSkips({}, [edited], false);
    const secilmedi: PublishTargetResult = { targetId: 't1', targetType: 'WORDPRESS_REST', ok: false, skipped: 'live_target_not_selected', error: 'seçilmedi' };
    expect(rememberRemoteSkips(m, [secilmedi, { targetId: 't2', ok: true }], false)).toEqual(m);
  });

  it('hafiza: yalniz EN SON C2 ile atlanan hedef; ayni hedefe yazilinca ya da baska sonuc gelince silinir', () => {
    let m = rememberRemoteSkips({}, [edited, { targetId: 't2', ok: true }], true);
    expect(m).toEqual({ t1: { skipped: 'live_entry_edited', text: duzenlendi, overrideQa: true } });
    // Baska hedefe yayin t1 kaydini silmez
    m = rememberRemoteSkips(m, [{ targetId: 't2', ok: true }], false);
    expect(Object.keys(m)).toEqual(['t1']);
    // Uzerine yazma basarili: kayit silinir
    expect(rememberRemoteSkips(m, [{ targetId: 't1', ok: true, action: 'updated' }], false)).toEqual({});
    // Kimlik tutmuyor: uzerine yazma eylemi yok, metin hatirlanir
    expect(rememberRemoteSkips(m, [mismatch], false).t1).toEqual({ skipped: 'live_entry_mismatch', text: tutmuyor, overrideQa: false });
    // Baska bir atlama (or. cop kutusu) gelince eski C2 kaydi kalkar
    expect(rememberRemoteSkips(m, [{ targetId: 't1', ok: false, skipped: 'live_entry_trashed', error: 'çöp' }], false)).toEqual({});
  });
});

describe('D1 — musterinin secmedigi canli kopya (live_target_not_selected)', () => {
  // API metni (republish-policy.ts publishSkipText): eski metni gosteriyorsa isaretlendigini soyler
  const metin = "Bu yazı WordPress üzerinde de yayında, ancak bu yayında WordPress seçilmediği için oraya yazılmadı ve oradaki kopyaya dokunulmadı. Oradaki kopya eski metni gösteriyor ve elle güncelleme bekliyor diye işaretlendi.";
  const secilmedi: PublishTargetResult = { targetId: 't1', targetType: 'WORDPRESS_REST', ok: false, skipped: 'live_target_not_selected', error: metin };
  const zip: PublishTargetResult = { targetId: 't2', targetType: 'MARKDOWN_ZIP', ok: true, action: 'exported' };

  it('ayri bildirimde (bilgi), API metniyle; secilen her hedef yazildiysa baslik "Yayınlandı" kalir, "yeniden yayınlanmadı" uyarisi yok', () => {
    const v = publishOutcomeView(publishJobOutcome({ status: 'COMPLETED', result: [zip, secilmedi] }), ad);
    expect(v.notices).toEqual([{ tone: 'success', title: 'Yayınlandı: Sunucu (FTP) (dışa aktarıldı)' }]);
    expect(v.notSelected?.results).toEqual([secilmedi]);
    expect(v.notSelected?.notice).toEqual({
      tone: 'info',
      title: 'Blog (WordPress): seçilmediği için bu yayında güncellenmedi',
      description: `Blog (WordPress): ${metin}`,
    });
    expect(v.remoteEdited).toBeNull();
    // Tek listede de kaybolmaz
    expect(publishOutcomeNotices(publishJobOutcome({ status: 'COMPLETED', result: [zip, secilmedi] }), ad)).toHaveLength(2);
  });

  it('yalniz secilmeyen kopya raporlandiysa (secilen hedef bulunamadi) "hicbir hedefe gonderilmedi" denir', () => {
    const v = publishOutcomeView(publishJobOutcome({ status: 'COMPLETED', result: [secilmedi] }), ad);
    expect(v.notices[0]).toMatchObject({ tone: 'error', title: 'Yazı hiçbir yayın hedefine gönderilmedi' });
    expect(v.notSelected).toBeNull();
  });

  it('API metni yoksa genel karsilik eskilik iddia etmez', () => {
    const t = skipReasonText({ targetId: 't1', ok: false, skipped: 'live_target_not_selected' });
    expect(t).toContain('seçilmedi');
    expect(t).not.toContain('eski');
  });
});

describe('pollJob', () => {
  /** Sahte saat: sleep zamani ilerletir, getJob sirayla anlik goruntu doner */
  function sahte(seri: JobSnapshot[]) {
    let t = 0;
    let i = 0;
    return {
      opts: { sleep: async (ms: number) => { t += ms; }, now: () => t },
      getJob: async () => seri[Math.min(i++, seri.length - 1)],
      cagri: () => i,
    };
  }

  it('ara deneme hatasi (FAILED, attempts < 3) kesin sonuc sayilmaz; yeniden deneme basarisi beklenir', async () => {
    const s = sahte([
      { status: 'PROCESSING' },
      { status: 'FAILED', attempts: 1, error: 'gecici' },
      { status: 'PROCESSING', attempts: 1 },
      { status: 'COMPLETED', attempts: 1, result: [{ targetId: 't1', ok: true }] },
    ]);
    const job = await pollJob(s.getJob, s.opts);
    expect(job?.status).toBe('COMPLETED');
  });

  it('son deneme hatasi (attempts 3) hemen kesin; yeniden deneme baslamazsa bekleme suresi sonunda kesin', async () => {
    const son = sahte([{ status: 'FAILED', attempts: 3, error: 'kalici' }]);
    expect((await pollJob(son.getJob, son.opts))?.error).toBe('kalici');
    expect(son.cagri()).toBe(1);

    const takili = sahte([{ status: 'FAILED', attempts: 1, error: 'kalici' }]);
    const t0 = Date.now();
    const job = await pollJob(takili.getJob, takili.opts);
    expect(job?.status).toBe('FAILED');
    expect(takili.cagri()).toBeGreaterThan(1);
    expect(Date.now() - t0).toBeLessThan(1000); // sahte saat: gercek bekleme yok
    expect(JOB_RETRY_GRACE_MS).toBeGreaterThanOrEqual(15_000); // 5 sn + 10 sn ustel bekleme
  });

  it('sure dolarsa null (is arka planda suruyor); ag hatasi yoklamayi bitirmez', async () => {
    let t = 0;
    let n = 0;
    const job = await pollJob(
      async () => { n++; if (n === 1) throw new Error('ag'); return { status: 'QUEUED' }; },
      { sleep: async (ms) => { t += ms; }, now: () => t, timeoutMs: 20_000 },
    );
    expect(job).toBeNull();
    expect(n).toBeGreaterThan(2);
  });

  it('sayfa kapaninca durur', async () => {
    let alive = true;
    const job = await pollJob(async () => { alive = false; return { status: 'PROCESSING' }; }, { sleep: async () => {}, isAlive: () => alive });
    expect(job).toBeNull();
  });
});

describe('publishedEntryView', () => {
  it('yayinci kaydi (externalUrl, publishedAt) hedef adi ve adresle gosterilir', () => {
    expect(publishedEntryView(
      { targetId: 't1', targetType: 'WORDPRESS_REST', ok: true, externalUrl: 'https://ornek.com/yazi/', publishedAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-18T09:00:00.000Z' },
      (id) => (id === 't1' ? 'Blog' : undefined),
    )).toEqual({
      targetId: 't1', name: 'Blog', url: 'https://ornek.com/yazi/', publishedAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-18T09:00:00.000Z',
      manualUpdatePending: false, manualUpdatePendingSince: null, trashedAt: null, missingAt: null,
    });
  });

  it('cop kutusundaki kopya (sozlesme C3): adres baglanti olmaz, "eski surum yayinda" denmez', () => {
    const v = publishedEntryView(
      { targetId: 't1', targetType: 'WORDPRESS_REST', externalUrl: 'https://ornek.com/yazi/', trashedAt: '2026-10-18T09:00:00.000Z', manualUpdatePending: true },
      () => 'Blog',
    );
    expect(v).toMatchObject({ url: null, manualUpdatePending: false, manualUpdatePendingSince: null, trashedAt: '2026-10-18T09:00:00.000Z', missingAt: null });
  });

  it('hedefte artik bulunmayan kopya (sozlesme D3): olu adres baglanti olmaz, "eski surum yayinda" denmez', () => {
    const v = publishedEntryView(
      { targetId: 't1', targetType: 'WORDPRESS_REST', externalUrl: 'https://ornek.com/yazi/', missingAt: '2026-10-18T09:00:00.000Z', manualUpdatePending: true },
      () => 'Blog',
    );
    expect(v).toMatchObject({ url: null, manualUpdatePending: false, manualUpdatePendingSince: null, trashedAt: null, missingAt: '2026-10-18T09:00:00.000Z' });
  });

  it('eski kayit (targetName, url) okunur; http(s) disi adres baglanti olmaz', () => {
    expect(publishedEntryView({ targetName: 'Eski', url: 'https://ornek.com/a' }, () => undefined)?.url).toBe('https://ornek.com/a');
    expect(publishedEntryView({ targetId: 'x', externalUrl: 'javascript:alert(1)' }, () => undefined)).toMatchObject({ name: 'x', url: null });
    expect(publishedEntryView(null, () => undefined)).toBeNull();
  });
});
