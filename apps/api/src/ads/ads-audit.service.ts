import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { LLMProviderService } from '../llm/llm-provider.service.js';
import { parseJsonFromLlm } from '../common/safe-json.js';
import { AdsSnapshotCollectorService } from './snapshot-collector.service.js';
import { GOOGLE_RULES } from './rules/google-rules.js';
import { META_RULES } from './rules/meta-rules.js';
import { buildFullRuleSet } from './rules/rule-factory.js';
import { scoreAudit } from './scoring/scorer.js';
import { NO_CAMPAIGN_FINDING, NO_DATA_FINDING, definedSnapshotFields, firstMissingRequirement } from './rules/requires.js';
import type { AuditRule, AccountSnapshot, AuditDataStatus, AuditScore, Industry, Platform, Verdict } from './rules/types.js';

interface RawResult {
  rule: AuditRule;
  verdict: Verdict;
  finding: string;
  recommendation: string;
  /** Kontrol icin gereken veri hesaptan okunamadi */
  noData?: boolean;
}

const CONNECT_HINT = 'Reklam hesabını Bağlantılar sayfasındaki Reklam Hesapları kartından bağla ya da yeniden bağla.';

/**
 * Kuralin `requires` alanlari okunmamissa 'na' sonucu; okunmussa null.
 * Ust dizi okunmus ama bossa (hesapta etkin kampanya yok) 'na' ama veri
 * eksikligi sayilmaz.
 */
export function requirementResult(rule: AuditRule, snap: AccountSnapshot): RawResult | null {
  const gap = firstMissingRequirement(snap, rule.requires);
  if (!gap) return null;
  if (gap.reason === 'empty') return { rule, verdict: 'na', finding: NO_CAMPAIGN_FINDING, recommendation: '' };
  return { rule, verdict: 'na', finding: NO_DATA_FINDING, recommendation: '', noData: true };
}

/** Deterministik kural: once requires, sonra check() (veri okunmamissa check cagrilmaz) */
export function evaluateDeterministic(rule: AuditRule, snap: AccountSnapshot, industry: Industry): RawResult {
  const gap = requirementResult(rule, snap);
  if (gap) return gap;
  const r = rule.check(snap, industry);
  if (!r) return { rule, verdict: 'na', finding: 'Veri yok', recommendation: '' };
  return {
    rule,
    verdict: normalizeVerdict(r.verdict),
    finding: r.finding ?? '',
    recommendation: r.recommendation ?? '',
  };
}

/**
 * Snapshot'ta hesaptan okunmus gercek veri var mi? Para birimi tek basina
 * sayilmaz. Yoksa LLM asamasi hic calismaz (maliyet yok, kurallar 'na').
 */
export function hasAccountData(snap: AccountSnapshot): boolean {
  return definedSnapshotFields(snap).some((k) => k !== 'currency');
}

/** Varsayilan hakem modeli — eski kodun niyeti ('opus' → agent-runner MODEL_MAP) */
export const ADS_AUDIT_DEFAULT_MODEL = 'claude-opus-5';

/** LLM kurali icin model: ADS_AUDIT_MODEL, yoksa varsayilan (makale ajan ayarlari etkilemez) */
/**
 * Bir denetimin model asamasi icin USD tavani (18.11.2026, sahip: "limit 5 dolar"). Env
 * ADS_AUDIT_MAX_USD ile degisir; gecersiz deger varsayilana duser. Tavana yaklasinca kalan kurallar
 * modele sorulmaz, 'na' + "maliyet tavani" notu alir (skora girmez).
 */
export const ADS_AUDIT_MAX_USD_DEFAULT = 5;
export function adsAuditMaxUsd(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.ADS_AUDIT_MAX_USD);
  return Number.isFinite(n) && n > 0 ? n : ADS_AUDIT_MAX_USD_DEFAULT;
}
export const COST_CAP_FINDING = 'Denetimin maliyet tavanı doldu; bu kontrol değerlendirilmedi';

export function adsAuditModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.ADS_AUDIT_MODEL?.trim() || ADS_AUDIT_DEFAULT_MODEL;
}

const VERDICTS: ReadonlySet<string> = new Set(['pass', 'warning', 'fail', 'na']);

/**
 * Modelin verdict'ini skorlayicinin sozlugune indirger. Bilinmeyen deger 'na':
 * scorer summary[verdict]++ yaptigindan "PASS" / "n/a" gibi bir deger ozeti
 * NaN'a ceviriyordu.
 */
export function normalizeVerdict(raw: unknown): Verdict {
  const v = String(raw ?? '').trim().toLowerCase().replace(/[\s/_-]/g, '');
  if (v === 'na' || v === 'none' || v === 'notapplicable') return 'na';
  if (v === 'warn') return 'warning';
  return VERDICTS.has(v) ? (v as Verdict) : 'na';
}

const JUDGE_SYSTEM_PROMPT = 'Sen bir reklam hesabı denetçisisin. SADECE geçerli JSON döndür, açıklama yazma.';

/**
 * Reklam Hesabı Audit Service.
 * Kuralları sırayla çalıştırır; deterministik olanları check() ile,
 * yargısal olanları LLM (Claude) ile değerlendirir.
 *
 * Sonucu DB'ye `Audit` kaydı olarak yazar (kind: 'ads_audit'),
 * frontend `getLatestAdsAudit()` ile çeker.
 *
 * LLM hakemi LLMProviderService'i DOGRUDAN cagirir. Eskiden agent-runner'a
 * ('04-editor' adiyla) gidiyordu: (1) verilen baglamda `brain` alani yoktu,
 * buildBrainContext 'Cannot read properties of undefined (reading
 * brandVoice)' firlatiyor ve LLM ile degerlendirilen HER kural 'na' / 'LLM
 * değerlendirme hatası' donuyordu — Kampanya Skoru yalniz deterministik
 * kurallardan cikiyordu; (2) EDITOR_MODEL env'i hakem modelini eziyordu;
 * (3) makale editorunun 'high' dusunme eforu basit bir siniflandirmaya
 * harcaniyordu. Model ADS_AUDIT_MODEL ile secilir, harcama site'ye yazilir
 * (context 'ads-audit-llm').
 */
@Injectable()
export class AdsAuditService {
  private readonly log = new Logger(AdsAuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly collector: AdsSnapshotCollectorService,
    private readonly llm: LLMProviderService,
  ) {}

  async run(siteId: string, platform: Platform, industry: Industry = 'saas'): Promise<AuditScore> {
    this.log.log(`[${siteId}] Ads audit başlıyor — platform=${platform} industry=${industry}`);
    const t0 = Date.now();

    const { snapshot, source, readErrors } = await this.collector.collect(siteId, platform);
    // Tam kural seti: deterministik manuel kurallar + claude-ads JSON'dan üretilen LLM kuralları
    const rules = platform === 'google'
      ? buildFullRuleSet<any>(GOOGLE_RULES, 'google')
      : buildFullRuleSet<any>(META_RULES, 'meta');
    this.log.log(`[${siteId}] ${rules.length} kural değerlendirilecek (det: ${rules.filter(r => !r.llm).length}, llm: ${rules.filter(r => r.llm).length})`);

    // 1) Deterministik kurallar — veri okunmamissa check() hic cagrilmaz
    const detResults: RawResult[] = [];
    const llmRules: AuditRule[] = [];

    for (const rule of rules) {
      if (rule.llm) {
        llmRules.push(rule);
        continue;
      }
      try {
        detResults.push(evaluateDeterministic(rule, snapshot, industry));
      } catch (err: any) {
        this.log.warn(`Rule ${rule.id} hatası: ${err.message}`);
        detResults.push({ rule, verdict: 'na', finding: 'Kontrol hatası', recommendation: '' });
      }
    }

    // 2) LLM kuralları — paralel (max 5 eşzamanlı)
    const llmResults = await this.runLlmRules(llmRules, snapshot, siteId);

    const allResults = [...detResults, ...llmResults];
    const dataStatus: AuditDataStatus = {
      source,
      noDataCount: allResults.filter((r) => r.noData).length,
      readFields: definedSnapshotFields(snapshot),
      readErrors: readErrors.slice(0, 10),
      ...(snapshot.currency ? { currency: snapshot.currency } : {}),
    };
    const score: AuditScore = { ...scoreAudit(platform, allResults), dataStatus };
    if (dataStatus.noDataCount > 0) {
      this.log.log(`[${siteId}] ${dataStatus.noDataCount}/${allResults.length} kontrol için hesaptan veri okunamadı (kaynak=${source})`);
    }

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
        // Sema degismeden: veri durumu ozet JSON'unda saklanir (getLatest ayirir)
        summary: { ...score.summary, dataStatus } as any,
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
    const { dataStatus, ...summary } = ((audit.summary as any) ?? {}) as AuditScore['summary'] & { dataStatus?: AuditDataStatus };
    return {
      platform,
      total: audit.totalScore,
      grade: audit.grade as any,
      byCategory: audit.byCategory as any,
      findings,
      quickWins: findings.filter((f: any) => f.isQuickWin),
      summary,
      ...(dataStatus ? { dataStatus } : {}),
      ranAt: audit.ranAt,
      industry: audit.industry,
    };
  }

  private async runLlmRules(allRules: AuditRule[], snap: AccountSnapshot, siteId: string): Promise<RawResult[]> {
    if (allRules.length === 0) return [];

    // Hesaptan hicbir sey okunamadiysa model hic cagrilmaz: tum kurallar "veri okunamadı"
    if (!hasAccountData(snap)) {
      this.log.warn(`[${siteId}] Hesaptan veri okunamadı — ${allRules.length} LLM kuralı atlandı`);
      return allRules.map(r => ({
        rule: r,
        verdict: 'na' as Verdict,
        finding: NO_DATA_FINDING,
        recommendation: CONNECT_HINT,
        noData: true,
      }));
    }

    // requires'i olan LLM kurali (G05 kampanya adlari vb.) verisi yoksa modele gitmez
    const gated: RawResult[] = [];
    const rules: AuditRule[] = [];
    for (const r of allRules) {
      const gap = requirementResult(r, snap);
      if (gap) gated.push(gap);
      else rules.push(r);
    }
    if (rules.length === 0) return gated;

    // Snapshot'ın kullanışlı içerik düzeyini ölç — boş hesapsa LLM'e bedava sormaya gerek yok
    const totalDataPoints =
      (snap.campaigns?.length ?? 0) +
      (snap.metaCampaigns?.length ?? 0) +
      (snap.searchTerms?.length ?? 0) +
      (snap.campaignNamingSamples?.length ?? 0) +
      (snap.adCopySamples?.length ?? 0) +
      (snap.pmaxCampaigns?.length ?? 0) +
      (snap.landingPageThemes?.length ?? 0);

    if (totalDataPoints < 3) {
      this.log.warn(`Snapshot çok seyrek (${totalDataPoints} data point) — tüm LLM kuralları "na" döndürülüyor`);
      return [...gated, ...rules.map(r => ({
        rule: r,
        verdict: 'na' as Verdict,
        finding: 'Hesapta değerlendirilecek kadar kampanya verisi yok — değerlendirme atlandı',
        recommendation: '',
      }))];
    }

    const out: RawResult[] = [...gated];
    // Paralel batch: 5'erli (Anthropic rate limit'e dikkat)
    const BATCH_SIZE = 5;
    // Maliyet freni: harcanan + (bir sonraki partinin gorulen en pahali cagriyla tahmini) tavani
    // asacaksa durulur; kalan kurallar modele gitmez. Ilk parti tahminsiz gider (5 kisa cagri).
    const tavan = adsAuditMaxUsd();
    let harcanan = 0;
    let enPahali = 0;
    for (let i = 0; i < rules.length; i += BATCH_SIZE) {
      const chunk = rules.slice(i, i + BATCH_SIZE);
      if (i > 0 && harcanan + chunk.length * enPahali > tavan) {
        this.log.warn(`[${siteId}] Denetim maliyet tavani (${tavan} USD): ${harcanan.toFixed(2)} USD harcandi, ${rules.length - i} kural degerlendirilmedi`);
        out.push(...rules.slice(i).map((rule) => ({ rule, verdict: 'na' as const, finding: COST_CAP_FINDING, recommendation: '' })));
        break;
      }
      const results = await Promise.all(chunk.map(r => this.judgeOne(r, snap, siteId)));
      for (const r of results) {
        harcanan += r.costUsd ?? 0;
        enPahali = Math.max(enPahali, r.costUsd ?? 0);
      }
      out.push(...results.map(({ costUsd: _c, ...r }) => r));
      this.log.debug(`LLM batch ${i / BATCH_SIZE + 1}/${Math.ceil(rules.length / BATCH_SIZE)} tamamlandı`);
    }
    this.log.log(`[${siteId}] Denetim model asamasi: ${harcanan.toFixed(2)} USD (tavan ${tavan})`);
    return out;
  }

  private async judgeOne(rule: AuditRule, snap: AccountSnapshot, siteId: string): Promise<RawResult & { costUsd?: number }> {
    if (!rule.llm || !rule.llmPrompt) {
      return { rule, verdict: 'na', finding: 'LLM prompt yok', recommendation: '' };
    }
    const prompt = rule.llmPrompt(snap);
    try {
      const result = await this.llm.chat({
        context: 'ads-audit-llm',
        siteId,
        model: adsAuditModel(),
        systemPrompt: JUDGE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: prompt }],
        // Thinking'li modellerde tavan cevap + dusunmeyi birlikte sinirlar
        // (LLMProviderService tabani 4000); kisa siniflandirma icin dusuk efor.
        maxTokens: 4000,
        effort: 'low',
      });
      const json = parseJsonFromLlm<any>(result.output);
      if (!json || typeof json !== 'object' || Array.isArray(json)) {
        return { rule, verdict: 'na', finding: `LLM değerlendirme hatası`, recommendation: '', costUsd: result.costUsd };
      }
      return {
        costUsd: result.costUsd,
        rule,
        verdict: normalizeVerdict(json.verdict),
        finding: typeof json.finding === 'string' ? json.finding.slice(0, 600) : '',
        recommendation: typeof json.recommendation === 'string' ? json.recommendation.slice(0, 600) : '',
      };
    } catch (err: any) {
      this.log.warn(`LLM rule ${rule.id} hatası: ${err.message}`);
      return { rule, verdict: 'na', finding: `LLM değerlendirme hatası`, recommendation: '' };
    }
  }
}
