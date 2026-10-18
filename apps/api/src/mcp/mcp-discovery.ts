/**
 * MCP kesif yuzeyi — TEK KAYNAK.
 *
 * NEDEN AYRI DOSYA: initialize yaniti, Server Card, korunan kaynak metadatasi
 * (RFC 9728) ve 401 meydan okumasi ayni kimlik/adres bilgisini tasir. Bunlar
 * ayri yerlerde yazilinca biri degisir digeri unutulur; istemci baglanmadan
 * once kartta bir surum, baglaninca baska bir surum gorur. Hepsi buradan okur.
 *
 * Statik kopyalar (apps/web/public altinda) bu fonksiyonlarin uretim ciktisiyla
 * public-docs.spec.ts'te karsilastirilir.
 */
import { FEATURE_MIN_PLAN, findPlan } from '../billing/plans.js';

/** MCP'nin acik oldugu en dusuk plan (plans.ts mcpAccess) — kartta elle yazilmaz */
export const MCP_MIN_PLAN_NAME = findPlan(FEATURE_MIN_PLAN.mcpAccess)!.name_tr;

/**
 * initialize'da kabul edilen protokol surumleri. Server Card'daki
 * supportedProtocolVersions da BU dizidir — kart, baglaninca gorulen degerle
 * celismemeli (ext-server-card docs/discovery.md "Consistency with Runtime Behavior").
 */
export const MCP_PROTOCOL_VERSIONS: readonly string[] = ['2025-06-18', '2025-03-26', '2024-11-05'];

/**
 * initialize -> serverInfo. `name` kisa kalir: bazi istemciler arac adlarini
 * bununla oneklendirir ve '/' karakteri arac adlarinda gecersizdir. Kartin
 * ters-DNS adi (SERVER_CARD_NAME) son parcasinda ayni adi tasir.
 */
export const MCP_SERVER_INFO = { name: 'ranksup', title: 'RanksUp — SEO + GEO + ASO', version: '1.0.0' } as const;

export const WEB_ORIGIN = 'https://ranksup.ai';
/** Kurulum rehberi (apps/web/public/agent-setup.txt) */
export const AGENT_SETUP_URL = `${WEB_ORIGIN}/agent-setup.txt`;
/** Uretim API kokeni — API_BASE_URL yoksa (ya da gecersizse) kullanilir */
export const DEFAULT_API_ORIGIN = 'https://api.ranksup.ai';

/**
 * API'nin disaridan gorulen kokeni. Istek basligindaki Host'tan TURETILMEZ:
 * Host istemcinin elinde; karta/basliga baska bir adres yazdirilabilirdi.
 */
export function apiPublicOrigin(env: Record<string, string | undefined> = process.env): string {
  const raw = (env.API_BASE_URL ?? '').trim();
  if (!raw) return DEFAULT_API_ORIGIN;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return DEFAULT_API_ORIGIN;
    return u.origin;
  } catch {
    return DEFAULT_API_ORIGIN;
  }
}

/** MCP Streamable HTTP ucu — global prefix 'api' + McpController('mcp') */
export function mcpEndpointUrl(origin: string = apiPublicOrigin()): string {
  return `${origin}/api/mcp`;
}

/**
 * RFC 9728 §3.1: well-known son eki host ile yol ARASINA girer, sona eklenmez.
 * https://api.ranksup.ai/api/mcp -> https://api.ranksup.ai/.well-known/oauth-protected-resource/api/mcp
 * Kaynak: https://www.rfc-editor.org/rfc/rfc9728.html#section-3.1
 */
export function protectedResourceMetadataUrl(resource: string = mcpEndpointUrl()): string {
  const u = new URL(resource);
  const path = u.pathname.replace(/\/+$/, '');
  return `${u.origin}/.well-known/oauth-protected-resource${path}`;
}

export interface ProtectedResourceMetadata {
  resource: string;
  bearer_methods_supported: string[];
  resource_name: string;
  resource_documentation: string;
}

/**
 * Korunan kaynak metadatasi (RFC 9728 §2).
 *
 * BILEREK authorization_servers YOK: OAuth yetkilendirme sunucumuz yok.
 * RFC 9728'de alan OPSIYONEL; MCP yetkilendirme spesifikasyonu ise OAuth
 * destekleyen sunuculardan en az bir tane ister
 * (https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/authorization-server-discovery).
 * Uydurma bir adres yazmak istemcileri var olmayan bir OAuth akisina sokardi.
 * Belge yalnizca gercegi soyler: Bearer API anahtari, Authorization basligiyla.
 * scopes_supported da yok — API anahtari scope'lari OAuth scope'u degildir.
 *
 * TODO(MCP OAuth 2.1): sahibin urun karari bekleniyor. Eklenince
 * authorization_servers buraya yazilir; ChatGPT ve claude.ai OAuth akisi acilir.
 */
export function buildProtectedResourceMetadata(origin: string = apiPublicOrigin()): ProtectedResourceMetadata {
  return {
    resource: mcpEndpointUrl(origin),
    bearer_methods_supported: ['header'],
    resource_name: 'RanksUp MCP sunucusu',
    resource_documentation: AGENT_SETUP_URL,
  };
}

/** Istekte Bearer token var mi (gecerli olup olmadigi AuthGuard'in isi) */
export function bearerPresented(authorization: unknown): boolean {
  return /^Bearer\s+\S/i.test(String(authorization ?? ''));
}

/**
 * 401 yanitindaki WWW-Authenticate degeri (RFC 9728 §5.1, RFC 6750 §3).
 * Token hic gelmediyse hata kodu YAZILMAZ (RFC 6750 §3.1); gelen token
 * gecersizse error="invalid_token". error_description yok: RFC 6750 orada
 * yalnizca ASCII'ye izin verir, mesajlarimiz Turkce.
 */
export function mcpAuthChallenge(opts: { tokenPresented: boolean; origin?: string }): string {
  const metadataUrl = protectedResourceMetadataUrl(mcpEndpointUrl(opts.origin ?? apiPublicOrigin()));
  return opts.tokenPresented
    ? `Bearer error="invalid_token", resource_metadata="${metadataUrl}"`
    : `Bearer resource_metadata="${metadataUrl}"`;
}

// ─────────────────────────────────────────────────────────────────────────────
//  MCP Server Card (SEP-2127, ext-server-card v1)
//  https://modelcontextprotocol.io/seps/2127-mcp-server-cards
//  https://github.com/modelcontextprotocol/ext-server-card (schema.ts, docs/discovery.md)
// ─────────────────────────────────────────────────────────────────────────────

/** docs/discovery.md: kart bu medya turuyle sunulur */
export const SERVER_CARD_MEDIA_TYPE = 'application/mcp-server-card+json';
/** schema.ts: $schema ZORUNLU ve tam olarak bu adres (v1 ailesi) */
export const SERVER_CARD_SCHEMA = 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json';
/** Ters-DNS ad, tek '/' (desen: ^[a-zA-Z0-9.-]+/[a-zA-Z0-9._-]+$) — ranksup.ai -> ai.ranksup */
export const SERVER_CARD_NAME = `ai.ranksup/${MCP_SERVER_INFO.name}`;
/** AI Catalog girdisi: urn:air:{yayinci}:{ad alani}:{ad} — kart adindan turetilir */
export const SERVER_CARD_CATALOG_ID = `urn:air:ranksup.ai:mcp:${MCP_SERVER_INFO.name}`;

/** <streamable-http-url>/server-card — SEP-2127'nin onerdigi (ayrilmis) konum */
export function serverCardUrl(origin: string = apiPublicOrigin()): string {
  return `${mcpEndpointUrl(origin)}/server-card`;
}

/**
 * Sunucu karti. Arac/kaynak/istem LISTESI YOK: spesifikasyon bunlari bilerek
 * disarida birakir — liste kullaniciya ve plana gore degisir (bizde de oyle:
 * listForMcp plan kapisindan gecirir), statik bir belge bunu dogru anlatamaz.
 * Araclar baglaninca tools/list ile alinir.
 */
export function buildServerCard(origin: string = apiPublicOrigin()) {
  return {
    $schema: SERVER_CARD_SCHEMA,
    name: SERVER_CARD_NAME,
    version: MCP_SERVER_INFO.version,
    // schema.ts: en fazla 100 karakter (public-docs.spec.ts dogrular)
    description: 'RanksUp hesabındaki SEO, GEO ve ASO verileri: site denetimi, AI görünürlüğü, içerik, uygulamalar.',
    title: MCP_SERVER_INFO.title,
    websiteUrl: AGENT_SETUP_URL,
    icons: [{ src: `${WEB_ORIGIN}/icon-512.png`, mimeType: 'image/png', sizes: ['512x512'] }],
    remotes: [
      {
        type: 'streamable-http' as const,
        url: mcpEndpointUrl(origin),
        headers: [
          {
            name: 'Authorization',
            description: `RanksUp API anahtarı (panel → API Anahtarları). MCP sunucusu ${MCP_MIN_PLAN_NAME} planda açıktır.`,
            isRequired: true,
            isSecret: true,
            value: 'Bearer {api_key}',
            variables: {
              api_key: {
                description: 'luvi_ ile başlayan RanksUp API anahtarı',
                isRequired: true,
                isSecret: true,
                placeholder: 'luvi_...',
              },
            },
          },
        ],
        supportedProtocolVersions: [...MCP_PROTOCOL_VERSIONS],
      },
    ],
  };
}
