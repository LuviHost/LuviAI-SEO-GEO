import { SetMetadata } from '@nestjs/common';

export const SESSION_ONLY_KEY = 'sessionOnly';

/**
 * Rota yalniz panel oturumuyla (NextAuth) cagrilabilir; API anahtari 403 alir.
 *
 * NEDEN: anahtar kapsami yol → kaynak eslesmesiyle belirleniyor ve eslesmeyen
 * kaynaklarda (orn. /aso) HERHANGI bir ':write' anahtari mutasyon yapabiliyor.
 * Musterinin canli App Store kaydina yazan uclar icin bu kabul edilemez —
 * insan onayi panelde verilmeli. AuthGuard API anahtari dalinda bunu okur.
 */
export const SessionOnly = () => SetMetadata(SESSION_ONLY_KEY, true);
