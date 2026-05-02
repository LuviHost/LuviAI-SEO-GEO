import { Injectable, Logger, OnModuleInit, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  SETTINGS_BY_KEY,
  SETTINGS_CATALOG,
  type SettingCategory,
  type SettingMeta,
} from './settings.constants.js';

const CACHE_TTL_MS = 30_000;

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly log = new Logger(SettingsService.name);
  private cache = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // Boot anında DB de eksik olan tüm catalog kaydını seed et — admin panelde
    // listeleme ve audit log icin kayitlarin var olması lazım.
    try {
      const existing = await this.prisma.appSetting.findMany({ select: { key: true } });
      const have = new Set(existing.map((r) => r.key));
      const missing = SETTINGS_CATALOG.filter((m) => !have.has(m.key));
      if (missing.length === 0) {
        this.log.log(`Settings catalog senkron (${existing.length} kayit DB de)`);
        return;
      }
      const now = new Date();
      for (const m of missing) {
        // Env de kayit varsa onu DB ye seed et — yoksa default a dus.
        const initial =
          m.envFallback && process.env[m.key] !== undefined
            ? String(process.env[m.key])
            : m.default;
        await this.prisma.appSetting.create({
          data: {
            key: m.key,
            value: initial,
            type: m.type,
            category: m.category,
            description: m.description,
            updatedAt: now,
          },
        });
      }
      this.log.log(`Settings seed: ${missing.length} eksik kayit eklendi (env/default).`);
    } catch (err: any) {
      this.log.warn(`Settings seed atlandı: ${err.message}`);
    }
  }

  /** Raw string deger. Cache miss te DB ye gider, hala yoksa env veya default. */
  async getRaw(key: string): Promise<string> {
    const meta = SETTINGS_BY_KEY.get(key);
    if (!meta) throw new Error(`Bilinmeyen setting key: ${key}`);

    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const row = await this.prisma.appSetting.findUnique({ where: { key } });
    let value: string;
    if (row) value = row.value;
    else if (meta.envFallback && process.env[key] !== undefined) value = String(process.env[key]);
    else value = meta.default;

    this.cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }

  async getBoolean(key: string): Promise<boolean> {
    const raw = (await this.getRaw(key)).trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
  }

  /**
   * AI servisleri (Anthropic / OpenAI / Gemini / Perplexity / Sora) için merkezi guard.
   * AI_GLOBAL_DISABLED=1 iken çağrıyı engeller — admin panelden test modu.
   * Throws ServiceUnavailableException — frontend kullanıcıya net mesaj gösterir.
   */
  async assertAiEnabled(reason?: string): Promise<void> {
    if (await this.getBoolean('AI_GLOBAL_DISABLED')) {
      this.log.warn(`AI çağrısı atlandı (AI_GLOBAL_DISABLED=1)${reason ? ` — ${reason}` : ''}`);
      throw new ServiceUnavailableException(
        'AI test modu aktif (admin panelden AI_GLOBAL_DISABLED kapalı). Gerçek üretim için admin panelden kapatmalısın.',
      );
    }
  }

  async getInt(key: string): Promise<number> {
    const raw = await this.getRaw(key);
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) {
      this.log.warn(`Setting ${key} int e cevrilemedi (${raw}), 0 dondu`);
      return 0;
    }
    return n;
  }

  async getString(key: string): Promise<string> {
    return this.getRaw(key);
  }

  /** Tum catalog + güncel value lar (admin panelde liste icin). */
  async listAll(): Promise<Array<SettingMeta & { value: string; updatedAt: Date | null; updatedBy: string | null }>> {
    const rows = await this.prisma.appSetting.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return SETTINGS_CATALOG.map((m) => {
      const row = byKey.get(m.key);
      return {
        ...m,
        value:
          row?.value ??
          (m.envFallback && process.env[m.key] !== undefined ? String(process.env[m.key]) : m.default),
        updatedAt: row?.updatedAt ?? null,
        updatedBy: row?.updatedBy ?? null,
      };
    });
  }

  /** Kategori bazinda gruplu liste — admin panel UI siralamasi icin. */
  async listByCategory(): Promise<Record<SettingCategory, Awaited<ReturnType<SettingsService['listAll']>>>> {
    const all = await this.listAll();
    const out: Record<string, any[]> = {};
    for (const it of all) {
      out[it.category] = out[it.category] ?? [];
      out[it.category].push(it);
    }
    return out as any;
  }

  /** Tek setting in audit gecmisi (son N kayit). */
  async getAuditLog(key: string, limit = 50) {
    return this.prisma.settingAuditLog.findMany({
      where: { key },
      orderBy: { changedAt: 'desc' },
      take: limit,
    });
  }

  /** Genel audit gecmisi (admin tum ayarlarda kim ne yapti). */
  async getRecentAudits(limit = 100) {
    return this.prisma.settingAuditLog.findMany({
      orderBy: { changedAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Ayar yaz. Type validation + audit log + cache invalidate.
   */
  async set(
    key: string,
    newValue: string,
    changedBy: string,
    ctx?: { ipAddress?: string; userAgent?: string },
  ) {
    const meta = SETTINGS_BY_KEY.get(key);
    if (!meta) throw new BadRequestException(`Bilinmeyen ayar: ${key}`);

    const normalized = this.validateAndNormalize(meta, newValue);

    const existing = await this.prisma.appSetting.findUnique({ where: { key } });
    const oldValue = existing?.value ?? null;

    if (oldValue === normalized) {
      // Degisiklik yok — log kirletmemek icin no-op
      return { key, value: normalized, unchanged: true };
    }

    await this.prisma.$transaction([
      this.prisma.appSetting.upsert({
        where: { key },
        create: {
          key,
          value: normalized,
          type: meta.type,
          category: meta.category,
          description: meta.description,
          updatedBy: changedBy,
        },
        update: {
          value: normalized,
          type: meta.type,
          category: meta.category,
          description: meta.description,
          updatedBy: changedBy,
        },
      }),
      this.prisma.settingAuditLog.create({
        data: {
          key,
          oldValue,
          newValue: normalized,
          changedBy,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
        },
      }),
    ]);

    this.cache.delete(key);
    this.log.log(`Setting [${key}] ${oldValue ?? '(yok)'} -> ${normalized} (by ${changedBy})`);

    return { key, value: normalized, unchanged: false, oldValue };
  }

  /** Catalog metadata'sina gore deger normalize + validate. */
  private validateAndNormalize(meta: SettingMeta, raw: string): string {
    const v = String(raw).trim();
    switch (meta.type) {
      case 'boolean': {
        const ok = ['1', '0', 'true', 'false', 'yes', 'no', 'on', 'off'];
        if (!ok.includes(v.toLowerCase())) {
          throw new BadRequestException(`${meta.key} boolean olmali (${ok.join('/')})`);
        }
        const truthy = ['1', 'true', 'yes', 'on'];
        return truthy.includes(v.toLowerCase()) ? '1' : '0';
      }
      case 'int': {
        const n = parseInt(v, 10);
        if (Number.isNaN(n)) throw new BadRequestException(`${meta.key} integer olmali`);
        return String(n);
      }
      case 'enum': {
        if (!meta.enumValues || !meta.enumValues.includes(v)) {
          throw new BadRequestException(
            `${meta.key} icin gecerli degerler: ${meta.enumValues?.join(', ')}`,
          );
        }
        return v;
      }
      case 'string':
      default:
        return v;
    }
  }

  /** Test/admin amacli cache i temizle. */
  invalidate(key?: string) {
    if (key) this.cache.delete(key);
    else this.cache.clear();
  }
}
