import { Injectable } from '@nestjs/common';
import { GeoRunnerService } from '../audit/geo-runner.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface GeoGap {
  query: string;
  appearance_in: string[];
  cited: boolean;
  competitors_cited: string[];
}

/**
 * Topic engine için GEO gap'leri çıkarır.
 * Audit module'ündeki GeoRunnerService'i kullanır → 47 metod + AI search query
 * verisinden topic-ranker'a uygun gap formatına çevirir.
 */
@Injectable()
export class GeoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geoRunner: GeoRunnerService,
  ) {}

  async fetchGaps(siteId: string): Promise<{ score: number | null; gaps: GeoGap[] }> {
    const site = await this.prisma.site.findUniqueOrThrow({ where: { id: siteId } });
    const result = await this.geoRunner.runAudit(site.url);

    const gaps: GeoGap[] = (result.queries ?? [])
      .filter((q: any) => q.cited === false || q.appearance === 0)
      .map((q: any) => ({
        query: q.query ?? q.name ?? '',
        appearance_in: q.engines ?? [],
        cited: false,
        competitors_cited: q.competitor_citations ?? [],
      }));

    return { score: result.score, gaps };
  }
}
