import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';

export const ALL_SCOPES = [
  'articles:read', 'articles:write',
  'sites:read', 'sites:write',
  'audit:read', 'audit:write',
  'ads:read', 'ads:write',
  'analytics:read',
  'social:read', 'social:write',
] as const;

export type Scope = typeof ALL_SCOPES[number];

@Injectable()
export class ApiKeysService {
  private readonly log = new Logger(ApiKeysService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Yeni API key olustur (token sadece yaratimda gosterilir, sonra hash saklanir).
   */
  async create(userId: string, opts: { name: string; scopes?: string[]; expiresInDays?: number; rateLimit?: number }) {
    const tokenRaw = `luvi_${randomBytes(28).toString('base64url')}`;
    const keyHash = this.hash(tokenRaw);
    const prefix = tokenRaw.slice(0, 12);

    const apiKey = await this.prisma.apiKey.create({
      data: {
        userId,
        name: opts.name,
        keyHash,
        prefix,
        scopes: (opts.scopes ?? ['articles:read', 'sites:read', 'audit:read', 'analytics:read']) as any,
        rateLimit: opts.rateLimit ?? 60,
        expiresAt: opts.expiresInDays ? new Date(Date.now() + opts.expiresInDays * 86400000) : null,
      },
    });

    this.log.log(`[${userId}] API key created: ${apiKey.id}, prefix=${prefix}`);

    // Token sadece BIR DEFA donulur — kullanici bu noktada kopyalayip saklamali
    return {
      id: apiKey.id,
      name: apiKey.name,
      token: tokenRaw,
      prefix,
      scopes: apiKey.scopes,
      rateLimit: apiKey.rateLimit,
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
    };
  }

  async list(userId: string) {
    const keys = await this.prisma.apiKey.findMany({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, prefix: true, scopes: true, rateLimit: true, lastUsedAt: true, expiresAt: true, createdAt: true } as any,
    });
    return keys;
  }

  async revoke(userId: string, keyId: string) {
    return this.prisma.apiKey.update({
      where: { id: keyId, userId } as any,
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Auth guard tarafindan cagrilir — token geldiyse user resolve et.
   * @returns { userId, scopes } veya null
   */
  async validate(token: string): Promise<{ userId: string; scopes: string[]; keyId: string } | null> {
    if (!token.startsWith('luvi_')) return null;
    const keyHash = this.hash(token);

    const key: any = await this.prisma.apiKey.findUnique({ where: { keyHash } });
    if (!key) return null;
    if (key.revokedAt) return null;
    if (key.expiresAt && new Date() > key.expiresAt) return null;

    // lastUsedAt async update — performans
    this.prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

    return {
      userId: key.userId,
      scopes: Array.isArray(key.scopes) ? (key.scopes as string[]) : [],
      keyId: key.id,
    };
  }

  hasScope(userScopes: string[], required: string): boolean {
    return userScopes.includes(required) || userScopes.includes('*');
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
