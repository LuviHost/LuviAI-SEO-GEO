import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

type RequestingUser = { id: string; role: 'USER' | 'ADMIN' | 'AGENCY_OWNER' };

/**
 * Sosyal Idea Board — kanban (Unassigned/ToDo/InProgress/Done) içerik fikir yönetimi.
 * Brightbean parity. Bir fikir "convert to post" ile SocialPost'a dönüştürülebilir.
 */
@Injectable()
export class SocialIdeaService {
  private readonly log = new Logger(SocialIdeaService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Tüm sütunları tek bir yapıda döner (kanban UI'ı için) */
  async board(user: RequestingUser, siteId?: string) {
    const ideas = await this.prisma.socialIdea.findMany({
      where: { userId: user.id, ...(siteId ? { siteId } : {}) },
      orderBy: [{ workspaceColumn: 'asc' }, { position: 'asc' }],
    });
    const cols: Record<string, typeof ideas> = {
      UNASSIGNED: [], TODO: [], IN_PROGRESS: [], DONE: [],
    };
    for (const idea of ideas) cols[idea.workspaceColumn].push(idea);
    return cols;
  }

  async create(user: RequestingUser, dto: { title: string; notes?: string; siteId?: string; column?: 'UNASSIGNED' | 'TODO' | 'IN_PROGRESS' | 'DONE'; hashtags?: string[]; refUrls?: string[]; dueAt?: Date }) {
    if (!dto.title.trim()) throw new BadRequestException('title bos olamaz');
    if (dto.siteId) {
      const site = await this.prisma.site.findUnique({ where: { id: dto.siteId } });
      if (!site || site.userId !== user.id) throw new NotFoundException('Site bulunamadı');
    }
    const column = dto.column ?? 'UNASSIGNED';
    // sona ekle (max position + 1)
    const last = await this.prisma.socialIdea.findFirst({
      where: { userId: user.id, workspaceColumn: column as any },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return this.prisma.socialIdea.create({
      data: {
        userId: user.id,
        siteId: dto.siteId,
        workspaceColumn: column as any,
        title: dto.title.trim(),
        notes: dto.notes,
        hashtags: dto.hashtags ?? undefined,
        refUrls: dto.refUrls ?? undefined,
        dueAt: dto.dueAt,
        position: (last?.position ?? -1) + 1,
      },
    });
  }

  async update(ideaId: string, user: RequestingUser, dto: { title?: string; notes?: string; hashtags?: string[]; refUrls?: string[]; dueAt?: Date | null }) {
    await this.assertIdeaOwner(ideaId, user);
    return this.prisma.socialIdea.update({
      where: { id: ideaId },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.hashtags !== undefined ? { hashtags: dto.hashtags } : {}),
        ...(dto.refUrls !== undefined ? { refUrls: dto.refUrls } : {}),
        ...(dto.dueAt !== undefined ? { dueAt: dto.dueAt } : {}),
      },
    });
  }

  /** Drag-drop sonrası kolon + pozisyon güncelleme */
  async move(ideaId: string, user: RequestingUser, dto: { column: 'UNASSIGNED' | 'TODO' | 'IN_PROGRESS' | 'DONE'; position: number }) {
    await this.assertIdeaOwner(ideaId, user);
    return this.prisma.socialIdea.update({
      where: { id: ideaId },
      data: { workspaceColumn: dto.column as any, position: dto.position },
    });
  }

  async delete(ideaId: string, user: RequestingUser) {
    await this.assertIdeaOwner(ideaId, user);
    return this.prisma.socialIdea.delete({ where: { id: ideaId } });
  }

  /** Idea'yı DRAFT bir SocialPost'a çevir (channel seçimi gerekir) */
  async convertToPost(ideaId: string, user: RequestingUser, channelId: string) {
    const idea = await this.assertIdeaOwner(ideaId, user);
    const channel = await this.prisma.socialChannel.findUnique({
      where: { id: channelId },
      include: { site: true },
    });
    if (!channel || channel.site.userId !== user.id) throw new NotFoundException('Kanal bulunamadı');

    const post = await this.prisma.socialPost.create({
      data: {
        channelId,
        text: [idea.title, idea.notes].filter(Boolean).join('\n\n'),
        status: 'DRAFT' as any,
        metadata: {
          fromIdeaId: idea.id,
          hashtags: idea.hashtags ?? [],
        } as any,
      },
    });
    await this.prisma.socialIdea.update({
      where: { id: ideaId },
      data: { convertedPostId: post.id, workspaceColumn: 'DONE' as any },
    });
    return post;
  }

  private async assertIdeaOwner(ideaId: string, user: RequestingUser) {
    const idea = await this.prisma.socialIdea.findUnique({ where: { id: ideaId } });
    if (!idea || idea.userId !== user.id) throw new NotFoundException('Idea bulunamadı');
    return idea;
  }
}
