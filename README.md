# LuviAI — SEO + GEO Otomasyon Platformu

> **"Sitenin URL'ini ver, GSC bağla, AI haftalık 5-50 makale üretip yayınlasın."**

LuviAI, küçük-orta işletmelerin ve ajansların blog büyümesini AI ile otomatikleştiren bir SaaS ürünüdür. LuviHost ana markasının türevi olarak konumlanır.

- **Domain:** `ai.luvihost.com`
- **API:** `api.ai.luvihost.com`
- **Geliştirici:** Emirhan Burgazli ([@luvihost](https://luvihost.com.tr))
- **Lisans:** Proprietary (kapalı kaynak)

---

## Vizyon

Mevcut SEO içerik üretim pipeline'ını (LuviHost için kurulmuş 6-ajan sistemi) çoklu kullanıcılı bir SaaS platformuna dönüştürür. Kullanıcı:

1. Sitesini bağlar (URL + GSC OAuth)
2. Otomatik **site audit** çalışır — sitemap.xml/robots.txt/llms.txt/schema/meta eksikleri listelenir, "Otomatik Düzelt" tek tıkla uygulanır
3. **Brain Generator** kullanıcının markasına özel bağlam oluşturur (marka sesi, persona, rakip listesi, SEO stratejisi)
4. **Topic Engine** Tier 1/2/3 makale önerileri çıkarır (Plan + GSC + GEO + Rakip)
5. **Pipeline** seçilen makaleleri 6 ajanlı süreçle üretir (anahtar kelime → outline → yazar → editör → görsel → yayıncı)
6. **Adapter Layer** kullanıcının publish hedefine yayınlar (WordPress / FTP / SFTP / Markdown / Webflow / Sanity / GitHub / cPanel / WHMCS / vb.)
7. **30 gün sonra** GSC verisinden iyileştirme önerir (improve-page mantığı)

---

## Mimari

```
┌─────────────────────────────────────────────────────────────────┐
│                      LuviAI Monorepo                            │
└─────────────────────────────────────────────────────────────────┘

  apps/web          apps/api           apps/worker
  ──────────        ─────────          ────────────
  Next.js 15        NestJS 10          BullMQ workers
  Tailwind          REST + GraphQL?    Pipeline orchestrator
  shadcn/ui         Prisma             - audit
  NextAuth          MySQL              - brain-gen
  i18n TR/EN        Redis              - topic-engine
                                       - generate-article
                                       - publish
                                       - improve-page
                                       - weekly-cron

  packages/shared   packages/adapters
  ─────────────     ─────────────────
  Tip tanımları     Publish adapter'lar:
  Schema'lar        WordPress, FTP, SFTP, GitHub, Webflow,
  Util fonksiyon    Sanity, Contentful, Ghost, WHMCS,
                    cPanel, Strapi, Markdown ZIP
```

### Stack

| Katman | Teknoloji |
|---|---|
| Frontend | Next.js 15 + Tailwind + shadcn/ui + NextAuth |
| Backend | NestJS 10 + Prisma ORM |
| Database | MySQL 8 (LuviHost VDS) |
| Queue | Redis + BullMQ |
| AI | Anthropic SDK (Claude Sonnet/Opus) + Google GenAI (Gemini Flash) |
| GSC | google-api-nodejs-client (OAuth 2.0 multi-tenant) |
| Payment | PayTR (TR) |
| Email | Resend.com |
| Hosting | LuviHost VDS (4 vCPU + 8GB RAM yeterli) |
| CDN/SSL | Cloudflare (free tier) |
| Monitoring | Sentry (free tier) |
| Storage | LuviHost'un kendi diski + S3-compatible (DigitalOcean Spaces) backup için |

---

## Faz planı

### 🟢 Faz 1 — MVP Beta (4 hafta — tek geliştirici)
Davet üzeri 30 kullanıcı, ödeme yok.

- Hafta 1: Backend iskeleti + DB + auth
- Hafta 2: Audit engine + auto-fix (sitemap/robots/llms)
- Hafta 3: Pipeline migration + 4 publish adapter (WP/FTP/SFTP/MD)
- Hafta 4: Frontend dashboard + onboarding wizard + worker + canlıya alım

### 🟡 Faz 2 — Public + PayTR (6 hafta)
- PayTR entegrasyonu + 3 plan (Starter ₺499 / Pro ₺1.299 / Agency ₺3.299)
- Polished UI + dark mode + i18n TR/EN
- 10 yeni publish adapter (Webflow, Sanity, GitHub, cPanel, vb.)
- Analytics dashboard (GSC verisi)
- Marketing site + LuviAI'nin kendi blog'u (dogfooding)

### 🔴 Faz 3 — Scale + Enterprise (6 ay)
- White-label (ajans planı)
- Public API + SDK + Zapier/Make/n8n
- Adaptive AI (kullanıcı feedback'inden öğren)
- LuviAI Pages (programmatic SEO 1000+ sayfa)
- LuviAI Localize (10 dile çeviri)
- Enterprise (SSO, SLA, dedicated infra)

---

## Plan & Fiyatlama (₺)

| Plan | Aylık | Yıllık (-%20) | Makale/ay | Site sayısı |
|---|---|---|---|---|
| **Starter** | 499 | 4.799 | 10 | 1 |
| **Pro** | 1.299 | 12.499 | 50 | 3 |
| **Agency** | 3.299 | 31.999 | 250 | 10 |
| **Enterprise** | 19.999+ | custom | sınırsız | sınırsız |

> 14 gün ücretsiz trial. Onboarding sonu **otomatik 1 ücretsiz makale** üretilir (kullanıcı kalitesini görür → ödeme yapar).

---

## Dizin yapısı

```
luviai/
├── apps/
│   ├── api/                # NestJS backend
│   │   ├── src/
│   │   │   ├── auth/       # NextAuth + GSC OAuth
│   │   │   ├── sites/      # Site CRUD + brain
│   │   │   ├── audit/      # Site sağlık taraması
│   │   │   ├── topics/     # Topic engine (4 katman)
│   │   │   ├── articles/   # Pipeline + publish
│   │   │   ├── billing/    # PayTR + subscriptions
│   │   │   └── admin/      # Tenant yönetimi
│   │   └── prisma/
│   │       ├── schema.prisma
│   │       └── migrations/
│   │
│   ├── web/                # Next.js frontend
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── (marketing)/    # Landing + pricing + blog
│   │   │   │   ├── (auth)/         # Login + register
│   │   │   │   ├── (dashboard)/    # Kullanıcı paneli
│   │   │   │   └── (admin)/        # Sizin admin paneliniz
│   │   │   └── lib/
│   │   └── messages/       # i18n (tr.json, en.json)
│   │
│   └── worker/             # BullMQ worker
│       ├── src/
│       │   ├── jobs/
│       │   │   ├── audit.ts
│       │   │   ├── brain-gen.ts
│       │   │   ├── topic-engine.ts
│       │   │   ├── generate-article.ts
│       │   │   ├── publish.ts
│       │   │   ├── improve-page.ts
│       │   │   └── weekly-cron.ts
│       │   └── adapters/
│       └── package.json
│
├── packages/
│   ├── shared/             # Type tanımları + util
│   │   └── src/
│   │       ├── types/      # Brain, Persona, Article tip tanımları
│   │       ├── prompts/    # Ajan prompt template'leri
│   │       └── utils/      # turkish-slug, cleaner, vb.
│   │
│   └── adapters/           # Publish hedefleri
│       └── src/
│           ├── base.ts            # AbstractPublishAdapter
│           ├── wordpress-rest.ts
│           ├── wordpress-xmlrpc.ts
│           ├── ftp.ts
│           ├── sftp.ts
│           ├── github.ts
│           ├── webflow.ts
│           ├── sanity.ts
│           ├── contentful.ts
│           ├── ghost.ts
│           ├── cpanel.ts
│           ├── whmcs-kb.ts
│           └── markdown-zip.ts
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DEPLOYMENT.md
│   ├── PRICING.md
│   ├── ROADMAP.md
│   └── API.md              # Faz 3'te public API dokümantasyonu
│
├── scripts/
│   └── seed/               # Test verisi
│
├── docker-compose.yml      # Yerel dev için MySQL + Redis
├── pnpm-workspace.yaml
├── package.json
└── .env.example
```

---

## Geliştirme

```bash
# Klonla + bağımlılıklar
cd ~/Documents/luviai
pnpm install

# Yerel servisleri başlat (MySQL + Redis)
docker-compose up -d

# DB migrate
cd apps/api
pnpm prisma migrate dev

# Tüm servisleri paralel çalıştır
cd ~/Documents/luviai
pnpm dev   # web (3000), api (3001), worker (background)
```

`.env.example` dosyasını `.env`'e kopyalayıp doldurun.

---

## Migrasyon: LuviHost pipeline → LuviAI

Mevcut `~/Desktop/EMİR/LuviHost/luvi/scripts/` klasöründeki kod LuviAI'nin **prototip ve dogfooding örneği** olarak korunur. Şu mapping ile NestJS service'lerine taşınır:

| Mevcut script | LuviAI service |
|---|---|
| `generate-article.js` | `apps/worker/src/jobs/generate-article.ts` |
| `publish.js` | `apps/worker/src/jobs/publish.ts` |
| `topic-engine.js` | `apps/worker/src/jobs/topic-engine.ts` |
| `batch.js` | `BullMQ flow producer` |
| `improve-page.js` | `apps/worker/src/jobs/improve-page.ts` |
| `lib/agent-runner.js` | `apps/api/src/articles/agent-runner.service.ts` |
| `lib/gsc-fetcher.js` | `apps/api/src/topics/gsc.service.ts` |
| `lib/geo-runner.js` | `apps/api/src/audit/geo.service.ts` |
| `lib/competitor-scan.js` | `apps/api/src/topics/competitor.service.ts` |
| `lib/topic-scorer.js` | `apps/api/src/topics/scorer.service.ts` |
| `lib/template-render.js` | `packages/shared/src/template/` |
| `lib/sitemap.js` | `packages/adapters/src/sitemap.ts` |
| `lib/md-to-html.js` | `packages/shared/src/md-to-html.ts` |
| `lib/turkish-slug.js` | `packages/shared/src/utils/slug.ts` |
| `.claude/agents/*.md` | `packages/shared/src/prompts/agents/` |
| `.claude/context/*.md` | DB'den dinamik (her tenant için brain.json) |

---

## Beta dağıtım

İlk 30 kullanıcı:
1. **LuviHost müşteri listesi** — email davet (pasif, ücretsiz, "şirket olarak kullanın")
2. **Yakın çevre** — sistemi test edecek arkadaşlar (feedback için kritik)

Beta'da **PayTR yok**, sınır **1 ücretsiz makale** (onboarding sonu otomatik). Sonrasında kullanıcı manuel "üret" butonuna basamaz — beta süresi uzatılırsa admin panel'den quota açılır.

---

## Tek geliştirici takvimi (gerçekçi)

| Faz | Süre | Çıktı |
|---|---|---|
| 1 | 4 hafta | MVP beta, 30 kullanıcı |
| 2 | 6 hafta | PayTR + public + 100-500 ödemeli |
| 3 | 6 ay | White-label + API + 500+ kullanıcı |
| **Toplam** | **~10 ay** | LuviAI'nin tam ürünü |

> Junior dev katkı (₺25-35K/ay) varsa takvim 2x kısalır.
