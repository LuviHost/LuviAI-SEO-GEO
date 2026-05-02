/**
 * Rule Factory — claude-ads markdown'ından parse edilen JSON kurallarını
 * LLM-judge bazlı AuditRule object'lerine çevirir.
 *
 * Mevcut deterministik kurallar (google-rules.ts, meta-rules.ts) ID bazında
 * override eder; aynı ID'ye sahip JSON kuralı atlanır.
 */
import type { AuditRule, GoogleCategory, MetaCategory, Severity, AccountSnapshot, Verdict } from './types.js';
import { ALL_RULES_DATA } from './data/rules-data.js';

const rulesJson: { google: any[]; meta: any[] } = ALL_RULES_DATA as any;

interface JsonRule {
  id: string;
  name: string;
  severity: string;
  category: string;
  pass: string;
  warning: string;
  fail: string;
  fixTimeMinutes?: number;
}

const SEVERITY_NORMALIZE: Record<string, Severity> = {
  critical: 'critical', high: 'high', medium: 'medium', low: 'low',
};

/**
 * JSON kuralından AuditRule üretir — check() null döner, llmPrompt JSON tabanlı
 * pass/warning/fail kriterlerini Claude'a sorar.
 */
function jsonToAuditRule<C>(json: JsonRule, platform: 'google' | 'meta'): AuditRule<C> {
  const severity = SEVERITY_NORMALIZE[json.severity] ?? 'medium';

  return {
    id: json.id,
    name: json.name,
    category: json.category as any,
    severity,
    fixTimeMinutes: json.fixTimeMinutes,
    check: () => null, // Tamamen LLM tabanlı
    llm: true,
    llmPrompt: (snap: AccountSnapshot) => buildPromptFromCriteria(json, snap, platform),
  };
}

function buildPromptFromCriteria(json: JsonRule, snap: AccountSnapshot, platform: 'google' | 'meta'): string {
  // Snapshot'ı küçük + alakalı bir JSON dump olarak ver
  const trimmedSnap = trimSnapshotForPrompt(snap, platform);

  return `Sen bir reklam hesabı denetçisisin. Aşağıdaki tek bir audit kuralını değerlendir ve PASS/WARNING/FAIL/N/A kararı ver.

KURAL: ${json.id} — ${json.name}
KATEGORİ: ${json.category}
SEVERITY: ${json.severity}

KRİTERLER:
- PASS: ${json.pass}
- WARNING: ${json.warning}
- FAIL: ${json.fail}

HESAP SNAPSHOT'I:
${JSON.stringify(trimmedSnap, null, 2)}

KURAL:
- Snapshot'ta bu kuralı değerlendirecek veri YOKSA "na" döndür.
- Snapshot'ta belirsizse en kötü senaryoyu değil EN OLASI senaryoyu seç.
- recommendation Türkçe ve aksiyon-odaklı olmalı (max 30 kelime).
- finding 1-2 cümle, hangi göstergeyi gördüğünü/göremediğini söyle.

ÇIKTI: SADECE JSON döndür, başka hiçbir metin yazma.
{"verdict": "pass" | "warning" | "fail" | "na", "finding": "...", "recommendation": "..."}`;
}

function trimSnapshotForPrompt(snap: AccountSnapshot, platform: 'google' | 'meta'): any {
  // Çok büyük snapshot'ı küçült: campaigns first 5, samples first 10 vs.
  const trimmed: any = { monthlySpendUsd: snap.monthlySpendUsd };

  if (platform === 'google') {
    if (snap.campaigns) trimmed.campaigns = snap.campaigns.slice(0, 5);
    if (snap.pmaxCampaigns) trimmed.pmaxCampaigns = snap.pmaxCampaigns.slice(0, 3);
    if (snap.searchTerms) trimmed.searchTermsSample = snap.searchTerms.slice(0, 10);
    if (snap.negativeKeywordLists) trimmed.negativeKeywordLists = snap.negativeKeywordLists;
    if (snap.conversionActions) trimmed.conversionActions = snap.conversionActions;
    trimmed.enhancedConversionsActive = snap.enhancedConversionsActive;
    trimmed.consentModeV2 = snap.consentModeV2;
    trimmed.ga4Linked = snap.ga4Linked;
    trimmed.searchTermLastReviewedAt = snap.searchTermLastReviewedAt;
    if (snap.campaignNamingSamples) trimmed.campaignNamingSamples = snap.campaignNamingSamples.slice(0, 10);
    if (snap.adCopySamples) trimmed.adCopySamples = snap.adCopySamples.slice(0, 8);
    if (snap.landingPageThemes) trimmed.landingPageThemes = snap.landingPageThemes.slice(0, 5);
  } else {
    if (snap.metaCampaigns) {
      trimmed.metaCampaigns = snap.metaCampaigns.slice(0, 3).map(c => ({
        ...c,
        adSets: c.adSets?.slice(0, 3),
      }));
    }
    trimmed.pixel = snap.pixel;
    trimmed.capi = snap.capi;
    trimmed.emq = snap.emq;
    trimmed.aem = snap.aem;
    trimmed.attributionWindow = snap.attributionWindow;
    trimmed.domainVerified = snap.domainVerified;
  }

  return trimmed;
}

/**
 * JSON'dan +deterministik mevcut kurallardan birleşik kural listesi.
 * Mevcut deterministik kurallar override eder (aynı ID).
 */
export function buildFullRuleSet<C>(
  manualRules: AuditRule<C>[],
  platform: 'google' | 'meta',
): AuditRule<C>[] {
  const manualIds = new Set(manualRules.map(r => r.id));
  const jsonRules = (platform === 'google' ? (rulesJson as any).google : (rulesJson as any).meta) as JsonRule[];
  const llmRules: AuditRule<C>[] = jsonRules
    .filter(j => !manualIds.has(j.id))
    .map(j => jsonToAuditRule<C>(j, platform));

  // Severity sırasına: critical → high → medium → low (audit run sırası önemli)
  const severityOrder: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const all = [...manualRules, ...llmRules];
  all.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  return all;
}
