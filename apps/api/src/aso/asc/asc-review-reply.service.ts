import { BadRequestException, Injectable } from '@nestjs/common';
import { LLMProviderService } from '../../llm/llm-provider.service.js';
import { QuotaService } from '../../billing/quota.service.js';
import { parseJsonFromLlm } from '../../common/safe-json.js';
import { AscService, type RequestingUser } from './asc.service.js';
import { explainAscError } from './asc-metadata.service.js';
import { buildReplyPrompt, parseReplyDraft } from './review-reply.js';

/**
 * Yorum yaniti TASLAGI — gonderme yok. Insan duzenler ve onaylar; gonderim
 * mevcut reply ucundan (yer tutucu kontrolu orada).
 */
@Injectable()
export class AscReviewReplyService {
  constructor(
    private readonly asc: AscService,
    private readonly llm: LLMProviderService,
    private readonly quota: QuotaService,
  ) {}

  async draft(appId: string, reviewId: string, user: RequestingUser, body: { notes?: unknown; supportContact?: unknown }) {
    const app = await this.asc.loadApp(appId, user);
    await this.quota.enforceAiCostBudget(user.id);
    const client = await this.asc.getClient(app.accountId);

    let review: any;
    let existing: any;
    try {
      const res = await client.getCustomerReview(reviewId);
      review = res.data;
      existing = (res.included ?? []).find((x: any) => x?.type === 'customerReviewResponses')?.attributes ?? null;
    } catch (err) {
      throw new BadRequestException(explainAscError(err));
    }

    const { systemPrompt, user: userMsg } = buildReplyPrompt({
      appName: app.name,
      review: {
        rating: review?.attributes?.rating ?? 0,
        title: review?.attributes?.title ?? null,
        body: review?.attributes?.body ?? '',
        territory: review?.attributes?.territory ?? null,
        existingResponse: existing?.responseBody ?? null,
      },
      notes: typeof body?.notes === 'string' ? body.notes : null,
      supportContact: typeof body?.supportContact === 'string' ? body.supportContact.slice(0, 120) : null,
    });

    const res = await this.llm.chat({
      context: 'asc-review-reply',
      siteId: app.account.siteId,
      userId: user.id,
      // Herkese acik metin → proje kalite standardi Opus; MODEL_REVIEW_REPLY ile degisir
      model: process.env.MODEL_REVIEW_REPLY?.trim() || 'claude-opus-5-5',
      effort: 'low',
      maxTokens: 800,
      systemPrompt,
      messages: [{ role: 'user', content: userMsg }],
    });
    return { ...parseReplyDraft(parseJsonFromLlm<any>(res.output)), existingResponse: existing?.responseBody ?? null };
  }
}
