import { describe, it, expect, vi } from 'vitest';
import type { Probe } from './axo-fetch.js';

/**
 * Savunma agi: birlestirme bir botun erisimini degistirecek olursa
 * (mergeRobotsTxt → accessUnchanged=false) otomatik duzeltme YAZMAZ,
 * onizleme anahtari vermez ve nedeni soyler. Bu dal normalde tetiklenmez;
 * birlestirme mantigindaki olasi bir hataya karsi durur — burada zorlanir.
 */

vi.mock('./axo-fetch.js', async (orig) => {
  const actual = await orig<typeof import('./axo-fetch.js')>();
  return {
    ...actual,
    probeUrl: vi.fn(async (url: string): Promise<Probe> => {
      const path = new URL(url).pathname;
      const base = { url, finalUrl: url, headers: {}, truncated: false, binary: false, block: null };
      if (path === '/robots.txt') return { ...base, state: 'ok', status: 200, text: 'User-agent: *\nDisallow: /admin/\n', contentType: 'text/plain' };
      return { ...base, state: 'missing', status: 404, text: '', contentType: 'text/html' };
    }),
  };
});

vi.mock('./robots-merge.js', async (orig) => {
  const actual = await orig<typeof import('./robots-merge.js')>();
  return {
    ...actual,
    mergeRobotsTxt: vi.fn((existing: string | null, opts: any) => ({
      ...actual.mergeRobotsTxt(existing, opts),
      accessUnchanged: false,
      accessChange: { agent: 'GPTBot', path: '/admin/' },
    })),
  };
});

vi.mock('@luviai/adapters', () => ({
  getAdapter: () => class {
    get supportsRootFiles() { return true; }
    async putRootFile() { throw new Error('yazilmamaliydi'); }
  },
}));
vi.mock('@luviai/shared', () => ({ decryptCredentials: (x: unknown) => x }));

const { AutoFixService } = await import('./auto-fix.service.js');

function build() {
  const kv = { upsert: vi.fn(), findUnique: vi.fn(async () => null), deleteMany: vi.fn() };
  const prisma = {
    site: { findUniqueOrThrow: vi.fn(async () => ({ id: 's1', url: 'https://kuafor.com', name: 'K', publishTargets: [{ type: 'SFTP', isDefault: true, credentials: {}, config: {} }], brain: null })) },
    kvStore: kv,
  };
  return { svc: new AutoFixService(prisma as any, {} as any, {} as any, { kaydet: vi.fn() } as any, {} as any), kv };
}

describe('robots.txt savunma agi — erisim degisirse yazilmaz', () => {
  it('accessUnchanged=false → refuse, canApply false, onizleme anahtari yok, neden acik', async () => {
    const { svc, kv } = build();
    const p = await svc.preview('s1', 'robots_txt');
    expect(p).toMatchObject({ action: 'refuse', canApply: false, previewToken: null });
    expect(p.reason).toMatch(/Güvenlik kontrolü: ekleme bir botun erişimini değiştirecekti/);
    expect(kv.upsert).not.toHaveBeenCalled();
    // Mevcut dosya gosterilir ama "uygulanabilir" bir oneri sunulmaz
    expect(p.current).toMatchObject({ exists: true, content: 'User-agent: *\nDisallow: /admin/\n' });
    expect(p.proposed).toBeNull();
  });
});
