# RanksUp Pricing

> **Tek kaynak koddur:** `apps/api/src/billing/plans.ts` (`BASE_PLANS` ve "PAKET YAPISI (11.11.2026)" notu).
> Bu bölüm o dosyanın 11 Kasım 2026 tarihli özetidir; bir sayı değişecekse önce plans.ts değişir.
> Müşteriye görünen metinler (fiyat kartları, /pricing, llms.txt, yardım sayfaları) plans.ts ile
> testlerle eşlenir: `apps/api/src/mcp/public-docs.spec.ts`, `apps/api/src/billing/seo-price-sync.spec.ts`.

## Güncel paket yapısı (11 Kasım 2026)

Konumlandırma "yapay zekâ görünürlük platformu". Üç ücretli plan var; fiyatlar USD'dir, TL tutarı
ödeme anındaki TCMB kuruyla hesaplanır. Yıllık ödeme 10 ay fiyatına 12 aydır.

| | Ücretsiz Deneme | Başlangıç | Profesyonel | Kurumsal |
|---|---|---|---|---|
| Plan kimliği | `trial` | `starter` | `pro` | `enterprise` |
| Fiyat | ücretsiz, 14 gün | $99/ay · $990/yıl | $349/ay · $3.490/yıl | teklifle (fiyat gösterilmez) |
| Makale | toplam 2 | yok | 40/ay | 350/ay |
| Site | 1 | 2 | 5 | 50 |
| Görünürlük çalıştırması (aylık tavan) | 3 | 20 | 75 | 1.000 |
| Ölçülen asistan | 4 | 4 | 6 (+ Muse, anahtarı tanımlıysa) | 6 (+ Muse, anahtarı tanımlıysa) |
| İzlenen uygulama (ASO) | 1 | 1 | 3 | 50 |
| RanksUp Video | yok | yok | 20/ay | 200/ay |
| Satın alma | — | panelden | panelden | satış ekibiyle |

- **Asistanlar:** deneme ve Başlangıç ChatGPT, Gemini, Claude ve Perplexity'yi ölçer; Profesyonel ve
  üstü bunlara Grok ve DeepSeek'i ekler. Meta'nın asistanı Muse yalnız Profesyonel ve üstünde ve
  yalnız `META_MODEL_API_KEY` tanımlıyken ölçülür. Kuralı ölçüm motoru dayatır (`planEngines`).
- **Ölçüm sıklığı:** her planda hesap başına 7 günde 1 ölçüm. Çalıştırma sayısı ölçüm hakkı değil,
  aylık tavandır (AI testi 1, Prompt Lab'de her soru ve her dal 1 çalıştırma).
- **Makale:** üretim yalnız Profesyonel ve üstündedir; denemenin toplam 2 makalesi ayrıdır.
  Başlangıç makale üretmez. Denemede kilitli kalan takvim konuları Profesyonel'e geçince yazılır.
- **Kurumsal:** fiyat müşteriye gösterilmez (kartta "Özel" / "Custom"), satış ekibiyle kurulur.
  Product Radar, GEO Heatmap, Live Crawler, BYOK, MCP sunucusu, REST API ve AI maliyet muhasebesi
  bu plandadır.
- **Ajans (`agency`) satıştan kalktı.** Tanımı kodda `legacy: true` ile durur: bu plandaki mevcut
  hesaplar limitlerini, özelliklerini ve yenilemesini korur; plan listede, kartlarda ve yeni satın
  almada görünmez. Kilitli bir özellikte müşteriye söylenen plan adı `featureOfferPlan` ile
  satıştaki en düşük plandan gelir (Product Radar, GEO Heatmap, Live Crawler için "Kurumsal").
- **Ad değişikliği:** `starter` planının adı 11.11.2026'ya kadar "Büyüme" / "Growth" idi
  ($149/ay, ayda 15 makale, 6 asistan).

İptal ve iade kuralları Kullanım Şartları md. 3-4'tedir (`apps/web/src/app/(marketing)/terms/page.tsx`):
aylık plan istenen zaman iptal edilir ve ödenen dönemin sonuna kadar erişim sürer; yıllık planda ilk
30 gün tam iade, sonrasında kalan ay başına orantılı iade.

---

# Tarihçe: ilk planlama notları (2026 başı) — GÜNCEL DEĞİL

> Aşağıdaki bölümler deponun ilk günlerinden kalan planlama notlarıdır ve olduğu gibi saklanmıştır.
> Plan adları, TL fiyatları, limitler, destek kademeleri, "Faz 3" ek ürünleri, deneme ve ortaklık
> kuralları bugünkü ürünü ANLATMAZ; güncel bilgi yukarıdaki bölümde ve plans.ts'tedir.

## Aylık planlar (TL)

| Plan | Aylık | Yıllık (-%20) | Makale/ay | Site | Persona | Publish hedefi | Destek |
|---|---|---|---|---|---|---|---|
| **Trial** | ücretsiz | — | 1 | 1 | 4 hazır | Markdown | self-service |
| **Starter** | ₺499 | ₺4.799 | 10 | 1 | 4 hazır | WP/FTP/SFTP/MD | email 24h |
| **Pro** ⭐ | ₺1.299 | ₺12.499 | 50 | 3 | 4 hazır + 2 custom | hepsi | email 4h |
| **Agency** | ₺3.299 | ₺31.999 | 250 | 10 | sınırsız | hepsi + API | priority + Slack |
| **Enterprise** | ₺19.999+ | custom | sınırsız | sınırsız | sınırsız | hepsi + SSO | dedicated CSM |

## Maliyet → margin (sizin tarafından)

| Plan | Bizim maliyet | Satış | Net kar | Margin |
|---|---|---|---|---|
| Starter | ~₺140 | ₺499 | ₺359 | %72 |
| Pro | ~₺640 | ₺1.299 | ₺659 | %51 |
| Agency | ~₺2.800 | ₺3.299 | ₺499 | %15 |
| Enterprise | custom | custom | custom | %30+ |

> Agency planı düşük margin görünür — ama upsell/case study/referral değeri yüksek. White-label gelir bonus.

## Ek ürünler (Faz 3)

- **RanksUp Pages** — programmatic SEO, 1000 sayfa toplu üretim. ₺9.999 tek seferlik.
- **RanksUp Refresh** — eski içerik güncelleme. ₺199/makale.
- **RanksUp Localize** — TR makaleyi 10 dile çeviri. ₺99/dil/makale.
- **RanksUp Audit** — sadece audit + öneri raporu. ₺199/ay.

## Trial mantığı

- Yeni kayıt → **14 gün ücretsiz, 1 makale otomatik üretilir** (onboarding wow)
- Trial sonu kullanıcı plan seçer veya hesap pasifleşir (silinmez, 30 gün veri durur)
- Trial sırasında **publish target sınırı yok** ama makale max 1

## Onboarding-time auto-article (kritik feature)

Yeni kullanıcı kayıt + site bağladığında:

```
1. Brain üretilir (~30 sn)
2. Audit çalışır (~30 sn)
3. Topic Queue çıkarılır (~60 sn)
4. Tier 1'in #1 konusu otomatik üretilir (~3-5 dk)
5. Markdown ZIP olarak indirilebilir (publish hedefi henüz yok)
6. "Bu makaleyi sitenize yayınlamak için planınızı seçin" CTA
```

Bu, kullanıcının ürünün **ilk değerini ücretsiz görmesini** sağlar. Conversion rate %15-25 hedef (industry avg ~%5).

## Affiliate

Faz 2'de:
- LuviHost müşterileri davet ettikleri her ödemeli kullanıcı için **%30 komisyon** (3 ay boyunca)
- Tracking link: `ranksup.ai?ref=USER_ID`
- Ödeme: aylık otomatik PayTR transfer

## İptal & iade

- **Aylık:** istediğiniz zaman iptal, kalan ay sonu erişim devam
- **Yıllık:** ilk 30 gün full iade, sonrası kalan ay başına orantılı
- Veri 30 gün saklanır, sonra silinir (KVKK uyumu)
