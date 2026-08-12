/**
 * SETTINGS_CATALOG — admin panelden yonetilen tum runtime ayarlari.
 *
 * Kategoriler:
 *  - toggle: boolean on/off (FEATURE_*, ARTICLE_GENERATION_DISABLED, vb.)
 *  - plan:   plan fiyat/kota/limit (PLAN_*_PRICE, PLAN_TRIAL_DAYS)
 *  - model:  AI model secimleri (WRITER_MODEL, IMAGE_PROVIDER)
 *  - limit:  rate limit / quota
 *  - log:    LOG_LEVEL, DEBUG
 *
 * envFallback: DB de kayit yoksa process.env den okunur (geriye donuk uyumluluk).
 * default: ne env ne db de varsa bu kullanilir.
 */
export type SettingType = 'boolean' | 'int' | 'string' | 'enum';
export type SettingCategory = 'toggle' | 'plan' | 'model' | 'limit' | 'log';

export interface SettingMeta {
  key: string;
  type: SettingType;
  category: SettingCategory;
  default: string;
  description: string;
  envFallback: boolean;
  enumValues?: string[];
  /** Bu ayar degisince worker un job env i guncellenmeli mi? */
  hot?: boolean;
}

export const SETTINGS_CATALOG: SettingMeta[] = [
  // Operasyonel toggle
  {
    key: 'AI_GLOBAL_DISABLED',
    type: 'boolean',
    category: 'toggle',
    default: '0',
    description: 'TEST: 1 = TUM AI cagrilari (Anthropic / OpenAI / Gemini) kapanir. Brain, Topic engine, Article generation, AI citation, LLMS-full build hepsi no-op olur. UI mock veriyle calisir.',
    envFallback: true,
    hot: true,
  },
  {
    key: 'ARTICLE_GENERATION_DISABLED',
    type: 'boolean',
    category: 'toggle',
    default: '0',
    description: 'TEST: 1 = onboarding chain article scheduling + GENERATE_ARTICLE + PROCESS_SCHEDULED kapanir. LLM/image API harcamasi durur.',
    envFallback: true,
    hot: true,
  },
  {
    key: 'PAYTR_TEST_MODE',
    type: 'boolean',
    category: 'toggle',
    default: '1',
    description: 'PayTR odeme test modu. 1 = test, 0 = canli.',
    envFallback: true,
  },
  {
    key: 'FEATURE_PAYMENT_REQUIRED',
    type: 'boolean',
    category: 'toggle',
    default: 'false',
    description: 'true = kullanici plan satin almadan makale uretemez.',
    envFallback: true,
  },
  {
    key: 'FEATURE_AUTO_FIRST_ARTICLE',
    type: 'boolean',
    category: 'toggle',
    default: 'true',
    description: 'true = onboarding sonrasi tier-1 ilk makale otomatik uretime girer.',
    envFallback: true,
  },
  {
    key: 'FEATURE_WHITE_LABEL',
    type: 'boolean',
    category: 'toggle',
    default: 'false',
    description: 'true = ajans icin white-label modu acilir.',
    envFallback: true,
  },
  {
    key: 'FEATURE_PUBLIC_API',
    type: 'boolean',
    category: 'toggle',
    default: 'false',
    description: 'true = harici API anahtariyla makale uretimi (api-keys modulu) acilir.',
    envFallback: true,
  },
  {
    key: 'FEATURE_MULTI_LANG',
    type: 'boolean',
    category: 'toggle',
    default: 'true',
    description: 'true = tr/en disinda dilde makale uretimi.',
    envFallback: true,
  },
  {
    key: 'GEO_OPTIMIZER_ENABLED',
    type: 'boolean',
    category: 'toggle',
    default: 'false',
    description: 'true = GEO CLI uzerinden ek optimizasyon adimlari calisir.',
    envFallback: true,
  },

  // Loglama
  {
    key: 'DEBUG',
    type: 'boolean',
    category: 'log',
    default: 'false',
    description: 'Detayli debug log u acar (verbose pipeline + AI istek body si).',
    envFallback: true,
  },
  {
    key: 'LOG_LEVEL',
    type: 'enum',
    category: 'log',
    default: 'info',
    description: 'Worker/API log seviyesi.',
    envFallback: true,
    enumValues: ['error', 'warn', 'info', 'debug', 'verbose'],
  },

  // Plan & limit
  {
    key: 'PLAN_TRIAL_DAYS',
    type: 'int',
    category: 'plan',
    default: '14',
    description: 'TRIAL plan suresi (gun).',
    envFallback: true,
  },
  {
    key: 'PLAN_STARTER_PRICE',
    type: 'int',
    category: 'plan',
    default: '499',
    description: 'STARTER plan aylik fiyat (TL).',
    envFallback: true,
  },
  {
    key: 'PLAN_STARTER_ARTICLES',
    type: 'int',
    category: 'plan',
    default: '10',
    description: 'STARTER plan aylik makale kotasi.',
    envFallback: true,
  },
  {
    key: 'PLAN_STARTER_SITES',
    type: 'int',
    category: 'plan',
    default: '1',
    description: 'STARTER plan max site sayisi.',
    envFallback: true,
  },
  {
    key: 'PLAN_PRO_PRICE',
    type: 'int',
    category: 'plan',
    default: '1299',
    description: 'PRO plan aylik fiyat (TL).',
    envFallback: true,
  },
  {
    key: 'PLAN_PRO_ARTICLES',
    type: 'int',
    category: 'plan',
    default: '50',
    description: 'PRO plan aylik makale kotasi.',
    envFallback: true,
  },
  {
    key: 'PLAN_PRO_SITES',
    type: 'int',
    category: 'plan',
    default: '3',
    description: 'PRO plan max site sayisi.',
    envFallback: true,
  },
  {
    key: 'PLAN_AGENCY_PRICE',
    type: 'int',
    category: 'plan',
    default: '3299',
    description: 'AGENCY plan aylik fiyat (TL).',
    envFallback: true,
  },
  {
    key: 'PLAN_AGENCY_ARTICLES',
    type: 'int',
    category: 'plan',
    default: '250',
    description: 'AGENCY plan aylik makale kotasi.',
    envFallback: true,
  },
  {
    key: 'PLAN_AGENCY_SITES',
    type: 'int',
    category: 'plan',
    default: '10',
    description: 'AGENCY plan max site sayisi.',
    envFallback: true,
  },

  // ─── PLAN SPEND CAP (Cost Guard, 2026-05) ────────────────────────────
  // Plan basina aylik USD harcama tavani. Kullanici bu degeri asarsa pipeline
  // pause edilir + admin ve kullaniciya email gider. AI maliyetlerinin firma
  // pleyte kontrolu icin kritik. Default'lar realistic kullanim baz alindi.
  {
    key: 'SPEND_CAP_TRIAL_USD',
    type: 'int',
    category: 'plan',
    default: '3',
    description: 'TRIAL plan aylik max USD harcama (cost guard).',
    envFallback: false,
  },
  {
    key: 'SPEND_CAP_STARTER_USD',
    type: 'int',
    category: 'plan',
    default: '25',
    description: 'STARTER plan aylik max USD harcama (cost guard).',
    envFallback: false,
  },
  {
    key: 'SPEND_CAP_PRO_USD',
    type: 'int',
    category: 'plan',
    default: '80',
    description: 'PRO plan aylik max USD harcama (cost guard).',
    envFallback: false,
  },
  {
    key: 'SPEND_CAP_AGENCY_USD',
    type: 'int',
    category: 'plan',
    default: '200',
    description: 'AGENCY plan aylik max USD harcama (cost guard).',
    envFallback: false,
  },
  {
    key: 'SPEND_CAP_ENTERPRISE_USD',
    type: 'int',
    category: 'plan',
    default: '700',
    description: 'ENTERPRISE plan aylik max USD harcama (cost guard, ek aşımda contact sales).',
    envFallback: false,
  },
  {
    key: 'SPEND_CAP_ENABLED',
    type: 'boolean',
    category: 'plan',
    default: 'true',
    description: 'Cost guard aktif mi (false ise sinirsiz). Acil durum kill-switch.',
    envFallback: false,
  },

  {
    key: 'RATE_LIMIT_WINDOW_MS',
    type: 'int',
    category: 'limit',
    default: '60000',
    description: 'Rate limit penceresi (ms).',
    envFallback: true,
  },
  {
    key: 'RATE_LIMIT_MAX',
    type: 'int',
    category: 'limit',
    default: '60',
    description: 'Pencere icinde max istek sayisi.',
    envFallback: true,
  },

  // AI model secimi
  {
    key: 'WRITER_MODEL',
    type: 'enum',
    category: 'model',
    default: 'claude-opus-5',
    description: 'Yazar ajaninin kullanacagi Anthropic modeli.',
    envFallback: true,
    enumValues: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
  },
  {
    key: 'EDITOR_MODEL',
    type: 'enum',
    category: 'model',
    default: 'claude-opus-5',
    description: 'Editor ajaninin kullanacagi Anthropic modeli.',
    envFallback: true,
    enumValues: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
  },
  {
    key: 'ROUTING_MODEL',
    type: 'enum',
    category: 'model',
    default: 'claude-opus-5',
    description: 'Routing/topic engine modeli. Varsayilan Opus 5 (kalite tercihi); maliyet icin admin panelden Haiku secilebilir.',
    envFallback: true,
    enumValues: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
  },
  // ─── AUDIENCE MODEL TIER (2026-08) ───────────────────────────────────
  // Oturum acmamis ziyaretcinin tetikledigi AI cagrilari (landing citation
  // checker'in nis tespiti + rakip filtresi, persona chat widget'i) bedava
  // ve kimliksiz. Uye cagrilarindan ayri model kademesi:
  // NOT: citation probe'lari BU AYARDAN ETKILENMEZ — bkz. llm/model-tier.ts.
  {
    key: 'MODEL_ANON',
    type: 'enum',
    category: 'model',
    default: 'claude-haiku-4-5',
    description: 'Oturum acmamis ziyaretcinin tetikledigi AI cagrilari (landing checker nis tespiti, persona chat widget). Citation probe modelini DEGISTIRMEZ.',
    envFallback: true,
    enumValues: ['claude-haiku-4-5', 'claude-sonnet-5', 'claude-opus-5'],
  },
  {
    key: 'MODEL_MEMBER',
    type: 'enum',
    category: 'model',
    default: 'claude-opus-5',
    description: 'Giris yapmis kullanicinin AI cagrilari (onboarding nis tespiti, dashboard). Kalite tercihi.',
    envFallback: true,
    enumValues: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
  },
  {
    key: 'IMAGE_PROVIDER',
    type: 'enum',
    category: 'model',
    default: 'gemini',
    description: 'Hero/inline gorsel uretici.',
    envFallback: true,
    enumValues: ['gemini', 'dalle', 'midjourney', 'none'],
  },
];

export const SETTINGS_KEYS = SETTINGS_CATALOG.map((s) => s.key);
export const SETTINGS_BY_KEY = new Map<string, SettingMeta>(
  SETTINGS_CATALOG.map((s) => [s.key, s]),
);
