/**
 * MCP kurulum kartinin yetki metni = araclarin GERCEK scope'lari (inceleme S23).
 * Kaynaklar: api mcp/mcp-tools.service.ts (ToolDef: name, scope, mutating) ve
 * public/agent-setup.txt "Yetkiler" maddesi (api mcp/agent-setup-scopes.spec.ts onu da
 * araclarla karsilastirir). Arac ya da scope degisirse bu test kartin metni icin kirilir.
 * Calistirma: cd apps/web && ../api/node_modules/.bin/vitest run --root . src/lib
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MCP_ANY_WRITE_TOOLS, MCP_WRITE_SCOPE_GUIDE, mcpScopeGuideText } from './mcp-setup';

const oku = (yol: string) => readFileSync(fileURLToPath(new URL(yol, import.meta.url)), 'utf8');

/** mcp-tools.service.ts build() icindeki arac tanimlari: ad, scope, yazma araci mi */
function araclar(): Array<{ name: string; scope: string | null; mutating: boolean }> {
  const src = oku('../../../api/src/mcp/mcp-tools.service.ts');
  const govde = src.slice(src.indexOf('private build(): ToolDef[]'));
  const parcalar = govde.split(/\n\s*name: '/).slice(1);
  return parcalar.map((p) => {
    const ad = p.slice(0, p.indexOf("'"));
    const scope = p.match(/^\s*scope: '([a-z]+:[a-z]+)'/m)?.[1] ?? null;
    return { name: ad, scope, mutating: /^\s*mutating: true/m.test(p) };
  });
}

describe('S23 — MCP kartinin yetki metni araclarin gercek scope\'lariyla ayni', () => {
  const tum = araclar();

  it('arac tanimlari okunabildi (kaynak bicimi degisirse once bu kirilir)', () => {
    expect(tum.length).toBeGreaterThan(20);
    expect(tum.find((t) => t.name === 'generate_article_from_opportunity')).toEqual({ name: 'generate_article_from_opportunity', scope: 'audit:write', mutating: true });
    expect(tum.find((t) => t.name === 'create_article')).toEqual({ name: 'create_article', scope: 'articles:write', mutating: true });
  });

  it('her scope\'lu yazma araci kartta kendi scope\'unun altinda; kartta olmayan arac yok', () => {
    const kart = new Map(MCP_WRITE_SCOPE_GUIDE.flatMap((g) => g.tools.map((t) => [t, g.scope] as const)));
    const yazma = tum.filter((t) => t.mutating && t.scope);
    expect(yazma.length).toBeGreaterThan(0);
    for (const t of yazma) expect(kart.get(t.name), t.name).toBe(t.scope);
    expect([...kart.keys()].sort()).toEqual(yazma.map((t) => t.name).sort());
    // Scope'suz yazma araclari (aksiyon plani) "herhangi bir Yazma" ile calisir
    expect([...MCP_ANY_WRITE_TOOLS].sort()).toEqual(tum.filter((t) => t.mutating && !t.scope).map((t) => t.name).sort());
  });

  it('kart agent-setup.txt ile ayni eslemeyi soyler (kartin kaynagi orasi)', () => {
    const rehber = oku('../../public/agent-setup.txt').replace(/\s+/g, ' ');
    for (const g of MCP_WRITE_SCOPE_GUIDE) {
      // "- Site denetimi → Yazma (audit:write): run_audit, ... - İçerikler → Yazma (articles:write): ..."
      const bas = rehber.indexOf(`${g.label} (${g.scope}):`);
      expect(bas, `${g.label} (${g.scope}) maddesi`).toBeGreaterThan(-1);
      const satir = rehber.slice(bas);
      const madde = satir.slice(0, satir.indexOf(' - ') === -1 ? undefined : satir.indexOf(' - '));
      for (const t of g.tools) expect(madde, `${g.scope} ${t}`).toContain(t);
    }
  });

  it('kart metni: firsattan makale uretimi Site denetimi → Yazma, create_article Icerikler → Yazma (eski metin ikisini de makale yazmaya bagliyordu)', () => {
    const metin = mcpScopeGuideText();
    expect(metin).toContain('fırsattan makale üretimi ve görsel alt metni önerisi için Site denetimi → Yazma');
    expect(metin).toContain('konu vererek makale üretimi (create_article) için İçerikler → Yazma');
    expect(metin).not.toMatch(/makale üretimi için makale yazma/);
    // Etiketler API Anahtarlari sayfasindaki satir adlariyla ayni
    const anahtarlar = oku('../app/(dashboard)/api-keys/page.tsx');
    expect(anahtarlar).toContain("audit: 'Site denetimi'");
    expect(anahtarlar).toContain("articles: 'İçerikler'");
    // Kart cumleyi bu kaynaktan alir (sabit eski metin geri gelmesin)
    const kart = oku('../components/mcp-setup-card.tsx');
    expect(kart).toContain('{mcpScopeGuideText()}');
    expect(kart).not.toContain('makale üretimi için makale yazma');
  });
});
