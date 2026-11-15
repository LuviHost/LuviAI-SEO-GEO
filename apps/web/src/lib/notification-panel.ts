/**
 * Bildirim listesinin ekrandaki yeri.
 *
 * NEDEN VAR (sahip, 16.11.2026: "burdaki bildirimleri kullanalım"): zil kenar cubugunun EN
 * ALTINDA duruyor, liste ise `top-full` ile zilin ALTINA aciliyordu — yani ekranin disina. Ustelik
 * kenar cubugunun icinde cizildigi icin cubugun genisligine ve kaydirma alanina sikisiyordu.
 * Tiklayan musteri yalniz ekranin altinda ince bir kenar goruyordu; liste fiilen kullanilamiyordu.
 *
 * Liste artik sayfa govdesine (portal) cizilir ve zilin USTUNDE acilir; yeri buradan hesaplanir.
 * Sag kenari zilin sag kenarina hizalanir, ekrandan tasmayacak sekilde kaydirilir.
 */
export interface PanelPlacement {
  /** Ekranin solundan (px) */
  left: number;
  /** Ekranin ALTINDAN (px) — liste zilin ustunde biter */
  bottom: number;
  width: number;
  maxHeight: number;
}

export const NOTIFICATION_PANEL_WIDTH = 360;
export const NOTIFICATION_PANEL_MAX_HEIGHT = 480;
/** Ekran kenarindan en az bosluk */
const KENAR = 8;
/** Zil ile liste arasi */
const ARA = 8;
/** Ustte yer azsa bile liste bu kadar yukseklikten kisalmaz (kendi icinde kayar) */
const EN_AZ_YUKSEKLIK = 160;

export function notificationPanelPlacement(
  trigger: { left: number; right: number; top: number },
  viewport: { width: number; height: number },
): PanelPlacement {
  const width = Math.max(0, Math.min(NOTIFICATION_PANEL_WIDTH, viewport.width - 2 * KENAR));
  const left = Math.min(Math.max(KENAR, trigger.right - width), Math.max(KENAR, viewport.width - width - KENAR));
  const ustBosluk = trigger.top - ARA - KENAR;
  return {
    left: Math.round(left),
    bottom: Math.round(viewport.height - trigger.top + ARA),
    width: Math.round(width),
    maxHeight: Math.round(Math.max(EN_AZ_YUKSEKLIK, Math.min(NOTIFICATION_PANEL_MAX_HEIGHT, ustBosluk))),
  };
}

/** Iki yer ayni mi (ayniysa durum guncellenmez: her kaydirma olayinda yeniden cizim olmasin) */
export function samePlacement(a: PanelPlacement | null, b: PanelPlacement | null): boolean {
  if (!a || !b) return a === b;
  return a.left === b.left && a.bottom === b.bottom && a.width === b.width && a.maxHeight === b.maxHeight;
}

/**
 * Zil ekranda gorunmuyor mu: boyutu sifir (gizli) ya da tamamen ekranin disinda (telefonda
 * kapanan cekmece ekranin soluna kayar). Gorunmeyen zilin listesi kapatilir.
 */
export function triggerHidden(
  rect: { left: number; right: number; top: number; bottom: number; width: number; height: number },
  viewport: { width: number; height: number },
): boolean {
  if (rect.width <= 0 || rect.height <= 0) return true;
  return rect.right <= 0 || rect.bottom <= 0 || rect.left >= viewport.width || rect.top >= viewport.height;
}

/** Rozetteki sayi: 99'dan fazlasi "99+" */
export function unreadBadge(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return count > 99 ? '99+' : String(Math.floor(count));
}
