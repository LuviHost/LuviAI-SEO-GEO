/**
 * HTTP istek govdesi: uc basina JSON boyut sinirlari ve govde ayristirici
 * hatalarinin istemciye donen hali. main.ts kullanir; ayri dosyada, cunku
 * main.ts ice aktarilinca sunucuyu baslatir ve birim test edilemez.
 *
 * NEDEN UC BASINA: JSON govdesi guard'lardan (kimlik, hiz siniri) ONCE
 * ayristirilir. Eskiden tek bir global 2 MiB sinir vardi ve kimliksiz uclar
 * dahil her uca uygulaniyordu. Herkese acik persona sohbetine gelen 2 MiB'lik
 * {"history":[{},{},...]} govdesi (~700 bin oge) global ValidationPipe'ta oge
 * oge donusturuluyor ve dogrulaniyordu: tek API sureci ~3,5 sn kilitleniyor,
 * RSS ~2 GB buyuyor, 108 MB'lik bir 400 cevabi uretiliyordu (inceleme R1).
 * Simdi:
 *  - varsayilan sinir body-parser'in kendi varsayilani (100 KB), yani 2 MiB
 *    degisikliginden onceki uretim davranisi;
 *  - yalniz LARGE_JSON_BODY_ROUTES'taki oturumlu yukleme uclari 2 MiB alir,
 *    o da yalniz kimlik bilgisi tasiyan UTF-8 istekte ve ancak ham govde
 *    yapi taramasindan gecerse (inceleme S1, asagida);
 *  - persona sohbeti 64 KB ile sinirli.
 * Govdenin oge sayisi ve derinligi ayrica common/json-body-budget.ts'te
 * sinirli; dogrulama hatasi cevabi common/validation-errors.ts'te kisa tutulur.
 */
import type { IncomingMessage } from 'node:http';
import { PayloadTooLargeException, UnauthorizedException, UnsupportedMediaTypeException } from '@nestjs/common';
import { DEFAULT_JSON_BODY_BUDGET, jsonStructureCount, type JsonBodyBudget } from './common/json-body-budget.js';
import { extractSessionToken } from './auth/session-cookie.js';

/**
 * Varsayilan JSON govde siniri (bayt): body-parser'in kendi varsayilani olan
 * '100kb' (= 102.400 bayt; body-parser 1.20 README "limit ... Defaults to
 * '100kb'" ve lib/types/json.js `opts.limit || '100kb'`). Asagidaki
 * listelerde olmayan HER uc bunu alir.
 */
export const DEFAULT_JSON_BODY_LIMIT_BYTES = 100 * 1024;

/**
 * Yukleme uclarinin JSON govde siniri (bayt, 2 MiB). YALNIZ
 * LARGE_JSON_BODY_ROUTES'taki uclarda gecerli.
 *
 * NEDEN: varsayilan 100 KB, panelin access.log yuklemesini (CrawlerIngestDto
 * 1.000.000 karaktere izin verir), 100-200 KB arasi GSC AI CSV'lerini ve uzun
 * HARO e-postalarini route'a ya da DTO'ya varmadan reddediyordu.
 *
 * NEDEN 2 MiB: panelin izin verdigi en buyuk log 1.000.000 bayt
 * (crawler-hits-panel.tsx MAX_LOG_BYTES). JSON'a kacislanirken metindeki her
 * karakter iki bayta ciksa bile (yalniz " ve \ karakterlerinden olusan dosya)
 * govde ~2.000.000 bayt olur ve sigar. GSC CSV tavani 200 KB
 * (google-ai-surface-card.tsx MAX_CSV_BYTES), HARO 100.000 karakter; ikisi de
 * rahat sigar. Bu deger degisirse o iki istemci tavanini da gozden gecir.
 */
export const JSON_BODY_LIMIT_BYTES = 2 * 1024 * 1024;

/**
 * Herkese acik persona sohbeti ucunun JSON govde siniri (bayt, 64 KB).
 *
 * NEDEN 64 KB: widget (persona-chat.service.ts buildWidgetJs) en fazla 10
 * mesaj (PERSONA_HISTORY_MAX) yollar, her biri en fazla 2.000 UTF-16 birimi
 * (PERSONA_MESSAGE_MAX; giris kutusu ve asistan cevabi bu uzunlukta kesilir).
 * UTF-8'de bir BMP birimi en fazla 3 bayt, vekil ciftinde birim basina 2
 * bayt; JSON.stringify yalniz ", \ ve kontrol karakterlerini kacislar. En
 * kotu gercekci govde 10 x 2.000 x 3 = 60.000 bayt + zarf; Turkce sohbet
 * ~25 KB'i gecmez. Eski 2 MiB sinir bu uca hic gerekmiyordu.
 */
export const PERSONA_CHAT_JSON_BODY_LIMIT_BYTES = 64 * 1024;

/** Govde siniri uca gore secilen rota: yontem + global onek dahil tam yol sablonu */
export interface JsonBodyRoute {
  method: 'POST';
  /** Express sablonu: ':ad' tek bir yol parcasi */
  path: string;
}

/**
 * 2 MiB JSON alan oturumlu yukleme uclari. request-body.spec.ts her sablonun
 * gercek bir controller rotasina karsilik geldigini denetler; uc tasinirsa ya
 * da yeniden adlandirilirsa test kirilir.
 *
 * Govde guard'lardan (kimlik, hiz siniri) ONCE okunur. Eskiden bu uclarda
 * kimliksiz istek de 2 MiB'e kadar JSON.parse ediliyordu; oge butcesi yogun
 * govdeyi ancak nesne agaci KURULDUKTAN sonra kesiyordu ve 413 guard'lardan
 * once dondugu icin hiz siniri hic devreye girmiyordu. Tek IP'den saniyede
 * bir 2 MiB [{},{},...] (istek basina ~700 bin nesne) RSS'i PM2'nin 800 MB
 * yeniden baslatma sinirinin ustune tasiyip tek API surecini tekrar tekrar
 * dusuruyordu (inceleme S1). Artik iki kat koruma var (JSON_BODY_PARSERS):
 * kimlik bilgisi tasimayan istek 2 MiB ayristiriciyi hic secemez, secen
 * istegin ham govdesi de JSON.parse'tan ONCE yapi taramasindan gecer. Bu
 * uclarin DTO'lari birkac alanli duz nesnedir (asil yuk tek bir uzun metin),
 * o yuzden tarama mesru govdeye hic takilmaz.
 *
 * DIKKAT: buraya yalniz tek-metin govdeli uclar eklenir. Satir/oge dizisi
 * tasiyan uclar (orn. admin LinkedIn ice aktarimi) yapi taramasinda 413 alir;
 * onlar icin cozum istemcide parcalara bolmektir (apps/web/src/lib/linkedin-import.ts).
 */
export const LARGE_JSON_BODY_ROUTES: readonly JsonBodyRoute[] = [
  // Panelin access.log yuklemesi (CrawlerIngestDto, 1.000.000 karakter)
  { method: 'POST', path: '/api/sites/:siteId/audit/crawler/ingest' },
  // HARO e-postasi (HaroParseDto, 100.000 karakter)
  { method: 'POST', path: '/api/sites/:siteId/audit/haro/parse' },
  // GSC AI CSV'si (panel tavani 200 KB; kacislarla 100 KB'i asar)
  { method: 'POST', path: '/api/sites/:siteId/analytics/gsc-ai-csv' },
  { method: 'POST', path: '/api/sites/:siteId/analytics/gsc-ai-csv/preview' },
  // El fotografi (HandPhotoDto screenshotBase64, 2.000.000 karakter)
  { method: 'POST', path: '/api/sites/:siteId/aso/apps/:appId/screenshots/hand-photo-with-screenshot' },
];

/** Herkese acik persona sohbeti (audit.controller.ts personaChatAsk) */
export const PERSONA_CHAT_JSON_ROUTE: JsonBodyRoute = {
  method: 'POST',
  path: '/api/sites/:siteId/audit/persona/chat',
};

/**
 * Sablon -> duzenli ifade, Express 4'un kendi eslesme kuraliyla: rotalar harf
 * duyarsiz ('case sensitive routing' kapali), sondaki '/' serbest ('strict
 * routing' kapali), ':ad' bos olmayan tek parca. Kaynak: expressjs.com 4.x
 * API app.set tablosu (iki ayar da varsayilan kapali) ve kurulu express 4.22
 * lib/application.js (`caseSensitive: this.enabled('case sensitive routing')`,
 * `strict: this.enabled('strict routing')`). Boylece ayni handler'a giden her
 * yazim (or. /API/SITES/x/AUDIT/crawler/ingest/) ayni siniri alir; daha dar
 * bir desen buyuk harfli yazimi kucuk sinira dusurur ve gecerli yuklemeyi
 * 413'e cevirirdi.
 */
function routePattern(path: string): RegExp {
  const source = path
    .split('/')
    .map((part) => (part.startsWith(':') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${source}/?$`, 'i');
}

const LARGE_ROUTE_PATTERNS = LARGE_JSON_BODY_ROUTES.map((r) => ({ method: r.method, re: routePattern(r.path) }));
const PERSONA_ROUTE_PATTERN = { method: PERSONA_CHAT_JSON_ROUTE.method, re: routePattern(PERSONA_CHAT_JSON_ROUTE.path) };

type BodyRequest = IncomingMessage & { originalUrl?: string };

/** Sorgu dizesi atilmis ham yol (Express de eslesmeyi cozulmemis yol uzerinde yapar) */
function requestPath(req: BodyRequest): string {
  return (req.originalUrl ?? req.url ?? '').split('?')[0];
}

function matchesRoute(req: BodyRequest, pattern: { method: string; re: RegExp }): boolean {
  return (req.method ?? '').toUpperCase() === pattern.method && pattern.re.test(requestPath(req));
}

/** Istek 2 MiB JSON alan yukleme uclarindan birine mi gidiyor? */
export function isLargeJsonBodyRequest(req: BodyRequest): boolean {
  return LARGE_ROUTE_PATTERNS.some((p) => matchesRoute(req, p));
}

/** Istek herkese acik persona sohbeti ucuna mi gidiyor? */
export function isPersonaChatJsonRequest(req: BodyRequest): boolean {
  return matchesRoute(req, PERSONA_ROUTE_PATTERN);
}

/**
 * body-parser'in varsayilan JSON turu ('application/json', parametreler
 * haric, harf duyarsiz). Ayristiriciya `type` olarak fonksiyon verilince tur
 * denetimi onun yerine gecer; bu yuzden uc secen ayristiricilar ayni turu
 * kendileri denetler. Uymayan istek bir sonraki (varsayilan) ayristiriciya
 * kalir, yani en kotu durumda kucuk sinir uygulanir.
 */
export function isJsonContentType(req: BodyRequest): boolean {
  const type = req.headers?.['content-type'];
  return typeof type === 'string' && /^application\/json[\t ]*(?:;|$)/i.test(type.trim());
}

/**
 * Content-Type'taki HER charset parametresi utf-8 mi (hic yoksa da dogru:
 * body-parser charset'siz JSON'u utf-8 okur)?
 *
 * NEDEN: yapi taramasi (verifyLargeJsonBody) ham baytlari okur ve ancak UTF-8
 * icin dogrudur. body-parser 'utf-' ile baslayan her charset'i kabul edip
 * govdeyi iconv ile cevirir (lib/types/json.js `charset.slice(0, 4) !==
 * 'utf-'`). UTF-16'da bir karakterin baytlarindan biri '"' (0x22) olabilir,
 * UTF-7'de '{' ve '[' base64 parcalarinin icine gizlenir; ikisinde de tarama
 * kandirilip yogun govde JSON.parse'a ulasirdi (kurulu iconv-lite 0.4.24
 * ikisini de cozer: '+AFsAewB9-' -> '[{}'). Bu yuzden 2 MiB ayristirici
 * yalniz utf-8 istegi secer, gerisi 100 KB varsayilana kalir. Kapali bir
 * ekosistem disinda sistemler arasi JSON metni zaten UTF-8 olmak ZORUNDA
 * (RFC 8259 bolum 8.1).
 *
 * Bilerek GENIS eslesir: 'charset=' gecen her yer (or. xcharset=utf-16)
 * denetlenir, tekrar eden parametrelerin hepsi utf-8 olmali. Yanlis alarm
 * en fazla istegi 100 KB'a dusurur; tersi (utf-8 sanip baska kodlamayla
 * ayristirmak) olamaz, cunku body-parser'in sectigi charset de bu
 * parametrelerden biridir (content-type 1.0 parse: ayni anahtarda sonuncu).
 */
export function hasUtf8Charset(req: BodyRequest): boolean {
  const type = req.headers?.['content-type'];
  if (typeof type !== 'string') return false;
  for (const m of type.matchAll(/charset[\t ]*=[\t ]*("(?:[^"\\]|\\.)*"?|[^;\s]*)/gi)) {
    let value = m[1];
    if (value.startsWith('"')) value = value.slice(1, -1).replace(/\\(.)/g, '$1');
    if (value.toLowerCase() !== 'utf-8') return false;
  }
  return true;
}

/**
 * Istek AuthGuard'in okudugu bir kimlik bilgisi tasiyor mu: Authorization
 * Bearer (oturum JWT'si ya da luvi_ API anahtari) veya NextAuth oturum
 * cerezi. Ayni cikarma kurali (auth/session-cookie.ts extractSessionToken)
 * kullanilir; bilgi burada DOGRULANMAZ (body-parser'in `type` secimi
 * senkron; JWT cozumu ve API anahtari sorgusu asenkron). Gecersiz kimlik
 * yine guard'da 401 alir.
 *
 * NEDEN: panel (credentials: 'include', apps/web lib/api.ts) ve API/MCP
 * istemcileri bu uclara hep kimlikle gelir; kimliksiz istegin 2 MiB'e hic
 * ihtiyaci yok. Uydurma bir Bearer bu kapidan gecer; asil koruma yine de
 * verifyLargeJsonBody'deki yapi taramasidir.
 */
export function carriesSessionCredentials(req: BodyRequest): boolean {
  const extracted = extractSessionToken(req);
  return extracted !== null && extracted.token.length > 0;
}

/**
 * 2 MiB ayristiriciyi secen istek: JSON + yukleme ucu + utf-8 + kimlik
 * bilgisi. Biri eksikse istek sonraki ayristiricilara (en kotu 100 KB) kalir.
 */
export function isLargeJsonUploadRequest(req: BodyRequest): boolean {
  return isJsonContentType(req) && isLargeJsonBodyRequest(req) && hasUtf8Charset(req) && carriesSessionCredentials(req);
}

/**
 * AuthGuard'in (auth/auth.guard.ts) cerezsiz ve Bearer'siz istege verdigi 401
 * metni. Asagidaki ara katman ayni cevabi verir; request-body.spec.ts ikisinin
 * birebir ayni kaldigini gercek guard ile denetler.
 */
export const MISSING_CREDENTIALS_MESSAGE = 'Token yok';

/**
 * Yukleme uclarina (LARGE_JSON_BODY_ROUTES) kimlik bilgisi OLMADAN gelen istegi
 * govdeyi HIC okumadan AuthGuard'in verecegi 401 ile cevaplar. main.ts bunu
 * CORS'tan sonra, govde ayristiricilarindan ONCE kurar: cevap CORS basliklarini
 * tasir, panel durumu okuyabilir.
 *
 * NEDEN (inceleme S1'in yan etkisi): kimliksiz istek 2 MiB ayristiriciyi
 * secemez (isLargeJsonUploadRequest) ve 100 KB varsayilana duser. 100 KB'tan
 * buyuk govde orada 413 "en fazla 100 KB" aliyordu. Oturumu dusmus acik bir
 * panel sekmesi bu metni aynen gosteriyor (panelin kendi siniri 1 MB),
 * Authorization basligini unutan entegrator de dosyasini kirpip yine 401
 * aliyordu. Asil neden kimlik eksikligi: bu uclarin hicbiri @Public degil,
 * guard her durumda 401 verecekti. Ara katman icerik turune bakmaz; her
 * kimliksiz POST bu uclarda zaten guard'da ayni 401'i alirdi. Govde
 * okunmadigi icin kimliksiz yogun govde de tampona alinmaz (Node cevaptan
 * sonra kalan baytlari saklamadan bosaltir).
 */
export function rejectUploadWithoutCredentials(req: BodyRequest, _res: unknown, next: (err?: unknown) => void): void {
  if (isLargeJsonBodyRequest(req) && !carriesSessionCredentials(req)) {
    next(new UnauthorizedException(MISSING_CREDENTIALS_MESSAGE));
    return;
  }
  next();
}

/**
 * Yukleme govdesinde izin verilen en fazla yapi isareti (metin disindaki
 * '{', '[', ',', ':'; common/json-body-budget.ts jsonStructureCount).
 *
 * NEDEN 64: bu uclarin en kalabalik mesru govdesi HandPhotoDto'nun dort
 * alanli duz nesnesi: 1 '{' + 4 ':' + 3 ',' = 8. Fazla alan zaten
 * ValidationPipe'ta (forbidNonWhitelisted) 400 alir. En fazla 64 isaretli
 * bir govdeden JSON.parse en fazla 2 x 64 + 1 = 129 deger/anahtar kurar;
 * 2 MiB'lik [{},...] ise ~1,4 milyon isaret tasir ve ilk ~100 baytta
 * reddedilir.
 */
export const LARGE_JSON_BODY_MAX_STRUCTURE = 64;

export const LARGE_JSON_BODY_TOO_DENSE_MESSAGE =
  'Gönderilen veri bu yükleme için çok fazla öğe içeriyor. İçeriği tek bir metin alanı olarak gönder.';

/**
 * 2 MiB ayristiricinin body-parser `verify`'i: ham govde (Buffer) JSON.parse'tan
 * ONCE buraya gelir (body-parser 1.20 lib/read.js: verify, parse'tan once
 * cagrilir; firlatilan hatanin status'u korunur, http-errors createError).
 *
 * - req.rawBody'yi yazar: Nest'in rawBody:true iken kendi verify'iyla yaptigi
 *   is (platform-express get-body-parser-options.util.js rawBodyParser). Bu
 *   ayristirici o verify'in yerine kuruldugu icin (main.ts) davranis korunur.
 * - Yapi sayisi siniri asarsa 413 firlatir; govde hic ayristirilmaz, nesne
 *   agaci kurulmaz. Hata Express hata yolundan global filtreye gider; parser
 *   CORS'tan sonra kurulu oldugu icin cevap CORS basliklarini tasir.
 * - Tarama UTF-8 varsayar (hasUtf8Charset bunu secimde saglar). body-parser
 *   buraya istegin charset'ini verir; secim kurali ileride bozulursa baska
 *   kodlamadaki govde taranmadan gecmesin diye 415 ile reddedilir.
 */
export function verifyLargeJsonBody(
  req: BodyRequest & { rawBody?: Buffer },
  _res: unknown,
  buf: Buffer,
  encoding?: string | null,
): void {
  if (encoding && encoding.toLowerCase() !== 'utf-8') {
    throw new UnsupportedMediaTypeException('Gönderilen verinin kodlaması desteklenmiyor.');
  }
  if (jsonStructureCount(buf, LARGE_JSON_BODY_MAX_STRUCTURE) > LARGE_JSON_BODY_MAX_STRUCTURE) {
    throw new PayloadTooLargeException(LARGE_JSON_BODY_TOO_DENSE_MESSAGE);
  }
  if (Buffer.isBuffer(buf)) req.rawBody = buf;
}

/** main.ts'in SIRAYLA kurdugu JSON ayristirici ayarlari */
export interface JsonBodyParserOptions {
  limit: number;
  type?: (req: BodyRequest) => boolean;
  /**
   * body-parser verify (ham govde, JSON.parse'tan once). Tanimliysa main.ts bu
   * ayristiriciyi Nest'in rawBody verify'i EZMESIN diye adaptor uzerinden kurar.
   */
  verify?: (req: BodyRequest & { rawBody?: Buffer }, res: unknown, buf: Buffer, encoding?: string | null) => void;
  // NestExpressBodyParserOptions ile uyum (useBodyParser imzasi indeks imzasi ister)
  [key: string]: unknown;
}

/**
 * JSON ayristiricilari, kurulma sirasiyla. `type` fonksiyon olabilir: istek
 * yalniz fn(req) dogru donerse ayristirilir, yoksa sonraki ara katmana gecer
 * (body-parser 1.20 README "type ... If a function, the type option is called
 * as fn(req) and the request is parsed if it returns a truthy value";
 * lib/types/json.js `if (!shouldParse(req)) { next() }`). Govdeyi okuyan
 * ayristirici req._body'yi isaretler, sonrakiler o istegi atlar (read.js
 * `req._body = true`; json.js `if (req._body) { next() }`). Yani istek, turu
 * kendisini secen ILK ayristiricinin siniriyla okunur; secilmeyen her istek
 * en sondaki varsayilana (100 KB) kalir.
 *
 * 2 MiB ayristirici yalniz isLargeJsonUploadRequest'i (kimlikli, utf-8)
 * secer ve verifyLargeJsonBody yogun govdeyi JSON.parse'tan once keser.
 * Kimliksiz yukleme istegi buraya hic gelmez: rejectUploadWithoutCredentials
 * onu govdeyi okumadan 401 ile cevaplar. Kimlikli ama utf-8 disi istek 100 KB
 * varsayilana duser: Content-Length sinirdan buyukse raw-body govdeyi okumadan
 * 413 verir (govde tampona alinmadan bosaltilir), ayristirma yok.
 */
export const JSON_BODY_PARSERS: readonly JsonBodyParserOptions[] = [
  { limit: JSON_BODY_LIMIT_BYTES, type: isLargeJsonUploadRequest, verify: verifyLargeJsonBody },
  { limit: PERSONA_CHAT_JSON_BODY_LIMIT_BYTES, type: (req) => isJsonContentType(req) && isPersonaChatJsonRequest(req) },
  { limit: DEFAULT_JSON_BODY_LIMIT_BYTES },
];

/**
 * Persona sohbetinin icerik butcesi (oge sayisi / derinlik).
 *
 * NEDEN DAR: herkese acik tek ic ice DTO'lu uc. PersonaChatDto en fazla 100
 * mesaj ({ role, content }) kabul eder: kok + history + 100 x 3 = 302 oge,
 * derinlik 3 (kok > history > mesaj). Varsayilan 10.000 ogelik butcede bu ucta
 * kimliksiz en kotu dogrulama ~30-50 ms suruyordu (olcum); 1.000 bunu onda
 * birine indirir. 1.000'den fazla ogeli govdeyi DTO zaten @ArrayMaxSize(100)
 * ile reddederdi; yani hicbir gecerli istek etkilenmez.
 */
export const PERSONA_CHAT_JSON_BODY_BUDGET: JsonBodyBudget = { maxNodes: 1_000, maxDepth: 8 };

/** main.ts icerik butcesi ara katmanina istege gore butce secer */
export function jsonBodyBudgetFor(req: BodyRequest): JsonBodyBudget {
  return isPersonaChatJsonRequest(req) ? PERSONA_CHAT_JSON_BODY_BUDGET : DEFAULT_JSON_BODY_BUDGET;
}

/** Nest disi istemci hatasinin cevap govdesi (Nest'in http-errors cevabiyla ayni bicim) */
export interface ClientHttpErrorBody {
  statusCode: number;
  message: string;
}

type HttpErrorsError = Error & { status: number; statusCode: number; expose: boolean; limit?: unknown };

/**
 * http-errors kutuphanesinin nesnesi mi? body-parser ve raw-body hatalarini bu
 * kutuphane uretir. Denetim, kutuphanenin kendi isHttpError'u ile ayni bicimi
 * arar: Error ornegi, boolean expose, sayisal statusCode ve status === statusCode.
 * Bu bicim, pnpm'in getirdigi farkli http-errors kopyalarinda da tutar.
 *
 * Yalniz `status` tasiyan SDK hatalari (Anthropic, OpenAI, gaxios...) BILEREK
 * disarida kalir. Onlarin durumu DIS servisin cevabidir; ornegin bir Google
 * 401'i istemciye aynen donseydi panel bunu "oturumun dustu" sanardi. Onlar
 * eskisi gibi 500 doner ve Sentry'e gider.
 */
function isHttpErrorsError(value: unknown): value is HttpErrorsError {
  if (!(value instanceof Error)) return false;
  const v = value as Error & { status?: unknown; statusCode?: unknown; expose?: unknown };
  return typeof v.expose === 'boolean' && typeof v.statusCode === 'number' && v.status === v.statusCode;
}

/** Bayt sinirini okunur yazar: 2097152 -> "2 MB", 102400 -> "100 KB" (Turkce ondalik virgul) */
function formatLimit(bytes: number): string {
  const MB = 1024 * 1024;
  const value = bytes >= MB ? bytes / MB : bytes / 1024;
  const text = String(Math.round(value * 10) / 10).replace('.', ',');
  return `${text} ${bytes >= MB ? 'MB' : 'KB'}`;
}

function clientErrorMessage(err: HttpErrorsError): string {
  switch (err.statusCode) {
    case 413:
      // raw-body siniri hataya yazar (limit, bayt): urlencoded icin 100 KB,
      // JSON icin ucun siniri (JSON_BODY_PARSERS: 100 KB / 64 KB / 2 MB).
      // Boylece mesajdaki sayi hep istegin gercekten takildigi sinirdir.
      return typeof err.limit === 'number' && Number.isFinite(err.limit) && err.limit > 0
        ? `Gönderilen veri çok büyük (en fazla ${formatLimit(err.limit)}).`
        : 'Gönderilen veri çok büyük.';
    case 415:
      return 'Gönderilen verinin kodlaması desteklenmiyor.';
    case 400:
      return 'Gönderilen veri okunamadı, lütfen tekrar dene.';
    default:
      return 'İstek işlenemedi.';
  }
}

/**
 * Nest disi 4xx istemci hatasi -> gercek durum kodu + Turkce mesaj. Baska her
 * sey (5xx dahil) icin null doner ve cagiran onu 500 olarak isler.
 *
 * NEDEN: catch-all SentryExceptionFilter, HttpException olmayan her hatayi 500
 * sayiyordu. Body-parser'in 413'u (PayloadTooLargeError) Nest'in hata
 * isleyicisinden aynen gecip filtreye ulastigi icin istemci
 * {statusCode:500,"Internal server error"} aliyor, her deneme Sentry'ye
 * dusuyordu. Nest'in kendi BaseExceptionFilter'i bu hatalarda gercek durumu
 * doner. Mesaj Turkce, cunku panel (apps/web lib/api.ts toUserMessage) ve
 * mobil uygulama govdedeki message'i kullaniciya oldugu gibi gosterir;
 * http-errors'in Ingilizce metni ("request entity too large") aynen gorunurdu.
 */
export function clientHttpErrorBody(exception: unknown): ClientHttpErrorBody | null {
  if (!isHttpErrorsError(exception)) return null;
  const status = exception.statusCode;
  if (!Number.isInteger(status) || status < 400 || status > 499) return null;
  return { statusCode: status, message: clientErrorMessage(exception) };
}

/**
 * Express hata ara katmani: body-parser'in "JSON okunamadi" hatasini
 * (type 'entity.parse.failed') Turkce 400'e cevirir. main.ts ayristiricilarin
 * hemen ardina kurar.
 *
 * NEDEN: bu hata nesnesi bir SyntaxError'dur (body-parser 1.20 json.js parse
 * hatasini http-errors ile sarar). Nest'in dis hata eslemesi
 * (RoutesResolver.mapExternalException) HER SyntaxError'u
 * BadRequestException(err.message) yapar; istemci V8'in Ingilizce metnini
 * ("Unexpected token } in JSON at position 9") aliyordu ve clientHttpErrorBody
 * icindeki Turkce 400 metni hic devreye girmiyordu. SyntaxError OLMAYAN ayni
 * bicimli bir http-errors nesnesi eslemeden aynen gecer, filtre onu Turkce
 * {statusCode: 400, message} cevabina cevirir.
 */
export function bodyParseErrorMiddleware(
  err: unknown,
  _req: unknown,
  _res: unknown,
  next: (err?: unknown) => void,
): void {
  if (err instanceof SyntaxError && (err as SyntaxError & { type?: unknown }).type === 'entity.parse.failed') {
    next(Object.assign(new Error('JSON govdesi okunamadi'), {
      status: 400,
      statusCode: 400,
      expose: true,
      type: 'entity.parse.failed',
    }));
    return;
  }
  next(err);
}
