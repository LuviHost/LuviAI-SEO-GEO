# LuviAI Architecture

## High-level

```
┌─────────────────────────────────────────────────────────────────┐
│                        ai.luvihost.com                          │
│                       (Next.js 15 frontend)                     │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 │ REST + NextAuth session cookie
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                    api.ai.luvihost.com                          │
│                  (NestJS 10 + Prisma + MySQL)                   │
└────┬───────────────────────┬───────────────┬───────────────────┘
     │                       │               │
     │ enqueue jobs          │ queue read    │ direct DB
     ▼                       ▼               ▼
┌─────────────┐      ┌──────────────┐   ┌──────────┐
│   Redis     │◄────►│  BullMQ      │   │  MySQL   │
│   (queue)   │      │  Worker      │   │  (data)  │
└─────────────┘      └──────┬───────┘   └──────────┘
                            │
        ┌───────────────────┼─────────────────────────┐
        │                   │                         │
        ▼                   ▼                         ▼
┌──────────────┐    ┌─────────────────┐    ┌──────────────────┐
│ Anthropic    │    │  Google AI      │    │  Auriti GEO CLI  │
│ (Claude)     │    │  (Gemini)       │    │  + GSC API       │
└──────────────┘    └─────────────────┘    └──────────────────┘
                                                   │
                                                   ▼
                                          ┌────────────────┐
                                          │  Publish       │
                                          │  Adapters      │
                                          │  (14 hedef)    │
                                          └────────────────┘
                                                   │
                                                   ▼
                                          ┌────────────────────┐
                                          │ User'ın sitesi:    │
                                          │ WP / FTP / SFTP /  │
                                          │ Webflow / vb.      │
                                          └────────────────────┘
```

## Data flow — onboarding

```
1. User /signup            → Email magic link / Google OAuth
2. User wizard step 1-5    → POST /api/sites
3. Backend                 → enqueue [BRAIN_GENERATE, SITE_AUDIT]
4. Worker BRAIN_GENERATE   → Site crawl, persona match, competitor scan
                              → DB: prisma.brain.create()
5. Worker SITE_AUDIT       → 14 kontrol noktası
                              → DB: prisma.audit.create()
6. Backend                 → user'a notification: "Audit hazır"
7. User audit görür        → "Otomatik düzelt" butonu
8. Backend                 → enqueue AUTO_FIX (sitemap/robots/llms)
9. Worker                  → Generate + publish to user's site
10. Backend                → enqueue TOPIC_ENGINE
11. Worker                 → 4 katman + Sonnet → Tier 1/2/3 queue
12. Backend                → enqueue GENERATE_ARTICLE (Tier 1 #1)
13. Worker                 → 6 ajan zinciri → DB + publish
14. User                   → "İlk makaleniz yayında! Devam için $X/ay"
```

## Multi-tenant isolation

- **Database:** Tek MySQL, satır seviyesi tenant filtresi (`siteId` her tabloda)
- **Brain:** Her site için ayrı `Brain` kaydı (LuviHost'taki .claude/context/'in DB versiyonu)
- **Credentials:** AES-256-GCM şifrelenmiş, şifre `ENCRYPTION_KEY` env'de
- **GSC OAuth:** Her site kendi refresh_token'ını verir, asla cross-tenant erişim yok
- **Quota:** User-level, plan-based article count tracking

## AI maliyet kontrolü

- Default model: Sonnet 4.6 (yazar+editör)
- Premium opt-in: Opus 4.7 (Agency+ planı)
- Prompt caching: brain (~10K token) bir kez yazılır, sonraki 5 ajan cache'den okur (%90 indirim)
- Image: Gemini 2.5 Flash ($0.030/görsel) varsayılan, Gemini 3 Pro ($0.039) opt-in

## Deployment topology

**Tek VDS (LuviHost):**
- nginx reverse proxy (`ai.luvihost.com` + `api.ai.luvihost.com`)
- 4 vCPU + 8GB RAM yeterli (~500 aktif kullanıcı)
- Docker compose:
  - mysql 8 (port 3306, internal)
  - redis 7 (port 6379, internal)
  - api (Node 22, port 3001)
  - worker (Node 22, no port — sadece queue worker)
  - web (Next.js standalone, port 3000)
- Cloudflare → SSL + DDoS + cache

**Backup:**
- MySQL günlük dump → DigitalOcean Spaces (S3-compatible)
- Article HTML'leri backup → aynı yer

## Tech debt warnings

- Faz 1'de tek MySQL → 1000+ kullanıcı sonrası read replica gerekir
- BullMQ in-memory state → Redis cluster gerekirse persistence-only mode
- Anthropic API rate limit (per-key) → Faz 3'te key rotation veya AWS Bedrock'a fallback
- Auriti GEO CLI Python — eğer scale problem olursa native JS port
