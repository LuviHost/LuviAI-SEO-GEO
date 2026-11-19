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
- Snapshot yalnız hesaptan OKUNAN alanları içerir; burada olmayan alan bilinmiyor demektir (kapalı/yok DEĞİL).
- Snapshot'ta bu kuralı değerlendirecek veri YOKSA "na" döndür.
- Tutarlar hesabın para birimindedir (currency); monthlySpendUsd yalnız hesap USD ise vardır.
- Snapshot'ta belirsizse en kötü senaryoyu değil EN OLASI senaryoyu seç.
- recommendation Türkçe ve aksiyon-odaklı olmalı (max 30 kelime).
- finding 1-2 cümle, hangi göstergeyi gördüğünü/göremediğini söyle.

ÇIKTI: SADECE JSON döndür, başka hiçbir metin yazma.
{"verdict": "pass" | "warning" | "fail" | "na", "finding": "...", "recommendation": "..."}`;
}

/** Yalniz tanimli (hesaptan okunmus) alanlar; undefined anahtar hic yazilmaz */
function definedOnly(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));
}

/**
 * LLM'e giden kucuk snapshot. YALNIZ hesaptan okunmus alanlar girer: eskiden
 * toplayicinin uydurdugu varsayilanlar ('people_in', adStrength 'average',
 * sitelink 0 ...) modele gercek veri gibi gidiyordu.
 */
export function trimSnapshotForPrompt(snap: AccountSnapshot, platform: 'google' | 'meta'): Record<string, unknown> {
  const common = {
    currency: snap.currency,
    monthlySpend: snap.monthlySpend,
    monthlySpendUsd: snap.monthlySpendUsd,
  };

  if (platform === 'google') {
    return definedOnly({
      ...common,
      campaigns: snap.campaigns?.slice(0, 5).map(c => definedOnly(c as Record<string, unknown>)),
      pmaxCampaigns: snap.pmaxCampaigns?.slice(0, 3),
      searchTermsSample: snap.searchTerms?.slice(0, 10),
      negativeKeywordLists: snap.negativeKeywordLists,
      conversionActions: snap.conversionActions,
      enhancedConversionsActive: snap.enhancedConversionsActive,
      consentModeV2: snap.consentModeV2,
      ga4Linked: snap.ga4Linked,
      searchTermLastReviewedAt: snap.searchTermLastReviewedAt,
      campaignNamingSamples: snap.campaignNamingSamples?.slice(0, 10),
      adCopySamples: snap.adCopySamples?.slice(0, 8),
      landingPageThemes: snap.landingPageThemes?.slice(0, 5),
    });
  }
  return definedOnly({
    ...common,
    metaCampaigns: snap.metaCampaigns?.slice(0, 3).map(c => definedOnly({
      ...c,
      adSets: c.adSets?.slice(0, 3),
    })),
    pixel: snap.pixel,
    capi: snap.capi,
    emq: snap.emq,
    aem: snap.aem,
    attributionWindow: snap.attributionWindow,
    domainVerified: snap.domainVerified,
  });
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
