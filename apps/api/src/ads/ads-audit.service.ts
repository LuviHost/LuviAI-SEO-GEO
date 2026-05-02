import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { AgentRunnerService } from '../articles/agent-runner.service.js';
import { AdsSnapshotCollectorService } from './snapshot-collector.service.js';
import { GOOGLE_RULES } from './rules/google-rules.js';
import { META_RULES } from './rules/meta-rules.js';
import { scoreAudit } from './scoring/scorer.js';
import type { AuditRule, AccountSnapshot, AuditScore, Industry, Platform, Verdict } from './rules/types.js';

interface RawResult {
  rule: AuditRule;
  verdict: Verdict;
  finding: string;
  recommendation: string;
}

/**
 * Reklam Hesabı Audit Service.
 * Kuralları sırayla çalıştırır; deterministik olanları check() ile,
 * yargısal olanları LLM (Claude) ile değerlendirir.
 *
 * Sonucu DB'ye `Audit` kaydı olarak yazar (kind: 'ads_audit'),
 * frontend `getLatestAdsAudit()` ile çeker.
 */
@Injectable()
export class AdsAuditService {
  private readonly log = new Logger(AdsAuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly collector: AdsSnapshotCollectorService,
    private readonly agentRunner: AgentRunnerService,
  ) {}

  async run(siteId: string, platform: Platform, industry: Industry = 'saas'): Promise<AuditScore> {
    this.log.log(`[${siteId}] Ads audit başlıyor — platform=${platform} industry=${industry}`);
    const t0 = Date.now();

    const snapshot = await this.collector.collect(siteId, platform);
    const rules = platform === 'google' ? GOOGLE_RULES : META_RULES;

    // 1) Deterministik kurallar — paralel
    const detResults: RawResult[] = [];
    const llmRules: AuditRule[] = [];

    for (const rule of rules) {
      if (rule.llm) {
        llmRules.push(rule);
        continue;
      }
      try {
        const r = rule.check(snapshot, industry);
        if (r) {
          detResults.push({
            rule,
            verdict: r.verdict,
            finding: r.finding ?? '',
            recommendation: r.recommendation ?? '',
          });
        } else {
          // Deterministik check null döndü → veri yok, na
          detResults.push({ rule, verdict: 'na', finding: 'Veri yok', recommendation: '' });
        }
      } catch (err: any) {
        this.log.warn(`Rule ${rule.id} hatası: ${err.message}`);
        detResults.push({ rule, verdict: 'na', finding: `Kontrol hatası: ${err.message}`, recommendation: '' });
      }
    }

    // 2) LLM kuralları — paralel (max 5 eşzamanlı)
    const llmResults = await this.runLlmRules(llmRules, snapshot);

    const allResults = [...detResults, ...llmResults];
    const score = scoreAudit(platform, allResults);

    // 3) DB'ye yaz
    await this.prisma.adsAudit.create({
      data: {
        siteId,
        platform,
        industry,
        totalScore: score.total,
        grade: score.grade,
        byCategory: score.byCategory as any,
        findings: score.findings as any,
        summary: score.summary as any,
        durationMs: Date.now() - t0,
      },
    });

    this.log.log(`[${siteId}] Ads audit bitti — score=${score.total}/100 grade=${score.grade} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    return score;
  }

  async getLatest(siteId: string, platform: Platform): Promise<(AuditScore & { ranAt: Date; industry: string }) | null> {
    const audit = await this.prisma.adsAudit.findFirst({
      where: { siteId, platform },
      orderBy: { ranAt: 'desc' },
    });
    if (!audit) return null;
    const findings = (audit.findings as any[]) ?? [];
    return {
      platform,
      total: audit.totalScore,
      grade: audit.grade as any,
      byCategory: audit.byCategory as any,
      findings,
      quickWins: findings.filter((f: any) => f.isQuickWin),
      summary: audit.summary as any,
      ranAt: audit.ranAt,
      industry: audit.industry,
    };
  }

  private async runLlmRules(rules: AuditRule[], snap: AccountSnapshot): Promise<RawResult[]> {
    if (rules.length === 0) return [];

    // Eğer ad copy / naming hiç yoksa LLM'e atmaya gerek yok
    const hasContent = (snap.campaignNamingSamples?.length ?? 0) + (snap.adCopySamples?.length ?? 0) + (snap.landingPageThemes?.length ?? 0) > 0;
    if (!hasContent) {
      return rules.map(r => ({ rule: r, verdict: 'na' as Verdict, finding: 'İçerik analizi için yeterli veri yok', recommendation: '' }));
    }

    const out: RawResult[] = [];
    // Paralel max 3
    const chunks: AuditRule[][] = [];
    for (let i = 0; i < rules.length; i += 3) chunks.push(rules.slice(i, i + 3));

    for (const chunk of chunks) {
      const results = await Promise.all(chunk.map(r => this.judgeOne(r, snap)));
      out.push(...results);
    }
    return out;
  }

  private async judgeOne(rule: AuditRule, snap: AccountSnapshot): Promise<RawResult> {
    if (!rule.llm || !rule.llmPrompt) {
      return { rule, verdict: 'na', finding: 'LLM prompt yok', recommendation: '' };
    }
    const prompt = rule.llmPrompt(snap);
    try {
      const result = await this.agentRunner.run({
        agentName: '04-editor',
        agentSystemSuffix: 'Sen bir reklam hesabı denetçisisin. SADECE geçerli JSON döndür, açıklama yazma.',
        brainContext: { brand: 'LuviAI Ads Audit', voice: 'analitik', goals: [], stoplist: [] } as any,
        input: prompt,
        maxTokens: 400,
        preferredModel: 'haiku',
      });
      // JSON parse et
      const json = JSON.parse(result.output.match(/\{[\s\S]*\}/)?.[0] ?? '{}');
      return {
        rule,
        verdict: (json.verdict ?? 'na') as Verdict,
        finding: json.finding ?? '',
        recommendation: json.recommendation ?? '',
      };
    } catch (err: any) {
      this.log.warn(`LLM rule ${rule.id} hatası: ${err.message}`);
      return { rule, verdict: 'na', finding: `LLM değerlendirme hatası`, recommendation: '' };
    }
  }
}
