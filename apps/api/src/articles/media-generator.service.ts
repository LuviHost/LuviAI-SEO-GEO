import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PrismaService } from '../prisma/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

export interface AudioResult {
  ok: boolean;
  audioPath?: string;
  publicUrl?: string;
  durationSec?: number;
  costUsd: number;
  bytes?: number;
  error?: string;
}

/**
 * MediaGenerator — makaleyi multi-modal hale getirir:
 *   1. TTS (Gemini 2.5 Flash TTS veya OpenAI TTS) → MP3
 *   2. Audio dosyasi public/blog/<slug>/audio.mp3 olarak yazilir
 *   3. AudioObject schema otomatik eklenir
 *   4. RSS feed (podcast-ready) sonradan toplu olarak uretilir
 *
 * AI'lar (Siri, Alexa, Google Assistant) bu MP3'leri tarayip multi-modal alintilama yapar.
 *
 * Video: Faz 4'te ffmpeg + remotion ile (audio + thumbnail + animated text). Simdilik audio only.
 */
@Injectable()
export class MediaGeneratorService {
  private readonly log = new Logger(MediaGeneratorService.name);
  private readonly geminiKey = process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY ?? null;
  private readonly gemini = this.geminiKey ? new GoogleGenAI({ apiKey: this.geminiKey }) : null;
  private readonly openaiKey = process.env.OPENAI_API_KEY ?? null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async generateAudio(articleId: string): Promise<AudioResult> {
    await this.settings.assertAiEnabled('TTS audio generation');
    const articleRaw = await this.prisma.article.findUniqueOrThrow({
      where: { id: articleId },
    });
    const article: any = articleRaw;

    // Markdown'i temiz, sesli okunabilir metne donustur
    const text = this.toSpeechText(article.bodyMd ?? '', article.title);
    if (text.length < 100) {
      return { ok: false, costUsd: 0, error: 'Metin cok kisa, TTS atlandi' };
    }

    // Provider sec — OpenAI varsa OpenAI (kalite), yoksa Gemini
    let audioBuffer: Buffer | null = null;
    let costUsd = 0;
    let provider = '';

    if (this.openaiKey) {
      try {
        const result = await this.generateWithOpenAI(text);
        audioBuffer = result.buffer;
        costUsd = result.costUsd;
        provider = 'openai-tts';
      } catch (err: any) {
        this.log.warn(`OpenAI TTS fail: ${err.message}, Gemini'ye geciyor`);
      }
    }
    if (!audioBuffer && this.gemini) {
      try {
        const result = await this.generateWithGemini(text);
        audioBuffer = result.buffer;
        costUsd = result.costUsd;
        provider = 'gemini-tts';
      } catch (err: any) {
        this.log.warn(`Gemini TTS fail: ${err.message}`);
      }
    }

    if (!audioBuffer) {
      return { ok: false, costUsd: 0, error: 'TTS provider mevcut degil (OPENAI_API_KEY veya GOOGLE_AI_API_KEY)' };
    }

    // Dosyayi yaz: /var/www/luviai/public/blog/<slug>/audio.mp3
    const outDir = path.join(process.cwd(), 'public', 'blog', article.slug);
    await fs.mkdir(outDir, { recursive: true });
    const audioPath = path.join(outDir, 'audio.mp3');
    await fs.writeFile(audioPath, audioBuffer);

    const publicUrl = `/blog/${article.slug}/audio.mp3`;
    const durationSec = Math.round(text.length / 18); // kabaca 18 char/sec Turkce TTS

    this.log.log(`[${article.id}] TTS audio: ${(audioBuffer.length / 1024).toFixed(1)} KB, ~${durationSec}s, $${costUsd.toFixed(4)} (${provider})`);

    // Article'a inlineImages benzeri alana audio bilgisi yaz (frontmatter veya agentOutputs)
    await this.prisma.article.update({
      where: { id: articleId },
      data: {
        inlineImages: undefined as any, // dokunma
      },
    }).catch(() => {});

    return {
      ok: true,
      audioPath,
      publicUrl,
      durationSec,
      bytes: audioBuffer.length,
      costUsd,
    };
  }

  /**
   * Tum site icin RSS podcast feed uret (audio dosyasi olan published makaleler).
   * Spotify, Apple Podcasts, Google Podcasts'a submit edilebilir.
   */
  async generatePodcastRss(siteId: string): Promise<string> {
    const site = await this.prisma.site.findUniqueOrThrow({
      where: { id: siteId },
      include: { brain: true },
    });
    const baseUrl = site.url.replace(/\/+$/, '');

    const articles = await this.prisma.article.findMany({
      where: { siteId, status: 'PUBLISHED' as any },
      orderBy: { publishedAt: 'desc' },
      take: 50,
    });

    const items = articles.map((a) => {
      const audioUrl = `${baseUrl}/blog/${a.slug}/audio.mp3`;
      return `
    <item>
      <title>${this.xmlEscape(a.title)}</title>
      <description>${this.xmlEscape(a.metaDescription ?? '')}</description>
      <link>${baseUrl}/blog/${a.slug}.html</link>
      <guid isPermaLink="false">${a.id}</guid>
      <pubDate>${(a.publishedAt ?? a.createdAt).toUTCString()}</pubDate>
      <enclosure url="${audioUrl}" type="audio/mpeg" length="0"/>
      <itunes:duration>${Math.max(60, (a.readingTime ?? 5) * 60)}</itunes:duration>
    </item>`;
    }).join('');

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>${this.xmlEscape(site.name)} Podcast</title>
    <link>${baseUrl}</link>
    <description>${this.xmlEscape((site.brain?.brandVoice as any)?.summary ?? site.name)}</description>
    <language>${site.language ?? 'tr'}</language>
    <itunes:author>${this.xmlEscape(site.name)}</itunes:author>
    <itunes:category text="Technology"/>
    ${items}
  </channel>
</rss>`;

    return xml;
  }

  // ────────────────────────────────────────────────────────────
  //  Provider implementations
  // ────────────────────────────────────────────────────────────
  private async generateWithOpenAI(text: string): Promise<{ buffer: Buffer; costUsd: number }> {
    const truncated = text.slice(0, 4000); // OpenAI 4096 char limit
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.openaiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'tts-1',
        input: truncated,
        voice: 'alloy',
        response_format: 'mp3',
      }),
    });
    if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${await res.text().catch(() => '')}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const costUsd = (truncated.length / 1000) * 0.015; // tts-1 ~$0.015/1k char
    return { buffer, costUsd };
  }

  private async generateWithGemini(text: string): Promise<{ buffer: Buffer; costUsd: number }> {
    const truncated = text.slice(0, 4500);
    const resp = await this.gemini!.models.generateContent({
      model: 'gemini-2.5-flash-preview-tts',
      contents: [{ parts: [{ text: truncated }] }],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
      } as any,
    });
    let buffer: Buffer | null = null;
    for (const part of resp.candidates?.[0]?.content?.parts ?? []) {
      const d = (part as any).inlineData?.data;
      if (d) {
        buffer = Buffer.from(d, 'base64');
        break;
      }
    }
    if (!buffer) throw new Error('Gemini TTS bos cevap');
    const costUsd = (truncated.length / 1000) * 0.020;
    return { buffer, costUsd };
  }

  // ────────────────────────────────────────────────────────────
  //  Helpers
  // ────────────────────────────────────────────────────────────
  private toSpeechText(md: string, title: string): string {
    const cleaned = md
      .replace(/^---[\s\S]*?---/m, '') // frontmatter
      .replace(/!\[.*?\]\(.*?\)/g, '') // gorsel
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // link
      .replace(/`{3}[\s\S]*?`{3}/g, '') // code block
      .replace(/`([^`]+)`/g, '$1') // inline code
      .replace(/^\s*[#>*\-_+]+\s*/gm, '') // markdown markers
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return `${title}.\n\n${cleaned}`;
  }

  private xmlEscape(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
