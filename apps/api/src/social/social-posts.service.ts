import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { SocialChannelsService } from './social-channels.service.js';
import { getAdapter } from './adapters/registry.js';

type RequestingUser = { id: string; role: 'USER' | 'ADMIN' | 'AGENCY_OWNER' };

@Injectable()
export class SocialPostsService {
  private readonly log = new Logger(SocialPostsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly channels: SocialChannelsService,
  ) {}

  private async assertChannelOwner(channelId: string, user: RequestingUser) {
    const channel = await this.prisma.socialChannel.findUnique({
      where: { id: channelId },
      include: { site: { select: { userId: true } } },
    });
    if (!channel) throw new NotFoundException('Kanal bulunamadi');
    if (user.role !== 'ADMIN' && channel.site.userId !== user.id) {
      throw new ForbiddenException('Bu kanal sana ait degil');
    }
    return channel;
  }

  private async assertPostOwner(postId: string, user: RequestingUser) {
    const post = await this.prisma.socialPost.findUnique({
      where: { id: postId },
      include: { channel: { include: { site: { select: { userId: true } } } } },
    });
    if (!post) throw new NotFoundException('Post bulunamadi');
    if (user.role !== 'ADMIN' && post.channel.site.userId !== user.id) {
      throw new ForbiddenException('Bu post sana ait degil');
    }
    return post;
  }

  async list(siteId: string, opts: { channelId?: string; status?: string }, user: RequestingUser) {
    // Site ownership channel uzerinden dogrulanir
    const where: any = { channel: { siteId } };
    if (opts.channelId) where.channelId = opts.channelId;
    if (opts.status) where.status = opts.status;
    const posts = await this.prisma.socialPost.findMany({
      where,
      orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'desc' }],
      include: { channel: { select: { type: true, name: true, externalName: true, externalAvatar: true, site: { select: { userId: true } } } } },
      take: 200,
    });
    // Filtre
    return posts.filter((p) => user.role === 'ADMIN' || p.channel.site.userId === user.id)
      .map((p) => ({
        ...p,
        channel: { type: p.channel.type, name: p.channel.name, externalName: p.channel.externalName, externalAvatar: p.channel.externalAvatar },
      }));
  }

  async create(dto: {
    channelId: string;
    text: string;
    mediaUrls?: any[];
    metadata?: any;
    scheduledFor?: string | null;
    articleId?: string;
    status?: 'DRAFT' | 'QUEUED';
  }, user: RequestingUser) {
    await this.assertChannelOwner(dto.channelId, user);
    if (!dto.text?.trim()) throw new BadRequestException('Metin bos olamaz');
    return this.prisma.socialPost.create({
      data: {
        channelId: dto.channelId,
        articleId: dto.articleId ?? null,
        text: dto.text,
        mediaUrls: dto.mediaUrls as any,
        metadata: dto.metadata as any,
        scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : null,
        status: dto.status ?? 'DRAFT',
      },
    });
  }

  async update(postId: string, dto: { text?: string; mediaUrls?: any[]; metadata?: any; scheduledFor?: string | null; status?: string }, user: RequestingUser) {
    await this.assertPostOwner(postId, user);
    const data: any = {};
    if (dto.text !== undefined) data.text = dto.text;
    if (dto.mediaUrls !== undefined) data.mediaUrls = dto.mediaUrls;
    if (dto.metadata !== undefined) data.metadata = dto.metadata;
    if (dto.scheduledFor !== undefined) data.scheduledFor = dto.scheduledFor ? new Date(dto.scheduledFor) : null;
    if (dto.status !== undefined) data.status = dto.status;
    return this.prisma.socialPost.update({ where: { id: postId }, data });
  }

  async remove(postId: string, user: RequestingUser) {
    await this.assertPostOwner(postId, user);
    await this.prisma.socialPost.delete({ where: { id: postId } });
    return { ok: true };
  }

  /**
   * Post.mediaUrls'da geçen video URL'leri için Video tablosundaki atıf
   * metnini (Pexels: "Photos: <isim> via Pexels (https://www.pexels.com)")
   * yayın metnine append eder. Çoğul video varsa her birinin atfı tek satırda
   * birleştirilir; idempotent — atıf zaten metinde varsa tekrar eklemez.
   */
  private async appendVideoCredits(text: string, mediaUrls: any[]): Promise<string> {
    if (!Array.isArray(mediaUrls) || mediaUrls.length === 0) return text;
    const videoUrls = mediaUrls
      .filter((m) => m && m.type === 'video' && typeof m.url === 'string' && m.url.length > 0)
      .map((m) => m.url as string);
    if (videoUrls.length === 0) return text;

    const videos = await this.prisma.video.findMany({
      where: { videoUrl: { in: videoUrls } },
      select: { description: true },
    });

    const lines: string[] = [];
    for (const v of videos) {
      const d = v.description?.trim();
      if (d && !lines.includes(d) && !text.includes(d)) lines.push(d);
    }
    if (lines.length === 0) return text;

    return `${text}\n\n${lines.join('\n')}`;
  }

  /**
   * Manuel "Simdi yayinla" — adapter'i cagir, sonucu DB'ye yaz.
   * Cron tabanli yayin icin de bu method kullanilir (cron status=PUBLISHING set
   * ettikten sonra cagirir).
   */
  async publishNow(postId: string, user: RequestingUser) {
    const post = await this.assertPostOwner(postId, user);
    if (post.status === 'PUBLISHED') {
      throw new BadRequestException('Post zaten yayinlandi');
    }
    return this.runPublish(postId);
  }

  /** internal — cron + publishNow ortak yol */
  async runPublish(postId: string) {
    const post = await this.prisma.socialPost.findUniqueOrThrow({ where: { id: postId } });
    const { channel, ctx } = await this.channels.getDecryptedContext(post.channelId);

    await this.prisma.socialPost.update({
      where: { id: postId },
      data: { status: 'PUBLISHING' as any },
    });

    try {
      // Pexels Terms of Service madde 4: stok görsel kullanan video'larda
      // fotoğrafçı atfı yayın metninde geçmek zorunda. Video.description'a
      // worker tarafından yazılan atıf metnini post.text sonuna append ediyoruz.
      const publishText = await this.appendVideoCredits(post.text, (post.mediaUrls as any) ?? []);

      const adapter = getAdapter(channel.type);
      const result = await adapter.publish(
        {
          text: publishText,
          mediaUrls: (post.mediaUrls as any) ?? undefined,
          metadata: (post.metadata as any) ?? undefined,
        },
        ctx,
      );
      const updated = await this.prisma.socialPost.update({
        where: { id: postId },
        data: {
          status: 'PUBLISHED' as any,
          publishedAt: new Date(),
          externalId: result.externalId,
          externalUrl: result.externalUrl,
          errorMsg: null,
        },
      });
      await this.prisma.socialChannel.update({
        where: { id: channel.id },
        data: { lastUsedAt: new Date(), lastError: null },
      });
      this.log.log(`[social] PUBLISHED ${channel.type} ${result.externalId}`);
      return updated;
    } catch (err: any) {
      const raw = err?.message ?? String(err);
      const friendly = humanizeSocialError(raw, channel.type);
      await this.prisma.socialPost.update({
        where: { id: postId },
        data: {
          status: 'FAILED' as any,
          errorMsg: friendly,
          retryCount: { increment: 1 },
        },
      });
      await this.prisma.socialChannel.update({
        where: { id: channel.id },
        data: { lastError: friendly.slice(0, 500) },
      });
      this.log.error(`[social] FAIL ${channel.type}: ${raw}`);
      throw new BadRequestException(friendly);
    }
  }
}

/**
 * X / LinkedIn API hatalarini kullanici dostu Turkce mesaja cevir.
 * Ham hatayi ekleyip teknik detay log'da kalsin.
 */
function humanizeSocialError(raw: string, channelType: string): string {
  const lower = raw.toLowerCase();

  // X (Twitter) — yaygin durumlar
  if (channelType === 'X_TWITTER') {
    if (lower.includes('creditsdepleted') || lower.includes('does not have any credits')) {
      return 'X hesabınızda kredi kalmadı. X Developer Portal → Billing → Credits bölümünden kredi yükleyin (Pay Per Use planı). Tweet başına ücret çok düşük; küçük yükleme uzun süre yetiyor.';
    }
    if (lower.includes('rate limit') || lower.includes('429')) {
      return 'X rate limit aşıldı. 15 dakika içinde tekrar denenecek (cron otomatik tekrar atar).';
    }
    if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('invalid token')) {
      return 'X erişim token geçersiz / yenilenmesi gerekiyor. Sosyal Kanallar → X kanalını sil ve yeniden bağla.';
    }
    if (lower.includes('403') || lower.includes('forbidden')) {
      return 'X yazma izni yok. Bağladığın hesabın X uygulamasında "Read and write" izni olduğundan ve OAuth scope\'larında tweet.write bulunduğundan emin ol.';
    }
    if (lower.includes('duplicate')) {
      return 'X aynı içeriği tekrar tweet atmaya izin vermez. Metni biraz değiştir veya yarın tekrar dene.';
    }
  }

  // LinkedIn
  if (channelType.startsWith('LINKEDIN')) {
    if (lower.includes('401') || lower.includes('invalid_token') || lower.includes('expired')) {
      return 'LinkedIn token süresi doldu. Sosyal Kanallar → LinkedIn kanalını yeniden bağla.';
    }
    if (lower.includes('403')) {
      return 'LinkedIn yazma izni yok. Şirket sayfası için Page Admin yetkisi gerekiyor.';
    }
  }

  // Generic
  return `Sosyal yayın başarısız: ${raw.slice(0, 280)}`;
}
