import { BadRequestException, ConflictException, ForbiddenException, GoneException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AppliedFixService } from '../../audit/applied-fix.service.js';
import { AscService, type RequestingUser } from './asc.service.js';
import { AscApiError, type AscApiClient } from './asc-api.client.js';
import { auditKeywordField } from '../keyword-field-audit.js';
import {
  ASC_FIELDS,
  appInfoStateOf,
  buildSnapshot,
  detectConflicts,
  groupPatches,
  pickAppInfo,
  pickVersion,
  planChanges,
  versionStateOf,
  type AscField,
  type MetadataSnapshot,
  type PlannedChange,
} from './asc-metadata.js';

const PLAN_TTL_MS = 15 * 60_000;
const PLAN_PREFIX = 'asc-meta-plan:';

interface StoredPlan {
  userId: string;
  siteId: string;
  ascAppId: string;
  appleAppId: string;
  versionId: string | null;
  appInfoId: string | null;
  changes: PlannedChange[];
  revertOf?: string;
  createdAt: string;
}

/** Apple hatasini kullanicinin anlayacagi cumleye cevirir */
export function explainAscError(err: unknown): string {
  if (err instanceof AscApiError) {
    if (err.status === 403) return 'Anahtar rolü yetersiz — App Store Connect API anahtarı App Manager ya da Admin rolünde olmalı.';
    if (err.status === 409) return `Apple bu değişikliği şu an kabul etmiyor${err.code ? ` (${err.code})` : ''}${err.detail ? `: ${err.detail}` : ''}`;
    if (err.status === 401) return 'Apple kimlik doğrulaması reddetti — anahtarı yeniden bağla.';
    return `Apple hatası ${err.status}${err.detail ? `: ${err.detail}` : ''}`;
  }
  return (err as Error)?.message ?? 'Bilinmeyen hata';
}

/**
 * App Store Connect metadata: cek → plan (dry-run fark) → onayla uygula → geri al.
 *
 * Guvenlik sozlesmesi:
 *  - Uygulama ONAY ister ve yalniz 15 dk icinde, plani yapan kullanici icin.
 *  - Uygulamadan once degerler YENIDEN cekilir; plandan sonra ASC'de degisen
 *    alan varsa hicbir sey yazilmaz (baskasinin panel duzenlemesi ezilmez).
 *  - Incelemeye ASLA gonderilmez; yalniz yerellestirme alanlari PATCH edilir.
 *  - Geri alma yeni bir plan uretir; o da onay ister.
 *  - Her basarili PATCH eski ve yeni degerle AppliedFix'e yazilir.
 */
@Injectable()
export class AscMetadataService {
  private readonly log = new Logger(AscMetadataService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly asc: AscService,
    private readonly appliedFix: AppliedFixService,
  ) {}

  private async loadForSite(siteId: string, ascAppId: string, user: RequestingUser) {
    const app = await this.asc.loadApp(ascAppId, user);
    if (app.account.siteId !== siteId) throw new NotFoundException('App bulunamadı');
    return app;
  }

  private async snapshot(client: AscApiClient, appleAppId: string): Promise<MetadataSnapshot & { versionLocaleCount: number }> {
    const [versionsRes, infosRes] = await Promise.all([
      client.listAppStoreVersions(appleAppId, 50, 'IOS'),
      client.listAppInfos(appleAppId),
    ]);
    const versions = versionsRes.data ?? [];
    const infos = infosRes.data ?? [];
    const version = pickVersion(versions.map((v) => ({ id: v.id, versionString: v.attributes?.versionString ?? '?', state: versionStateOf(v.attributes) })));
    const appInfo = pickAppInfo(infos.map((i) => ({ id: i.id, state: appInfoStateOf(i.attributes) })));
    const [versionLocs, appInfoLocs] = await Promise.all([
      version ? client.listVersionLocalizations(version.id).then((r) => r.data ?? []) : Promise.resolve([]),
      appInfo ? client.listAppInfoLocalizations(appInfo.id).then((r) => r.data ?? []) : Promise.resolve([]),
    ]);
    return { ...buildSnapshot({ versions, appInfos: infos, versionLocs, appInfoLocs, version, appInfo }), versionLocaleCount: versionLocs.length };
  }

  async pull(siteId: string, ascAppId: string, user: RequestingUser) {
    const app = await this.loadForSite(siteId, ascAppId, user);
    const client = await this.asc.getClient(app.accountId);
    try {
      const snap = await this.snapshot(client, app.appleAppId);
      const { versionLocaleCount: _n, ...rest } = snap;
      return { appName: app.name, appleAppId: app.appleAppId, ...rest };
    } catch (err) {
      throw new BadRequestException(explainAscError(err));
    }
  }

  async plan(
    siteId: string,
    ascAppId: string,
    user: RequestingUser,
    body: { locale?: unknown; fields?: Record<string, unknown> },
    opts: { revertOf?: string } = {},
  ) {
    const locale = typeof body?.locale === 'string' ? body.locale.trim() : '';
    if (!locale) throw new BadRequestException('locale gerekli (ör. tr, en-US)');
    const fields: Partial<Record<AscField, unknown>> = {};
    for (const f of ASC_FIELDS) if (body?.fields && f in body.fields) fields[f] = body.fields[f];
    if (Object.keys(fields).length === 0) throw new BadRequestException('Değiştirilecek alan yok');

    const app = await this.loadForSite(siteId, ascAppId, user);
    const client = await this.asc.getClient(app.accountId);
    let snap: MetadataSnapshot;
    try {
      snap = await this.snapshot(client, app.appleAppId);
    } catch (err) {
      throw new BadRequestException(explainAscError(err));
    }

    const changes = planChanges(snap, { [locale]: fields });
    const current = snap.locales[locale]?.values ?? {};
    const keywordAudit = typeof fields.keywords === 'string'
      ? auditKeywordField({
          keywords: fields.keywords,
          appName: typeof fields.name === 'string' ? fields.name : current.name,
          subtitle: typeof fields.subtitle === 'string' ? fields.subtitle : current.subtitle,
        })
      : null;

    const applicable = changes.filter((c) => c.ok);
    const base = {
      version: snap.version,
      appInfo: snap.appInfo,
      changes,
      keywordAudit,
    };
    if (applicable.length === 0) return { ...base, planId: null, expiresAt: null };

    // Suresi gecmis planlari temizle (terk edilen planlar birikmesin)
    await this.prisma.kvStore.deleteMany({ where: { key: { startsWith: PLAN_PREFIX }, expiresAt: { lt: new Date() } } }).catch(() => undefined);

    const planId = randomUUID();
    const expiresAt = new Date(Date.now() + PLAN_TTL_MS);
    const stored: StoredPlan = {
      userId: user.id,
      siteId,
      ascAppId,
      appleAppId: app.appleAppId,
      versionId: snap.version?.id ?? null,
      appInfoId: snap.appInfo?.id ?? null,
      changes: applicable,
      ...(opts.revertOf ? { revertOf: opts.revertOf } : {}),
      createdAt: new Date().toISOString(),
    };
    await this.prisma.kvStore.create({ data: { key: PLAN_PREFIX + planId, value: JSON.stringify(stored), expiresAt } });
    return { ...base, planId, expiresAt: expiresAt.toISOString() };
  }

  async apply(siteId: string, ascAppId: string, user: RequestingUser, body: { planId?: unknown; confirm?: unknown }) {
    if (body?.confirm !== true) throw new BadRequestException('Uygulamak için açık onay gerekli (confirm: true)');
    const planId = typeof body?.planId === 'string' ? body.planId : '';
    const row = planId ? await this.prisma.kvStore.findUnique({ where: { key: PLAN_PREFIX + planId } }) : null;
    if (!row) throw new NotFoundException('Plan bulunamadı — yeniden plan oluştur');
    const plan = JSON.parse(row.value) as StoredPlan;
    if (plan.ascAppId !== ascAppId || plan.siteId !== siteId) throw new NotFoundException('Plan bulunamadı');
    if (plan.userId !== user.id && user.role !== 'ADMIN') throw new ForbiddenException('Bu plan başka bir kullanıcıya ait');
    // Tek kullanimlik: suresi gecmis olsa da silinir
    await this.prisma.kvStore.delete({ where: { key: row.key } }).catch(() => undefined);
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) throw new GoneException('Planın süresi doldu (15 dk) — yeniden plan oluştur');

    const app = await this.loadForSite(siteId, ascAppId, user);
    const client = await this.asc.getClient(app.accountId);
    let current: MetadataSnapshot;
    try {
      current = await this.snapshot(client, app.appleAppId);
    } catch (err) {
      throw new BadRequestException(explainAscError(err));
    }

    // Hedef surum / app bilgisi degistiyse (yeni surum acildi vb.) yazma
    const needsVersion = plan.changes.some((c) => c.field !== 'name' && c.field !== 'subtitle');
    const needsInfo = plan.changes.some((c) => c.field === 'name' || c.field === 'subtitle');
    if ((needsVersion && current.version?.id !== plan.versionId) || (needsInfo && current.appInfo?.id !== plan.appInfoId)) {
      throw new ConflictException('Plandan sonra App Store Connect\'te hedef sürüm değişti — yeniden plan oluştur');
    }
    const conflicts = detectConflicts(plan.changes, current);
    if (conflicts.length) {
      throw new ConflictException({
        message: 'Plandan sonra bu alanlar App Store Connect\'te değişmiş — hiçbir şey yazılmadı, yeniden plan oluştur',
        conflicts,
      });
    }

    const results: Array<{ locale: string; scope: 'appInfo' | 'version'; fields: string[]; ok: boolean; error?: string }> = [];
    const fixIds: string[] = [];
    for (const g of groupPatches(plan.changes, current)) {
      const attributes = g.attributes as Record<string, string>;
      try {
        if (g.scope === 'appInfo') await client.updateAppInfoLocalization(g.locId, attributes);
        else await client.updateVersionLocalization(g.locId, attributes);
        results.push({ locale: g.locale, scope: g.scope, fields: Object.keys(attributes), ok: true });
        const fix = await this.prisma.appliedFix.create({
          data: {
            siteId,
            userId: user.id,
            kind: 'asc_metadata',
            fixType: 'asc_metadata',
            target: `asc:${app.appleAppId}:${g.locale}:${g.scope}`,
            status: 'APPLIED',
            detail: {
              ascAppId,
              appleAppId: app.appleAppId,
              locale: g.locale,
              scope: g.scope,
              versionString: current.version?.versionString ?? null,
              fields: Object.fromEntries(Object.keys(attributes).map((f) => [f, { from: g.from[f as AscField] ?? '', to: attributes[f] }])),
            },
          },
        }).catch((err: any) => { this.log.warn(`ASC metadata kaydi yazilamadi: ${err.message}`); return null; });
        if (fix) fixIds.push(fix.id);
      } catch (err) {
        const error = explainAscError(err);
        results.push({ locale: g.locale, scope: g.scope, fields: Object.keys(attributes), ok: false, error });
        await this.appliedFix.kaydet({
          siteId, userId: user.id, kind: 'asc_metadata', fixType: 'asc_metadata',
          target: `asc:${app.appleAppId}:${g.locale}:${g.scope}`, status: 'FAILED', error,
          detail: { ascAppId, locale: g.locale, scope: g.scope, fields: Object.keys(attributes) },
        });
      }
    }

    // Geri alma plani basariyla uygulandiysa asil kaydi REVERTED isaretle
    if (plan.revertOf && results.length > 0 && results.every((r) => r.ok)) {
      await this.prisma.appliedFix.update({ where: { id: plan.revertOf }, data: { status: 'REVERTED', revertedAt: new Date() } }).catch(() => undefined);
    }
    this.log.log(`[asc-meta ${app.appleAppId}] ${results.filter((r) => r.ok).length}/${results.length} yerellestirme guncellendi`);
    return { results, appliedFixIds: fixIds, ok: results.every((r) => r.ok) };
  }

  /** Bu app icin uygulanmis metadata degisiklikleri (geri alma dugmesi icin) */
  async history(siteId: string, ascAppId: string, user: RequestingUser) {
    const app = await this.loadForSite(siteId, ascAppId, user);
    return this.prisma.appliedFix.findMany({
      where: { siteId, kind: 'asc_metadata', target: { startsWith: `asc:${app.appleAppId}:` } },
      orderBy: { appliedAt: 'desc' },
      take: 20,
      select: { id: true, status: true, target: true, detail: true, error: true, appliedAt: true, revertedAt: true },
    });
  }

  /** Geri alma = eski degerlere YENI bir plan (onay ister) */
  async planRevert(siteId: string, ascAppId: string, user: RequestingUser, appliedFixId: string) {
    const fix = await this.prisma.appliedFix.findUnique({ where: { id: appliedFixId } });
    const detail = (fix?.detail ?? {}) as any;
    if (!fix || fix.siteId !== siteId || fix.kind !== 'asc_metadata' || detail.ascAppId !== ascAppId) throw new NotFoundException('Kayıt bulunamadı');
    if (fix.status !== 'APPLIED') throw new BadRequestException('Bu değişiklik zaten geri alınmış ya da uygulanmamış');
    const fields = Object.fromEntries(Object.entries(detail.fields ?? {}).map(([f, v]: [string, any]) => [f, v?.from ?? '']));
    return this.plan(siteId, ascAppId, user, { locale: detail.locale, fields }, { revertOf: fix.id });
  }
}
