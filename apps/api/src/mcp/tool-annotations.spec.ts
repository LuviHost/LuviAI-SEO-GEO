import { describe, it, expect } from 'vitest';
import { McpToolsService, toolAnnotations, type ToolUser } from './mcp-tools.service.js';
import { QuotaService } from '../billing/quota.service.js';

/**
 * MCP arac ipuclari (annotations) — tools/list'teki her aracin title +
 * readOnlyHint/destructiveHint tasidigini ve mutating bayragiyla celismedigini
 * sabitler. Anthropic baglayici incelemesi bunlari zorunlu tutuyor ve Claude
 * onay sorup sormamaya bunlarla karar veriyor: yanlis "salt-okuma" etiketi,
 * kota harcayan bir aracin onaysiz calismasi demek.
 */

function toolsService(plan: string): McpToolsService {
  const prisma = { user: { findUniqueOrThrow: async () => ({ plan }) } } as never;
  const n = null as never;
  return new McpToolsService(prisma, n, new QuotaService(prisma), n, n, n, n, n, n, n, n, n, n);
}

const admin: ToolUser = { id: 'u1', role: 'ADMIN', plan: 'ENTERPRISE' };

/**
 * Var olan veriyi USTUNE YAZAN yazma araclari. Yeni bir yazma araci
 * eklenirse burada bilincli karar verilmeli (varsayilan destructive=true).
 */
const DESTRUCTIVE = new Set(['generate_article_from_opportunity', 'update_action_plan_item']);

/** Yalnizca kendi veritabanimiza dokunan yazma araclari (openWorldHint=false) */
const CLOSED_WORLD_WRITES = new Set(['derive_content_opportunities', 'add_action_plan_item', 'update_action_plan_item']);

describe('MCP tool annotations', () => {
  const svc = toolsService('ENTERPRISE');
  const defs = svc.list();
  const mcp = svc.listForMcp(admin);

  it('tools/list her aracta annotations tasiyor: title + boolean ipuclari', () => {
    expect(mcp.length).toBe(defs.length);
    for (const t of mcp) {
      expect(t.annotations, t.name).toBeDefined();
      expect(t.annotations.title).toBe(t.title);
      for (const k of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'] as const) {
        expect(typeof t.annotations[k], `${t.name}.${k}`).toBe('boolean');
      }
    }
  });

  it('readOnlyHint mutating bayraginin tam tersi; salt-okuma araci destructive olamaz', () => {
    for (const d of defs) {
      const a = toolAnnotations(d);
      expect(a.readOnlyHint, d.name).toBe(!d.mutating);
      if (!d.mutating) {
        expect(a.destructiveHint, d.name).toBe(false);
        expect(a.openWorldHint, `${d.name} yalnizca kendi DB'mizi okur`).toBe(false);
      }
    }
  });

  it('destructive araclar beklenen kume ile birebir ayni', () => {
    const actual = defs.filter((d) => toolAnnotations(d).destructiveHint).map((d) => d.name).sort();
    expect(actual).toEqual([...DESTRUCTIVE].sort());
  });

  it('yazma araclarinin dis dunya ipucu beklenen gibi', () => {
    for (const d of defs.filter((x) => x.mutating)) {
      expect(toolAnnotations(d).openWorldHint, d.name).toBe(!CLOSED_WORLD_WRITES.has(d.name));
    }
  });

  it('kota/maliyet tuketen araclar salt-okuma GORUNMUYOR', () => {
    for (const name of ['run_audit', 'run_prompt', 'create_article', 'generate_article_from_opportunity', 'suggest_image_alts']) {
      const t = mcp.find((x) => x.name === name)!;
      expect(t.annotations.readOnlyHint, name).toBe(false);
    }
  });

  it('karar verilmemis yeni yazma araci temkinli varsayilana duser (destructive, open world)', () => {
    expect(toolAnnotations({ title: 'Yeni', mutating: true })).toEqual({
      title: 'Yeni', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true,
    });
    expect(toolAnnotations({ title: 'Oku' })).toEqual({
      title: 'Oku', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false,
    });
  });

  it('plan suzgeci annotations ile de calisiyor (STARTER listesinde kilitli arac yok, ipucu var)', () => {
    const starter = toolsService('STARTER').listForMcp({ id: 'u2', role: 'USER', plan: 'STARTER' });
    expect(starter.map((t) => t.name)).not.toContain('run_agent_readiness_scan');
    expect(starter.every((t) => typeof t.annotations.readOnlyHint === 'boolean')).toBe(true);
  });
});

describe('get_app_keywords aciklamasi', () => {
  it('popularity\'yi magaza arama hacmi gibi sunmuyor, nasil turetildigini soyluyor', () => {
    const d = toolsService('ENTERPRISE').list().find((t) => t.name === 'get_app_keywords')!;
    expect(d.description).toMatch(/arama hacmi veya populerligi DEGILDIR/);
    expect(d.description).toMatch(/talep tahmini/);
    expect(d.description).toMatch(/ilk 10/);
  });
});
