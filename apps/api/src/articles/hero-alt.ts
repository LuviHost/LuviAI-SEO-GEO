import sharp from 'sharp';
import type { LLMProviderService } from '../llm/llm-provider.service.js';
import { altLanguage, buildAltPrompt, parseAltSuggestion } from '../audit/image-alt/image-alt-prompt.js';

/**
 * Yayin aninda URETILEN hero gorseli icin alt metni — gorselin yerel baytlari
 * uzerinden (ag yok, SSRF yuzeyi yok).
 *
 * Eskiden hero her zaman alt="" ile basiliyordu (publisher). Kurallar gorsel
 * alt metni ozelligiyle AYNI (image-alt-prompt.ts, iki kaynakli). Hata, red ya
 * da gecersiz cikti → null: yayin ASLA bu yuzden durmaz, eski davranisa
 * (alt="") duser.
 */
export async function describeHeroImage(
  llm: LLMProviderService,
  opts: { bytes: Buffer; title: string; language: string | null; siteId: string; userId?: string; articleId: string },
): Promise<{ alt: string; model: string } | null> {
  try {
    const jpeg = await sharp(opts.bytes, { limitInputPixels: 40_000_000 })
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 80 })
      .toBuffer();
    const { systemPrompt, userText } = buildAltPrompt({
      language: altLanguage(opts.language, null),
      pageUrl: '(yayinlanacak makale)',
      linked: false,
      linkHref: null,
      currentAlt: null,
      context: { heading: opts.title },
    });
    const model = process.env.MODEL_IMAGE_ALT?.trim() || 'claude-opus-5-5';
    const res = await llm.chat({
      context: 'hero-alt',
      siteId: opts.siteId,
      userId: opts.userId,
      conversationId: opts.articleId,
      model,
      effort: 'low',
      maxTokens: 4000,
      systemPrompt,
      messages: [{ role: 'user', content: userText, images: [{ mediaType: 'image/jpeg', base64: jpeg.toString('base64') }] }],
    });
    if (res.stopReason === 'refusal') return null;
    const parsed = parseAltSuggestion(res.output);
    if (!parsed.ok) return null;
    return { alt: parsed.alt, model };
  } catch {
    return null;
  }
}
