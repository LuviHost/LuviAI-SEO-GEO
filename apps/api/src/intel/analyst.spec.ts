import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SafeTextResult } from '../common/safe-fetch.js';

vi.mock('../prisma/prisma.service.js', () => ({ PrismaService: class {} }));
vi.mock('../llm/llm-provider.service.js', () => ({ LLMProviderService: class {} }));
vi.mock('../settings/settings.service.js', () => ({ SettingsService: class {} }));
vi.mock('./claim-ledger.service.js', () => ({ ClaimLedgerService: class {} }));
const fetchMock = vi.fn();
vi.mock('../common/safe-fetch.js', async (orig) => {
  const real: any = await orig();
  return { ...real, safeFetchText: (...a: any[]) => fetchMock(...a) };
});

const { IntelAnalystService } = await import('./analyst.service.js');

const res = (r: Partial<SafeTextResult> & { status: number }): SafeTextResult => ({
  ok: r.status >= 200 && r.status < 300, url: 'https://blog.example/yazi', redirected: false, contentType: 'text/html',
  headers: {}, text: '', truncated: false, binary: false, ...r,
});
const CHALLENGE = res({ status: 200, text: `<html><head><title>Just a moment...</title></head><body>${'Checking your browser before accessing the site. '.repeat(10)}</body></html>` });

function build() {
  const updates: any[] = [];
  const prisma = { intelItem: { update: vi.fn(async (a: any) => { updates.push(a); return {}; }) } };
  const llm = { chat: vi.fn(async () => ({ output: '{"claims":[]}' })) };
  const ledger = { claimContext: vi.fn(async () => []), record: vi.fn() };
  const svc = new IntelAnalystService(prisma as any, llm as any, {} as any, ledger as any) as any;
  return { svc, llm, updates };
}

beforeEach(() => { fetchMock.mockReset(); });

describe('IntelAnalystService.fetchArticleText', () => {
  it('makale govdesini okur; tavanli istek, durust bot kimligi', async () => {
    fetchMock.mockResolvedValue(res({ status: 200, text: '<html><body><nav>menu</nav><article>Asil   metin burada.</article></body></html>' }));
    expect(await build().svc.fetchArticleText('https://blog.example/yazi')).toBe('Asil metin burada.');
    const opts = fetchMock.mock.calls[0][1];
    expect(opts).toMatchObject({ maxBytes: 2 * 1024 * 1024, timeoutMs: 20_000 });
    expect(opts.userAgent).toBeUndefined();
  });

  it('bot dogrulama ekrani, 403 ve PDF metin sayilmaz', async () => {
    const { svc } = build();
    fetchMock.mockResolvedValue(CHALLENGE);
    expect(await svc.fetchArticleText('https://blog.example/yazi')).toBeNull();
    fetchMock.mockResolvedValue(res({ status: 403, text: 'Forbidden' }));
    expect(await svc.fetchArticleText('https://blog.example/yazi')).toBeNull();
    fetchMock.mockResolvedValue(res({ status: 200, binary: true, contentType: 'application/pdf' }));
    expect(await svc.fetchArticleText('https://blog.example/yazi')).toBeNull();
  });

  it('engel sayfasinin metni modele GITMEZ — ozete duser', async () => {
    fetchMock.mockResolvedValue(CHALLENGE);
    const { svc, llm } = build();
    const summary = 'Ozet: ' + 'Google yeni bir guncelleme duyurdu ve olcumler degisti. '.repeat(5);
    await svc.analyzeItem({
      id: 'i1', url: 'https://blog.example/yazi', title: 'Baslik', summary, publishedAt: null, topics: [], fullText: null,
      source: { name: 'Blog', tier: 'community', weight: 1 },
    }, 'model-x');
    const sent = (llm.chat.mock.calls[0] as any)[0].messages[0].content as string;
    expect(sent).toContain('Google yeni bir guncelleme');
    expect(sent).not.toContain('Just a moment');
    expect(sent).not.toContain('Checking your browser');
  });
});
