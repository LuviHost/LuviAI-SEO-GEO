import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AiCitationService } from '../audit/ai-citation.service.js';
import { containsBrand } from '../audit/brand-in-query.js';
import { LLMProviderService } from '../llm/llm-provider.service.js';
import { parseJsonFromLlm } from '../common/safe-json.js';

/**
 * App Prompt Lab — GEO ⨉ ASO kesisimi. RAKIPTE YOK.
 *
 * Klasik ASO "App Store'da kacinci siradayim" olcer. 2026'da kullanicilar
 * uygulama tavsiyesini ChatGPT/Gemini/Claude'a soruyor: "en iyi X uygulamasi
 * hangisi?" Bu servis o soruyu GERCEK saglayicilara sorar ve olcer:
 *   - appMentioned: uygulama adi cevapta gecti mi (brandMentioned)
 *   - storeLinked : cevap bizim store sayfamiza link verdi mi (cited)
 *   - rakip appler kimler
 *
 * Veri modeli: GeoPrompt(trackedAppId dolu) + GeoPromptRun — Prompt Lab
 * altyapisiyla ayni tablolar, ayri yuzey.
 */

const MAX_APP_PROMPTS = 50;

@Injectable()
export class AsoPromptLabService {
  private readonly log = new Logger(AsoPromptLabService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly citation: AiCitationService,
    private readonly llm: LLMProviderService,
  ) {}

  // ────────────────────────────────────────────────────────────

  private async requireApp(siteId: string, appId: string) {
    const app = await this.prisma.trackedApp.findFirst({ where: { id: appId, siteId } });
    if (!app) throw new NotFoundException('Uygulama bulunamadi');
    return app;
  }

  async list(siteId: string, appId: string) {
    await this.requireApp(siteId, appId);
    const prompts = await this.prisma.geoPrompt.findMany({
      where: { siteId, trackedAppId: appId },
      orderBy: { createdAt: 'desc' },
    });
    return prompts.map((p) => ({
      id: p.id,
      text: p.text,
      intent: p.intent,
      source: p.source,
      isActive: p.isActive,
      lastRunAt: p.lastRunAt,
      // App baglaminda: cited = store linki, mentioned = app adi
      lastLinkedCount: p.lastCitedCount,
      lastTotalCount: p.lastTotalCount,
      lastScore: p.lastTotalCount > 0 ? Math.round((p.lastCitedCount / p.lastTotalCount) * 100) : null,
      createdAt: p.createdAt,
    }));
  }

  async add(siteId: string, appId: string, text: string) {
    await this.requireApp(siteId, appId);
    const clean = (text ?? '').trim();
    if (clean.length < 5 || clean.length > 500) {
      throw new BadRequestException('Soru 5-500 karakter olmali');
    }
    const count = await this.prisma.geoPrompt.count({ where: { siteId, trackedAppId: appId } });
    if (count >= MAX_APP_PROMPTS) {
      throw new BadRequestException(`Uygulama basina en fazla ${MAX_APP_PROMPTS} soru izlenebilir`);
    }
    return this.prisma.geoPrompt.create({
      data: { siteId, trackedAppId: appId, text: clean, intent: 'commercial', source: 'manual' },
    });
  }

  async remove(siteId: string, appId: string, promptId: string) {
    const prompt = await this.prisma.geoPrompt.findFirst({
      where: { id: promptId, siteId, trackedAppId: appId },
    });
    if (!prompt) throw new NotFoundException('Soru bulunamadi');
    await this.prisma.geoPrompt.delete({ where: { id: prompt.id } });
    return { ok: true };
  }

  /** Kategori-tabanli soru onerileri — LLM, tek cagri */
  async suggest(siteId: string, appId: string): Promise<{ suggested: string[]; created: number }> {
    const app = await this.requireApp(siteId, appId);
    const res = await this.llm.chat({
      context: 'aso-prompt-suggest',
      siteId,
      model: 'claude-opus-5',
      maxTokens: 600,
      systemPrompt: [
        'Kullanicilarin bir AI asistana (ChatGPT/Gemini) uygulama tavsiyesi sorarken kullanacagi sorulari uret.',
        'YANIT: yalnizca JSON dizi of string. 8 soru. Turkce. Uygulama ADINI sorularda GECIRME (marka-disi sorgular).',
        'Karisim: "en iyi X uygulamasi", "X icin hangi app", "ucretsiz X app", "X vs" karsilastirma, guven ("guvenilir mi").',
      ].join('\n'),
      messages: [{
        role: 'user',
        content: `Uygulama: ${app.name}. Kategori: ${app.category ?? 'bilinmiyor'}. Ulke: ${app.country}.`,
      }],
    });

    const parsed = parseJsonFromLlm<any>(res.output);
    const suggestions: string[] = Array.isArray(parsed)
      ? parsed.filter((s) => typeof s === 'string' && s.trim().length >= 5).slice(0, 8)
      : [];

    // Var olanlarla dedup edip olustur
    const existing = await this.prisma.geoPrompt.findMany({
      where: { siteId, trackedAppId: appId },
      select: { text: true },
    });
    const seen = new Set(existing.map((e) => e.text.toLowerCase().trim()));
    let created = 0;
    for (const s of suggestions) {
      if (seen.has(s.toLowerCase().trim())) continue;
      await this.prisma.geoPrompt.create({
        data: { siteId, trackedAppId: appId, text: s.trim(), intent: 'commercial', source: 'suggested' },
      });
      created++;
    }
    return { suggested: suggestions, created };
  }

  /**
   * Tek sorunun olcumu — 7 saglayiciya sorar.
   * cited = cevapta BIZIM store sayfamiza link var
   * brandMentioned = uygulama adi gecti
   */
  async run(siteId: string, appId: string, promptId: string) {
    const app = await this.requireApp(siteId, appId);
    const prompt = await this.prisma.geoPrompt.findFirst({
      where: { id: promptId, siteId, trackedAppId: appId },
    });
    if (!prompt) throw new NotFoundException('Soru bulunamadi');

    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    const host = site.url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

    const results = await this.citation.runPublicProbes({
      brand: app.name,
      host,
      queries: [prompt.text],
      competitors: [],
    });

    const today = this.utcToday();
    const providerRows: Array<{
      provider: string;
      label: string;
      available: boolean;
      reason?: string;
      appMentioned: boolean;
      storeLinked: boolean;
      excerpt?: string;
      competitors?: any[];
    }> = [];

    const runRows: any[] = [];
    // Dongu-sabiti: deger yalnizca prompt metnine bagli, saglayici basina
    // ayni katlama+regex'i tekrarlamaya gerek yok.
    const promptIsBranded = containsBrand(prompt.text, app.name);
    for (const r of results) {
      if (!r.available || r.probes.length === 0) {
        providerRows.push({
          provider: r.provider, label: r.label, available: false, reason: r.reason,
          appMentioned: false, storeLinked: false,
        });
        continue;
      }
      const probe = r.probes[0]!;
      if (probe.excerpt?.startsWith('HATA:')) {
        providerRows.push({
          provider: r.provider, label: r.label, available: false, reason: probe.excerpt.slice(0, 120),
          appMentioned: false, storeLinked: false,
        });
        continue;
      }

      const storeLinked = this.detectStoreLink(probe.excerpt ?? '', app);
      providerRows.push({
        provider: r.provider,
        label: r.label,
        available: true,
        appMentioned: probe.brandMentioned,
        storeLinked,
        excerpt: probe.excerpt?.slice(0, 600),
        competitors: probe.competitors,
      });
      runRows.push({
        siteId,
        promptId: prompt.id,
        fanoutId: null,
        provider: r.provider,
        date: today,
        cited: storeLinked,
        brandMentioned: probe.brandMentioned,
        // Uygulama adi sorunun kendisinde geciyorsa asistanin uygulamayi
        // anmasi neredeyse totolojik. Bu satirlar zaten site KPI'sina
        // girmiyor (trackedAppId dolu), ama sutunun ASO ekraninda da dogru
        // olmasi icin burada da hesaplaniyor. bkz. audit/brand-in-query.ts
        brandInQuery: promptIsBranded,
        position: probe.position ?? null,
        sentiment: probe.sentiment ?? null,
        excerpt: probe.excerpt?.slice(0, 2000) ?? null,
        competitors: probe.competitors?.length ? (probe.competitors as any) : undefined,
      });
    }

    if (runRows.length > 0) {
      await this.prisma.geoPromptRun.createMany({ data: runRows });
      const linked = runRows.filter((r) => r.cited).length;
      await this.prisma.geoPrompt.update({
        where: { id: prompt.id },
        data: { lastRunAt: new Date(), lastCitedCount: linked, lastTotalCount: runRows.length },
      });
    }

    const valid = providerRows.filter((p) => p.available);
    return {
      promptId: prompt.id,
      text: prompt.text,
      app: { id: app.id, name: app.name },
      summary: {
        mentioned: valid.filter((p) => p.appMentioned).length,
        storeLinked: valid.filter((p) => p.storeLinked).length,
        total: valid.length,
      },
      providers: providerRows,
      runAt: new Date().toISOString(),
    };
  }

  /** Zaman serisi — app sorusu icin gunluk mention/link orani */
  async history(siteId: string, appId: string, promptId: string, days = 30) {
    const prompt = await this.prisma.geoPrompt.findFirst({
      where: { id: promptId, siteId, trackedAppId: appId },
      select: { id: true },
    });
    if (!prompt) throw new NotFoundException('Soru bulunamadi');

    const since = new Date(Date.now() - Math.min(Math.max(days, 1), 365) * 86_400_000);
    const runs = await this.prisma.geoPromptRun.findMany({
      where: { promptId, siteId, date: { gte: since } },
      orderBy: { date: 'asc' },
      select: { date: true, cited: true, brandMentioned: true },
    });

    const byDate = new Map<string, { mentioned: number; linked: number; total: number }>();
    for (const r of runs) {
      const key = r.date.toISOString().slice(0, 10);
      const cur = byDate.get(key) ?? { mentioned: 0, linked: 0, total: 0 };
      cur.total++;
      if (r.brandMentioned) cur.mentioned++;
      if (r.cited) cur.linked++;
      byDate.set(key, cur);
    }
    return Array.from(byDate.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  // ────────────────────────────────────────────────────────────

  /** Cevapta BIZIM uygulamamizin store linki var mi (genel store linki degil) */
  private detectStoreLink(excerpt: string, app: { appStoreId: string | null; playStoreId: string | null; name: string }): boolean {
    const text = excerpt.toLowerCase();
    if (app.appStoreId && text.includes(`id${app.appStoreId}`)) return true;
    if (app.playStoreId && text.includes(app.playStoreId.toLowerCase())) return true;
    // Slug fallback: apps.apple.com/.../app-adi/ geciyorsa
    const slug = app.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (slug.length >= 4 && (text.includes(`apps.apple.com`) || text.includes('play.google.com')) && text.includes(slug)) return true;
    return false;
  }

  private utcToday(): Date {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
}
