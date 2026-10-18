/**
 * Toplu yazim filtresi denetimi (deleteMany / updateMany) — saf fonksiyonlar.
 *
 * NEDEN: Prisma'da `where: {}` ve `{ siteId: undefined }` HER satiri secer
 * (undefined alan "filtre yok" demektir). Hesap silme planinda tek bir kimlik
 * listesinin eksik gelmesi tum musterilerin satirlarini kalici silebilir,
 * hesap dondurma tum sitelerin baglanti bilgilerini temizleyebilirdi. Testler
 * eskiden yalniz `data`ya ya da cagri sayisina bakiyordu; filtre dusse de
 * yesil kaliyorlardi.
 *
 * Denetim iki sey ister:
 *  1. Bicim: filtre var; hicbir derinlikte undefined ya da bos nesne {} yok.
 *  2. Kapsam: filtre silinen kisiye daraltilmis — VE ile bagli kosullardan en
 *     az biri o kisinin bir kimligini (kullanici, e-posta, site ya da toplanan
 *     alt kayit kimligi) tasir ya da bos bir `in: []` listesidir (hicbir satiri
 *     secmez). VEYA (OR) ancak HER dali kapsamliysa kapsamli sayilir.
 */

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);

/** Hicbir derinlikte undefined ya da bos {} olmamali; sorun varsa yolu */
function shapeProblem(v: unknown, path: string): string | null {
  if (v === undefined) return `${path} undefined (Prisma'da "filtre yok")`;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      const p = shapeProblem(v[i], `${path}[${i}]`);
      if (p) return p;
    }
    return null;
  }
  if (!isObj(v)) return null;
  const keys = Object.keys(v);
  if (keys.length === 0) return `${path} boş filtre {} (her satırı seçer)`;
  for (const k of keys) {
    const p = shapeProblem(v[k], `${path}.${k}`);
    if (p) return p;
  }
  return null;
}

/** Kimlik kumesi: tam eslesme Set'te (buyuk hesapta on binlerce kimlik), "icerir" icin liste */
interface Tokens { exact: Set<string>; list: string[] }

const hasToken = (s: unknown, tokens: Tokens) =>
  typeof s === 'string' && (tokens.exact.has(s) || tokens.list.some((t) => s.includes(t)));

/** Prisma skaler filtre islecleri — bu anahtarlari tasiyan nesne iliski filtresi degildir */
const SCALAR_OPS = new Set(['equals', 'in', 'notIn', 'lt', 'lte', 'gt', 'gte', 'contains', 'startsWith', 'endsWith', 'not', 'mode', 'search']);

/** Tek alan kosulu satirlari kisiye daraltiyor mu */
function fieldScopes(cond: unknown, tokens: Tokens): boolean {
  if (typeof cond === 'string') return hasToken(cond, tokens);
  if (!isObj(cond)) return false;
  const keys = Object.keys(cond);
  if (keys.some((k) => SCALAR_OPS.has(k))) {
    // Yalniz OLUMLU islecler daraltir; not / notIn / gt... kisiyi DISARIDA birakir ya da hic daraltmaz
    if (Array.isArray(cond.in)) {
      // Bos liste hicbir satiri secmez (kimligi olmayan kisi); dolu listenin her elemani kisiye ait olmali
      if (cond.in.length === 0 || cond.in.every((v) => hasToken(v, tokens))) return true;
    }
    return ['equals', 'contains', 'startsWith', 'endsWith'].some((op) => hasToken(cond[op], tokens));
  }
  // Iliski filtresi: { site: { userId } } kisaltmasi, { is: {...} } ya da { some: {...} }
  if ('is' in cond) return isObj(cond.is) && whereScopes(cond.is, tokens);
  if ('some' in cond) return isObj(cond.some) && whereScopes(cond.some, tokens);
  if (keys.some((k) => k === 'isNot' || k === 'every' || k === 'none')) return false;
  return whereScopes(cond, tokens);
}

/** Filtre (VE ile bagli kosullar) kisiye daraltiyor mu */
function whereScopes(where: Obj, tokens: Tokens): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k === 'OR') {
      if (Array.isArray(v) && v.every((b) => isObj(b) && whereScopes(b, tokens))) return true;
    } else if (k === 'AND') {
      const parts = Array.isArray(v) ? v : [v];
      if (parts.some((b) => isObj(b) && whereScopes(b, tokens))) return true;
    } else if (k !== 'NOT' && fieldScopes(v, tokens)) {
      return true;
    }
  }
  return false;
}

/**
 * Toplu yazim filtresinin sorunu (yoksa null).
 * @param tokens hesabin kimlikleri (kullanici/site/alt kayit kimligi, e-posta).
 *   Kosul degeri bunlardan birini ICERIYORSA daraltici sayilir; uretimde
 *   kimlikler 25 karakterlik cuid oldugu icin tesadufi eslesme olmaz. Bos
 *   degerler yok sayilir (bos dize her metnin icinde gecer).
 */
export function whereProblem(where: unknown, tokens: readonly string[]): string | null {
  if (!isObj(where)) return where === undefined || where === null ? 'filtre (where) yok' : 'filtre (where) nesne değil';
  const shape = shapeProblem(where, 'where');
  if (shape) return shape;
  if (!whereScopes(where, prepared(tokens))) return `filtre hesaba daraltılmamış: ${JSON.stringify(where).slice(0, 200)}`;
  return null;
}

/** Ayni kimlik dizisiyle (plan denetimi ~80 cagri) Set bir kez kurulur */
const preparedCache = new WeakMap<readonly string[], Tokens>();
function prepared(tokens: readonly string[]): Tokens {
  let t = preparedCache.get(tokens);
  if (!t) {
    const list = tokens.filter((x) => typeof x === 'string' && x.trim().length > 0);
    t = { exact: new Set(list), list };
    preparedCache.set(tokens, t);
  }
  return t;
}
