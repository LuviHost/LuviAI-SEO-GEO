/**
 * Ücretsiz AI görünürlük testinin denemeleri — yönetim paneli metinleri (/admin/leads).
 * Sunucu: apps/api/src/audit/public-check-attempt.ts (sonuç adları oradakiyle aynı olmalı).
 *
 * 14.11.2026, sahip: "üye olmadan tarayan herkesi kaydetmek istiyorum, kaçırmak istemiyorum".
 * Ölçüm listesi yalnız TAZE ölçümü gösterir; kayıtlı sonucu gören, sınıra takılan ve
 * tamamlanamayan deneme ayrı listede durur.
 */

export type DenemeSonucu = 'measured' | 'cached' | 'rate_limited' | 'budget' | 'failed';

/** Test edilen alan adını sitesi olarak ekleyen üye (eşleşme alan adıyla, IP ile değil) */
export interface TestUyesi {
  name: string | null;
  email: string | null;
  plan: string | null;
  status: string | null;
  siteAddedAt: string;
}

export interface TestDenemesi {
  id: string;
  domain: string;
  outcome: string;
  checkId: string | null;
  detail: string | null;
  notifiedAt: string | null;
  createdAt: string;
  member?: TestUyesi | null;
}

const ETIKET: Record<DenemeSonucu, string> = {
  measured: 'Ölçüldü',
  cached: 'Kayıtlı sonucu gördü',
  rate_limited: 'Haftalık sınıra takıldı',
  budget: 'Günlük tavana takıldı',
  failed: 'Tamamlanamadı',
};

const ACIKLAMA: Record<DenemeSonucu, string> = {
  measured: 'Yeni ölçüm yapıldı; ayrıntısı aşağıdaki ölçüm listesinde.',
  cached: 'Bu alan adı daha önce ölçülmüştü. Ziyaretçi o sonucu gördü, yeni ölçüm yapılmadı.',
  // "Ziyaretçi başka bir alan adını test etmişti" DENMEZ: sınır IP başınadır, aynı ağdaki başka biri de olabilir
  rate_limited: 'Aynı IP adresinden bu hafta başka bir alan adı test edilmişti; bu deneme ölçülmedi.',
  budget: 'Günlük ücretsiz test tavanı dolmuştu; bu deneme ölçülmedi.',
  failed: 'Alan adı çözülemedi, siteye ulaşılamadı ya da ölçüm sırasında hata oluştu.',
};

/** Ton: yalnız metin rengi (çerçeveli rozet düğmeye benziyor — panel kuralı) */
const TON: Record<DenemeSonucu, string> = {
  measured: 'text-success',
  cached: 'text-foreground',
  rate_limited: 'text-warning',
  budget: 'text-warning',
  failed: 'text-muted-foreground',
};

const bilinen = (o: string): o is DenemeSonucu => o in ETIKET;

/** Bilinmeyen sonuç adı (eski / yeni sunucu farkı) olduğu gibi gösterilir */
export function denemeEtiketi(outcome: string): string {
  return bilinen(outcome) ? ETIKET[outcome] : outcome;
}

export function denemeAciklamasi(outcome: string): string {
  return bilinen(outcome) ? ACIKLAMA[outcome] : '';
}

export function denemeTonu(outcome: string): string {
  return bilinen(outcome) ? TON[outcome] : 'text-muted-foreground';
}

/*
 * ZİYARETÇİ EŞLEŞTİRMESİ BİLEREK YOK: gizlilik metni "IP özeti yalnız kötüye kullanımı önlemek ve
 * test hakkını sınırlamak içindir" diyor. Denemeleri IP özetine göre gruplayıp "aynı ziyaretçi 3
 * deneme yaptı" diye göstermek bu amacın dışına çıkar. İstenirse önce gizlilik metni güncellenir.
 */

const UYE_DURUMU: Record<string, string> = {
  TRIAL: 'deneme',
  ACTIVE: 'ödeyen',
  PAST_DUE: 'ödemesi gecikmiş',
  CANCELLED: 'iptal etmiş',
  CANCELED: 'iptal etmiş',
  EXPIRED: 'süresi dolmuş',
};

/**
 * "Üye oldu" satırı: "Batuhan Kartal · k@ornek.com · deneme". Ad yoksa yalnız e-posta;
 * bilinmeyen durum adı olduğu gibi (küçük harfle) gösterilir.
 */
export function uyeMetni(m: TestUyesi | null | undefined): string {
  if (!m) return '';
  const durum = m.status ? (UYE_DURUMU[m.status] ?? m.status.toLowerCase()) : '';
  return [m.name, m.email, durum].filter(Boolean).join(' · ');
}

/** Deneme bugün mü (Türkiye günü; TR = UTC+3, yaz saati yok) */
export function bugunMu(iso: string, now: Date = new Date()): boolean {
  const gun = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
  const d = new Date(iso);
  return !Number.isNaN(d.getTime()) && gun(d) === gun(now);
}

/** "14.11.2026 18:15" — Türkiye saatiyle, tarayıcının saat diliminden bağımsız */
export function denemeZamani(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
}
