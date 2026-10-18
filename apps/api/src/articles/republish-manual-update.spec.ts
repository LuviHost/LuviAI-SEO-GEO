import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import {
  articleContentHash, autoPublishFollowUp, liveCopyNeedsManualUpdate, refreshManualUpdateFlags, withoutManualUpdateFlag,
} from './republish-policy.js';

/**
 * T-A madde 3 ve 5 — yayindaki yazi yeni metni alamazsa:
 *  - publishedTo kaydi "elle guncelleme bekliyor" (manualUpdatePending /
 *    manualUpdatePendingSince, paylasilan sozlesme) diye isaretlenir, yalniz
 *    RanksUp'in yazamadigi canli kopya ve metin GERCEKTEN farkliysa;
 *  - worker tum hedefler bilerek atlandiginda "onayini bekliyor" e-postasi atmaz.
 */

const NOW = '2026-10-18T09:00:00.000Z';
const ARTICLE = { title: 'Yazı', metaTitle: null, metaDescription: 'Özet', bodyMd: '# Yazı\n\nMetin.' };
const HASH = articleContentHash(ARTICLE);
const ghost = (over: Record<string, unknown> = {}) => ({ targetId: 't-g', targetType: 'GHOST', ok: true, externalId: 'g1', ...over });
const wp = (over: Record<string, unknown> = {}) => ({ targetId: 't-wp', targetType: 'WORDPRESS_REST', ok: true, externalId: '41', externalUrl: 'https://s.example/yazi/', ...over });
const TARGETS = [{ id: 't-g', type: 'GHOST', isActive: true }, { id: 't-wp', type: 'WORDPRESS_REST', isActive: true }];

const refresh = (publishedTo: unknown, over: Partial<Parameters<typeof refreshManualUpdateFlags>[0]> = {}) =>
  refreshManualUpdateFlags({ publishedTo, targets: TARGETS, articleSlug: 'yazi', contentHash: HASH, legacyContentChanged: true, now: NOW, ...over });

describe('articleContentHash', () => {
  it('baslik, meta baslik, meta aciklama ve govdeye bagli; null ile bos dize ayni', () => {
    expect(HASH).toMatch(/^[0-9a-f]{64}$/);
    expect(articleContentHash({ ...ARTICLE, metaTitle: '' })).toBe(HASH);
    for (const k of ['title', 'metaTitle', 'metaDescription', 'bodyMd'] as const) {
      expect(articleContentHash({ ...ARTICLE, [k]: 'farklı' }), k).not.toBe(HASH);
    }
    // alan sinirlari karismaz ("ab"+"c" ≠ "a"+"bc")
    expect(articleContentHash({ title: 'ab', metaTitle: 'c' })).not.toBe(articleContentHash({ title: 'a', metaTitle: 'bc' }));
  });
});

describe('liveCopyNeedsManualUpdate — RanksUp bu canli kopyaya yazamaz mi', () => {
  it('yalniz yeni kayit acan hedef, adreslenemeyen WordPress kaydi, slug degisimi, silinmis / pasif hedef: evet', () => {
    expect(liveCopyNeedsManualUpdate(ghost(), TARGETS[0], 'yazi')).toBe(true);
    expect(liveCopyNeedsManualUpdate(wp({ externalId: undefined, externalUrl: undefined }), TARGETS[1], 'yazi')).toBe(true);
    expect(liveCopyNeedsManualUpdate({ targetId: 't-f', targetType: 'FTP', ok: true, externalUrl: 'ftp://h/eski.html' }, { id: 't-f', type: 'FTP', isActive: true }, 'yeni')).toBe(true);
    expect(liveCopyNeedsManualUpdate(wp(), undefined, 'yazi')).toBe(true);
    expect(liveCopyNeedsManualUpdate(wp(), { ...TARGETS[1], isActive: false }, 'yazi')).toBe(true);
  });

  it('WordPress (adreslenebilir), ayni yollu dosya: hayir; Markdown ZIP canli kopya sayilmaz', () => {
    expect(liveCopyNeedsManualUpdate(wp(), TARGETS[1], 'yazi')).toBe(false);
    expect(liveCopyNeedsManualUpdate({ targetId: 't-f', targetType: 'FTP', ok: true, externalUrl: 'ftp://h/yazi.html' }, { id: 't-f', type: 'FTP', isActive: true }, 'yazi')).toBe(false);
    expect(liveCopyNeedsManualUpdate({ targetId: 't-z', targetType: 'MARKDOWN_ZIP', ok: true }, undefined, 'yazi')).toBe(false);
  });
});

describe('refreshManualUpdateFlags', () => {
  it('izsiz eski kayit + yazi canliya ciktiktan sonra yeniden yazildi: isaret ve ilk an', () => {
    const r = refresh([ghost()]);
    expect(r.changed).toBe(true);
    expect(r.publishedTo).toEqual([ghost({ manualUpdatePending: true, manualUpdatePendingSince: NOW })]);
    expect(r.pendingTargetIds).toEqual(['t-g']);
  });

  it('izsiz eski kayit + metin degismemis (yazi PUBLISHED): isaret yok — sahte "elle güncelleyin" uretilmez', () => {
    const r = refresh([ghost()], { legacyContentChanged: false });
    expect(r).toEqual({ publishedTo: [ghost()], changed: false, pendingTargetIds: [] });
  });

  it('izli kayit: iz farkliysa isaret, ayniysa isaret yok ve onceki isaret kalkar', () => {
    expect(refresh([ghost({ contentHash: 'eski' })], { legacyContentChanged: false }).publishedTo[0]).toMatchObject({ manualUpdatePending: true });
    const cleared = refresh([ghost({ contentHash: HASH, manualUpdatePending: true, manualUpdatePendingSince: '2026-09-01T00:00:00.000Z' })]);
    expect(cleared).toEqual({ publishedTo: [ghost({ contentHash: HASH })], changed: true, pendingTargetIds: [] });
  });

  it('izsiz eski kayitta isaret kendiliginden kalkmaz; ilk an korunur', () => {
    const since = '2026-09-01T00:00:00.000Z';
    const keep = refresh([ghost({ manualUpdatePending: true, manualUpdatePendingSince: since })], { legacyContentChanged: false });
    expect(keep.changed).toBe(false);
    expect(keep.publishedTo[0]).toMatchObject({ manualUpdatePending: true, manualUpdatePendingSince: since });
    const again = refresh([ghost({ manualUpdatePending: true, manualUpdatePendingSince: since })]);
    expect(again.changed).toBe(false);
    expect(again.publishedTo[0]).toMatchObject({ manualUpdatePendingSince: since });
  });

  it('RanksUp\'in yazabildigi kopya (WordPress) ve bu yayinda yazilan / cop kutusundaki kopya isaretlenmez', () => {
    const r = refresh([wp(), ghost()], { writtenTargetIds: new Set(['t-g']) });
    expect(r.changed).toBe(false);
    expect(refresh([ghost()], { trashedTargetIds: new Set(['t-g']) }).changed).toBe(false);
  });

  it('pasif / silinmis hedefteki canli kopya isaretlenir; bozuk ve ok:false kayitlar oldugu gibi kalir', () => {
    const r = refresh([wp(), null, 'bozuk', ghost({ ok: false })], { targets: [{ id: 't-wp', type: 'WORDPRESS_REST', isActive: false }] });
    expect(r.publishedTo).toEqual([wp({ manualUpdatePending: true, manualUpdatePendingSince: NOW }), null, 'bozuk', ghost({ ok: false })]);
  });

  it('girdi degistirilmez', () => {
    const entries = [ghost({ contentHash: HASH, manualUpdatePending: true, manualUpdatePendingSince: NOW })];
    const snapshot = JSON.stringify(entries);
    refresh(entries);
    refresh([ghost()]);
    expect(JSON.stringify(entries)).toBe(snapshot);
    expect(withoutManualUpdateFlag(entries[0])).toEqual(ghost({ contentHash: HASH }));
    expect(entries[0]).toHaveProperty('manualUpdatePending', true);
  });
});

describe('autoPublishFollowUp — worker GENERATE_ARTICLE otomatik yayindan sonra', () => {
  it('en az bir hedefe yazildi: e-posta yok', () => {
    expect(autoPublishFollowUp([{ ok: true }, { ok: false, skipped: 'already_live_create_only' }])).toEqual({ written: true, notifyAwaitingApproval: false, skipped: [] });
  });

  it('TUM hedefler bilerek atlandi: "onayini bekliyor" e-postasi YOK, nedenler doner', () => {
    const r = autoPublishFollowUp([
      { targetId: 't-g', targetType: 'GHOST', ok: false, skipped: 'already_live_create_only', error: 'Bu yazı Ghost üzerinde zaten yayında…' },
      { targetId: 't-wp', targetType: 'WORDPRESS_REST', ok: false, skipped: 'live_target_inactive' },
    ]);
    expect(r).toEqual({
      written: false,
      notifyAwaitingApproval: false,
      skipped: [
        { targetId: 't-g', targetType: 'GHOST', skipped: 'already_live_create_only', error: 'Bu yazı Ghost üzerinde zaten yayında…' },
        { targetId: 't-wp', targetType: 'WORDPRESS_REST', skipped: 'live_target_inactive' },
      ],
    });
  });

  it('hata veren hedef var ya da hic hedef yok: yazi onay / yeniden deneme bekliyor — e-posta gider (eski davranis)', () => {
    expect(autoPublishFollowUp([{ ok: false, error: 'WP REST 403' }, { ok: false, skipped: 'already_live_create_only' }]).notifyAwaitingApproval).toBe(true);
    expect(autoPublishFollowUp([]).notifyAwaitingApproval).toBe(true);
    expect(autoPublishFollowUp(undefined).notifyAwaitingApproval).toBe(true);
  });
});

describe('worker kablolamasi (apps/worker/src/index.ts) — otomatik yeniden yazim', () => {
  const src = readFileSync(new URL('../../../worker/src/index.ts', import.meta.url), 'utf8');
  const handler = src.slice(src.indexOf('GENERATE_ARTICLE: async'), src.indexOf('PUBLISH_ARTICLE: async'));

  it('is verisindeki automatedRewrite pipeline\'a gecer; uretimden ONCE canli kopyalar yeniden denetlenir', () => {
    expect(handler).toMatch(/GENERATE_ARTICLE: async \(\{[^}]*automatedRewrite[^}]*\}, job\)/);
    const precheck = handler.indexOf('services.contentPivot.automatedRewriteBlock(articleId)');
    expect(precheck).toBeGreaterThan(-1);
    expect(precheck).toBeLessThan(handler.indexOf('services.pipeline.runPipeline('));
    expect(handler).toMatch(/if \(block\) \{[\s\S]*?return \{ skipped: true, reason: 'LIVE_REWRITE_BLOCKED'/);
    expect(handler).toContain('automatedRewrite: automated,');
  });

  it('yayindaki kayit korunduysa (liveKept) yayin adimina gecilmez', () => {
    const kept = handler.indexOf('if ((result as any).liveKept)');
    expect(kept).toBeGreaterThan(-1);
    expect(kept).toBeLessThan(handler.indexOf('services.publisher.publishArticle('));
  });

  it('tum hedefler atlandiysa e-posta yerine atlama nedeni is sonucuna yazilir', () => {
    expect(handler).toMatch(/if \(!follow\.written && follow\.skipped\.length > 0\) \{[\s\S]*?publishSkipped: 'live_targets_skipped', skippedTargets: follow\.skipped/);
    expect(src).toContain("import { autoPublishFollowUp } from '../../api/dist/articles/republish-policy.js';");
  });

  it('D2: uretim sonrasi otomatik yayin yayinciya initiator VERMEZ (varsayilan otomasyon: silinen yazi geri gelmez, engel kaydedilir)', () => {
    const call = handler.slice(handler.indexOf('services.publisher.publishArticle('));
    expect(call.slice(0, call.indexOf(';'))).toBe('services.publisher.publishArticle(result.articleId, now.targetIds)');
    expect(handler).not.toMatch(/initiator:\s*'user'/);
  });
});

describe('worker kablolamasi — PUBLISH_ARTICLE kullanicinin yayinidir (D2)', () => {
  const src = readFileSync(new URL('../../../worker/src/index.ts', import.meta.url), 'utf8');
  const handler = src.slice(src.indexOf('PUBLISH_ARTICLE: async'), src.indexOf('IMPROVE_PAGE: async'));

  it('yayinciya initiator "user" gecer (alansiz eski isler de yalniz yayin ucundan geldi)', () => {
    expect(handler).toMatch(/services\.publisher\.publishArticle\(articleId, targetIds \?\? \[\], \{[\s\S]*?initiator: 'user',[\s\S]*?\}\)/);
  });

  it('PUBLISH_ARTICLE\'i yalniz API yayin ucu (articles.service queuePublish) kuyruga atar — otomasyon bu isi acarsa "user" sayilirdi', () => {
    const roots = ['../../../api/src', '../../../worker/src'].map((r) => new URL(r + '/', import.meta.url));
    const producers: string[] = [];
    const walk = (dir: URL) => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        if (ent.isDirectory()) { walk(new URL(`${ent.name}/`, dir)); continue; }
        if (!ent.name.endsWith('.ts') || ent.name.endsWith('.spec.ts')) continue;
        const text = readFileSync(new URL(ent.name, dir), 'utf8');
        if (/type:\s*'PUBLISH_ARTICLE'/.test(text)) producers.push(new URL(ent.name, dir).pathname.split('/apps/')[1]);
      }
    };
    roots.forEach(walk);
    expect(producers).toEqual(['api/src/articles/articles.service.ts']);
  });
});
