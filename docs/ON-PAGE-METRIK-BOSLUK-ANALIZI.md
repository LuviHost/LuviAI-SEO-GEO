# On-page audit — 68 metriklik açık kaynak araca karşı boşluk analizi (27.08.2026)

Kaynak: [AgriciDaniel/on-page-seo](https://github.com/AgriciDaniel/on-page-seo) (MIT, 145★) — Firecrawl (sayfa keşfi) + DataForSEO `on_page` API (analiz), 500 sayfa × "74 metrik" (kodda 68: 55'i DataForSEO'dan, 13'ü türetilmiş). **Ek maliyet istenmiyor** → DataForSEO'ya bağımlı olmadan, kendi crawler'ımızın zaten çektiği HTML/PSI verisinden hesaplanabilecekler seçildi.

## Bizde olan (14 kontrol + PageSpeed)
`audit-checks.service.ts`: sitemap, robots.txt, llms.txt, schema, meta title, meta description, OpenGraph, Twitter card, canonical, HTTPS, H1 tekilliği, görsel alt, iç link/orphan, hreflang. `pagespeed.service.ts`: LCP, CLS.

## Onların 68'i — kategori bazında kapsama

| Kategori (adet) | Bizde | Boşluk |
|---|---|---|
| Title/Meta (6) | title, description, canonical var | **uzunluk kontrolü** (title 50-60, description 120-160), **sayfalar arası tekrar eden title/description** |
| Headings (4) | H1 tekilliği | H1 sayısı, H2/H3 yapısı (hiyerarşi atlama) |
| Content (3) | — | **kelime sayısı / ince içerik**, okunabilirlik |
| Images (3) | alt var | görsel sayısı/boyutu |
| Links (4) | iç link/orphan | **kırık iç link (4xx/5xx)**, dış link sayısı |
| Technical (10) | HTTPS, canonical | doctype, SEO-dostu URL, tekrar eden meta etiketi, fetch süresi |
| Performance/CWV (8) | LCP, CLS | **INP** (FID'in yerini aldı; PSI zaten veriyor), TTI, "CWV geçti mi" özeti |
| Resources (8) | — | render-blocking script/stylesheet, sayfa boyutu (PSI audit'lerinden) |
| Social (4) | OG, Twitter card | og:image varlığı ayrı |
| Spelling/HTML errors (4) | — | geç (gürültü, TR sözlük yok) |
| Derived (5) | overallScore var | öncelikli düzeltme listesi var (issues) |

## Öneri — DataForSEO'suz eklenebilecek 6 kontrol (öncelik sırası)
1. **INP** — `pagespeed.service.ts` PSI yanıtında `INTERACTION_TO_NEXT_PAINT` zaten var; okunmuyor. (XS)
2. **Meta uzunluk** — title/description karakter aralığı; crawler `CrawledPage` başlığı tutuyor. (S)
3. **Tekrar eden title/description** — site geneli duplicate tespiti (orphan kontrolünün yanına). (S)
4. **Kırık iç link** — crawler zaten status code alıyor; 4xx/5xx hedefli iç linkler. (S)
5. **İnce içerik** — `textSample` uzunluğu/kelime sayısı < 300 uyarısı; makale üretim hattı için de sinyal. (S)
6. **H2/H3 hiyerarşi** — heading listesi crawler'da varsa; yoksa geç. (S/M)

Landing "14 kontrol" copy'si → eklendikçe dinamik sayıya bağlanmalı (`compare/page.tsx:63`).

Geç: yazım hatası, HTML validator, Firecrawl (kendi crawler'ımız var), DataForSEO (ücretli).
