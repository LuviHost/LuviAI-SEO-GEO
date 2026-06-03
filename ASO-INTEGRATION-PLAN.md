# RanksUp · ASO Integration L-Paketi

**Hedef:** App Store sahibi kullanıcılar için end-to-end ASO otomasyonu:
1. Apple Search Ads (ASA) — bid yönetimi + organik rank boost
2. App Store Connect API — update tracking + release management
3. iOS SDK — remote rating prompt + analytics

**Tahmini süre:** 2-3 hafta (3 faz)

---

## FAZ 1 — Apple Search Ads (ASA) Entegrasyonu

**Süre:** 5-7 gün

### Backend
- [ ] Prisma model: `AsaAccount`, `AsaCampaign`, `AsaAdGroup`, `AsaKeywordBid`, `AsaPerformanceDaily`
- [ ] `apps/api/src/aso/asa/asa-api.client.ts` — JWT auth + REST wrapper
  - Auth: ES256 JWT (Issuer ID + Key ID + .p8 file) → Bearer token
  - Endpoints: `/v5/campaigns`, `/v5/adgroups`, `/v5/targetingkeywords`, `/v5/reports/campaigns`
- [ ] `asa-campaign.service.ts` — CRUD + bid stratejisi
  - Auto-bid: keyword popularity'sine göre $0.30-2.00 arası bid önerisi
  - Daily budget cap (kullanıcı belirler)
- [ ] `asa.controller.ts` — endpoint'ler:
  - `POST /aso/asa/connect` — service account credentials kaydet
  - `GET /aso/asa/accounts` — bağlı hesapları listele
  - `POST /aso/asa/campaigns` — yeni kampanya
  - `GET /aso/asa/campaigns/:id/keywords` — keyword'ler
  - `POST /aso/asa/keyword-bids/bulk` — toplu bid değişikliği
  - `GET /aso/asa/performance` — son 30 gün metrik
- [ ] Cron: `ASA_PERFORMANCE_DAILY` — her gün 02:00 UTC, son günkü metrikleri çek

### Frontend
- [ ] ASO sayfasında yeni **"Apple Search Ads"** tab'ı
- [ ] Connect screen: "App Store Connect → Keys → Search Ads API ile key oluştur" guide + 3 alan input (Org ID, Key ID, .p8 upload)
- [ ] Campaign list: AI önerili "Bu keyword'lere bid başlat" CTA + manuel ekleme
- [ ] Performance dashboard: chart (impressions, taps, installs, CPI)
- [ ] AI bid optimizer: günlük "şu keyword'ün bid'i çok yüksek, düşür" önerisi

### Test
- [ ] Demo Apple Search Ads hesabıyla smoke test
- [ ] Auto-bid simülasyonu

---

## FAZ 2 — App Store Connect API (Update Tracking + Release)

**Süre:** 4-5 gün

### Backend
- [ ] Prisma model: `AscAccount`, `AscApp`, `AscRelease`, `AscReleaseAlert`
- [ ] `asc-api.client.ts` — JWT auth (App Store Connect ayrı API, ASA'dan farklı)
  - Endpoints: `/v1/apps`, `/v1/apps/{id}/appStoreVersions`, `/v1/builds`
- [ ] `asc-release.service.ts` — release tracking
  - Latest version + release tarihi
  - Build sayısı (son 30 gün)
  - Crash rate (StoreKit'ten gelmez, ayrı entegrasyon gerekir — şimdilik skip)
- [ ] `asc-alert.service.ts` — alert logic
  - "Son update X gün önce, ayda 1 önerilir" notification
- [ ] Cron: `ASC_RELEASE_CHECK` — günlük tarama, alert tetikleme

### Frontend
- [ ] ASO sayfasında **"Releases"** alt-tab veya "Optimize" tab'ında widget
- [ ] Release timeline: son 6 ay versiyon + tarih
- [ ] "Update zamanı" alert kartı (kırmızı: 45+ gün, sarı: 21-45 gün, yeşil: <21 gün)
- [ ] Release notes template generator (AI ile)

---

## FAZ 3 — RanksUp iOS SDK + Remote Config

**Süre:** 7-10 gün

### iOS SDK
- [ ] Swift Package: `LuviAISDK`
- [ ] CocoaPods spec (geleneksel projeler için)
- [ ] Public API:
  ```swift
  RanksUp.initialize(apiKey: "...", appId: "...")
  RanksUp.requestRatingPrompt(trigger: "checkout_complete") // remote rule'a göre prompt'u açar veya açmaz
  RanksUp.track(event: "kredi_karsilastirma", properties: [...])
  RanksUp.getRemoteConfig(key: "rating_prompt_text") // A/B test variant
  ```
- [ ] Internal: HTTP client + offline queue + retry

### Backend
- [ ] Prisma model: `SdkAppConfig`, `SdkEvent`, `SdkRatingPromptRule`
- [ ] `apps/api/src/sdk/sdk.controller.ts`:
  - `GET /sdk/v1/config/:appKey` — remote config (rating prompt rule, A/B variant)
  - `POST /sdk/v1/events` — event ingestion (batch)
- [ ] Rating Prompt Rule editör (RanksUp UI):
  - Trigger: `app_open`, `screen_view`, `custom_event`
  - Min app açılış sayısı (örn. 5+)
  - Min retention günü (örn. 3+)
  - Maks 1 prompt / 30 gün (Apple limit)
  - A/B test: 2 farklı metin

### Frontend (RanksUp)
- [ ] ASO sayfasında **"In-App SDK"** alt-tab
- [ ] SDK install guide (CocoaPods, SPM, manual)
- [ ] API key yönetimi (her app için ayrı key)
- [ ] Rating prompt rule builder UI
- [ ] Real-time event stream (son 100 event)

---

## Veritabanı şeması (özet)

```prisma
model AsaAccount {
  id          String   @id @default(cuid())
  siteId      String
  orgId       String   // Apple Org ID
  keyId       String
  encryptedKey String  // .p8 file content, encrypted
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  campaigns   AsaCampaign[]
}

model AsaCampaign {
  id          String   @id @default(cuid())
  accountId   String
  asaCampaignId String @unique  // Apple'ın verdiği ID
  name        String
  budget      Float
  status      String   // ENABLED | PAUSED | DELETED
  adGroups    AsaAdGroup[]
}

model AscApp {
  id          String   @id @default(cuid())
  siteId      String
  appleAppId  String   @unique
  bundleId    String
  name        String
  latestVersion String?
  latestReleaseAt DateTime?
  releases    AscRelease[]
}

model SdkAppConfig {
  id              String   @id @default(cuid())
  siteId          String
  appKey          String   @unique  // SDK init'te kullanılan
  encryptedSecret String
  ratingPromptRules Json?
  abTestVariants  Json?
}
```

---

## Apple credentials'ları nasıl alınır (kullanıcı yapacak)

### ASA (Search Ads)
1. https://appstoreconnect.apple.com → Users and Access → Keys
2. Search Ads tab → Create Key
3. Role: Admin veya API
4. Indir: `.p8` file (private key — bir kez gösterilir, kaybedilmez)
5. Org ID + Key ID + .p8 content → RanksUp'ye yapıştır

### ASC (Connect API)
1. https://appstoreconnect.apple.com → Users and Access → Keys → App Store Connect API
2. Create Key, Access: App Manager
3. Indir: `.p8` file
4. Issuer ID + Key ID + .p8 → RanksUp'ye yapıştır

### Bundle ID (SDK init için)
- App'in Apple Bundle ID'si (örn. `com.kobipratik.app`)

---

## Riskler & geri çekme

- **ASA API rate limit**: 100 req/sn. Bulk operations için batch + queue
- **Apple credential rotation**: Key 180 gün geçerli. 30 gün önce auto-renewal alert
- **SDK adoption**: App developer'ın SDK'yı dahil etmesi şart. Yoksa rating prompt + analytics çalışmaz. SDK doğru build edilmezse app crash etmemeli — defensive init.
- **App Store policy**: Rating prompt 365 gün içinde max 3 kez tetiklenebilir (Apple's limit). SDK bu limiti enforce edecek.

---

## Uygulama sırası

Bu plan tek seferde değil, **fazlara göre** uygulanır. Her faz canlıya çıkar, kullanıcı test eder, sonraki faza geçilir:

1. ☐ Faz 1 — ASA (en yüksek değer, hızlı kazanım)
2. ☐ Faz 2 — ASC (orta değer, otomatize edilmiş release tracking)
3. ☐ Faz 3 — iOS SDK (uzun vadeli flywheel, app developer iş yükü gerektirir)
