import { Octokit } from '@octokit/rest';
import { PublishAdapter } from './base.js';
import type { PublishPayload, PublishResult } from './base.js';

/**
 * GitHub repo adapter — markdown veya HTML dosyası commit eder.
 * credentials: { token, owner, repo, branch? }
 * config: { path: 'content/blog', format: 'markdown' | 'html', commitMessage? }
 *
 * Static site generator (Hugo, Jekyll, Astro, Next.js MDX) kullanan
 * kullanıcılar için ideal.
 */
export class GithubAdapter extends PublishAdapter {
  async publish(payload: PublishPayload): Promise<PublishResult> {
    const { token, owner, repo, branch = 'main' } = this.credentials;
    const {
      path = 'content/blog',
      format = 'markdown',
      commitMessage,
    } = this.config;

    const octokit = new Octokit({ auth: token });
    const ext = format === 'markdown' ? 'md' : 'html';
    const filePath = `${path}/${payload.slug}.${ext}`;
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
        message: commitMessage ?? `Add: ${payload.title}`,
        content: Buffer.from(content).toString('base64'),
        branch,
        sha,
        committer: { name: 'LuviAI', email: 'noreply@ai.luvihost.com' },
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
