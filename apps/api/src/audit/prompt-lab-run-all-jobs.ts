import { Inject, Injectable, Logger } from '@nestjs/common';
import { MeasurementAllowanceService } from '../billing/measurement-allowance.service.js';
import { PromptLabService } from './prompt-lab.service.js';

/**
 * Prompt Lab "Tümünü çalıştır" — ARKA PLAN isi.
 *
 * NEDEN: runAll sorulari sirayla, her biri icin tum saglayicilara sorar; 15
 * soru birkac dakika surer. ranksup.ai Cloudflare arkasinda ve Cloudflare
 * kaynaga en fazla 100 sn bekler: tek istekli eski yolda tarayici 524 aliyor,
 * nginx 499 yaziyor, olcum sunucuda surse de sayfa hicbir sey gostermiyordu
 * (25.10.2026, site cmvmzrhm900w2aryxvwqd8qvn).
 *
 * HAK: haftalik olcum hakki ISTEK basina degil IS basina — allowance.run()
 * isin tamamini sarar. Hak dolu ise start() 429'u ANINDA firlatir (is
 * baslamaz); hic gercek olcum olmazsa hak iade edilir (run() kurali).
 *
 * SINIR: durum bellekte tutulur; API tek surec (ecosystem: fork, 1 instance).
 * Yeniden baslatmada calisan is yarida kalir ve durum 'idle' doner — sayfa
 * yoklamayi birakir, yazilmis sonuclar DB'de kalir.
 */

export type RunAllJobStatus = 'running' | 'done' | 'failed';

export interface RunAllJobState {
  status: RunAllJobStatus;
  scope: 'all' | 'local';
  startedAt: string;
  finishedAt: string | null;
  /** Calistirilacak soru sayisi; sorular secilene kadar null */
  requested: number | null;
  /** Bitirilen (basarili + basarisiz) soru sayisi */
  done: number;
  ran: number;
  failed: number;
  error: string | null;
  /** start(): ayni sitede zaten calisan is dondu (yeni hak harcanmadi) */
  alreadyRunning?: boolean;
}

type AccountUser = { id?: string; role?: string | null } | null | undefined;

/** Biten isin durumu bu kadar sure sorgulanabilir; sonra bellekten atilir. */
const FINISHED_TTL_MS = 6 * 60 * 60 * 1000;

@Injectable()
export class PromptLabRunAllJobs {
  private readonly log = new Logger(PromptLabRunAllJobs.name);
  private readonly jobs = new Map<string, RunAllJobState>();

  constructor(
    @Inject(PromptLabService) private readonly lab: PromptLabService,
    @Inject(MeasurementAllowanceService) private readonly allowance: MeasurementAllowanceService,
  ) {}

  status(siteId: string): RunAllJobState | { status: 'idle' } {
    const job = this.jobs.get(siteId);
    return job ? { ...job } : { status: 'idle' };
  }

  /**
   * Isi baslatir ve hak ayrildiktan sonra doner. Ayni sitede calisan is
   * varsa yenisini baslatmaz, onu dondurur — cift tik hak yakmaz.
   */
  async start(
    siteId: string,
    user: AccountUser,
    opts: { withFanout?: boolean; limit?: number; scope?: string } = {},
  ): Promise<RunAllJobState> {
    this.prune();
    const current = this.jobs.get(siteId);
    if (current?.status === 'running') return { ...current, alreadyRunning: true };

    // Yer tutucu await'ten ONCE yazilir: eszamanli iki istek ikinci kez hak
    // ayirmasin, ikincisi calisan isi gorsun.
    const job: RunAllJobState = {
      status: 'running',
      scope: opts.scope === 'local' ? 'local' : 'all',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      requested: null,
      done: 0,
      ran: 0,
      failed: 0,
      error: null,
    };
    this.jobs.set(siteId, job);

    let begun = false;
    let markBegun!: () => void;
    const begunSignal = new Promise<void>((resolve) => { markBegun = resolve; });

    const run = this.allowance.run(user, async () => {
      begun = true;
      markBegun();
      return this.lab.runAll(siteId, {
        ...opts,
        onProgress: (p) => {
          job.requested = p.requested;
          job.done = p.done;
          job.failed = p.failed;
          job.ran = p.done - p.failed;
        },
      });
    });

    run.then(
      (res) => {
        job.status = 'done';
        job.requested = res.requested;
        job.ran = res.ran;
        job.failed = res.failed.length;
        job.done = res.ran + res.failed.length;
        job.finishedAt = new Date().toISOString();
      },
      (err: any) => {
        if (!begun) {
          // Hak ayrilamadi (or. haftalik sinir) — is hic baslamadi
          if (this.jobs.get(siteId) === job) this.jobs.delete(siteId);
          return;
        }
        this.log.warn(`[${siteId}] Tumunu calistir isi yarida kaldi: ${err?.message ?? err}`);
        job.status = 'failed';
        job.error = String(err?.message ?? 'bilinmeyen hata').slice(0, 200);
        job.finishedAt = new Date().toISOString();
      },
    );

    // Hak hatasi (429) burada cagirana gecer; hak ayrildiysa hemen doner.
    await Promise.race([begunSignal, run]);
    return { ...job };
  }

  private prune() {
    const now = Date.now();
    for (const [siteId, job] of this.jobs) {
      if (job.status !== 'running' && job.finishedAt && now - Date.parse(job.finishedAt) > FINISHED_TTL_MS) {
        this.jobs.delete(siteId);
      }
    }
  }
}
