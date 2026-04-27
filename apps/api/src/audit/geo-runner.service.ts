import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * Auriti GEO Optimizer CLI wrapper.
 * `geo audit --url X --format json` çağırır, AI search citation gap'lerini döner.
 *
 * Kurulum: pipx install geo-optimizer-skill
 * CLI yoksa graceful fallback (null döner).
 */
@Injectable()
export class GeoRunnerService {
  private readonly log = new Logger(GeoRunnerService.name);
  private readonly cliPath = process.env.GEO_CLI_PATH ?? this.findCli();

  private findCli(): string | null {
    const candidates = [
      '/Users/emirburgazli/.local/bin/geo',
      '/opt/homebrew/bin/geo',
      '/usr/local/bin/geo',
    ];
    return candidates.find(p => existsSync(p)) ?? null;
  }

  isAvailable(): boolean {
    return !!this.cliPath && existsSync(this.cliPath);
  }

  async runAudit(url: string, timeoutMs = 90_000): Promise<{
    score: number | null;
    methods: any[];
    queries: any[];
    rawOutput?: string;
  }> {
    if (!this.cliPath) {
      this.log.warn('Auriti GEO CLI bulunamadı — atlandı');
      return { score: null, methods: [], queries: [] };
    }

    return new Promise((resolve) => {
      const proc = spawn(this.cliPath!, ['audit', '--url', url, '--format', 'json'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => {
        proc.kill('SIGKILL');
        this.log.warn(`GEO CLI timeout: ${url}`);
        resolve({ score: null, methods: [], queries: [] });
      }, timeoutMs);

      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        this.log.error(`GEO CLI spawn error: ${err.message}`);
        resolve({ score: null, methods: [], queries: [] });
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          this.log.warn(`GEO CLI exit ${code}: ${stderr.slice(0, 200)}`);
          return resolve({ score: null, methods: [], queries: [] });
        }
        try {
          const data = JSON.parse(stdout);
          resolve({
            score: data.score ?? null,
            methods: (data.methods ?? []).slice(0, 47),
            queries: data.queries ?? [],
            rawOutput: process.env.DEBUG === 'true' ? stdout : undefined,
          });
        } catch (err: any) {
          this.log.error(`GEO JSON parse: ${err.message}`);
          resolve({ score: null, methods: [], queries: [] });
        }
      });
    });
  }
}
