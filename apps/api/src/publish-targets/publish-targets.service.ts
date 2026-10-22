import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { encrypt } from '@luviai/shared';
import { getAdapter, sanitizeErrorText, wordPressCategoryIds, type PublishAdapter } from '@luviai/adapters';
import { PrismaService } from '../prisma/prisma.service.js';
import { QuotaService } from '../billing/quota.service.js';
import { assertPublishTargetSafe, publishTargetBlockReason, type PublicResolver } from './publish-target-url.js';
import { catalogFieldLabel, publishTargetCatalog } from './publish-target-catalog.js';
import {
  isCredentialChange,
  mergeCredentials,
  missingRequiredCredentialLabels,
  readStoredCredentials,
} from './publish-target-credentials.js';
import {
  TEST_TIMED_OUT,
  testFailureMessage,
  testNotAvailableMessage,
  testSuccessMessage,
  withTestTimeout,
  type TestOutcome,
} from './publish-target-test-messages.js';

const TARGET_TYPES = [
  'WORDPRESS_REST', 'WORDPRESS_XMLRPC', 'FTP', 'SFTP', 'CPANEL_API',
  'GITHUB', 'WEBFLOW', 'SANITY', 'CONTENTFUL', 'GHOST', 'STRAPI',
  'WHMCS_KB', 'CUSTOM_PHP', 'MARKDOWN_ZIP', 'KOBIPRATIK',
] as const;

type PublishTargetType = typeof TARGET_TYPES[number];

/** Sadece ADMIN role'lu kullanicilarin gorebilecegi/kullanabilecegi hedef tipleri. */
const ADMIN_ONLY_TARGET_TYPES = new Set<PublishTargetType>(['KOBIPRATIK']);

/**
 * Adaptorun yayin aninda kullanamayacagi ayar kayitta, formdaki alan adiyla
 * reddedilir. WordPress "Kategori ID" adaptore hic ulasmiyordu; artik
 * gonderiliyor (WP REST `categories` tamsayi dizisi) — kategori ADI yazilirsa
 * yazi sessizce varsayilan kategoriye duserdi. Kural adaptorle ortak
 * (wordPressCategoryIds).
 */
function assertTargetConfigValid(type: string, config: Record<string, unknown> | undefined): void {
  if (type !== 'WORDPRESS_REST' || !config) return;
  if (!wordPressCategoryIds(config.categoryId).ok) {
    const label = catalogFieldLabel(type, 'categoryId', 'configFields') ?? 'Kategori ID';
    throw new BadRequestException(`${label}: kategori adı değil, sayısal kategori ID'si girin (ör. 12; birden fazlası için 12,15).`);
  }
}

@Injectable()
export class PublishTargetsService {
  private readonly log = new Logger(PublishTargetsService.name);

  /** Yalnizca test: gercek DNS yerine sahte cozumleyici. Uretimde bos → assertResolvesPublic. */
  urlResolver?: PublicResolver;

  /**
   * "Bağlantıyı test et" en fazla bu kadar bekler (publish-target-test-messages.ts
   * withTestTimeout). 30 sn: FTP istemcisinin (basic-ftp) varsayilan zaman
   * asimi 30 sn, ters vekilin istek zaman asiminin altinda kalir. Testler kisaltir.
   */
  testTimeoutMs = 30_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly quota: QuotaService,
  ) {}

  private async ensureSiteOwner(siteId: string, requestingUser: { id: string; role: string }) {
    const site = await this.prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } });
    if (!site) throw new NotFoundException('Site bulunamadı');
    if (requestingUser.role !== 'ADMIN' && site.userId !== requestingUser.id) {
      throw new ForbiddenException('Bu site sana ait değil');
    }
  }

  /** Sitenin sahibinin planina gore uretim kaynagi durumu (QuotaService.generationReadiness) */
  async generationReadiness(siteId: string, requestingUser: { id: string; role: string }) {
    await this.ensureSiteOwner(siteId, requestingUser);
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId }, select: { userId: true } });
    return this.quota.generationReadiness(site.userId, siteId);
  }

  async list(siteId: string, requestingUser: { id: string; role: string }) {
    await this.ensureSiteOwner(siteId, requestingUser);
    const targets = await this.prisma.publishTarget.findMany({
      where: { siteId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    // Credentials gizle (asla raw geri dönme)
    return targets.map((t) => ({
      id: t.id,
      siteId: t.siteId,
      type: t.type,
      name: t.name,
      isDefault: t.isDefault,
      isActive: t.isActive,
      config: t.config,
      lastUsedAt: t.lastUsedAt,
      createdAt: t.createdAt,
      hasCredentials: true,
    }));
  }

  async create(siteId: string, dto: {
    type: PublishTargetType;
    name: string;
    credentials: Record<string, unknown>;
    config?: Record<string, unknown>;
    isDefault?: boolean;
    isActive?: boolean;
  }, requestingUser: { id: string; role: string }) {
    await this.ensureSiteOwner(siteId, requestingUser);

    if (!TARGET_TYPES.includes(dto.type)) {
      throw new BadRequestException(`Geçersiz publish hedef tipi: ${dto.type}`);
    }
    if (!dto.name?.trim()) {
      throw new BadRequestException('İsim zorunlu');
    }
    // Admin-only hedefler: USER role ekleyemez (catalog'da gizli olsa da direkt POST atılabilir)
    if (ADMIN_ONLY_TARGET_TYPES.has(dto.type) && requestingUser.role !== 'ADMIN') {
      throw new ForbiddenException(`Bu hedef tipi sadece admin tarafindan eklenebilir: ${dto.type}`);
    }

    // Plan kapisi. canUsePublishTarget yazildigindan beri hicbir yerden
    // cagrilmiyordu — TRIAL kullanicisi da 14 hedef tipinin hepsini
    // kullanabiliyordu, oysa plan tanimi TRIAL'i Markdown ZIP + WordPress
    // ile sinirliyor. Site sahibinin plani esas alinir (ADMIN muaf).
    if (requestingUser.role !== 'ADMIN') {
      const site = await this.prisma.site.findUnique({
        where: { id: siteId },
        select: { userId: true },
      });
      if (site && !(await this.quota.canUsePublishTarget(site.userId, dto.type))) {
        throw new ForbiddenException(
          `${dto.type} yayın hedefi planına dahil değil. Ücretli bir plana geçerek kullanabilirsin.`,
        );
      }
    }

    // SSRF: adaptorler bu adreslere sunucumuzdan istek atar. Ic ag / bulut
    // metadata adresi kayit aninda reddedilir (publish-target-url.ts).
    await assertPublishTargetSafe(dto.type, dto.credentials, dto.config, this.urlResolver);
    assertTargetConfigValid(dto.type, dto.config);

    // Diğer default'ları kapat
    if (dto.isDefault) {
      await this.prisma.publishTarget.updateMany({
        where: { siteId, isDefault: true },
        data: { isDefault: false },
      });
    }

    // Credentials şifrele (encrypt JSON.stringify)
    const encryptedCreds = encrypt(JSON.stringify(dto.credentials ?? {}));

    const created = await this.prisma.publishTarget.create({
      data: {
        siteId,
        type: dto.type as any,
        name: dto.name.trim(),
        credentials: { enc: encryptedCreds } as any,
        config: (dto.config ?? {}) as any,
        isDefault: dto.isDefault ?? false,
        isActive: dto.isActive ?? true,
      },
    });

    this.log.log(`PublishTarget oluşturuldu: ${created.id} (${dto.type}) site=${siteId}`);
    return this.sanitize(created);
  }

  async update(targetId: string, dto: {
    name?: string;
    credentials?: Record<string, unknown>;
    config?: Record<string, unknown>;
    isDefault?: boolean;
    isActive?: boolean;
  }, requestingUser: { id: string; role: string }) {
    const existing = await this.prisma.publishTarget.findUnique({ where: { id: targetId } });
    if (!existing) throw new NotFoundException('Publish target bulunamadı');
    await this.ensureSiteOwner(existing.siteId, requestingUser);

    // Kimlik KISMI guncellenir (sozlesme: publish-target-credentials.ts — bos
    // dize korur, null siler). Eskiden gelen nesne kaydin tamaminin yerine
    // yaziliyordu: panelden yalniz App Password degisince Site URL ve kullanici
    // adi siliniyordu.
    let nextCredentials: Record<string, unknown> | null = null;
    const patch = dto.credentials;
    if (patch && typeof patch === 'object' && Object.values(patch).some(isCredentialChange)) {
      const stored = readStoredCredentials(existing.credentials);
      if (!stored.ok) {
        // Kayit cozulemiyor: birlestirilecek bir sey yok. Kismi gonderim
        // saklanirsa hedef sessizce yarim kalirdi — eksik zorunlu alanlar istenir.
        const missing = missingRequiredCredentialLabels(existing.type, patch);
        if (missing.length > 0) {
          throw new BadRequestException(
            `Kayıtlı bağlantı bilgileri okunamadığı için yalnız değiştirdiğin alanlar kaydedilemez. Tüm bağlantı bilgilerini yeniden gir; eksik: ${missing.join(', ')}.`,
          );
        }
      }
      const { merged, changed } = mergeCredentials(existing.type, stored.ok ? stored.creds : {}, patch);
      if (changed) nextCredentials = merged;
    }

    // Adres denetimi YAZILACAK hale yapilir: kimlik degisiyorsa BIRLESMIS
    // kimligin tamami (degismeyen ve denetim oncesinden kalma alanlar dahil),
    // config degisiyorsa yeni config. Yalniz ad/varsayilan/aktiflik degisince
    // kayitli adres yeniden cozulmez (gecici DNS hatasi duzenlemeyi kilitlemesin;
    // her baglantidan once publishTargetBlockReason zaten denetler).
    if (nextCredentials || dto.config !== undefined) {
      await assertPublishTargetSafe(existing.type, nextCredentials ?? {}, dto.config ?? {}, this.urlResolver);
    }
    assertTargetConfigValid(existing.type, dto.config);

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.config !== undefined) data.config = dto.config;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (nextCredentials) {
      data.credentials = { enc: encrypt(JSON.stringify(nextCredentials)) };
    }

    if (dto.isDefault === true) {
      await this.prisma.publishTarget.updateMany({
        where: { siteId: existing.siteId, isDefault: true, NOT: { id: targetId } },
        data: { isDefault: false },
      });
      data.isDefault = true;
    } else if (dto.isDefault === false) {
      data.isDefault = false;
    }

    const updated = await this.prisma.publishTarget.update({
      where: { id: targetId },
      data: data as any,
    });
    return this.sanitize(updated);
  }

  async remove(targetId: string, requestingUser: { id: string; role: string }) {
    const existing = await this.prisma.publishTarget.findUnique({ where: { id: targetId } });
    if (!existing) throw new NotFoundException('Publish target bulunamadı');
    await this.ensureSiteOwner(existing.siteId, requestingUser);
    await this.prisma.publishTarget.delete({ where: { id: targetId } });
    return { ok: true };
  }

  /**
   * "Bağlantıyı test et": kayitli hedefe adaptorun test() istegini atar.
   *
   * Eskiden adaptorde olmayan testConnection() aranirdi; hicbir adaptor onu
   * tanimlamadigi icin dugme istek atmadan "test fonksiyonu sunmuyor" derdi.
   * Ortak arayuz test(): Promise<boolean> (packages/adapters/src/base.ts).
   * Mesajlar publish-target-test-messages.ts'te: basari, testin GERCEKTEN kanitladigini
   * soyler (or. GitHub testi depoyu okur, yazma iznini denemez).
   *
   * Yanit: { ok, message, tested } — tested yeni ve ek alan (false: istek atilmadi).
   */
  async testConnection(targetId: string, requestingUser: { id: string; role: string }): Promise<TestOutcome> {
    const target = await this.prisma.publishTarget.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('Publish target bulunamadı');
    await this.ensureSiteOwner(target.siteId, requestingUser);

    const meta = PublishTargetsService.getFullCatalog().find((c) => c.type === target.type);
    const label = meta?.label ?? String(target.type);

    const Adapter = getAdapter(target.type);
    if (!Adapter) {
      return { ok: false, tested: false, message: `${label} için yayın bağdaştırıcısı bulunamadı.` };
    }

    // Guncellemeyle ayni okuma (publish-target-credentials.ts): eski alan alan
    // sifreli kayitlar da yayincinin gordugu gibi cozulur
    const stored = readStoredCredentials(target.credentials);
    if (!stored.ok) {
      // Cozme hatasinin ayrintisi (anahtar, bicim) kullaniciya yararsiz — ne yapacagi soylenir
      return { ok: false, tested: false, message: 'Kayıtlı kimlik bilgileri okunamadı. Hedefi düzenleyip bilgileri yeniden girin.' };
    }
    const creds = stored.creds;

    // Kayittan sonra DNS degismis olabilir — adaptor istek atmadan HEMEN once
    // (yayin, onarim ve snippet akislariyla ayni ortak kapi)
    const blocked = await publishTargetBlockReason(target.type, creds, target.config, this.urlResolver);
    if (blocked) return { ok: false, tested: false, message: blocked };

    const notAvailable = testNotAvailableMessage(String(target.type));
    if (notAvailable) return { ok: true, tested: false, message: notAvailable };

    let passed: boolean | typeof TEST_TIMED_OUT;
    try {
      const adapter = new (Adapter as any)(creds, target.config ?? {}) as PublishAdapter;
      passed = await withTestTimeout(adapter.test(), this.testTimeoutMs);
    } catch (err: any) {
      // Adaptor hata firlatabilir (WP REST/XML-RPC test() ag hatasini yakalamaz,
      // yonlendirmede ne yapilacagini soyleyen hata atar; korumali baglanti ic
      // adreste AdapterEgressError atar). Metin kisaltilir ve icindeki IP'ler
      // maskelenir — yanit panelde aynen gosterilir.
      // 300: yonlendirme rehberi (adres + ne yapilacagi) 200'de yarida kesiliyordu
      const detail = sanitizeErrorText(err?.message ?? err, 300) || 'bilinmeyen hata';
      return { ok: false, tested: true, message: `${label} bağlantısı kurulamadı: ${detail}` };
    }

    if (passed === TEST_TIMED_OUT) {
      return {
        ok: false,
        tested: true,
        message: `${label} ${Math.max(1, Math.round(this.testTimeoutMs / 1000))} saniye içinde yanıt vermedi. Adresin doğru ve sunucunun erişilebilir olduğunu kontrol edin.`,
      };
    }
    if (passed) return { ok: true, tested: true, message: testSuccessMessage(String(target.type), label) };

    const required = (meta?.fields ?? [])
      .filter((f: { required?: boolean }) => f.required)
      .map((f: { label: string }) => f.label);
    return { ok: false, tested: true, message: testFailureMessage(String(target.type), label, required) };
  }

  /** Mevcut target tiplerini + ihtiyaç duydukları credential alanlarını döner (frontend formu için).
   *  isAdmin=false ise adminOnly hedefleri (KOBIPRATIK gibi) çıkar.
   */
  static getTypeCatalog(opts?: { isAdmin?: boolean }) {
    const isAdmin = opts?.isAdmin === true;
    const all = PublishTargetsService.getFullCatalog();
    return isAdmin ? all : all.filter((c) => !c.adminOnly);
  }

  /** Katalog publish-target-catalog.ts'te (adres hata metni de etiketleri oradan okur) */
  private static getFullCatalog() {
    return publishTargetCatalog();
  }

  private sanitize(t: any) {
    return {
      id: t.id,
      siteId: t.siteId,
      type: t.type,
      name: t.name,
      isDefault: t.isDefault,
      isActive: t.isActive,
      config: t.config,
      lastUsedAt: t.lastUsedAt,
      createdAt: t.createdAt,
      hasCredentials: true,
    };
  }
}
