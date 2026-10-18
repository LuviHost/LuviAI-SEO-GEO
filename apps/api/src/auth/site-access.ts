import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service.js';
import { isCanonicalSiteId } from '../common/site-id.js';
import { SITE_NOT_FOUND_MESSAGE } from './site-access.guard.js';

export interface SiteAccessUser {
  id: string;
  role?: string | null;
}

/**
 * siteId'yi URL yolu yerine query/body'den alan uclar icin sahiplik kontrolu.
 *
 * NEDEN: global SiteAccessGuard yalnizca `:siteId` yol parametresine bakar.
 * `auth/gsc/start?siteId=`, `auth/gsc/disconnect {siteId}` gibi uclar onun
 * gozunden kaciyordu — herhangi bir oturum, sahibi olmadigi bir sitenin GSC
 * baglantisini kesebiliyor ya da onun icin izin akisi baslatabiliyordu.
 *
 * Kural SiteAccessGuard ile AYNI: ADMIN her siteye, digerleri yalnizca kendi
 * sitesine. Site yoksa 404, sahibi degilse 403.
 *
 * KANONIK KIMLIK (common/site-id.ts): sites tablosunun harmanlamasi
 * (utf8mb4_unicode_ci) harf/bosluk farkini yok sayar; 'CMSQ..' ya da sonu
 * bosluklu yazim ayni satiri bulur. Varyant buradan gecince cagiran onu
 * oldugu gibi kullaniyordu (disconnect govdedeki siteId ile cagriliyor, OAuth
 * state'i ve yonlendirme yolu bu degeri tasiyabiliyordu); JS tarafindaki
 * `===` karsilastirmalari ve kimlige gore anahtarlar sonra tutmuyordu.
 * SiteAccessGuard ile ayni iki kapi: kurala uymayan kimlik DB'ye gitmeden
 * 404, bulunan satirin kimligi istenenle birebir ayni degilse yine 404.
 */
export async function assertSiteAccess(
  prisma: Pick<PrismaService, 'site'>,
  user: SiteAccessUser | null | undefined,
  siteId: unknown,
): Promise<{ id: string; userId: string }> {
  if (!user?.id) throw new ForbiddenException('Oturum gerekli');
  if (typeof siteId !== 'string' || !siteId.trim()) throw new BadRequestException('siteId gerekli');
  if (!isCanonicalSiteId(siteId)) throw new NotFoundException(SITE_NOT_FOUND_MESSAGE);
  const site = await prisma.site.findUnique({
    where: { id: siteId },
    select: { id: true, userId: true },
  });
  if (!site || site.id !== siteId) throw new NotFoundException(SITE_NOT_FOUND_MESSAGE);
  if (user.role !== 'ADMIN' && site.userId !== user.id) {
    throw new ForbiddenException('Bu site sana ait değil');
  }
  return site;
}
