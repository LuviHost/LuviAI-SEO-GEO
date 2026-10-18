import { describe, it, expect } from 'vitest';
import { assertPublishTargetSafe } from './publish-target-url.js';
import { PublishTargetsService } from './publish-targets.service.js';
import { LEGACY_CREDENTIAL_KEYS } from './publish-target-catalog.js';

/**
 * Panel katalogundaki her adres alani SSRF denetiminden gecer.
 *
 * NEDEN VAR: assertPublishTargetSafe yalniz BILDIGI alan adlarini denetler
 * (publish-target-url.ts CREDENTIAL_URL_FIELDS / CONFIG_URL_FIELDS, "host").
 * Katalogda adres alaninin adi degisir ya da yeni bir hedef eklenirse ve liste
 * guncellenmezse, panelden girilen ic ag adresi denetimsiz kalir. Katalog alan
 * adlari adaptorlerle eslestirilirken (Ghost apiUrl, Strapi/WHMCS baseUrl) bu
 * kapsam da burada sabitlenir.
 */

const genel = async () => undefined;
const catalog = PublishTargetsService.getTypeCatalog({ isAdmin: true });

type Field = { key: string; placeholder?: string };

/** Adres tasiyan alan: adi URL ile biter, "host" ya da ornegi bir URL */
const isAddressField = (f: Field) => /url$/i.test(f.key) || f.key === 'host' || /^https?:\/\//i.test(f.placeholder ?? '');

/** FTP/SFTP "host" alani sunucu adi bekler; digerleri tam URL */
const internalValue = (type: string, f: Field) => (f.key === 'host' && type !== 'CPANEL_API' ? '10.0.0.8' : 'http://10.0.0.8:8080/');

describe('katalog ↔ adres denetimi', () => {
  const credentialCases = catalog.flatMap((c) =>
    (c.fields as Field[]).filter(isAddressField).map((f) => ({ type: c.type, key: f.key, value: internalValue(c.type, f) })),
  );
  const configCases = catalog.flatMap((c) =>
    (c.configFields as Field[]).filter(isAddressField).map((f) => ({ type: c.type, key: f.key, value: internalValue(c.type, f) })),
  );

  it('sezgi gercek alanlari buluyor (bos liste testi anlamsiz gecirmesin)', () => {
    const keys = credentialCases.map((c) => `${c.type}.${c.key}`);
    for (const k of ['WORDPRESS_REST.siteUrl', 'FTP.host', 'SFTP.host', 'CPANEL_API.host', 'GHOST.apiUrl', 'STRAPI.baseUrl', 'WHMCS_KB.baseUrl', 'CUSTOM_PHP.endpointUrl', 'KOBIPRATIK.baseUrl']) {
      expect(keys).toContain(k);
    }
    expect(configCases.map((c) => `${c.type}.${c.key}`)).toContain('CPANEL_API.publicBaseUrl');
  });

  it('her kimlik adres alanina yazilan ic ag adresi reddedilir', async () => {
    for (const c of credentialCases) {
      await expect(
        assertPublishTargetSafe(c.type, { [c.key]: c.value }, {}, genel),
        `${c.type}.${c.key} denetlenmiyor — publish-target-url.ts listesine ekleyin`,
      ).rejects.toThrow(/iç ağ/);
    }
  });

  it('her config adres alanina yazilan ic ag adresi reddedilir', async () => {
    for (const c of configCases) {
      await expect(
        assertPublishTargetSafe(c.type, {}, { [c.key]: c.value }, genel),
        `${c.type}.${c.key} denetlenmiyor — publish-target-url.ts CONFIG_URL_FIELDS'e ekleyin`,
      ).rejects.toThrow(/iç ağ/);
    }
  });
});

describe('adres hata metni ↔ formdaki alan adi', () => {
  const reason = async (p: Promise<unknown>) => {
    try { await p; return 'gecti'; } catch (e) { return (e as Error).message; }
  };

  it('her katalog adres alaninin hatasi formdaki etiketle baslar (ayni baseUrl: Strapi URL / WHMCS URL / Base URL)', async () => {
    const all = catalog.flatMap((c) => [
      ...(c.fields as Array<Field & { label: string }>).filter(isAddressField).map((f) => ({ type: c.type, f, creds: { [f.key]: internalValue(c.type, f) }, cfg: {} })),
      ...(c.configFields as Array<Field & { label: string }>).filter(isAddressField).map((f) => ({ type: c.type, f, creds: {}, cfg: { [f.key]: internalValue(c.type, f) } })),
    ]);
    expect(all.length).toBeGreaterThanOrEqual(10);
    for (const { type, f, creds, cfg } of all) {
      const msg = await reason(assertPublishTargetSafe(type, creds, cfg, genel));
      expect(msg.startsWith(`${f.label}: `), `${type}.${f.key} → ${msg}`).toBe(true);
    }
    expect(await reason(assertPublishTargetSafe('STRAPI', { baseUrl: 'http://10.0.0.8' }, {}, genel))).toMatch(/^Strapi URL: /);
    expect(await reason(assertPublishTargetSafe('WHMCS_KB', { baseUrl: 'http://10.0.0.8' }, {}, genel))).toMatch(/^WHMCS URL: /);
    expect(await reason(assertPublishTargetSafe('KOBIPRATIK', { baseUrl: 'http://10.0.0.8' }, {}, genel))).toMatch(/^Base URL: /);
  });

  it('eski adli adres alani da formdaki adiyla anilir (Ghost siteUrl → API URL, cPanel cpanelUrl → cPanel host)', async () => {
    expect(await reason(assertPublishTargetSafe('GHOST', { siteUrl: 'http://10.0.0.8' }, {}, genel))).toMatch(/^API URL: /);
    expect(await reason(assertPublishTargetSafe('CPANEL_API', { cpanelUrl: 'http://10.0.0.8' }, {}, genel))).toMatch(/^cPanel host: /);
    expect(await reason(assertPublishTargetSafe('STRAPI', { strapiUrl: 'http://10.0.0.8' }, {}, genel))).toMatch(/^Strapi URL: /);
    expect(await reason(assertPublishTargetSafe('WHMCS_KB', { whmcsUrl: 'http://10.0.0.8' }, {}, genel))).toMatch(/^WHMCS URL: /);
  });

  it('eski ad → katalog adi tablosundaki her hedef alan katalogda var', () => {
    for (const [type, map] of Object.entries(LEGACY_CREDENTIAL_KEYS)) {
      const keys = catalog.find((c) => c.type === type)?.fields.map((f) => f.key) ?? [];
      for (const canonical of Object.values(map)) expect(keys, `${type}.${canonical}`).toContain(canonical);
    }
  });
});
