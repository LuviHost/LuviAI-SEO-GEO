import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEATURE_MIN_PLAN, findPlan } from '../billing/plans.js';
import {
  AGENT_SETUP_URL,
  DEFAULT_API_ORIGIN,
  MCP_MIN_PLAN_NAME,
  MCP_PROTOCOL_VERSIONS,
  MCP_SERVER_INFO,
  SERVER_CARD_SCHEMA,
  apiPublicOrigin,
  bearerPresented,
  buildProtectedResourceMetadata,
  buildServerCard,
  mcpAuthChallenge,
  mcpEndpointUrl,
  protectedResourceMetadataUrl,
  serverCardUrl,
} from './mcp-discovery.js';

/**
 * MCP kesif belgelerinin bicimi — spesifikasyonun koydugu kurallar.
 * Kaynaklar: RFC 9728 (https://www.rfc-editor.org/rfc/rfc9728.html) ve
 * ext-server-card schema.ts / docs/discovery.md (SEP-2127).
 */

describe('RFC 9728 korunan kaynak metadatasi', () => {
  it('well-known son eki host ile yol arasina girer (§3.1)', () => {
    expect(protectedResourceMetadataUrl('https://api.ranksup.ai/api/mcp'))
      .toBe('https://api.ranksup.ai/.well-known/oauth-protected-resource/api/mcp');
    // Sondaki egik cizgi atilir; yolsuz kaynakta son ek tek basina kalir
    expect(protectedResourceMetadataUrl('https://x.test/api/mcp/'))
      .toBe('https://x.test/.well-known/oauth-protected-resource/api/mcp');
    expect(protectedResourceMetadataUrl('https://x.test'))
      .toBe('https://x.test/.well-known/oauth-protected-resource');
  });

  it('belge durust: kaynak = MCP ucu, yalnizca header, yetkilendirme sunucusu YOK', () => {
    const md = buildProtectedResourceMetadata(DEFAULT_API_ORIGIN);
    expect(md.resource).toBe('https://api.ranksup.ai/api/mcp');
    expect(md.bearer_methods_supported).toEqual(['header']);
    expect(md.resource_documentation).toBe(AGENT_SETUP_URL);
    expect(md.resource_name).toBeTruthy();
    expect(md).not.toHaveProperty('authorization_servers');
    expect(md).not.toHaveProperty('scopes_supported');
  });

  it('bearerPresented: yalnizca dolu bir Bearer degeri token sayilir', () => {
    expect(bearerPresented('Bearer luvi_x')).toBe(true);
    expect(bearerPresented('bearer abc')).toBe(true);
    expect(bearerPresented('Bearer ')).toBe(false);
    expect(bearerPresented('Basic dXNlcjpwYXNz')).toBe(false);
    expect(bearerPresented(undefined)).toBe(false);
  });

  it('401 meydan okumasi: token yoksa hata kodu yok, gecersizse invalid_token (RFC 6750 §3.1)', () => {
    const url = 'https://api.ranksup.ai/.well-known/oauth-protected-resource/api/mcp';
    expect(mcpAuthChallenge({ tokenPresented: false, origin: DEFAULT_API_ORIGIN }))
      .toBe(`Bearer resource_metadata="${url}"`);
    expect(mcpAuthChallenge({ tokenPresented: true, origin: DEFAULT_API_ORIGIN }))
      .toBe(`Bearer error="invalid_token", resource_metadata="${url}"`);
  });
});

describe('apiPublicOrigin', () => {
  it('API_BASE_URL kokenini alir; yol ve sondaki egik cizgi atilir', () => {
    expect(apiPublicOrigin({ API_BASE_URL: 'https://api.ranksup.ai/' })).toBe('https://api.ranksup.ai');
    expect(apiPublicOrigin({ API_BASE_URL: 'https://api.ranksup.ai/x/y' })).toBe('https://api.ranksup.ai');
    expect(apiPublicOrigin({ API_BASE_URL: 'http://localhost:3001' })).toBe('http://localhost:3001');
  });

  it('bos ya da gecersiz deger uretim kokenine duser', () => {
    expect(apiPublicOrigin({})).toBe(DEFAULT_API_ORIGIN);
    expect(apiPublicOrigin({ API_BASE_URL: '  ' })).toBe(DEFAULT_API_ORIGIN);
    expect(apiPublicOrigin({ API_BASE_URL: 'adres-degil' })).toBe(DEFAULT_API_ORIGIN);
    expect(apiPublicOrigin({ API_BASE_URL: 'ftp://api.ranksup.ai' })).toBe(DEFAULT_API_ORIGIN);
  });
});

describe('MCP Server Card (SEP-2127) bicimi', () => {
  const card = buildServerCard(DEFAULT_API_ORIGIN);

  it('$schema v1 adresi birebir', () => {
    expect(card.$schema).toBe(SERVER_CARD_SCHEMA);
    expect(card.$schema).toMatch(/^https:\/\/static\.modelcontextprotocol\.io\/schemas\/v1\/server-card\.schema\.json$/);
  });

  it('zorunlu alanlar schema.ts kisitlarina uyuyor', () => {
    expect(card.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
    expect(card.name.length).toBeGreaterThanOrEqual(3);
    expect(card.name.length).toBeLessThanOrEqual(200);
    expect(card.version.length).toBeLessThanOrEqual(255);
    // Surum araligi reddedilir: ^1.2.3, ~1.2.3, >=1.2.3, 1.x, 1.*
    expect(card.version).not.toMatch(/^[\^~<>=]|\.x$|\*/);
    expect(card.description.length).toBeGreaterThanOrEqual(1);
    expect(card.description.length).toBeLessThanOrEqual(100);
    expect(card.title.length).toBeGreaterThanOrEqual(1);
    expect(card.title.length).toBeLessThanOrEqual(100);
  });

  it('remote: streamable-http, MCP ucu, Bearer basligi gizli ve degiskenli', () => {
    expect(card.remotes).toHaveLength(1);
    const [r] = card.remotes;
    expect(r.type).toBe('streamable-http');
    expect(r.url).toBe(mcpEndpointUrl(DEFAULT_API_ORIGIN));
    expect(r.url).toMatch(/^(https?:\/\/[^\s]+|\{[a-zA-Z_][a-zA-Z0-9_]*\}[^\s]*)$/);
    const [h] = r.headers;
    expect(h.name).toBe('Authorization');
    expect(h.isRequired).toBe(true);
    expect(h.isSecret).toBe(true);
    // value'daki her {degisken} tanimli olmali
    for (const m of h.value.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g)) {
      expect(h.variables, m[1]).toHaveProperty(m[1]);
    }
    expect(r.supportedProtocolVersions).toEqual([...MCP_PROTOCOL_VERSIONS]);
  });

  it('Authorization aciklamasi MCP planini plans.ts\'ten aliyor (elle yazilmis plan adi yok)', () => {
    const plan = findPlan(FEATURE_MIN_PLAN.mcpAccess)!.name_tr;
    expect(MCP_MIN_PLAN_NAME).toBe(plan);
    expect(card.remotes[0].headers[0].description).toContain(`${plan} planda`);
  });

  it('arac/kaynak/istem listesi YOK — spesifikasyon bunlari bilerek disarida birakir', () => {
    for (const k of ['tools', 'resources', 'prompts', 'capabilities']) {
      expect(card, k).not.toHaveProperty(k);
    }
  });

  it('gizli bilgi tasimiyor (gercek anahtar bicimi yok)', () => {
    expect(JSON.stringify(card)).not.toMatch(/luvi_[A-Za-z0-9_-]{8,}/);
  });

  it('kimlik initialize ile celismiyor', () => {
    expect(card.version).toBe(MCP_SERVER_INFO.version);
    expect(card.title).toBe(MCP_SERVER_INFO.title);
    expect(card.name.split('/')[1]).toBe(MCP_SERVER_INFO.name);
  });

  it('kart adresi <streamable-http-url>/server-card', () => {
    expect(serverCardUrl(DEFAULT_API_ORIGIN)).toBe('https://api.ranksup.ai/api/mcp/server-card');
  });

  it('ikon dosyasi web/public altinda var ve beyan edilen boyutta', () => {
    const [icon] = card.icons;
    const here = path.dirname(fileURLToPath(import.meta.url));
    const file = path.resolve(here, '../../../web/public', new URL(icon.src).pathname.slice(1));
    const png = fs.readFileSync(file);
    // PNG IHDR: genislik 16. bayttan, yukseklik 20. bayttan (big-endian)
    expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes[0]);
    expect(icon.mimeType).toBe('image/png');
  });
});
