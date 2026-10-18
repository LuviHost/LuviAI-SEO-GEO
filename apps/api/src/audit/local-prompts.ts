/**
 * Yerel Prompt Lab sorulari — "[hizmet] + [ilce/il]" sablonlari (saf).
 *
 * NEDEN: kuafor, klinik, restoran gibi isletmeler icin gercek AI sorusu
 * yereldir ("Kadıköy'de iyi bir kuaför", "Çankaya diş kliniği"). Olcum
 * isteklerine konum bilgisi (user_location vb.) eklenmiyor; hangi bolgenin
 * soruldugu belli olsun diye konum HER soruda acikca yazilir.
 *
 * Sablonlar LLM'siz: ayni girdi her zaman ayni soruyu uretir, haftalar arasi
 * kiyas bozulmaz ve uretim maliyetsizdir. Kullanici kaydetmeden once listeyi
 * gorur ve secer.
 */
import { foldPlace, provinceOf } from './local-nap.js';

export const MAX_LOCAL_SERVICES = 5;
export const MAX_LOCAL_DISTRICTS = 5;
export const MAX_LOCAL_DRAFTS = 30;
/** Hizmet x konum basina uretilen soru (asagidaki uc kalip) */
const TEMPLATE_COUNT = 3;

/** Prompt kaydinda "yerel" isareti (GeoPrompt.source) */
export const LOCAL_PROMPT_SOURCE = 'local';
/** tags icindeki genel etiket — listede filtre/rozet icin */
export const LOCAL_TAG = 'yerel';

export interface LocalPromptSpec {
  /** Kanonik il adi ("İstanbul") */
  il: string;
  ilceler: string[];
  hizmetler: string[];
}

export type LocalTemplate = 'arama' | 'oneri' | 'en-iyi';

export interface LocalPromptDraft {
  text: string;
  il: string;
  ilce: string | null;
  hizmet: string;
  template: LocalTemplate;
}

export type SpecResult = { ok: true; spec: LocalPromptSpec } | { ok: false; error: string };

const PLACE_RE = /^[\p{L}][\p{L} .'’-]{1,39}$/u;
const SERVICE_RE = /^[\p{L}\p{N}][\p{L}\p{N} .,'’&+/-]{1,59}$/u;

/** "kadıköy" → "Kadıköy", "büyük çekmece" → "Büyük Çekmece" (Turkce buyuk harf: i → İ) */
export function titleCaseTr(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((w) => (w ? w[0].toLocaleUpperCase('tr-TR') + w.slice(1) : w))
    .join(' ');
}

function listOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  if (typeof v === 'string') return v.split(/[,;\n]/);
  return [];
}

function uniqueByFold(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const k = foldPlace(it);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

/**
 * Formdan gelen girdiyi dogrular. Il 81 ilden biri olmali (yazim kanonik
 * ada cevrilir: "istanbul" → "İstanbul"); ilce listesi tutmadigimiz icin
 * ilce yalniz bicim olarak denetlenir.
 */
export function parseLocalPromptSpec(raw: unknown): SpecResult {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const ilRaw = typeof body.il === 'string' ? body.il.trim() : '';
  if (!ilRaw) return { ok: false, error: 'İl adı gerekli.' };
  const il = provinceOf(ilRaw);
  if (!il) return { ok: false, error: `İl adı tanınmadı: «${ilRaw.slice(0, 40)}». Türkiye'deki 81 ilden birini yazın.` };

  const ilceRaw = uniqueByFold(listOf(body.ilceler ?? body.ilce).map((s) => s.trim()).filter(Boolean));
  if (ilceRaw.length > MAX_LOCAL_DISTRICTS) return { ok: false, error: `En fazla ${MAX_LOCAL_DISTRICTS} ilçe girilebilir.` };
  const ilceler: string[] = [];
  for (const d of ilceRaw) {
    if (!PLACE_RE.test(d)) return { ok: false, error: `İlçe adı 2-40 karakter olmalı ve harfle başlamalı: «${d.slice(0, 40)}»` };
    if (provinceOf(d)) return { ok: false, error: `«${d}» bir il adı; ilçe alanına ilçe ya da semt yazın.` };
    ilceler.push(titleCaseTr(d));
  }

  const hizmetler = uniqueByFold(listOf(body.hizmetler ?? body.hizmet).map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean));
  if (!hizmetler.length) return { ok: false, error: 'En az bir hizmet yazın (ör. kuaför, diş kliniği).' };
  if (hizmetler.length > MAX_LOCAL_SERVICES) return { ok: false, error: `En fazla ${MAX_LOCAL_SERVICES} hizmet girilebilir.` };
  for (const h of hizmetler) {
    if (!SERVICE_RE.test(h)) return { ok: false, error: `Hizmet adı 2-60 karakter olmalı: «${h.slice(0, 60)}»` };
  }

  const count = (ilceler.length || 1) * hizmetler.length * TEMPLATE_COUNT;
  if (count > MAX_LOCAL_DRAFTS) {
    return { ok: false, error: `Bu seçimle ${count} soru oluşur; en fazla ${MAX_LOCAL_DRAFTS}. İlçe ya da hizmet sayısını azaltın.` };
  }
  return { ok: true, spec: { il, ilceler, hizmetler } };
}

// ────────────────────────────────────────────────────────────
//  BULUNMA HALI EKI (-de/-da/-te/-ta) — ozel adlarda kesme isaretiyle
// ────────────────────────────────────────────────────────────

const BACK_VOWELS = 'aıou';
const FRONT_VOWELS = 'eiöü';
/** Sert unsuzler ("fıstıkçı şahap"): ek -te/-ta olur */
const HARD_CONSONANTS = 'fstkçşhp';

/**
 * Iyelik ekiyle biten bilesik yer adlari ek alirken araya "n" girer:
 * Beyoğlu'nda, Zeytinburnu'nda, Beylikdüzü'nde, Gölbaşı'nda, Konyaaltı'nda,
 * Kuşadası'nda, Odunpazarı'nda. Liste yaygin sonlarla sinirli; bilinmeyen
 * bir ad genel kurala duser ve kullanici kaydetmeden once metni gorur.
 */
const POSSESSIVE_ENDINGS = ['oğlu', 'burnu', 'düzü', 'başı', 'altı', 'adası', 'pazarı', 'hisarı', 'pınarı', 'köprüsü', 'suyu', 'ağzı', 'boğazı', 'hanı'];
const POSSESSIVE_NAMES = new Set(['kocaeli', 'kırklareli', 'tunceli']);

/** "Kadıköy" → "Kadıköy'de", "Beşiktaş" → "Beşiktaş'ta", "Beyoğlu" → "Beyoğlu'nda" */
export function locativeTr(name: string): string {
  const base = name.trim();
  const lower = base.toLocaleLowerCase('tr-TR');
  let vowel = 'e';
  for (let i = lower.length - 1; i >= 0; i--) {
    if (BACK_VOWELS.includes(lower[i])) { vowel = 'a'; break; }
    if (FRONT_VOWELS.includes(lower[i])) { vowel = 'e'; break; }
  }
  const lastWord = lower.split(' ').pop() ?? lower;
  if (POSSESSIVE_NAMES.has(lastWord) || POSSESSIVE_ENDINGS.some((e) => lastWord.endsWith(e))) {
    return `${base}'nd${vowel}`;
  }
  const last = lower[lower.length - 1];
  return `${base}'${HARD_CONSONANTS.includes(last) ? 't' : 'd'}${vowel}`;
}

// ────────────────────────────────────────────────────────────
//  SABLONLAR
// ────────────────────────────────────────────────────────────

/**
 * Uc kalip, hem isletme turuyle ("kuaför") hem hizmetle ("saç boyama")
 * dogal okunacak bicimde:
 *   arama  — arama kutusu dili:        "Kadıköy kuaför"
 *   oneri  — sohbet, il + ilce:        "İstanbul Kadıköy'de kuaför için nereyi önerirsin?"
 *   en-iyi — karsilastirma:            "Kadıköy civarında en iyi kuaför önerileri"
 * Ilce yoksa ayni kaliplar il duzeyinde kurulur.
 */
function draftsFor(il: string, ilce: string | null, hizmet: string): LocalPromptDraft[] {
  if (ilce) {
    return [
      { template: 'arama', text: `${ilce} ${hizmet}` },
      { template: 'oneri', text: `${il} ${locativeTr(ilce)} ${hizmet} için nereyi önerirsin?` },
      { template: 'en-iyi', text: `${ilce} civarında en iyi ${hizmet} önerileri` },
    ].map((d) => ({ ...d, il, ilce, hizmet })) as LocalPromptDraft[];
  }
  return [
    { template: 'arama', text: `${il} ${hizmet}` },
    { template: 'oneri', text: `${locativeTr(il)} ${hizmet} için nereyi önerirsin?` },
    { template: 'en-iyi', text: `${il} genelinde en iyi ${hizmet} önerileri` },
  ].map((d) => ({ ...d, il, ilce: null, hizmet })) as LocalPromptDraft[];
}

export function buildLocalPrompts(spec: LocalPromptSpec): LocalPromptDraft[] {
  const out: LocalPromptDraft[] = [];
  const seen = new Set<string>();
  const districts = spec.ilceler.length ? spec.ilceler : [null];
  for (const hizmet of spec.hizmetler) {
    for (const ilce of districts) {
      for (const d of draftsFor(spec.il, ilce, hizmet)) {
        const key = foldPlace(d.text);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(d);
      }
    }
  }
  return out.slice(0, MAX_LOCAL_DRAFTS);
}

// ────────────────────────────────────────────────────────────
//  ETIKETLER — konum bilgisi GeoPrompt.tags icinde (sema degisikligi yok)
// ────────────────────────────────────────────────────────────

export interface LocalPromptMeta {
  il: string | null;
  ilce: string | null;
  hizmet: string | null;
}

export function localTags(d: Pick<LocalPromptDraft, 'il' | 'ilce' | 'hizmet'>): string[] {
  return [LOCAL_TAG, `il:${d.il}`, ...(d.ilce ? [`ilce:${d.ilce}`] : []), `hizmet:${d.hizmet}`];
}

/** tags → konum; yerel etiketi yoksa null */
export function readLocalTags(tags: unknown): LocalPromptMeta | null {
  if (!Array.isArray(tags) || !tags.includes(LOCAL_TAG)) return null;
  const get = (prefix: string) => {
    const t = tags.find((x): x is string => typeof x === 'string' && x.startsWith(prefix));
    return t ? t.slice(prefix.length) || null : null;
  };
  return { il: get('il:'), ilce: get('ilce:'), hizmet: get('hizmet:') };
}

/** Prompt yerel mi — kaynak ya da etiket (elle eklenip etiketlenmis olabilir) */
export function isLocalPrompt(p: { source?: string | null; tags?: unknown }): boolean {
  return p.source === LOCAL_PROMPT_SOURCE || readLocalTags(p.tags) !== null;
}
