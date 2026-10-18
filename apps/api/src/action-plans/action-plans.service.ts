import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Action Plans — tum modullerden toplanan is listesi.
 * Audit bulgusu, GEO onerisi, AXO eksigi, ASO aksiyonu, chat onerisi...
 * hepsi "Aksiyon Planina Ekle" ile buraya duser. Urunu rapor olmaktan
 * cikarip is yonetimine ceviren katman.
 */

const SOURCES = [
  'audit', 'geo', 'agent_readiness', 'citation', 'prompt_lab',
  'aso', 'ads', 'qa', 'chat', 'product_radar', 'community', 'manual',
  // 'intel': istihbarat defterinden ADMIN ONAYIYLA acilan aksiyon (otomatik
  // uretim yok — iddialar kuresel, siteye adreslenemez; bkz. intel-action.service.ts)
  'intel',
] as const;
const STATUSES = ['todo', 'in_progress', 'done', 'dismissed'] as const;
const IMPACTS = ['high', 'medium', 'low'] as const;
const EFFORTS = ['easy', 'medium', 'hard'] as const;

/** meta JSON ust siniri — istemci verisi DB'ye sinirsiz yazilmasin */
const META_MAX_CHARS = 10_000;
/**
 * title ve sourceRef kolonlari VARCHAR(191) (migration 20260812153747).
 * Baslik kurali 3-300 karakter olarak kalir ama 191'i asan baslik kati SQL
 * kipinde (MySQL 8 varsayilani) Prisma P2000 ile 500 verir (haftalik plan /
 * istihbarat 300'e kadar kesiyordu) — yazmadan once 191'e kisaltilir.
 */
const DB_VARCHAR_MAX = 191;

function fitTitle(t: string): string {
  return t.length <= DB_VARCHAR_MAX ? t : `${t.slice(0, DB_VARCHAR_MAX - 1).trimEnd()}…`;
}

/** '' / null / undefined → tarih yok; gecersiz tarih Prisma'da 500 yerine 400 */
function parseDueAt(v: unknown): Date | null {
  if (v === undefined || v === null || v === '') return null;
  const d = typeof v === 'string' ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) throw new BadRequestException('dueAt geçerli bir tarih olmalı');
  return d;
}

@Injectable()
export class ActionPlansService {
  constructor(private readonly prisma: PrismaService) {}

  async list(siteId: string, opts: { status?: string; source?: string } = {}) {
    // Yalniz dize suzgec: ?status[not]=x sorgu ayristiricida, MCP arguman
    // JSON'unda nesne olur ve Prisma'da filtre islemine donusurdu
    const status = typeof opts.status === 'string' && opts.status ? opts.status : undefined;
    const source = typeof opts.source === 'string' && opts.source ? opts.source : undefined;
    return this.prisma.actionPlanItem.findMany({
      where: {
        siteId,
        ...(status ? { status } : {}),
        ...(source ? { source } : {}),
      },
      orderBy: [
        { status: 'asc' },
        { impact: 'asc' }, // 'high' < 'low' < 'medium' alfabetik — asagida yeniden siralanir
        { createdAt: 'desc' },
      ],
      take: 300,
    }).then((items) => {
      const impactRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
      const statusRank: Record<string, number> = { todo: 0, in_progress: 1, done: 2, dismissed: 3 };
      return items.sort((a, b) =>
        (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) ||
        (impactRank[a.impact] ?? 9) - (impactRank[b.impact] ?? 9) ||
        b.createdAt.getTime() - a.createdAt.getTime(),
      );
    });
  }

  async counts(siteId: string) {
    const [todo, inProgress, done] = await Promise.all([
      this.prisma.actionPlanItem.count({ where: { siteId, status: 'todo' } }),
      this.prisma.actionPlanItem.count({ where: { siteId, status: 'in_progress' } }),
      this.prisma.actionPlanItem.count({ where: { siteId, status: 'done' } }),
    ]);
    return { todo, inProgress, done };
  }

  async create(siteId: string, input: {
    title?: string;
    description?: string;
    source?: string;
    sourceRef?: string;
    impact?: string;
    effort?: string;
    dueAt?: string;
    meta?: any;
  }) {
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (title.length < 3 || title.length > 300) {
      throw new BadRequestException('Başlık 3-300 karakter olmalı');
    }
    const source = SOURCES.includes(input.source as any) ? input.source! : 'manual';
    // Yalniz dize: nesne gelirse Prisma where'inde filtre olurdu ({ not: null })
    const sourceRef = typeof input.sourceRef === 'string' && input.sourceRef ? input.sourceRef.slice(0, DB_VARCHAR_MAX) : null;
    const description = typeof input.description === 'string' ? input.description.slice(0, 5000) : null;
    const dueAt = parseDueAt(input.dueAt);
    const meta = input.meta !== undefined && input.meta !== null ? input.meta : undefined;
    if (meta !== undefined && (typeof meta !== 'object' || Array.isArray(meta) || JSON.stringify(meta).length > META_MAX_CHARS)) {
      throw new BadRequestException(`meta en fazla ${META_MAX_CHARS} karakterlik bir nesne olmalı`);
    }

    // Ayni kaynak + referanstan cift kayit acma (ör. ayni check iki kez eklenmesin)
    if (sourceRef) {
      const dup = await this.prisma.actionPlanItem.findFirst({
        where: { siteId, source, sourceRef, status: { in: ['todo', 'in_progress'] } },
      });
      if (dup) return dup;
    }

    return this.prisma.actionPlanItem.create({
      data: {
        siteId,
        title: fitTitle(title),
        description,
        source,
        sourceRef,
        impact: IMPACTS.includes(input.impact as any) ? input.impact! : 'medium',
        effort: EFFORTS.includes(input.effort as any) ? input.effort! : 'medium',
        dueAt: dueAt ?? null,
        meta,
      },
    });
  }

  async update(siteId: string, id: string, input: {
    title?: string;
    description?: string;
    status?: string;
    impact?: string;
    effort?: string;
    dueAt?: string | null;
  }) {
    const item = await this.require(siteId, id);

    const data: any = {};
    if (input.title !== undefined) {
      const t = String(input.title).trim();
      if (t.length < 3 || t.length > 300) throw new BadRequestException('Başlık 3-300 karakter olmalı');
      data.title = fitTitle(t);
    }
    if (input.description !== undefined) data.description = input.description === null ? null : String(input.description).slice(0, 5000);
    if (input.status !== undefined) {
      if (!STATUSES.includes(input.status as any)) {
        throw new BadRequestException(`Durum yalnizca ${STATUSES.join('/')} olabilir`);
      }
      data.status = input.status;
      data.doneAt = input.status === 'done' ? new Date() : null;
    }
    if (input.impact !== undefined && IMPACTS.includes(input.impact as any)) data.impact = input.impact;
    if (input.effort !== undefined && EFFORTS.includes(input.effort as any)) data.effort = input.effort;
    if (input.dueAt !== undefined) data.dueAt = parseDueAt(input.dueAt) ?? null;

    return this.prisma.actionPlanItem.update({ where: { id: item.id }, data });
  }

  async remove(siteId: string, id: string) {
    const item = await this.require(siteId, id);
    await this.prisma.actionPlanItem.delete({ where: { id: item.id } });
    return { ok: true };
  }

  private async require(siteId: string, id: string) {
    // Tenant izolasyonu — id + siteId birlikte
    const item = await this.prisma.actionPlanItem.findFirst({ where: { id, siteId } });
    if (!item) throw new NotFoundException('Aksiyon bulunamadi');
    return item;
  }
}
