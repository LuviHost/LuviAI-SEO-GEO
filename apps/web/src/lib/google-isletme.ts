/**
 * Google Isletme Profili — panel sayfasi ve ucretsiz karne icin saf yardimcilar (React/Next yok;
 * google-isletme.spec.mts dogrudan calistirir).
 *
 * Sunucu: apps/api/src/gbp (gbp-denetim.ts puan + madde durumlari, gbp-kurallar.ts gonderi kurali).
 */
import type { GbpGonderi, GbpMaddeDurum, GbpYorum } from './api';

export type GbpTon = 'success' | 'warning' | 'danger' | 'info';

/** 0-100 denetim puaninin nitel etiketi. Sinirlar: 85 / 70 / 50 */
export function puanEtiketi(puan: number): { etiket: string; ton: GbpTon } {
  const p = Number.isFinite(puan) ? puan : 0;
  if (p >= 85) return { etiket: 'Güçlü profil', ton: 'success' };
  if (p >= 70) return { etiket: 'İyi, eksikleri var', ton: 'success' };
  if (p >= 50) return { etiket: 'Geliştirilmeli', ton: 'warning' };
  return { etiket: 'Zayıf profil', ton: 'danger' };
}

/** Ton → metin rengi sinifi (globals.css durum token'lari) */
export const TON_METIN: Record<GbpTon, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
};

/** Madde durumu → rozet etiketi + Badge varyanti */
export const MADDE_DURUM: Record<GbpMaddeDurum, { etiket: string; ton: GbpTon }> = {
  iyi: { etiket: 'İyi', ton: 'success' },
  uyari: { etiket: 'Uyarı', ton: 'warning' },
  eksik: { etiket: 'Eksik', ton: 'danger' },
  bilgi: { etiket: 'Bilgi', ton: 'info' },
};

const DURUM_SIRASI: Record<GbpMaddeDurum, number> = { eksik: 0, uyari: 1, bilgi: 2, iyi: 3 };

/** Once yapilacaklar: eksik → uyari → bilgi → iyi; ayni durumda agirligi yuksek olan once */
export function maddeleriSirala<T extends { durum: GbpMaddeDurum; agirlik: number }>(maddeler: T[]): T[] {
  return [...maddeler].sort((a, b) => (DURUM_SIRASI[a.durum] ?? 9) - (DURUM_SIRASI[b.durum] ?? 9) || b.agirlik - a.agirlik);
}

/** Yanitsiz yorumlar once; her grupta en yeni once (tarihsizler sonda) */
export function yorumlariSirala(yorumlar: GbpYorum[]): GbpYorum[] {
  const t = (y: GbpYorum) => (y.tarih ? Date.parse(y.tarih) || 0 : 0);
  return [...yorumlar].sort((a, b) => Number(!!a.yanit) - Number(!!b.yanit) || t(b) - t(a));
}

/** "Kadıköy, Üsküdar\nBeşiktaş" → ['Kadıköy', 'Üsküdar', 'Beşiktaş'] */
export function listeAyir(s: string): string[] {
  return s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
}

export const GONDERI_MIN = 20;
export const GONDERI_MAX = 1500;

/** Gonderi durum kodu (localPosts.state) → Turkce */
export function gonderiDurumu(durum: GbpGonderi['durum']): string {
  switch (durum) {
    case 'LIVE': return 'Yayında';
    case 'PROCESSING': return 'İşleniyor';
    case 'REJECTED': return 'Reddedildi';
    default: return durum || 'Bilinmiyor';
  }
}

/**
 * Hata → kullaniciya gosterilecek metin. Sunucunun Turkce mesajlari oldugu gibi kalir; Nest
 * throttler'in Ingilizce 429'u ("ThrottlerException: Too Many Requests") ve ham 503'ler
 * anlasilir metne cevrilir.
 */
export function gbpHataMetni(err: unknown, baglam: 'panel' | 'public'): string {
  const e = err as { status?: unknown; message?: unknown } | null;
  const status = typeof e?.status === 'number' ? e.status : null;
  const mesaj = typeof e?.message === 'string' ? e.message : '';
  const ingilizce = !mesaj || /^ThrottlerException|Too Many Requests|Service Unavailable/i.test(mesaj);
  if (status === 0) return 'Bağlantı kurulamadı. İnternet bağlantınızı kontrol edip tekrar deneyin.';
  if (status === 429) {
    if (!ingilizce) return mesaj;
    return baglam === 'public'
      ? 'Bugünkü ücretsiz Google İşletme karnesi hakkınız doldu; yarın tekrar deneyin.'
      : 'Çok sık denediniz; bir dakika bekleyip tekrar deneyin.';
  }
  if (status === 503) {
    if (!ingilizce) return mesaj;
    return baglam === 'public'
      ? 'Ücretsiz karne bugünlük kapasiteye ulaştı; yarın tekrar deneyin.'
      : 'Google İşletme denetimi şu an kullanılamıyor; biraz sonra tekrar deneyin.';
  }
  return ingilizce ? 'İşlem tamamlanamadı; biraz sonra tekrar deneyin.' : mesaj;
}
