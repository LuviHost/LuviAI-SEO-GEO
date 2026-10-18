/**
 * AXO dosya dogrulayicilari (saf) — "HTTP 200 dondu" ile "gercek dosya var"
 * ayrimi.
 *
 * NEDEN: SPA / catch-all siteler HER yola 200 + index.html doner. Eski kontrol
 * yalniz res.ok'a bakiyordu; /auth.md, /openapi.json, /.well-known/api-catalog
 * dosyasi olmayan bir React sitesi bunlari "mevcut" goruyordu. Burada her dosya
 * kendi bicimine gore dogrulanir: metin dosyasi HTML olamaz, JSON belgeler
 * zorunlu alanlarini tasimalidir.
 *
 * Kaynaklar (her biri koda yon veren kural icin):
 *  - RFC 9727 api-catalog: application/linkset+json, ust duzey `linkset` dizisi
 *    https://www.rfc-editor.org/rfc/rfc9727.html
 *  - MCP Server Cards (SEP-2127, Final): AI Catalog'da type
 *    "application/mcp-server-card+json" girdileri; kart alanlari ext-server-card
 *    schema.ts'den ($schema, name, version, description zorunlu)
 *    https://modelcontextprotocol.io/seps/2127-mcp-server-cards
 *    https://github.com/modelcontextprotocol/ext-server-card (schema.ts, docs/discovery.md)
 *  - AI Catalog: specVersion + entries zorunlu; girdi identifier + type + (url | data)
 *    https://github.com/Agent-Card/ai-catalog (specification/ai-catalog.md)
 *  - A2A v1.0 AgentCard: a2a.proto REQUIRED alanlari; kart /.well-known/agent-card.json
 *    (v0.3.0'da agent.json → agent-card.json degisti)
 *    https://github.com/a2aproject/A2A/blob/main/docs/specification.md
 *    https://github.com/a2aproject/A2A/releases
 */

export type DocFailure = 'empty' | 'html' | 'catch_all' | 'invalid';

export type DocCheck = { ok: true } | { ok: false; reason: DocFailure; detail?: string };

/** Kullaniciya gosterilecek kisa Turkce gerekce */
export const DOC_FAILURE_TEXT: Record<DocFailure, string> = {
  empty: 'dosya boş',
  html: 'dosya yerine HTML sayfa dönüyor (soft-404 / catch-all)',
  catch_all: 'site var olmayan yollara da aynı yanıtı veriyor (catch-all) — gerçek dosya yok',
  invalid: 'biçim geçersiz',
};

const HTML_START = /^(?:<!--[\s\S]*?-->\s*)*(?:<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]|<meta[\s>]|<title[\s>]|<script[\s>]|<link[\s>]|<div[\s>]|<noscript[\s>])/i;

/**
 * Govde HTML mi? Content-Type'a GUVENILMEZ: yanlis yapilandirilmis sunucular
 * gecerli robots.txt'yi text/html ile sunabiliyor. Karar govdenin basindan.
 */
export function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 4096).replace(/^\uFEFF/, '').trimStart().replace(/^<\?xml[^>]*\?>\s*/i, '');
  return HTML_START.test(head);
}

/** JSON govdeyi guvenle coz (BOM'lu sunucular var) */
export function parseJsonSafe(text: string): unknown {
  try { return JSON.parse(text.replace(/^\uFEFF/, '')); } catch { return undefined; }
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const nonEmptyStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/**
 * Metin belgesi (auth.md, llms.txt...): bos olmamali, HTML olmamali, site
 * catch-all ise rastgele yolun yanitiyla ayni olmamali.
 */
export function validateTextDoc(text: string, catchAllBody?: string | null, minChars = 1): DocCheck {
  const t = text.trim();
  if (t.length < minChars) return { ok: false, reason: 'empty' };
  if (looksLikeHtml(text)) return { ok: false, reason: 'html' };
  if (catchAllBody != null && catchAllBody.trim().length > 0 && catchAllBody.trim() === t) return { ok: false, reason: 'catch_all' };
  return { ok: true };
}

/** llms.txt: H1 baslik + en az bir link (llmstxt.org: H1 tek zorunlu bolum; link olmadan ozet degil) */
export function validateLlmsTxt(text: string, catchAllBody?: string | null): DocCheck {
  const base = validateTextDoc(text, catchAllBody);
  if (!base.ok) return base;
  const body = text.replace(/^\uFEFF/, '').trim();
  if (!/^#\s*\S/.test(body) || !/https?:\/\//.test(body)) return { ok: false, reason: 'invalid', detail: 'markdown başlık + link yapısı yok' };
  return { ok: true };
}

/** llms-full.txt: icerik dosyasi — makul uzunluk + en az bir markdown baslik */
export function validateLlmsFullTxt(text: string, catchAllBody?: string | null): DocCheck {
  const base = validateTextDoc(text, catchAllBody);
  if (!base.ok) return base;
  if (text.trim().length < 200 || !/^#{1,6}\s+\S/m.test(text)) return { ok: false, reason: 'invalid', detail: 'içerik dosyası gibi görünmüyor (başlık/uzunluk yok)' };
  return { ok: true };
}

/**
 * RanksUp'in ESKI auth.md otomatik duzeltmesinin urettigi sablon mu? O sablon
 * dogrulanmamis varsayilanlar yayinliyordu (/giris, e-posta+sifre, e-posta
 * 2FA, "60 istek/dk"). Kontrol bunu "var" saymaz; site sahibine uyarir.
 */
export function isRanksUpLegacyAuthMd(text: string): boolean {
  return /Üretildi:\s*RanksUp/.test(text) || (/AI Agent Authentication Guide/.test(text) && /60 istek\/dk/.test(text));
}

// ─────────────────────────────────────────────────────────────
//  JSON belgeler
// ─────────────────────────────────────────────────────────────

export interface OpenApiCheck { ok: boolean; version?: string; reason?: DocFailure; detail?: string }

/** /openapi.json: JSON + `openapi` (3.x) ya da `swagger` (2.0) surum alani */
export function validateOpenApiDoc(text: string): OpenApiCheck {
  if (!text.trim()) return { ok: false, reason: 'empty' };
  if (looksLikeHtml(text)) return { ok: false, reason: 'html' };
  const j = parseJsonSafe(text);
  if (!isObj(j)) return { ok: false, reason: 'invalid', detail: 'geçerli JSON değil' };
  if (nonEmptyStr(j.openapi)) return { ok: true, version: `OpenAPI ${j.openapi}` };
  if (nonEmptyStr(j.swagger)) return { ok: true, version: `Swagger ${j.swagger}` };
  return { ok: false, reason: 'invalid', detail: '`openapi` alanı yok' };
}

export interface ApiCatalogCheck { ok: boolean; links: number; mediaTypeOk: boolean; reason?: DocFailure; detail?: string }

const LINKSET_RELS = ['item', 'service-desc', 'service-doc', 'service-meta', 'api-catalog'];

/**
 * RFC 9727 api-catalog: Linkset (RFC 9264) — ust duzey `linkset` dizisi,
 * girdilerde href tasiyan iliski dizileri. Media type application/linkset+json
 * OLMALI (MUST); yanlis Content-Type yapisi dogruysa yine gecer, ayrica raporlanir.
 */
export function validateApiCatalog(text: string, contentType: string): ApiCatalogCheck {
  const mediaTypeOk = contentType.toLowerCase() === 'application/linkset+json';
  if (!text.trim()) return { ok: false, links: 0, mediaTypeOk, reason: 'empty' };
  if (looksLikeHtml(text)) return { ok: false, links: 0, mediaTypeOk, reason: 'html' };
  const j = parseJsonSafe(text);
  if (!isObj(j) || !Array.isArray(j.linkset)) return { ok: false, links: 0, mediaTypeOk, reason: 'invalid', detail: '`linkset` dizisi yok' };
  let links = 0;
  for (const entry of j.linkset) {
    if (!isObj(entry)) continue;
    for (const rel of LINKSET_RELS) {
      const arr = entry[rel];
      if (Array.isArray(arr)) links += arr.filter((l) => isObj(l) && nonEmptyStr(l.href)).length;
    }
  }
  if (links === 0) return { ok: false, links: 0, mediaTypeOk, reason: 'invalid', detail: 'linkset içinde API bağlantısı (href) yok' };
  return { ok: true, links, mediaTypeOk };
}

export const MCP_SERVER_CARD_TYPE = 'application/mcp-server-card+json';
export const A2A_AGENT_CARD_TYPE = 'application/a2a-agent-card+json';

export interface AiCatalogEntry { identifier: string; type: string; url?: string; data?: unknown }

export interface AiCatalogParse {
  ok: boolean;
  reason?: DocFailure;
  detail?: string;
  specVersion?: string;
  entries: AiCatalogEntry[];
  /** Zorunlu alanlari eksik ya da url/data kuralini bozan girdi sayisi */
  invalidEntries: number;
}

/**
 * /.well-known/ai-catalog.json — specVersion + entries zorunlu. Girdi:
 * identifier + type + TAM OLARAK BIRI (url | data).
 */
export function parseAiCatalog(text: string): AiCatalogParse {
  if (!text.trim()) return { ok: false, reason: 'empty', entries: [], invalidEntries: 0 };
  if (looksLikeHtml(text)) return { ok: false, reason: 'html', entries: [], invalidEntries: 0 };
  const j = parseJsonSafe(text);
  if (!isObj(j)) return { ok: false, reason: 'invalid', detail: 'geçerli JSON değil', entries: [], invalidEntries: 0 };
  if (!nonEmptyStr(j.specVersion) || !Array.isArray(j.entries)) {
    return { ok: false, reason: 'invalid', detail: '`specVersion` ve `entries` zorunlu', entries: [], invalidEntries: 0 };
  }
  const entries: AiCatalogEntry[] = [];
  let invalidEntries = 0;
  for (const e of j.entries.slice(0, 200)) {
    const hasUrl = isObj(e) && nonEmptyStr(e.url);
    const hasData = isObj(e) && e.data !== undefined && e.data !== null;
    if (!isObj(e) || !nonEmptyStr(e.identifier) || !nonEmptyStr(e.type) || hasUrl === hasData) {
      invalidEntries++;
      continue;
    }
    entries.push({ identifier: e.identifier, type: e.type.trim().toLowerCase(), ...(hasUrl ? { url: e.url.trim() } : { data: e.data }) });
  }
  return { ok: true, specVersion: j.specVersion, entries, invalidEntries };
}

export interface CardCheck { ok: boolean; errors: string[]; name?: string }

/** ext-server-card schema.ts: name deseni — tam olarak bir '/' */
const MCP_NAME = /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/;
const MCP_SCHEMA = /^https:\/\/static\.modelcontextprotocol\.io\/schemas\/[^/]+\/server-card\.schema\.json$/;

/**
 * MCP Server Card — zorunlu: $schema, name (ters-DNS, tek '/'), version
 * (<=255), description (1-100). remotes istege bagli; varsa her biri
 * type 'streamable-http' | 'sse' ve http(s) / {degisken} ile baslayan url.
 */
export function validateMcpServerCard(card: unknown): CardCheck {
  const errors: string[] = [];
  if (!isObj(card)) return { ok: false, errors: ['kart JSON nesnesi değil'] };
  if (!nonEmptyStr(card.$schema)) errors.push('$schema eksik');
  else if (!MCP_SCHEMA.test(card.$schema.trim())) errors.push('$schema bilinen Server Card şeması değil');
  if (!nonEmptyStr(card.name)) errors.push('name eksik');
  else if (card.name.length < 3 || card.name.length > 200 || !MCP_NAME.test(card.name)) errors.push('name ters-DNS biçiminde değil (ör. com.example/hava-durumu)');
  if (!nonEmptyStr(card.version)) errors.push('version eksik');
  else if (card.version.length > 255) errors.push('version 255 karakteri aşıyor');
  if (!nonEmptyStr(card.description)) errors.push('description eksik');
  else if (card.description.length > 100) errors.push('description 100 karakteri aşıyor');
  if (card.remotes !== undefined) {
    if (!Array.isArray(card.remotes)) errors.push('remotes dizi değil');
    else {
      card.remotes.forEach((r: unknown, i: number) => {
        if (!isObj(r)) { errors.push(`remotes[${i}] nesne değil`); return; }
        if (r.type !== 'streamable-http' && r.type !== 'sse') errors.push(`remotes[${i}].type 'streamable-http' ya da 'sse' olmalı`);
        if (!nonEmptyStr(r.url) || !/^(https?:\/\/|\{)/.test(r.url)) errors.push(`remotes[${i}].url geçersiz`);
      });
    }
  }
  return { ok: errors.length === 0, errors, name: nonEmptyStr(card.name) ? card.name : undefined };
}

export interface A2aCardCheck extends CardCheck {
  /** v0.x bicimi (ust duzey url/protocolVersion, supportedInterfaces yok) */
  legacy: boolean;
  /** RanksUp'in eski agent_json otomatik duzeltmesinin yayinladigi kart */
  ranksupGenerated: boolean;
}

const isStrArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/**
 * A2A v1.0 AgentCard (a2a.proto REQUIRED): name, description,
 * supportedInterfaces[{url, protocolBinding, protocolVersion}], version,
 * capabilities, defaultInputModes, defaultOutputModes, skills[{id, name,
 * description, tags}].
 */
export function validateA2aAgentCard(card: unknown): A2aCardCheck {
  if (!isObj(card)) return { ok: false, errors: ['kart JSON nesnesi değil'], legacy: false, ranksupGenerated: false };
  const ranksupGenerated = typeof card.generatedBy === 'string' && /^RanksUp\b/.test(card.generatedBy);
  const legacy = !Array.isArray(card.supportedInterfaces) && (card.url !== undefined || card.protocolVersion !== undefined || card.preferredTransport !== undefined);
  const errors: string[] = [];
  if (!nonEmptyStr(card.name)) errors.push('name eksik');
  if (typeof card.description !== 'string') errors.push('description eksik');
  if (!nonEmptyStr(card.version)) errors.push('version eksik');
  if (!Array.isArray(card.supportedInterfaces) || card.supportedInterfaces.length === 0) {
    errors.push('supportedInterfaces eksik (v1.0 zorunlu alan)');
  } else {
    card.supportedInterfaces.forEach((it: unknown, i: number) => {
      if (!isObj(it)) { errors.push(`supportedInterfaces[${i}] nesne değil`); return; }
      if (!nonEmptyStr(it.url) || !/^https?:\/\//.test(it.url)) errors.push(`supportedInterfaces[${i}].url geçersiz`);
      if (!nonEmptyStr(it.protocolBinding)) errors.push(`supportedInterfaces[${i}].protocolBinding eksik`);
      if (!nonEmptyStr(it.protocolVersion)) errors.push(`supportedInterfaces[${i}].protocolVersion eksik`);
    });
  }
  if (!isObj(card.capabilities)) errors.push('capabilities eksik');
  if (!isStrArray(card.defaultInputModes)) errors.push('defaultInputModes eksik');
  if (!isStrArray(card.defaultOutputModes)) errors.push('defaultOutputModes eksik');
  if (!Array.isArray(card.skills)) errors.push('skills eksik');
  else {
    card.skills.forEach((s: unknown, i: number) => {
      if (!isObj(s) || !nonEmptyStr(s.id) || !nonEmptyStr(s.name) || typeof s.description !== 'string' || !isStrArray(s.tags)) {
        errors.push(`skills[${i}] id/name/description/tags eksik`);
      }
    });
  }
  return { ok: errors.length === 0, errors, legacy, ranksupGenerated, name: nonEmptyStr(card.name) ? card.name : undefined };
}

/** sitemap govdesi urlset mi sitemapindex mi (HTML/RSS degil) */
export function sitemapKind(xml: string): 'urlset' | 'sitemapindex' | null {
  if (!xml || looksLikeHtml(xml)) return null;
  const head = xml.slice(0, 200_000);
  if (/<sitemapindex[\s>]/i.test(head)) return 'sitemapindex';
  if (/<urlset[\s>]/i.test(head)) return 'urlset';
  return null;
}
