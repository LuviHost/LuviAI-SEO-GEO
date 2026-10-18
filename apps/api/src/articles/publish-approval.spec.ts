import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  AUTO_PUBLISH_MODE, autoPublishEnabled, automationPublishFields, decideGeneratedArticlePublish,
  scheduledGenerationPaused, PUBLISH_SKIP_TEXT,
} from './publish-approval.js';

/**
 * Yayin onayi — panelin "Yari otomatik: her yazi yayinlanmadan once onayini
 * bekler" vaadi. Mod hicbir yerde okunmuyordu; otomasyon varsayilan hedef
 * varsa onaysiz yayinliyordu.
 */

const siteReader = (site: { autopilot?: boolean | null; publishApprovalMode?: string | null } | null) => {
  const findUnique = vi.fn(async () => site);
  return { prisma: { site: { findUnique } } as any, findUnique };
};

describe('autoPublishEnabled — panelin uc durumu', () => {
  it('yalniz akis acik + Tam otomatik onaysiz yayinlar', () => {
    expect(autoPublishEnabled({ autopilot: true, publishApprovalMode: AUTO_PUBLISH_MODE })).toBe(true);
    // Yari otomatik (varsayilan)
    expect(autoPublishEnabled({ autopilot: true, publishApprovalMode: 'manual_approve' })).toBe(false);
    // Durduruldu: kayitli mod auto_publish kalsa da panel Tam otomatik gostermez
    expect(autoPublishEnabled({ autopilot: false, publishApprovalMode: AUTO_PUBLISH_MODE })).toBe(false);
  });

  it('alan secilmemisse / bilinmeyen deger: onay bekler (guvenli yon)', () => {
    expect(autoPublishEnabled({ publishApprovalMode: AUTO_PUBLISH_MODE })).toBe(false);
    expect(autoPublishEnabled({ autopilot: true })).toBe(false);
    expect(autoPublishEnabled({ autopilot: true, publishApprovalMode: 'AUTO_PUBLISH' })).toBe(false);
    expect(autoPublishEnabled(null)).toBe(false);
    expect(autoPublishEnabled(undefined)).toBe(false);
  });
});

describe('automationPublishFields — kuyruga giren is', () => {
  it('Yari otomatikte hedef olsa bile autoPublish false; hedefler is kaydinda kalir', () => {
    expect(automationPublishFields({ autopilot: true, publishApprovalMode: 'manual_approve' }, ['t1']))
      .toEqual({ autoPublish: false, targetIds: ['t1'] });
  });

  it('Tam otomatik + varsayilan hedef: autoPublish true; hedef yoksa false', () => {
    const auto = { autopilot: true, publishApprovalMode: AUTO_PUBLISH_MODE };
    expect(automationPublishFields(auto, ['t1', 't2'])).toEqual({ autoPublish: true, targetIds: ['t1', 't2'] });
    expect(automationPublishFields(auto, [])).toEqual({ autoPublish: false, targetIds: [] });
  });
});

describe('decideGeneratedArticlePublish — karar IS KOSARKEN', () => {
  it('autoPublish istenmemisse DB okunmaz, yayin yok', async () => {
    const { prisma, findUnique } = siteReader({ autopilot: true, publishApprovalMode: AUTO_PUBLISH_MODE });
    for (const autoPublish of [false, undefined, 'true', 1]) {
      expect(await decideGeneratedArticlePublish(prisma, { siteId: 's1', autoPublish })).toEqual({ publish: false, reason: 'not_requested' });
    }
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('kuyrukta autoPublish:true kalmis is, site su an Yari otomatikse YAYINLANMAZ', async () => {
    const { prisma, findUnique } = siteReader({ autopilot: true, publishApprovalMode: 'manual_approve' });
    const d = await decideGeneratedArticlePublish(prisma, { siteId: 's1', autoPublish: true, targetIds: ['t1'] });
    expect(d).toEqual({ publish: false, reason: 'manual_approve' });
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 's1' }, select: { autopilot: true, publishApprovalMode: true } });
  });

  it('akis durdurulmussa (mod auto_publish olsa da) yayinlanmaz', async () => {
    const { prisma } = siteReader({ autopilot: false, publishApprovalMode: AUTO_PUBLISH_MODE });
    expect(await decideGeneratedArticlePublish(prisma, { siteId: 's1', autoPublish: true })).toEqual({ publish: false, reason: 'paused' });
  });

  it('site silinmisse yayinlanmaz', async () => {
    const { prisma } = siteReader(null);
    expect(await decideGeneratedArticlePublish(prisma, { siteId: 's1', autoPublish: true })).toEqual({ publish: false, reason: 'site_missing' });
  });

  it('Tam otomatik: yayin, hedefler is verisinden DEGIL guncel varsayilanlardan (bos dizi)', async () => {
    const { prisma } = siteReader({ autopilot: true, publishApprovalMode: AUTO_PUBLISH_MODE });
    // Is haftalar once eski varsayilan hedefle kuyruga girmis olabilir
    const d = await decideGeneratedArticlePublish(prisma, { siteId: 's1', autoPublish: true, targetIds: ['eski-hedef'] });
    expect(d).toEqual({ publish: true, reason: 'auto_publish', targetIds: [] });
  });

  it('kullanicinin acik yayin istegi (publishApproved) moddan bagimsiz; secilen hedefler kullanilir', async () => {
    const { prisma, findUnique } = siteReader({ autopilot: true, publishApprovalMode: 'manual_approve' });
    const d = await decideGeneratedArticlePublish(prisma, { siteId: 's1', autoPublish: true, publishApproved: true, targetIds: ['t1', 5, 't2'] });
    expect(d).toEqual({ publish: true, reason: 'user_approved', targetIds: ['t1', 't2'] });
    expect(findUnique).not.toHaveBeenCalled();
    // "true" dizesi onay sayilmaz
    expect((await decideGeneratedArticlePublish(prisma, { siteId: 's1', autoPublish: true, publishApproved: 'true' })).publish).toBe(false);
  });

  it('her atlama nedeninin Turkce aciklamasi var', () => {
    for (const k of ['not_requested', 'manual_approve', 'paused', 'site_missing'] as const) {
      expect(PUBLISH_SKIP_TEXT[k].length).toBeGreaterThan(10);
    }
    expect(PUBLISH_SKIP_TEXT.manual_approve).toContain('Yarı otomatik');
  });
});

describe('scheduledGenerationPaused — "Durduruldu: yeni yazı üretilmiyor"', () => {
  const reader = (row: { status: string; site: { autopilot: boolean | null } | null } | null) => {
    const findUnique = vi.fn(async () => row);
    return { prisma: { article: { findUnique } } as any, findUnique };
  };

  it('takvim isi (yazi hala SCHEDULED) + akis durdurulmus → uretilmez', async () => {
    const { prisma, findUnique } = reader({ status: 'SCHEDULED', site: { autopilot: false } });
    expect(await scheduledGenerationPaused(prisma, { articleId: 'a1' })).toBe(true);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'a1' }, select: { status: true, site: { select: { autopilot: true } } } });
  });

  it('akis acik ya da bilinmiyorsa uretilir (eski davranis)', async () => {
    expect(await scheduledGenerationPaused(reader({ status: 'SCHEDULED', site: { autopilot: true } }).prisma, { articleId: 'a1' })).toBe(false);
    expect(await scheduledGenerationPaused(reader({ status: 'SCHEDULED', site: { autopilot: null } }).prisma, { articleId: 'a1' })).toBe(false);
    expect(await scheduledGenerationPaused(reader(null).prisma, { articleId: 'a1' })).toBe(false);
  });

  it('acik kullanici istekleri (yazi once GENERATING yapilir) durdurmadan etkilenmez', async () => {
    for (const status of ['GENERATING', 'PUBLISHED', 'READY_TO_PUBLISH']) {
      expect(await scheduledGenerationPaused(reader({ status, site: { autopilot: false } }).prisma, { articleId: 'a1' }), status).toBe(false);
    }
  });

  it('makale kimligi yoksa DB okunmaz', async () => {
    const { prisma, findUnique } = reader({ status: 'SCHEDULED', site: { autopilot: false } });
    expect(await scheduledGenerationPaused(prisma, {})).toBe(false);
    expect(await scheduledGenerationPaused(prisma, { articleId: 42 })).toBe(false);
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe('worker GENERATE_ARTICLE — kararin kablolamasi', () => {
  // Worker'in test kosucusu yok; handler api/dist'teki bu modulu cagirmali.
  const src = readFileSync(new URL('../../../worker/src/index.ts', import.meta.url), 'utf8');
  const handler = src.slice(src.indexOf('GENERATE_ARTICLE: async'), src.indexOf('PUBLISH_ARTICLE: async'));

  it('yayin karari publish-approval\'dan; yayin oncesi yeniden okunur', () => {
    expect(src).toMatch(/from '\.\.\/\.\.\/api\/dist\/articles\/publish-approval\.js'/);
    expect(handler.match(/decideGeneratedArticlePublish\(/g)?.length).toBe(2);
    expect(handler).toContain('awaitQa: plan.publish');
    expect(handler).toContain('publishArticle(result.articleId, now.targetIds)');
    // Eski kural: is verisindeki autoPublish dogrudan yayina gidiyordu
    expect(handler).not.toMatch(/if \(autoPublish && editorOk\)/);
  });

  it('sahte (mock) icerik otomatik yayinlanmaz; yayin hatasi saglam yaziyi FAILED yapmaz, isi yeniden denetmez', () => {
    expect(handler).toMatch(/if \(plan\.publish && \(result as any\)\.mock\) \{[\s\S]*?publishSkipped: 'mock'/);
    expect(handler).not.toMatch(/\(result as any\)\.mock \|\| result\.editorVerdict === 'PASS'/);
    // publishArticle kendi try/catch'inde; hata sonuca yazilir, firlatilmaz
    expect(handler).toMatch(/try \{\s*const publishResults = await services\.publisher\.publishArticle\(result\.articleId, now\.targetIds\);[\s\S]*?\} catch \(err: any\) \{[\s\S]*?return \{ \.\.\.result, publishError:/);
  });

  it('durdurulmus akista takvim isi uretmeden doner', () => {
    expect(handler).toMatch(/scheduledGenerationPaused\(services\.prisma, \{ articleId \}\)/);
    expect(handler.indexOf('scheduledGenerationPaused')).toBeLessThan(handler.indexOf('runPipeline'));
  });
});
