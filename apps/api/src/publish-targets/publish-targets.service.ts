import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { encrypt, decrypt } from '@luviai/shared';
import { getAdapter } from '@luviai/adapters';
import { PrismaService } from '../prisma/prisma.service.js';

const TARGET_TYPES = [
  'WORDPRESS_REST', 'WORDPRESS_XMLRPC', 'FTP', 'SFTP', 'CPANEL_API',
  'GITHUB', 'WEBFLOW', 'SANITY', 'CONTENTFUL', 'GHOST', 'STRAPI',
  'WHMCS_KB', 'CUSTOM_PHP', 'MARKDOWN_ZIP',
] as const;

type PublishTargetType = typeof TARGET_TYPES[number];

@Injectable()
export class PublishTargetsService {
  private readonly log = new Logger(PublishTargetsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async ensureSiteOwner(siteId: string, requestingUser: { id: string; role: string }) {
    const site = await this.prisma.site.findUnique({ where: { id: siteId }, select: { userId: true } });
    if (!site) throw new NotFoundException('Site bulunamadı');
    if (requestingUser.role !== 'ADMIN' && site.userId !== requestingUser.id) {
      throw new ForbiddenException('Bu site sana ait değil');
    }
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

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.config !== undefined) data.config = dto.config;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.credentials !== undefined && Object.keys(dto.credentials).length > 0) {
      data.credentials = { enc: encrypt(JSON.stringify(dto.credentials)) };
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

  /** Adapter'ın testConnection() metodunu çağırır */
  async testConnection(targetId: string, requestingUser: { id: string; role: string }) {
    const target = await this.prisma.publishTarget.findUnique({ where: { id: targetId } });
    if (!target) throw new NotFoundException('Publish target bulunamadı');
    await this.ensureSiteOwner(target.siteId, requestingUser);

    const Adapter = getAdapter(target.type);
    if (!Adapter) {
      return { ok: false, message: `Bu hedef tipi (${target.type}) için adapter bulunamadı` };
    }

    let creds: Record<string, unknown> = {};
    try {
      const enc = (target.credentials as any)?.enc;
      creds = enc ? JSON.parse(decrypt(enc)) : (target.credentials as any);
    } catch (err: any) {
      return { ok: false, message: `Credentials okunamadı: ${err.message}` };
    }

    try {
      const adapter = new (Adapter as any)(creds, target.config ?? {});
      if (typeof adapter.testConnection === 'function') {
        const result = await adapter.testConnection();
        return result?.ok !== undefined
          ? result
          : { ok: true, message: 'Bağlantı testi başarılı' };
      }
      return {
        ok: true,
        message: 'Bu adapter test fonksiyonu sunmuyor — yayında gerçek istek atılır.',
      };
    } catch (err: any) {
      return { ok: false, message: `Test başarısız: ${err.message}` };
    }
  }

  /** Mevcut target tiplerini + ihtiyaç duydukları credential alanlarını döner (frontend formu için) */
  static getTypeCatalog() {
    return [
      {
        type: 'WORDPRESS_REST',
        label: 'WordPress (REST API)',
        icon: '📝',
        description: 'WordPress sitenize App Password ile yayın yapın',
        fields: [
          { key: 'siteUrl', label: 'Site URL', type: 'text', placeholder: 'https://example.com', required: true },
          { key: 'username', label: 'Kullanıcı adı', type: 'text', required: true },
          { key: 'appPassword', label: 'App Password', type: 'password', required: true, hint: 'WP-Admin → Profil → Application Passwords' },
        ],
        configFields: [
          { key: 'postStatus', label: 'Yayın durumu', type: 'select', options: [{ value: 'publish', label: 'Yayında' }, { value: 'draft', label: 'Taslak' }], default: 'draft' },
          { key: 'categoryId', label: 'Kategori ID (opsiyonel)', type: 'text' },
        ],
      },
      {
        type: 'WORDPRESS_XMLRPC',
        label: 'WordPress (XML-RPC)',
        icon: '📝',
        description: 'Eski WP sürümleri (4.7 öncesi)',
        fields: [
          { key: 'siteUrl', label: 'Site URL', type: 'text', required: true },
          { key: 'username', label: 'Kullanıcı', type: 'text', required: true },
          { key: 'password', label: 'Şifre', type: 'password', required: true },
        ],
        configFields: [],
      },
      {
        type: 'FTP',
        label: 'FTP',
        icon: '🌐',
        description: 'Static HTML + FTP upload',
        fields: [
          { key: 'host', label: 'Host', type: 'text', required: true },
          { key: 'port', label: 'Port', type: 'number', default: 21 },
          { key: 'user', label: 'Kullanıcı', type: 'text', required: true },
          { key: 'password', label: 'Şifre', type: 'password', required: true },
        ],
        configFields: [
          { key: 'remotePath', label: 'Remote path', type: 'text', placeholder: '/public_html/blog', required: true },
        ],
      },
      {
        type: 'SFTP',
        label: 'SFTP / SSH',
        icon: '🔒',
        description: 'Static HTML + SSH key veya password',
        fields: [
          { key: 'host', label: 'Host', type: 'text', required: true },
          { key: 'port', label: 'Port', type: 'number', default: 22 },
          { key: 'user', label: 'Kullanıcı', type: 'text', required: true },
          { key: 'password', label: 'Şifre', type: 'password', hint: 'Veya privateKey kullan' },
          { key: 'privateKey', label: 'Private Key', type: 'textarea', hint: 'OpenSSH formatı (BEGIN OPENSSH PRIVATE KEY...)' },
        ],
        configFields: [
          { key: 'remotePath', label: 'Remote path', type: 'text', placeholder: '/home/user/public_html/blog', required: true },
        ],
      },
      {
        type: 'GITHUB',
        label: 'GitHub',
        icon: '🐙',
        description: 'Hugo, Jekyll, Astro, MDX siteler',
        fields: [
          { key: 'token', label: 'Personal Access Token', type: 'password', required: true, hint: 'repo scope yetkili PAT' },
          { key: 'owner', label: 'Owner / org', type: 'text', placeholder: 'kullaniciAdi', required: true },
          { key: 'repo', label: 'Repository', type: 'text', required: true },
          { key: 'branch', label: 'Branch', type: 'text', default: 'main' },
        ],
        configFields: [
          { key: 'contentPath', label: 'İçerik klasörü', type: 'text', placeholder: 'content/posts', required: true },
          { key: 'commitMessage', label: 'Commit mesaj şablonu', type: 'text', default: 'feat(blog): {title}' },
        ],
      },
      {
        type: 'CPANEL_API',
        label: 'cPanel API',
        icon: '🎛️',
        description: 'cPanel File Manager (token auth)',
        fields: [
          { key: 'host', label: 'cPanel host', type: 'text', placeholder: 'https://cpanel.example.com:2083', required: true },
          { key: 'username', label: 'Kullanıcı', type: 'text', required: true },
          { key: 'apiToken', label: 'API Token', type: 'password', required: true },
        ],
        configFields: [
          { key: 'remotePath', label: 'Hedef klasör', type: 'text', placeholder: '/public_html/blog', required: true },
        ],
      },
      {
        type: 'WEBFLOW',
        label: 'Webflow CMS',
        icon: '🎨',
        description: 'Webflow CMS Collection',
        fields: [
          { key: 'apiToken', label: 'API Token', type: 'password', required: true },
          { key: 'siteId', label: 'Site ID', type: 'text', required: true },
          { key: 'collectionId', label: 'Collection ID', type: 'text', required: true },
        ],
        configFields: [],
      },
      {
        type: 'SANITY',
        label: 'Sanity',
        icon: '✨',
        description: 'Headless CMS (Portable Text)',
        fields: [
          { key: 'projectId', label: 'Project ID', type: 'text', required: true },
          { key: 'dataset', label: 'Dataset', type: 'text', default: 'production' },
          { key: 'token', label: 'Editor Token', type: 'password', required: true },
        ],
        configFields: [],
      },
      {
        type: 'CONTENTFUL',
        label: 'Contentful',
        icon: '📚',
        description: 'Management API + auto publish',
        fields: [
          { key: 'spaceId', label: 'Space ID', type: 'text', required: true },
          { key: 'environmentId', label: 'Environment', type: 'text', default: 'master' },
          { key: 'managementToken', label: 'Management Token', type: 'password', required: true },
        ],
        configFields: [
          { key: 'contentTypeId', label: 'Content Type ID', type: 'text', placeholder: 'blogPost', required: true },
        ],
      },
      {
        type: 'GHOST',
        label: 'Ghost',
        icon: '👻',
        description: 'Ghost Admin API (JWT)',
        fields: [
          { key: 'apiUrl', label: 'API URL', type: 'text', placeholder: 'https://demo.ghost.io', required: true },
          { key: 'adminApiKey', label: 'Admin API Key', type: 'password', required: true },
        ],
        configFields: [],
      },
      {
        type: 'STRAPI',
        label: 'Strapi',
        icon: '🚀',
        description: 'Strapi 4+ REST API',
        fields: [
          { key: 'baseUrl', label: 'Strapi URL', type: 'text', placeholder: 'https://cms.example.com', required: true },
          { key: 'token', label: 'API Token', type: 'password', required: true },
        ],
        configFields: [
          { key: 'collection', label: 'Collection adı', type: 'text', placeholder: 'articles', required: true },
        ],
      },
      {
        type: 'WHMCS_KB',
        label: 'WHMCS Bilgi Bankası',
        icon: '🛠️',
        description: 'WHMCS Knowledgebase makalesi',
        fields: [
          { key: 'baseUrl', label: 'WHMCS URL', type: 'text', required: true },
          { key: 'apiIdentifier', label: 'API Identifier', type: 'text', required: true },
          { key: 'apiSecret', label: 'API Secret', type: 'password', required: true },
        ],
        configFields: [
          { key: 'categoryId', label: 'KB Kategori ID', type: 'text', required: true },
        ],
      },
      {
        type: 'CUSTOM_PHP',
        label: 'Custom PHP',
        icon: '🔧',
        description: 'Kendi PHP API\'ınız + HMAC',
        fields: [
          { key: 'endpointUrl', label: 'Endpoint URL', type: 'text', required: true },
          { key: 'hmacSecret', label: 'HMAC Secret', type: 'password', required: true },
        ],
        configFields: [],
      },
      {
        type: 'MARKDOWN_ZIP',
        label: 'Markdown ZIP',
        icon: '📦',
        description: 'Manuel indir, kendin yükle (test için ideal)',
        fields: [],
        configFields: [],
      },
    ];
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
