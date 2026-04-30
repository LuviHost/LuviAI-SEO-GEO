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
    default: 'claude-sonnet-4-6',
    description: 'Yazar ajaninin kullanacagi Anthropic modeli.',
    envFallback: true,
    enumValues: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  },
  {
    key: 'EDITOR_MODEL',
    type: 'enum',
    category: 'model',
    default: 'claude-opus-4-7',
    description: 'Editor ajaninin kullanacagi Anthropic modeli.',
    envFallback: true,
    enumValues: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  },
  {
    key: 'ROUTING_MODEL',
    type: 'enum',
    category: 'model',
    default: 'claude-haiku-4-5-20251001',
    description: 'Routing/topic engine icin hizli/ucuz model.',
    envFallback: true,
    enumValues: ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
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
