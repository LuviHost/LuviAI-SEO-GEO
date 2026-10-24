import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpToolsService, type ToolDef } from './mcp-tools.service.js';
import { QuotaService } from '../billing/quota.service.js';
import { ApiKeysService, DEFAULT_SCOPES } from '../api-keys/api-keys.service.js';

/**
 * apps/web/public/agent-setup.txt "Yetkiler" maddesi = MCP araclarinin
 * GERCEK scope'lari (mcp-tools.service.ts ToolDef.scope, McpController).
 *
 * NEDEN VAR: 11. turda (inceleme R21) her MCP araci REST ikiziyle ayni kaynak
 * scope'unu istemeye basladi (run_audit → audit:write, create_article →
 * articles:write ...); rehber hala "en az bir Yazma yetkisi ver" diyordu. Bu
 * metne guvenip yalniz 'Sosyal → Yazma' secen musteri MCP'de yetki hatasi
 * aliyordu. Yeni arac ya da scope degisikligi rehbere islenmezse bu test kirilir.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const setup = fs.readFileSync(path.resolve(HERE, '../../../web/public/agent-setup.txt'), 'utf8');

function tools(): ToolDef[] {
  const prisma = { user: { findUniqueOrThrow: async () => ({ plan: 'ENTERPRISE' }) } } as never;
  const n = null as never;
  return new McpToolsService(prisma, n, new QuotaService(prisma), n, n, n, n, n, n, n, n, n, n).list();
}

/** "- Yetkiler:" maddesi — bir sonraki ust duzey "- " maddesine kadar (alt maddeler girintili) */
function yetkiler(): string {
  const start = setup.indexOf('\n- Yetkiler:');
  expect(start, '"- Yetkiler:" maddesi yok').toBeGreaterThan(-1);
  const rest = setup.slice(start + 1);
  const end = rest.slice(2).search(/\n- /);
  return end === -1 ? rest : rest.slice(0, end + 2);
}

/** Girintili alt maddeler ("    - ..."), devam satirlari birlestirilmis */
function altMaddeler(): string[] {
  return yetkiler()
    .split(/\n {4}- /)
    .slice(1)
    .map((m) => m.split(/\n {2}(?! )/)[0].replace(/\s+/g, ' ').trim());
}

describe('agent-setup.txt Yetkiler = MCP arac scope\'lari', () => {
  const all = tools();
  const names = new Set(all.map((t) => t.name));
  const anilanAraclar = (metin: string) => [...metin.matchAll(/\b[a-z]+(?:_[a-z]+)+\b/g)].map((m) => m[0]).filter((w) => names.has(w));

  it('her YAZMA araci tek bir alt maddede ve kendi scope\'unun altinda; scope\'suz yazma araci "herhangi bir Yazma" maddesinde', () => {
    const maddeler = altMaddeler();
    expect(maddeler.length).toBeGreaterThan(0);
    const yer = new Map<string, string[]>();
    for (const m of maddeler) for (const a of anilanAraclar(m)) yer.set(a, [...(yer.get(a) ?? []), m]);

    for (const t of all.filter((x) => x.mutating)) {
      const bulunan = yer.get(t.name) ?? [];
      expect(bulunan, `${t.name} Yetkiler alt maddelerinde tam bir kez gecmeli`).toHaveLength(1);
      if (t.scope) expect(bulunan[0], t.name).toContain(`(${t.scope})`);
      else expect(bulunan[0], t.name).toContain('herhangi bir "Yazma" yetkisi');
    }
    // Okuma araci yazma maddesine yazilmaz
    for (const a of yer.keys()) expect(all.find((t) => t.name === a)!.mutating, `${a} yazma araci degil`).toBe(true);
  });

  it('okuma araclarinin scope\'lari "Okuma araçları ... ister" cumlesinde; scope\'suz okuma araclari yalniz aksiyon plani ve uygulama (ASO) araclari', () => {
    const blok = yetkiler().replace(/\s+/g, ' ');
    const cumle = blok.slice(blok.indexOf('Okuma araçları'));
    const okumaScope = new Set(all.filter((t) => !t.mutating && t.scope).map((t) => t.scope!));
    expect(okumaScope.size).toBeGreaterThan(0);
    const anilanScope = new Set([...cumle.matchAll(/\(([a-z]+:read)\)/g)].map((m) => m[1]));
    expect([...anilanScope].sort()).toEqual([...okumaScope].sort());

    const scopesuz = all.filter((t) => !t.mutating && !t.scope).map((t) => t.name);
    for (const ad of scopesuz) expect(ad, 'scope\'suz okuma araci aksiyon plani ya da uygulama araci olmali').toMatch(/action_plan|_apps?_|tracked_apps/);
    expect(blok).toContain('Aksiyon planı ve uygulama (ASO) okuma araçları her anahtarla çalışır');
  });

  it('"varsayılan anahtar ... okuma araçlarının hepsi bu anahtarla çalışır" ve "Yazma, aynı kaynağın okumasını da açar" kodla dogru', () => {
    const keys = new ApiKeysService({} as never);
    for (const t of all.filter((x) => !x.mutating && x.scope)) {
      expect(keys.hasScopeForRoute([...DEFAULT_SCOPES], t.scope!), t.name).toBe(true);
    }
    for (const t of all.filter((x) => x.mutating && x.scope)) {
      // Varsayilan anahtar yazma araclarini acamaz
      expect(keys.hasScopeForRoute([...DEFAULT_SCOPES], t.scope!), t.name).toBe(false);
      const okuma = t.scope!.replace(/:write$/, ':read');
      expect(keys.hasScopeForRoute([t.scope!], okuma), `${t.scope} ${okuma}'yi kapsamali`).toBe(true);
    }
  });

  it('eski yanlis metin geri gelmez', () => {
    expect(setup).not.toMatch(/en\s+az\s+bir\s+"Yazma"\s+yetkisi\s+ver/);
    expect(setup).not.toContain('bu API anahtari salt-okunur');
  });
});
