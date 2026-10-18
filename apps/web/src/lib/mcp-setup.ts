/**
 * MCP kurulum kartinin (components/mcp-setup-card.tsx) yetki rehberi — saf, test edilir
 * (mcp-setup.spec.mts).
 *
 * NEDEN veri: kart "makale uretimi icin makale yazma yetkisi ver" diyordu; oysa
 * firsattan makale ureten generate_article_from_opportunity 'audit:write' ister (REST
 * ikizi POST /sites/:siteId/audit/opportunities/:id/generate), yalniz create_article
 * 'articles:write' ister (api mcp/mcp-tools.service.ts ToolDef.scope). Karta guvenip
 * yalniz Icerikler → Yazma secen musteri MCP'de '"audit:write" yetkisi yok' hatasi aliyor,
 * anahtar yetkileri sonradan degistirilemedigi icin yeni anahtar uretmek zorunda kaliyordu
 * (inceleme S23). Spec bu listeyi public/agent-setup.txt "Yetkiler" maddesiyle ve
 * mcp-tools.service.ts'teki gercek scope'larla karsilastirir; arac ya da scope degisirse
 * kirilir. Etiketler API Anahtarlari sayfasindaki satir adlariyla ayni
 * (app/(dashboard)/api-keys/page.tsx RESOURCE_LABEL).
 */

export interface McpWriteScopeGuide {
  scope: string;
  /** API Anahtarlari sayfasindaki satir → Yazma */
  label: string;
  /** Kullaniciya anlatilan isler (Turkce) */
  uses: string;
  /** Bu yetkiyi isteyen YAZMA araclari */
  tools: readonly string[];
}

export const MCP_WRITE_SCOPE_GUIDE: readonly McpWriteScopeGuide[] = [
  {
    scope: 'audit:write',
    label: 'Site denetimi → Yazma',
    uses: 'denetim ve ajan hazırlığı taraması başlatma, AI görünürlük ölçümü, fırsat taraması, fırsattan makale üretimi ve görsel alt metni önerisi',
    tools: ['run_audit', 'run_agent_readiness_scan', 'run_prompt', 'derive_content_opportunities', 'generate_article_from_opportunity', 'suggest_image_alts'],
  },
  {
    scope: 'articles:write',
    label: 'İçerikler → Yazma',
    uses: 'konu vererek makale üretimi (create_article)',
    tools: ['create_article'],
  },
];

/** Herhangi bir "Yazma" yetkisiyle calisan yazma araclari (aksiyon plani) */
export const MCP_ANY_WRITE_TOOLS: readonly string[] = ['add_action_plan_item', 'update_action_plan_item'];

/** Kartin 1. adimindaki yetki cumlesi */
export function mcpScopeGuideText(): string {
  const parcalar = MCP_WRITE_SCOPE_GUIDE.map((g) => `${g.uses} için ${g.label}`);
  return `Her araç REST karşılığıyla aynı yetkiyi ister: ${parcalar.join('; ')} yetkisi ver. Aksiyon planına yazmak için herhangi bir Yazma yetkisi yeterli.`;
}
