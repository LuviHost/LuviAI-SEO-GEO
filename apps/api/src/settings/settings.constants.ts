/**
 * SETTINGS_CATALOG — admin panelden yonetilen runtime ayarlari.
 *
 * Kategoriler:
 *  - toggle: operasyonel anahtarlar (AI_GLOBAL_DISABLED, ARTICLE_GENERATION_DISABLED)
 *            ve satis / intel ayarlari (SATIS_RANDEVU_URL, INTEL_DIGEST_TO)
 *  - model:  AI model secimleri (MODEL_ANON, MODEL_MEMBER, MODEL_INTEL_*);
 *            makale ajan modelleri yalniz env — bkz. "AI model secimi" notu
 *  - env:    YALNIZ .env — kodun dogrudan process.env'den okudugu degerler.
 *            Panel bunlari SALT OKUNUR gosterir (envOnly), degistirilemez.
 *
 * envFallback: DB de kayit yoksa process.env den okunur (geriye donuk uyumluluk).
 * default: ne env ne db de varsa bu kullanilir. envOnly anahtarda default,
 *          KODUN kendi varsayilaniyla ayni olmak zorunda (settings-catalog-honesty.spec).
 *
 * KURAL: buraya yalniz bir kodun GERCEKTEN okudugu anahtar girer. Panelde
 * gorunup hicbir yere baglanmayan ayar, admini "degistirdim" diye yaniltir.
 * settings-catalog-honesty.spec.ts her DB anahtarinin kodda okundugunu, kodun
 * ayardan okudugu her anahtarin da katalogda oldugunu denetler.
 *
 * KATALOGDAN CIKARILANLAR (2026-10) — hicbiri hicbir yerde ayardan okunmuyordu:
 *  - FEATURE_PAYMENT_REQUIRED, FEATURE_AUTO_FIRST_ARTICLE, FEATURE_WHITE_LABEL,
 *    FEATURE_PUBLIC_API, FEATURE_MULTI_LANG, GEO_OPTIMIZER_ENABLED, DEBUG,
 *    LOG_LEVEL: kodda tek okuyani yok; acip kapatmak hicbir seyi degistirmiyordu.
 *  - PLAN_*_PRICE / _ARTICLES / _SITES: fiyat ve kotalar billing/plans.ts'ten
 *    (BASE_PLANS) ve QuotaService.LIMITS'ten gelir. PLAN_TRIAL_DAYS: deneme
 *    suresi QuotaService.startTrial'da 14 gun sabit.
 *  - SPEND_CAP_*_USD / SPEND_CAP_ENABLED: tavanlar QuotaService.SPEND_CAP_USD
 *    (ve admin gorunumunde admin.controller) sabit haritasindan okunur;
 *    "kill-switch" diye listelenen SPEND_CAP_ENABLED'in kodda karsiligi yoktu.
 * Eski app_settings satirlari zararsiz kalir: listAll yalniz bu katalogu dolasir.
 * Biri gercekten panelden yonetilsin istenirse once okuyan kod yazilmali,
 * sonra buraya geri eklenmeli.
 */
export type SettingType = 'boolean' | 'int' | 'string' | 'enum';
export type SettingCategory = 'toggle' | 'model' | 'env';

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
  /**
   * Deger YALNIZ process.env'den okunur; DB satiri yok sayilir, panelden
   * yazilamaz (SettingsService.set 400 doner), acilista DB'ye tohumlanmaz.
   *
   * NEDEN: PAYTR_TEST_MODE gibi anahtarlar katalogda duzenlenebilir
   * listeleniyordu ama kod onlari process.env'den okuyordu (paytr.service
   * kurulurken). Admin panelden "test modu acik" gorup canli odeme alindigini
   * bilmeyebilirdi. Deger artik kodun gercekten kullandigi kaynaktan gosterilir.
   */
  envOnly?: boolean;
}

export const SETTINGS_CATALOG: SettingMeta[] = [
  // Operasyonel toggle
  {
    key: 'AI_GLOBAL_DISABLED',
    type: 'boolean',
    category: 'toggle',
    default: '0',
    // Kapsam elle dogrulandi: anahtari okuyan yerler worker isleri (Brain,
    // konu motoru, llms-full, gorsel alt metni, takili sayfa kurtarma),
    // pipeline (mock makale), ai-citation runForSite/runQueries, geo-heatmap,
    // chat, image-generator ve LLMProviderService. SDK'yi dogrudan cagiran
    // servisler (runPublicProbes, translator, persona-chat, snippet-generator,
    // niche-detector, screenshot gorselleri...) OKUMAZ — "tum AI cagrilari
    // kapanir" yazmak acil durumda admini yaniltirdi.
    description: 'Test / acil durum anahtarı. 1 iken makale hattı gerçek AI yerine örnek (mock) makale üretir; Brain, konu motoru, llms-full, görsel alt metni ve takılı sayfa kurtarma işleri atlanır; site AI görünürlük ölçümü, Prompt Lab, GEO ısı haritası, panel sohbeti, görsel üretimi ve ortak LLM katmanından (LLMProviderService) geçen çağrılar durur. Tüm AI harcamasını durdurmaz: SDK\'yı doğrudan çağıran servisler (ör. herkese açık AI kontrolü, çeviri, persona sohbet widget\'ı, snippet üretimi, niş tespiti, ekran görüntüsü stüdyosu görselleri) bu anahtarı okumaz.',
    envFallback: true,
    hot: true,
  },
  {
    key: 'ARTICLE_GENERATION_DISABLED',
    type: 'boolean',
    category: 'toggle',
    default: '0',
    description: 'Test anahtarı. 1 iken onboarding\'in ilk makale takvimi, GENERATE_ARTICLE ve PROCESS_SCHEDULED işleri atlanır (makaleler SCHEDULED durumunda bekler); makale üretimine bağlı LLM ve görsel harcaması durur. Diğer AI işlerini etkilemez.',
    envFallback: true,
    hot: true,
  },
  {
    key: 'SATIS_RANDEVU_URL',
    type: 'string',
    category: 'toggle',
    default: '',
    // Okuyan yerler yalniz kurum karnesi: prospect/karne.service.ts (panel) ve
    // cli/prospect-karne.ts. Eski metin "LinkedIn mesajlarina eklenir" diyordu;
    // linkedin-outreach bu anahtari okumuyor.
    description: 'Satış görüşmesi randevu linki (Cal.com/Calendly). Doluysa ücretsiz kurum karnesinin kapanış satırına eklenir (panel ve karne CLI\'ı); boşsa o cümle metinden düşer.',
    envFallback: true,
  },
  {
    key: 'INTEL_DIGEST_TO',
    type: 'string',
    category: 'toggle',
    default: '',
    // intel/digest.service.ts sendEmail bu anahtari settings.getString ile
    // okuyordu ama katalogda YOKTU: getRaw bilinmeyen anahtarda hata atiyor,
    // `.catch(() => null)` yutuyor ve her seferinde env'e dusuluyordu (eski
    // MODEL_INTEL_* hatasinin aynisi). envFallback BILEREK false: satir bos
    // tohumlanir, bos deger env'e duser — env'den okuyan bugunku davranis
    // aynen kalir; panelden yazilan deger env'in onune gecer.
    description: 'İstihbarat (intel) özet e-postasının alıcısı. Boşsa sunucudaki INTEL_DIGEST_TO ortam değişkeni kullanılır; o da yoksa özet yalnız panelde kalır.',
    envFallback: false,
  },

  // AI model secimi
  //
  // WRITER_MODEL / EDITOR_MODEL / ROUTING_MODEL BILEREK BURADA YOK — yalniz
  // ortam degiskeni (.env). Makale ajanlari modeli process.env'den okur
  // (articles/agent-runner.service.ts resolveModel; ROUTING_MODEL ayrica
  // sites/brain-generator.service.ts). Bu uc anahtar katalogda "varsayilan
  // claude-opus-5" diye listeleniyordu ama hicbir kod onlari ayardan okumuyordu:
  // panelde gorunen deger kullanilan model degildi, degistirmek etkisizdi.
  // Ajanin ayari okumasi yerine katalogdan cikarildi, cunku DB'deki satirlar
  // ilk acilista env'den ya da katalog varsayilanindan (claude-opus-5) tohumlandi
  // ve sonradan elle degismis olabilir: okumaya baslamak uretimdeki modeli
  // (dolayisiyla maliyeti) sessizce degistirebilirdi. Eski app_settings
  // satirlari zararsiz kalir; listAll yalniz bu katalogu dolasir.
  // Panelden yonetilsin istenirse: once DB degerleri dogrulanmali, sonra
  // ajan ayari env'den ONCE okumali ve buraya geri eklenmeli.
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
    // modelForAudience(…, 'member') cagiranlari: sites.controller detect-niche
    // (onboarding) ve public-citation.service'in signup_baseline yolu (nis
    // tespiti + classifyRealCompetitors). Eski metindeki "dashboard" cagrisi yok.
    description: 'Giriş yapmış kullanıcının tetiklediği iki çağrının modeli: onboarding niş tespiti ve kayıt sonrası ilk AI kontrolündeki niş tespiti ile rakip filtresi. Makale ajanlarının, Brain\'in ve ölçülen asistanların modelini değiştirmez.',
    envFallback: true,
    enumValues: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
  },
  // ─── INTEL BORU HATTI MODELLERI ──────────────────────────────────────
  // triage.service.ts ve analyst.service.ts bu anahtarlari okuyor ama
  // katalogda KAYITLI DEGILLERDI: getRaw bilinmeyen anahtarda hata firlatiyor,
  // cagri yerindeki `.catch(() => null)` onu yutuyor ve sessizce kod
  // fallback'ine dusuluyordu. Yani app_settings'e elle yazilan deger hicbir
  // zaman okunmuyordu — panelden model degistirmek imkansizdi.
  {
    key: 'MODEL_INTEL_TRIAGE',
    type: 'enum',
    category: 'model',
    default: 'claude-opus-5',
    description: 'Intel triage (ucuz eleme) modeli. Yanlis eleme SESSIZ korluk yaratir — elenen kayit analiste hic ulasmaz — bu yuzden gunde ~10 cagrilik hacimde kalite tercih ediliyor.',
    envFallback: true,
    enumValues: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
  },
  {
    key: 'MODEL_INTEL_ANALYST',
    type: 'enum',
    category: 'model',
    default: 'claude-opus-5',
    description: 'Intel analist modeli — tam metinden dogrulanabilir iddia ve kanit cinsi cikarir. Boru hattinin en pahali ve en kalite-hassas ucu.',
    envFallback: true,
    enumValues: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'],
  },

  // ─── YALNIZ .env (SALT OKUNUR) ───────────────────────────────────────
  // Bu dort anahtar katalogda DUZENLENEBILIR listeleniyordu ama kod onlari
  // yalniz process.env'den okuyor; panelden yazilan deger hicbir yere
  // ulasmiyordu. Silmek yerine salt okunur tutuldu: panel, kodun gercekten
  // kullandigi degeri (env ya da kodun varsayilani) gostersin — ozellikle
  // PayTR'nin test mi canli mi oldugu operasyonel olarak bilinmeli.
  // default = kodun varsayilani (settings-catalog-honesty.spec denetler).
  {
    key: 'PAYTR_TEST_MODE',
    type: 'boolean',
    category: 'env',
    default: '1',
    // PayTR dokumani (18.10.2026'da dogrulandi,
    // https://dev.paytr.com/iframe-api/iframe-api-1-adim): test_mode "Mağaza
    // canlı modda iken test işlem yapmak için 1 olarak gönderilebilir".
    // paytr.service degeri ham haliyle test_mode'a koyar; devConfirmPayment
    // yalniz '1' iken calisir.
    // Satin alma kapisi (paytr.service testModeOn / assertCheckoutOpen /
    // isRefusedTestPayment / chargeStoredCard): '0' disindaki her deger test
    // sayilir, yalniz ADMIN odeme baslatir, test odemesi yonetici olmayan hesapta
    // plan acmaz (fatura FAILED), kayitli karttan yenileme denenmez; PayTR
    // bildirimindeki test_mode=1 da ayni karari verdirir. NEDEN BURADA: panel bu
    // metni gosteriyor; admin "test modu acik" gorunce yalniz deneme odemesi
    // olacagini degil, musterilerin satin alamadigini da bilmeli.
    // paytr-test-mode-description.spec.ts metni bu kod kosullarina baglar.
    description: 'PayTR ödeme isteğindeki test_mode değeri: 1 = test işlemi (mağaza canlı moddayken bile), 0 = mağazanın kendi modu (canlı mağazada gerçek ödeme). paytr.service değeri yalnız ortam değişkeninden okur; .env\'de yoksa 1. Test modu açıkken (0 dışındaki her değer) yalnız yönetici hesapları satın alma başlatabilir; test ödemeleri yönetici olmayan hiçbir hesapta plan açmaz (fatura başarısız sayılır) ve kayıtlı karttan otomatik yenileme denenmez. PayTR bildirimi işlemi test olarak işaretlerse (mağaza henüz canlıya alınmadıysa) değer 0 olsa da test ödemesi yönetici olmayan hesapta plan açmaz. Test onayı ucu (dev-confirm) yalnız değer tam olarak 1 iken ve yalnız yönetici hesaplarında çalışır.',
    envFallback: false,
    envOnly: true,
  },
  {
    key: 'IMAGE_PROVIDER',
    type: 'string',
    category: 'env',
    default: 'gemini-flash',
    // Eski kayit enum ['gemini','dalle','midjourney','none'] listeliyordu;
    // image-generator.service dispatchProvider bunlarin hicbirini tanimiyor.
    description: 'Makale görsel üreticisi (image-generator.service). Geçerli değerler: gemini-flash, gemini-pro, gpt-image-1, gpt-image-1-mini, flux-pro, ideogram-v3. Birincil üretici başarısız olursa gemini-flash\'a düşer.',
    envFallback: false,
    envOnly: true,
  },
  {
    key: 'RATE_LIMIT_WINDOW_MS',
    type: 'int',
    category: 'env',
    default: '60000',
    description: 'Genel istek sınırının penceresi (ms), IP başına. API açılışında ThrottlerModule\'e bir kez okunur; kendi sınırı olan uçlar ayrı sayılır.',
    envFallback: false,
    envOnly: true,
  },
  {
    key: 'RATE_LIMIT_MAX',
    type: 'int',
    category: 'env',
    default: '60',
    description: 'Genel istek sınırında pencere başına IP başına izin verilen istek sayısı. API açılışında bir kez okunur.',
    envFallback: false,
    envOnly: true,
  },
];

export const SETTINGS_KEYS = SETTINGS_CATALOG.map((s) => s.key);
export const SETTINGS_BY_KEY = new Map<string, SettingMeta>(
  SETTINGS_CATALOG.map((s) => [s.key, s]),
);
