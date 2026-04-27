# LuviAI Roadmap

> Tek geliştirici (Emirhan) takvimi. Junior dev varsa 2x kısalır.

---

## 🟢 Faz 1 — MVP Beta (4 hafta)

**Hedef:** 30 davetli kullanıcı, ödeme yok, feedback toplama.

### Hafta 1 — Backend foundations
- [ ] pnpm install + monorepo bootstrap
- [ ] MySQL + Redis docker-compose çalıştır
- [ ] Prisma migrate + seed
- [ ] NextAuth (Google OAuth + email magic)
- [ ] GSC OAuth multi-tenant (per-site refresh token)
- [ ] PrismaService + auth guards
- [ ] Sites CRUD endpoints

### Hafta 2 — Audit + Auto-fix
- [ ] Site crawler (Cheerio)
- [ ] 14 kontrol noktası implementasyonu
- [ ] PageSpeed Insights API
- [ ] Auriti GEO CLI subprocess
- [ ] Sitemap.xml generator
- [ ] Robots.txt + llms.txt generator
- [ ] Auto-fix → publish target'a yükle

### Hafta 3 — Pipeline migration
- [ ] AgentRunner (multi-tenant, per-site brain)
- [ ] PipelineService (6 ajan zinciri)
- [ ] BrainGenerator (site analiz → otomatik brain)
- [ ] TopicEngine (4 katman + Sonnet ranker)
- [ ] WordPress REST adapter
- [ ] FTP adapter
- [ ] SFTP adapter
- [ ] Markdown ZIP export

### Hafta 4 — Frontend + Worker + Launch
- [ ] Next.js dashboard
- [ ] Onboarding wizard (5 adım)
- [ ] BullMQ worker (7 job tipi)
- [ ] Cron scheduler (haftalık otomatik üretim)
- [ ] Email notifications (Resend)
- [ ] LuviHost VDS deploy (Docker compose)
- [ ] DNS + Cloudflare SSL (`ai.luvihost.com`)
- [ ] 5-10 beta kullanıcı testi
- [ ] **🚀 Beta lansman**

**Faz 1 sonu:** Çalışan ürün, davet üzeri 30 kullanıcı.

---

## 🟡 Faz 2 — Public + PayTR (6 hafta)

### Hafta 5-6 — PayTR + plan limits
- [ ] PayTR Merchant entegrasyonu
- [ ] Webhook handler
- [ ] 3 plan tanımı (Starter/Pro/Agency)
- [ ] Quota service
- [ ] Trial state machine
- [ ] Self-service customer portal
- [ ] E-fatura entegrasyonu

### Hafta 7-8 — UI polishing + i18n
- [ ] shadcn/ui tam refactor
- [ ] Dark mode
- [ ] TR + EN i18n (next-intl)
- [ ] Mobile responsive
- [ ] Onboarding video tour (Loom)
- [ ] Knowledge base sayfaları

### Hafta 9 — Yeni publish adapter'ları
- [ ] WordPress XML-RPC
- [ ] cPanel API
- [ ] GitHub repo (Octokit)
- [ ] Webflow CMS
- [ ] Sanity
- [ ] Contentful
- [ ] Ghost
- [ ] WHMCS Knowledgebase
- [ ] Custom PHP endpoint

### Hafta 10 — Analytics + Topic Queue v2
- [ ] GSC günlük cron
- [ ] Makale başına metrikler
- [ ] 30g performans grafiği
- [ ] Topic queue: drag-drop, manuel ekle, bulk actions
- [ ] Cluster grafiği (D3.js)

### Hafta 11 — Launch ops
- [ ] Marketing site (TR + EN)
- [ ] LuviAI'nin kendi blog'u (dogfooding)
- [ ] Pricing + FAQ + Comparison sayfaları
- [ ] Affiliate programı (LuviHost müşterilerine %30)
- [ ] Product Hunt + sosyal medya kampanya
- [ ] **🚀 Public launch**

**Faz 2 sonu:** PayTR aktif, 100-500 ödemeli kullanıcı, ₺80-150K MRR.

---

## 🔴 Faz 3 — Scale (6 ay)

### Ay 4 — White-label + Agency
- [ ] Custom domain mapping
- [ ] Custom branding
- [ ] Sub-account yönetimi (ajansın kendi müşterileri)
- [ ] Reseller billing
- [ ] Agency plan (₺7.999/ay sınırsız)

### Ay 4 — Team accounts + workflow
- [ ] Çoklu kullanıcı (admin/editor/viewer)
- [ ] Approval workflow
- [ ] Comments + revisions
- [ ] Activity log
- [ ] Slack/Discord webhooks

### Ay 5 — Public API + Integrations
- [ ] REST API + OpenAPI
- [ ] API key yönetimi
- [ ] Rate limiting per plan
- [ ] Webhook outbound
- [ ] SDK npm + pip
- [ ] Zapier app
- [ ] Make.com modülü
- [ ] n8n node
- [ ] Notion sync
- [ ] HubSpot CRM

### Ay 6 — Adaptive AI + Variants
- [ ] Kullanıcı feedback'inden öğren
- [ ] Site bazında "marka sesi modeli"
- [ ] Performance feedback loop
- [ ] AI A/B testing
- [ ] LuviAI Pages (programmatic SEO)
- [ ] LuviAI Refresh (eski içerik güncelleme)
- [ ] LuviAI Localize (10 dil)
- [ ] LuviAI Audit (sadece audit, ucuz plan)

### Ay 7-9 — Enterprise
- [ ] SSO (SAML, Okta, Google Workspace)
- [ ] SOC 2 Type 1 hazırlık
- [ ] Custom contract & SLA
- [ ] Dedicated infrastructure
- [ ] Mobile app (React Native)
- [ ] Enterprise plan ₺19.999+/ay

**Faz 3 sonu:** 500+ kullanıcı, 30 ajans, 5 enterprise. ₺350-500K MRR (~$10-15K).
