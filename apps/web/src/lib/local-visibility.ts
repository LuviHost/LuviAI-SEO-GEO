/**
 * Yerel gorunurluk (Prompt Lab yerel mod) + GA4 donusum kontrolu — tipler ve
 * durum metinleri.
 *
 * Sunucu: apps/api/src/audit/prompt-lab.service.ts (LocalRunSummary,
 * SiteNapView), apps/api/src/audit/local-nap.ts (durum kodlari),
 * apps/api/src/analytics/ga-key-events.ts (GA4 kontrolu). Metinler olculen
 * seyi soyler; siralama ya da "garanti" iddiasi icermez.
 */

export type PhoneStatus = 'eslesiyor' | 'farkli' | 'yok' | 'bilinmiyor' | 'olculmedi';
export type AddressStatus = 'eslesiyor' | 'kismen' | 'eslesmiyor' | 'dogrulanamadi' | 'yok' | 'bilinmiyor' | 'olculmedi';
export type Tone = 'success' | 'warning' | 'danger' | 'muted';

export interface LocalPromptMeta {
  il: string | null;
  ilce: string | null;
  hizmet: string | null;
}

export interface SiteNapView {
  status: 'ok' | 'empty' | 'unavailable';
  phones: string[];
  addresses: Array<{ street: string | null; district: string | null; city: string | null }>;
  sources: string[];
  businessTypes: string[];
  pages: string[];
  reason: string | null;
  collectedAt: string | null;
  lastError: string | null;
}

export interface LocalProviderResult {
  provider: string;
  label: string;
  measured: boolean;
  mentioned: boolean;
  cited: boolean;
  phone: { status: PhoneStatus; found: string[] };
  /** otherCity: eslesmiyor durumunda adreste gecen baska il */
  address: { status: AddressStatus; snippet: string | null; matched: string[]; otherCity?: string | null };
}

export interface LocalRunSummary {
  location: LocalPromptMeta | null;
  siteNap: SiteNapView | null;
  providers: LocalProviderResult[];
  napChecked: boolean;
  runAt: string;
}

export interface LocalPromptDraft {
  text: string;
  il: string;
  ilce: string | null;
  hizmet: string;
  template: 'arama' | 'oneri' | 'en-iyi';
  exists: boolean;
}

export interface LocalPromptInput {
  il: string;
  ilceler: string[];
  hizmetler: string[];
}

export const PHONE_LABEL: Record<PhoneStatus, { text: string; tone: Tone }> = {
  eslesiyor: { text: 'Telefon sitendekiyle aynı', tone: 'success' },
  farkli: { text: 'Markanın yanında farklı bir numara geçti', tone: 'danger' },
  yok: { text: 'Telefon verilmedi', tone: 'muted' },
  bilinmiyor: { text: 'Sitende telefon bulunamadı — karşılaştırılamadı', tone: 'muted' },
  olculmedi: { text: 'Telefon bu ölçümde kontrol edilemedi', tone: 'muted' },
};

export const ADDRESS_LABEL: Record<AddressStatus, { text: string; tone: Tone }> = {
  eslesiyor: { text: 'Adres sitendeki ilçe/il ile uyumlu', tone: 'success' },
  kismen: { text: 'Adres kısmen uyumlu (ilçe ya da il tutmuyor)', tone: 'warning' },
  eslesmiyor: { text: 'Adreste sitendekinden farklı bir il geçiyor', tone: 'danger' },
  dogrulanamadi: { text: 'Adres geçti ama ilçe/il ile doğrulanamadı — kontrol et', tone: 'warning' },
  yok: { text: 'Adres verilmedi', tone: 'muted' },
  bilinmiyor: { text: 'Sitende adres bulunamadı — karşılaştırılamadı', tone: 'muted' },
  olculmedi: { text: 'Adres bu ölçümde kontrol edilemedi', tone: 'muted' },
};

export const TONE_CLASS: Record<Tone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  muted: 'text-muted-foreground',
};

export function placeLabel(m: LocalPromptMeta | null | undefined): string | null {
  if (!m) return null;
  const parts = [m.ilce, m.il].filter((x): x is string => !!x);
  return parts.length ? parts.join(' / ') : null;
}

// ──────────────────────────────────────────────────────────
//  GA4 donusum kontrolu
// ──────────────────────────────────────────────────────────

export type ConversionKind = 'phone' | 'form';
export type ConversionStatus = 'tamam' | 'tetiklenmedi' | 'anahtar_degil' | 'yok';

export interface ConversionCheck {
  kind: ConversionKind;
  status: ConversionStatus;
  keyEvents: Array<{ name: string; count: number }>;
  candidates: Array<{ name: string; count: number }>;
}

export type GaKeyEventSetup =
  | { status: 'not_connected' }
  | { status: 'error'; message: string }
  | {
      status: 'ok';
      propertyId: string;
      days: number;
      checks: ConversionCheck[];
      keyEvents: string[];
      keyEventsSource: 'admin' | 'report';
      adminNote: string | null;
      fetchedAt: string;
    };
