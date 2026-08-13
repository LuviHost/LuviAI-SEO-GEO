import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  computeVerdict,
  evidenceWeight,
  verdictGuidance,
  type ClaimStatus,
  type EvidenceGrade,
  type EvidenceInput,
  type EvidenceStance,
} from './evidence-grade.js';
import type { IntelTopic } from './source-registry.js';

/**
 * Iddia defteri — sistemin hafizasi.
 *
 * Tek tek yayinlar gelip gecer; kalici olan "su iddianin arkasinda su an
 * ne kadar kanit var?" sorusunun cevabidir. Her yeni kanit defteri
 * gunceller ve iddianin DURUMU degisebilir: uc ay boyunca EMERGING olan
 * bir iddia, Google'in resmi bir notuyla bir gunde MYTH'e dusebilir.
 *
 * DURUM DEGISIMI ozetin en degerli parcasidir — "bu hafta ne ogrendik"
 * sorusunun cevabi tam olarak burada olusur.
 */

export interface ExtractedClaim {
  slug: string;
  statement: string;
  topics: IntelTopic[];
  productAreas: string[];
  grade: EvidenceGrade;
  stance: EvidenceStance;
  quote: string;
  sampleSize: number | null;
}

export interface StatusChange {
  claimId: string;
  slug: string;
  statement: string;
  from: ClaimStatus | null;
  to: ClaimStatus;
  confidence: number;
}

@Injectable()
export class ClaimLedgerService {
  private readonly log = new Logger(ClaimLedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Analist prompt'una konulacak mevcut iddia listesi. Konu kesisimine
   * gore filtrelenir ki model 200 iddia arasindan degil, ilgili
   * olanlar arasindan eslestirsin.
   */
  async claimContext(topics: string[], limit: number): Promise<Array<{ slug: string; statement: string }>> {
    const claims = await this.prisma.intelClaim.findMany({
      orderBy: [{ lastEvidenceAt: 'desc' }],
      take: 200,
      select: { slug: true, statement: true, topics: true },
    });

    if (topics.length === 0) {
      return claims.slice(0, limit).map(({ slug, statement }) => ({ slug, statement }));
    }

    const wanted = new Set(topics);
    const scored = claims.map((c) => {
      const ct = Array.isArray(c.topics) ? (c.topics as string[]) : [];
      const overlap = ct.filter((t) => wanted.has(t)).length;
      return { slug: c.slug, statement: c.statement, overlap };
    });

    // Kesisim olanlar once; kalan yer varsa geri kalani tarih sirasiyla
    scored.sort((a, b) => b.overlap - a.overlap);
    return scored.slice(0, limit).map(({ slug, statement }) => ({ slug, statement }));
  }

  /**
   * Bir yayindan cikan iddialari deftere isler ve etkilenen iddialarin
   * durumunu yeniden hesaplar.
   */
  async record(
    itemId: string,
    claims: ExtractedClaim[],
    ctx: { sourceWeight: number; publishedAt: Date | null },
  ): Promise<StatusChange[]> {
    const changes: StatusChange[] = [];

    for (const c of claims) {
      const claim = await this.upsertClaim(c);

      const weight = Math.round(
        evidenceWeight({
          grade: c.grade,
          stance: c.stance,
          sourceWeight: ctx.sourceWeight,
          publishedAt: ctx.publishedAt,
          sampleSize: c.sampleSize,
        }),
      );

      try {
        await this.prisma.intelEvidence.create({
          data: {
            claimId: claim.id,
            itemId,
            grade: c.grade,
            stance: c.stance,
            quote: c.quote,
            sampleSize: c.sampleSize,
            weight,
          },
        });
      } catch {
        // (claimId, itemId) unique — ayni yayin ayni iddiaya ikinci kez
        // kanit olamaz. Yeniden analiz durumunda buraya duseriz.
        continue;
      }

      const change = await this.recompute(claim.id, claim.status as ClaimStatus);
      if (change) changes.push(change);
    }

    return changes;
  }

  /** Iddiayi slug ile bulur; yoksa acar, varsa konu/alan bilgisini zenginlestirir. */
  private async upsertClaim(c: ExtractedClaim) {
    const existing = await this.prisma.intelClaim.findUnique({ where: { slug: c.slug } });
    if (existing) {
      // Konular ve urun alanlari BIRLESTIRILIR, uzerine yazilmaz: sonraki
      // yayin daha dar bir aciyla bakmis olabilir, onceki bilgiyi silmesin.
      const topics = union(existing.topics as string[] | null, c.topics);
      const productAreas = union(existing.productAreas as string[] | null, c.productAreas);
      return this.prisma.intelClaim.update({
        where: { id: existing.id },
        data: { topics: topics as any, productAreas: productAreas as any },
      });
    }

    return this.prisma.intelClaim.create({
      data: {
        slug: c.slug,
        statement: c.statement,
        topics: c.topics as any,
        productAreas: c.productAreas as any,
      },
    });
  }

  /**
   * Iddianin tum kanitlarini yeniden tartar ve durumu gunceller.
   * Durum degistiyse StatusChange doner (ozet bunun uzerine kurulur).
   */
  async recompute(claimId: string, previousStatus?: ClaimStatus): Promise<StatusChange | null> {
    const claim = await this.prisma.intelClaim.findUnique({
      where: { id: claimId },
      include: {
        evidences: {
          select: {
            grade: true, stance: true, sampleSize: true,
            item: { select: { publishedAt: true, source: { select: { weight: true } } } },
          },
        },
      },
    });
    if (!claim) return null;

    const inputs: EvidenceInput[] = claim.evidences.map((e) => ({
      grade: e.grade as EvidenceGrade,
      stance: e.stance as EvidenceStance,
      sourceWeight: e.item.source.weight,
      publishedAt: e.item.publishedAt,
      sampleSize: e.sampleSize,
    }));

    const verdict = computeVerdict(inputs);
    const before = (previousStatus ?? claim.status) as ClaimStatus;

    const lastEvidenceAt = claim.evidences
      .map((e) => e.item.publishedAt?.getTime() ?? 0)
      .reduce((a, b) => Math.max(a, b), 0);

    await this.prisma.intelClaim.update({
      where: { id: claimId },
      data: {
        status: verdict.status,
        confidence: verdict.confidence,
        supportWeight: verdict.supportWeight,
        refuteWeight: verdict.refuteWeight,
        guidance: verdictGuidance(verdict, verdict.status),
        lastEvidenceAt: lastEvidenceAt > 0 ? new Date(lastEvidenceAt) : null,
      },
    });

    if (verdict.status === before) return null;

    this.log.log(`Iddia durumu degisti: ${claim.slug} ${before} → ${verdict.status}`);
    return {
      claimId,
      slug: claim.slug,
      statement: claim.statement,
      // Yeni acilan iddiada "onceki durum" diye bir sey yok; EMERGING
      // varsayilanindan gecisi degisim saymamak icin null gonderiyoruz.
      from: claim.evidences.length <= 1 ? null : before,
      to: verdict.status,
      confidence: verdict.confidence,
    };
  }

  /**
   * Tum defteri yeniden tartar. Tazelik carpani zamanla azaldigi icin
   * hicbir yeni kanit gelmese bile durumlar kayar (CONFIRMED → STALE);
   * bu yuzden gunluk calisir.
   */
  async recomputeAll(): Promise<{ scanned: number; changed: number }> {
    const claims = await this.prisma.intelClaim.findMany({ select: { id: true, status: true } });
    let changed = 0;
    for (const c of claims) {
      const ch = await this.recompute(c.id, c.status as ClaimStatus);
      if (ch) changed++;
    }
    return { scanned: claims.length, changed };
  }

  // ────────────────────────────────────────────────────────────
  //  OKUMA
  // ────────────────────────────────────────────────────────────

  async list(opts: { status?: string; topic?: string; area?: string; limit?: number } = {}) {
    const claims = await this.prisma.intelClaim.findMany({
      where: opts.status ? { status: opts.status } : undefined,
      orderBy: [{ lastEvidenceAt: 'desc' }],
      take: Math.min(opts.limit ?? 100, 300),
      include: {
        evidences: {
          orderBy: { weight: 'desc' },
          take: 5,
          select: {
            grade: true, stance: true, quote: true, weight: true, sampleSize: true,
            item: {
              select: {
                url: true, title: true, publishedAt: true,
                source: { select: { name: true, tier: true } },
              },
            },
          },
        },
        _count: { select: { evidences: true } },
      },
    });

    // Konu/alan filtreleri JSON alanlarda tutuldugu icin MySQL tarafinda
    // guvenilir sorgulanamiyor; kucuk veri hacminde bellekte suzuluyor.
    return claims.filter((c) => {
      if (opts.topic && !(c.topics as string[] | null)?.includes(opts.topic)) return false;
      if (opts.area && !(c.productAreas as string[] | null)?.includes(opts.area)) return false;
      return true;
    });
  }

  async get(idOrSlug: string) {
    return this.prisma.intelClaim.findFirst({
      where: { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
      include: {
        evidences: {
          orderBy: { weight: 'desc' },
          include: {
            item: {
              select: {
                url: true, title: true, author: true, publishedAt: true,
                source: { select: { name: true, tier: true, weight: true } },
              },
            },
          },
        },
      },
    });
  }

  /** Urun tarafinda islem durumu — bulguyu eyleme baglayan alan. */
  async setAction(claimId: string, actionStatus: string, note?: string) {
    const valid = ['OPEN', 'PLANNED', 'APPLIED', 'REJECTED'];
    if (!valid.includes(actionStatus)) throw new Error(`Gecersiz actionStatus: ${actionStatus}`);
    return this.prisma.intelClaim.update({
      where: { id: claimId },
      data: { actionStatus, actionNote: note ?? null },
    });
  }
}

function union(a: string[] | null | undefined, b: string[]): string[] {
  return [...new Set([...(a ?? []), ...b])];
}
