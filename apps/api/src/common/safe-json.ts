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
