import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Probe } from './axo-fetch.js';

let next: Partial<Probe> = {};

vi.mock('./axo-fetch.js', async (orig) => {
  const actual = await orig<typeof import('./axo-fetch.js')>();
  return {
    ...actual,
    probeUrl: vi.fn(async (url: string): Promise<Probe> => ({
      url, finalUrl: url, headers: {}, truncated: false, binary: false, contentType: 'text/html', status: 200, text: '', state: 'ok', block: null, ...next,
    })),
  };
});

const { SchemaValidatorService } = await import('./schema-validator.service.js');

const page = (...blocks: unknown[]) => `<html><head>${blocks.map((b) => `<script type="application/ld+json">${typeof b === 'string' ? b : JSON.stringify(b)}</script>`).join('')}</head></html>`;

beforeEach(() => { next = {}; });

describe('SchemaValidatorService', () => {
  it('engel "sayfa sorunlu" degil: blocked + izin ipucu', async () => {
    next = { state: 'blocked', status: 403, block: { kind: 'waf', reason: 'Cloudflare güvenlik duvarı RanksUp tarayıcısını engelledi (HTTP 403).', hint: '"RanksUpBot" için izin verin.', vendor: 'cloudflare', status: 403 } };
    const r = await new SchemaValidatorService().validate('https://x.com/a');
    expect(r.blocked).toMatchObject({ status: 403 });
    expect(r.errors[0]).toMatch(/^Ölçülemedi: Cloudflare/);
    expect(r.valid).toBe(false);
  });

  it('LocalBusiness alt turu (HairSalon) Organization sayilir; alan bulgulari SEO listelerine duser', async () => {
    next = { text: page({ '@context': 'https://schema.org', '@type': 'HairSalon', name: 'S', address: 'Bagdat Cd 1', telephone: '0216 555 00 00', url: 'https://s.com', sameAs: ['a'] }) };
    const r = await new SchemaValidatorService().validate('https://s.com');
    expect(r.types).toEqual(['HairSalon']);
    expect(r.recommendations.some((x) => x.startsWith('Organization (ya da'))).toBe(false);
    expect(r.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/^HairSalon: address düz metin/),
      expect.stringMatching(/^HairSalon: telephone ülke koduyla yazılmamış/),
    ]));
    // url / name LocalBusiness icin iki kez raporlanmaz
    expect(r.errors.filter((e) => e.includes('url eksik'))).toEqual([]);
  });

  it('@graph acilir; FAQ zengin sonucu kaldirildi notu; Speakable onerisi yok', async () => {
    next = { text: page({ '@context': 'https://schema.org', '@graph': [{ '@type': 'FAQPage', mainEntity: [{ '@type': 'Question', name: 'q', acceptedAnswer: { text: 'a' } }] }, { '@type': 'Corporation', name: 'C', url: 'https://c.com', sameAs: ['x'] }] }) };
    const r = await new SchemaValidatorService().validate('https://c.com');
    expect(r.types).toEqual(['FAQPage', 'Corporation']);
    expect(r.recommendations.some((x) => /7 Mayıs 2026/.test(x))).toBe(true);
    expect(r.recommendations.some((x) => /Speakable/i.test(x))).toBe(false);
    expect(r.valid).toBe(true);
  });

  it('bozuk JSON-LD ve HTTP hatasi raporlanir', async () => {
    next = { text: page('{ bozuk') };
    const r = await new SchemaValidatorService().validate('https://x.com');
    expect(r.errors.some((e) => e.startsWith('JSON-LD ayrıştırma hatası'))).toBe(true);
    next = { state: 'missing', status: 404 };
    expect((await new SchemaValidatorService().validate('https://x.com/yok')).errors).toEqual(['HTTP 404 — sayfaya ulaşılamadı']);
  });
});
