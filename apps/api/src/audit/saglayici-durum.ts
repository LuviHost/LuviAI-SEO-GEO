/**
 * Havuz (sistem) anahtarli AI saglayicilarinin kredi durumu (27.11.2026).
 *
 * NEDEN: Gemini on odemeli kredisi 25.11'den beri bitikti (402 "prepayment credits are depleted");
 * hata yalniz sunucu kaydina ERROR olarak dusuyordu, kimse gormedi ve iki gun boyunca musteri
 * olcumlerinde Gemini yoktu. Cogu saglayici (Anthropic, OpenAI, Gemini, Perplexity, Meta) bakiye
 * API'si sunmadigi icin durum KENDI cagrilarimizdan cikarilir:
 *   - son basarili havuz cagrisi  → "çalışıyor"
 *   - son "kredi bitti" hatasi (probe-retry.ts 'billing') bundan yeniyse → "kredi bitti"
 * Bakiye API'si olanlar (DeepSeek, DataForSEO) ayrica sorgulanir (llm/saglayici-kredi.service.ts).
 *
 * Yalniz HAVUZ anahtari: BYOK (musterinin kendi anahtari) hatasi bizim kredimiz degildir.
 * Kayit kv_store'da tek JSON: `saglayici-durum:<provider>`.
 */

export const SAGLAYICI_DURUM_KV = 'saglayici-durum:';

/** Basarili cagri her olcumde olur: DB'ye en fazla bu aralikla yazilir (surec bellegi) */
export const BASARI_YAZIM_ARALIGI_MS = 10 * 60_000;

export interface SaglayiciDurumKaydi {
  /** Son basarili havuz cagrisi (ISO) */
  sonBasari?: string;
  /** Son "kredi bitti" hatasi (ISO) */
  sonKrediHatasi?: string;
  /** Hatanin kisa, guvenli ozeti (probeErrorExcerpt) */
  krediMesaji?: string;
}

export type KrediDurumu = 'CALISIYOR' | 'KREDI_BITTI' | 'BILINMIYOR';

/** Kredi hatasi son basaridan yeniyse "bitti"; yalniz basari varsa "calisiyor" */
export function krediDurumu(k: SaglayiciDurumKaydi | null | undefined): KrediDurumu {
  const basari = k?.sonBasari ? Date.parse(k.sonBasari) : NaN;
  const hata = k?.sonKrediHatasi ? Date.parse(k.sonKrediHatasi) : NaN;
  if (Number.isFinite(hata) && (!Number.isFinite(basari) || hata >= basari)) return 'KREDI_BITTI';
  if (Number.isFinite(basari)) return 'CALISIYOR';
  return 'BILINMIYOR';
}

export function durumOku(value: string | null | undefined): SaglayiciDurumKaydi {
  if (!value) return {};
  try {
    const j = JSON.parse(value);
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

interface KvPrisma {
  kvStore: {
    findUnique(a: { where: { key: string } }): Promise<{ value: string } | null>;
    upsert(a: { where: { key: string }; create: { key: string; value: string }; update: { value: string } }): Promise<unknown>;
  };
}

const sonBasariYazimi = new Map<string, number>();

async function guncelle(prisma: KvPrisma, provider: string, degisiklik: SaglayiciDurumKaydi): Promise<void> {
  const key = SAGLAYICI_DURUM_KV + provider;
  const eski = durumOku((await prisma.kvStore.findUnique({ where: { key } }))?.value);
  const value = JSON.stringify({ ...eski, ...degisiklik });
  await prisma.kvStore.upsert({ where: { key }, create: { key, value }, update: { value } });
}

/** Basarili havuz cagrisi. Olcum yolunu yavaslatmaz: hata yutulur, yazim seyreltilir. */
export async function saglayiciBasariKaydet(prisma: KvPrisma, provider: string, simdi: Date = new Date()): Promise<void> {
  const son = sonBasariYazimi.get(provider) ?? 0;
  if (simdi.getTime() - son < BASARI_YAZIM_ARALIGI_MS) return;
  sonBasariYazimi.set(provider, simdi.getTime());
  await guncelle(prisma, provider, { sonBasari: simdi.toISOString() }).catch(() => undefined);
}

/** "Kredi bitti" hatasi (seyrek): her seferinde yazilir; sonraki basari kaydini da hemen acar. */
export async function saglayiciKrediHatasiKaydet(prisma: KvPrisma, provider: string, mesaj: string, simdi: Date = new Date()): Promise<void> {
  // Yukleme sonrasi ilk basari bekletilmeden yazilsin: panel "bitti"de takili kalmasin
  sonBasariYazimi.delete(provider);
  await guncelle(prisma, provider, { sonKrediHatasi: simdi.toISOString(), krediMesaji: mesaj.slice(0, 200) }).catch(() => undefined);
}

/** Testler icin */
export function _basariSeyreltmeSifirla(): void {
  sonBasariYazimi.clear();
}
