import { api, type RunAllJobState } from '@/lib/api';

/**
 * Prompt Lab "Tümünü çalıştır" — arka plan isini baslatir/izler.
 *
 * NEDEN: tek istekli eski yol (POST prompts/run-all) 15 soruda birkac dakika
 * suruyordu; ranksup.ai Cloudflare arkasinda oldugundan istek 100 sn'de
 * kesiliyor (524), olcum sunucuda bitse de sayfa hicbir sey gostermiyordu.
 * Simdi is arka planda kosar, sayfa durumu yoklar ve her turda listeyi
 * yeniler — satirlar olculdukce dolar.
 */

const POLL_MS = 5000;
/** Yoklamanin ust siniri — 50 soru x 7 saglayici bile bunu asmamali */
const MAX_WAIT_MS = 30 * 60 * 1000;

export type RunAllOutcome =
  | { kind: 'finished'; job: RunAllJobState }
  /** Sunucu yeniden basladi ya da is bellekte yok — yazilan sonuclar DB'de */
  | { kind: 'lost' }
  | { kind: 'cancelled' }
  | { kind: 'timeout' };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Calisan isi bitene kadar izler. `onTick` her turda cagrilir (liste
 * yenileme, ilerleme metni). `isCancelled` true donerse (bilesen kalkti)
 * sessizce durur. Gecici ag hatalari yoklamayi durdurmaz.
 */
export async function watchRunAll(
  siteId: string,
  onTick: (job: RunAllJobState) => void | Promise<void>,
  isCancelled: () => boolean = () => false,
): Promise<RunAllOutcome> {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    if (isCancelled()) return { kind: 'cancelled' };
    let state: RunAllJobState | { status: 'idle' };
    try {
      state = await api.runAllPromptsStatus(siteId);
    } catch {
      continue;
    }
    if (isCancelled()) return { kind: 'cancelled' };
    if (state.status === 'idle') return { kind: 'lost' };
    await onTick(state);
    if (state.status !== 'running') return { kind: 'finished', job: state };
  }
  return { kind: 'timeout' };
}

/** "3/15 soru" — sorular secilmeden once bos */
export function runAllProgressText(job: Pick<RunAllJobState, 'done' | 'requested'>): string {
  return job.requested ? `${job.done}/${job.requested}` : '';
}
