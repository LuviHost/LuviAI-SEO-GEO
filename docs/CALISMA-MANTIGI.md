# LuviAI — Çalışma Mantığı

> Güncel mimari, akışlar, veri modelleri, kullanıcı yolculuğu ve operasyon prensipleri.
> v0.7 Faz 2 Beta · Mayıs 2026

---

## 1. Tek Cümle ile

LuviAI, web sitenize bir **AI ajan** koyan, sürekli denetleyen, içerik üreten, sosyal kanallarda yayınlayan ve performansı ölçen **uçtan uca SEO + GEO otomasyon platformudur**.

**Ne çözüyor:** SEO içeriği üretmek artık bilgi değil **zaman sorunu**. Bir blog yazısı + sosyal uyarlama + GEO optimizasyonu + analytics manuel olarak 3-4 saat tutuyor. LuviAI bunu **dakikalara** indiriyor.

---

## 2. Üç Servisli Mimari

```
┌─────────────────────────────────────────────────────────┐
│  apps/web   (Next.js 15 App Router, port 3000)         │
│  ─ /onboarding         Mission Console (Faz 1)          │
│  ─ /dashboard          Sitelerim                         │
│  ─ /sites/[id]         Operations Panel (Faz 2)         │
│  ─ /billing            Abonelik + Faturalama            │
│  ─ /affiliate          Multi-level network görseli       │
│  ─ /pricing            Plan satın alma                  │
└─────────────────────────────────────────────────────────┘
                          ↕ HTTP (cookies + JWT)
┌─────────────────────────────────────────────────────────┐
│  apps/api   (NestJS, port 3001)                         │
│  ─ Affiliate, Billing, Auth, Sites, Articles            │
│  ─ Audit, AI Citation, Topic Engine, Brain Generator    │
│  ─ Social adapters (registry pattern)                   │
│  ─ Video providers (registry pattern)                   │
│  ─ PayTR webhook + dev-confirm                          │
└─────────────────────────────────────────────────────────┘
                          ↕ BullMQ (Redis kuyruk)
┌─────────────────────────────────────────────────────────┐
│  apps/worker  (Node.js, BullMQ consumer)                │
│  ─ ONBOARDING_CHAIN  (Mission #1 5 step zinciri)        │
│  ─ GENERATE_ARTICLE, PUBLISH_ARTICLE                    │
│  ─ VIDEO_GENERATE    (5 provider factory)               │
│  ─ SOCIAL_PUBLISH    (cron tetikler)                    │
│  ─ Cron: AI_CITATION_DAILY, ADS_AUTOPILOT, ...          │
└─────────────────────────────────────────────────────────┘

Storage:
  ─ MySQL          (Prisma — tüm tabular state)
  ─ Redis          (BullMQ — job queue + cache)
  ─ Filesystem     (apps/api/public/videos/, /var/log/luviai/)
```

**Process manager:** PM2 (3 process: `luviai-api`, `luviai-web`, `luviai-worker`).
**Reverse proxy:** Nginx → Cloudflare CDN.

---

## 3. İki Fazlı Kullanıcı Yolculuğu (Stripe / Vercel pattern)

### Faz 1 — MISSION (setup, bir kez)

Yeni site eklendiğinde `/onboarding` sayfası **Mission Console** olarak çalışır:

```
Site URL eklendi
       ↓
[ONBOARDING_CHAIN job kuyruğa girer]
       ↓
[1/5] Brain üretimi      (rakipler, persona, SEO stratejisi)
[2/5] Audit               (14 SEO + GEO kontrol noktası)
[3/5] Topic Engine        (AI ile makale konuları)
[4/5] Platform tespiti    (WordPress / static / Next.js detection)
[5/5] Tier-1 takvim       (otopilot ON ise 8 makale schedule)
       ↓
Site status: ONBOARDING → AUDIT_PENDING → AUDIT_COMPLETE → ACTIVE
```

UI: tek sayfa, lineer akış, Vision OS / Apple Intelligence-vari orbital animasyonlar.
Süre: gerçek LLM çağrılarıyla ~90 sn — `AI_GLOBAL_DISABLED=1` ise 3×30sn mock akışı.

### Faz 2 — OPERATIONS (sürekli kullanım)

Mission tamamlanınca `/sites/[id]` **Operations Panel**'i açılır. 7 sekme, her birinin tek cümlelik amacı:

| Sekme | Tek cümlelik amaç | İçerik kaynağı |
|---|---|---|
| **Sağlık** | Bugün durum nedir, sıradaki aksiyon ne? | `SiteOverviewDashboard` |
| **İçerik** | Konu önerileri + üretilen makaleler + takvim | `TopicsStepBody` + `ArticlesStepBody` |
| **Veri** | Audit + Rakipler + GSC + GA4 + AI Citation + Snippet | 6 panel section |
| **Video** | TikTok / YouTube Shorts / Reels üretimi | `VideoLab` |
| **Rapor** | Toplam performans raporu | `SiteReportPanel` |
| **Analytics** | Detaylı gösterge paneli | `AnalyticsTab` |
| **Ayarlar** | Konfig + kanal bağlantıları | `SettingsTab` |

**"Detaylı Akış" sekmesi yoktur** — Mission bittiğinde akış görmek anlamsızdır. Bu IA prensibi bilinçlidir (Stripe / Vercel / Linear pattern).

---

## 4. Veri Modeli (özet)

### Ana Entity'ler

```
User
 ├── plan           (TRIAL | STARTER | PRO | AGENCY | ENTERPRISE)
 ├── subscriptionStatus
 ├── articlesUsedThisMonth
 ├── role           (USER | ADMIN | AGENCY_OWNER)
 └── Sites[]

Site
 ├── url, status (ONBOARDING/ACTIVE/...), platform
 ├── gscPropertyUrl, gscRefreshToken (OAuth)
 ├── gaPropertyId, gaRefreshToken
 ├── autopilot, autoGenerationEnabled
 └── Brain, Audit[], TopicQueue, Article[], SocialChannel[], Video[]

Brain                         (rakipler + persona + SEO stratejisi + brand voice)
Audit                         (14 SEO + GEO check + AI citations + GEO score)
TopicQueue                    (tier1/2/3 önerilen konular + GSC opportunities)
Article                       (DRAFT → SCHEDULED → GENERATING → READY → PUBLISHED)
SocialChannel                 (LinkedIn/X/YouTube/TikTok adapter + encrypted credentials)
SocialPost                    (mediaUrls JSON + scheduledFor + status)
Video                         (5 provider, MP4 output, Pexels atıf description)
Job                           (BullMQ wrapper, JobType enum)

Affiliate                     (refCode + totalRevenue + totalCommission)
AffiliateReferral             (clickedAt → signedUpAt → firstPaidAt → komisyon)
Invoice                       (PayTR transaction, PENDING/PAID/FAILED/REFUNDED)
```

### Önemli Prensipler

- **BYOK (Bring Your Own Key)**: `SiteAiProviderKey` tablosu ile her site kendi LLM API anahtarını koyabilir. Plan poolu yetmezse BYOK aktif olur.
- **Multi-level affiliate**: schema değişikliği yok, recursive query ile T1/T2 hesaplanır (her kullanıcı kendi affiliate hesabına sahip; T1'in T1'i = T2).
- **Encryption**: SocialChannel.credentials ve SiteAiProviderKey.enc `@luviai/shared` içindeki AES ile şifrelenir.

---

## 5. AI / LLM Entegrasyonları

| Provider | Kullanım | Plan Pool | BYOK |
|---|---|---|---|
| **Anthropic Claude** | Brain, Topics, Article writer (default) | ✓ | ✓ |
| **OpenAI** | Article (alternatif), TTS (slideshow video) | ✓ | ✓ |
| **Google Gemini** | Brain (alternatif), AI Citation | ✓ | ✓ |
| **xAI Grok** | AI Citation | ✓ | ✓ |
| **DeepSeek** | AI Citation (ucuz) | ✓ | ✓ |
| **Perplexity** | AI Citation (research) | ✓ | ✓ |

**`AI_GLOBAL_DISABLED` flag**: tüm LLM çağrılarını durdurur (mock data ile akış sürdürülür). Test/dev ortamında ücret kaçınmak için kullanılır.

---

## 6. Video Factory (5 sağlayıcı)

Registry pattern ile çoklayıcı yapı (`apps/api/src/videos/providers/`):

| Provider | Tip | Maliyet | Durum |
|---|---|---|---|
| **SLIDESHOW** | Stok görsel + TTS + ffmpeg | ~$0.01/video | ✅ Live (Pexels + OpenAI TTS) |
| **VEO** | Google Veo 3 (Vertex AI) | $0.50–0.75/8sn | Scaffold (service account gerekir) |
| **RUNWAY** | Runway Gen-4/3 | $0.05/sn | Key gerek |
| **HEYGEN** | AI avatar | $0.30/dk | Key gerek |
| **SORA** | OpenAI Sora 2 | $0.10–0.20/sn | Key + Tier 5 |

### Slideshow Akışı (ücretsiz mod)

```
brief.scriptText → splitIntoBeats (4 cümle) → 4 görsel + TTS audio
   ↓
Pexels API (PEXELS_API_KEY) → portrait orientation
   ↓
ffmpeg concat demuxer → 1080x1920 (9:16) MP4
   ↓
Pexels Terms of Service madde 4 — fotoğrafçı atfı:
   Video.description = "Photos: <isimler> via Pexels (https://www.pexels.com)"
   ↓
Yayın anında runPublish.appendVideoCredits → SocialPost.text sonuna append
```

Atıf zorunluluğu otomatik handle edilir — Pexels key banlanmaz.

---

## 7. Sosyal Yayın Akışı (Adapter Pattern)

`apps/api/src/social/adapters/`:

| Type | Status | OAuth flow |
|---|---|---|
| **LINKEDIN_PERSONAL** | Live | OpenID Connect (w_member_social) |
| **LINKEDIN_COMPANY** | Soon | Marketing Developer Platform onayı bekleniyor |
| **X_TWITTER** | Live (paid per tweet) | OAuth 2.0 + PKCE |
| **YOUTUBE** | Live | Google OAuth + YouTube Data API v3 + resumable upload |
| **TIKTOK** | Live (audit pending) | TikTok OAuth + Content Posting API. Audit'siz app sadece SELF_ONLY. |
| **FACEBOOK_PAGE / INSTAGRAM_BUSINESS / THREADS / BLUESKY / PINTEREST** | Live (review/config) | Provider'a özgü |

### Token Refresh

`SocialChannelsService.getDecryptedContext` her çağrıldığında:
- `credentials.expiresAt` < (now + 60sn buffer) ise → `adapter.refreshTokens()` çağrılır
- Yeni token DB'ye encrypt edilip yazılır
- YouTube için Google access_token 1 saatte expire olur — bu refresh akışı kritik

### Yayın Akışı

```
Kullanıcı SocialPost oluşturur (mediaUrls + scheduledFor)
   ↓
[Cron her dakika] SocialSchedulerService → scheduledFor <= now olanları queue'ya
   ↓
Worker SOCIAL_PUBLISH job → SocialPostsService.runPublish
   ↓
1. appendVideoCredits — mediaUrls'da video varsa Video.description sonuna append (Pexels atıf)
2. getDecryptedContext (token refresh dahil)
3. adapter.publish (provider-spesifik)
4. SocialPost.status = PUBLISHED + externalId/externalUrl
5. Hata → humanizeSocialError (Türkçe + aksiyon önerisi)
```

---

## 8. Multi-level Affiliate Programı

### Komisyon Yapısı

- **Tier 1 (doğrudan davet)**: %30 × 3 ay = lifetime ~%30
- **Tier 2 (alt seviye)**: T1'in davetlilerinin yaptığı ödemelerden ek komisyon
- **Cookie tracking**: 60 gün
- **Ödeme**: aylık otomatik IBAN/Papara

### Click → Signup → Komisyon Akışı

```
1. Kullanıcı https://ai.luvihost.com?ref=CODE linkine tıklar
   ↓
2. RefTracker (client component, layout.tsx içinde):
   - URL'den ?ref=CODE oku, regex sanitize
   - document.cookie luvi_ref set (60 gün, sameSite=lax)
   - Last-touch attribution (her ref override eder)
   - history.replaceState ile ?ref'i URL'den temizle
   ↓
3. Middleware fallback: dynamic page'lerde aynı işlemi yapar
   (Cloudflare static page cache'i yüzünden ana sayfada client tracker şart)
   ↓
4. Kullanıcı Google ile signup → NextAuth signIn callback
   ↓
5. Yeni user oluştuğunda cookies().get('luvi_ref') → POST /api/affiliate/attribute
   ↓
6. AffiliateReferral kaydı oluşur (status: signed_up)
   ↓
7. User ödeme yapınca PaytrService.recordCommission:
   - Doğru affiliate'a komisyon yazılır (T1 ve T2 için)
   - AffiliateReferral.firstPaidAt set + status: paid
   - Affiliates.totalRevenue + totalCommission update
```

### Network Görseli (anime.js v4)

`/affiliate` sayfası **dark gradient** + **SVG network** + **stagger animasyon**:
- Merkez 🟠 siz (turuncu, rocket ikonu)
- T1 düğümler 🔵 (saat 12'den dağılır, gerçek isimle: User.name veya email local)
- T2 düğümler 🟢 (her biri parentUserId üzerinden T1'e bağlanır)
- **Paid line akan parçacıklar**: sarı, T2 → T1 → siz yönünde
- Polling 30sn (aktif referans varsa)
- Background: yıldız particle + floating 💰 emoji

---

## 9. Billing (PayTR + dev-confirm)

### Subscribe → Webhook → Activate

```
1. Pricing veya Upgrade Modal → POST /api/billing/subscribe
2. PaytrService.subscribe → Invoice oluşturur (PENDING) + PayTR token
3. window.location.href = iframeUrl + localStorage.luviai-pending-merchantOid set
4. PayTR ödeme tamamlanır
5. PRODUCTION: PayTR → POST webhook → handleWebhook → invoice PAID + activateSubscription + recordCommission
6. TEST: Cloudflare webhook bloklayabilir → /billing/success page localStorage'dan merchantOid okuyup
   POST /api/billing/dev-confirm/:merchantOid çağırır → aynı işi yapar (parite)
```

### Plan Quota

```
TRIAL    → 1 makale ömür boyu (süre kapısı yok)
STARTER  → ₺3.080/ay   · 10 makale/ay  · 1 site
PRO      → ₺6.980/ay   · 50 makale/ay  · 3 site
AGENCY   → ₺13.610/ay  · 200 makale/ay · sınırsız site + white-label
```

---

## 10. Job Tipleri (Worker)

| JobType | Tetikleyici | Ne yapar |
|---|---|---|
| `ONBOARDING_CHAIN` | Site oluşturulduğunda | brain → audit → topics → platform → schedule |
| `GENERATE_ARTICLE` | Cron veya manuel | LLM ile makale yaz, status SCHEDULED → READY |
| `PUBLISH_ARTICLE` | Cron veya manuel | Yayın hedeflerine push (FTP/WordPress/GitHub) |
| `VIDEO_GENERATE` | Manuel (UI'dan) | 5 provider'dan biriyle video üret |
| `SOCIAL_PUBLISH` | Cron her dakika | scheduledFor <= now olan SocialPost'ları yayınla |
| `AI_CITATION_DAILY` | Cron günlük | Tüm sitelerin AI sorgu görünürlüğünü ölç |
| `ADS_AUTOPILOT` | Cron 6 saatte bir | ROAS'a göre Google/Meta kampanyalarını optimize |
| `LLMS_FULL_BUILD` | Cron haftalık | llms-full.txt dosyasını oluştur |
| `PERFORMANCE_CHECK` | 30 gün sonra | GSC verisi ile makale performans kontrolü |
| `CONTENT_PIVOT_CHECK` | Cron haftalık | Düşük performans tespit + revize tetikle |
| `AI_MENTION_ALARM` | Cron günlük | AI citation drop tespit + email |

---

## 11. Animasyon Stratejisi

**anime.js v4** ana kütüphane (`animejs@^4.4.1`). Saf CSS keyframes (`@keyframes`) + Tailwind transition utilities ile harmanlanır.

### Pattern Library

| Pattern | Kullanıldığı yer |
|---|---|
| **Stagger fadeInUp** | Kart girişleri (dashboard, billing, affiliate) |
| **Count-up easeOutCubic** | KPI sayıları, fiyat |
| **Pulse halo** | ACTIVE status badge |
| **Shimmer hover** | Birincil CTA butonlar |
| **Pulse ring** | Affiliate orbital sistem (3 katmanlı) |
| **Orbital spin** | Affiliate tier ring (8s normal, 5s ters) |
| **Breathe** | Merkez orb + plan card glow |
| **Flow particle** | Affiliate paid line komisyon parçacığı (offset-path) |
| **Width fill** | Billing usage bar (0% → real%) |
| **Sinematik geçiş** | Sites/[id] route'a tıklandığında 1.5sn full-screen overlay |

### Sayfa Geçiş Animasyonu

```
Dashboard kart tıklanır
   ↓
[10ms] Tıklanan kart scale 1.04 + brand glow, diğerleri opacity 0.25 + blur
   ↓
[30ms] PageTransitionOverlay (z-100, backdrop-blur 20px) belirir
       3 katmanlı pulse ring (brand/violet/fuchsia)
       2 yörünge ring (rotate normal/ters)
       Merkez gradient orb + Rocket ikonu
       "Site Agent · Connecting" + site adı + nabız dotlar
   ↓
[1500ms] router.push() tetiklenir
   ↓
loading.tsx (sites/[id]) aynı orbital sistem ile devam eder
   ↓
Hedef sayfa hazır → fade-in
```

---

## 12. Build & Deploy

### Local Geliştirme
```bash
pnpm install --frozen-lockfile
pnpm dev          # tüm uygulamalar paralel
```

### Production (95.134.4.88)

```bash
# Code update
cd /var/www/luviai
git pull origin main
pnpm install --frozen-lockfile
cd apps/api && pnpm prisma migrate deploy && cd ../..
pnpm build

# Restart
pm2 restart all   # luviai-api, luviai-web, luviai-worker
pm2 logs --lines 50
```

### Environment Anahtarları

| Bölüm | Anahtarlar |
|---|---|
| **DB** | DATABASE_URL (mysql://...) |
| **Redis** | REDIS_URL |
| **Auth** | NEXTAUTH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET |
| **PayTR** | PAYTR_MERCHANT_ID, PAYTR_MERCHANT_KEY, PAYTR_MERCHANT_SALT, PAYTR_TEST_MODE, PAYTR_NOTIFICATION_URL=`/api/billing/webhooks/paytr` |
| **AI Pool** | ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_AI_API_KEY, XAI_API_KEY, DEEPSEEK_API_KEY |
| **Video** | PEXELS_API_KEY (Slideshow), VEO/RUNWAY/HEYGEN/SORA opsiyonel |
| **Sosyal** | LINKEDIN_*, TWITTER_*, YOUTUBE_* (alias Google), TIKTOK_*, TIKTOK_DEFAULT_PRIVACY |
| **Email** | RESEND_API_KEY, EMAIL_FROM |
| **Settings flag** | AI_GLOBAL_DISABLED (admin UI'dan), ARTICLE_GENERATION_DISABLED |

---

## 13. Güvenlik & İzlerlik

- **Encryption**: `@luviai/shared` AES-256-GCM ile credentials encrypt
- **OAuth scope minimization**: GSC (read), GA4 (read), YouTube (upload), LinkedIn (member_social only)
- **Webhook hash verify**: PayTR'den gelen her callback merchant_salt ile hash doğrulanır
- **Internal endpoints**: x-internal-key header (NEXTAUTH_SECRET ile match)
- **Rate limit**: NestJS Throttler global (60 req/dk)
- **Audit log**: Settings değişiklikleri `setting_audit_logs` tablosuna kaydedilir

---

## 14. Faz 3 Yol Haritası (planda)

- [ ] Multi-server scaling (DB read replica + 2x API LB)
- [ ] PayTR alternatifi (iyzico, Stripe TR)
- [ ] White-label tam özellik (Agency plan)
- [ ] Mobile uygulama (React Native + Expo)
- [ ] Chrome extension (one-click site ekle)
- [ ] WordPress plugin (LuviAI agent embed)
- [ ] Affiliate gerçek webhook (commission auto-payout)
- [ ] Video Factory: self-hosted T2V (LTX-Video, Wan 2.1) GPU sunucusunda

---

> Bu dökümanı güncelleyen: Ops/refactor sürecindeki major commit'lerden sonra `docs/CALISMA-MANTIGI.md` revize edilmelidir.
> Son güncelleme: 2026-05-01 · v0.7 Faz 2 Beta · main branch HEAD `81690d1`
