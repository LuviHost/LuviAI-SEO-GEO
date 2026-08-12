import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { LLMProviderService } from '../llm/llm-provider.service.js';
import { buildSocialTextFor, type ArticleSnippet } from './social-text.js';
import { mediaDefaultFor, isMediaTypeAllowed, type MediaType } from './social-media-policy.js';

// Video gerektiren kanallar — composer'da AI üretmiyor, medya yoksa QUEUE'ya düşürme
const VIDEO_REQUIRED_CHANNELS = new Set(['TIKTOK', 'YOUTUBE']);
import { SocialMediaGeneratorService } from './social-media-generator.service.js';
import { randomBytes } from 'node:crypto';

interface ComposeInput {
  siteId: string;
  prompt: string;
  channelIds: string[];
  /** Her kanal için override mediaType. Verilmezse kanalın default'u kullanılır. */
  mediaTypeByChannel?: Record<string, MediaType>;
  /** true ise composer'da AI ile medya da üretilir (image). false ise sadece metin draft kalır. */
  autoMedia?: boolean;
  /** Bütün kanallar için ortak manuel medya URL'i (kullanıcı upload etti). */
  sharedMediaUrls?: Array<{ url: string; type: 'image' | 'video'; altText?: string }>;
  /** ISO date — verilirse scheduledFor olarak set edilir; site.autopilot true ise QUEUED. */
  scheduledFor?: string;
}

interface CreatedDraft {
  id: string;
  channelId: string;
  channelType: string;
  mediaType: MediaType;
  status: string;
}

interface ComposeResult {
  campaignId: string;
  drafts: CreatedDraft[];
  skipped: Array<{ channelType: string; reason: string }>;
  publishedImmediately: boolean;
  costUsd: number;
}

/**
 * AI ile sıfırdan sosyal kampanya yaratıcı.
 *
 * Akış:
 *   1. Site + brain (brandVoice) çekilir
 *   2. LLM ile prompt → {title, summary} (Turkce, JSON)
 *   3. Her seçili kanal için buildSocialTextFor() ile kanal-spesifik text üretilir
 *   4. campaignId = random hex (8 byte) — sıfırdan kampanyaları gruplamak için
 *      (articleId null olduğu için, metadata.campaignId üzerinden gruplama)
 *   5. DRAFT SocialPost yaratılır
 *   6. autoMedia=true → image generation tetikle (text-only kanallar atlanır)
 *   7. site.autopilot=true → DRAFT yerine direkt QUEUED, scheduledFor=now (veya verilen tarih)
 */
@Injectable()
export class SocialComposerService {
  private readonly log = new Logger(SocialComposerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LLMProviderService,
    private readonly mediaGen: SocialMediaGeneratorService,
  ) {}

  async compose(input: ComposeInput): Promise<ComposeResult> {
    const { siteId, prompt, channelIds, mediaTypeByChannel, autoMedia, sharedMediaUrls, scheduledFor } = input;

    const trimmed = prompt?.trim() ?? '';
    if (trimmed.length < 15) {
      throw new BadRequestException('Konu en az 15 karakter olmalı, anlaşılır bir cümle yaz');
    }
    // Spam/test pattern reddet: tek kelime tekrarı (testtest, aaaaaa), klavye banger (asdfasdf)
    const lower = trimmed.toLowerCase();
    if (/^(.{1,6})\1{2,}$/.test(lower.replace(/\s/g, ''))) {
      throw new BadRequestException('Konu anlamlı bir cümle olmalı (test/aaaa gibi tekrarlı içerik reddedilir)');
    }
    if (/^(test|asdf|qwer|deneme|hello|merhaba)+$/i.test(lower.replace(/[\s\W]/g, ''))) {
      throw new BadRequestException('Konu anlamlı olmalı. Örn: "2026 konut kredisi faiz oranları"');
    }
    if (!channelIds || channelIds.length === 0) {
      throw new BadRequestException('En az 1 kanal seçilmeli');
    }

    const site = await this.prisma.site.findUnique({
      where: { id: siteId },
      include: { brain: true, socialChannels: { where: { id: { in: channelIds }, isActive: true } } },
    });
    if (!site) throw new NotFoundException('Site bulunamadı');
    if (site.socialChannels.length === 0) {
      throw new BadRequestException('Seçilen kanallar aktif değil veya bu siteye ait değil');
    }

    // 1) LLM ile prompt → kanal-bağımsız title + summary
    const composed = await this.composeBaseContent(siteId, prompt, (site as any).brain?.brandVoice ?? null);
    const costUsd = composed.costUsd;

    // 2) Kampanya kimliği
    const campaignId = `cmp_${randomBytes(8).toString('hex')}`;
    const publishedImmediately = (site as any).autopilot === true;
    const baseScheduledFor = scheduledFor ? new Date(scheduledFor) : (publishedImmediately ? new Date() : null);
    const targetStatus = publishedImmediately ? 'QUEUED' : 'DRAFT';

    // 3) Her kanal için draft yarat (video kanallar + medya yok = SKIP)
    const drafts: CreatedDraft[] = [];
    const skipped: Array<{ channelType: string; reason: string }> = [];
    const hasSharedMedia = !!(sharedMediaUrls && sharedMediaUrls.length > 0);

    for (const channel of site.socialChannels) {
      const needsVideo = VIDEO_REQUIRED_CHANNELS.has(channel.type);

      // Video kanal + medya yok → composer'da AI video desteği yok, kullanıcı Video Factory'i kullanmalı
      if (needsVideo && !hasSharedMedia) {
        skipped.push({
          channelType: channel.type,
          reason: 'Video gerektiriyor — Video Factory\'de mp4 üret, sonra "Dosya Yükle" ile composer\'a tekrar gel',
        });
        this.log.log(`Kanal ${channel.type} skip: video gerekli, medya yok`);
        continue;
      }

      const requestedType = mediaTypeByChannel?.[channel.id];
      const mediaType: MediaType = requestedType ?? mediaDefaultFor(channel.type);
      if (!isMediaTypeAllowed(channel.type, mediaType)) {
        this.log.warn(`Kanal ${channel.type} için ${mediaType} izin yok, default'a düşülüyor`);
      }

      // Bu kanal için yayına hazır mı? text/dosya yüklü = hazır, image gen bekleyen = DRAFT
      const canPublishImmediately = publishedImmediately && (mediaType === 'text' || hasSharedMedia);
      const thisPostStatus = canPublishImmediately ? 'QUEUED' : 'DRAFT';
      const thisScheduledFor = canPublishImmediately ? baseScheduledFor : null;

      // Fake article snippet — buildSocialTextFor yine de çalışır.
      // siteUrl + slug "compose" prefix'iyle, fullUrl=true (URL'i kanal text'inden çıkarmak için boş bırakmak da olur).
      const snippet: ArticleSnippet = {
        title: composed.title,
        metaDescription: composed.summary,
        slug: composed.slug,
        siteUrl: site.url.replace(/\/+$/, ''),
        siteName: site.name,
        pillar: null,
        fullUrl: false,
        brandVoice: (site as any).brain?.brandVoice ?? null,
        hookVariations: null,
      };
      const { text, metadata } = buildSocialTextFor(channel.type, snippet);

      const post = await this.prisma.socialPost.create({
        data: {
          channelId: channel.id,
          articleId: null,
          text,
          mediaUrls: hasSharedMedia ? (sharedMediaUrls as any) : undefined,
          metadata: {
            ...(metadata as any),
            mediaType,
            mediaGenStatus: hasSharedMedia ? 'ready' : 'pending',
            campaignId,
            campaignTitle: composed.title,
            campaignPrompt: prompt.slice(0, 500),
            sourceType: 'composer',
          } as any,
          status: thisPostStatus as any,
          scheduledFor: thisScheduledFor,
        },
      });

      drafts.push({
        id: post.id,
        channelId: channel.id,
        channelType: channel.type,
        mediaType,
        status: post.status,
      });
    }

    if (drafts.length === 0) {
      throw new BadRequestException(
        skipped.length > 0
          ? `Hiç kanal yaratılamadı. Atlananlar: ${skipped.map(s => s.channelType).join(', ')} (video gerektiriyor — önce Video Factory'i kullan, sonra "Dosya Yükle" ile geri dön)`
          : 'Hiç kanal yaratılamadı'
      );
    }

    const queuedCount = drafts.filter(d => d.status === 'QUEUED').length;
    const draftCount = drafts.length - queuedCount;

    // 4) AutoMedia tetikle (image only — video composer'da AI ile üretilmiyor, manuel upload)
    if (autoMedia && (!sharedMediaUrls || sharedMediaUrls.length === 0)) {
      for (const draft of drafts) {
        if (draft.mediaType === 'image') {
          // Async — kullanıcı bekleterek de yapılabilir ama composer hızlı yanıt vermeli
          this.mediaGen.generateForPost(draft.id, 'image').catch((err: any) => {
            this.log.warn(`Composer image üretim fail (post ${draft.id}): ${err.message}`);
          });
        }
      }
    }

    this.log.log(`[${siteId}] Composer kampanya: ${campaignId}, ${queuedCount} QUEUED + ${draftCount} DRAFT, ${skipped.length} skip`);
    return { campaignId, drafts, skipped, publishedImmediately: queuedCount > 0, costUsd };
  }

  /**
   * LLM ile prompt'tan kanal-bağımsız {title, summary, slug} üret.
   * brandVoice respect: tone + signaturePhrases + bannedWords yansıtılır.
   */
  private async composeBaseContent(
    siteId: string,
    prompt: string,
    brandVoice: any,
  ): Promise<{ title: string; summary: string; slug: string; costUsd: number }> {
    const voiceLines: string[] = [];
    if (brandVoice?.tone) voiceLines.push(`Marka tonu: ${brandVoice.tone}`);
    if (brandVoice?.signaturePhrases?.length) voiceLines.push(`Tercih edilen ifadeler: ${brandVoice.signaturePhrases.slice(0, 5).join(', ')}`);
    if (brandVoice?.bannedWords?.length) voiceLines.push(`Yasak kelimeler: ${brandVoice.bannedWords.slice(0, 8).join(', ')}`);

    const system = [
      'Sen Türkçe sosyal medya içerik yazarısın.',
      'Görev: Verilen konu için kısa, akıcı ve dikkat çekici bir başlık + 1-2 cümlelik özet üret.',
      ...voiceLines,
      'AI klişelerinden kaçın ("günümüzde", "dijital çağda", "delve", vb.). Direkt ve net yaz.',
      'Çıktıyı SADECE geçerli JSON olarak ver: {"title":"...","summary":"..."}',
      'title en fazla 70 karakter, summary en fazla 200 karakter olmalı.',
    ].join('\n');

    const resp = await this.llm.chat({
      context: 'social-composer',
      siteId,
      model: 'claude-opus-5',
      systemPrompt: system,
      messages: [{ role: 'user', content: `Konu: ${prompt.trim()}` }],
      maxTokens: 400,
      temperature: 0.7,
    });

    const raw = resp.output.trim();
    // JSON parse — nested fence'leri tamamen temizle: ```json {...} ``` veya iç içe ```
    let cleaned = raw;
    // Tüm code fence'leri kaldır (iç içe olabilir)
    cleaned = cleaned.replace(/```(?:json|JSON)?/g, '').replace(/```/g, '').trim();
    // İlk { ile son } arasındakini al — başka metin varsa atla
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }

    let parsed: { title?: string; summary?: string };
    try {
      parsed = JSON.parse(cleaned);
    } catch (err: any) {
      this.log.warn(`Composer JSON parse fail (${err.message}), raw=${raw.slice(0, 150)}`);
      throw new BadRequestException('AI içerik üretemedi — konuyu daha net yaz veya tekrar dene');
    }

    const title = (parsed.title || '').trim().slice(0, 80);
    const summary = (parsed.summary || '').trim().slice(0, 220);

    if (!title || title.length < 5) {
      throw new BadRequestException('AI geçerli başlık üretemedi — konuyu daha net yaz');
    }
    // Anlaşılmazlık tespiti: LLM "anlaşılmaz/anlamadım/lütfen daha net" tarzı dönerse abort
    const titleLower = title.toLowerCase();
    if (/anla(ş|s)?ı?lmıyor|anla(s|ş)ı?lmadı|geçersiz|net değil|lütfen.*tekrar/.test(titleLower)) {
      throw new BadRequestException(`AI konuyu anlamadı: "${title}". Daha net bir konu yaz.`);
    }

    const slug = this.slugify(title);
    return { title, summary, slug, costUsd: resp.costUsd };
  }

  private slugify(s: string): string {
    return s
      .toLowerCase()
      .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i')
      .replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
  }
}
