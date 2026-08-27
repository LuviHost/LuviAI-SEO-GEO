/**
 * App Store yaratici varlik (creative asset) bulgulari — saf.
 *
 * NEDEN: Apple 2026 sonbahar dalgasi urun sayfasi yaratici varliklarini
 * arama sonuclarina tasiyor (2 bagimsiz kaynak). iTunes lookup yalniz
 * ekran goruntusu listesini ve son surum tarihini veriyor; preview video /
 * in-app event / custom product page API'de YOK — bunlar olculemez, checklist.
 *
 * Eski kod `ios.appPreviewVideos` alanina bakiyordu; alan lookup ciktisinda
 * hic yok, bu yuzden videosu olan uygulamalara bile "video yok" deniyordu.
 */

export interface IosMeta {
  screenshots?: string[];
  ipadScreenshots?: string[];
  updated?: string | null; // currentVersionReleaseDate
  version?: string | null;
}

export interface CreativeAssetState {
  iosShotHash: string;
  iosShotCount: number;
  ipadShotCount: number;
  /** Ekran goruntusu kumesinin en son degistigi zaman (ISO) */
  lastChangedAt: string;
}

export interface AssetFinding {
  severity: 'ok' | 'warning' | 'error' | 'info';
  store: 'IOS';
  field: string;
  label: string;
  current: string | number | null;
  message?: string;
  recommendation?: string;
}

/** Kucuk, bagimliliksiz djb2 — URL listesinin degisip degismedigini anlamak icin yeterli */
export function hashList(items: string[]): string {
  let h = 5381;
  const s = items.join('\n');
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export function nextCreativeAssetState(ios: IosMeta | null | undefined, prev: CreativeAssetState | null | undefined, now: Date): CreativeAssetState | null {
  if (!ios) return prev ?? null;
  const shots = ios.screenshots ?? [];
  const ipad = ios.ipadScreenshots ?? [];
  const hash = hashList([...shots, '--ipad--', ...ipad]);
  const changed = !prev || prev.iosShotHash !== hash;
  return {
    iosShotHash: hash,
    iosShotCount: shots.length,
    ipadShotCount: ipad.length,
    lastChangedAt: changed ? now.toISOString() : prev!.lastChangedAt,
  };
}

export const ASSET_STALE_DAYS = 90;

export function buildIosCreativeAssetFindings(ios: IosMeta | null | undefined, state: CreativeAssetState | null | undefined, now: Date): AssetFinding[] {
  if (!ios) return [];
  const out: AssetFinding[] = [];

  const ipad = (ios.ipadScreenshots ?? []).length;
  out.push(ipad === 0
    ? { severity: 'info', store: 'IOS', field: 'ipadScreenshots', label: 'iPad Screenshots', current: 0, message: 'iPad ekran görüntüsü yok', recommendation: 'iPad slotlarını doldur — Apple arama sonuçlarında yaratıcı varlıkları artık doğrudan gösteriyor; boş slot görünmez.' }
    : { severity: 'ok', store: 'IOS', field: 'ipadScreenshots', label: 'iPad Screenshots', current: ipad });

  // Varlik tazeligi: son surum tarihi + ekran goruntusu kumesinin son degisimi
  const released = ios.updated ? new Date(ios.updated) : null;
  const releasedDays = released && !Number.isNaN(released.getTime()) ? Math.floor((now.getTime() - released.getTime()) / 86_400_000) : null;
  const changedDays = state?.lastChangedAt ? Math.floor((now.getTime() - new Date(state.lastChangedAt).getTime()) / 86_400_000) : null;
  if (changedDays !== null && changedDays >= ASSET_STALE_DAYS) {
    out.push({
      severity: 'warning', store: 'IOS', field: 'creativeAssetsFreshness', label: 'Yaratıcı varlık tazeliği',
      current: `${changedDays} gün`,
      message: `Ekran görüntüsü seti ${changedDays} gündür değişmedi${releasedDays !== null ? ` (son sürüm ${releasedDays} gün önce${ios.version ? `, v${ios.version}` : ''})` : ''}`,
      recommendation: 'Yeni sürümle birlikte görselleri de yenile: Apple yaratıcı varlıkları arama sonuçlarında ve In-App Events\'te gösteriyor; eski görsel dönüşümü düşürür.',
    });
  } else if (changedDays !== null) {
    out.push({ severity: 'ok', store: 'IOS', field: 'creativeAssetsFreshness', label: 'Yaratıcı varlık tazeliği', current: `${changedDays} gün` });
  }

  // Olculemeyen: preview video / in-app events / custom product pages — checklist
  out.push({
    severity: 'info', store: 'IOS', field: 'video', label: 'App Preview Video',
    current: null,
    message: 'Otomatik doğrulanamıyor (iTunes lookup video vermez)',
    recommendation: '15 sn dikey preview video (localized, 3 adet) ve In-App Events — Apple 2026 yaratıcı varlıkları arama sonuçlarında gösteriyor; App Store Connect\'te kontrol et.',
  });
  return out;
}
