import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ActionPlansService } from '../action-plans/action-plans.service.js';
import { ClaimLedgerService } from './claim-ledger.service.js';

/**
 * Istihbarat → Aksiyon Plani koprusu — ADMIN ONAYLI, otomatik degil.
 *
 * NEDEN OTOMATIK DEGIL (kirmizi-takim, 2026-08):
 *   - IntelClaim kuresel bir defter; siteId yok. Otomatik uretim hangi
 *     musteri sitesine yazacagini bilemez.
 *   - recomputeAll her gece tazelik carpaniyla defteri yeniden tartar;
 *     CONFIRMED<->STALE salinan iddia koprusu her donuste yeniden ateslerdi.
 *   - ActionPlan dedupe yalniz acik statulerde arar; musterinin "yoksay"
 *     dedigi item ilk salinimda geri gelirdi.
 *   - Iddialar PRODUCT_AREAS'a (urun modullerine) adreslenir; cogu musteri
 *     aksiyonu degil urun ekibi aksiyonudur.
 *
 * Bu yuzden: admin iddiayi secer, HEDEF SITEYI ve basligi kendisi belirler.
 * Iki-kaynak kurali burada da zorlanir — tek kaynakli iddiadan aksiyon acilmaz.
 */

const MIN_DISTINCT_SOURCES = 2; // evidence-grade.ts ile ayni urun karari

@Injectable()
export class IntelActionService {
  private readonly log = new Logger(IntelActionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly actionPlans: ActionPlansService,
    private readonly ledger: ClaimLedgerService,
  ) {}

  async toActionPlan(claimId: string, input: {
    siteIds: string[];
    title?: string;
    description?: string;
    impact?: 'high' | 'medium' | 'low';
    effort?: 'easy' | 'medium' | 'hard';
  }) {
    const claim = await this.prisma.intelClaim.findUnique({
      where: { id: claimId },
      include: { evidences: { include: { item: { select: { source: { select: { key: true } } } } } } },
    });
    if (!claim) throw new NotFoundException('Iddia bulunamadi');

    const distinct = new Set(claim.evidences.map((e) => e.item.source.key)).size;
    if (distinct < MIN_DISTINCT_SOURCES) {
      throw new BadRequestException(
        `Tek kaynakli iddiadan aksiyon acilmaz (${distinct} kaynak, en az ${MIN_DISTINCT_SOURCES} gerekli). Ikinci bagimsiz kaynak gelene kadar izlemede tut.`,
      );
    }
    if (!['CONFIRMED', 'MYTH', 'CONTESTED'].includes(claim.status)) {
      throw new BadRequestException(`Yalniz kesin hukumlu iddialardan aksiyon acilir (durum: ${claim.status})`);
    }

    const siteIds = [...new Set((input.siteIds ?? []).filter((s) => typeof s === 'string' && s.length > 0))];
    if (siteIds.length === 0) throw new BadRequestException('En az bir hedef site secilmeli');
    const sites = await this.prisma.site.findMany({ where: { id: { in: siteIds } }, select: { id: true, name: true } });
    if (sites.length !== siteIds.length) throw new BadRequestException('Bazi site id\'leri bulunamadi');

    const title = (input.title ?? claim.statement).trim().slice(0, 300);
    const description = (input.description ?? [claim.guidance, `Kaynak: istihbarat defteri · ${claim.slug} · ${distinct} bagimsiz kaynak`].filter(Boolean).join('\n\n')).slice(0, 5000);

    const created: Array<{ siteId: string; siteName: string; itemId: string }> = [];
    for (const site of sites) {
      const item = await this.actionPlans.create(site.id, {
        title,
        description,
        source: 'intel',
        sourceRef: `claim:${claim.slug}`,
        impact: input.impact ?? 'medium',
        effort: input.effort ?? 'medium',
        meta: { claimId: claim.id, slug: claim.slug, claimStatus: claim.status, distinctSources: distinct },
      });
      created.push({ siteId: site.id, siteName: site.name, itemId: item.id });
    }

    await this.ledger.setAction(claim.id, 'PLANNED', `Aksiyon plani: ${sites.map((s) => s.name).join(', ')}`);
    this.log.log(`Intel→ActionPlan: ${claim.slug} → ${sites.length} site`);
    return { claim: { id: claim.id, slug: claim.slug, status: claim.status, distinctSources: distinct }, created };
  }
}
