import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  NOTIFICATION_PANEL_MAX_HEIGHT, NOTIFICATION_PANEL_WIDTH, notificationPanelPlacement, samePlacement, triggerHidden, unreadBadge,
} from './notification-panel';

/**
 * Bildirim listesi GORUNUR acilir (sahip, 16.11.2026: "burdaki bildirimleri kullanalım").
 *
 * Zil kenar cubugunun en altinda; liste zilin ALTINA aciliyor ve ekranin disinda kaliyordu.
 * Bu spec listenin her ekranda tamamen gorunur yere dustugunu sabitler.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const oku = (rel: string) => readFileSync(path.join(HERE, rel), 'utf8');

/** Liste ekranin icinde mi (ust kenar = ekran yuksekligi − alt − en fazla yukseklik) */
function icinde(y: ReturnType<typeof notificationPanelPlacement>, v: { width: number; height: number }) {
  const ust = v.height - y.bottom - y.maxHeight;
  return y.left >= 0 && y.left + y.width <= v.width && ust >= 0 && y.bottom >= 0;
}

describe('notificationPanelPlacement', () => {
  // Masaustu: 256 px kenar cubugu, zil sag altta (yerel panelde olculen konum)
  const ZIL = { left: 175, right: 207, top: 852 };
  const MASAUSTU = { width: 1440, height: 900 };

  it('masaustu: liste zilin USTUNDE acilir, tam genislikte ve ekranin icinde', () => {
    const y = notificationPanelPlacement(ZIL, MASAUSTU);
    expect(y.width).toBe(NOTIFICATION_PANEL_WIDTH);
    expect(y.maxHeight).toBe(NOTIFICATION_PANEL_MAX_HEIGHT);
    // Alt kenari zilin ustunde: ekranin altindan (900 − 852) + ara
    expect(y.bottom).toBe(900 - 852 + 8);
    expect(icinde(y, MASAUSTU)).toBe(true);
    // Eski hal: liste zilin altinda (top ~ 892) basliyordu → ekranin disi
    expect(MASAUSTU.height - y.bottom).toBeLessThanOrEqual(ZIL.top);
  });

  it('sag kenar zile hizalanir; sola tasacaksa ekran kenarina yaslanir', () => {
    expect(notificationPanelPlacement(ZIL, MASAUSTU).left).toBe(8);
    // Zil sagdaysa (ornegin ust cubukta): sag kenarlar hizali
    const y = notificationPanelPlacement({ left: 1300, right: 1332, top: 600 }, MASAUSTU);
    expect(y.left + y.width).toBe(1332);
  });

  it('telefon: genislik ekrana sigar, liste yine ekranin icinde', () => {
    for (const v of [{ width: 320, height: 568 }, { width: 360, height: 640 }, { width: 390, height: 844 }]) {
      const y = notificationPanelPlacement({ left: 175, right: 207, top: v.height - 48 }, v);
      expect(y.width, String(v.width)).toBeLessThanOrEqual(v.width - 16);
      expect(icinde(y, v), String(v.width)).toBe(true);
    }
  });

  it('ustte yer azsa liste kisalir ama okunur yukseklikte kalir', () => {
    const y = notificationPanelPlacement({ left: 175, right: 207, top: 300 }, { width: 1440, height: 400 });
    expect(y.maxHeight).toBe(300 - 8 - 8);
    expect(notificationPanelPlacement({ left: 175, right: 207, top: 100 }, { width: 1440, height: 200 }).maxHeight).toBe(160);
  });
});

describe('unreadBadge', () => {
  it('okunmamis yoksa rozet yok; 99 ustu "99+"', () => {
    expect(unreadBadge(0)).toBeNull();
    expect(unreadBadge(-3)).toBeNull();
    expect(unreadBadge(Number.NaN)).toBeNull();
    expect(unreadBadge(2)).toBe('2');
    expect(unreadBadge(99)).toBe('99');
    expect(unreadBadge(100)).toBe('99+');
  });
});

describe('zil bileseni', () => {
  const zil = oku('../components/notification-bell.tsx');

  it('liste sayfa govdesine cizilir ve yerini bu yardimcidan alir (kenar cubuguna sikismaz, altina acilmaz)', () => {
    expect(zil).toContain('createPortal(');
    expect(zil).toContain('notificationPanelPlacement(');
    expect(zil).not.toContain('top-full');
    expect(zil).toMatch(/style=\{\{ left: yer\.left, bottom: yer\.bottom, width: yer\.width, maxHeight: yer\.maxHeight \}\}/);
  });

  it('Escape ile kapanir, acilirken liste tazelenir, rozet erisilebilir adda soylenir', () => {
    expect(zil).toContain("e.key === 'Escape'");
    expect(zil).toMatch(/setOpen\(true\);[\s\S]{0,160}void refresh\(\)/);
    expect(zil).toContain('okunmamış');
    expect(zil).toContain('aria-expanded={open}');
  });

  it('bos durum zile neyin dusecegini soyler', () => {
    expect(zil).toContain('Henüz bildirim yok.');
    expect(zil).not.toContain('>Bildirim yok.<');
  });

  it('klavyeyle ulasilir: acilinca odak listeye gecer (liste govdenin sonunda cizilir)', () => {
    expect(zil).toContain('tabIndex={-1}');
    expect(zil).toMatch(/if \(open\) panelRef\.current\?\.focus\(/);
  });

  it('asili kalmaz: sayfa degisince, zil gizlenince ve disari basilinca (dokunmatik dahil) kapanir', () => {
    expect(zil).toMatch(/useEffect\(\(\) => \{ setOpen\(false\); \}, \[pathname\]\)/);
    expect(zil).toMatch(/d\.closest\('\[inert\]'\) \|\| triggerHidden\(r, pencere\)\) \{ setOpen\(false\); return; \}/);
    expect(zil).toContain("document.addEventListener('pointerdown', onDown)");
    expect(zil).not.toContain("'mousedown'");
  });

  it('rozet sapmaz: zaten okunmus satira tiklamak sayaci dusurmez; listenin kendi kaydirmasi yeniden yerlestirmez', () => {
    expect(zil).toMatch(/if \(!hedef \|\| hedef\.readAt\) return;/);
    expect(zil).toMatch(/if \(!panelRef\.current\?\.contains\(e\.target as Node\)\) yerlestir\(\)/);
    expect(zil).toContain('samePlacement(onceki, yeni) ? onceki : yeni');
  });

  it('panel kapsamiyla ister: deneme / odeme bildirimleri panelde gorunur (mobil uygulamada degil)', () => {
    const istemci = oku('./api.ts');
    expect(istemci).toContain("q.set('scope', 'panel')");
    expect(istemci).toContain("'/notifications/unread-count?scope=panel'");
  });
});

describe('samePlacement / triggerHidden', () => {
  const yer = { left: 8, bottom: 56, width: 360, maxHeight: 480 };

  it('ayni yer ayni sayilir (durum guncellenmez); biri bossa ya da bir sayi farkliysa farkli', () => {
    expect(samePlacement(yer, { ...yer })).toBe(true);
    expect(samePlacement(yer, { ...yer, bottom: 57 })).toBe(false);
    expect(samePlacement(null, yer)).toBe(false);
    expect(samePlacement(null, null)).toBe(true);
  });

  it('zil gizliyse (boyut sifir) ya da ekranin disindaysa (kapanan cekmece sola kayar) gizli sayilir', () => {
    const pencere = { width: 390, height: 844 };
    const zilKutusu = (left: number, top: number, w = 32, h = 32) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h });
    expect(triggerHidden(zilKutusu(175, 796), pencere)).toBe(false);
    expect(triggerHidden(zilKutusu(-81, 796), pencere)).toBe(true);      // cekmece kapali: tamamen solda
    expect(triggerHidden(zilKutusu(175, 796, 0, 0), pencere)).toBe(true); // display:none
    expect(triggerHidden(zilKutusu(400, 796), pencere)).toBe(true);
    expect(triggerHidden(zilKutusu(175, 900), pencere)).toBe(true);
  });
});
