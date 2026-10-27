/**
 * Google Isletme Profili → yerel AI soru taslagi (il, ilce, hizmet). Saf.
 *
 * NEDEN: Prompt Lab'in "yerel sorular" modu (audit/local-prompts.ts) il/ilce/hizmet ister ve kullanici bunlari
 * elle yaziyordu. Profil zaten il, ilce ve birincil kategoriyi biliyor; bunlardan ON DOLDURULMUS bir oneri cikar,
 * kullanici duzeltip mevcut onizleme/olusturma akisiyla (prompts/local/preview → prompts/local) kaydeder.
 * Burada soru OLUSTURULMAZ; yalniz parseLocalPromptSpec'e uygun girdi onerilir.
 */
import { placeAdresi, type PlaceDetay } from './gbp-denetim.js';

export interface YerelSoruOnerisi {
  il: string | null;
  ilceler: string[];
  hizmetler: string[];
}

export function yerelSoruOnerisi(p: PlaceDetay): YerelSoruOnerisi {
  const adr = placeAdresi(p);
  const kategori = (p.primaryTypeDisplayName?.text ?? '').trim();
  // "Kafe" → "kafe": soru sablonu "Kadıköy'de iyi bir kafe öner" gibi cumle ici kullanir
  const hizmet = kategori ? kategori.toLocaleLowerCase('tr-TR') : '';
  const ilce = adr.district && adr.district !== adr.city ? adr.district : null;
  return {
    il: adr.city,
    ilceler: ilce ? [ilce] : [],
    hizmetler: hizmet ? [hizmet] : [],
  };
}
