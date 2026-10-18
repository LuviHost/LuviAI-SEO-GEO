import { describe, it, expect, vi, afterEach } from 'vitest';
import { GithubAdapter } from '@luviai/adapters';

/**
 * GitHub yayin hedefi — katalog ayarlari adaptore ulasiyor mu.
 *
 * NEDEN VAR: panel katalogu klasoru config.contentPath diye kaydeder, adaptor
 * config.path okuyordu: girilen klasor yok sayilip yazilar hep content/blog'a
 * gidiyordu. Commit mesaji sablonundaki {title} de hic doldurulmuyordu.
 *
 * Gercek ag yok: Octokit (@octokit/request) global fetch'i her istekte okur;
 * sahte fetch GitHub Contents API yanitlarini verir.
 */

type Call = { url: string; method: string; body: any };

function stubGithub(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = String(init?.method ?? 'GET').toUpperCase();
    calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : null });
    const json = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });
    // Dosya henuz yok → 404; olusturma → 201
    if (method === 'GET') return json(404, { message: 'Not Found' });
    return json(201, { content: { html_url: 'https://github.com/o/r/blob/main/x.md' }, commit: { sha: 'abc123' } });
  }));
  return calls;
}

/** Contents API yolundaki dosya yolu (Octokit {path}'i yuzde kodlar) */
const filePathOf = (c: Call) => decodeURIComponent(new URL(c.url).pathname.replace(/^\/repos\/o\/r\/contents\//, ''));

const creds = { token: 'ghp_test', owner: 'o', repo: 'r' };
const payload = { slug: 'yazi', title: 'Yeni Yazı: {title} değil', bodyHtml: '<p>x</p>', bodyMd: '# Yazı' };

afterEach(() => vi.unstubAllGlobals());

describe('GithubAdapter — katalog alanlari', () => {
  it('config.contentPath kullanilir; bas/son "/" atilir; {title} her yerde baslikla degisir', async () => {
    const calls = stubGithub();
    const r = await new GithubAdapter(creds, { contentPath: '/content/posts/', commitMessage: 'feat(blog): {title} ({title})' }).publish(payload);
    expect(r).toEqual({ ok: true, externalId: 'abc123', externalUrl: 'https://github.com/o/r/blob/main/x.md' });
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(filePathOf(put)).toBe('content/posts/yazi.md');
    expect(put.body.message).toBe('feat(blog): Yeni Yazı: {title} değil (Yeni Yazı: {title} değil)');
    expect(put.body.branch).toBe('main');
    expect(Buffer.from(put.body.content, 'base64').toString()).toBe('# Yazı');
  });

  it('eski kayit config.path ile calismaya devam eder; ikisi yoksa content/blog', async () => {
    let calls = stubGithub();
    await new GithubAdapter(creds, { path: 'icerik' }).publish(payload);
    expect(filePathOf(calls.find((c) => c.method === 'PUT')!)).toBe('icerik/yazi.md');

    calls = stubGithub();
    await new GithubAdapter(creds, { contentPath: 'yeni', path: 'eski' }).publish(payload);
    expect(filePathOf(calls.find((c) => c.method === 'PUT')!)).toBe('yeni/yazi.md');

    calls = stubGithub();
    await new GithubAdapter(creds, {}).publish(payload);
    expect(filePathOf(calls.find((c) => c.method === 'PUT')!)).toBe('content/blog/yazi.md');
  });

  it('"/" depo kokudur; bos sablon ve bos branch varsayilana duser', async () => {
    const calls = stubGithub();
    await new GithubAdapter({ ...creds, branch: '' }, { contentPath: '/', commitMessage: '  ' }).publish(payload);
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(filePathOf(put)).toBe('yazi.md');
    expect(put.body.message).toBe('Add: Yeni Yazı: {title} değil');
    expect(put.body.branch).toBe('main');
  });
});
