import { jsonrepair } from 'jsonrepair';

/**
 * LLM'den gelen JSON'u parse et. Standart JSON.parse fail olursa
 * jsonrepair ile onar ve tekrar dene. İkisi de fail olursa fırlat.
 */
export function safeParseJson<T = any>(raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (e1: any) {
    try {
      const repaired = jsonrepair(raw);
      return JSON.parse(repaired) as T;
    } catch (e2: any) {
      const preview = raw.slice(0, 300).replace(/\n/g, ' ');
      throw new Error(`safeParseJson fail: ${e1.message} | repair fail: ${e2.message} | raw[0..300]=${preview}`);
    }
  }
}

/**
 * LLM ciktisindan JSON GOVDESINI ayikla, sonra parse et.
 *
 * NEDEN VAR: safeParseJson tek basina "Iste 3 soru:\n[...]" gibi onsozlu
 * ciktida HATA VERMEZ — jsonrepair onsozu ve diziyi 2 elemanli bir diziye
 * SARAR. Sonuc sessizce bozuk olur: onsoz cumlesi gercek bir "soru" sanilip
 * saglayicilara sorulur, ya da urun listesi kaybolur.
 *
 * Opus 5 gibi daha konuskan modellerde onsoz/sonsoz olasiligi yuksek oldugu
 * icin JSON bekleyen HER cagri bunu kullanmali.
 *
 * Once ``` fence'leri (nerede olursa olsun) soyulur, sonra ilk [ veya {
 * ile son ] veya } arasi kesilir.
 */
export function parseJsonFromLlm<T = any>(raw: string): T {
  const withoutFences = String(raw ?? '')
    .replace(/```[a-zA-Z]*\s*/g, '')
    .replace(/```/g, '')
    .trim();

  const firstArr = withoutFences.indexOf('[');
  const firstObj = withoutFences.indexOf('{');
  const candidates = [firstArr, firstObj].filter((i) => i >= 0);
  if (candidates.length === 0) return safeParseJson<T>(withoutFences);

  const start = Math.min(...candidates);
  const closer = withoutFences[start] === '[' ? ']' : '}';
  const end = withoutFences.lastIndexOf(closer);
  const sliced = end > start ? withoutFences.slice(start, end + 1) : withoutFences.slice(start);
  return safeParseJson<T>(sliced);
}
