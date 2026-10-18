import { Octokit } from '@octokit/rest';
import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult } from './base.js';
import { pickString } from './credential-keys.js';

/**
 * GitHub repo adapter — markdown veya HTML dosyası commit eder.
 * credentials: { token, owner, repo, branch? }
 * config: { contentPath: 'content/blog', format: 'markdown' | 'html', commitMessage? }
 *   (eski kayitlar klasoru `path` adiyla tasir — o da okunur)
 *
 * Static site generator (Hugo, Jekyll, Astro, Next.js MDX) kullanan
 * kullanıcılar için ideal.
 */

/**
 * Depo icindeki klasor: bas/son "/" ve "./" atilir, bos → depo koku.
 *
 * NEDEN: panel katalogu klasoru config.contentPath diye kaydeder
 * (publish-targets.service.ts katalog); adaptor yalniz config.path okudugu icin
 * girilen klasor yok sayiliyor, yazilar hep content/blog'a gidiyordu. Formdan
 * "/content/posts/" gibi yazilan yol da "contents//content/posts//slug.md"
 * uretmesin.
 */
function githubContentDir(config: Record<string, unknown>): string {
  const raw = pickString(config, 'contentPath', 'path') ?? 'content/blog';
  return raw
    .replace(/\\/g, '/')
    .split('/')
    .filter((seg) => seg && seg !== '.')
    .join('/');
}

/**
 * Commit mesaji: katalogdaki sablon (varsayilan 'feat(blog): {title}') icindeki
 * her {title} yazinin basligiyla degistirilir. Eskiden sablon aynen
 * yaziliyordu — her commit "feat(blog): {title}" diye gidiyordu.
 */
function githubCommitMessage(template: unknown, title: string): string {
  const t = typeof template === 'string' ? template.trim() : '';
  return t ? t.split('{title}').join(title) : `Add: ${title}`;
}

export class GithubAdapter extends PublishAdapter {
  /**
   * format=html iken repoya dogrudan servis edilebilir bir .html dosyasi yazar
   * (GitHub Pages vb.) — tam sayfa gerekir. format=markdown iken bodyMd
   * kullanildigi icin bu bayrak zararsizdir.
   */
  get needsFullPage(): boolean { return true; }

  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { token, owner, repo } = this.credentials;
    // Bos dize de varsayilana duser (?? yalniz undefined'i yakalardi)
    const branch = pickString(this.credentials, 'branch') ?? 'main';
    const { format = 'markdown', commitMessage } = this.config;

    const octokit = new Octokit({ auth: token });
    const ext = format === 'markdown' ? 'md' : 'html';
    const dir = githubContentDir(this.config);
    const filePath = dir ? `${dir}/${payload.slug}.${ext}` : `${payload.slug}.${ext}`;
    const content = format === 'markdown' ? payload.bodyMd : payload.bodyHtml;

    try {
      // Mevcut dosya var mı (sha gerekli update için)?
      let sha: string | undefined;
      try {
        const existing = await octokit.repos.getContent({ owner, repo, path: filePath, ref: branch });
        if ('sha' in existing.data) sha = existing.data.sha;
      } catch {
        // dosya yok — yeni create
      }

      const res = await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: filePath,
        message: githubCommitMessage(commitMessage, payload.title),
        content: Buffer.from(content).toString('base64'),
        branch,
        sha,
        committer: { name: 'RanksUp', email: 'noreply@ranksup.ai' },
      });

      return {
        ok: true,
        externalUrl: res.data.content?.html_url ?? `https://github.com/${owner}/${repo}/blob/${branch}/${filePath}`,
        externalId: res.data.commit.sha,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  async test(): Promise<boolean> {
    const { token, owner, repo } = this.credentials;
    try {
      const octokit = new Octokit({ auth: token });
      await octokit.repos.get({ owner, repo });
      return true;
    } catch {
      return false;
    }
  }
}
