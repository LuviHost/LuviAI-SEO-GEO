import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';

/**
 * Snippet uygulama — varsayilan yayin hedefi adaptor istegi atilmadan once
 * adres denetiminden gecer (publish-target-url.ts). Ic aga cevrilmis hedefe
 * adaptor hic kurulmaz; neden Turkce doner. Adres IP: DNS'e gidilmez.
 */

const constructed: any[] = [];
const applyCalls: any[] = [];
vi.mock('@luviai/adapters', async (orig) => {
  const real: any = await orig();
  class FakeAdapter {
    constructor(creds: any) { constructed.push(creds); }
    async applyOnPageMeta(p: any) { applyCalls.push(p); return { ok: true, applied: ['metaTitle'], skipped: [] }; }
  }
  return { ...real, getAdapter: () => FakeAdapter };
});
vi.mock('@luviai/shared', async (orig) => ({ ...(await orig() as any), decryptCredentials: (c: any) => c ?? {} }));
vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));

const { SnippetApplierService } = await import('./snippet-applier.service.js');

const SNIPPETS: any[] = [{ pageUrl: 'https://site.example/a', type: 'meta_title', generatedSnippet: '<title>Yeni</title>' }];

function build(target: any) {
  const prisma = { site: { findUniqueOrThrow: vi.fn(async () => ({ id: 's1', url: 'https://site.example', publishTargets: [target] })) } };
  const appliedFix = { topluKaydet: vi.fn(async () => {}) };
  return { svc: new SnippetApplierService(prisma as any, appliedFix as any), appliedFix };
}

beforeEach(() => { constructed.length = 0; applyCalls.length = 0; });

describe('SnippetApplierService — kapsam: yalniz sitenin kendi sayfalari', () => {
  const PUBLIC_TARGET = { type: 'WORDPRESS_REST', credentials: { siteUrl: 'https://93.184.216.34' }, config: {} };

  it('baska sitenin adresi adaptor kurulmadan Turkce 400 ile reddedilir', async () => {
    for (const foreign of ['https://site.example.evil.com/a', 'https://notsite.example/a', 'https://site.example@evil.com/a']) {
      const { svc, appliedFix } = build(PUBLIC_TARGET);
      const p = svc.applyToTarget('s1', [{ ...SNIPPETS[0], pageUrl: foreign }]);
      await expect(p, foreign).rejects.toBeInstanceOf(BadRequestException);
      await expect(p, foreign).rejects.toThrow(/Snippet uygulama yalnızca sitenin kendi alan adında yapılabilir \(site\.example;/);
      expect(appliedFix.topluKaydet).not.toHaveBeenCalled();
    }
    expect(constructed).toEqual([]);
  });

  it('govdedeki herhangi bir snippet kapsam disiysa hicbiri uygulanmaz; adresi eksik snippet de reddedilir', async () => {
    const { svc } = build(PUBLIC_TARGET);
    await expect(svc.applyToTarget('s1', [SNIPPETS[0], { ...SNIPPETS[0], pageUrl: 'https://rakip.com/x' }])).rejects.toThrow(BadRequestException);
    await expect(svc.applyToTarget('s1', [{ ...SNIPPETS[0], pageUrl: undefined }])).rejects.toThrow(/Geçerli bir adres girin/);
    expect(constructed).toEqual([]);
  });

  it('www\'li hali ve alt alan adi kabul edilir; adaptore kirpilmis adres gider', async () => {
    for (const own of ['https://www.site.example/a', ' https://blog.site.example/yazi ']) {
      const { svc } = build(PUBLIC_TARGET);
      const r = await svc.applyToTarget('s1', [{ ...SNIPPETS[0], pageUrl: own }]);
      expect(r.ok, own).toBe(true);
      expect(applyCalls.at(-1).pageUrl, own).toBe(own.trim());
    }
  });
});

describe('SnippetApplierService — yayin hedefi adres denetimi', () => {
  it('ic ag adresli hedefe adaptor kurulmaz; Turkce neden doner, siteye bir sey yazilmaz', async () => {
    const { svc, appliedFix } = build({ type: 'WORDPRESS_REST', credentials: { siteUrl: 'http://127.0.0.1:8080' }, config: {} });
    const r = await svc.applyToTarget('s1', SNIPPETS);
    expect(r.ok).toBe(false);
    expect(r.adapter).toBe('WORDPRESS_REST');
    expect(r.skipped[0].reason).toBe('Yayın hedefine bağlanılmadı — Site URL: özel veya iç ağ adresi kullanılamaz; herkese açık bir adres girin.');
    expect(constructed).toEqual([]);
    expect(appliedFix.topluKaydet).not.toHaveBeenCalled();
  });

  it('genel adresli hedef uygulanir', async () => {
    const { svc } = build({ type: 'WORDPRESS_REST', credentials: { siteUrl: 'https://93.184.216.34' }, config: {} });
    const r = await svc.applyToTarget('s1', SNIPPETS);
    expect(r).toMatchObject({ ok: true, applied: ['metaTitle'] });
    expect(constructed).toHaveLength(1);
  });
});
