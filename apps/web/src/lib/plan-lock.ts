/**
 * Plana kilitli takvim yazisi — saf, test edilir (plan-lock.spec.mts).
 *
 * NEDEN: ucretsiz deneme hesabi yapay zekayla toplam 2 makale uretir (sahip karari
 * 20.10.2026; api billing/quota.service LIMITS.TRIAL). Kurulumda takvime 8'e kadar
 * konu yerlesir; hakki asan konular uretilmez, plan yukseltilene kadar SCHEDULED
 * bekler. Panel onlari siradan "Takvimde" yazisi gibi gosterirse musteri yazinin
 * zamani gelince yazilacagini sanar, "Simdi uret" de 403 doner.
 *
 * Kilit karari SUNUCUDAN gelir (api articles/plan-lock.ts, yazi alani
 * `lockedByPlan`); panel tahmin etmez. Alan yoksa (eski API) yazi kilitli sayilmaz.
 *
 * Kilitli kartin govdesindeki metin YER TUTUCUDUR: tarayicida, yazi kimliginden
 * tohumlanan sabit bir kelime listesiyle uretilir, bulaniklastirilarak gosterilir.
 * Hicbir model cagrilmaz, hicbir yere kaydedilmez; metin "yazi hazir" demez,
 * "planini yukselttiginde yazilir" der.
 */

export interface PlanLockable {
  id?: unknown;
  status?: unknown;
  lockedByPlan?: unknown;
  scheduledAt?: unknown;
}

/** Yukseltme sayfasi (fiyatlandirma) */
export const UPGRADE_HREF = '/pricing';

/** Kilitli yazinin tum metinleri tek yerde: tablo, yazi sayfasi ve ozet ayni dili konusur */
export const PLAN_LOCK_COPY = {
  badge: 'Kilitli',
  title: 'Bu makale planını yükselttiğinde yazılır',
  body: 'Ücretsiz denemede yapay zekâ toplam 2 makale yazar ve bu hak doldu. Konu takviminde duruyor; makale henüz yazılmadı. Planını yükselttiğinde takvimdeki sırasıyla yazılır (otomatik akış durdurulmuşsa “Şimdi üret” ile başlatırsın).',
  placeholderNote: 'Aşağıdaki bulanık metin yalnızca yer tutucudur; makalenin içeriği değildir.',
  cta: 'Planını yükselt',
  rowHint: 'Planını yükselttiğinde yazılır',
} as const;

/** Sunucu bu yaziyi plana kilitli isaretledi mi (yalniz takvimdeki yazi kilitli olabilir) */
export function isPlanLocked(a: PlanLockable | null | undefined): boolean {
  return !!a && a.lockedByPlan === true && a.status === 'SCHEDULED';
}

/** Takvimdeki yazilar: toplam ve kilitli */
export function scheduledCounts(articles: ReadonlyArray<PlanLockable> | null | undefined): { scheduled: number; locked: number } {
  let scheduled = 0;
  let locked = 0;
  for (const a of articles ?? []) {
    if (a?.status !== 'SCHEDULED') continue;
    scheduled++;
    if (isPlanLocked(a)) locked++;
  }
  return { scheduled, locked };
}

const timeOf = (v: unknown): number => {
  const t = typeof v === 'string' || v instanceof Date ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
};

/** Takvimdeki yazilar vade sirasiyla; kilitliler ayri. "Siradaki yazi" kilitli olamaz. */
export function splitScheduled<T extends PlanLockable>(articles: ReadonlyArray<T> | null | undefined): { open: T[]; locked: T[] } {
  const scheduled = (articles ?? []).filter((a) => a?.status === 'SCHEDULED');
  const sorted = [...scheduled].sort((a, b) => timeOf(a.scheduledAt) - timeOf(b.scheduledAt));
  return { open: sorted.filter((a) => !isPlanLocked(a)), locked: sorted.filter((a) => isPlanLocked(a)) };
}

// ── Yer tutucu metin ─────────────────────────────────────────────────────────

/** Notr kelime listesi: bulanik metin bir makale gibi gorunsun ama bir sey iddia etmesin */
const FILLER_WORDS = [
  'içerik', 'arama', 'yanıt', 'soru', 'marka', 'rehber', 'adım', 'örnek', 'kaynak', 'başlık',
  'okur', 'konu', 'öneri', 'sonuç', 'ölçüm', 'görünürlük', 'sayfa', 'bölüm', 'ayrıntı', 'karşılaştırma',
  've', 'ile', 'için', 'gibi', 'daha', 'her', 'bu', 'çok', 'nasıl', 'neden',
  'kullanıcı', 'hizmet', 'süreç', 'plan', 'liste', 'tablo', 'özet', 'ipucu', 'hata', 'çözüm',
];

/** Kimlikten 32 bitlik tohum (FNV-1a): ayni yazi her cizimde ayni yer tutucuyu alir, titremez */
function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — kucuk, tohumlu sozde rastgele uretec (yalniz gorsel yer tutucu icin) */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Bulanik gosterilecek yer tutucu paragraflar. Tarayicida, tohumlu: model yok, ag yok,
 * kayit yok. Ayni tohum ayni metni verir (sayfa yenilenince titremez).
 */
export function placeholderParagraphs(seed: string, opts: { paragraphs?: number; sentences?: number } = {}): string[] {
  const next = rng(seedOf(seed || 'kilitli'));
  const pick = () => FILLER_WORDS[Math.floor(next() * FILLER_WORDS.length)];
  const paragraphs = Math.max(1, Math.min(8, opts.paragraphs ?? 4));
  const sentences = Math.max(1, Math.min(8, opts.sentences ?? 4));
  const out: string[] = [];
  for (let p = 0; p < paragraphs; p++) {
    const parts: string[] = [];
    for (let s = 0; s < sentences; s++) {
      const n = 6 + Math.floor(next() * 9);
      const words = Array.from({ length: n }, pick);
      parts.push(`${words[0].charAt(0).toLocaleUpperCase('tr-TR')}${words[0].slice(1)} ${words.slice(1).join(' ')}.`);
    }
    out.push(parts.join(' '));
  }
  return out;
}
