import { describe, it, expect } from 'vitest';
import {
  looksLikeHtml, validateTextDoc, validateLlmsTxt, validateLlmsFullTxt, isRanksUpLegacyAuthMd,
  validateOpenApiDoc, validateApiCatalog, parseAiCatalog, validateMcpServerCard, validateA2aAgentCard,
  sitemapKind, MCP_SERVER_CARD_TYPE,
} from './axo-validators.js';

const SPA = '<!doctype html><html><head><title>Uygulama</title></head><body><div id="root"></div></body></html>';

describe('soft-404: HTML tespiti', () => {
  it('doctype, html, yorumla baslayan ve XML prologlu XHTML', () => {
    expect(looksLikeHtml(SPA)).toBe(true);
    expect(looksLikeHtml('\n\n  <html lang="tr">')).toBe(true);
    expect(looksLikeHtml('<!-- cache --><!DOCTYPE html>')).toBe(true);
    expect(looksLikeHtml('<?xml version="1.0"?><!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0//EN">')).toBe(true);
  });
  it('markdown / robots / JSON / sitemap HTML degil', () => {
    expect(looksLikeHtml('# Başlık\n\n- [a](https://x.com)')).toBe(false);
    expect(looksLikeHtml('User-agent: *')).toBe(false);
    expect(looksLikeHtml('{"openapi":"3.1.0"}')).toBe(false);
    expect(looksLikeHtml('<?xml version="1.0"?><urlset>')).toBe(false);
  });
});

describe('metin belgeleri', () => {
  it('auth.md / llms.txt HTML ya da bos olamaz; catch-all govdesiyle ayni olamaz', () => {
    expect(validateTextDoc(SPA)).toEqual({ ok: false, reason: 'html' });
    expect(validateTextDoc('   ')).toEqual({ ok: false, reason: 'empty' });
    expect(validateTextDoc('Not found', 'Not found')).toEqual({ ok: false, reason: 'catch_all' });
    expect(validateTextDoc('# auth.md\n\n1. Discover')).toEqual({ ok: true });
  });

  it('llms.txt baslik + link ister', () => {
    expect(validateLlmsTxt('# Marka\n\n> Özet\n\n- [Ana sayfa](https://x.com)').ok).toBe(true);
    expect(validateLlmsTxt('# Marka\n\nlink yok').ok).toBe(false);
    expect(validateLlmsTxt(SPA)).toMatchObject({ ok: false, reason: 'html' });
  });

  it('llms-full.txt icerik dosyasi olmali', () => {
    expect(validateLlmsFullTxt(`# Marka\n\n${'İçerik. '.repeat(40)}`).ok).toBe(true);
    expect(validateLlmsFullTxt('# kısa').ok).toBe(false);
  });

  it('RanksUp eski auth.md sablonu taninir', () => {
    expect(isRanksUpLegacyAuthMd('# X — AI Agent Authentication Guide\n- Rate limit: 60 istek/dk.')).toBe(true);
    expect(isRanksUpLegacyAuthMd('_Üretildi: RanksUp — 2026-08-12_')).toBe(true);
    expect(isRanksUpLegacyAuthMd('# auth.md\nRegister at <IDENTITY_ENDPOINT>')).toBe(false);
  });
});

describe('API katalogu (RFC 9727) ve OpenAPI', () => {
  it('openapi.json: openapi ya da swagger alani', () => {
    expect(validateOpenApiDoc('{"openapi":"3.1.0","info":{}}')).toMatchObject({ ok: true, version: 'OpenAPI 3.1.0' });
    expect(validateOpenApiDoc('{"swagger":"2.0"}')).toMatchObject({ ok: true });
    expect(validateOpenApiDoc('{"error":"not found"}')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(validateOpenApiDoc(SPA)).toMatchObject({ ok: false, reason: 'html' });
  });

  it('api-catalog: linkset dizisi ve href; media type ayrica raporlanir', () => {
    const body = JSON.stringify({ linkset: [{ anchor: 'https://x.com/.well-known/api-catalog', item: [{ href: 'https://api.x.com/v1' }] }] });
    expect(validateApiCatalog(body, 'application/linkset+json')).toEqual({ ok: true, links: 1, mediaTypeOk: true });
    expect(validateApiCatalog(body, 'application/json')).toMatchObject({ ok: true, mediaTypeOk: false });
    expect(validateApiCatalog('{"apis":[]}', 'application/json')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(validateApiCatalog('{"linkset":[{"anchor":"x"}]}', 'application/linkset+json')).toMatchObject({ ok: false });
  });
});

describe('AI Catalog + MCP Server Card (SEP-2127)', () => {
  const card = {
    $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
    name: 'com.ornek/randevu',
    version: '1.2.0',
    description: 'Randevu sunucusu',
    remotes: [{ type: 'streamable-http', url: 'https://ornek.com/mcp' }],
  };

  it('katalog: specVersion + entries zorunlu; url/data tam olarak biri', () => {
    const r = parseAiCatalog(JSON.stringify({
      specVersion: '1.0',
      entries: [
        { identifier: 'urn:air:ornek.com:mcp:randevu', type: MCP_SERVER_CARD_TYPE, url: 'https://ornek.com/mcp/server-card' },
        { identifier: 'urn:air:ornek.com:mcp:gomulu', type: 'application/mcp-server-card+json', data: card },
        { identifier: 'x', type: MCP_SERVER_CARD_TYPE, url: 'https://a', data: card },
        { type: MCP_SERVER_CARD_TYPE, url: 'https://a' },
      ],
    }));
    expect(r.ok).toBe(true);
    expect(r.entries.map((e) => e.identifier)).toEqual(['urn:air:ornek.com:mcp:randevu', 'urn:air:ornek.com:mcp:gomulu']);
    expect(r.invalidEntries).toBe(2);
    expect(parseAiCatalog('{"entries":[]}')).toMatchObject({ ok: false, reason: 'invalid' });
    expect(parseAiCatalog(SPA)).toMatchObject({ ok: false, reason: 'html' });
  });

  it('server card zorunlu alanlari', () => {
    expect(validateMcpServerCard(card)).toEqual({ ok: true, errors: [], name: 'com.ornek/randevu' });
    const bad = validateMcpServerCard({ name: 'randevu', version: '', description: 'x'.repeat(101), remotes: [{ type: 'ws', url: 'ftp://x' }] });
    expect(bad.ok).toBe(false);
    expect(bad.errors).toEqual(expect.arrayContaining([
      '$schema eksik',
      'name ters-DNS biçiminde değil (ör. com.example/hava-durumu)',
      'version eksik',
      'description 100 karakteri aşıyor',
      "remotes[0].type 'streamable-http' ya da 'sse' olmalı",
      'remotes[0].url geçersiz',
    ]));
  });
});

describe('A2A v1.0 Agent Card', () => {
  const v1 = {
    name: 'Ornek Ajan',
    description: 'Randevu ajanı',
    version: '1.0.0',
    supportedInterfaces: [{ url: 'https://ornek.com/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
    capabilities: { streaming: false },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [{ id: 'randevu', name: 'Randevu', description: 'Randevu alır', tags: ['randevu'] }],
  };

  it('v1.0 zorunlu alanlari tam kart gecer', () => {
    expect(validateA2aAgentCard(v1)).toMatchObject({ ok: true, legacy: false, ranksupGenerated: false, errors: [] });
  });

  it('RanksUp eski uretimi (v0.3, preferredTransport none) eski + RanksUp olarak isaretlenir', () => {
    const r = validateA2aAgentCard({
      protocolVersion: '0.3.0', name: 'X', description: 'X', url: 'https://x.com', preferredTransport: 'none',
      capabilities: {}, defaultInputModes: ['text/plain'], defaultOutputModes: ['text/html'], skills: [],
      generatedBy: 'RanksUp — 2026-08-12',
    });
    expect(r.ok).toBe(false);
    expect(r.legacy).toBe(true);
    expect(r.ranksupGenerated).toBe(true);
    expect(r.errors).toContain('supportedInterfaces eksik (v1.0 zorunlu alan)');
    expect(r.errors).toContain('version eksik');
  });

  it('eksik arayuz/beceri alanlari tek tek raporlanir', () => {
    const r = validateA2aAgentCard({ ...v1, supportedInterfaces: [{ url: 'x' }], skills: [{ id: 'a' }] });
    expect(r.errors).toEqual(expect.arrayContaining([
      'supportedInterfaces[0].url geçersiz',
      'supportedInterfaces[0].protocolBinding eksik',
      'supportedInterfaces[0].protocolVersion eksik',
      'skills[0] id/name/description/tags eksik',
    ]));
  });
});

describe('sitemapKind', () => {
  it('urlset / sitemapindex / degil', () => {
    expect(sitemapKind('<?xml version="1.0"?><urlset xmlns="x"></urlset>')).toBe('urlset');
    expect(sitemapKind('<sitemapindex><sitemap><loc>x</loc></sitemap></sitemapindex>')).toBe('sitemapindex');
    expect(sitemapKind('<rss version="2.0"></rss>')).toBeNull();
    expect(sitemapKind(SPA)).toBeNull();
  });
});
