# On-Page.ai 17 Recipe → LuviAI Feature Mapping

**Kaynak:** https://on-page.ai/pages/automate-seo/ — 17 SEO automation recipe.

**Amaç:** Her recipe'i LuviAI'nın mevcut özellikleriyle karşılaştır, **gap analizi** yap, **Faz 2 / Faz 3 backlog** için sıralı bir aksiyon listesi çıkar.

**Önemli stratejik gözlem:**
- On-page.ai bir **MCP connector** olarak çalışıyor (Codex / Claude Code içinde) — power user / SEO ajansları hedefli.
- LuviAI **SaaS dashboard** — KOBİ + ajans için tek tıklık UX.
- LuviAI'nın **Auriti GEO 47-metrik** altyapısı zaten var (on-page.ai'nın "entity importance + Highly Related Words" raporuyla benzer veri). Yani **veri layer'ı hazır**, eksik olan **workflow orchestration + UI exposure**.
- Her recipe doğal olarak bir **BullMQ job tipi + dashboard butonu** olarak LuviAI'a eklenir.

---

## Hızlı durum özeti

| # | Recipe | LuviAI Durumu | Öncelik |
|---|--------|---------------|---------|
| 1 | Recover Stuck Page | ❌ Yok | 🔴 Yüksek |
| 2 | Site-Wide Internal Links | ⚠️ Kısmi (cross-site var, within-site yok) | 🔴 Yüksek |
| 3 | Single Page Internal Links (Detailed) | ⚠️ Kısmi (within-site yok) | 🟡 Orta |
| 4 | Single Page Internal Links (Simple) | ⚠️ Kısmi | 🟡 Orta |
| 5 | Site-Wide Refresh (Stale Pages) | ❌ Yok (production var, refresh yok) | 🔴 Yüksek |
| 6 | Light Page Refresh, Single Page | ❌ Yok | 🟡 Orta |
| 7 | Standard Optimization, Single Page | ⚠️ Kısmi (re-scan loop + category align yok) | 🟡 Orta |
| 8 | Standard Optimization, Site-Wide | ❌ Yok | 🟢 Düşük (5+8 birleşik gelir) |
| 9 | Full Client Website Audit PDF | ⚠️ Kısmi (audit var, PDF export yok) | 🟡 Orta — **Ajans planı için kritik** |
| 10 | Single Page Audit PDF | ⚠️ Kısmi (PDF export yok) | 🟡 Orta |
| 11 | Advanced Page Diagnostic | ⚠️ Kısmi (yapılandırılmamış) | 🟡 Orta |
| 12 | Sub-Headline Optimization | ❌ Yok (yeni içerik için var, retrofit yok) | 🟢 Düşük |
| 13 | Image + Alt-Text Optimization | ❌ Yok (yeni için var, retrofit yok) | 🟢 Düşük |
| 14 | Local Page Diagnostic | ❌ Yok | 🟡 Orta — yeni vertical |
| 15 | Local Page Tuning | ❌ Yok | 🟡 Orta |
| 16 | Local Website + GBP Alignment | ❌ Yok | 🔴 Yüksek — **Türkiye KOBİ için bomba** |
| 17 | Local Cannibalization Checker | ❌ Yok | 🔴 Yüksek |

**Net:** 17 recipe'in **4'ü kısmi**, **13'ü yok**. Auriti GEO altyapın hazır, eksik olan iş workflow orchestration + UI.

---

## Detaylı recipe-by-recipe analiz

### 🔴 Recipe 1: Recover a Stuck Page
**Ne yapar:** İndekslenmiş ama yeterince ranklamayan tek sayfayı kurtarır. Deep scan → entity gap → light edit → re-scan → audit trail.

**LuviAI mevcut:** Yok. Yeni içerik üretiyorsun ama mevcut sayfayı "kurtarmak" için bir job yok.

**Eklemek için gerekli:**
- `apps/worker/src/jobs/recover-page.ts` — job
- Auriti GEO scan input
- Entity importance 9/10 + Highly Related Words extraction (varsa kullan)
- LLM ile sentence-level edit (Claude Sonnet 4.6)
- Re-scan + before/after diff
- HTML audit trail (Dashboard'da gösterilir + PDF export ile yollanır)

**Tahmini effort:** 3-5 gün. **Çıktı UX:** Dashboard → Articles → "Bu sayfa stuck — recover" butonu.

**Impact:** 🔥 Müşterinin var olan içeriği için ROI gösterir. "AI sadece yeni içerik üretmiyor, eskileri de iyileştiriyor" mesajı.

---

### 🔴 Recipe 2: Site-Wide Internal Links
**Ne yapar:** Sitemap'ten manifest → batch processing → her sayfa için 3 source page'den seamless internal link ekleme. Resume/continue, idempotent.

**LuviAI mevcut:** `cross-linking.service.ts` var ama **siteler arası** (multi-tenant ekosistem linking). **Within-site** internal linking yok.

**Eklemek için gerekli:**
- `apps/worker/src/jobs/site-internal-links.ts` — manifest-based batch job
- Sitemap parser (var: `packages/adapters/src/sitemap.ts`)
- Per-page relevance scan + top 3 source page seçimi
- LLM ile natural anchor text + sentence-level edit
- Persistent manifest (Prisma model: `InternalLinkManifest`)
- Resume token + batch range parameters
- Audit trail HTML/PDF

**Tahmini effort:** 7-10 gün (manifest + batch + idempotency için).

**Impact:** 🔥🔥 Ajans planında **killer feature** — "tek tıkla tüm sitenin internal linking'ini güçlendir". On-page.ai bunu özellikle satıyor.

**UX:** Dashboard → Site → "Internal Linking Run" butonu, batch range slider (1-75, 76-150, vs.), live progress.

---

### 🟡 Recipe 3-4: Single Page Internal Links (Detailed + Simple)
**Ne yapar:** Tek sayfa için 3 contextual internal link. Detailed = full report, Simple = lightweight.

**LuviAI mevcut:** Yok (within-site).

**Eklemek için gerekli:** Recipe 2'nin tekilleştirilmiş versiyonu. Recipe 2 yazılırsa bu **ücretsiz** gelir (aynı kod, 1 sayfa input).

**Tahmini effort:** 1 gün (Recipe 2'den sonra).

---

### 🔴 Recipe 5: Site-Wide Refresh for Old/Stale Pages
**Ne yapar:** Sitemap last-modified'a göre eski-önce sıralı manifest → Lite scan → entity insertion + alt-text + 1 paragraph (light edits).

**LuviAI mevcut:** `programmatic-seo.service.ts` var ama bu **yeni sayfa üretimi**, refresh değil. **Article scheduler** yeniden yayın yapabilir ama refresh batch'i yok.

**Eklemek için gerekli:**
- `apps/worker/src/jobs/site-wide-refresh.ts`
- Sitemap last-modified parsing (date-sorted manifest)
- Lite scan endpoint (Auriti GEO'nun "lite" varyantı yoksa eklenir)
- Per-page light edit: importance 9/10 entities + Highly Related Words + max 1 short paragraph
- Image alt-text update
- Manifest + resume + batch

**Tahmini effort:** 10-12 gün.

**Impact:** 🔥🔥🔥 Bu **olmazsa olmaz** — mevcut KOBİ sitelerinde "10 yıllık eski blog" sorunu çok yaygın. LuviAI'nın "kuruluştaki içeriği AI ile canlandır" anlatısı çok güçlü olur. **Faz 2 sonu için kesin kapsam.**

**UX:** Dashboard → Site → "Stale Content Refresh" — sitenin yaş dağılımı grafiği, "En eski 50 sayfayı refresh et" tek tık.

---

### 🟡 Recipe 6: Light Page Refresh, Single Page
**Ne yapar:** Recipe 5'in tekil versiyonu.

**LuviAI mevcut:** Yok.

**Eklemek için:** Recipe 5'in özel hali. 1 günde gelir.

---

### 🟡 Recipe 7: Standard Optimization, Single Page
**Ne yapar:** Recipe 6'dan daha kapsamlı. Entity 7,8,9,10 + sub-headlines + image alt-text + **Google category alignment** + **re-scan verification loop** (max 2 pass).

**LuviAI mevcut:** Pipeline'da yeni üretimde benzer iş var. Mevcut sayfaya retrofit yok. **Google category alignment** ve **re-scan loop** yok.

**Eklemek için:**
- Recipe 6 üzerine: re-scan + score comparison + retry pass
- Google category check (LuviAI'nın schema-classifier servisi var, biraz adaptasyonla olur)

**Tahmini effort:** 3-4 gün (Recipe 5/6 sonrası).

---

### 🟢 Recipe 8: Standard Optimization, Site-Wide
**Ne yapar:** Recipe 7'nin batch versiyonu.

**LuviAI mevcut:** Yok.

**Eklemek için:** Recipe 5'in batch infrastructure'ı + Recipe 7'nin per-page logic'i. Birleşim.

**Tahmini effort:** 2-3 gün (önceki recipe'ler sonrası).

---

### 🟡 Recipe 9: Full Client Website Audit PDF
**Ne yapar:** Ajansın müşterisi için PDF audit raporu.

**LuviAI mevcut:** Audit var, **PDF export yok**.

**Eklemek için:**
- PDF generator (Puppeteer veya `@react-pdf/renderer`)
- Audit data → branded PDF template
- White-label tetiklemeli (Agency plan)
- Email gönderim entegrasyonu (Resend var)

**Tahmini effort:** 5-7 gün.

**Impact:** 🔥 **Ajans planı için kritik satış argümanı.** "Müşteriye sunum yapacak ajansa PDF satış malzemesi."

---

### 🟡 Recipe 10: Single Page Audit PDF
**Ne yapar:** Tek sayfa PDF audit.

**LuviAI mevcut:** Yok.

**Eklemek için:** Recipe 9'un single-page versiyonu. 1 günde gelir.

---

### 🟡 Recipe 11: Advanced Page Diagnostic — "Why Is This Page Not Ranking?"
**Ne yapar:** Yapılandırılmış derin diagnostic — entity gap + headline issues + thin content + speed + competitor delta.

**LuviAI mevcut:** Auriti GEO 47-metrik var ama "neden ranklamıyor" şeklinde **yapılandırılmış narrative** yok.

**Eklemek için:**
- Auriti GEO çıktısını LLM'e ver → "narrative diagnostic" üret
- Top 3 blocker + recommended fix order
- Dashboard'da kart

**Tahmini effort:** 2-3 gün.

**Impact:** "Bu sayfa neden çalışmıyor?" sorusunun cevabını veriyorsun — çok güçlü UX moment.

---

### 🟢 Recipe 12 + 13: Sub-Headline + Image Alt-Text Optimization (Single Page)
**Ne yapar:** H1/H2/H3 retrofit + image alt-text retrofit.

**LuviAI mevcut:** Yeni üretimde yapılıyor, mevcut sayfa retrofit yok.

**Eklemek için:** Recipe 6/7'nin alt-task'leri. Ayrı endpoint açmaya gerek yok — Recipe 7'nin parametre seçenekleri olarak gelsin.

**Tahmini effort:** Recipe 7 ile birleşik.

---

### 🟡 Recipe 14-15: Local Page Diagnostic + Tuning
**Ne yapar:** Lokal sayfa (örn. "İstanbul'da diş kliniği") neden ranklamıyor + nasıl optimize edilir.

**LuviAI mevcut:** Yok. Local SEO vertical bütünüyle eksik.

**Eklemek için:**
- LocalBusiness schema generation (zaten Schema modülü var — extend)
- NAP (Name/Address/Phone) consistency check
- Local-keyword detection
- Google Maps citation tarama (Places API)

**Tahmini effort:** 8-10 gün (yeni vertical).

**Impact:** Türkiye KOBİ pazarında **çok büyük** — restoran, klinik, hizmet işletmeleri için.

---

### 🔴 Recipe 16: Local Website + GBP Alignment Verification
**Ne yapar:** Google Business Profile (GBP) ile sitenin tutarlılığı.

**LuviAI mevcut:** Yok. GBP entegrasyonu hiç yok.

**Eklemek için:**
- Google My Business API entegrasyonu (OAuth)
- GBP NAP + kategori + saatler vs site karşılaştırma
- Diff raporu + auto-fix önerileri

**Tahmini effort:** 6-8 gün.

**Impact:** 🔥🔥 **Türkiye KOBİ pazarında benzeri olmayan feature.** Hiçbir Türkçe SEO aracı bunu yapmıyor. AppTweak yapmıyor. Maya yapmıyor.

---

### 🔴 Recipe 17: Local Cannibalization Checker
**Ne yapar:** Aynı keyword için birden fazla sayfa ranklıyorsa (cannibalization) tespit + consolidation önerisi.

**LuviAI mevcut:** Yok.

**Eklemek için:**
- GSC verisi + on-site search varyasyon analizi
- Aynı keyword için top 10'da birden fazla sayfa çıkıyorsa flag
- Konsolide / canonical / 301 yönlendirme önerisi

**Tahmini effort:** 5-7 gün.

**Impact:** 🔥🔥 Cannibalization SEO'nun en az otomatize edilen problemlerinden. LuviAI bunu **automated** sunarsa farklılaşır.

---

## Önceliklendirilmiş roadmap önerisi

### 🚀 Faz 2 SPRINT — "Improve-Page Suite" (4-6 hafta)

1. **Recipe 1** — Recover Stuck Page (3-5g) — quick win, ROI gösterimi
2. **Recipe 5** — Site-Wide Refresh (10-12g) — flagship feature
3. **Recipe 6** — Light Page Refresh single (Recipe 5'ten ücretsiz, 1g)
4. **Recipe 11** — Page Diagnostic narrative (2-3g)
5. **Recipe 2** — Site-Wide Internal Links (7-10g) — ajans killer
6. **Recipe 3-4** — Single-page internal links (Recipe 2'den ücretsiz, 1g)

**Toplam:** ~25-30 gün effort. Sonunda **6 recipe canlı**.

### 🚀 Faz 2 SONU — "Reports + Optimization" (2 hafta)

7. **Recipe 7** — Standard optimization with re-scan loop (3-4g)
8. **Recipe 9-10** — PDF audit (ajans + tek sayfa) (5-7g)
9. **Recipe 8** — Site-wide standard optimization (2-3g)

**Toplam:** ~10-14 gün. **9 recipe canlı**.

### 🚀 Faz 3 — "Local SEO Vertical" (4-6 hafta)

10. **Recipe 14-15** — Local page diagnostic + tuning (8-10g)
11. **Recipe 16** — GBP alignment (6-8g)
12. **Recipe 17** — Cannibalization checker (5-7g)

**Toplam:** ~20-25 gün. **12+ recipe canlı.** Turkish KOBİ pazarında **unique positioning.**

---

## LuviAI vs on-page.ai stratejik fark

| Boyut | on-page.ai | LuviAI |
|-------|-----------|--------|
| Format | MCP (Codex/Claude Code agent) | SaaS dashboard |
| Hedef kullanıcı | Power SEO + ajans | KOBİ + ajans + e-ticaret |
| Setup | "MCP bağla + recipe paste" | "URL ver + Auto-Pilot ON" |
| Dil | İngilizce | Türkçe (ana) + İngilizce |
| Local SEO | ⚠️ Şehir-bazlı recipe'leri ABD odaklı | 🎯 Türkiye lokal — il/ilçe + Türkçe |
| GBP entegrasyon | ⚠️ Manuel | 🎯 OAuth tek tık |
| Multi-tenant | ❌ | ✅ Ajans plan |
| Pricing | Credits | Aylık abonelik (TL) |
| AI Citation tracking | ❌ | ✅ (LuviAI'nın avantajı) |
| Auto-Pilot (zamanlı cron) | ❌ | ✅ |

**LuviAI'nın gerçek avantajı:** AI Citation tracking + Auto-Pilot + Türkçe local SEO. Recipe'leri **adapt edip** kendi UX'ine entegre edersek, on-page.ai'nın "Codex paste" karmaşıklığı yerine **tek tık** sunarız.

---

**Sonraki adım:** Önce **Recipe 1 + 5** sprint'i. Bu ikisini Faz 2'ye eklersen, mevcut müşteriye "yeni içerik" ötesinde "mevcut içerik iyileştirme" değer önermesi açılır — churn riski düşer, expansion revenue artar.
